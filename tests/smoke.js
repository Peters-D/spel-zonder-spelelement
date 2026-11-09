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
    classList: (() => { const set = new Set(); return { add(c){ set.add(c); }, remove(c){ set.delete(c); },
      toggle(c, force){ const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; }, contains(c){ return set.has(c); } }; })(),
    addEventListener(type, fn){ (this.handlers = this.handlers || {})[type] = fn; }, appendChild(c){ this.children.push(c); }, remove(){}, focus(){}, select(){}, setAttribute(){},
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
  default: r.default, examples: r.examples, hasDecide: typeof r.decide === 'function',
  hasHook: typeof r.onAward === 'function' || typeof r.onRoundEnd === 'function', usesDiscard: r.usesDiscard })))`));
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
  if (!r.hasDecide && !r.hasHook) failures.push('catalogus ' + r.id + ': een regel heeft een decide of een haak (onAward, onRoundEnd) nodig');
  if (r.usesDiscard !== undefined && typeof r.usesDiscard !== 'boolean') failures.push('catalogus ' + r.id + ': usesDiscard moet true of false zijn');
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
for (const id of ['rulebookBtnSetup', 'rulebookBtnGame', 'rulebook', 'rulebookInner', 'rulebookBody', 'rulebookClose', 'seedLine', 'cycleNewSeedBtn', 'discardPile', 'discardCount', 'discardNote', 'deckViewerSub']) {
  if (!pageHtml.includes('id="' + id + '"')) failures.push('index.html mist het element met id ' + id);
}

// ---- seed: de volgende seed en de knop "Nieuwe seed proberen" ----
const seedSteps = [['1000', '1001'], ['test', 'test2'], ['test2', 'test3'], ['test123', 'test124'], ['007', '008'], ['0099', '0100'],
  ['999', '1000'], ['  42 ', '43'], ['a1b', 'a1b2'], ['99999999999999999999', '100000000000000000000']];
for (const [from, to] of seedSteps){
  const got = run('nextSeed(' + JSON.stringify(from) + ')');
  if (got !== to) failures.push('nextSeed(' + JSON.stringify(from) + ') geeft ' + JSON.stringify(got) + ', verwacht ' + JSON.stringify(to));
}
for (const [r, exp] of [[0, '1000'], [0.5, '5500'], [0.9999, '9999']]){
  const got = run('nextSeed("", () => ' + r + ')');
  if (got !== exp) failures.push('nextSeed("") met random ' + r + ' geeft ' + got + ', verwacht ' + exp);
}
const chain = JSON.parse(run(`(() => { const out = []; let s = '1000'; for (let i = 0; i < 100; i++){ s = nextSeed(s); out.push(s); } return JSON.stringify(out); })()`));
if (new Set(chain).size !== 100) failures.push('nextSeed: de volgende seeds zijn niet allemaal verschillend');
// De seeds 1000 en 1001 geven een ander spel (andere verdeling).
const dealFor = seed => { document.getElementById('seedInput').value = seed; document.getElementById('namesList').children = Array.from({ length: 4 }, () => ({ value: '' }));
  return run('numPlayers = 4; dealNewGame(); JSON.stringify(players.map(p => p.deck.map(c => c.rank + c.suit)))'); };
if (dealFor('1000') === dealFor('1001')) failures.push('seed 1000 en 1001 geven dezelfde verdeling');
if (dealFor('1000') !== dealFor('1000')) failures.push('dezelfde seed geeft niet dezelfde verdeling');
// De knop zelf: kiest de volgende seed in het seedveld (zonder het spel te starten).
const seedBtn = document.getElementById('cycleNewSeedBtn');
const seedField = document.getElementById('seedInput');
if (!seedBtn.handlers || !seedBtn.handlers.click) failures.push('knop "Nieuwe seed proberen" heeft geen klik-actie');
else {
  seedField.value = '1000'; seedBtn.handlers.click();
  if (seedField.value !== '1001') failures.push('knop "Nieuwe seed proberen": 1000 werd ' + seedField.value + ', verwacht 1001');
  seedBtn.handlers.click();
  if (seedField.value !== '1002') failures.push('knop "Nieuwe seed proberen": tweede klik gaf ' + seedField.value + ', verwacht 1002');
  seedField.value = ''; seedBtn.handlers.click();
  if (!/^[1-9]\d{3}$/.test(seedField.value)) failures.push('knop "Nieuwe seed proberen" bij een leeg veld gaf "' + seedField.value + '", verwacht vier cijfers');
}
// Zonder seed (willekeurig spel) staat dat ook zo in het spelscherm.
seedField.value = ''; run('numPlayers = 4; dealNewGame(); launchGame();');
if (run('game.seed') !== null || !/geen/.test(document.getElementById('seedLine').textContent)) failures.push('spel zonder seed: seedregel is "' + document.getElementById('seedLine').textContent + '"');

// ---- aflegstapel ----
// Er is nog geen echte regel die kaarten aflegt; daarom gebruiken deze tests nagemaakte regels, die alleen tijdens
// deze tests in RULES staan. Ze bewijzen dat de aflegstapel klopt: kaarten gaan nooit verloren of dubbel, het spel
// blijft herhaalbaar, en simulatie, zichtbaar spel en fast-forward komen op dezelfde stand uit.
run(`globalThis.__card = (rank, suit) => ({ rank, suit, value: RANKS.indexOf(rank) + 2 });
globalThis.__names = cards => cards.map(c => c.rank + c.suit);
globalThis.__state = decks => createGameState(decks.map((d, i) => ({ id: i, name: 'S' + i, deck: d.map(x => __card(x[0], x[1])) })), {});`);
const names = expr => JSON.parse(run('JSON.stringify(__names(' + expr + '))'));

// 1. De handelingen: volgorde, tellers, terughalen naar een stapel of de pot.
run(`globalThis.__s = __state([['A♠', 'K♠', 'Q♠'], ['2♥', '3♥'], ['9♦'], ['5♣', '6♣']]);`);
run(`engineDiscardCards(__s, [__card('7', '♠'), __card('8', '♠'), __card('9', '♠')]);`);
if (JSON.stringify(names('__s.discard')) !== JSON.stringify(['9♠', '8♠', '7♠'])) failures.push('aflegstapel: de laatst afgelegde kaart hoort bovenop te liggen, kreeg ' + JSON.stringify(names('__s.discard')));
run(`engineDiscardFromDeck(__s, 0, 2);`); // A♠ en K♠ van de stapel van speler 0
if (JSON.stringify(names('__s.discard')) !== JSON.stringify(['K♠', 'A♠', '9♠', '8♠', '7♠']) || JSON.stringify(names('__s.players[0].deck')) !== JSON.stringify(['Q♠']))
  failures.push('aflegstapel: afleggen van de bovenste kaarten van een stapel klopt niet');
run(`engineReturnFromDiscard(__s, 2, { player: 1, position: 'bottom' });`); // K♠, A♠ terug, onderaan
if (JSON.stringify(names('__s.players[1].deck')) !== JSON.stringify(['2♥', '3♥', 'K♠', 'A♠']) || JSON.stringify(names('__s.discard')) !== JSON.stringify(['9♠', '8♠', '7♠']))
  failures.push('aflegstapel: terughalen onderaan een stapel klopt niet: ' + JSON.stringify(names('__s.players[1].deck')));
run(`engineReturnFromDiscard(__s, 2, { player: 2, position: 'top' });`); // 9♠, 8♠ terug, bovenop (9♠ bovenaan)
if (JSON.stringify(names('__s.players[2].deck')) !== JSON.stringify(['9♠', '8♠', '9♦'])) failures.push('aflegstapel: terughalen bovenop een stapel klopt niet: ' + JSON.stringify(names('__s.players[2].deck')));
run(`engineReturnFromDiscard(__s, 5, 'pot');`); // vraagt meer dan er ligt: alleen 7♠
if (JSON.stringify(names('__s.pot')) !== JSON.stringify(['7♠']) || run('__s.discard.length') !== 0) failures.push('aflegstapel: terughalen naar de pot of meer vragen dan er ligt klopt niet');
run(`engineDiscardCards(__s, [__card('4', '♦')]); __s.players[3].out = true;`);
if (run(`engineReturnFromDiscard(__s, 1, { player: 3 })`) !== 0 || run('__s.discard.length') !== 1) failures.push('aflegstapel: een uitgeschakelde speler hoort niets terug te krijgen');
if (JSON.stringify(run('__s.moved')) !== JSON.stringify({ discarded: 6, returned: 5 })) failures.push('aflegstapel: tellers kloppen niet: ' + JSON.stringify(run('__s.moved')));
// Een nieuwe spelstand begint met een lege aflegstapel.
if (run('createGameState([{ id: 0, name: "a", deck: [] }], {}).discard.length') !== 0) failures.push('aflegstapel: begint niet leeg');

// 2. De vingerafdruk (cycluscheck) neemt de aflegstapel mee, en is zonder afgelegde kaarten gelijk aan voorheen.
const sigs = JSON.parse(run(`JSON.stringify((() => { const st = __state([['A♠'], ['K♠']]);
  const leeg = stateSignature(st.players, st.discard), zonder = stateSignature(st.players);
  const a = stateSignature(st.players, [__card('2', '♥'), __card('3', '♥')]), b = stateSignature(st.players, [__card('3', '♥'), __card('2', '♥')]);
  return { gelijk: leeg === zonder, andere: a !== leeg, volgorde: a !== b }; })())`));
if (!sigs.gelijk) failures.push('vingerafdruk: met een lege aflegstapel hoort hij gelijk te zijn aan voorheen');
if (!sigs.andere) failures.push('vingerafdruk: afgelegde kaarten horen de vingerafdruk te veranderen');
if (!sigs.volgorde) failures.push('vingerafdruk: de volgorde van de aflegstapel hoort mee te tellen');

// 3. Nagemaakte regels met haken, tijdelijk in RULES.
const FAKE = `[
  { id: 'testBattleDiscard', priority: 900, title: 't', short: 't', description: 't', default: false, examples: [], usesDiscard: true,
    onAward(ctx){ if (ctx.how !== 'normal') engineDiscardPot(ctx.state); } },
  { id: 'testRoundDiscard', priority: 901, title: 't', short: 't', description: 't', default: false, examples: [], usesDiscard: true,
    onRoundEnd(ctx){ const act = engineActivePlayers(ctx.state); if (act.length === 0) return;
      for (const p of act) engineDiscardFromDeck(ctx.state, p.id, 1);
      engineReturnFromDiscard(ctx.state, 1, { player: act[0].id, position: 'bottom' }); } }
]`;
const withFake = fn => { run('globalThis.__fake = ' + FAKE + '; RULES.push(...__fake);'); try { return fn(); } finally { run('RULES.length -= __fake.length; delete globalThis.__fake;'); } };
const conserveCheck = (ids, n, seed, rounds) => JSON.parse(run(`(() => {
  const rules = {}; for (const id of ${JSON.stringify(ids)}) rules[id] = true;
  const deck = shuffleWith(${JSON.stringify(seed)});
  const dealt = []; for (let i = 0; i < ${n}; i++) dealt.push({ id: i, name: 'S' + i, deck: [] });
  deck.forEach((c, i) => dealt[i % ${n}].deck.push(c));
  const st = createGameState(dealt, rules); let maxDiscard = 0;
  for (let r = 0; r < ${rounds}; r++){
    if (engineActivePlayers(st).length <= 1) break;
    enginePlayRound(st);
    const all = [...st.players.flatMap(p => p.deck), ...st.pot, ...st.discard];
    if (all.length !== 52 || new Set(all.map(c => c.rank + c.suit)).size !== 52) return JSON.stringify({ ok: false, round: r, total: all.length, uniek: new Set(all.map(c => c.rank + c.suit)).size });
    maxDiscard = Math.max(maxDiscard, st.discard.length);
  }
  return JSON.stringify({ ok: true, maxDiscard });
})()`));
run(`globalThis.shuffleWith = seed => { rng = mulberry32(hashSeed(seed)); return shuffle(buildDeck()); };`);
const discardStats = { used: { testBattleDiscard: 0, testRoundDiscard: 0, both: 0 }, compared: 0 };
withFake(() => {
  let used = 0;
  for (const ids of [['testBattleDiscard'], ['testRoundDiscard'], ['testBattleDiscard', 'testRoundDiscard']]){
    for (const n of [2, 3, 4, 8]) for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5']){
      const r = conserveCheck(ids, n, seed, 400);
      if (!r.ok) failures.push('aflegstapel (' + ids.join('+') + ', ' + n + ' spelers, seed ' + seed + '): na ronde ' + r.round + ' zijn er ' + r.total + ' kaarten (' + r.uniek + ' verschillende) in plaats van 52');
      else if (r.maxDiscard > 0){ used++; discardStats.used[ids.length === 2 ? 'both' : ids[0]]++; }
    }
  }
  for (const k of Object.keys(discardStats.used)) if (discardStats.used[k] < 10) failures.push('aflegstapel: de nagemaakte regel "' + k + '" heeft in te weinig spellen kaarten afgelegd om iets te bewijzen (' + discardStats.used[k] + ' van 20)');

  // Een regel zonder decide wordt overgeslagen bij het bepalen van de winnaar.
  const only = run(`(() => { RULES_BY_PRIORITY.push(...__fake); try { return JSON.stringify(findWinningPlayers(
      [0, 1, 2].map(i => ({ id: i, faceCard: parseExampleCard(['A', '3', '3'][i]) })), { testBattleDiscard: true })); } finally { RULES_BY_PRIORITY.length -= __fake.length; } })()`);
  if (only !== '[0]' && JSON.stringify(JSON.parse(only).map(p => p.id)) !== '[0]') failures.push('een regel zonder decide hoort overgeslagen te worden');

  // 4. De gebeurtenis meldt wat er is afgelegd: alles na een battle gaat naar de aflegstapel, de winnaar krijgt niets.
  const ev = JSON.parse(run(`(() => {
    const st = __state([['A♠', '2♠', '3♠'], ['A♥', '4♥', '5♥'], ['9♦', '6♦', '7♦']]); st.rules = Object.assign({}, st.rules, { testBattleDiscard: true });
    engineStartRound(st); let ev = engineResolve(st);                    // A♠ en A♥ zijn gelijk: battle
    ev = engineLayBattleCards(st); if (ev.type === 'battle-revealed') ev = engineResolve(st);   // 2♠ tegen 4♥: S1 wint
    return JSON.stringify({ type: ev.type, how: ev.how, potSize: ev.potSize, discarded: ev.discarded, toWinner: ev.toWinner,
      winnerDeck: ev.winner.deck.length, discard: __names(st.discard).length, pot: st.pot.length }); })()`));
  if (ev.type !== 'win' || ev.how !== 'battle' || ev.discarded !== ev.potSize || ev.toWinner !== 0 || ev.discard !== ev.potSize || ev.pot !== 0)
    failures.push('gebeurtenis bij afleggen na een battle klopt niet: ' + JSON.stringify(ev));
  const evNormal = JSON.parse(run(`(() => { const st = __state([['A♠'], ['2♥']]); st.rules = Object.assign({}, st.rules, { testBattleDiscard: true });
    engineStartRound(st); const ev = engineResolve(st); return JSON.stringify({ how: ev.how, discarded: ev.discarded, toWinner: ev.toWinner, potSize: ev.potSize }); })()`));
  if (evNormal.how !== 'normal' || evNormal.discarded !== 0 || evNormal.toWinner !== evNormal.potSize) failures.push('zonder battle hoort er niets te worden afgelegd: ' + JSON.stringify(evNormal));

  // 5. Simulatie, zichtbaar spel en fast-forward komen op dezelfde stand uit (stapels én aflegstapel).
  let compared = 0;
  const seedField = document.getElementById('seedInput');
  for (const n of [2, 3, 4, 8]) for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']){
    for (const id of ['testBattleDiscard', 'testRoundDiscard']){
      document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
      for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = false;
      document.getElementById('testBattleDiscardInput').checked = id === 'testBattleDiscard';
      document.getElementById('testRoundDiscardInput').checked = id === 'testRoundDiscard';
      seedField.value = seed;
      run('numPlayers = ' + n + '; dealNewGame();');
      const sim = JSON.parse(run(`(() => { const r = simulateFullTrace(players, 3000, game.rules);
        return JSON.stringify({ o: r.outcome, rounds: r.rounds, decks: r.finalPlayers.map(p => p.deck.length), discard: __names(r.finalDiscard) }); })()`));
      if (sim.o !== 'win' || sim.rounds > 400) continue;
      run('numPlayers = ' + n + '; dealNewGame();');
      const live = JSON.parse(run(`(() => { launchGame(); let i = 0; while (phase !== 'game-over' && phase !== 'cycle-over' && i < 20000){ advance(); i++; }
        return JSON.stringify({ phase, decks: players.map(p => p.deck.length), discard: __names(game.discard) }); })()`));
      run('numPlayers = ' + n + '; dealNewGame();');
      const ff = JSON.parse(run(`(() => { launchGame(); fastForward(); return JSON.stringify({ phase, decks: players.map(p => p.deck.length), discard: __names(game.discard) }); })()`));
      compared++; discardStats.compared++;
      const label = n + ' spelers, seed ' + seed + ', ' + id;
      if (live.phase !== 'game-over' || JSON.stringify(live.decks) !== JSON.stringify(sim.decks) || JSON.stringify(live.discard) !== JSON.stringify(sim.discard))
        failures.push('aflegstapel, zichtbaar spel wijkt af van simulatie (' + label + '): stapels ' + JSON.stringify(live.decks) + ' / ' + JSON.stringify(sim.decks) + ', aflegstapel ' + live.discard.length + ' / ' + sim.discard.length);
      if (ff.phase !== 'game-over' || JSON.stringify(ff.decks) !== JSON.stringify(sim.decks) || JSON.stringify(ff.discard) !== JSON.stringify(sim.discard))
        failures.push('aflegstapel, fast-forward wijkt af van simulatie (' + label + '): aflegstapel ' + ff.discard.length + ' / ' + sim.discard.length);
    }
  }
  // 5b. Fast-forward midden in een spel: wat er al op de aflegstapel ligt moet blijven liggen (totaal 52), en de
  // eindstand is dezelfde als wanneer je het spel zelf uitspeelt.
  let midGame = 0;
  for (const n of [3, 4, 8]) for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']){
    document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
    for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = false;
    document.getElementById('testBattleDiscardInput').checked = true;
    document.getElementById('testRoundDiscardInput').checked = false;
    seedField.value = seed;
    const snap = JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); let i = 0; while (i < 800 && !(phase === \'round-over\' && game.discard.length > 0) && phase !== \'game-over\' && phase !== \'cycle-over\'){ advance(); i++; } return JSON.stringify({ steps: i, phase, discard: game.discard.length }); })()'));
    if (snap.phase !== 'round-over') continue;
    const ffEnd = JSON.parse(run(`(() => { const had = game.discard.length; fastForward(); const total = players.reduce((s, p) => s + p.deck.length, 0) + game.pot.length + game.discard.length;
      return JSON.stringify({ had, total, phase, decks: players.map(p => p.deck.length), discard: __names(game.discard) }); })()`));
    const liveEnd = JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); for (let i = 0; i < ' + snap.steps + '; i++) advance(); let j = 0; while (phase !== \'game-over\' && phase !== \'cycle-over\' && j < 40000){ advance(); j++; } return JSON.stringify({ phase, decks: players.map(p => p.deck.length), discard: __names(game.discard) }); })()'));
    midGame++;
    const label = n + ' spelers, seed ' + seed + ' (fast-forward na ' + snap.steps + ' stappen, ' + ffEnd.had + ' afgelegd)';
    if (ffEnd.total !== 52) failures.push('fast-forward midden in een spel verliest kaarten (' + label + '): ' + ffEnd.total + ' in plaats van 52');
    if (ffEnd.phase === 'game-over' && (liveEnd.phase !== 'game-over' || JSON.stringify(ffEnd.decks) !== JSON.stringify(liveEnd.decks) || JSON.stringify(ffEnd.discard) !== JSON.stringify(liveEnd.discard)))
      failures.push('fast-forward midden in een spel wijkt af van zelf uitspelen (' + label + ')');
  }
  if (midGame < 6) failures.push('aflegstapel: te weinig spellen om fast-forward midden in een spel te testen (' + midGame + ')');
  discardStats.midGame = midGame;

  if (compared < 6) failures.push('aflegstapel: te weinig spellen eindigden om simulatie, zichtbaar spel en fast-forward te vergelijken (' + compared + ')');

  // 6. Het scherm: zichtbaarheid van de aflegstapel, de tekst bij de kaartentelling en het venster met de kaarten.
  const pile = document.getElementById('discardPile');
  run(`players = __state([['A♠']]).players; game = __state([['A♠']]); game.rules = Object.assign({}, game.rules, { testBattleDiscard: true }); updateDiscardPile();`);
  if (pile.classList.contains('hidden')) failures.push('aflegstapel hoort zichtbaar te zijn als een actieve regel hem gebruikt, ook als hij nog leeg is');
  run(`game.rules.testBattleDiscard = false; updateDiscardPile();`);
  if (!pile.classList.contains('hidden')) failures.push('aflegstapel hoort verborgen te zijn als geen regel hem gebruikt en hij leeg is');
  run(`game.discard.push(__card('Q', '♥')); updateDiscardPile();`);
  if (pile.classList.contains('hidden')) failures.push('aflegstapel hoort zichtbaar te zijn zodra er kaarten op liggen');
});

// Tekst bij de kaartentelling: zonder afgelegde kaarten gelijk aan voorheen; met afgelegde kaarten staat die er apart bij.
seedField.value = '1000'; document.getElementById('namesList').children = Array.from({ length: 4 }, () => ({ value: '' }));
run('numPlayers = 4; dealNewGame(); updateIntegrity();');
const integ = () => [document.getElementById('totalCount').textContent, document.getElementById('discardNote').textContent, document.getElementById('integrityStatus').textContent];
if (JSON.stringify(integ()) !== JSON.stringify([52, '', '✓ klopt']) && JSON.stringify(integ()) !== JSON.stringify(['52', '', '✓ klopt'])) failures.push('kaartentelling zonder aflegstapel: ' + JSON.stringify(integ()));
run('engineDiscardFromDeck(game, 0, 4); updateIntegrity();');
if (JSON.stringify(integ().map(String)) !== JSON.stringify(['48', ' (afgelegd: 4)', '✓ klopt'])) failures.push('kaartentelling met 4 afgelegde kaarten: ' + JSON.stringify(integ()));
run('game.discard.pop(); updateIntegrity();'); // een kaart verdwijnt: dat moet opvallen
if (!/klopt niet/.test(document.getElementById('integrityStatus').textContent)) failures.push('een verdwenen kaart moet opvallen in de kaartentelling');

// Het venster met de afgelegde kaarten: op volgorde, bovenste kaart eerst, met de aflegstapel-knop als ingang.
run(`game.discard = [__card('Q', '♥'), __card('3', '♠'), __card('A', '♦')];`);
const pileBtn = document.getElementById('discardPile');
if (!pileBtn.handlers || !pileBtn.handlers.click) failures.push('de aflegstapel heeft geen klik-actie om de kaarten te bekijken');
else {
  pileBtn.handlers.click();
  const listed = document.getElementById('deckViewerList').children.map(n => n.textContent);
  if (JSON.stringify(listed) !== JSON.stringify(['Q♥', '3♠', 'A♦'])) failures.push('venster aflegstapel toont ' + JSON.stringify(listed) + ' in plaats van op volgorde, bovenste eerst');
  if (document.getElementById('deckViewerTitle').textContent !== 'Aflegstapel (3)') failures.push('venster aflegstapel: titel is "' + document.getElementById('deckViewerTitle').textContent + '"');
  if (!/gesloten/i.test(document.getElementById('deckViewerSub').textContent)) failures.push('venster aflegstapel hoort te zeggen dat de stapel gesloten ligt');
  run('game.discard = []; showDiscardViewer();');
  if (!/leeg/.test(document.getElementById('deckViewerList').children.map(n => n.textContent).join(''))) failures.push('venster aflegstapel: lege stapel hoort "leeg" te melden');
}
// De stapel van een speler toont nog steeds zoals voorheen.
run(`showDeckViewer({ name: 'Anna', deck: [__card('K', '♣')] });`);
if (document.getElementById('deckViewerTitle').textContent !== 'Anna — stapel (1)' || document.getElementById('deckViewerSub').textContent !== 'Bovenste kaart eerst') failures.push('venster van een spelersstapel is veranderd');

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
  if (run('game.seed') !== c.seed) failures.push(key(c) + ': game.seed is ' + run('game.seed') + ', verwacht ' + c.seed);
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
    if (document.getElementById('seedLine').textContent !== 'Seed: ' + c.seed) failures.push(key(c) + ': seed in het spelscherm is "' + document.getElementById('seedLine').textContent + '"');
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
  cases.length + ' seeds gesimuleerd, ' + liveChecked + ' spellen live uitgespeeld, aflegstapel: ' + Object.values(discardStats.used).reduce((a, b) => a + b, 0) +
  ' van 60 testspellen met afgelegde kaarten, ' + discardStats.compared + ' spellen vergeleken (simulatie, zichtbaar spel, fast-forward), ' + discardStats.midGame + ' keer fast-forward midden in een spel.');
if (failures.length){
  console.error('\n' + failures.length + ' fout(en):\n' + failures.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('Alles in orde.');
