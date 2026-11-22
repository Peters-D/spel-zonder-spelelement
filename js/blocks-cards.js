// Bouwstenen: de keuzes van kaarten in een regelbeschrijving. Zie js/rule-registry.js voor wat elk onderdeel betekent.
// De volgorde hieronder is de volgorde in meldingen ("precies één van ... verwacht") en keuzelijsten.
//
// Kaarten komen op twee manieren voor:
//   een keuze van kaarten op tafel (bij win, exists en count): alle bouwstenen hieronder; and/or/not bevatten weer keuzes van kaarten
//   één kaart (bij opened en winnerOpened): alleen de bouwstenen met single: true; and/or/not bevatten dan weer één kaart
// Per keuze van kaarten:
//   single                                   true als de bouwsteen ook één kaart kan beschrijven
//   leaf                                     true bij rank, suit en color: als keuze op tafel gecontroleerd als één kaart
//   fields                                   de sleutels die de keuze op tafel mag hebben (de rest is een fout); bij één kaart alleen key
//   validate(node, path, v, depth, single)   de controle van de inhoud; single: true als het om één kaart gaat
//   matches(card, node)                      (alleen single) past deze ene kaart?
//   select(scope, node, rules)               de spelers uit scope (elk met een open kaart) die erbij horen, in de volgorde van de tafel
//   phrase(node)                             de zinsdelen (zie rtCards in js/rule-text.js): single, plural, bare, barePlural, en soms
//                                            cond en verbSingular
//   prompt                                   de regels voor de uitleg aan een taalmodel (js/rule-prompt.js), zonder inspringing
//   builder                                  het deel voor de regelbouwer (js/rule-builder.js), of false als de bouwer de bouwsteen
//                                            zelf maakt (and, not: de tweede eis en "juist niet"; or kan de bouwer niet maken)
//     label                                  de naam in de keuzelijst
//     toLogic(cs)                            de keuze in de bouwer (cs, zie rbNewCards) -> beschrijving; een fout is een RB_ERR
//     fromLogic(node, cs)                    vult cs vanuit de beschrijving; geeft cs, of null als de bouwer het niet kan tonen
//     editor(box, cs, label)                 de velden in het formulier

// De relaties in een groep, met hun naam in een zin en in de bouwer.
const CARD_RELATIONS = {
  sameRank: 'met dezelfde waarde', sameSuit: 'van hetzelfde symbool',
  sameColor: 'van dezelfde kleur', consecutive: 'met opeenvolgende waarden'
};
const DSL_RELATIONS = Object.keys(CARD_RELATIONS);

// De spelers uit scope waarvan de open kaart past (voor rank, suit en color).
const cardsByMatch = (scope, node) => scope.filter(p => dslCardMatches(p.faceCard, node));
// De inhoud van and en or: een niet-lege lijst, met daarin keuzes van kaarten of (single) losse kaarten.
const cardsListValidate = key => function(node, path, v, depth, single){
  if (!Array.isArray(node[key]) || node[key].length === 0) v.err(path + '.' + key, 'een lijst verwacht');
  else node[key].forEach((x, i) => (single ? v.card : v.cards)(x, path + '.' + key + '[' + i + ']', depth + 1));
};

defineBlock('cards', {
  key: 'rank', label: 'kaarten met een bepaalde waarde', sample: { rank: 'K' }, single: true, leaf: true, fields: ['rank'],
  validate(node, path, v){ v.listOf(node.rank, path + '.rank', RANKS, 'waarde'); },
  matches(card, node){ return dslList(node.rank).includes(card.rank); },
  select: cardsByMatch,
  phrase(node){
    const r = rtList(node.rank);
    return {
      single: rtJoin(r.map(x => 'een ' + RT_RANK[x][0]), 'of'),
      plural: 'kaarten met ' + rtJoin(r.map(x => 'een ' + RT_RANK[x][0]), 'of'),
      bare: rtJoin(r.map(x => RT_RANK[x][0]), 'of'), barePlural: rtJoin(r.map(x => RT_RANK[x][1]), 'of')
    };
  },
  prompt: ['{ "rank": "K" } of { "rank": ["K", "Q"] }   waarden: "2" t/m "10", "J", "Q", "K", "A"'],
  builder: {
    label: 'een waarde (zoals Heer of 7)',
    toLogic(cs){
      const ranks = RB_RANKS_DESC.filter(r => (cs.ranks || []).includes(r));
      if (ranks.length === 0) throw RB_ERR('Kies minstens één waarde.');
      return { rank: ranks.length === 1 ? ranks[0] : ranks };
    },
    fromLogic(node, cs){ cs.ranks = rtList(node.rank).slice(); return cs; },
    editor(box, cs, label){
      box.appendChild(rbChips(RANKS.slice().reverse().map(r => [r, r]), cs.ranks, label + ': waarden', (v, on) => {
        cs.ranks = on ? cs.ranks.concat(v) : cs.ranks.filter(x => x !== v);
      }));
    }
  }
});

