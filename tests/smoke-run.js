// De eigenlijke rooktest zonder browser en zonder externe pakketten. Start hem via `node tests/smoke.js` (zie daar): dat
// verdeelt het werk over meerdere processen. Dit bestand draait ook los: node tests/smoke-run.js [map] [--update] [--serial]
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
//
// Verdeeld draaien (--shard=i/n): elk proces voert alle snelle controles uit, maar van de zware onderdelen (TASKS) alleen
// de onderdelen die het zelf heeft gekregen; de fouten van de snelle controles meldt alleen het proces dat 'rest' heeft.
// Zo staat elke drempel-controle (bijvoorbeeld "minstens 8 spellen") in hetzelfde proces als de spellen die hij telt.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const update = args.includes('--update');
const shardArg = args.find(a => a.startsWith('--shard='));
const [SHARD, SHARDS] = shardArg ? shardArg.slice('--shard='.length).split('/').map(Number) : [0, 1];

// De zware onderdelen en een schatting van hun duur in seconden. Het zwaarste gaat steeds naar het proces met de minste last.
const TASKS = { 'ff-royalFamily': 20, 'ff-secondChance': 20, fixed: 18, 'ff-fake': 8, rest: 8 };
const OWNER = (() => {
  const load = Array(SHARDS).fill(0), owner = {};
  for (const [name, w] of Object.entries(TASKS).sort((a, b) => b[1] - a[1])){
    const i = load.indexOf(Math.min(...load));
    owner[name] = i; load[i] += w;
  }
  return owner;
})();
const owns = name => OWNER[name] === SHARD;
// Fouten van onderdelen die dit proces niet zelf is toegewezen worden niet gemeld (een ander proces doet dat).
let muted = !owns('rest');
function own(name, fn){
  if (!owns(name)) return;
  const was = muted; muted = false;
  try { fn(); } finally { muted = was; }
}
const root = path.resolve(args.find(a => !a.startsWith('--')) || path.join(__dirname, '..'));
const expectedFile = path.join(__dirname, 'expected.json');

