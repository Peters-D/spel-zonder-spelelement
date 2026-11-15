// Regels in gewone taal: maakt van een beschrijving (logic, zie js/rule-dsl.js) een Nederlandse zin, en bevat de lijst met keuzes die
// bij elk moment horen (voor de regelbouwer, waarmee je een regel aan elkaar klikt). Alleen tekst en gegevens: geen scherm.
//
//   describeRuleLogic(logic)       de beschrijving als zin(nen), of '' als de beschrijving niet klopt
//   RULE_MOMENTS, RULE_BLOCKS      de moment en bouwstenen met hun Nederlandse naam
//   ruleChoicesFor(moment)         wat er bij dat moment gekozen kan worden: voorwaarden, gevolgen, kaarten
//   rulePlayerChoices(slot, moment) welke keuzes van spelers er op een plek (en bij een moment) passen
//
// De tests controleren dat de lijst met bouwstenen precies overeenkomt met wat de controle (validateRuleLogic) toelaat, en dat
// elke bouwsteen een zin geeft. Komt er een bouwsteen bij in js/rule-dsl.js, dan moet hij hier ook bij (de test faalt anders niet
// vanzelf voor een bouwsteen die ontbreekt: let daar zelf op).

// Het enkelvoud en meervoud van een waarde, zoals die in een zin staat.
const RT_RANK = {
  '2': ['2', "2'en"], '3': ['3', "3'en"], '4': ['4', "4'en"], '5': ['5', "5'en"], '6': ['6', "6'en"], '7': ['7', "7'en"], '8': ['8', "8'en"],
  '9': ['9', "9'en"], '10': ['10', "10'en"], J: ['Boer', 'Boeren'], Q: ['Vrouw', 'Vrouwen'], K: ['Heer', 'Heren'], A: ['Aas', 'Azen']
};
const RT_SUIT = { '♠': 'schoppen', '♥': 'harten', '♦': 'ruiten', '♣': 'klaveren' };
const RT_RELATION = {
  sameRank: 'met dezelfde waarde', sameSuit: 'van hetzelfde symbool',
  sameColor: 'van dezelfde kleur', consecutive: 'met opeenvolgende waarden'
};
const RT_NUMBER = { 1: 'één', 2: 'twee', 3: 'drie', 4: 'vier', 5: 'vijf', 6: 'zes', 7: 'zeven', 8: 'acht' };

const rtList = v => Array.isArray(v) ? v : [v];

// "a", "a of b", "a, b of c"
function rtJoin(items, word){
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' ' + word + ' ' + items[items.length - 1];
}
const rtUpper = t => t.charAt(0).toUpperCase() + t.slice(1);

