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
//   excludeMoments                   (alleen opened) bij welke momenten "behalve de winnaar" kan

// Bij welk moment elke plek voor spelers bestaat.
const PLAYER_SLOTS = { sharePot: ['award'], forEach: ['roundEnd'], anyPlayer: ['award', 'roundEnd'], from: ['roundEnd'] };
const PLAYER_ALL_MOMENTS = RULE_REGISTRY.moments.map(m => m.id);

defineBlock('players', {
  key: 'winner', literal: true, label: 'de winnaar', sample: 'winner', slots: ['sharePot', 'anyPlayer'], moments: ['award'],
  validate(node, path, v, allow){ if (!allow.winner) v.err(path, '"winner" kan alleen bij het moment award'); },
  select(node, ctx){ return ctx.winner ? [ctx.winner] : []; },
  phrase(){ return 'de winnaar'; }
});

defineBlock('players', {
  key: 'opened', label: 'spelers die de ronde met een bepaalde kaart begonnen', sample: { opened: { rank: 'Q' } },
  slots: ['sharePot', 'forEach', 'anyPlayer', 'from'], moments: PLAYER_ALL_MOMENTS, fields: ['opened', 'exclude'],
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
  }
});

defineBlock('players', {
  key: 'withoutCards', label: 'spelers zonder kaarten', sample: { withoutCards: true },
  slots: ['sharePot', 'forEach', 'anyPlayer'], moments: PLAYER_ALL_MOMENTS, fields: ['withoutCards', 'secondChance'],
  validate(node, path, v){
    if (node.withoutCards !== true) v.err(path + '.withoutCards', 'true verwacht');
    if ('secondChance' in node && node.secondChance !== true) v.err(path + '.secondChance', 'true verwacht');
  },
  // Met secondChance alleen wie zijn tweede kans nog heeft.
  select(node, ctx){ return ctx.state.players.filter(p => p.deck.length === 0 && !(node.secondChance && p.chanceUsed)); },
  phrase(node, forEach){
    const second = node.secondChance === true;
    return forEach ? 'elke speler zonder kaarten' + (second ? ' die nog een tweede kans heeft' : '') : 'de spelers zonder kaarten' + (second ? ' die nog een tweede kans hebben' : '');
  }
});

defineBlock('players', {
  key: 'neighbor', label: 'de linker- of rechterbuur met kaarten', sample: { neighbor: 'left' },
  slots: ['from'], moments: PLAYER_ALL_MOMENTS, fields: ['neighbor'],
  validate(node, path, v, allow){
    if (!allow.neighbor) v.err(path, '"neighbor" kan alleen als from bij forEach');
    if (!['left', 'right'].includes(node.neighbor)) v.err(path + '.neighbor', '"left" of "right" verwacht');
  },
  // De buurman hangt af van de speler die krijgt; dat regelt het gevolg zelf (zie transfer in js/blocks-effects.js).
  select(){ return []; },
  phrase(node){ return (node.neighbor === 'left' ? 'de linkerbuur' : 'de rechterbuur') + ' met kaarten'; }
});
