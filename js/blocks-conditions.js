// Bouwstenen: de voorwaarden (if) van een regelbeschrijving. Zie js/rule-registry.js voor wat elk onderdeel betekent.
// De volgorde hieronder is de volgorde in meldingen ("precies één van ... verwacht") en keuzelijsten.
//
// Per voorwaarde:
//   fields                               de sleutels die de voorwaarde mag hebben (de rest is een fout)
//   validate(node, path, v, moment, depth)  de controle van de inhoud (de sleutels en het moment controleert het register al)
//   test(node, env)                      klopt de voorwaarde? env: { scope, rules } bij decide en tiebreak, { ctx } bij award en roundEnd
//   sentence(node)                       de voorwaarde als bijzin, met het werkwoord achteraan: "er een Aas ligt"
//   negated(node)                        (optioneel) de gewone ontkenning, "er geen Aas ligt", of null; anders "het niet zo is dat ..."
//   grouping                             true bij "en" en "of": in een zin komt zo'n voorwaarde tussen haakjes
//   prompt                               de regels voor de uitleg aan een taalmodel (js/rule-prompt.js), zonder inspringing
//   builder                              het deel voor de regelbouwer (js/rule-builder.js), of false als de bouwer de voorwaarde zelf
//                                        maakt (en, of, niet: het groepje voorwaarden en het vinkje "juist niet")
//     fresh(c)                           vult een nieuwe voorwaarde c ({ key, not }) met de beginwaarden
//     toLogic(c, moment)                 c -> beschrijving; een fout is een RB_ERR
//     fromLogic(node, c, notes)          vult c vanuit de beschrijving; geeft c, of null als de bouwer het niet kan tonen. Past de
//                                        bouwer iets aan om de regel te kunnen tonen, dan zet hij een zin daarover in notes
//     editor(row, c, label)              de velden in het formulier (na de keuzelijst)
//   De veldtypes van de bouwer: kaarten (rbCards, rbCardsFrom, rbCardsEditor), spelers (rbPlayer, rbPlayerFrom, rbPlayerEditor),
//   een aantal (rbRange, rbRangeFrom, rbRangeEditor) en een getal (rbInt, rbNumber). Zie js/rule-builder.js en js/rule-builder-ui.js.

// De bouwer telt spelers met kaarten tot zoveel: het spel heeft 2 tot en met 8 spelers.
const CONDITION_MAX_PLAYERS = 8;
// De eerste twee voorwaarden die bij een moment passen (voor voorbeelden van "en", "of" en "niet").
const CONDITION_SIMPLE_IF = {
  decide: [{ exists: { rank: 'A' } }, { count: { rank: '2' }, min: 2 }], tiebreak: [{ exists: { rank: 'A' } }, { count: { rank: '2' }, min: 2 }],
  award: [{ battle: true }, { winnerOpened: { rank: 'K' } }], roundEnd: [{ anyPlayer: { withoutCards: true } }, { playersWithCards: { min: 2 } }]
};

// Een zin voor "er is een speler die ...", met of zonder "geen".
function conditionPlayerSentence(p, none){
  if (p === 'winner') return none ? 'er geen winnaar is' : 'er een winnaar is';
  if ('withoutCards' in p) return 'er ' + (none ? 'geen' : 'een') + ' speler zonder kaarten is' + (p.secondChance === true ? ' die nog een tweede kans heeft' : '');
  return 'er ' + (none ? 'geen' : 'een') + ' ' + (p.exclude === 'winner' ? 'andere ' : '') + 'speler is die de ronde met ' + rtCards(p.opened).single + ' begon';
}

defineBlock('condition', {
  key: 'exists', moments: ['decide', 'tiebreak'], label: 'er ligt een bepaalde kaart', sample: { exists: { rank: 'A' } }, fields: ['exists'],
  validate(node, path, v, moment, depth){ v.cards(node.exists, path + '.exists', depth + 1); },
  test(node, env){ return dslSelectCards(env.scope, node.exists, env.rules).length > 0; },
  sentence(node){ const c = rtCards(node.exists); return 'er ' + (c.cond || c.single) + ' ligt'; },
  negated(node){ const x = node.exists; return ('rank' in x || 'suit' in x || 'color' in x) ? 'er geen ' + rtCards(x).bare + ' ligt' : null; },
  prompt: ['{ "exists": <kaarten> }                           decide, tiebreak'],
  builder: {
    fresh(c){ c.cs = rbNewCards('rank'); },
    toLogic(c){ return { exists: rbCards(c.cs, false) }; },
    fromLogic(node, c){ c.cs = rbCardsFrom(node.exists); return c.cs ? c : null; },
    editor(row, c, label){ row.appendChild(rbCardsEditor(c.cs, false, label)); }
  }
});

