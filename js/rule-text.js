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

const RT_RANK = {
  '2': ['2', "2's"], '3': ['3', "3's"], '4': ['4', "4's"], '5': ['5', "5's"], '6': ['6', "6's"], '7': ['7', "7's"], '8': ['8', "8's"],
  '9': ['9', "9's"], '10': ['10', "10's"], J: ['Boer', 'Boeren'], Q: ['Vrouw', 'Vrouwen'], K: ['Heer', 'Heren'], A: ['Aas', 'Azen']
};
const RT_SUIT = { '♠': 'schoppen', '♥': 'harten', '♦': 'ruiten', '♣': 'klaveren' };
const RT_RELATION = {
  sameRank: 'kaarten met dezelfde waarde', sameSuit: 'kaarten van hetzelfde symbool',
  sameColor: 'kaarten van dezelfde kleur', consecutive: 'kaarten met opeenvolgende waarden'
};

const rtList = v => Array.isArray(v) ? v : [v];

// "a", "a of b", "a, b of c"
function rtJoin(items, word){
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' ' + word + ' ' + items[items.length - 1];
}

// Een keuze van kaarten als zinsdeel. one: "een Heer", bare: "Heer" (zonder lidwoord), many: "Heren".
// Bij een keuze die er één uit haalt (de hoogste, een groep) staat dat in sel of group.
function rtCards(node){
  if ('rank' in node){
    const r = rtList(node.rank);
    return { one: rtJoin(r.map(x => 'een ' + RT_RANK[x][0]), 'of'), bare: rtJoin(r.map(x => RT_RANK[x][0]), 'of'), many: rtJoin(r.map(x => RT_RANK[x][1]), 'of') };
  }
  if ('suit' in node){
    const names = rtJoin(rtList(node.suit).map(x => RT_SUIT[x]), 'of');
    return { one: 'een kaart van ' + names, bare: 'kaart van ' + names, many: 'kaarten van ' + names };
  }
  if ('color' in node){
    const adj = node.color === 'red' ? 'rode' : 'zwarte';
    return { one: 'een ' + adj + ' kaart', bare: adj + ' kaart', many: adj + ' kaarten' };
  }
  if ('all' in node) return { one: 'een kaart', bare: 'kaart', many: 'kaarten' };
  if ('not' in node){
    const x = rtCards(node.not);
    return { one: 'een kaart die geen ' + x.bare + ' is', bare: 'kaart die geen ' + x.bare + ' is', many: 'kaarten die geen ' + x.bare + ' zijn' };
  }
  if ('or' in node){
    const xs = node.or.map(rtCards);
    return { one: rtJoin(xs.map(x => x.one), 'of'), bare: rtJoin(xs.map(x => x.bare), 'of'), many: rtJoin(xs.map(x => x.many), 'of') };
  }
  if ('and' in node){
    // "kaart van harten die ook een Heer is en ook geen Aas is"; een "niet" erbij wordt "geen ... is"
    const [a, ...rest] = node.and.map(rtCards);
    const restNodes = node.and.slice(1);
    const one = rest.map((o, i) => ('not' in restNodes[i] ? 'geen ' + rtCards(restNodes[i].not).bare : o.one) + ' is');
    const many = rest.map((o, i) => ('not' in restNodes[i] ? 'geen ' + rtCards(restNodes[i].not).many : o.many) + ' zijn');
    const bare = a.bare + ' die ook ' + one.join(' en ook ');
    return { one: 'een ' + bare, bare, many: a.many + ' die ook ' + many.join(' en ook ') };
  }
  if ('highest' in node || 'lowest' in node){
    const high = 'highest' in node, kind = high ? node.highest : node.lowest, word = high ? 'hoogste' : 'laagste';
    let p = kind === 'value' ? 'de ' + word + ' kaart' : 'het ' + word + ' symbool';
    if ('of' in node) p += ' onder de ' + rtCards(node.of).many;
    const be = kind === 'value' ? ['is', 'zijn'] : ['heeft', 'hebben'];
    // player: voor "de spelers met ..."; one/bare/many: voor "er ligt een kaart die ..." (tellen en voorwaarden)
    return { one: 'een kaart die ' + p + ' ' + be[0], bare: 'kaart die ' + p + ' ' + be[0], many: 'kaarten die ' + p + ' ' + be[1], sel: true, player: p };
  }
  // group
  const g = node.group, rel = RT_RELATION[g.relation];
  return { one: 'een groep van minstens ' + g.min + ' ' + rel, bare: 'groep van minstens ' + g.min + ' ' + rel, many: 'groepen van minstens ' + g.min + ' ' + rel,
    group: 'de hoogste groep van minstens ' + g.min + ' ' + rel };
}

// "de spelers met een Heer" (single: "de speler met een Heer", als er maar één kan winnen)
function rtPlayersWith(node, single){
  if ('all' in node) return 'alle spelers';
  const p = rtCards(node);
  if (p.group) return 'de spelers in ' + p.group;
  return (single ? 'de speler' : 'de spelers') + ' met ' + (p.sel ? p.player : p.one);
}

