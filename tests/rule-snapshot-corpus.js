// Vangnet voor het bouwsteenregister: legt vast wat het spel nu met regelbeschrijvingen doet, zodat een verbouwing van de
// regelcode (js/rule-dsl.js, js/rule-text.js, js/rule-builder*.js, js/rule-prompt.js) aantoonbaar niets verandert.
//
// Dit bestand draait in de nagebootste pagina van de rooktest (tests/smoke-run.js, onderdeel "vangnet"): alle globale functies
// van het spel zijn hier beschikbaar. Het maakt een vaste verzameling beschrijvingen (altijd dezelfde, met een vaste seed) en
// geeft per beschrijving terug:
//   zin      de zin in gewone taal (describeRuleLogic)
//   bouwer   of de regelbouwer de beschrijving kan tonen en er precies dezelfde beschrijving van terugmaakt
//   gedrag   een vingerafdruk van wat de regel doet op vaste tafels (beslissen, gelijkspel) of vaste rondes (pot, einde van de ronde)
// plus de foutmeldingen van een vaste reeks ongeldige beschrijvingen, de keuzelijsten van de bouwer en de volledige instructie
// voor Claude. De uitkomst staat in tests/rule-snapshot.json; `node tests/smoke.js --update` schrijft hem opnieuw.
globalThis.__ruleSnapshot = function(){
  const J = x => JSON.stringify(x);
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const rnd = mulberry32(hashSeed('vangnet'));
  const pick = a => a[Math.floor(rnd() * a.length)];
  const MOMENTS = ['decide', 'tiebreak', 'award', 'roundEnd'];
  const onTable = m => m === 'decide' || m === 'tiebreak';
  const forMoment = (list, m) => list.filter(b => b.moments.includes(m));
  const playerSample = key => RULE_BLOCKS.players.find(b => b.key === key).sample;
  const defaultThen = m => onTable(m) ? { win: { rank: 'K' } } : m === 'award' ? { discardPot: true } : { forEach: { withoutCards: true }, discardTop: 1 };

  // ---- de geldige beschrijvingen ----
  const valid = new Map();
  const condPool = { decide: [], tiebreak: [], award: [], roundEnd: [] }, thenPool = { decide: [], tiebreak: [], award: [], roundEnd: [] };
  const add = logic => {
    if (validateRuleLogic(logic).length) return;
    const k = J(logic);
    if (valid.has(k)) return;
    valid.set(k, logic);
    if (logic.if && !condPool[logic.moment].some(c => J(c) === J(logic.if))) condPool[logic.moment].push(logic.if);
    if (!thenPool[logic.moment].some(t => J(t) === J(logic.then))) thenPool[logic.moment].push(logic.then);
  };

  // Kaarten: elke keuze uit de bouwstenenlijst, plus varianten met "onder", groepen en en/of/niet.
  const cards = RULE_BLOCKS.cards.map(b => b.sample).concat([
    { rank: ['K', 'Q', 'A'] }, { suit: ['♥', '♦'] }, { color: 'black' }, { lowest: 'suitOrder' }, { highest: 'suitOrder' },
    { highest: 'value', of: { color: 'red' } }, { highest: 'suitOrder', of: { rank: 'K' } }, { lowest: 'value', of: { suit: '♥' } },
    { not: { rank: ['K', 'Q'] } }, { and: [{ suit: '♥' }, { not: { rank: 'K' } }] }, { or: [{ rank: 'K' }, { color: 'red' }] },
    { and: [{ suit: '♥' }, { rank: 'K' }, { not: { rank: 'A' } }] }
  ]);
  for (const relation of DSL_RELATIONS) for (const min of [2, 3, 4]) cards.push({ group: { relation, min, pick: 'highest' } });
  const singles = RULE_BLOCKS.cards.filter(b => RULE_BLOCKS.singleCards.includes(b.key)).map(b => b.sample)
    .concat([{ rank: ['K', 'Q'] }, { color: 'black' }, { and: [{ rank: 'K' }, { suit: '♠' }] }, { not: { color: 'red' } }]);
  const ranges = [{ min: 1 }, { max: 1 }, { max: 0 }, { min: 0, max: 0 }, { min: 2, max: 2 }, { min: 1, max: 1 }, { min: 1, max: 3 }, { min: 0 }, { min: 2, max: 9 }];

  for (const m of MOMENTS){
    for (const b of forMoment(RULE_BLOCKS.effects, m)) add({ moment: m, then: ruleBlockSample(b, m) });
    for (const b of forMoment(RULE_BLOCKS.conditions, m)){
      const s = ruleBlockSample(b, m);
      add({ moment: m, if: s, then: defaultThen(m) });
      add({ moment: m, if: { not: s }, then: defaultThen(m) });
    }
    if (onTable(m)){
      for (const c of cards){ add({ moment: m, then: { win: c } }); add({ moment: m, if: { exists: c }, then: defaultThen(m) }); }
      for (const r of ranges) for (const c of [{ rank: 'A' }, { color: 'red' }, { suit: '♥' }]) add(Object.assign({ moment: m, if: Object.assign({ count: c }, r) }, { then: { win: { all: true } } }));
    }
  }
  // De pot (award): wie begon met welke kaart, welke spelers, verdelen.
  for (const c of singles){
    add({ moment: 'award', if: { winnerOpened: c }, then: { discardPot: true } });
    add({ moment: 'award', if: { anyPlayer: { opened: c } }, then: { discardPot: true } });
    add({ moment: 'award', if: { anyPlayer: { opened: c, exclude: 'winner' } }, then: { discardPot: true } });
    add({ moment: 'award', then: { sharePot: ['winner', { opened: c, exclude: 'winner' }] } });
    add({ moment: 'roundEnd', then: { forEach: { opened: c }, discardTop: 1 } });
    add({ moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { opened: c }, count: 1 } } });
  }
  for (const slot of ['sharePot', 'anyPlayer']) for (const p of rulePlayerChoices(slot, 'award')){
    const s = playerSample(p.key);
    if (slot === 'sharePot') add({ moment: 'award', then: { sharePot: [s] } });
    else add({ moment: 'award', if: { anyPlayer: s }, then: { discardPot: true } });
  }
  add({ moment: 'award', then: { sharePot: [{ opened: { rank: 'K' } }, { opened: { rank: 'Q' } }, { withoutCards: true }] } });
  add({ moment: 'award', if: { anyPlayer: { withoutCards: true, secondChance: true } }, then: { discardPot: true } });
  for (const r of ranges) for (const m of ['award', 'roundEnd']) add({ moment: m, if: { playersWithCards: r }, then: defaultThen(m) });
  // Het einde van de ronde: wie krijgt, van wie, hoeveel; afleggen.
  for (const each of [{ withoutCards: true }, { withoutCards: true, secondChance: true }, { opened: { rank: 'K' } }, { opened: { color: 'red' } }]){
    for (const from of [{ neighbor: 'left' }, { neighbor: 'right' }, { opened: { rank: 'A' } }]) for (const count of [1, 3]){
      add({ moment: 'roundEnd', then: { forEach: each, transfer: { from, count } } });
    }
    for (const n of [1, 2, 52]) add({ moment: 'roundEnd', then: { forEach: each, discardTop: n } });
  }
  add({ moment: 'roundEnd', if: { anyPlayer: { withoutCards: true, secondChance: true } }, then: { forEach: { withoutCards: true, secondChance: true }, transfer: { from: { neighbor: 'left' }, count: 1 } } });
  // De regels van het spel en het voorbeeldblok.
  for (const r of RULES) if (!r.custom && r.logic) add(r.logic);
  add(CUSTOM_RULE_SAMPLE.logic);
  // Willekeurige combinaties (vaste seed): voorwaarden met en/of/niet, één groep diep, en een gevolg uit de verzameling.
  for (let i = 0; i < 260; i++){
    const m = pick(MOMENTS), pool = condPool[m];
    const cond = () => { const c = pick(pool); return rnd() < 0.2 ? { not: c } : c; };
    const k = 1 + Math.floor(rnd() * 3);
    let iff = null;
    if (k === 1) iff = cond();
    else {
      const items = Array.from({ length: k }, cond);
      if (rnd() < 0.4) items[items.length - 1] = { [rnd() < 0.5 ? 'and' : 'or']: [cond(), cond()] };
      iff = { [rnd() < 0.5 ? 'and' : 'or']: items };
      if (rnd() < 0.15) iff = { not: iff };
    }
    const logic = { moment: m };
    if (rnd() < 0.9) logic.if = iff;
    logic.then = pick(thenPool[m]);
    add(logic);
  }

  // ---- wat het spel ermee doet ----
  // Vaste tafels voor beslissen en gelijkspel, vaste stapels voor de pot en het einde van de ronde.
  const deckOrder = () => shuffle(buildDeck(), rnd);
  const tables = Array.from({ length: 40 }, () => { const d = deckOrder(); return d.slice(0, 2 + Math.floor(rnd() * 5)); });
  const rounds = Array.from({ length: 12 }, () => {
    const d = deckOrder(), n = 3 + Math.floor(rnd() * 3); let at = 0;
    return Array.from({ length: n }, (_, i) => ({ id: i, name: 'S' + i, deck: d.slice(at, (at += 1 + Math.floor(rnd() * 4))), chanceUsed: rnd() < 0.3 }));
  });
  const ORDERS = [{}, { suitOrder: ['♣', '♦', '♥', '♠'] }];
  const behaviour = logic => {
    const c = compileRuleLogic(logic);
    if (onTable(logic.moment)){
      const fn = c.decide || c.breakTie;
      return fnv(J(tables.map(t => ORDERS.map(rules => { const w = fn(t.map((card, i) => ({ id: i, faceCard: card })), rules); return w ? w.map(p => p.id) : null; }))));
    }
    const before = RULES.slice();
    try {
      RULES.push(Object.assign({ id: '__vangnet', priority: 950, title: 'vangnet', default: false }, c));
      rulesRefresh();
      return fnv(J(rounds.map(players => {
        const st = createGameState(players.map(p => Object.assign({}, p, { deck: p.deck.map(x => Object.assign({}, x)) })), { __vangnet: true });
        const r = enginePlayRound(st);
        return [r.winner ? r.winner.id : null, st.players.map(p => [p.deck.map(x => x.rank + x.suit).join(','), p.out, p.chanceUsed]), st.discard.map(x => x.rank + x.suit).join(',')];
      })));
    } finally { RULES.length = 0; RULES.push(...before); rulesRefresh(); }
  };
  const builder = logic => {
    const st = rbFromLogic(logic);
    if (!st) return 'kan niet tonen';
    const r = rbToLogic(st);
    if (r.error) return 'fout: ' + r.error;
    return J(r.logic) === J(logic) ? 'gelijk' : 'anders: ' + J(r.logic);
  };
  const validOut = [...valid.values()].map(logic => ({ logic, zin: describeRuleLogic(logic), bouwer: builder(logic), gedrag: behaviour(logic) }));

  // ---- ongeldige beschrijvingen en hun foutmeldingen ----
  const nest = (d, inner) => { let x = inner; for (let i = 0; i < d; i++) x = { not: x }; return x; };
  const invalid = [
    'x', null, [], {}, { moment: 'later', then: { win: { all: true } } }, { moment: 'decide' }, { moment: 'decide', then: { win: { all: true } }, code: 'x' },
    { moment: 'decide', then: { win: { rank: '1' } } }, { moment: 'decide', then: { win: { suit: 'x' } } }, { moment: 'decide', then: { win: { color: 'blue' } } },
    { moment: 'decide', then: { win: { rank: 'K', suit: '♥' } } }, { moment: 'decide', then: { win: { rank: [] } } }, { moment: 'decide', then: { win: { all: false } } },
    { moment: 'decide', then: { win: { highest: 'size' } } }, { moment: 'decide', then: { win: { highest: 'value', of: { rank: 'Z' } } } },
    { moment: 'decide', then: { win: { group: { relation: 'sameRank', min: 1, pick: 'highest' } } } }, { moment: 'decide', then: { win: { group: { relation: 'friends', min: 2, pick: 'highest' } } } },
    { moment: 'decide', then: { win: { group: { relation: 'sameRank', min: 2, pick: 'lowest' } } } }, { moment: 'decide', then: { win: { and: [] } } },
    { moment: 'decide', then: { win: nest(9, { all: true }) } }, { moment: 'decide', then: { discardPot: true } }, { moment: 'award', then: { win: { all: true } } },
    { moment: 'decide', if: { battle: true }, then: { win: { all: true } } }, { moment: 'award', if: { exists: { rank: 'K' } }, then: { discardPot: true } },
    { moment: 'decide', if: { count: { all: true } }, then: { win: { all: true } } }, { moment: 'decide', if: { count: { rank: 'A' }, min: 3, max: 1 }, then: { win: { all: true } } },
    { moment: 'decide', if: { count: { rank: 'A' }, min: -1 }, then: { win: { all: true } } }, { moment: 'award', if: { playersWithCards: { min: 4, max: 2 } }, then: { discardPot: true } },
    { moment: 'award', if: { playersWithCards: 3 }, then: { discardPot: true } }, { moment: 'award', if: { winnerOpened: { highest: 'value' } }, then: { discardPot: true } },
    { moment: 'roundEnd', then: { forEach: 'winner', discardTop: 1 } }, { moment: 'roundEnd', then: { forEach: { neighbor: 'left' }, discardTop: 1 } },
    { moment: 'roundEnd', then: { forEach: { opened: { rank: 'K' }, exclude: 'winner' }, discardTop: 1 } }, { moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { withoutCards: true }, count: 1 } } },
    { moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { neighbor: 'left' } } } }, { moment: 'roundEnd', then: { forEach: { withoutCards: true }, discardTop: 0 } },
    { moment: 'roundEnd', then: { forEach: { withoutCards: true }, discardTop: 53 } }, { moment: 'roundEnd', then: { forEach: { withoutCards: true, secondChance: false }, discardTop: 1 } },
    { moment: 'roundEnd', then: { forEach: { opened: { rank: 'K' }, secondChance: true }, discardTop: 1 } }, { moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { neighbor: 'up' }, count: 1 } } },
    { moment: 'award', then: { sharePot: [] } }, { moment: 'award', then: { sharePot: ['winner', { neighbor: 'left' }] } }, { moment: 'award', then: { discardPot: true, sharePot: ['winner'] } },
    { moment: 'award', if: { and: [] }, then: { discardPot: true } }, { moment: 'award', if: nest(9, { battle: true }), then: { discardPot: true } }
  ];
  const invalidOut = invalid.map(logic => ({ logic, fouten: validateRuleLogic(logic) }));

  // ---- de keuzelijsten van de bouwer en de instructie voor Claude ----
  const keuzes = { momenten: RULE_MOMENTS, perMoment: {}, spelers: {}, kaartlabels: RB_CARD_LABELS, relatielabels: RB_RELATION_LABELS, aantallabels: RB_MODE_LABELS };
  for (const m of MOMENTS){
    keuzes.perMoment[m] = ruleChoicesFor(m);
    for (const slot of ['sharePot', 'forEach', 'anyPlayer', 'from']) keuzes.spelers[slot + '/' + m] = rulePlayerChoices(slot, m);
  }
  const prompt = buildRulePrompt('Twee Vrouwen winnen samen van een Heer');

  return J({ valid: validOut, invalid: invalidOut, keuzes, prompt });
};