defineBlock('cards', {
  key: 'suit', label: 'kaarten van een bepaald symbool', sample: { suit: '♥' }, single: true, leaf: true, fields: ['suit'],
  validate(node, path, v){ v.listOf(node.suit, path + '.suit', SUITS, 'symbool'); },
  matches(card, node){ return dslList(node.suit).includes(card.suit); },
  select: cardsByMatch,
  phrase(node){
    const names = rtJoin(rtList(node.suit).map(x => RT_SUIT[x]), 'of');
    return { single: 'een kaart van ' + names, plural: 'kaarten van ' + names, bare: 'kaart van ' + names, barePlural: 'kaarten van ' + names };
  },
  prompt: ['{ "suit": "♥" } of { "suit": ["♥", "♦"] }   symbolen: "♠", "♥", "♦", "♣"'],
  builder: {
    label: 'een symbool (zoals ♥)',
    toLogic(cs){
      const suits = SUITS.filter(x => (cs.suits || []).includes(x));
      if (suits.length === 0) throw RB_ERR('Kies minstens één symbool.');
      return { suit: suits.length === 1 ? suits[0] : suits };
    },
    fromLogic(node, cs){ cs.suits = rtList(node.suit).slice(); return cs; },
    editor(box, cs, label){
      box.appendChild(rbChips(SUITS.map(s => [s, s, s === '♥' || s === '♦']), cs.suits, label + ': symbolen', (v, on) => {
        cs.suits = on ? cs.suits.concat(v) : cs.suits.filter(x => x !== v);
      }));
    }
  }
});

defineBlock('cards', {
  key: 'color', label: 'rode of zwarte kaarten', sample: { color: 'red' }, single: true, leaf: true, fields: ['color'],
  validate(node, path, v){ if (!['red', 'black'].includes(node.color)) v.err(path + '.color', '"red" of "black" verwacht'); },
  matches(card, node){ return dslColor(card) === node.color; },
  select: cardsByMatch,
  phrase(node){
    const adj = node.color === 'red' ? 'rode' : 'zwarte';
    return { single: 'een ' + adj + ' kaart', plural: adj + ' kaarten', bare: adj + ' kaart', barePlural: adj + ' kaarten' };
  },
  prompt: ['{ "color": "red" } of { "color": "black" }'],
  builder: {
    label: 'rode of zwarte kaarten',
    toLogic(cs){
      if (!['red', 'black'].includes(cs.color)) throw RB_ERR('Kies rood of zwart.');
      return { color: cs.color };
    },
    fromLogic(node, cs){ cs.color = node.color; return cs; },
    editor(box, cs, label){
      box.appendChild(rbSelect([['red', 'rode kaarten'], ['black', 'zwarte kaarten']], cs.color, label + ': kleur', v => { cs.color = v; }, false));
    }
  }
});

defineBlock('cards', {
  key: 'all', label: 'alle kaarten', sample: { all: true }, fields: ['all'],
  validate(node, path, v){ if (node.all !== true) v.err(path + '.all', 'true verwacht'); },
  select(scope){ return scope.slice(); },
  phrase(){ return { single: 'een kaart', plural: 'alle kaarten', bare: 'kaart', barePlural: 'kaarten' }; },
  prompt: ['{ "all": true }'],
  builder: { label: 'alle kaarten', toLogic(){ return { all: true }; }, fromLogic(node, cs){ return cs; }, editor(){} }
});