// ---- nagebootste pagina ----
const els = {};
function makeEl(id){
  return {
    id, value: '', checked: false, textContent: '', innerText: '', disabled: false,
    get innerHTML(){ return this._html || ''; }, set innerHTML(v){ this._html = v; if (v === '') this.children = []; },
    style: {}, dataset: {}, className: '', children: [],
    classList: (() => { const set = new Set(); return { add(c){ set.add(c); }, remove(c){ set.delete(c); },
      toggle(c, force){ const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; }, contains(c){ return set.has(c); } }; })(),
    addEventListener(type, fn){ (this.handlers = this.handlers || {})[type] = fn; }, appendChild(c){ this.children.push(c); }, remove(){}, focus(){ document.activeElement = this; }, select(){},
    setAttribute(k, v){ (this.attrs = this.attrs || {})[k] = String(v); }, getAttribute(k){ return this.attrs && k in this.attrs ? this.attrs[k] : null; },
    querySelectorAll(){ return this.children; },
    getContext(){ return new Proxy({}, { get: () => () => {}, set: () => true }); },
    toDataURL(){ return ''; }
  };
}
const document = {
  getElementById(id){ return els[id] || (els[id] = makeEl(id)); },
  documentElement: { dataset: {} },
  createElement(){ return makeEl(); },
  createTextNode(t){ return { textContent: String(t), nodeType: 3 }; },
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

// Regelcombinaties, afgeleid uit de catalogus RULES (rules.js): geen, elke regel apart, alle paren en alle regels aan.
// De namen zijn de sleutels in tests/expected.json: 'standard' (geen extra regels) of de ids van
// de regels die aan staan, in catalogusvolgorde, gescheiden door '+'.
const CATALOG = JSON.parse(run(`JSON.stringify(RULES.map(r => ({
  id: r.id, priority: r.priority, title: r.title, short: r.short, description: r.description,
  default: r.default, examples: r.examples, hasDecide: typeof r.decide === 'function',
  hasHook: typeof r.onAward === 'function' || typeof r.onRoundEnd === 'function', usesDiscard: r.usesDiscard })))`));
const BASE = JSON.parse(run('JSON.stringify(BASE_RULES)'));
const RULE_IDS = CATALOG.map(r => r.id);
const RULE_SETS = {};
// Niet alle combinaties (dat verdubbelt bij elke nieuwe regel): geen regels, elke regel apart, alle paren en alle regels aan.
for (let mask = 0; mask < (1 << RULE_IDS.length); mask++){
  const on = RULE_IDS.filter((id, i) => mask & (1 << i));
  if (on.length > 2 && on.length < RULE_IDS.length) continue;
  const sets = {};
  for (const id of RULE_IDS) sets[id] = on.includes(id);
  RULE_SETS[on.length ? on.join('+') : 'standard'] = sets;
}
const failures = [];
const reportFailure = failures.push.bind(failures);
failures.push = (...f) => muted ? failures.length : reportFailure(...f);
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

// ---- thema's: alle kleuren staan in css/themes.css ----
{
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const themesCss = read('css/themes.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const themeBlocks = [...themesCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), vars: [...m[2].matchAll(/(--[a-z0-9-]+)\s*:/g)].map(v => v[1]) }));
  const base = themeBlocks.find(b => /^:root\b/.test(b.selector));
  if (!base) failures.push('thema: css/themes.css heeft geen standaardthema (:root, [data-theme="oorlog"])');
  else {
    const want = [...base.vars].sort();
    for (const b of themeBlocks){
      const got = [...b.vars].sort();
      const missing = want.filter(v => !got.includes(v)), extra = got.filter(v => !want.includes(v));
      if (missing.length || extra.length) failures.push('thema ' + b.selector + ': mist ' + JSON.stringify(missing) + ', te veel ' + JSON.stringify(extra));
    }
    // Elke variabele die de opmaak gebruikt bestaat in het thema.
    const used = new Set();
    for (const f of fs.readdirSync(path.join(root, 'css')).filter(n => n.endsWith('.css') && n !== 'themes.css')){
      for (const m of read('css/' + f).matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
    }
    for (const v of used) if (!want.includes(v)) failures.push('thema: de opmaak gebruikt ' + v + ' maar het thema definieert die niet');
  }
  // Buiten themes.css staan geen vaste kleuren (neutraal zwart voor schaduwen en verduistering mag).
  const colorIn = text => [...text.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\((?!\s*0\s*,\s*0\s*,\s*0\s*[,)])[^)]*\)/g)].map(m => m[0]);
  for (const f of fs.readdirSync(path.join(root, 'css')).filter(n => n.endsWith('.css') && n !== 'themes.css')){
    const bodies = [...read('css/' + f).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)].map(m => m[1]).join('\n');
    const found = colorIn(bodies);
    if (found.length) failures.push('css/' + f + ' bevat vaste kleuren ' + JSON.stringify(found) + ': zet ze in css/themes.css');
  }
  for (const f of scripts){
    if (!f.endsWith('.js')) continue;
    const found = [...read(f).matchAll(/['"`](#[0-9a-fA-F]{3,8})['"`]|\b(?:rgba?|hsla?)\(/g)].map(m => m[0]);
    if (found.length) failures.push(f + ' bevat vaste kleuren ' + JSON.stringify(found) + ': lees ze uit het thema');
  }
  const htmlText = read('index.html');
  if (!/<html[^>]*data-theme="oorlog"/.test(htmlText)) failures.push('index.html: het <html>-element mist data-theme="oorlog"');
  if (htmlText.indexOf('css/themes.css') === -1 || htmlText.indexOf('css/themes.css') > htmlText.indexOf('css/style.css')) failures.push('index.html: css/themes.css hoort vóór css/style.css te staan');
}

// ---- namen en andere tekst nooit als HTML lezen ----
{
  // Geen enkele plek in de code zet nog tekst als HTML in de pagina: alleen wissen (innerHTML = '') mag.
  const bad = [];
  for (const f of scripts){
    if (!f.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/\.(?:inner|outer)HTML\s*\+?=\s*([^;\n]*)/g)) if (m[1].trim() !== "''") bad.push(f + ': ' + m[0].slice(0, 60));
    if (/insertAdjacentHTML|document\.write\s*\(/.test(text)) bad.push(f + ': insertAdjacentHTML of document.write');
  }
  if (bad.length) failures.push('tekst wordt als HTML in de pagina gezet (gebruik textContent of createTextNode, zodat een naam met HTML niets kan uitvoeren): ' + JSON.stringify(bad));
  const textIn = node => { let t = ''; const walkNode = n => { if (n.textContent) t += n.textContent + '\n'; (n.children || []).forEach(walkNode); }; walkNode(node); return t; };
  // Een naam met HTML erin verschijnt als gewone tekst in de eindbanner en de statistieken.
  const evil = '<img src=x onerror=1>';
  const banner = document.getElementById('endBanner');
  run('endGame({ name: ' + JSON.stringify(evil) + ' });');
  if (banner.innerHTML !== '' || !textIn(banner).includes(evil.toUpperCase())) failures.push('een naam met HTML in de eindbanner wordt als HTML gelezen of ontbreekt: ' + JSON.stringify(banner.innerHTML) + ' / ' + JSON.stringify(textIn(banner)));
  run('players = [{ id: 0, name: ' + JSON.stringify(evil) + ', deck: [] }, { id: 1, name: "Bram", deck: [] }]; renderStatsLegend(); renderStatsSummary();');
  for (const id of ['statsLegend', 'statsSummary']){
    const el = document.getElementById(id);
    if (el.innerHTML !== '' || !textIn(el).includes(evil)) failures.push('een naam met HTML in de statistieken (' + id + ') wordt als HTML gelezen of ontbreekt: ' + JSON.stringify(el.innerHTML) + ' / ' + JSON.stringify(textIn(el)));
  }
  const sumText = textIn(document.getElementById('statsSummary'));
  if (!/Totaal battles:/.test(sumText) || !/Bram: /.test(sumText)) failures.push('de samenvatting van de statistieken toont niet alle regels: ' + JSON.stringify(sumText));
  run('players = [];');
}

// ---- themakeuze (js/theme.js) ----
{
  const themeIds = JSON.parse(run('JSON.stringify(THEMES.map(t => t.id))'));
  const icons = JSON.parse(run('JSON.stringify(THEMES.map(t => t.icon))'));
  const cssText = fs.readFileSync(path.join(root, 'css/themes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const cssIds = [...new Set([...cssText.matchAll(/\[data-theme="([a-z]+)"\]/g)].map(m => m[1]))];
  if (JSON.stringify([...themeIds].sort()) !== JSON.stringify([...cssIds].sort())) failures.push('thema\'s: THEMES in js/theme.js ' + JSON.stringify(themeIds) + ' komt niet overeen met css/themes.css ' + JSON.stringify(cssIds));
  if (!themeIds.includes(run('DEFAULT_THEME'))) failures.push('thema: het standaardthema staat niet in THEMES');
  if (new Set(themeIds).size !== themeIds.length || !themeIds.every(id => /^[a-z]+$/.test(id))) failures.push('thema: ids in THEMES moeten uniek zijn en uit kleine letters bestaan (het scriptje in de <head> controleert dat)');
  if (!icons.every(isText) || new Set(icons).size !== icons.length) failures.push('thema: elk thema heeft een eigen icoon nodig: ' + JSON.stringify(icons));
  if (run("themeItems.some(b => b.className.split(' ').includes('count-btn'))")) failures.push('thema: een themaknop mag niet de klasse count-btn hebben (setup.js haalt daar de markering van weg)');
  if (run('themeItems.length') !== themeIds.length) failures.push('thema: er hoort een menu-item per thema te zijn');
  const theme = () => run('document.documentElement.dataset.theme');
  const activeItems = () => JSON.parse(run('JSON.stringify(themeItems.filter(b => b.classList.contains("active")).map(b => b.dataset.theme))'));
  const checked = () => JSON.parse(run('JSON.stringify(themeItems.map(b => b.getAttribute("aria-checked")))'));
  const isOpen = () => run('!themeMenu.classList.contains("hidden")');
  const expanded = () => run('themeToggle.getAttribute("aria-expanded")');
  const toggleIcon = () => run('themeToggleIcon.textContent');
  const focusIs = expr => run('document.activeElement === ' + expr);
  const clickToggle = () => run('themeToggle.handlers.click()');
  if (theme() !== 'oorlog' || JSON.stringify(activeItems()) !== '["oorlog"]') failures.push('thema: zonder keuze hoort het thema oorlog te zijn, kreeg ' + theme());
  if (toggleIcon() !== icons[0]) failures.push('thema: de knop hoort het icoon van het huidige thema te tonen');
  if (isOpen() || expanded() !== 'false') failures.push('thema: het menu hoort dicht te beginnen');
  if (run("applyTheme('sovjet')") !== 'sovjet' || theme() !== 'sovjet' || JSON.stringify(activeItems()) !== '["sovjet"]' || toggleIcon() !== icons[1]) failures.push('thema: sovjet kiezen werkt niet');
  if (JSON.stringify(checked()) !== JSON.stringify(themeIds.map(id => id === 'sovjet' ? 'true' : 'false'))) failures.push('thema: aria-checked in het menu klopt niet: ' + JSON.stringify(checked()));
  if (run("applyTheme('bestaat-niet')") !== 'oorlog' || theme() !== 'oorlog') failures.push('thema: een onbekend thema hoort het standaardthema te worden');
  // Het menu: openen, sluiten (knop, Escape, klik ernaast) en door de items lopen met de pijltjes.
  clickToggle();
  if (!isOpen() || expanded() !== 'true' || !focusIs('themeItems[0]')) failures.push('thema: een klik op de knop hoort het menu te openen met de focus op het huidige thema');
  clickToggle();
  if (isOpen() || expanded() !== 'false') failures.push('thema: een tweede klik op de knop hoort het menu te sluiten');
  clickToggle(); run("themeOnKeydown({ key: 'Escape' })");
  if (isOpen() || expanded() !== 'false' || !focusIs('themeToggle')) failures.push('thema: Escape hoort het menu te sluiten en de focus terug te geven aan de knop');
  clickToggle(); run('themeOnDocumentClick()');
  if (isOpen()) failures.push('thema: een klik buiten de themakeuze hoort het menu te sluiten');
  run('themeOnDocumentClick(); themeOnKeydown({ key: "Escape" })'); // dicht: geen fouten en niets te doen
  let stopped = false; run('globalThis.__ev = { stopPropagation(){ globalThis.__stopped = true; } }; themeSwitch.handlers.click(__ev);');
  if (!run('globalThis.__stopped === true')) failures.push('thema: een klik binnen de themakeuze mag het menu niet via het document sluiten (stopPropagation)');
  clickToggle(); run("themeOnKeydown({ key: 'ArrowDown' })");
  if (!focusIs('themeItems[1]')) failures.push('thema: pijltje omlaag hoort naar het volgende item te gaan');
  for (let k = 1; k < themeIds.length; k++) run("themeOnKeydown({ key: 'ArrowDown' })"); // van het tweede item rond naar het eerste
  if (!focusIs('themeItems[0]')) failures.push('thema: pijltje omlaag bij het laatste item hoort naar het eerste te gaan');
  run("themeOnKeydown({ key: 'ArrowUp' })");
  if (!focusIs('themeItems[themeItems.length - 1]')) failures.push('thema: pijltje omhoog bij het eerste item hoort naar het laatste te gaan');
  run('themeMenuClose()');
  // Onthouden: kiezen bewaart de keuze en sluit het menu; opslag die niet werkt geeft geen fout.
  run(`globalThis.localStorage = { data: {}, getItem(k){ return k in this.data ? this.data[k] : null; }, setItem(k, v){ this.data[k] = v; } };`);
  clickToggle();
  run("themeItems.find(b => b.dataset.theme === 'sovjet').handlers.click();");
  if (theme() !== 'sovjet' || run('themeStored()') !== 'sovjet') failures.push('thema: een item kiezen zet en bewaart het thema niet');
  if (isOpen() || !focusIs('themeToggle')) failures.push('thema: na een keuze hoort het menu dicht te zijn en de focus terug te gaan naar de knop');
  if (run('applyTheme(themeStored())') !== 'sovjet') failures.push('thema: een bewaarde keuze wordt niet teruggezet');
  run(`localStorage.setItem(THEME_STORAGE_KEY, 'weg');`);
  if (run('applyTheme(themeStored())') !== 'oorlog') failures.push('thema: een bewaard onbekend thema hoort het standaardthema te worden');
  run(`globalThis.localStorage = { getItem(){ throw new Error('geblokkeerd'); }, setItem(){ throw new Error('geblokkeerd'); } };`);
  try { run("themeSave('sovjet'); themeStored();"); } catch (e){ failures.push('thema: geblokkeerde opslag mag geen fout geven: ' + e.message); }
  run('delete globalThis.localStorage; delete globalThis.__ev; delete globalThis.__stopped; applyTheme("oorlog");');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const id of ['themeSwitch', 'themeToggle', 'themeToggleIcon', 'themeMenu']) if (!indexHtml.includes('id="' + id + '"')) failures.push('index.html mist het element met id ' + id);
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
    if (Array.isArray(ex.decks)){ // scenario: stapels vóór en na een ronde
      const ranks = list => list.flat().every(c => validCard(c));
      if (!isText(ex.text)) failures.push('voorbeeld bij "' + section.name + '": tekst ontbreekt');
      if (!ex.decks.every(Array.isArray) || !Array.isArray(ex.after) || ex.after.length !== ex.decks.length || !ex.after.every(Array.isArray)) { failures.push('voorbeeld bij "' + section.name + '": decks en after horen even lang te zijn'); continue; }
      if (!ranks(ex.decks) || !ranks(ex.after)) failures.push('voorbeeld bij "' + section.name + '": onbekende kaart in een stapel');
      if (!Number.isInteger(ex.discarded) || ex.discarded < 0) failures.push('voorbeeld bij "' + section.name + '": discarded moet een aantal zijn');
      if (ex.decks.flat().length !== ex.after.flat().length + ex.discarded) failures.push('voorbeeld bij "' + section.name + '": het aantal kaarten voor en na (plus afgelegd) klopt niet');
      continue;
    }
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
    if (Array.isArray(ex.decks)){
      const shown = byClass(exBox, 'rb-card').map(n => n.textContent);
      const wanted = ex.decks.flatMap((d, i) => [...d, ...ex.after[i]]);
      if (JSON.stringify(shown) !== JSON.stringify(wanted)) failures.push('regelboek: stapels van voorbeeld ' + (k + 1) + ' bij "' + r.title + '" kloppen niet met de catalogus');
      if (!textOf(exBox).includes('Aflegstapel: ' + ex.discarded + (ex.discarded === 1 ? ' kaart' : ' kaarten'))) failures.push('regelboek: aflegstapel van voorbeeld ' + (k + 1) + ' bij "' + r.title + '" ontbreekt');
      if (!textOf(exBox).includes(ex.text)) failures.push('regelboek: uitleg van voorbeeld ' + (k + 1) + ' bij "' + r.title + '" ontbreekt');
      return;
    }
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
const expectedOrder = CATALOG.filter(r => r.hasDecide).sort((a, b) => a.priority - b.priority).map(r => r.title);
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
run(`engineReturnFromDiscard(__s, 5, { player: 0 });`); // vraagt meer dan er ligt: alleen 7♠
if (JSON.stringify(names('__s.players[0].deck')) !== JSON.stringify(['Q♠', '7♠']) || run('__s.discard.length') !== 0) failures.push('aflegstapel: meer terugvragen dan er ligt klopt niet');
run(`engineDiscardCards(__s, [__card('4', '♦')]); __s.players[3].out = true;`);
if (run(`engineReturnFromDiscard(__s, 1, { player: 3 })`) !== 1 || run('__s.discard.length') !== 0 || run('__s.players[3].out') !== false)
  failures.push('aflegstapel: een uitgeschakelde speler die kaarten terugkrijgt hoort weer mee te doen');
if (JSON.stringify(run('__s.moved')) !== JSON.stringify({ discarded: 6, returned: 6, revived: [3], transferred: 0, transfers: [], shared: [] })) failures.push('aflegstapel: tellers kloppen niet: ' + JSON.stringify(run('__s.moved')));
// Weer meedoen: alleen als er echt kaarten komen, en alleen voor wie uit was.
run(`globalThis.__r = __state([['A♠'], [], ['K♠']]); __r.players[1].out = true;`);
if (run(`engineReturnFromDiscard(__r, 1, { player: 1 })`) !== 0 || run('__r.players[1].out') !== true) failures.push('aflegstapel: zonder kaarten om terug te krijgen blijft een speler uitgeschakeld');
run(`engineDiscardCards(__r, [__card('4', '♦'), __card('5', '♦')]);`);
if (run(`engineReturnFromDiscard(__r, 0, { player: 1 })`) !== 0 || run('__r.players[1].out') !== true) failures.push('aflegstapel: 0 kaarten terugkrijgen telt niet als weer meedoen');
run(`engineReturnFromDiscard(__r, 1, { player: 0 });`); // een actieve speler: niet "weer meedoen"
if (JSON.stringify(run('__r.moved.revived')) !== '[]') failures.push('aflegstapel: een actieve speler telt niet als teruggekomen');
run(`engineReturnFromDiscard(__r, 1, { player: 1 });`);
if (run('__r.players[1].out') !== false || JSON.stringify(names('__r.players[1].deck')) !== JSON.stringify(['4♦']) || JSON.stringify(run('__r.moved.revived')) !== '[1]')
  failures.push('aflegstapel: terugkomen vanaf de aflegstapel klopt niet: ' + JSON.stringify(names('__r.players[1].deck')));
// Een nieuwe spelstand begint met een lege aflegstapel.
if (run('createGameState([{ id: 0, name: "a", deck: [] }], {}).discard.length') !== 0) failures.push('aflegstapel: begint niet leeg');

// ---- kaarten tussen spelers ----
// De spelers zitten in een kring; met de klok mee tellen zit het volgende nummer links van je.
run(`globalThis.__k = __state([['A♠'], ['K♠'], ['Q♠'], ['J♠'], ['10♠']]);`);
const nb = (state, id, dir) => run(`(() => { const p = engineNeighbor(${state}, ${id}, '${dir}'); return p ? p.id : null; })()`);
const nbCases = [[0, 'left', 1], [0, 'right', 4], [4, 'left', 0], [4, 'right', 3], [2, 'left', 3], [2, 'right', 1]];
for (const [id, dir, exp] of nbCases) if (nb('__k', id, dir) !== exp) failures.push('buur: ' + dir + ' van speler ' + id + ' is ' + nb('__k', id, dir) + ', verwacht ' + exp);
run(`__k.players[1].deck = []; __k.players[4].out = true; __k.players[4].deck = [];`); // speler 1 heeft niets, speler 4 ligt uit
for (const [id, dir, exp] of [[0, 'left', 2], [0, 'right', 3], [3, 'left', 0], [2, 'right', 0]])
  if (nb('__k', id, dir) !== exp) failures.push('buur overslaan: ' + dir + ' van speler ' + id + ' is ' + nb('__k', id, dir) + ', verwacht ' + exp + ' (spelers zonder kaarten worden overgeslagen)');
run(`for (const p of __k.players) if (p.id !== 0) p.deck = [];`);
if (nb('__k', 0, 'left') !== null || nb('__k', 0, 'right') !== null) failures.push('buur: als niemand anders kaarten heeft hoort het null te zijn');
run(`globalThis.__two = __state([['A♠'], ['K♠']]);`);
if (nb('__two', 0, 'left') !== 1 || nb('__two', 0, 'right') !== 1) failures.push('buur: bij twee spelers zijn links en rechts dezelfde speler');
if (run(`engineNeighbor(__state([['A♠']]), 0, 'left')`) !== null) failures.push('buur: een speler alleen heeft geen buur');

// De speler met de meeste kaarten; bij een gelijk aantal de speler die het eerst links van je zit.
run(`globalThis.__m = __state([['2♠', '3♠'], ['A♠', 'K♠', 'Q♠', 'J♠', '10♠'], ['9♠', '8♠', '7♠', '6♠', '5♠'], ['4♠']]);`);
const rich = (state, id) => run(`(() => { const p = engineRichestPlayer(${state}, ${id}); return p ? p.id : null; })()`);
for (const [id, exp] of [[0, 1], [1, 2], [2, 1], [3, 1]]) if (rich('__m', id) !== exp) failures.push('rijkste speler: voor speler ' + id + ' is dat ' + rich('__m', id) + ', verwacht ' + exp);
run(`globalThis.__m2 = __state([['A♠', 'K♠', 'Q♠', 'J♠', '10♠'], ['2♠'], ['9♠', '8♠', '7♠', '6♠', '5♠'], ['4♠', '3♠', '2♣', '2♦', '2♥']]);`);
if (rich('__m2', 2) !== 3) failures.push('rijkste speler: bij gelijk aantal geldt degene die het eerst links zit (verwacht 3 voor speler 2, kreeg ' + rich('__m2', 2) + ')');
if (rich('__m2', 3) !== 0) failures.push('rijkste speler: voor speler 3 verwacht 0 (eerst links, rond de kring), kreeg ' + rich('__m2', 3));
if (rich('__state([[\'A♠\'], [], []])', 0) !== null) failures.push('rijkste speler: als niemand anders kaarten heeft hoort het null te zijn');

// De overdracht: de bovenste kaarten, in volgorde, onderaan (of bovenop), en een uitgeschakelde ontvanger doet weer mee.
run(`globalThis.__t = __state([['A♠', 'K♠', 'Q♠', 'J♠'], ['2♥'], []]); __t.players[2].out = true;`);
if (run('engineTransferCards(__t, 0, 1, 2)') !== 2 || JSON.stringify(names('__t.players[1].deck')) !== JSON.stringify(['2♥', 'A♠', 'K♠']) || JSON.stringify(names('__t.players[0].deck')) !== JSON.stringify(['Q♠', 'J♠']))
  failures.push('overdracht: de bovenste kaarten horen onderaan de stapel van de ontvanger te komen, in volgorde: ' + JSON.stringify(names('__t.players[1].deck')));
run(`engineTransferCards(__t, 0, 1, 1, 'top');`);
if (JSON.stringify(names('__t.players[1].deck')) !== JSON.stringify(['Q♠', '2♥', 'A♠', 'K♠'])) failures.push('overdracht naar bovenop klopt niet: ' + JSON.stringify(names('__t.players[1].deck')));
if (run('engineTransferCards(__t, 1, 2, 0)') !== 0 || run('__t.players[2].out') !== true) failures.push('overdracht: 0 kaarten laat een uitgeschakelde speler niet terugkomen');
if (run('engineTransferCards(__t, 1, 2, 2)') !== 2 || run('__t.players[2].out') !== false || JSON.stringify(names('__t.players[2].deck')) !== JSON.stringify(['Q♠', '2♥']))
  failures.push('overdracht: een uitgeschakelde ontvanger hoort weer mee te doen en de kaarten te krijgen');
if (run('engineTransferCards(__t, 0, 2, 5)') !== 1 || run('__t.players[0].deck.length') !== 0) failures.push('overdracht: meer vragen dan er is hoort alleen te geven wat er is');
if (run('engineTransferCards(__t, 1, 1, 1)') !== 0) failures.push('overdracht: aan jezelf geven hoort niets te doen');
if (JSON.stringify(run('__t.moved')) !== JSON.stringify({ discarded: 0, returned: 0, revived: [2], transferred: 6, transfers: [{ from: 0, to: 1, count: 2 }, { from: 0, to: 1, count: 1 }, { from: 1, to: 2, count: 2 }, { from: 0, to: 2, count: 1 }], shared: []}))
  failures.push('overdracht: tellers kloppen niet: ' + JSON.stringify(run('__t.moved')));
if (run('__t.players.reduce((n, p) => n + p.deck.length, 0)') !== 5) failures.push('overdracht: het totaal aantal kaarten verandert');

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
      engineReturnFromDiscard(ctx.state, 1, { player: act[0].id, position: 'bottom' }); } },
  { id: 'testRevive', priority: 902, title: 't', short: 't', description: 't', default: false, examples: [], usesDiscard: true,
    onRoundEnd(ctx){ const out = ctx.state.players.find(p => p.out); if (out) engineReturnFromDiscard(ctx.state, 1, { player: out.id }); } },
  // Vertrouwt op de tellers van het spel: legt aan het einde van elke ronde een kaart af, maar nooit meer dan 4 in totaal.
  // Een simulatie midden in een spel moet daarom met dezelfde tellers beginnen als het spel.
  { id: 'testLimited', priority: 903, title: 't', short: 't', description: 't', default: false, examples: [], usesDiscard: true,
    onRoundEnd(ctx){ if (ctx.state.moved.discarded >= 4) return; const act = engineActivePlayers(ctx.state); if (act.length) engineDiscardFromDeck(ctx.state, act[0].id, 1); } },
  // Redden: wie geen kaarten meer heeft (uitgeschakeld of net leeg) krijgt een kaart van de linkerbuur, de rechterbuur
  // of de speler met de meeste kaarten. Maximaal 3 keer per spel, anders eindigt een spel nooit.
  ...['Left', 'Right', 'Rich'].map((kind, i) => ({ id: 'testRescue' + kind, priority: 903 + i, title: 't', short: 't', description: 't', default: false, examples: [],
    onRoundEnd(ctx){
      if (ctx.state.moved.transfers.length >= 3) return;
      for (const p of ctx.state.players.filter(q => q.deck.length === 0)){
        const giver = kind === 'Rich' ? engineRichestPlayer(ctx.state, p.id) : engineNeighbor(ctx.state, p.id, kind === 'Left' ? 'left' : 'right');
        if (giver) engineTransferCards(ctx.state, giver.id, p.id, 1);
      }
    } }))
]`;
const FAKE_IDS = ['testBattleDiscard', 'testRoundDiscard', 'testRevive', 'testLimited', 'testRescueLeft', 'testRescueRight', 'testRescueRich'];
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
  return JSON.stringify({ ok: true, maxDiscard, revives: st.moved.revived.length, transfers: st.moved.transfers.length, shared: st.moved.shared.length });
})()`));
run(`globalThis.shuffleWith = seed => { rng = mulberry32(hashSeed(seed)); return shuffle(buildDeck()); };`);
const discardStats = { used: { testBattleDiscard: 0, testRoundDiscard: 0, 'testBattleDiscard+testRoundDiscard': 0, 'testBattleDiscard+testRevive': 0 }, compared: 0, revives: 0, reviveGames: 0, transferGames: { testRescueLeft: 0, testRescueRight: 0, testRescueRich: 0 } };
// De echte regel "Battle ruimt de pot op": altijd 52 unieke kaarten, en er wordt echt afgelegd.
{
  let used = 0;
  for (const n of [2, 3, 4, 8]) for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5']){
    const r = conserveCheck(['battleDiscard'], n, seed, 400);
    if (!r.ok) failures.push('battleDiscard (' + n + ' spelers, seed ' + seed + '): na ronde ' + r.round + ' zijn er ' + r.total + ' kaarten (' + r.uniek + ' verschillende) in plaats van 52');
    else if (r.maxDiscard > 0) used++;
  }
  if (used < 15) failures.push('battleDiscard: in te weinig spellen is er afgelegd (' + used + ' van 20)');
  // Gelijkspel: als in een battle alle kaarten opgaan, is het spel voorbij zonder winnaar.
  const draw = JSON.parse(run(`(() => { const st = __state([['K♠'], ['K♥', '3♥']]); st.rules = Object.assign({}, st.rules, { battleDiscard: true });
    engineStartRound(st); let ev = engineResolve(st); ev = engineLayBattleCards(st); const end = engineEndRound(st);
    return JSON.stringify({ type: ev.type, how: ev.how, discarded: ev.discarded, gameOver: end.gameOver, winner: end.winner }); })()`));
  if (draw.type !== 'win' || draw.discarded !== 3 || draw.gameOver !== true || draw.winner !== null) failures.push('battleDiscard: gelijkspel klopt niet: ' + JSON.stringify(draw));
  run('endGame(null);');
  if (!/GELIJKSPEL/.test(textOf(document.getElementById('endBanner')))) failures.push('einde van het spel zonder winnaar toont geen gelijkspel');
  run('endGame({ name: "Anna" });');
  if (!/ANNA WINT/.test(textOf(document.getElementById('endBanner')))) failures.push('einde van het spel met winnaar toont de winnaar niet');
}
// De echte regel "Tweede kans": wie zonder kaarten valt krijgt de bovenste kaart van de linkerbuur, zolang minstens 3 spelers kaarten hebben.
{
  const end = (decks, outIdx) => JSON.parse(run(`(() => { const st = __state(${JSON.stringify(decks)}); st.rules = Object.assign({}, st.rules, { secondChance: true });
    for (const i of ${JSON.stringify(outIdx || [])}) st.players[i].out = true;
    const e = engineEndRound(st);
    return JSON.stringify({ decks: st.players.map(p => p.deck.map(c => c.rank)), out: st.players.map(p => p.out), transfers: e.transfers.map(t => [t.from.id, t.to.id, t.count]),
      revived: e.revived.map(p => p.id), gameOver: e.gameOver, moved: st.moved.transferred }); })()`));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Eén speler zonder kaarten: de bovenste kaart van de linkerbuur (speler 3, want speler 1 zit rechts van speler 2).
  let r = end([['A'], [], ['K', 'Q'], ['J']]);
  if (!same(r.decks, [['A'], ['K'], ['Q'], ['J']]) || !same(r.transfers, [[2, 1, 1]]) || r.out.some(Boolean)) failures.push('Tweede kans: één speler zonder kaarten klopt niet: ' + JSON.stringify(r));
  // Een speler die al uit lag komt terug.
  r = end([['A'], [], ['K', 'Q'], ['J']], [1]);
  if (r.out[1] !== false || !same(r.revived, [1])) failures.push('Tweede kans: een uitgeschakelde speler hoort terug te komen: ' + JSON.stringify(r));
  // Minder dan 3 spelers met kaarten: niemand komt terug en het spel is voorbij.
  r = end([['A'], [], ['K']]);
  if (!same(r.decks, [['A'], [], ['K']]) || r.transfers.length !== 0 || r.out[1] !== true) failures.push('Tweede kans: met 2 spelers met kaarten komt niemand terug: ' + JSON.stringify(r));
  r = end([['A'], [], ['K'], []]);
  if (r.transfers.length !== 0 || r.gameOver || !same(r.out, [false, true, false, true])) failures.push('Tweede kans: met 2 spelers met kaarten gaat het spel gewoon door met die twee: ' + JSON.stringify(r));
  r = end([['A'], [], [], []]);
  if (r.transfers.length !== 0 || !r.gameOver) failures.push('Tweede kans: met 1 speler met kaarten is het spel voorbij: ' + JSON.stringify(r));
  // Precies 3 spelers met kaarten: de regel werkt (hier ook voor de laatste speler van de tafel, die van speler 1 krijgt: de tafel is een kring).
  r = end([['A'], [], ['K', 'Q'], ['J'], []]);
  if (!same(r.transfers, [[2, 1, 1], [0, 4, 1]]) || !same(r.decks, [[], ['K'], ['Q'], ['J'], ['A']]) || r.out[0] !== true || r.out[4] !== false)
    failures.push('Tweede kans: bij precies 3 spelers met kaarten (en de kring rond de tafel) klopt het niet: ' + JSON.stringify(r));
  // Spelers zonder kaarten worden overgeslagen bij het zoeken naar de linkerbuur, en twee spelers zonder kaarten gaan in tafelvolgorde.
  r = end([['A'], [], [], ['J', 'Q', 'K'], ['2']]);
  if (!same(r.decks, [['A'], ['J'], ['Q'], ['K'], ['2']]) || !same(r.transfers, [[3, 1, 1], [3, 2, 1]])) failures.push('Tweede kans: twee spelers zonder kaarten tegelijk klopt niet: ' + JSON.stringify(r));
  // De buur heeft maar één kaart: de eerste krijgt die, de tweede krijgt niets en blijft uit.
  r = end([['A'], [], [], ['J'], ['2']]);
  if (!same(r.decks, [['A'], ['J'], [], [], ['2']]) || !same(r.transfers, [[3, 1, 1]]) || r.out[2] !== true || r.out[3] !== true || r.out[1] !== false)
    failures.push('Tweede kans: een buur met één kaart klopt niet: ' + JSON.stringify(r));
  // Wie net een kaart kreeg, geeft die niet meteen door: de gevers worden vooraf bepaald.
  // Speler 1 en 6 vallen af (de tafel is een kring: links van speler 6 zit speler 1). Speler 1 krijgt een kaart van speler 2. Voor speler 6 telt
  // speler 1 nog niet mee als buur, want die had bij het begin geen kaarten: ook speler 6 krijgt dus een kaart van speler 2.
  r = end([[], ['K', 'Q'], ['A'], ['J'], ['2'], []]);
  if (!same(r.transfers, [[1, 0, 1], [1, 5, 1]]) || !same(r.decks, [['K'], [], ['A'], ['J'], ['2'], ['Q']])) failures.push('Tweede kans: spelers die net een kaart kregen geven die niet door: ' + JSON.stringify(r));
  // Zonder de regel aan gebeurt er niets.
  const off = JSON.parse(run(`(() => { const st = __state([['A'], [], ['K', 'Q'], ['J']]); const e = engineEndRound(st); return JSON.stringify({ t: e.transfers.length, out: st.players.map(p => p.out) }); })()`));
  if (off.t !== 0 || off.out[1] !== true) failures.push('Tweede kans: zonder de regel hoort er niets te gebeuren: ' + JSON.stringify(off));
  // Altijd 52 unieke kaarten, en er worden echt kaarten overgedragen (alleen vanaf 4 spelers).
  const sc = { games: 0, transfers: 0, small: 0 };
  for (const ids of [['secondChance'], ['secondChance', 'battleDiscard'], ['secondChance', 'twoBeatsAce']]) for (const n of [2, 3, 4, 5, 6, 8]) for (const seed of ['t1', 't2', 't3', 't4']){
    const c = conserveCheck(ids, n, seed, 300);
    if (!c.ok) failures.push('Tweede kans (' + ids.join('+') + ', ' + n + ' spelers, seed ' + seed + '): na ronde ' + c.round + ' zijn er ' + c.total + ' kaarten (' + c.uniek + ' verschillende) in plaats van 52');
    else { sc.games++; if (c.transfers > 0) sc.transfers++; if (n < 4 && c.transfers > 0) sc.small++; }
  }
  if (sc.transfers < 10) failures.push('Tweede kans: in te weinig spellen is er een kaart overgedragen om iets te bewijzen (' + sc.transfers + ' van ' + sc.games + ')');
  if (sc.small !== 0) failures.push('Tweede kans: met 2 of 3 spelers hoort de regel niets te doen (' + sc.small + ' spellen met een overdracht)');
}
// De echte regel "Koninklijk gezin": wint een Heer met een Vrouw op tafel, dan winnen ze samen en kiest de Heer eerst.
{
  run(`globalThis.__play = (decks, rules) => { const st = createGameState(decks.map((d, i) => ({ id: i, name: 'S' + i, deck: d.map(r => ({ rank: r, suit: '♠', value: RANKS.indexOf(r) + 2 })) })), rules);
    const r = enginePlayRound(st); return JSON.stringify({ after: st.players.map(p => p.deck.map(c => c.rank)), discarded: st.discard.length, shared: r.shared, counts: st.moved.shared.map(x => [x.to, x.count]) }); }`);
  const play = (decks, rules) => JSON.parse(run('__play(' + JSON.stringify(decks) + ', ' + JSON.stringify(Object.assign({ royalFamily: true }, rules || {})) + ')'));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Een even pot: evenveel kaarten (2 en 2), de Heer krijgt de hoogste.
  let r = play([['K', '4'], ['Q', '7'], ['9', '5'], ['2', '8']]);
  if (!same(r.counts, [[0, 2], [1, 2]]) || !same(r.after, [['4', 'K', '9'], ['7', 'Q', '2'], ['5'], ['8']])) failures.push('Koninklijk gezin: een even pot klopt niet: ' + JSON.stringify(r));
  // Een Vrouw die wint, deelt niet: alleen een Heer die wint, doet dat.
  r = play([['Q', '4'], ['J', '7'], ['9', '5']]);
  if (r.shared.length !== 0 || !same(r.after, [['4', 'Q', 'J', '9'], ['7'], ['5']])) failures.push('Koninklijk gezin: een winnende Vrouw deelt niet: ' + JSON.stringify(r));
  // Een Heer die niet wint (de Aas wint), deelt niet.
  r = play([['K', '4'], ['Q', '7'], ['A', '5']]);
  if (r.shared.length !== 0 || !same(r.after, [['4'], ['7'], ['5', 'K', 'Q', 'A']])) failures.push('Koninklijk gezin: bij een winnende Aas wordt er niet gedeeld: ' + JSON.stringify(r));
  // Met "2 verslaat Aas" wint de 2: ook dan geen Heer die wint.
  r = play([['K', '4'], ['Q', '7'], ['A', '5'], ['2', '8']], { twoBeatsAce: true });
  if (r.shared.length !== 0) failures.push('Koninklijk gezin: met 2 verslaat Aas wint de 2 en wordt er niet gedeeld: ' + JSON.stringify(r));
  // Met "Gelijke kaarten gaan voor" battlen de zevens, dus ook dan geen Heer die wint.
  r = play([['K', '4'], ['Q', '7'], ['7', '5', '6'], ['7', '8', '3']], { battleFirst: true });
  if (r.shared.length !== 0) failures.push('Koninklijk gezin: met Gelijke kaarten gaan voor wint een zeven en wordt er niet gedeeld: ' + JSON.stringify(r));
  // Zeldzaam: in een battle hebben alle spelers geen kaart meer, dus niemand wint. De pot gaat dan naar de eerste speler die nog meedoet,
  // ook als die met een Heer begon en er een Vrouw ligt: er is geen winnende Heer, dus er wordt niet gedeeld.
  r = play([['K', '4'], ['Q', '7'], ['7'], ['7']], { battleFirst: true });
  if (!same(r.after, [['4', 'K', 'Q', '7', '7'], ['7'], [], []])) failures.push('Koninklijk gezin: als niemand een battle wint, wordt de pot niet gedeeld: ' + JSON.stringify(r));
  // Twee Vrouwen en een Heer die direct wint (zonder battle): de Heer en beide Vrouwen delen de pot van drie, elk één kaart.
  r = play([['Q', '9', '2'], ['Q', '5', '3'], ['K', '6', '4']]);
  if (!same(r.shared, [2, 0, 1]) || !same(r.after, [['9', '2', 'Q'], ['5', '3', 'Q'], ['6', '4', 'K']])) failures.push('Koninklijk gezin: een Heer met twee Vrouwen klopt niet: ' + JSON.stringify(r));
  // Statistieken: een gedeelde ronde telt voor allebei de winnaars, en de ronde zelf maar één keer.
  const st = JSON.parse(run(`(() => { statsResetAll(); statsRecordRoundWin([0, 2], { 0: 1, 1: 2, 2: 3 }); statsRecordRoundWin(1, { 0: 1, 1: 2, 2: 3 });
    return JSON.stringify({ wins: statsWins, rounds: statsRoundCount }); })()`));
  if (!same(st.wins, { 0: 1, 2: 1, 1: 1 }) || st.rounds !== 2) failures.push('Koninklijk gezin: statistieken voor een gedeelde winst kloppen niet: ' + JSON.stringify(st));
  // De simulatie meldt wie samen wonnen, zodat doorspoelen de statistieken goed vult.
  const trace = JSON.parse(run(`JSON.stringify((() => { const mk = (id, ranks) => ({ id, name: 'S' + id, deck: ranks.map(r => ({ rank: r, suit: '♠', value: RANKS.indexOf(r) + 2 })), out: false });
    const res = simulateFullTrace([mk(0, ['K', '4', '2']), mk(1, ['Q', '7', '3']), mk(2, ['9', '5', '6'])], 1, { royalFamily: true });
    return res.trace.find(e => e.type === 'win'); })())`));
  if (!same(trace.winnerIds, [0, 1]) || trace.winnerId !== 0) failures.push('Koninklijk gezin: de simulatie meldt niet wie samen won: ' + JSON.stringify(trace));
  // Altijd 52 unieke kaarten, en in genoeg spellen wordt er echt gedeeld.
  const rf = { games: 0, shared: 0 };
  for (const ids of [['royalFamily'], ['royalFamily', 'battleDiscard'], ['royalFamily', 'secondChance'], ['royalFamily', 'twoBeatsAce', 'battleFirst']]) for (const n of [2, 3, 4, 6, 8]) for (const seed of ['r1', 'r2', 'r3', 'r4']){
    const c = conserveCheck(ids, n, seed, 300);
    if (!c.ok) failures.push('Koninklijk gezin (' + ids.join('+') + ', ' + n + ' spelers, seed ' + seed + '): na ronde ' + c.round + ' zijn er ' + c.total + ' kaarten (' + c.uniek + ' verschillende) in plaats van 52');
    else { rf.games++; if (c.shared > 0) rf.shared++; }
  }
  if (rf.shared < 15) failures.push('Koninklijk gezin: in te weinig spellen is er een pot gedeeld om iets te bewijzen (' + rf.shared + ' van ' + rf.games + ')');
}
withFake(() => {
  let used = 0;
  for (const ids of [['testBattleDiscard'], ['testRoundDiscard'], ['testBattleDiscard', 'testRoundDiscard'], ['testBattleDiscard', 'testRevive'], ['testRescueLeft'], ['testRescueRight'], ['testRescueRich'], ['testBattleDiscard', 'testRescueRich']]){
    for (const n of [2, 3, 4, 8]) for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5']){
      const r = conserveCheck(ids, n, seed, 400);
      if (!r.ok) failures.push('aflegstapel (' + ids.join('+') + ', ' + n + ' spelers, seed ' + seed + '): na ronde ' + r.round + ' zijn er ' + r.total + ' kaarten (' + r.uniek + ' verschillende) in plaats van 52');
      else {
        if (r.maxDiscard > 0 && discardStats.used[ids.join('+')] !== undefined){ used++; discardStats.used[ids.join('+')]++; }
        discardStats.revives += r.revives; if (r.revives > 0) discardStats.reviveGames++;
        if (ids.length === 1 && discardStats.transferGames[ids[0]] !== undefined && r.transfers > 0) discardStats.transferGames[ids[0]]++;
      }
    }
  }
  if (discardStats.reviveGames < 3) failures.push('aflegstapel: de nagemaakte terugkeer-regel heeft in te weinig spellen een speler terug laten komen (' + discardStats.reviveGames + ')');
  for (const k of Object.keys(discardStats.transferGames)) if (discardStats.transferGames[k] < 10) failures.push('overdracht: de nagemaakte regel "' + k + '" heeft in te weinig spellen kaarten overgedragen om iets te bewijzen (' + discardStats.transferGames[k] + ' van 20)');
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

  // 4b. Terugkomen: de gebeurtenis meldt wie er terug is, en de haak aan het einde van de ronde kan een speler redden
  // voordat het spel voorbij is.
  const evRevive = JSON.parse(run(`(() => { const st = __state([['A♠'], [], ['K♠']]); st.players[1].out = true; st.rules = Object.assign({}, st.rules, { testRevive: true });
    engineDiscardCards(st, [__card('4', '♦')]); const end = engineEndRound(st);
    return JSON.stringify({ revived: end.revived.map(p => p.id), out: st.players[1].out, deck: st.players[1].deck.length, gameOver: end.gameOver }); })()`));
  if (JSON.stringify(evRevive.revived) !== '[1]' || evRevive.out !== false || evRevive.deck !== 1 || evRevive.gameOver !== false) failures.push('einde ronde: terugkomen klopt niet: ' + JSON.stringify(evRevive));
  const saved = JSON.parse(run(`(() => { const make = rules => { const st = __state([['A♠', 'K♠'], [], []]); st.players[1].out = true; st.players[2].out = true; st.rules = Object.assign({}, st.rules, rules);
      engineDiscardCards(st, [__card('4', '♦')]); return engineEndRound(st).gameOver; };
    return JSON.stringify({ zonder: make({}), met: make({ testRevive: true }) }); })()`));
  if (saved.zonder !== true || saved.met !== false) failures.push('einde ronde: een regel die een speler terugbrengt moet het einde van het spel kunnen voorkomen: ' + JSON.stringify(saved));
  const notes = JSON.parse(run(`JSON.stringify([revivedNote([]), revivedNote([{ name: 'Anna' }]), revivedNote([{ name: 'Anna' }, { name: 'Bram' }])])`));
  if (JSON.stringify(notes) !== JSON.stringify(['', 'Anna doet weer mee.', 'Anna en Bram doen weer mee.'])) failures.push('melding bij terugkomen klopt niet: ' + JSON.stringify(notes));

  // 4c. Overdracht: de gebeurtenis meldt wie wat aan wie gaf, een regel aan het einde van de ronde kan redden
  // (ook een speler die net zijn laatste kaart speelde) en het einde van het spel voorkomen, en de meldingen kloppen.
  const evGive = JSON.parse(run(`(() => { const st = __state([['A♠', 'K♠'], [], ['Q♠'], []]); st.players[3].out = true; st.rules = Object.assign({}, st.rules, { testRescueLeft: true });
    const end = engineEndRound(st);
    return JSON.stringify({ transfers: end.transfers.map(t => [t.from.id, t.to.id, t.count]), revived: end.revived.map(p => p.id), out: st.players.map(p => p.out), decks: st.players.map(p => p.deck.length) }); })()`));
  if (JSON.stringify(evGive) !== JSON.stringify({ transfers: [[2, 1, 1], [0, 3, 1]], revived: [3], out: [false, false, true, false], decks: [1, 1, 0, 1] }))
    failures.push('einde ronde met overdracht klopt niet: ' + JSON.stringify(evGive));
  const savedGive = JSON.parse(run(`(() => { const make = rules => { const st = __state([['A♠', 'K♠'], [], []]); st.players[1].out = true; st.players[2].out = true; st.rules = Object.assign({}, st.rules, rules);
      return engineEndRound(st).gameOver; };
    return JSON.stringify({ zonder: make({}), met: make({ testRescueLeft: true }) }); })()`));
  if (savedGive.zonder !== true || savedGive.met !== false) failures.push('een regel die kaarten geeft moet het einde van het spel kunnen voorkomen: ' + JSON.stringify(savedGive));
  const tnotes = JSON.parse(run(`JSON.stringify([transferNote([]), transferNote([{ from: { name: 'Anna' }, to: { name: 'Bram' }, count: 1 }]),
    transferNote([{ from: { name: 'Anna' }, to: { name: 'Bram' }, count: 3 }, { from: { name: 'Bram' }, to: { name: 'Cor' }, count: 1 }])])`));
  if (JSON.stringify(tnotes) !== JSON.stringify(['', 'Anna geeft 1 kaart aan Bram.', 'Anna geeft 3 kaarten aan Bram. Bram geeft 1 kaart aan Cor.'])) failures.push('melding bij overdracht klopt niet: ' + JSON.stringify(tnotes));

  // 5. Simulatie, zichtbaar spel en fast-forward komen op dezelfde stand uit (stapels én aflegstapel).
  let compared = 0;
  const seedField = document.getElementById('seedInput');
  for (const n of [2, 3, 4, 8]) for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']){
    for (const ids of [['testBattleDiscard'], ['testRoundDiscard'], ['testBattleDiscard', 'testRevive'], ['testRescueLeft'], ['testRescueRight'], ['testRescueRich']]){
      const id = ids.join('+');
      document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
      for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = false;
      for (const fid of FAKE_IDS) document.getElementById(fid + 'Input').checked = ids.includes(fid);
      seedField.value = seed;
      run('numPlayers = ' + n + '; dealNewGame();');
      const sim = JSON.parse(run(`(() => { const r = simulateFullTrace(players, 3000, game.rules);
        return JSON.stringify({ o: r.outcome, rounds: r.rounds, decks: r.finalPlayers.map(p => p.deck.length), discard: __names(r.finalDiscard) }); })()`));
      if (sim.o !== 'win' || sim.rounds > 400) continue;
      run('numPlayers = ' + n + '; dealNewGame();');
      const live = JSON.parse(run(`(() => { launchGame(); let i = 0, note = false, give = false; while (phase !== 'game-over' && phase !== 'cycle-over' && i < 20000){ advance(); i++;
          const t = document.getElementById('dispatch').textContent; if (/weer mee/.test(t)) note = true; if (/ geeft \\d+ kaart/.test(t)) give = true; }
        return JSON.stringify({ phase, decks: players.map(p => p.deck.length), discard: __names(game.discard), revives: game.moved.revived.length, transfers: game.moved.transfers.length, note, give }); })()`));
      discardStats.liveTransfers = (discardStats.liveTransfers || 0) + (ids[0].startsWith('testRescue') ? live.transfers : 0);
      if (ids[0].startsWith('testRescue') && live.transfers > 0 && !live.give) failures.push('overdracht: er werden kaarten gegeven maar het spel meldde dat niet (' + id + ', ' + n + ' spelers, seed ' + seed + ')');
      if (ids[0].startsWith('testRescue') && live.revives > 0 && !live.note) failures.push('overdracht: een speler kwam terug maar het spel meldde dat niet (' + id + ', ' + n + ' spelers, seed ' + seed + ')');
      if (ids.includes('testRevive') && live.revives > 0 && !live.note) failures.push('aflegstapel: een speler kwam terug maar het spel meldde dat niet (' + n + ' spelers, seed ' + seed + ')');
      discardStats.liveRevives = (discardStats.liveRevives || 0) + (ids.includes('testRevive') ? live.revives : 0);
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
  // Hier gaat het om de stand van het spel, niet om het tekenen: dat staat tijdelijk uit zodat lange spellen snel gaan.
  run('globalThis.__orig = { renderGrid, showStamp, setDispatch }; renderGrid = () => {}; showStamp = () => {}; setDispatch = () => {};');
  let midGame = 0;
  own('ff-fake', () => {
    // Met de terugkeer-regel duren spellen met 8 spelers erg lang; daar zijn 3 en 4 spelers genoeg voor.
    for (const ids of [['testBattleDiscard'], ['testBattleDiscard', 'testRevive'], ['testLimited'], ['testBattleDiscard', 'testRescueLeft']]) for (const n of (ids.length > 1 || ids[0] === 'testLimited' ? [3, 4] : [3, 4, 8])) for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']){
      document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
      for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = false;
      for (const fid of FAKE_IDS) document.getElementById(fid + 'Input').checked = ids.includes(fid);
      seedField.value = seed;
      const snap = JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); let i = 0; while (i < 800 && !(phase === \'round-over\' && game.discard.length > 0) && phase !== \'game-over\' && phase !== \'cycle-over\'){ advance(); i++; } return JSON.stringify({ steps: i, phase, discard: game.discard.length }); })()'));
      if (snap.phase !== 'round-over') continue;
      const ffEnd = JSON.parse(run(`(() => { const had = game.discard.length; fastForward(); const total = players.reduce((s, p) => s + p.deck.length, 0) + game.pot.length + game.discard.length;
        return JSON.stringify({ had, total, phase, decks: players.map(p => p.deck.length), discard: __names(game.discard) }); })()`));
      const liveEnd = ffEnd.phase !== 'game-over' ? null : JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); for (let i = 0; i < ' + snap.steps + '; i++) advance(); let j = 0; while (phase !== \'game-over\' && phase !== \'cycle-over\' && j < 20000){ advance(); j++; } return JSON.stringify({ phase, decks: players.map(p => p.deck.length), discard: __names(game.discard) }); })()'));
      midGame++;
      const label = ids.join('+') + ', ' + n + ' spelers, seed ' + seed + ' (fast-forward na ' + snap.steps + ' stappen, ' + ffEnd.had + ' afgelegd)';
      if (ffEnd.total !== 52) failures.push('fast-forward midden in een spel verliest kaarten (' + label + '): ' + ffEnd.total + ' in plaats van 52');
      if (liveEnd && (liveEnd.phase !== 'game-over' || JSON.stringify(ffEnd.decks) !== JSON.stringify(liveEnd.decks) || JSON.stringify(ffEnd.discard) !== JSON.stringify(liveEnd.discard)))
        failures.push('fast-forward midden in een spel wijkt af van zelf uitspelen (' + label + ')');
    }
    if (midGame < 6) failures.push('aflegstapel: te weinig spellen om fast-forward midden in een spel te testen (' + midGame + ')');
    discardStats.midGame = midGame;
  });
  // Hetzelfde voor de echte regel "Tweede kans": doorspoelen vanaf het moment dat er een kaart is overgedragen.
  own('ff-secondChance', () => {
    let midSC = 0;
    for (const ids of [['secondChance'], ['secondChance', 'battleDiscard'], ['secondChance', 'twoBeatsAce']]) for (const n of [4, 5]) for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6']){
      document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
      for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = ids.includes(r.id);
      for (const fid of FAKE_IDS) document.getElementById(fid + 'Input').checked = false;
      seedField.value = seed;
      const snap = JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); let i = 0; while (i < 800 && !(phase === \'round-over\' && game.moved.transfers.length > 0) && phase !== \'game-over\' && phase !== \'cycle-over\'){ advance(); i++; } return JSON.stringify({ steps: i, phase, transfers: game.moved.transfers.length }); })()'));
      if (snap.phase !== 'round-over') continue;
      const ffEnd = JSON.parse(run(`(() => { fastForward(); const total = players.reduce((s, p) => s + p.deck.length, 0) + game.pot.length + game.discard.length;
        return JSON.stringify({ total, phase, decks: players.map(p => p.deck.length) }); })()`));
      const liveEnd = ffEnd.phase !== 'game-over' ? null : JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); for (let i = 0; i < ' + snap.steps + '; i++) advance(); let j = 0; while (phase !== \'game-over\' && phase !== \'cycle-over\' && j < 20000){ advance(); j++; } return JSON.stringify({ phase, decks: players.map(p => p.deck.length) }); })()'));
      midSC++;
      const label = ids.join('+') + ', ' + n + ' spelers, seed ' + seed + ' (na ' + snap.steps + ' stappen)';
      if (ffEnd.total !== 52) failures.push('Tweede kans: fast-forward midden in een spel verliest kaarten (' + label + '): ' + ffEnd.total);
      if (liveEnd && (liveEnd.phase !== 'game-over' || JSON.stringify(ffEnd.decks) !== JSON.stringify(liveEnd.decks))) failures.push('Tweede kans: fast-forward midden in een spel wijkt af van zelf uitspelen (' + label + ')');
    }
    if (midSC < 8) failures.push('Tweede kans: te weinig spellen om fast-forward midden in een spel te testen (' + midSC + ')');
  });
  // Hetzelfde voor "Koninklijk gezin", vanaf het moment dat er een pot is gedeeld; en de tekst van het spel meldt dat ze samen winnen.
  own('ff-royalFamily', () => {
    let midRF = 0, rfText = 0;
    run('setDispatch = __orig.setDispatch;'); // de tekst van het spel moet bijgewerkt worden
    for (const ids of [['royalFamily'], ['royalFamily', 'battleDiscard'], ['royalFamily', 'secondChance']]) for (const n of [3, 4]) for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']){
      document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
      for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = ids.includes(r.id);
      for (const fid of FAKE_IDS) document.getElementById(fid + 'Input').checked = false;
      seedField.value = seed;
      const snap = JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); let i = 0; while (i < 800 && !(phase === \'round-over\' && game.moved.shared.length > 0) && phase !== \'game-over\' && phase !== \'cycle-over\'){ advance(); i++; } return JSON.stringify({ steps: i, phase, text: document.getElementById(\'dispatch\').textContent }); })()'));
      if (snap.phase !== 'round-over') continue;
      if (/winnen samen: .+ krijgt \d+ kaart(en)?/.test(snap.text)) rfText++; else failures.push('Koninklijk gezin: de tekst meldt niet dat ze samen winnen: "' + snap.text + '"');
      const ffEnd = JSON.parse(run(`(() => { fastForward(); const total = players.reduce((s, p) => s + p.deck.length, 0) + game.pot.length + game.discard.length;
        return JSON.stringify({ total, phase, decks: players.map(p => p.deck.length) }); })()`));
      const liveEnd = ffEnd.phase !== 'game-over' ? null : JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); for (let i = 0; i < ' + snap.steps + '; i++) advance(); let j = 0; while (phase !== \'game-over\' && phase !== \'cycle-over\' && j < 20000){ advance(); j++; } return JSON.stringify({ phase, decks: players.map(p => p.deck.length) }); })()'));
      midRF++;
      const label = ids.join('+') + ', ' + n + ' spelers, seed ' + seed + ' (na ' + snap.steps + ' stappen)';
      if (ffEnd.total !== 52) failures.push('Koninklijk gezin: fast-forward midden in een spel verliest kaarten (' + label + '): ' + ffEnd.total);
      if (liveEnd && (liveEnd.phase !== 'game-over' || JSON.stringify(ffEnd.decks) !== JSON.stringify(liveEnd.decks))) failures.push('Koninklijk gezin: fast-forward midden in een spel wijkt af van zelf uitspelen (' + label + ')');
    }
    if (midRF < 8) failures.push('Koninklijk gezin: te weinig spellen om fast-forward midden in een spel te testen (' + midRF + ')');
    run('setDispatch = () => {};');
  });
  for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = false;
  for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = false;
  run('renderGrid = __orig.renderGrid; showStamp = __orig.showStamp; setDispatch = __orig.setDispatch;');

  if ((discardStats.liveRevives || 0) < 3) failures.push('aflegstapel: in de vergeleken spellen kwam te weinig een speler terug om simulatie, zichtbaar spel en fast-forward daarop te vergelijken (' + (discardStats.liveRevives || 0) + ')');
  if ((discardStats.liveTransfers || 0) < 10) failures.push('overdracht: in de vergeleken spellen werden te weinig kaarten overgedragen om simulatie, zichtbaar spel en fast-forward daarop te vergelijken (' + (discardStats.liveTransfers || 0) + ')');
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
run(`globalThis.__scn = (decks, rules) => {
  const st = createGameState(decks.map((d, i) => ({ id: i, name: 'S' + i, deck: d.map(r => ({ rank: r, suit: '♠', value: RANKS.indexOf(r) + 2 })) })), rules);
  enginePlayRound(st);
  return { after: st.players.map(p => p.deck.map(c => c.rank)), discarded: st.discard.length };
}`);
for (const r of CATALOG){
  for (const ex of r.examples || []){
    exampleCount++;
    const rules = {};
    for (const id of RULE_IDS) rules[id] = id === r.id || (ex.with || []).includes(id);
    if (Array.isArray(ex.decks)){
      const got = JSON.parse(run('JSON.stringify(__scn(' + JSON.stringify(ex.decks) + ', ' + JSON.stringify(rules) + '))'));
      if (JSON.stringify(got.after) !== JSON.stringify(ex.after) || got.discarded !== ex.discarded)
        failures.push('voorbeeld bij "' + r.title + '" (stapels ' + JSON.stringify(ex.decks) + '): het regelboek zegt ' + JSON.stringify({ after: ex.after, discarded: ex.discarded }) + ', het spel doet ' + JSON.stringify(got));
      continue;
    }
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

own('fixed', () => {
  for (const c of cases){
    document.getElementById("seedInput").value = c.seed;
    for (const id of RULE_IDS) document.getElementById(id + 'Input').checked = RULE_SETS[c.rules][id];
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

  // Elke regel moet in de vaste spellen echt iets veranderen; anders worden de vinkjes niet doorgegeven of doet de regel niets.
  for (const id of RULE_IDS){
    const partner = c => Object.keys(RULE_SETS).find(k => JSON.stringify(RULE_SETS[k]) === JSON.stringify({ ...RULE_SETS[c.rules], [id]: false }));
    const changed = cases.filter(c => RULE_SETS[c.rules][id] && partner(c) && actual[key(c)] && actual[key({ ...c, rules: partner(c) })] &&
      JSON.stringify(actual[key(c)]) !== JSON.stringify(actual[key({ ...c, rules: partner(c) })])).length;
    if (changed === 0) failures.push('regel "' + id + '" verandert in geen enkel vast spel iets');
  }

  if (update){
    fs.writeFileSync(expectedFile, JSON.stringify(actual, null, 1) + '\n');
    console.log('tests/expected.json bijgewerkt (' + cases.length + ' gevallen).');
    process.exit(0);
  }
  for (const k of Object.keys(expected)) if (!actual[k]) failures.push(k + ': staat in expected.json maar wordt niet meer getest');
});

// Tellers voor de samenvatting. Wat in de snelle controles wordt geteld, telt alleen het proces dat 'rest' heeft (anders tellen ze dubbel
// als de processen worden samengevoegd); de tellers van de zware onderdelen zijn alleen gevuld bij het proces dat ze draait.
const counts = {
  scripts: owns('rest') ? scripts.length : 0, rules: owns('rest') ? CATALOG.length : 0, base: owns('rest') ? BASE.length : 0, examples: owns('rest') ? exampleCount : 0,
  cases: owns('rest') ? cases.length : 0, live: liveChecked, used: owns('rest') ? Object.values(discardStats.used).reduce((a, b) => a + b, 0) : 0,
  reviveGames: owns('rest') ? discardStats.reviveGames : 0, compared: owns('rest') ? discardStats.compared : 0, midGame: discardStats.midGame || 0
};
// Als onderdeel van smoke.js (met --shard) geven we de uitkomst als gegevens terug; los gestart tonen we hem zoals smoke.js.
if (shardArg){
  console.log('@@SMOKE@@' + JSON.stringify({ failures, counts }));
  process.exit(0);
}
const report = require('./smoke-report');
console.log(report.summaryLine(counts));
if (failures.length){
  console.error(report.failureText(failures));
  process.exit(1);
}
console.log('Alles in orde.');
