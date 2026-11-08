// Rooktest zonder browser en zonder externe pakketten: node tests/smoke.js [map] [--update]
//
// 1. Laadt de scripts uit index.html in dezelfde volgorde als de browser, op een nagebootste
//    pagina. Een fout bij het laden (bijv. verkeerde volgorde) laat de test falen.
// 2. Deelt een aantal vaste seeds en vergelijkt de simulatie met tests/expected.json:
//    uitkomst (winst/cyclus/onbekend), aantal rondes en aantal kaarten per speler.
// 3. Speelt de spellen die eindigen ook "live" uit en controleert dat het zichtbare spel op
//    dezelfde eindstand uitkomt als de simulatie.
//
// Wijzig je bewust een spelregel? Draai dan `node tests/smoke.js --update` en bekijk in de
// pull request het verschil in tests/expected.json: dat is precies wat de regel verandert.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const update = args.includes('--update');
const root = path.resolve(args.find(a => !a.startsWith('--')) || path.join(__dirname, '..'));
const expectedFile = path.join(__dirname, 'expected.json');

// ---- nagebootste pagina ----
const els = {};
function makeEl(id){
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', innerText: '', disabled: false,
    style: {}, dataset: {}, className: '', children: [],
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(){}, appendChild(c){ this.children.push(c); }, remove(){}, focus(){}, select(){}, setAttribute(){},
    querySelectorAll(){ return this.children; },
    getContext(){ return new Proxy({}, { get: () => () => {}, set: () => true }); },
    toDataURL(){ return ''; }
  };
}
const document = {
  getElementById(id){ return els[id] || (els[id] = makeEl(id)); },
  createElement(){ return makeEl(); },
  addEventListener(){},
  querySelectorAll(){ return []; }
};
const ctx = vm.createContext({
  document, console, Math, JSON, Set, Map, Array, Object, Promise, parseInt,
  setTimeout(){ return 0; }, clearTimeout(){}, requestAnimationFrame(){ return 0; }
});

// ---- scripts laden in de volgorde van index.html ----
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
if (scripts.length === 0){ console.error('Geen <script src> gevonden in index.html'); process.exit(1); }
for (const src of scripts){
  try {
    vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), ctx, { filename: src });
  } catch (e){
    console.error('FOUT bij het laden van ' + src + ': ' + e.message);
    process.exit(1);
  }
}
const run = code => vm.runInContext(code, ctx);

// Klik-loop waarin we het zichtbare spel uitspelen (zonder tekenen te testen).
function playLive(){
  return run(`(() => {
    launchGame();
    let i = 0;
    while (phase !== 'game-over' && phase !== 'cycle-over' && i < 20000){ advance(); i++; }
    return { phase, decks: players.map(p => p.deck.length) };
  })()`);
}

// Regelcombinaties, afgeleid uit de catalogus RULES (rules.js): alle combinaties van aan/uit.
// De namen zijn de sleutels in tests/expected.json: 'standard' (geen extra regels) of de ids van
// de regels die aan staan, in catalogusvolgorde, gescheiden door '+'.
const CATALOG = JSON.parse(run(`JSON.stringify(RULES.map(r => ({
  id: r.id, priority: r.priority, title: r.title, short: r.short, description: r.description,
  default: r.default, examples: r.examples, hasDecide: typeof r.decide === 'function' })))`));
const BASE = JSON.parse(run('JSON.stringify(BASE_RULES)'));
const RULE_IDS = CATALOG.map(r => r.id);
const RULE_SETS = {};
for (let mask = 0; mask < (1 << RULE_IDS.length); mask++){
  const on = RULE_IDS.filter((id, i) => mask & (1 << i));
  const sets = {};
  for (const id of RULE_IDS) sets[id] = on.includes(id);
  RULE_SETS[on.length ? on.join('+') : 'standard'] = sets;
}
const failures = [];
let exampleCount = 0;

