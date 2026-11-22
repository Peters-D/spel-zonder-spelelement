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

const CONDITION_MOMENTS = RULE_REGISTRY.moments.map(m => m.id);
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
  negated(node){ const x = node.exists; return ('rank' in x || 'suit' in x || 'color' in x) ? 'er geen ' + rtCards(x).bare + ' ligt' : null; }
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
  }
});

defineBlock('condition', {
  key: 'battle', moments: ['award'], label: 'er is een battle geweest', sample: { battle: true }, fields: ['battle'],
  validate(node, path, v){ if (node.battle !== true) v.err(path + '.battle', 'true verwacht'); },
  test(node, env){ return env.ctx.state.battleLevel > 0; },
  sentence(){ return 'er een battle is geweest'; },
  negated(){ return 'er geen battle is geweest'; }
});

defineBlock('condition', {
  key: 'winnerOpened', moments: ['award'], label: 'de winnaar begon de ronde met een bepaalde kaart', sample: { winnerOpened: { rank: 'K' } }, fields: ['winnerOpened'],
  validate(node, path, v, moment, depth){ v.card(node.winnerOpened, path + '.winnerOpened', depth + 1); },
  test(node, env){
    const w = env.ctx.winner, start = w ? env.ctx.state.opening[w.id] : null;
    return !!start && dslCardMatches(start, node.winnerOpened);
  },
  sentence(node){ return 'de winnaar de ronde met ' + rtCards(node.winnerOpened).single + ' begon'; },
  negated(node){ return 'de winnaar de ronde niet met ' + rtCards(node.winnerOpened).single + ' begon'; }
});

defineBlock('condition', {
  key: 'anyPlayer', moments: ['award', 'roundEnd'], label: 'er is een speler die …', sample: { anyPlayer: { withoutCards: true } }, fields: ['anyPlayer'],
  validate(node, path, v, moment){ v.players(node.anyPlayer, path + '.anyPlayer', moment === 'award', false); },
  test(node, env){ return dslSelectPlayers(node.anyPlayer, env.ctx).length > 0; },
  sentence(node){ return conditionPlayerSentence(node.anyPlayer, false); },
  negated(node){ return conditionPlayerSentence(node.anyPlayer, true); }
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
  }
});

// ---- en, of, niet: voor elk moment, en bevatten zelf weer voorwaarden ----

const conditionList = key => ({
  key, moments: CONDITION_MOMENTS, fields: [key], grouping: true,
  validate(node, path, v, moment, depth){
    if (!Array.isArray(node[key]) || node[key].length === 0) v.err(path + '.' + key, 'een lijst verwacht');
    else node[key].forEach((x, i) => v.condition(x, path + '.' + key + '[' + i + ']', moment, depth + 1));
  }
});

defineBlock('condition', Object.assign(conditionList('and'), {
  label: 'al deze voorwaarden gelden', sample: m => ({ and: CONDITION_SIMPLE_IF[m] }),
  test(node, env){ return node.and.every(x => dslTest(x, env)); },
  sentence(node){ return rtJoin(node.and.map(rtWrapCondition), 'en'); }
}));

defineBlock('condition', Object.assign(conditionList('or'), {
  label: 'minstens één van deze voorwaarden geldt', sample: m => ({ or: CONDITION_SIMPLE_IF[m] }),
  test(node, env){ return node.or.some(x => dslTest(x, env)); },
  sentence(node){ return rtJoin(node.or.map(rtWrapCondition), 'of'); }
}));

defineBlock('condition', {
  key: 'not', moments: CONDITION_MOMENTS, label: 'deze voorwaarde geldt niet', sample: m => ({ not: CONDITION_SIMPLE_IF[m][0] }), fields: ['not'],
  validate(node, path, v, moment, depth){ v.condition(node.not, path + '.not', moment, depth + 1); },
  test(node, env){ return !dslTest(node.not, env); },
  // Een gewone ontkenning waar de voorwaarde die kent ("er geen Aas ligt"); anders de omweg "het niet zo is dat ...".
  sentence(node){
    const inner = registryConditionOf(node.not), plain = inner.negated ? inner.negated(node.not) : null;
    return plain !== null ? plain : 'het niet zo is dat ' + rtWrapCondition(node.not);
  }
});