defineBlock('condition', {
  key: 'count', moments: ['decide', 'tiebreak'], label: 'er liggen zoveel kaarten van een soort (bijvoorbeeld minstens 2 Azen)', sample: { count: { rank: 'A' }, min: 2 },
  fields: ['count', 'min', 'max'],
  validate(node, path, v, moment, depth){ v.cards(node.count, path + '.count', depth + 1); v.range(node, path); },
  test(node, env){
    const n = dslSelectCards(env.scope, node.count, env.rules).length;
    return (!('min' in node) || n >= node.min) && (!('max' in node) || n <= node.max);
  },
  sentence(node){
    const c = rtCards(node.count);
    return rtAmount(node, { pre: 'er ', sing: c.bare, plural: c.barePlural, vs: 'ligt', vp: 'liggen', none: 'er geen ' + c.barePlural + ' liggen' });
  },
  prompt: ['{ "count": <kaarten>, "min": n, "max": n }        decide, tiebreak (min, max of allebei)'],
  builder: {
    fresh(c){ c.cs = rbNewCards('rank'); Object.assign(c, { mode: 'min', n: 2, m: 3 }); },
    toLogic(c){ return Object.assign({ count: rbCards(c.cs, false) }, rbRange(c, 52)); },
    fromLogic(node, c){ c.cs = rbCardsFrom(node.count); if (!c.cs) return null; rbRangeFrom(node, c); return c; },
    editor(row, c, label){ row.appendChild(rbRangeEditor(c, 52, label)); row.appendChild(rbCardsEditor(c.cs, false, label)); }
  }
});

defineBlock('condition', {
  key: 'battle', moments: ['award'], label: 'er is een battle geweest', sample: { battle: true }, fields: ['battle'],
  validate(node, path, v){ if (node.battle !== true) v.err(path + '.battle', 'true verwacht'); },
  test(node, env){ return env.ctx.state.battleLevel > 0; },
  sentence(){ return 'er een battle is geweest'; },
  negated(){ return 'er geen battle is geweest'; },
  prompt: ['{ "battle": true }                                award: er was deze ronde een battle'],
  builder: { fresh(){}, toLogic(){ return { battle: true }; }, fromLogic(node, c){ return c; }, editor(){} }
});

defineBlock('condition', {
  key: 'winnerOpened', moments: ['award'], label: 'de winnaar begon de ronde met een bepaalde kaart', sample: { winnerOpened: { rank: 'K' } }, fields: ['winnerOpened'],
  validate(node, path, v, moment, depth){ v.card(node.winnerOpened, path + '.winnerOpened', depth + 1); },
  test(node, env){
    const w = env.ctx.winner, start = w ? env.ctx.state.opening[w.id] : null;
    return !!start && dslCardMatches(start, node.winnerOpened);
  },
  sentence(node){ return 'de winnaar de ronde met ' + rtCards(node.winnerOpened).single + ' begon'; },
  negated(node){ return 'de winnaar de ronde niet met ' + rtCards(node.winnerOpened).single + ' begon'; },
  prompt: ['{ "winnerOpened": <soort kaart> }                 award'],
  builder: {
    fresh(c){ c.cs = rbNewCards('rank'); },
    toLogic(c){ return { winnerOpened: rbCards(c.cs, true) }; },
    fromLogic(node, c){ c.cs = rbCardsFrom(node.winnerOpened); return c.cs ? c : null; },
    editor(row, c, label){ row.appendChild(rbCardsEditor(c.cs, true, label)); }
  }
});

defineBlock('condition', {
  key: 'anyPlayer', moments: ['award', 'roundEnd'], label: 'er is een speler die …', sample: { anyPlayer: { withoutCards: true } }, fields: ['anyPlayer'],
  validate(node, path, v, moment){ v.players(node.anyPlayer, path + '.anyPlayer', moment === 'award', false); },
  test(node, env){ return dslSelectPlayers(node.anyPlayer, env.ctx).length > 0; },
  sentence(node){ return conditionPlayerSentence(node.anyPlayer, false); },
  negated(node){ return conditionPlayerSentence(node.anyPlayer, true); },
  prompt: ['{ "anyPlayer": <spelers> }                        award, roundEnd'],
  // In de bouwer staan de velden van de speler direct in de voorwaarde, onder andere namen (who in plaats van kind).
  builder: {
    fresh(c){ Object.assign(c, { who: 'withoutCards', cs: rbNewCards('rank'), other: false, chance: false }); },
    toLogic(c, moment){ return { anyPlayer: rbPlayer({ kind: c.who, cs: c.cs, other: c.other, chance: c.chance }, moment) }; },
    fromLogic(node, c){
      const p = rbPlayerFrom(node.anyPlayer);
      if (!p || p.kind === 'neighbor') return null;
      c.who = p.kind; c.cs = p.cs; c.other = p.other; c.chance = p.chance;
      return c;
    },
    editor(row, c, label){
      const p = { get kind(){ return c.who; }, set kind(v){ c.who = v; }, get cs(){ return c.cs; }, set cs(v){ c.cs = v; }, get other(){ return c.other; }, set other(v){ c.other = v; }, get chance(){ return c.chance; }, set chance(v){ c.chance = v; } };
      row.appendChild(rbPlayerEditor(p, 'anyPlayer', label));
    }
  }
});