// Een keuze van kaarten als zinsdelen:
//   single: de kaart als zinsdeel ("een 2", "de hoogste kaart"); in een bijzin staat het werkwoord erna ("er een 2 ligt")
//   plural: de kaarten als onderwerp, met een meervoudig werkwoord ("kaarten met een 2")
//   verbSingular: true als het onderwerp één kaart is ("de hoogste kaart wint")
function rtCards(node){
  if ('rank' in node){
    const r = rtList(node.rank);
    return {
      single: rtJoin(r.map(x => 'een ' + RT_RANK[x][0]), 'of'),
      plural: 'kaarten met ' + rtJoin(r.map(x => 'een ' + RT_RANK[x][0]), 'of'),
      bare: rtJoin(r.map(x => RT_RANK[x][0]), 'of'), barePlural: rtJoin(r.map(x => RT_RANK[x][1]), 'of')
    };
  }
  if ('suit' in node){
    const names = rtJoin(rtList(node.suit).map(x => RT_SUIT[x]), 'of');
    return { single: 'een kaart van ' + names, plural: 'kaarten van ' + names, bare: 'kaart van ' + names, barePlural: 'kaarten van ' + names };
  }
  if ('color' in node){
    const adj = node.color === 'red' ? 'rode' : 'zwarte';
    return { single: 'een ' + adj + ' kaart', plural: adj + ' kaarten', bare: adj + ' kaart', barePlural: adj + ' kaarten' };
  }
  if ('all' in node) return { single: 'een kaart', plural: 'alle kaarten', bare: 'kaart', barePlural: 'kaarten' };
  if ('highest' in node || 'lowest' in node){
    const high = 'highest' in node, kind = high ? node.highest : node.lowest, word = high ? 'hoogste' : 'laagste';
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
  }
  if ('group' in node){
    const g = node.group, rel = RT_RELATION[g.relation];
    const what = 'een groep van minstens ' + g.min + ' kaarten ' + rel;
    return { single: what, plural: 'de kaarten van de hoogste groep van minstens ' + g.min + ' kaarten ' + rel, bare: 'groep', barePlural: 'groepen' };
  }
  if ('not' in node){
    const x = rtCards(node.not);
    const many = 'kaarten die geen ' + x.bare + ' zijn';
    return { single: 'een kaart die geen ' + x.bare + ' is', plural: many, bare: 'kaart die geen ' + x.bare + ' is', barePlural: many };
  }
  if ('or' in node){
    const xs = node.or.map(rtCards);
    const many = rtJoin(xs.map(x => x.barePlural), 'of');
    return { single: rtJoin(xs.map(x => x.single), 'of'), plural: many, bare: rtJoin(xs.map(x => x.bare), 'of'), barePlural: many };
  }
  // and: de kaarten die aan alle eisen tegelijk voldoen: "kaart van harten die ook een Heer is en ook geen Aas is"
  const xs = node.and.map(rtCards);
  const [a, ...rest] = xs, restNodes = node.and.slice(1);
  const one = rest.map((o, i) => ('not' in restNodes[i] ? 'geen ' + rtCards(restNodes[i].not).bare : o.single) + ' is');
  const many = rest.map((o, i) => ('not' in restNodes[i] ? 'geen ' + rtCards(restNodes[i].not).barePlural : o.barePlural) + ' zijn');
  const bare = a.bare + ' die ook ' + one.join(' en ook ');
  const plural = a.barePlural + ' die ook ' + many.join(' en ook ');
  return { single: 'een ' + bare, plural, bare, barePlural: plural };
}

// Een keuze van spelers, als zinsdeel. forEach: "elke speler ..."; anders "de spelers ...".
function rtPlayer(node, forEach){
  if (node === 'winner') return 'de winnaar';
  if ('withoutCards' in node) return forEach ? 'elke speler zonder kaarten' : 'de spelers zonder kaarten';
  if ('neighbor' in node) return (node.neighbor === 'left' ? 'de linkerbuur' : 'de rechterbuur') + ' met kaarten';
  const c = rtCards(node.opened);
  const other = node.exclude === 'winner' ? 'andere ' : '';
  return forEach ? 'elke ' + other + 'speler die de ronde begon met ' + c.single
    : 'de ' + other + 'spelers die de ronde begonnen met ' + c.single;
}

// Een aantal in een bijzin, met het werkwoord achteraan: "er minstens twee Azen liggen", "geen enkele speler kaarten heeft".
// o: pre (begin), sing/plural (het naamwoord bij 1 en bij meer), vs/vp (werkwoord bij 1 en bij meer), none (de zin bij 0).
// Staat er een getal boven de 8 in, dan staan alle getallen als cijfer, zodat woorden en cijfers niet door elkaar staan.
function rtAmount(node, o){
  const lo = node.min, hi = node.max;
  const digits = [lo, hi].some(v => v !== undefined && v > 8);
  const n = v => (digits ? String(v) : v === 0 ? 'nul' : v === 1 ? 'één' : RT_NUMBER[v]);
  const unit = v => (v === 1 ? o.sing : o.plural), verb = v => (v === 1 ? o.vs : o.vp);
  if (hi === 0 && (lo === undefined || lo === 0)) return o.none;
  if (lo !== undefined && hi !== undefined){
    if (lo === hi) return o.pre + 'precies ' + n(lo) + ' ' + unit(lo) + ' ' + verb(lo);
    return o.pre + 'tussen ' + n(lo) + ' en ' + n(hi) + ' ' + o.plural + ' ' + o.vp;
  }
  if (lo !== undefined) return o.pre + 'minstens ' + n(lo) + ' ' + unit(lo) + ' ' + verb(lo);
  return o.pre + 'ten hoogste ' + n(hi) + ' ' + unit(hi) + ' ' + verb(hi);
}