// ---- de catalogus zelf ----
const isText = t => typeof t === 'string' && t.trim().length > 0;
const defaultRules = JSON.parse(run('JSON.stringify(DEFAULT_RULES)'));
if (JSON.stringify(Object.keys(defaultRules)) !== JSON.stringify(RULE_IDS)) failures.push('DEFAULT_RULES en RULES hebben niet dezelfde regels');
if (new Set(RULE_IDS).size !== RULE_IDS.length) failures.push('catalogus: dubbele regel-id');
if (new Set(CATALOG.map(r => r.priority)).size !== CATALOG.length) failures.push('catalogus: twee regels met dezelfde prioriteit (de volgorde is dan onduidelijk)');
for (const r of CATALOG){
  for (const f of ['id', 'title', 'short', 'description']) if (!isText(r[f])) failures.push('catalogus ' + r.id + ': ' + f + ' ontbreekt');
  if (!Number.isFinite(r.priority)) failures.push('catalogus ' + r.id + ': priority ontbreekt');
  if (typeof r.default !== 'boolean') failures.push('catalogus ' + r.id + ': default moet true of false zijn');
  if (!r.hasDecide) failures.push('catalogus ' + r.id + ': decide ontbreekt');
  if (!Array.isArray(r.examples) || r.examples.length === 0) failures.push('catalogus ' + r.id + ': minstens één voorbeeld nodig (die laten zien en testen wat de regel doet)');
}

// ---- directe regeltests (findWinningPlayers en spelkern) ----
// Elke regel: [kaarten die open liggen, regels, indexen van de spelers die (voorlopig) winnen]
run(`globalThis.__fw = (cards, rules) => findWinningPlayers(
  cards.map((c, i) => ({ id: i, faceCard: parseExampleCard(c) })), rules).map(p => p.id)`);
const OFF = RULE_SETS['standard'], TWO = RULE_SETS['twoBeatsAce'], BF = RULE_SETS['battleFirst'], BOTH = RULE_SETS['twoBeatsAce+battleFirst'];
const ruleTests = [
  ['A,3,3 zonder regel: Aas wint', ['A', '3', '3'], OFF, [0]],
  ['A,3,3 gelijke gaan voor: de drieën battlen', ['A', '3', '3'], BF, [1, 2]],
  ['A,3,3,7,7: hoogste paar battlet', ['A', '3', '3', '7', '7'], BF, [3, 4]],
  ['A,K,Q zonder paar: hoogste wint gewoon', ['A', 'K', 'Q'], BF, [0]],
  ['3,3,3,A: drie gelijke battlen samen', ['3', '3', '3', 'A'], BF, [0, 1, 2]],
  ['2 spelers A,3: geen verschil', ['A', '3'], BF, [0]],
  ['2 spelers A,A: gelijkspel', ['A', 'A'], BF, [0, 1]],
  ['2,A,K met 2-verslaat-Aas: de 2 wint van alles, ook van de K', ['2', 'A', 'K'], TWO, [0]],
  ['2,K zonder Aas: de 2 is gewoon de laagste kaart', ['2', 'K'], TWO, [1]],
  ['2,A,A met alleen 2-verslaat-Aas: de 2 wint', ['2', 'A', 'A'], TWO, [0]],
  ['2,A,A met beide regels: paar gaat voor', ['2', 'A', 'A'], BOTH, [1, 2]],
  ['2,A,7,7 met alleen 2-verslaat-Aas: de 2 wint', ['2', 'A', '7', '7'], TWO, [0]],
  ['2,A,7,7 met beide regels: paar gaat voor', ['2', 'A', '7', '7'], BOTH, [2, 3]],
  ['2,2,A met beide regels: de tweeën battlen', ['2', '2', 'A'], BOTH, [0, 1]]
];
// Kaarten in voorbeelden: 'A' of met kleur 'A♠'. Elke kaart moet een bestaande waarde hebben.
const validCard = c => { const p = JSON.parse(run('JSON.stringify(parseExampleCard(' + JSON.stringify(c) + '))')); return p.value >= 2 && p.value <= 14; };
const parsed = JSON.parse(run(`JSON.stringify([parseExampleCard('A'), parseExampleCard('10♥'), parseExampleCard('3♠')])`));
if (JSON.stringify(parsed) !== JSON.stringify([{ rank: 'A', suit: null, value: 14 }, { rank: '10', suit: '♥', value: 10 }, { rank: '3', suit: '♠', value: 3 }])) failures.push('parseExampleCard: ' + JSON.stringify(parsed));
for (const section of [...CATALOG.map(r => ({ name: r.title, ...r })), ...BASE.map(b => ({ name: b.title, ...b }))]){
  for (const f of ['title', 'description']) if (!isText(section[f])) failures.push('regelboek ' + section.name + ': ' + f + ' ontbreekt');
  for (const ex of section.examples || []){
    if (!ex.cards.every(validCard)) failures.push('voorbeeld bij "' + section.name + '": onbekende kaart in ' + JSON.stringify(ex.cards));
    if (!isText(ex.text) || !Array.isArray(ex.winners)) failures.push('voorbeeld bij "' + section.name + '": tekst of winnaars ontbreekt');
    if (ex.winners.some(i => i < 0 || i >= ex.cards.length)) failures.push('voorbeeld bij "' + section.name + '": winnaar buiten de kaarten');
  }
}
// De voorbeelden bij de basisregels (alle extra regels uit) tegen de echte regelcode.
for (const b of BASE){
  for (const ex of b.examples || []){
    exampleCount++;
    const off = {}; for (const id of RULE_IDS) off[id] = false;
    const got = run('__fw(' + JSON.stringify(ex.cards) + ', ' + JSON.stringify(off) + ')');
    if (JSON.stringify(got) !== JSON.stringify(ex.winners)) failures.push('voorbeeld bij basisregel "' + b.title + '" (' + ex.cards.join(',') + '): het regelboek zegt ' + JSON.stringify(ex.winners) + ', het spel doet ' + JSON.stringify(got));
  }
}