// highest en lowest: de hoogste of laagste kaart op waarde of op de volgorde van de symbolen, eventueel binnen een deel (of).
const cardsExtreme = (key, label, prompt, builderLabel) => ({
  key, label, sample: { [key]: 'value' }, fields: [key, 'of'], prompt: [prompt],
  validate(node, path, v, depth){
    if (!['value', 'suitOrder'].includes(node[key])) v.err(path + '.' + key, '"value" of "suitOrder" verwacht');
    if ('of' in node) v.cards(node.of, path + '.of', depth + 1);
  },
  select(scope, node, rules){
    const within = 'of' in node ? dslSelectCards(scope, node.of, rules) : scope;
    if (within.length === 0) return [];
    const high = key === 'highest';
    if (node[key] === 'value'){
      const values = within.map(p => p.faceCard.value);
      const best = high ? Math.max(...values) : Math.min(...values);
      return within.filter(p => p.faceCard.value === best);
    }
    const order = suitOrderOf(rules);
    const place = p => order.indexOf(p.faceCard.suit);
    if (within.some(p => place(p) < 0)) return []; // onbekend symbool: de regel beslist niets
    const places = within.map(place);
    const best = high ? Math.min(...places) : Math.max(...places);
    return within.filter(p => place(p) === best);
  },
  phrase(node){
    const kind = node[key], word = key === 'highest' ? 'hoogste' : 'laagste';
    // Een keuze uit een deel van de kaarten ("onder de Heren"); alleen een kleur wordt een bijvoeglijk naamwoord ("de hoogste rode kaart").
    const of = node.of, colorOnly = of && 'color' in of && Object.keys(of).length === 1;
    const color = colorOnly ? (of.color === 'red' ? 'rode ' : 'zwarte ') : '';
    let what = kind === 'value' ? 'de ' + word + ' ' + color + 'kaart'
      : (colorOnly ? 'de ' + color.trim() + ' kaart met het ' + word + ' symbool' : 'de kaart met het ' + word + ' symbool');
    if (of && !colorOnly) what += ' onder de ' + rtCards(of).barePlural;
    const be = kind === 'value' ? ['is', 'zijn'] : ['heeft', 'hebben'];
    // single/plural: als onderwerp ("de hoogste kaart wint"); cond/bare/barePlural: in een voorwaarde ("er een kaart die de hoogste kaart is ligt")
    return { single: what, plural: what, cond: 'een kaart die ' + what + ' ' + be[0], bare: 'kaart die ' + what + ' ' + be[0],
      barePlural: 'kaarten die ' + what + ' ' + be[1], verbSingular: true };
  },
  // De bouwer kent "of" alleen als een kleur.
  builder: {
    label: builderLabel,
    toLogic(cs){
      if (!['value', 'suitOrder'].includes(cs.by)) throw RB_ERR('Kies of het om de waarde of om het symbool gaat.');
      const node = { [key]: cs.by };
      if (cs.of === 'red' || cs.of === 'black') node.of = { color: cs.of };
      return node;
    },
    fromLogic(node, cs){
      cs.by = node[key];
      if ('of' in node){
        if (!('color' in node.of)) return null;
        cs.of = node.of.color;
      }
      return cs;
    },
    editor(box, cs, label){
      box.appendChild(rbSelect([['value', 'op waarde'], ['suitOrder', 'op symbool (in de volgorde die bij het spel is gekozen)']], cs.by, label + ': op waarde of op symbool?', v => { cs.by = v; }, false));
      box.appendChild(rbSelect([['none', 'van alle kaarten'], ['red', 'alleen van de rode kaarten'], ['black', 'alleen van de zwarte kaarten']], cs.of, label + ': van welke kaarten?', v => { cs.of = v; }, false));
    }
  }
});
defineBlock('cards', cardsExtreme('highest', 'de hoogste kaart (op waarde of symbool)',
  '{ "highest": "value" } of { "highest": "suitOrder" }, eventueel met "of": <kaarten>   (de hoogste op waarde of op symboolvolgorde)', 'de hoogste kaart'));
defineBlock('cards', cardsExtreme('lowest', 'de laagste kaart (op waarde of symbool)',
  '{ "lowest": "value" } of { "lowest": "suitOrder" }, eventueel met "of": <kaarten>', 'de laagste kaart'));