// Een voorwaarde als bijzin, met het werkwoord achteraan (hij staat na "Als"): "er een 2 ligt", "er minstens twee Azen liggen".
function rtCondition(node){
  const wrap = n => ('and' in n || 'or' in n) ? '(' + rtCondition(n) + ')' : rtCondition(n);
  if ('exists' in node){ const c = rtCards(node.exists); return 'er ' + (c.cond || c.single) + ' ligt'; }
  if ('count' in node){
    const c = rtCards(node.count);
    return rtAmount(node, { pre: 'er ', sing: c.bare, plural: c.barePlural, vs: 'ligt', vp: 'liggen', none: 'er geen ' + c.barePlural + ' liggen' });
  }
  if ('battle' in node) return 'er een battle is geweest';
  if ('winnerOpened' in node) return 'de winnaar de ronde met ' + rtCards(node.winnerOpened).single + ' begon';
  if ('anyPlayer' in node){
    const p = node.anyPlayer;
    if (p === 'winner') return 'er een winnaar is';
    if ('withoutCards' in p) return 'er een speler zonder kaarten is';
    return 'er een ' + (p.exclude === 'winner' ? 'andere ' : '') + 'speler is die de ronde met ' + rtCards(p.opened).single + ' begon';
  }
  if ('playersWithCards' in node)
    return rtAmount(node.playersWithCards, { pre: '', sing: 'speler kaarten', plural: 'spelers kaarten', vs: 'heeft', vp: 'hebben', none: 'geen enkele speler kaarten heeft' });
  if ('not' in node) return 'het niet zo is dat ' + wrap(node.not);
  if ('and' in node) return rtJoin(node.and.map(wrap), 'en');
  return rtJoin(node.or.map(wrap), 'of');
}

// Een gevolg in drie delen: onderwerp (s), persoonsvorm (v) en de rest (r).
// Na "dan" komt de persoonsvorm eerst: "dan gaat de hele pot naar de aflegstapel".
function rtEffect(node){
  if ('discardPot' in node) return {s:'de hele pot', v:'gaat', r:'naar de aflegstapel'};
  if ('sharePot' in node){
    const who = node.sharePot.map(p => rtPlayer(p, false));
    return {s:'de pot', v:'wordt', r:'verdeeld over ' + rtJoin(who, 'en') + ', de hoogste kaart eerst'};
  }
  if ('transfer' in node){
    const t = node.transfer, n = t.count === 1 ? '1 kaart' : t.count + ' kaarten';
    const from = 'neighbor' in t.from ? rtPlayer(t.from, false)
      : 'de eerste speler die de ronde begon met ' + rtCards(t.from.opened).single;
    return {s:rtPlayer(node.forEach, true), v:'krijgt', r:n + ' van ' + from};
  }
  return {s:rtPlayer(node.forEach, true), v:'legt',
    r:(node.discardTop === 1 ? 'zijn bovenste kaart' : 'zijn bovenste ' + node.discardTop + ' kaarten') + ' af'};
}

// De hele regel als zin(nen). Geeft '' als de beschrijving niet klopt (zie validateRuleLogic).
function describeRuleLogic(logic){
  if (validateRuleLogic(logic).length) return '';
  const m = logic.moment, then = logic.then;
  const cond = 'if' in logic ? rtCondition(logic.if) : null;
  if ('win' in then){
    const x = rtCards(then.win), verb = x.verbSingular ? 'wint' : 'winnen';
    if (m === 'tiebreak') return 'Bij een gelijkspel' + (cond ? ', als ' + cond + ', dan' : '') + (x.verbSingular ? ' wint ' + x.single : ' winnen ' + x.plural) + '.';
    const s = cond ? 'Als ' + cond + ', dan ' + verb + ' ' + x.plural + '.' : rtUpper(x.plural) + ' ' + verb + '.';
    return s + ' Bij gelijk spel: BATTLE!';
  }
  const e = rtEffect(then);
  if (m === 'roundEnd') return cond
    ? 'Aan het einde van de ronde, als ' + cond + ', dan ' + e.v + ' ' + e.s + ' ' + e.r + '.'
    : 'Aan het einde van de ronde ' + e.v + ' ' + e.s + ' ' + e.r + '.';
  return cond
    ? 'Als ' + cond + ', dan ' + e.v + ' ' + e.s + ' ' + e.r + '.'
    : rtUpper(e.s) + ' ' + e.v + ' ' + e.r + '.';
}