// ---- het regelboek is de catalogus ----
// Loop door de gebouwde elementen en verzamel tekst en klassen.
const walk = (node, fn) => { fn(node); for (const c of node.children || []) walk(c, fn); };
const textOf = node => { let t = ''; walk(node, n => { if (n.textContent) t += n.textContent + '\n'; }); return t; };
const byClass = (node, cls) => { const out = []; walk(node, n => { if ((n.className || '').split(' ').includes(cls)) out.push(n); }); return out; };
const activeNow = { twoBeatsAce: false, battleFirst: true };
const book = run('buildRulebook(RULES, BASE_RULES, ' + JSON.stringify(activeNow) + ')');
const bookText = textOf(book);
for (const b of BASE){
  if (!bookText.includes(b.title) || !bookText.includes(b.description)) failures.push('regelboek mist basisregel "' + b.title + '"');
}
const ruleBoxes = byClass(book, 'rb-rule');
if (ruleBoxes.length !== CATALOG.length) failures.push('regelboek: ' + ruleBoxes.length + ' extra regels getoond, de catalogus heeft er ' + CATALOG.length);
CATALOG.forEach((r, i) => {
  const box = ruleBoxes[i]; if (!box) return;
  const t = textOf(box);
  if (!t.includes(r.title) || !t.includes(r.description)) failures.push('regelboek: titel of uitleg van "' + r.title + '" ontbreekt');
  const badge = byClass(box, 'rb-badge')[0];
  if (!badge || badge.textContent !== (activeNow[r.id] ? 'aan' : 'uit')) failures.push('regelboek: aan/uit-markering van "' + r.title + '" klopt niet');
  const examples = byClass(box, 'rb-example');
  if (examples.length !== r.examples.length) failures.push('regelboek: ' + examples.length + ' voorbeelden bij "' + r.title + '", de catalogus heeft er ' + r.examples.length);
  r.examples.forEach((ex, k) => {
    const exBox = examples[k]; if (!exBox) return;
    const cards = byClass(exBox, 'rb-card').map(n => n.textContent);
    if (JSON.stringify(cards) !== JSON.stringify(ex.cards)) failures.push('regelboek: kaarten van voorbeeld ' + (k + 1) + ' bij "' + r.title + '" kloppen niet met de catalogus');
    const winners = byClass(exBox, 'rb-player').map((n, idx) => (n.className.split(' ').includes('rb-winner') ? idx : -1)).filter(idx => idx >= 0);
    if (JSON.stringify(winners) !== JSON.stringify(ex.winners)) failures.push('regelboek: winnaars van voorbeeld ' + (k + 1) + ' bij "' + r.title + '" kloppen niet');
    if (!textOf(exBox).includes(ex.text)) failures.push('regelboek: uitleg van voorbeeld ' + (k + 1) + ' bij "' + r.title + '" ontbreekt');
    for (const id of ex.with || []) if (!textOf(exBox).includes(CATALOG.find(c => c.id === id).title)) failures.push('regelboek: "met erbij" ontbreekt bij voorbeeld ' + (k + 1) + ' van "' + r.title + '"');
  });
});
// Volgorde bij botsingen: zoals de prioriteit in de catalogus.
const orderItems = byClass(book, 'rb-order-item').map(n => n.textContent.replace(/ \((aan|uit)\)$/, ''));
const expectedOrder = CATALOG.slice().sort((a, b) => a.priority - b.priority).map(r => r.title);
if (JSON.stringify(orderItems) !== JSON.stringify(expectedOrder)) failures.push('regelboek: volgorde bij botsingen ' + JSON.stringify(orderItems) + ' komt niet overeen met de prioriteit ' + JSON.stringify(expectedOrder));
// Kaartjes met kleur: een nagemaakte regel met voorbeeld in kleur (er is nog geen echte kleurregel).
const fake = [{ id: 'fake', priority: 1, title: 'Nagemaakt', short: 'x', description: 'y', default: false,
  examples: [{ cards: ['A♥', '3♠', '7'], winners: [0], text: 'z' }] }];
