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
    addEventListener(){}, appendChild(c){ this.children.push(c); }, remove(){}, focus(){}, select(){},
    querySelectorAll(){ return this.children; },
    getContext(){ return new Proxy({}, { get: () => () => {}, set: () => true }); },
    toDataURL(){ return ''; }
  };
}
const document = {
  getElementById(id){ return els[id] || (els[id] = makeEl(id)); },
  createElement(){ return makeEl(); },
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

// Regelcombinaties; de namen zijn de sleutels in tests/expected.json.
const RULE_SETS = {
  'standard': { twoBeatsAce: false, battleFirst: false },
  'twoBeatsAce': { twoBeatsAce: true, battleFirst: false },
  'battleFirst': { twoBeatsAce: false, battleFirst: true },
  'twoBeatsAce+battleFirst': { twoBeatsAce: true, battleFirst: true }
};
const failures = [];

// ---- directe regeltests (findWinningPlayers en spelkern) ----
// Elke regel: [kaarten die open liggen, regels, indexen van de spelers die (voorlopig) winnen]
run(`globalThis.__fw = (ranks, rules) => findWinningPlayers(
  ranks.map((r, i) => ({ id: i, faceCard: { rank: r, value: RANKS.indexOf(r) + 2 } })), rules).map(p => p.id)`);
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

console.log(scripts.length + ' scripts geladen, ' + cases.length + ' seeds gesimuleerd, ' + liveChecked + ' spellen live uitgespeeld.');
if (failures.length){
  console.error('\n' + failures.length + ' fout(en):\n' + failures.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('Alles in orde.');
