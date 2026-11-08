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

// ---- testgevallen ----
const cases = [];
for (const n of [2, 3, 4, 6, 8]) for (const seed of ['1', '2', '3', '4', '5', '6']) for (const rule of [false, true]) cases.push({ n, seed, rule });
const key = c => c.n + '|' + c.seed + '|' + (c.rule ? 'twoBeatsAce' : 'standard');

const expected = update || !fs.existsSync(expectedFile) ? {} : JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
const actual = {};
const failures = [];
let liveChecked = 0;

for (const c of cases){
  document.getElementById("seedInput").value = c.seed;
  document.getElementById("twoBeatsAceInput").checked = c.rule;
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
