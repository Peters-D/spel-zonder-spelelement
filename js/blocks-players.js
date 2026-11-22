// Bouwstenen: de keuzes van spelers in een regelbeschrijving (bij award en roundEnd). Zie js/rule-registry.js voor wat elk onderdeel
// betekent. De volgorde hieronder is de volgorde in meldingen ("precies één van ... verwacht") en keuzelijsten.
//
// Spelers staan op vier plekken (PLAYER_SLOTS): sharePot (de pot verdelen), forEach (wie het overkomt), anyPlayer (een voorwaarde) en
// from (van wie kaarten komen). Per keuze van spelers:
//   literal                          true als de keuze de tekst zelf is ('winner') in plaats van een object met de sleutel
//   slots                            op welke plekken de keuze kan
//   fields                           de sleutels die het object mag hebben (de rest is een fout)
//   validate(node, path, v, allow)   de controle van de inhoud; allow: { winner, neighbor } (mag de winnaar, mag de buurman)
//   select(node, ctx)                de spelers die het zijn; ctx: { state, winner }
//   phrase(node, forEach)            de keuze als zinsdeel: "elke speler zonder kaarten" (forEach) of "de spelers zonder kaarten"
//   giverPhrase(node)                (optioneel) het zinsdeel als gever bij transfer ("krijgt 1 kaart van ..."), als dat anders is
//   excludeMoments                   (alleen opened) bij welke momenten "behalve de winnaar" kan
//   prompt                           de regels voor de uitleg aan een taalmodel (js/rule-prompt.js), zonder inspringing
//   builder                          het deel voor de regelbouwer (js/rule-builder.js):
//     label                          de naam in de keuzelijst
//     toLogic(p, moment)             de keuze in de bouwer (p, zie rbNewPlayer) -> beschrijving; een fout is een RB_ERR
//     fromLogic(node, p)             vult p vanuit de beschrijving; geeft p, of null als de bouwer het niet kan tonen
//     editor(box, p, label)          de velden in het formulier (na de keuzelijst)

// Bij welk moment elke plek voor spelers bestaat.
const PLAYER_SLOTS = { sharePot: ['award'], forEach: ['roundEnd'], anyPlayer: ['award', 'roundEnd'], from: ['roundEnd'] };

defineBlock('players', {
  key: 'winner', literal: true, label: 'de winnaar', sample: 'winner', slots: ['sharePot', 'anyPlayer'], moments: ['award'],
  validate(node, path, v, allow){ if (!allow.winner) v.err(path, '"winner" kan alleen bij het moment award'); },
  select(node, ctx){ return ctx.winner ? [ctx.winner] : []; },
  phrase(){ return 'de winnaar'; },
  prompt: ['"winner"                                         de winnaar (alleen bij award)'],
  builder: {
    label: 'de winnaar',
    toLogic(p, moment){
      if (moment !== 'award') throw RB_ERR('"De winnaar" kun je alleen kiezen bij het moment "Als de winnaar de pot krijgt".');
      return 'winner';
    },
    fromLogic(node, p){ return p; },
    editor(){}
  }
});

defineBlock('players', {
  key: 'opened', label: 'spelers die de ronde met een bepaalde kaart begonnen', sample: { opened: { rank: 'Q' } },
  slots: ['sharePot', 'forEach', 'anyPlayer', 'from'], moments: RULE_MOMENT_IDS, fields: ['opened', 'exclude'],
  excludeMoments: ['award'], // "behalve de winnaar" (exclude: 'winner'): de winnaar bestaat alleen bij award
  validate(node, path, v, allow){
    v.card(node.opened, path + '.opened', 1);
    if ('exclude' in node && (node.exclude !== 'winner' || !allow.winner)) v.err(path + '.exclude', '"winner" verwacht (alleen bij het moment award)');
  },
  select(node, ctx){
    const state = ctx.state;
    return state.players.filter(p => state.opening[p.id] && dslCardMatches(state.opening[p.id], node.opened) &&
      !(node.exclude === 'winner' && ctx.winner && p.id === ctx.winner.id));
  },
  phrase(node, forEach){
    const c = rtCards(node.opened);
    const other = node.exclude === 'winner' ? 'andere ' : '';
    return forEach ? 'elke ' + other + 'speler die de ronde begon met ' + c.single
      : 'de ' + other + 'spelers die de ronde begonnen met ' + c.single;
  },
  // Als gever bij transfer: één speler, de eerste die bij de keuze past (zie transfer in js/blocks-effects.js).
  giverPhrase(node){ return 'de eerste speler die de ronde begon met ' + rtCards(node.opened).single; },
  prompt: ['{ "opened": <soort kaart> }                       spelers die de ronde begonnen met zo\'n kaart; met "exclude": "winner" zonder de winnaar (alleen bij award)'],
  builder: {
    label: 'spelers die de ronde begonnen met een bepaalde kaart',
    toLogic(p, moment){
      const node = { opened: rbCards(p.cs, true) };
      if (p.other){
        if (moment !== 'award') throw RB_ERR('"Behalve de winnaar" kun je alleen kiezen bij het moment "Als de winnaar de pot krijgt".');
        node.exclude = 'winner';
      }
      return node;
    },
    fromLogic(node, p){
      p.cs = rbCardsFrom(node.opened);
      if (!p.cs || !RB_SINGLE.includes(p.cs.kind)) return null;
      p.other = node.exclude === 'winner';
      return p;
    },
    editor(box, p, label){
      box.appendChild(rbCardsEditor(p.cs, true, label));
      if (registryBlock('players', 'opened').excludeMoments.includes(rb.moment)) box.appendChild(rbCheck('behalve de winnaar', p.other, v => { p.other = v; }, false));
    }
  }
});