const fakeBook = run('buildRulebook(' + JSON.stringify(fake) + ', [], { fake: true })');
const fakeCards = byClass(fakeBook, 'rb-card');
if (JSON.stringify(fakeCards.map(n => n.textContent)) !== JSON.stringify(['A♥', '3♠', '7'])) failures.push('regelboek: kaarten met kleur worden verkeerd getoond: ' + JSON.stringify(fakeCards.map(n => n.textContent)));
if (JSON.stringify(fakeCards.map(n => n.className.split(' ').includes('red-suit'))) !== JSON.stringify([true, false, false])) failures.push('regelboek: alleen ♥ en ♦ horen rood te zijn');
// De bouwstenen staan in index.html (knoppen op beide schermen en het venster).
const pageHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['rulebookBtnSetup', 'rulebookBtnGame', 'rulebook', 'rulebookInner', 'rulebookBody', 'rulebookClose']) {
  if (!pageHtml.includes('id="' + id + '"')) failures.push('index.html mist het element met id ' + id);
}

// Het startscherm maakt één vinkje per regel, met het id dat dealNewGame uitleest en de korte tekst uit de catalogus.
const optionLabels = document.getElementById('rulesList').children;
if (optionLabels.length !== CATALOG.length) failures.push('startscherm: ' + optionLabels.length + ' vinkjes voor ' + CATALOG.length + ' regels');
CATALOG.forEach((r, i) => {
  const label = optionLabels[i];
  const input = label && label.children[0], text = label && label.children[1];
  if (!input || input.id !== r.id + 'Input' || input.type !== 'checkbox') failures.push('startscherm: vinkje voor ' + r.id + ' ontbreekt of heeft een verkeerd id');
  if (!text || text.textContent !== r.short) failures.push('startscherm: tekst bij het vinkje van ' + r.id + ' komt niet uit de catalogus');
});

// De voorbeelden uit de catalogus (die ook in het regelboek komen) tegen de echte regelcode.
for (const r of CATALOG){
  for (const ex of r.examples || []){
    exampleCount++;
    const rules = {};
    for (const id of RULE_IDS) rules[id] = id === r.id || (ex.with || []).includes(id);
    const got = run('__fw(' + JSON.stringify(ex.cards) + ', ' + JSON.stringify(rules) + ')');
    if (JSON.stringify(got) !== JSON.stringify(ex.winners)){
      failures.push('voorbeeld bij "' + r.title + '" (' + ex.cards.join(',') + (ex.with ? ' met ' + ex.with.join('+') : '') +
        '): het regelboek zegt ' + JSON.stringify(ex.winners) + ', het spel doet ' + JSON.stringify(got));
    }
  }
}
for (const [name, ranks, rules, exp] of ruleTests){
  const got = run('__fw(' + JSON.stringify(ranks) + ', ' + JSON.stringify(rules) + ')');
  if (JSON.stringify(got) !== JSON.stringify(exp)) failures.push('regeltest "' + name + '": verwacht ' + JSON.stringify(exp) + ', kreeg ' + JSON.stringify(got));
}
// De spelkern meldt wie er door het paar is overruled (voor de tekst op het scherm).
const engineEvent = battleFirst => JSON.parse(run(`(() => {
  const c = (rank, suit) => ({ rank, suit, value: RANKS.indexOf(rank) + 2 });
  const st = createGameState([
    { id: 0, name: 'a', deck: [c('A', '♠'), c('2', '♠')] }, { id: 1, name: 'b', deck: [c('3', '♠'), c('2', '♥')] },
    { id: 2, name: 'c', deck: [c('3', '♥'), c('2', '♦')] }, { id: 3, name: 'd', deck: [c('7', '♠'), c('2', '♣')] }
  ], { battleFirst: ${battleFirst} });
  engineStartRound(st);
  const ev = engineResolve(st);
  return JSON.stringify({ type: ev.type, winner: ev.winner && ev.winner.id, contenders: ev.contenders && ev.contenders.map(p => p.id), overruled: ev.overruled && ev.overruled.map(p => p.id) });
})()`));
const evOn = engineEvent(true), evOff = engineEvent(false);
if (JSON.stringify(evOn) !== JSON.stringify({ type: 'battle', contenders: [1, 2], overruled: [0] })) failures.push('spelkern met battleFirst: ' + JSON.stringify(evOn));
if (JSON.stringify(evOff) !== JSON.stringify({ type: 'win', winner: 0 })) failures.push('spelkern zonder battleFirst: ' + JSON.stringify(evOff));