defineBlock('condition', {
  key: 'playersWithCards', moments: ['award', 'roundEnd'], label: 'zoveel spelers hebben nog kaarten (bijvoorbeeld minstens 2)', sample: { playersWithCards: { min: 2 } },
  fields: ['playersWithCards'],
  validate(node, path, v){
    if (!v.isObj(node.playersWithCards)) v.err(path + '.playersWithCards', '{ min, max } verwacht');
    else { v.only(node.playersWithCards, path + '.playersWithCards', ['min', 'max']); v.range(node.playersWithCards, path + '.playersWithCards'); }
  },
  test(node, env){
    const n = env.ctx.state.players.filter(p => p.deck.length > 0).length;
    const r = node.playersWithCards;
    return (!('min' in r) || n >= r.min) && (!('max' in r) || n <= r.max);
  },
  sentence(node){
    return rtAmount(node.playersWithCards, { pre: '', sing: 'speler kaarten', plural: 'spelers kaarten', vs: 'heeft', vp: 'hebben', none: 'geen enkele speler kaarten heeft' });
  },
  prompt: ['{ "playersWithCards": { "min": n, "max": n } }    award, roundEnd'],
  // De bouwer telt tot CONDITION_MAX_PLAYERS spelers. Een bovengrens daarboven wordt die grens: er zijn nooit meer spelers, dus de
  // regel speelt hetzelfde (de bouwer meldt het). Een ondergrens daarboven kan hij niet tonen: die zou de regel echt veranderen.
  builder: {
    fresh(c){ Object.assign(c, { mode: 'min', n: 2, m: 3 }); },
    toLogic(c){ return { playersWithCards: rbRange(c, CONDITION_MAX_PLAYERS) }; },
    fromLogic(node, c, notes){
      const max = CONDITION_MAX_PLAYERS;
      let r = node.playersWithCards;
      if (r.min !== undefined && r.min > max) return null;
      if (r.max !== undefined && r.max > max){
        if (notes) notes.push('De bovengrens van ' + r.max + ' spelers is in de bouwer ' + max + ' geworden: er zijn nooit meer dan ' + max + ' spelers, dus de regel speelt hetzelfde.');
        r = Object.assign({}, r, { max });
      }
      rbRangeFrom(r, c);
      return c;
    },
    editor(row, c, label){ row.appendChild(rbRangeEditor(c, CONDITION_MAX_PLAYERS, label)); row.appendChild(rbMake('span', 'bld-word', 'spelers hebben nog kaarten')); }
  }
});

// ---- en, of, niet: voor elk moment, en bevatten zelf weer voorwaarden ----

const conditionList = key => ({
  key, moments: RULE_MOMENT_IDS, fields: [key], grouping: true, builder: false, // de bouwer: het groepje voorwaarden (en / of)
  validate(node, path, v, moment, depth){
    if (!Array.isArray(node[key]) || node[key].length === 0) v.err(path + '.' + key, 'een lijst verwacht');
    else node[key].forEach((x, i) => v.condition(x, path + '.' + key + '[' + i + ']', moment, depth + 1));
  }
});

defineBlock('condition', Object.assign(conditionList('and'), {
  label: 'al deze voorwaarden gelden', sample: m => ({ and: CONDITION_SIMPLE_IF[m] }),
  test(node, env){ return node.and.every(x => dslTest(x, env)); },
  sentence(node){ return rtJoin(node.and.map(rtWrapCondition), 'en'); },
  prompt: ['{ "and": [..] }, { "or": [..] }, { "not": .. }'] // de regel voor en, of en niet samen
}));

defineBlock('condition', Object.assign(conditionList('or'), {
  label: 'minstens één van deze voorwaarden geldt', sample: m => ({ or: CONDITION_SIMPLE_IF[m] }),
  test(node, env){ return node.or.some(x => dslTest(x, env)); },
  sentence(node){ return rtJoin(node.or.map(rtWrapCondition), 'of'); },
  prompt: [] // staat bij and
}));

defineBlock('condition', {
  key: 'not', moments: RULE_MOMENT_IDS, label: 'deze voorwaarde geldt niet', sample: m => ({ not: CONDITION_SIMPLE_IF[m][0] }), fields: ['not'],
  prompt: [], // staat bij and
  builder: false, // de bouwer: het vinkje "juist niet"
  validate(node, path, v, moment, depth){ v.condition(node.not, path + '.not', moment, depth + 1); },
  test(node, env){ return !dslTest(node.not, env); },
  // Een gewone ontkenning waar de voorwaarde die kent ("er geen Aas ligt"); anders de omweg "het niet zo is dat ...".
  sentence(node){
    const inner = registryConditionOf(node.not), plain = inner.negated ? inner.negated(node.not) : null;
    return plain !== null ? plain : 'het niet zo is dat ' + rtWrapCondition(node.not);
  }
});