defineBlock('players', {
  key: 'withoutCards', label: 'spelers zonder kaarten', sample: { withoutCards: true },
  slots: ['sharePot', 'forEach', 'anyPlayer'], moments: RULE_MOMENT_IDS, fields: ['withoutCards', 'secondChance'],
  validate(node, path, v){
    if (node.withoutCards !== true) v.err(path + '.withoutCards', 'true verwacht');
    if ('secondChance' in node && node.secondChance !== true) v.err(path + '.secondChance', 'true verwacht');
  },
  // Met secondChance alleen wie zijn tweede kans nog heeft. Elke speler heeft er één: wie bij forEach + transfer kaarten krijgt, gebruikt
  // hem; wie een ronde wint (ook samen), krijgt hem terug. Wie zonder kaarten en zonder tweede kans zit, valt definitief af.
  select(node, ctx){ return ctx.state.players.filter(p => p.deck.length === 0 && !(node.secondChance && p.chanceUsed)); },
  phrase(node, forEach){
    const second = node.secondChance === true;
    return forEach ? 'elke speler zonder kaarten' + (second ? ' die nog een tweede kans heeft' : '') : 'de spelers zonder kaarten' + (second ? ' die nog een tweede kans hebben' : '');
  },
  prompt: [
    '{ "withoutCards": true }                          spelers zonder kaarten',
    '{ "withoutCards": true, "secondChance": true }      spelers zonder kaarten die hun tweede kans nog hebben (elke speler heeft er één; wie met forEach + transfer kaarten krijgt, gebruikt hem; wie een ronde wint, krijgt hem terug)'
  ],
  builder: {
    label: 'spelers zonder kaarten',
    toLogic(p){ return p.chance ? { withoutCards: true, secondChance: true } : { withoutCards: true }; },
    fromLogic(node, p){ p.chance = node.secondChance === true; return p; },
    editor(box, p){ box.appendChild(rbCheck('alleen spelers die nog een tweede kans hebben', p.chance, v => { p.chance = v; }, false)); }
  }
});

defineBlock('players', {
  key: 'neighbor', label: 'de linker- of rechterbuur met kaarten', sample: { neighbor: 'left' },
  slots: ['from'], moments: RULE_MOMENT_IDS, fields: ['neighbor'],
  validate(node, path, v, allow){
    if (!allow.neighbor) v.err(path, '"neighbor" kan alleen als from bij forEach');
    if (!['left', 'right'].includes(node.neighbor)) v.err(path + '.neighbor', '"left" of "right" verwacht');
  },
  // De buur hangt af van de speler die krijgt; dat regelt het gevolg zelf (zie transfer in js/blocks-effects.js). neighbor kan
  // alleen als from bij transfer (zie validate), dus hier komt het spel nooit; een fout laat het meteen zien als dat verandert.
  select(){ throw new Error('"neighbor" kies je niet los: de buur hangt af van de speler die krijgt (zie transfer)'); },
  phrase(node){ return (node.neighbor === 'left' ? 'de linkerbuur' : 'de rechterbuur') + ' met kaarten'; },
  prompt: ['{ "neighbor": "left" } of { "neighbor": "right" } de eerstvolgende speler met kaarten links of rechts (alleen als "from" bij transfer)'],
  builder: {
    label: 'de linker- of rechterbuur',
    toLogic(p){
      if (!['left', 'right'].includes(p.side)) throw RB_ERR('Kies de linker- of rechterbuur.');
      return { neighbor: p.side };
    },
    fromLogic(node, p){ p.side = node.neighbor; return p; },
    editor(box, p, label){
      box.appendChild(rbSelect([['left', 'de linkerbuur'], ['right', 'de rechterbuur']], p.side, label + ': links of rechts?', v => { p.side = v; }, false));
    }
  }
});