// ---- testgevallen ----
const cases = [];
for (const n of [2, 3, 4, 6, 8]) for (const seed of ['1', '2', '3', '4', '5', '6']) for (const rules of Object.keys(RULE_SETS)) cases.push({ n, seed, rules });
const key = c => c.n + '|' + c.seed + '|' + c.rules;

const expected = update || !fs.existsSync(expectedFile) ? {} : JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
const actual = {};
let liveChecked = 0;

for (const c of cases){
  document.getElementById("seedInput").value = c.seed;
  document.getElementById("twoBeatsAceInput").checked = RULE_SETS[c.rules].twoBeatsAce;
  document.getElementById("battleFirstInput").checked = RULE_SETS[c.rules].battleFirst;
  document.getElementById("namesList").children = Array.from({ length: c.n }, () => ({ value: '' }));
  run('numPlayers = ' + c.n + '; dealNewGame();');
  const sim = JSON.parse(run(`(() => {
    const r = simulateFullTrace(players, SIM_ROUND_CAP, typeof game !== 'undefined' && game ? game.rules : undefined);
    return JSON.stringify({ outcome: r.outcome, rounds: r.rounds, decks: r.finalPlayers.map(p => p.deck.length) });
  })()`));
  actual[key(c)] = sim;

  if (!update){
    const exp = expected[key(c)];
    if (!exp) failures.push(key(c) + ': geen verwachte uitkomst in tests/expected.json');
    else if (JSON.stringify(exp) !== JSON.stringify(sim)){
      failures.push(key(c) + ': simulatie wijkt af\n    verwacht ' + JSON.stringify(exp) + '\n    kreeg    ' + JSON.stringify(sim));
    }
  }

  // Spellen die met een winnaar eindigen: het zichtbare spel moet hetzelfde eindresultaat geven.
  if (sim.outcome === 'win' && sim.rounds <= 1500){
    document.getElementById("seedInput").value = c.seed;
    run('numPlayers = ' + c.n + '; dealNewGame();');
    const live = playLive();
    liveChecked++;
    if (live.phase !== 'game-over' || JSON.stringify(live.decks) !== JSON.stringify(sim.decks)){
      failures.push(key(c) + ': zichtbaar spel wijkt af van simulatie\n    simulatie ' + JSON.stringify(sim.decks) + '\n    live      ' + live.phase + ' ' + JSON.stringify(live.decks));
    }
  }
}

if (update){
  fs.writeFileSync(expectedFile, JSON.stringify(actual, null, 1) + '\n');
  console.log('tests/expected.json bijgewerkt (' + cases.length + ' gevallen).');
  process.exit(0);
}
for (const k of Object.keys(expected)) if (!actual[k]) failures.push(k + ': staat in expected.json maar wordt niet meer getest');

console.log(scripts.length + ' scripts geladen, ' + CATALOG.length + ' regels + ' + BASE.length + ' basisregels in het regelboek (' + exampleCount + ' voorbeelden getest), ' +
  cases.length + ' seeds gesimuleerd, ' + liveChecked + ' spellen live uitgespeeld.');
if (failures.length){
  console.error('\n' + failures.length + ' fout(en):\n' + failures.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('Alles in orde.');