// ---- de keuzes voor de regelbouwer ----

const RULE_MOMENTS = [
  { id: 'decide', label: 'Bij het bepalen van de winnaar' },
  { id: 'tiebreak', label: 'Bij een gelijkspel' },
  { id: 'award', label: 'Als de pot wordt toegekend' },
  { id: 'roundEnd', label: 'Aan het einde van de ronde' }
];

const RT_ALL = ['decide', 'tiebreak', 'award', 'roundEnd'];
// De eerste twee voorwaarden die bij een moment passen (voor voorbeelden van "en" en "of").
const RT_SIMPLE_IF = {
  decide: [{ exists: { rank: 'A' } }, { count: { rank: '2' }, min: 2 }], tiebreak: [{ exists: { rank: 'A' } }, { count: { rank: '2' }, min: 2 }],
  award: [{ battle: true }, { winnerOpened: { rank: 'K' } }], roundEnd: [{ anyPlayer: { withoutCards: true } }, { playersWithCards: { min: 2 } }]
};

// sample: een voorbeeld dat bij de controle klopt (voor de tests); bij een samengestelde voorwaarde een functie van het moment.
const RULE_BLOCKS = {
  conditions: [
    { key: 'exists', label: 'er ligt een bepaalde kaart', moments: ['decide', 'tiebreak'], sample: { exists: { rank: 'A' } } },
    { key: 'count', label: 'er liggen een bepaald aantal kaarten van een soort', moments: ['decide', 'tiebreak'], sample: { count: { rank: 'A' }, min: 2 } },
    { key: 'battle', label: 'er is een battle geweest', moments: ['award'], sample: { battle: true } },
    { key: 'winnerOpened', label: 'de winnaar begon met een bepaalde kaart', moments: ['award'], sample: { winnerOpened: { rank: 'K' } } },
    { key: 'anyPlayer', label: 'er is een speler die …', moments: ['award', 'roundEnd'], sample: { anyPlayer: { withoutCards: true } } },
    { key: 'playersWithCards', label: 'een bepaald aantal spelers heeft kaarten', moments: ['award', 'roundEnd'], sample: { playersWithCards: { min: 2 } } },
    { key: 'and', label: 'al deze voorwaarden gelden', moments: RT_ALL, sample: m => ({ and: RT_SIMPLE_IF[m] }) },
    { key: 'or', label: 'minstens één van deze voorwaarden geldt', moments: RT_ALL, sample: m => ({ or: RT_SIMPLE_IF[m] }) },
    { key: 'not', label: 'deze voorwaarde geldt niet', moments: RT_ALL, sample: m => ({ not: RT_SIMPLE_IF[m][0] }) }
  ],
  effects: [
    { key: 'win', label: 'deze spelers winnen', moments: ['decide', 'tiebreak'], sample: { win: { rank: '2' } } },
    { key: 'discardPot', label: 'de hele pot gaat naar de aflegstapel', moments: ['award'], sample: { discardPot: true } },
    { key: 'sharePot', label: 'de pot wordt verdeeld over deze spelers', moments: ['award'], sample: { sharePot: ['winner', { opened: { rank: 'Q' }, exclude: 'winner' }] } },
    { key: 'transfer', label: 'elke speler krijgt kaarten van een andere speler', moments: ['roundEnd'], sample: { forEach: { withoutCards: true }, transfer: { from: { neighbor: 'left' }, count: 1 } } },
    { key: 'discardTop', label: 'elke speler legt kaarten af', moments: ['roundEnd'], sample: { forEach: { opened: { rank: 'K' } }, discardTop: 1 } }
  ],
  // Keuzes van kaarten. cards: wat er bij "deze spelers winnen" en bij tellen kan (ook de hoogste en groepen); singleCards: wat er
  // bij "begon met een kaart" kan (één soort kaart).
  cards: [
    { key: 'rank', label: 'kaarten met een bepaalde waarde', sample: { rank: 'K' } },
    { key: 'suit', label: 'kaarten van een bepaald symbool', sample: { suit: '♥' } },
    { key: 'color', label: 'rode of zwarte kaarten', sample: { color: 'red' } },
    { key: 'all', label: 'alle kaarten', sample: { all: true } },
    { key: 'highest', label: 'de hoogste kaart (op waarde of symbool)', sample: { highest: 'value' } },
    { key: 'lowest', label: 'de laagste kaart (op waarde of symbool)', sample: { lowest: 'value' } },
    { key: 'group', label: 'de hoogste groep kaarten die bij elkaar horen', sample: { group: { relation: 'sameRank', min: 2, pick: 'highest' } } },
    { key: 'and', label: 'kaarten die aan al deze eisen voldoen', sample: { and: [{ color: 'red' }, { rank: 'K' }] } },
    { key: 'or', label: 'kaarten die aan een van deze eisen voldoen', sample: { or: [{ rank: 'K' }, { rank: 'Q' }] } },
    { key: 'not', label: 'kaarten die hier niet bij horen', sample: { not: { rank: 'K' } } }
  ],
  singleCards: ['rank', 'suit', 'color', 'and', 'or', 'not'],
  // Keuzes van spelers en de plekken waar ze passen: sharePot (pot verdelen), forEach (wie het overkomt), anyPlayer (voorwaarde),
  // from (van wie kaarten komen).
  players: [
    { key: 'winner', label: 'de winnaar', sample: 'winner', slots: ['sharePot', 'anyPlayer'], moments: ['award'] },
    // excludeMoments: waar "behalve de winnaar" (exclude: 'winner') kan; de winnaar bestaat alleen bij award
    { key: 'opened', label: 'spelers die de ronde met een bepaalde kaart begonnen', sample: { opened: { rank: 'Q' } }, slots: ['sharePot', 'forEach', 'anyPlayer', 'from'], moments: RT_ALL, excludeMoments: ['award'] },
    { key: 'withoutCards', label: 'spelers zonder kaarten', sample: { withoutCards: true }, slots: ['sharePot', 'forEach', 'anyPlayer'], moments: RT_ALL },
    { key: 'neighbor', label: 'de linker- of rechterbuur met kaarten', sample: { neighbor: 'left' }, slots: ['from'], moments: RT_ALL }
  ],
  // Bij welk moment elke plek voor spelers bestaat.
  playerSlots: { sharePot: ['award'], forEach: ['roundEnd'], anyPlayer: ['award', 'roundEnd'], from: ['roundEnd'] }
};

function ruleBlockSample(block, moment){
  return typeof block.sample === 'function' ? block.sample(moment) : block.sample;
}

// De keuzes die bij een moment passen, met hun Nederlandse naam.
function ruleChoicesFor(moment){
  const pick = b => ({ key: b.key, label: b.label });
  return {
    moment: RULE_MOMENTS.find(m => m.id === moment) || null,
    conditions: RULE_BLOCKS.conditions.filter(b => b.moments.includes(moment)).map(pick),
    effects: RULE_BLOCKS.effects.filter(b => b.moments.includes(moment)).map(pick),
    cards: RULE_BLOCKS.cards.map(pick),
    singleCards: RULE_BLOCKS.cards.filter(b => RULE_BLOCKS.singleCards.includes(b.key)).map(pick)
  };
}

// De keuzes van spelers die op een plek passen (sharePot, forEach, anyPlayer of from). Met een moment erbij alleen de keuzes die bij dat
// moment horen ("de winnaar" bestaat alleen bij award).
function rulePlayerChoices(slot, moment){
  return RULE_BLOCKS.players.filter(b => b.slots.includes(slot) && (!moment || b.moments.includes(moment))).map(b => ({ key: b.key, label: b.label }));
}