// Een keuze van spelers bij award en roundEnd.
function rtPlayer(node, forEach){
  if (node === 'winner') return 'de winnaar';
  if ('withoutCards' in node) return forEach ? 'elke speler zonder kaarten' : 'alle spelers zonder kaarten';
  if ('neighbor' in node) return node.neighbor === 'left' ? 'de linkerbuur met kaarten' : 'de rechterbuur met kaarten';
  const c = rtCards(node.opened);
  const other = node.exclude === 'winner' ? 'andere ' : '';
  return forEach ? 'elke ' + other + 'speler die de ronde begon met ' + c.one : 'alle ' + other + 'spelers die de ronde begonnen met ' + c.one;
}

function rtRange(node, noun1, nounN, verb1, verbN, subject){
  // "minstens 2 Azen liggen", "precies één Aas ligt", "geen Azen liggen", "tussen 1 en 3 Azen liggen"
  const lo = node.min, hi = node.max, has = x => x !== undefined;
  const num = n => n === 1 ? 'één ' + noun1 : n + ' ' + nounN;
  const verb = n => n === 1 ? verb1 : verbN;
  const none = subject + 'geen ' + nounN + ' ' + verbN;
  if (has(lo) && has(hi)){
    if (lo === hi) return lo === 0 ? none : subject + 'precies ' + num(lo) + ' ' + verb(lo);
    return subject + 'tussen ' + lo + ' en ' + hi + ' ' + nounN + ' ' + verbN;
  }
  if (has(lo)) return subject + 'minstens ' + num(lo) + ' ' + verb(lo);
  return hi === 0 ? none : subject + 'ten hoogste ' + num(hi) + ' ' + verb(hi);
}

// Een voorwaarde als bijzin (werkwoord achteraan): "er een Aas ligt".
function rtCondition(node){
  const wrap = n => ('and' in n || 'or' in n) ? '(' + rtCondition(n) + ')' : rtCondition(n);
  if ('exists' in node) return 'er ' + rtCards(node.exists).one + ' ligt';
  if ('count' in node){
    const c = rtCards(node.count);
    return rtRange(node, c.bare, c.many, 'ligt', 'liggen', 'er ');
  }
  if ('battle' in node) return 'er een battle is geweest';
  if ('winnerOpened' in node) return 'de winnaar de ronde begon met ' + rtCards(node.winnerOpened).one;
  if ('anyPlayer' in node){
    const p = node.anyPlayer;
    if (p === 'winner') return 'er een winnaar is';
    if ('withoutCards' in p) return 'er een speler zonder kaarten is';
    return 'er een ' + (p.exclude === 'winner' ? 'andere ' : '') + 'speler is die de ronde begon met ' + rtCards(p.opened).one;
  }
  if ('playersWithCards' in node){
    const r = node.playersWithCards;
    if (r.max === 0 && (r.min === undefined || r.min === 0)) return 'geen enkele speler kaarten heeft';
    return rtRange(r, 'speler', 'spelers', 'kaarten heeft', 'kaarten hebben', '');
  }
  if ('not' in node) return 'het niet zo is dat ' + wrap(node.not);
  if ('and' in node) return rtJoin(node.and.map(wrap), 'en');
  return rtJoin(node.or.map(wrap), 'of');
}

// Een gevolg met het werkwoord vooraan (na "dan" of "Altijd"): "winnen de spelers met een 2".
function rtEffect(node, moment){
  if ('win' in node) return moment === 'tiebreak' ? 'wint ' + rtPlayersWith(node.win, true) : 'winnen ' + rtPlayersWith(node.win, false);
  if ('discardPot' in node) return 'gaat de hele pot naar de aflegstapel';
  if ('sharePot' in node) return 'wordt de pot verdeeld over ' + rtJoin(node.sharePot.map(p => rtPlayer(p, false)), 'en') + ', de hoogste kaart eerst';
  if ('transfer' in node){
    const t = node.transfer, n = t.count === 1 ? '1 kaart' : t.count + ' kaarten';
    const from = 'neighbor' in t.from ? rtPlayer(t.from, false) : 'de eerste speler die de ronde begon met ' + rtCards(t.from.opened).one;
    return 'krijgt ' + rtPlayer(node.forEach, true) + ' ' + n + ' van ' + from;
  }
  return 'legt ' + rtPlayer(node.forEach, true) + ' ' + (node.discardTop === 1 ? 'zijn bovenste kaart' : 'zijn bovenste ' + node.discardTop + ' kaarten') + ' af';
}

// De hele regel als zin(nen). Geeft '' als de beschrijving niet klopt (zie validateRuleLogic).
function describeRuleLogic(logic){
  if (validateRuleLogic(logic).length) return '';
  const m = logic.moment, eff = rtEffect(logic.then, m);
  let s;
  if ('if' in logic){
    const cond = rtCondition(logic.if);
    s = (m === 'tiebreak' ? 'Bij een gelijkspel: als ' : m === 'roundEnd' ? 'Aan het einde van de ronde: als ' : 'Als ') + cond + ', dan ' + eff + '.';
  } else {
    s = (m === 'tiebreak' ? 'Bij een gelijkspel ' : m === 'roundEnd' ? 'Aan het einde van de ronde ' : 'Altijd ') + eff + '.';
  }
  if (m === 'decide') s += ' Zijn het er meer dan één, dan battlen zij.';
  return s;
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