defineBlock('cards', {
  key: 'group', label: 'de hoogste groep kaarten die bij elkaar horen', sample: { group: { relation: 'sameRank', min: 2, pick: 'highest' } }, fields: ['group'],
  validate(node, path, v){
    const g = node.group;
    if (!v.isObj(g)) return v.err(path + '.group', 'een beschrijving van de groep verwacht');
    v.only(g, path + '.group', ['relation', 'min', 'pick']);
    if (!DSL_RELATIONS.includes(g.relation)) v.err(path + '.group.relation', 'een van ' + DSL_RELATIONS.join(', ') + ' verwacht');
    v.int(g.min, path + '.group.min', 2);
    if (g.pick !== 'highest') v.err(path + '.group.pick', '"highest" verwacht');
  },
  select(scope, node){ return dslBestGroup(scope, node.group); },
  phrase(node){
    const g = node.group, rel = CARD_RELATIONS[g.relation];
    const what = 'een groep van minstens ' + g.min + ' kaarten ' + rel;
    return { single: what, plural: 'de kaarten van de hoogste groep van minstens ' + g.min + ' kaarten ' + rel, bare: 'groep', barePlural: 'groepen' };
  },
  prompt: ['{ "group": { "relation": "sameRank" | "sameSuit" | "sameColor" | "consecutive", "min": 2 of meer, "pick": "highest" } }   (de hoogste groep kaarten die bij elkaar horen)'],
  builder: {
    label: 'kaarten die bij elkaar horen (paar, reeks)',
    toLogic(cs){
      if (!DSL_RELATIONS.includes(cs.relation)) throw RB_ERR('Kies welke kaarten bij elkaar horen.');
      return { group: { relation: cs.relation, min: rbInt(cs.min, 2, 8, 'Aantal kaarten in de groep'), pick: 'highest' } };
    },
    fromLogic(node, cs){ cs.relation = node.group.relation; cs.min = node.group.min; return cs; },
    editor(box, cs, label){
      box.appendChild(rbSelect(Object.entries(CARD_RELATIONS), cs.relation, label + ': hoe horen ze bij elkaar?', v => { cs.relation = v; }, false));
      box.appendChild(rbMake('span', 'bld-word', 'minstens'));
      box.appendChild(rbNumber(cs.min, 2, 8, label + ': minstens zoveel kaarten', v => { cs.min = v; }));
    }
  }
});

defineBlock('cards', {
  key: 'and', label: 'kaarten die aan al deze eisen voldoen', sample: { and: [{ color: 'red' }, { rank: 'K' }] }, single: true, fields: ['and'],
  validate: cardsListValidate('and'),
  matches(card, node){ return node.and.every(x => dslCardMatches(card, x)); },
  select(scope, node, rules){ const sets = node.and.map(x => dslSelectCards(scope, x, rules)); return scope.filter(p => sets.every(s => s.includes(p))); },
  // De kaarten die aan alle eisen tegelijk voldoen: "kaart van harten die ook een Heer is en ook geen Aas is"
  phrase(node){
    const xs = node.and.map(rtCards);
    const [a, ...rest] = xs, restNodes = node.and.slice(1);
    const one = rest.map((o, i) => ('not' in restNodes[i] ? 'geen ' + rtCards(restNodes[i].not).bare : o.single) + ' is');
    const many = rest.map((o, i) => ('not' in restNodes[i] ? 'geen ' + rtCards(restNodes[i].not).barePlural : o.barePlural) + ' zijn');
    const bare = a.bare + ' die ook ' + one.join(' en ook ');
    const plural = a.barePlural + ' die ook ' + many.join(' en ook ');
    return { single: 'een ' + bare, plural, bare, barePlural: plural };
  },
  prompt: ['{ "and": [..] }, { "or": [..] }, { "not": .. }'], // de regel voor and, or en not samen
  builder: false // de bouwer maakt "en ook" zelf (de tweede eis bij een waarde, symbool of kleur)
});

defineBlock('cards', {
  key: 'or', label: 'kaarten die aan een van deze eisen voldoen', sample: { or: [{ rank: 'K' }, { rank: 'Q' }] }, single: true, fields: ['or'],
  validate: cardsListValidate('or'),
  matches(card, node){ return node.or.some(x => dslCardMatches(card, x)); },
  select(scope, node, rules){ const sets = node.or.map(x => dslSelectCards(scope, x, rules)); return scope.filter(p => sets.some(s => s.includes(p))); },
  phrase(node){
    const xs = node.or.map(rtCards);
    const many = rtJoin(xs.map(x => x.barePlural), 'of');
    return { single: rtJoin(xs.map(x => x.single), 'of'), plural: many, bare: rtJoin(xs.map(x => x.bare), 'of'), barePlural: many };
  },
  prompt: [], // staat bij and
  builder: false // kan de bouwer niet maken
});

defineBlock('cards', {
  key: 'not', label: 'kaarten die hier niet bij horen', sample: { not: { rank: 'K' } }, single: true, fields: ['not'],
  validate(node, path, v, depth, single){ (single ? v.card : v.cards)(node.not, path + '.not', depth + 1); },
  matches(card, node){ return !dslCardMatches(card, node.not); },
  select(scope, node, rules){ const out = dslSelectCards(scope, node.not, rules); return scope.filter(p => !out.includes(p)); },
  phrase(node){
    const x = rtCards(node.not);
    const many = 'kaarten die geen ' + x.bare + ' zijn';
    return { single: 'een kaart die geen ' + x.bare + ' is', plural: many, bare: 'kaart die geen ' + x.bare + ' is', barePlural: many };
  },
  prompt: [], // staat bij and
  builder: false // de bouwer maakt "juist niet deze kaarten" zelf
});
