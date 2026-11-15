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
    return { phase, decks: game.players.map(p => p.deck.length) };
  })()`);
}

// Regelcombinaties, afgeleid uit de catalogus RULES (rules.js): geen, elke regel apart, alle paren en alle regels aan.
// De namen zijn de sleutels in tests/expected.json: 'standard' (geen extra regels) of de ids van
// de regels die aan staan, in catalogusvolgorde, gescheiden door '+'.
const CATALOG = JSON.parse(run(`JSON.stringify(RULES.map(r => ({
  id: r.id, priority: r.priority, title: r.title, short: r.short, description: r.description,
  default: r.default, examples: r.examples, hasDecide: typeof r.decide === 'function' || typeof r.breakTie === 'function',
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
  run('game = { players: [{ id: 0, name: ' + JSON.stringify(evil) + ', deck: [] }, { id: 1, name: "Bram", deck: [] }] }; renderStatsLegend(); renderStatsSummary();');
  for (const id of ['statsLegend', 'statsSummary']){
    const el = document.getElementById(id);
    if (el.innerHTML !== '' || !textIn(el).includes(evil)) failures.push('een naam met HTML in de statistieken (' + id + ') wordt als HTML gelezen of ontbreekt: ' + JSON.stringify(el.innerHTML) + ' / ' + JSON.stringify(textIn(el)));
  }
  const sumText = textIn(document.getElementById('statsSummary'));
  if (!/Totaal battles:/.test(sumText) || !/Bram: /.test(sumText)) failures.push('de samenvatting van de statistieken toont niet alle regels: ' + JSON.stringify(sumText));
  run('game = null;');
}

// ---- kaarten van het thema Bóbr (css/cards-bobr.css en img/bobr) ----
{
  // Elke kaart heeft een eigen sleutel, een eigen regel en een bestaand bestand; er zijn geen regels te veel.
  const keys = JSON.parse(run('JSON.stringify(buildDeck().map(cardKey))'));
  if (keys.length !== 52 || new Set(keys).size !== 52) failures.push('cardKey: geen 52 verschillende sleutels: ' + JSON.stringify(keys));
  const css = fs.readFileSync(path.join(root, 'css/cards-bobr.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/\[data-card="([^"]+)"\]\s*\{\s*background-image:\s*url\("\.\.\/([^"]+)"\)/g)].map(m => ({ key: m[1], file: m[2] }));
  const ruleKeys = rules.map(r => r.key);
  const missing = keys.filter(k => !ruleKeys.includes(k)), extra = ruleKeys.filter(k => !keys.includes(k));
  if (missing.length || extra.length || new Set(ruleKeys).size !== ruleKeys.length) failures.push('css/cards-bobr.css: mist ' + JSON.stringify(missing) + ', te veel of dubbel ' + JSON.stringify(extra.concat(ruleKeys.filter((k, i) => ruleKeys.indexOf(k) !== i))));
  const files = rules.map(r => r.file);
  if (new Set(files).size !== files.length) failures.push('css/cards-bobr.css: twee kaarten gebruiken hetzelfde bestand');
  for (const f of files) if (!fs.existsSync(path.join(root, f))) failures.push('css/cards-bobr.css: bestand ' + f + ' bestaat niet');
  // Een SVG als achtergrond laadt geen lettertypes: tekst hoort als pad in het bestand te staan.
  for (const f of files) if (fs.existsSync(path.join(root, f)) && /<text\b/.test(fs.readFileSync(path.join(root, f), 'utf8'))) failures.push(f + ' bevat <text>: zet de tekst om naar paden');
}

// ---- kaartafbeeldingen alvast ophalen (js/theme.js) ----
{
  const fail = t => failures.push('voorladen: ' + t);
  const css = fs.readFileSync(path.join(root, 'css/cards-bobr.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const cssFiles = [...css.matchAll(/url\("\.\.\/([^"]+)"\)/g)].map(m => m[1]);
  const urls = JSON.parse(run('JSON.stringify(themeCardUrls("bobr"))'));
  if (urls.length !== 52 || new Set(urls).size !== 52) fail('Bóbr hoort 52 verschillende afbeeldingen voor te laden, kreeg ' + urls.length);
  // De lijst in theme.js moet precies de bestanden zijn die css/cards-bobr.css gebruikt, anders blijft een kaart leeg of wordt er te veel geladen.
  const missing = cssFiles.filter(f => !urls.includes(f)), extra = urls.filter(f => !cssFiles.includes(f));
  if (missing.length || extra.length) fail('THEME_CARD_FILES komt niet overeen met css/cards-bobr.css: mist ' + JSON.stringify(missing) + ', te veel ' + JSON.stringify(extra));
  for (const t of ['oorlog', 'sovjet', 'semechki']) if (run('themeCardUrls(' + JSON.stringify(t) + ').length') !== 0) fail('het thema ' + t + ' heeft geen eigen kaarten en hoort niets voor te laden');
  // Kiezen van Bóbr haalt de afbeeldingen één keer alvast op; andere thema's niets.
  run('globalThis.__loaded = []; globalThis.Image = function(){ const img = this; Object.defineProperty(img, "src", { set(v){ __loaded.push(v); } }); };');
  try {
    run('applyTheme("sovjet")');
    if (run('__loaded.length') !== 0) fail('een thema zonder eigen kaarten hoort niets op te halen');
    run('applyTheme("bobr")');
    const got = JSON.parse(run('JSON.stringify(__loaded)'));
    if (got.length !== 52 || JSON.stringify(got.slice().sort()) !== JSON.stringify(urls.slice().sort())) fail('het kiezen van Bóbr hoort alle 52 afbeeldingen op te halen, kreeg ' + got.length);
    run('applyTheme("oorlog"); applyTheme("bobr");');
    if (run('__loaded.length') !== 52) fail('de afbeeldingen horen maar één keer per pagina opgehaald te worden (' + run('__loaded.length') + ')');
  } finally {
    run('delete globalThis.Image; delete globalThis.__loaded; themeCardsLoaded.clear(); applyTheme("oorlog");');
  }
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

// Het venster voor eigen regels staat in index.html.
for (const id of ['customRuleBtn', 'customRuleStatus', 'customRule', 'customRuleInner', 'customRuleClose', 'customRuleText', 'customRuleSample', 'customRuleCheck', 'customRuleMessages',
  'customTrialGames', 'customTrialBase', 'customRuleTrialBtn', 'customRuleAdd', 'customRuleProgress', 'customRuleReport', 'customRuleAdded']){
  if (!pageHtml.includes('id="' + id + '"')) failures.push('index.html mist het element met id ' + id + ' (venster voor eigen regels)');
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
  return run('numPlayers = 4; dealNewGame(); JSON.stringify(game.players.map(p => p.deck.map(c => c.rank + c.suit)))'); };
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
run(`globalThis.shuffleWith = seed => { return shuffle(buildDeck(), mulberry32(hashSeed(seed))); };`);
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
// De echte regel "Revival": wie zonder kaarten valt krijgt de bovenste kaart van de linkerbuur, zolang minstens 2 spelers kaarten hebben.
{
  const end = (decks, outIdx) => JSON.parse(run(`(() => { const st = __state(${JSON.stringify(decks)}); st.rules = Object.assign({}, st.rules, { secondChance: true });
    for (const i of ${JSON.stringify(outIdx || [])}) st.players[i].out = true;
    const e = engineEndRound(st);
    return JSON.stringify({ decks: st.players.map(p => p.deck.map(c => c.rank)), out: st.players.map(p => p.out), transfers: e.transfers.map(t => [t.from.id, t.to.id, t.count]),
      revived: e.revived.map(p => p.id), gameOver: e.gameOver, moved: st.moved.transferred }); })()`));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Eén speler zonder kaarten: de bovenste kaart van de linkerbuur (speler 3, want speler 1 zit rechts van speler 2).
  let r = end([['A'], [], ['K', 'Q'], ['J']]);
  if (!same(r.decks, [['A'], ['K'], ['Q'], ['J']]) || !same(r.transfers, [[2, 1, 1]]) || r.out.some(Boolean)) failures.push('Revival: één speler zonder kaarten klopt niet: ' + JSON.stringify(r));
  // Een speler die al uit lag komt terug.
  r = end([['A'], [], ['K', 'Q'], ['J']], [1]);
  if (r.out[1] !== false || !same(r.revived, [1])) failures.push('Revival: een uitgeschakelde speler hoort terug te komen: ' + JSON.stringify(r));
  // Precies 2 spelers met kaarten (zoals bij 3 spelers van wie er één afvalt): de regel werkt nog. De speler zonder kaarten krijgt de bovenste
  // kaart van de linkerbuur; die heeft dan geen kaart meer en valt zelf af.
  r = end([['A'], [], ['K']]);
  if (!same(r.decks, [['A'], ['K'], []]) || !same(r.transfers, [[2, 1, 1]]) || !same(r.out, [false, false, true]) || r.gameOver) failures.push('Revival: met 2 spelers met kaarten (bij 3 spelers) hoort de regel te werken: ' + JSON.stringify(r));
  // Vier spelers, twee zonder kaarten: beiden krijgen een kaart (de gevers worden vooraf bepaald) en het spel gaat door met twee spelers.
  r = end([['A'], [], ['K'], []]);
  if (!same(r.transfers, [[2, 1, 1], [0, 3, 1]]) || !same(r.decks, [[], ['K'], [], ['A']]) || r.gameOver || !same(r.out, [true, false, true, false])) failures.push('Revival: twee spelers zonder kaarten bij 2 spelers met kaarten klopt niet: ' + JSON.stringify(r));
  // Nog maar 1 speler met kaarten: niemand komt terug en het spel is voorbij.
  r = end([['A'], [], [], []]);
  if (r.transfers.length !== 0 || !r.gameOver) failures.push('Revival: met 1 speler met kaarten is het spel voorbij: ' + JSON.stringify(r));
  // Precies 3 spelers met kaarten (hier ook voor de laatste speler van de tafel, die van speler 1 krijgt: de tafel is een kring).
  r = end([['A'], [], ['K', 'Q'], ['J'], []]);
  if (!same(r.transfers, [[2, 1, 1], [0, 4, 1]]) || !same(r.decks, [[], ['K'], ['Q'], ['J'], ['A']]) || r.out[0] !== true || r.out[4] !== false)
    failures.push('Revival: bij precies 3 spelers met kaarten (en de kring rond de tafel) klopt het niet: ' + JSON.stringify(r));
  // Spelers zonder kaarten worden overgeslagen bij het zoeken naar de linkerbuur, en twee spelers zonder kaarten gaan in tafelvolgorde.
  r = end([['A'], [], [], ['J', 'Q', 'K'], ['2']]);
  if (!same(r.decks, [['A'], ['J'], ['Q'], ['K'], ['2']]) || !same(r.transfers, [[3, 1, 1], [3, 2, 1]])) failures.push('Revival: twee spelers zonder kaarten tegelijk klopt niet: ' + JSON.stringify(r));
  // De buur heeft maar één kaart: de eerste krijgt die, de tweede krijgt niets en blijft uit.
  r = end([['A'], [], [], ['J'], ['2']]);
  if (!same(r.decks, [['A'], ['J'], [], [], ['2']]) || !same(r.transfers, [[3, 1, 1]]) || r.out[2] !== true || r.out[3] !== true || r.out[1] !== false)
    failures.push('Revival: een buur met één kaart klopt niet: ' + JSON.stringify(r));
  // Wie net een kaart kreeg, geeft die niet meteen door: de gevers worden vooraf bepaald.
  // Speler 1 en 6 vallen af (de tafel is een kring: links van speler 6 zit speler 1). Speler 1 krijgt een kaart van speler 2. Voor speler 6 telt
  // speler 1 nog niet mee als buur, want die had bij het begin geen kaarten: ook speler 6 krijgt dus een kaart van speler 2.
  r = end([[], ['K', 'Q'], ['A'], ['J'], ['2'], []]);
  if (!same(r.transfers, [[1, 0, 1], [1, 5, 1]]) || !same(r.decks, [['K'], [], ['A'], ['J'], ['2'], ['Q']])) failures.push('Revival: spelers die net een kaart kregen geven die niet door: ' + JSON.stringify(r));
  // Zonder de regel aan gebeurt er niets.
  const off = JSON.parse(run(`(() => { const st = __state([['A'], [], ['K', 'Q'], ['J']]); const e = engineEndRound(st); return JSON.stringify({ t: e.transfers.length, out: st.players.map(p => p.out) }); })()`));
  if (off.t !== 0 || off.out[1] !== true) failures.push('Revival: zonder de regel hoort er niets te gebeuren: ' + JSON.stringify(off));
  // Altijd 52 unieke kaarten, en er worden echt kaarten overgedragen (vanaf 3 spelers; met 2 spelers doet de regel niets).
  const sc = { games: 0, transfers: 0, small: 0, three: 0 };
  for (const ids of [['secondChance'], ['secondChance', 'battleDiscard'], ['secondChance', 'twoBeatsAce']]) for (const n of [2, 3, 4, 5, 6, 8]) for (const seed of ['t1', 't2', 't3', 't4']){
    const c = conserveCheck(ids, n, seed, 300);
    if (!c.ok) failures.push('Revival (' + ids.join('+') + ', ' + n + ' spelers, seed ' + seed + '): na ronde ' + c.round + ' zijn er ' + c.total + ' kaarten (' + c.uniek + ' verschillende) in plaats van 52');
    else { sc.games++; if (c.transfers > 0) sc.transfers++; if (n < 3 && c.transfers > 0) sc.small++; if (n === 3 && c.transfers > 0) sc.three++; }
  }
  if (sc.transfers < 10) failures.push('Revival: in te weinig spellen is er een kaart overgedragen om iets te bewijzen (' + sc.transfers + ' van ' + sc.games + ')');
  if (sc.small !== 0) failures.push('Revival: met 2 spelers hoort de regel niets te doen (' + sc.small + ' spellen met een overdracht)');
  if (sc.three < 3) failures.push('Revival: met 3 spelers hoort de regel soms iets te doen (' + sc.three + ' van de spellen met 3 spelers had een overdracht)');
}
// De echte regel "Koninklijk paar": wint een Heer met een Vrouw op tafel, dan winnen ze samen en kiest de Heer eerst.
{
  run(`globalThis.__play = (decks, rules) => { const st = createGameState(decks.map((d, i) => ({ id: i, name: 'S' + i, deck: d.map(r => ({ rank: r, suit: '♠', value: RANKS.indexOf(r) + 2 })) })), rules);
    const r = enginePlayRound(st); return JSON.stringify({ after: st.players.map(p => p.deck.map(c => c.rank)), discarded: st.discard.length, shared: r.shared, counts: st.moved.shared.map(x => [x.to, x.count]) }); }`);
  const play = (decks, rules) => JSON.parse(run('__play(' + JSON.stringify(decks) + ', ' + JSON.stringify(Object.assign({ royalFamily: true }, rules || {})) + ')'));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Een even pot: evenveel kaarten (2 en 2), de Heer krijgt de hoogste.
  let r = play([['K', '4'], ['Q', '7'], ['9', '5'], ['2', '8']]);
  if (!same(r.counts, [[0, 2], [1, 2]]) || !same(r.after, [['4', 'K', '9'], ['7', 'Q', '2'], ['5'], ['8']])) failures.push('Koninklijk paar: een even pot klopt niet: ' + JSON.stringify(r));
  // Een Vrouw die wint, deelt niet: alleen een Heer die wint, doet dat.
  r = play([['Q', '4'], ['J', '7'], ['9', '5']]);
  if (r.shared.length !== 0 || !same(r.after, [['4', 'Q', 'J', '9'], ['7'], ['5']])) failures.push('Koninklijk paar: een winnende Vrouw deelt niet: ' + JSON.stringify(r));
  // Een Heer die niet wint (de Aas wint), deelt niet.
  r = play([['K', '4'], ['Q', '7'], ['A', '5']]);
  if (r.shared.length !== 0 || !same(r.after, [['4'], ['7'], ['5', 'K', 'Q', 'A']])) failures.push('Koninklijk paar: bij een winnende Aas wordt er niet gedeeld: ' + JSON.stringify(r));
  // Met "2 verslaat Aas" wint de 2: ook dan geen Heer die wint.
  r = play([['K', '4'], ['Q', '7'], ['A', '5'], ['2', '8']], { twoBeatsAce: true });
  if (r.shared.length !== 0) failures.push('Koninklijk paar: met 2 verslaat Aas wint de 2 en wordt er niet gedeeld: ' + JSON.stringify(r));
  // Met "Gelijke kaarten gaan voor" battlen de zevens, dus ook dan geen Heer die wint.
  r = play([['K', '4'], ['Q', '7'], ['7', '5', '6'], ['7', '8', '3']], { battleFirst: true });
  if (r.shared.length !== 0) failures.push('Koninklijk paar: met Gelijke kaarten gaan voor wint een zeven en wordt er niet gedeeld: ' + JSON.stringify(r));
  // Zeldzaam: in een battle hebben alle spelers geen kaart meer, dus niemand wint. De pot gaat dan naar de eerste speler die nog meedoet,
  // ook als die met een Heer begon en er een Vrouw ligt: er is geen winnende Heer, dus er wordt niet gedeeld.
  r = play([['K', '4'], ['Q', '7'], ['7'], ['7']], { battleFirst: true });
  if (!same(r.after, [['4', 'K', 'Q', '7', '7'], ['7'], [], []])) failures.push('Koninklijk paar: als niemand een battle wint, wordt de pot niet gedeeld: ' + JSON.stringify(r));
  // Twee Vrouwen en een Heer die direct wint (zonder battle): de Heer en beide Vrouwen delen de pot van drie, elk één kaart.
  r = play([['Q', '9', '2'], ['Q', '5', '3'], ['K', '6', '4']]);
  if (!same(r.shared, [2, 0, 1]) || !same(r.after, [['9', '2', 'Q'], ['5', '3', 'Q'], ['6', '4', 'K']])) failures.push('Koninklijk paar: een Heer met twee Vrouwen klopt niet: ' + JSON.stringify(r));
  // Statistieken: een gedeelde ronde telt voor allebei de winnaars, en de ronde zelf maar één keer.
  const st = JSON.parse(run(`(() => { statsResetAll(); statsRecordRoundWin([0, 2], { 0: 1, 1: 2, 2: 3 }); statsRecordRoundWin(1, { 0: 1, 1: 2, 2: 3 });
    return JSON.stringify({ wins: statsWins, rounds: statsRoundCount }); })()`));
  if (!same(st.wins, { 0: 1, 2: 1, 1: 1 }) || st.rounds !== 2) failures.push('Koninklijk paar: statistieken voor een gedeelde winst kloppen niet: ' + JSON.stringify(st));
  // De simulatie meldt wie samen wonnen, zodat doorspoelen de statistieken goed vult.
  const trace = JSON.parse(run(`JSON.stringify((() => { const mk = (id, ranks) => ({ id, name: 'S' + id, deck: ranks.map(r => ({ rank: r, suit: '♠', value: RANKS.indexOf(r) + 2 })), out: false });
    const res = simulateFullTrace([mk(0, ['K', '4', '2']), mk(1, ['Q', '7', '3']), mk(2, ['9', '5', '6'])], 1, { royalFamily: true });
    return res.trace.find(e => e.type === 'win'); })())`));
  if (!same(trace.winnerIds, [0, 1]) || trace.winnerId !== 0) failures.push('Koninklijk paar: de simulatie meldt niet wie samen won: ' + JSON.stringify(trace));
  // Altijd 52 unieke kaarten, en in genoeg spellen wordt er echt gedeeld.
  const rf = { games: 0, shared: 0 };
  for (const ids of [['royalFamily'], ['royalFamily', 'battleDiscard'], ['royalFamily', 'secondChance'], ['royalFamily', 'twoBeatsAce', 'battleFirst']]) for (const n of [2, 3, 4, 6, 8]) for (const seed of ['r1', 'r2', 'r3', 'r4']){
    const c = conserveCheck(ids, n, seed, 300);
    if (!c.ok) failures.push('Koninklijk paar (' + ids.join('+') + ', ' + n + ' spelers, seed ' + seed + '): na ronde ' + c.round + ' zijn er ' + c.total + ' kaarten (' + c.uniek + ' verschillende) in plaats van 52');
    else { rf.games++; if (c.shared > 0) rf.shared++; }
  }
  if (rf.shared < 15) failures.push('Koninklijk paar: in te weinig spellen is er een pot gedeeld om iets te bewijzen (' + rf.shared + ' van ' + rf.games + ')');
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
      const sim = JSON.parse(run(`(() => { const r = simulateFullTrace(game.players, 3000, game.rules);
        return JSON.stringify({ o: r.outcome, rounds: r.rounds, decks: r.finalPlayers.map(p => p.deck.length), discard: __names(r.finalDiscard) }); })()`));
      if (sim.o !== 'win' || sim.rounds > 400) continue;
      run('numPlayers = ' + n + '; dealNewGame();');
      const live = JSON.parse(run(`(() => { launchGame(); let i = 0, note = false, give = false; while (phase !== 'game-over' && phase !== 'cycle-over' && i < 20000){ advance(); i++;
          const t = document.getElementById('dispatch').textContent; if (/weer mee/.test(t)) note = true; if (/ geeft \\d+ kaart/.test(t)) give = true; }
        return JSON.stringify({ phase, decks: game.players.map(p => p.deck.length), discard: __names(game.discard), revives: game.moved.revived.length, transfers: game.moved.transfers.length, note, give }); })()`));
      discardStats.liveTransfers = (discardStats.liveTransfers || 0) + (ids[0].startsWith('testRescue') ? live.transfers : 0);
      if (ids[0].startsWith('testRescue') && live.transfers > 0 && !live.give) failures.push('overdracht: er werden kaarten gegeven maar het spel meldde dat niet (' + id + ', ' + n + ' spelers, seed ' + seed + ')');
      if (ids[0].startsWith('testRescue') && live.revives > 0 && !live.note) failures.push('overdracht: een speler kwam terug maar het spel meldde dat niet (' + id + ', ' + n + ' spelers, seed ' + seed + ')');
      if (ids.includes('testRevive') && live.revives > 0 && !live.note) failures.push('aflegstapel: een speler kwam terug maar het spel meldde dat niet (' + n + ' spelers, seed ' + seed + ')');
      discardStats.liveRevives = (discardStats.liveRevives || 0) + (ids.includes('testRevive') ? live.revives : 0);
      run('numPlayers = ' + n + '; dealNewGame();');
      const ff = JSON.parse(run(`(() => { launchGame(); fastForward(); return JSON.stringify({ phase, decks: game.players.map(p => p.deck.length), discard: __names(game.discard) }); })()`));
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
      const ffEnd = JSON.parse(run(`(() => { const had = game.discard.length; fastForward(); const total = game.players.reduce((s, p) => s + p.deck.length, 0) + game.pot.length + game.discard.length;
        return JSON.stringify({ had, total, phase, decks: game.players.map(p => p.deck.length), discard: __names(game.discard) }); })()`));
      const liveEnd = ffEnd.phase !== 'game-over' ? null : JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); for (let i = 0; i < ' + snap.steps + '; i++) advance(); let j = 0; while (phase !== \'game-over\' && phase !== \'cycle-over\' && j < 20000){ advance(); j++; } return JSON.stringify({ phase, decks: game.players.map(p => p.deck.length), discard: __names(game.discard) }); })()'));
      midGame++;
      const label = ids.join('+') + ', ' + n + ' spelers, seed ' + seed + ' (fast-forward na ' + snap.steps + ' stappen, ' + ffEnd.had + ' afgelegd)';
      if (ffEnd.total !== 52) failures.push('fast-forward midden in een spel verliest kaarten (' + label + '): ' + ffEnd.total + ' in plaats van 52');
      if (liveEnd && (liveEnd.phase !== 'game-over' || JSON.stringify(ffEnd.decks) !== JSON.stringify(liveEnd.decks) || JSON.stringify(ffEnd.discard) !== JSON.stringify(liveEnd.discard)))
        failures.push('fast-forward midden in een spel wijkt af van zelf uitspelen (' + label + ')');
    }
    if (midGame < 6) failures.push('aflegstapel: te weinig spellen om fast-forward midden in een spel te testen (' + midGame + ')');
    discardStats.midGame = midGame;
  });
  // Hetzelfde voor de echte regel "Revival": doorspoelen vanaf het moment dat er een kaart is overgedragen.
  own('ff-secondChance', () => {
    let midSC = 0;
    for (const ids of [['secondChance'], ['secondChance', 'battleDiscard'], ['secondChance', 'twoBeatsAce']]) for (const n of [3, 4, 5]) for (const seed of ['s1', 's2', 's3', 's4']){
      document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
      for (const r of CATALOG) document.getElementById(r.id + 'Input').checked = ids.includes(r.id);
      for (const fid of FAKE_IDS) document.getElementById(fid + 'Input').checked = false;
      seedField.value = seed;
      const snap = JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); let i = 0; while (i < 800 && !(phase === \'round-over\' && game.moved.transfers.length > 0) && phase !== \'game-over\' && phase !== \'cycle-over\'){ advance(); i++; } return JSON.stringify({ steps: i, phase, transfers: game.moved.transfers.length }); })()'));
      if (snap.phase !== 'round-over') continue;
      const ffEnd = JSON.parse(run(`(() => { fastForward(); const total = game.players.reduce((s, p) => s + p.deck.length, 0) + game.pot.length + game.discard.length;
        return JSON.stringify({ total, phase, decks: game.players.map(p => p.deck.length) }); })()`));
      const liveEnd = ffEnd.phase !== 'game-over' ? null : JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); for (let i = 0; i < ' + snap.steps + '; i++) advance(); let j = 0; while (phase !== \'game-over\' && phase !== \'cycle-over\' && j < 20000){ advance(); j++; } return JSON.stringify({ phase, decks: game.players.map(p => p.deck.length) }); })()'));
      midSC++;
      const label = ids.join('+') + ', ' + n + ' spelers, seed ' + seed + ' (na ' + snap.steps + ' stappen)';
      if (ffEnd.total !== 52) failures.push('Revival: fast-forward midden in een spel verliest kaarten (' + label + '): ' + ffEnd.total);
      if (liveEnd && (liveEnd.phase !== 'game-over' || JSON.stringify(ffEnd.decks) !== JSON.stringify(liveEnd.decks))) failures.push('Revival: fast-forward midden in een spel wijkt af van zelf uitspelen (' + label + ')');
    }
    if (midSC < 8) failures.push('Revival: te weinig spellen om fast-forward midden in een spel te testen (' + midSC + ')');
  });
  // Hetzelfde voor "Koninklijk paar", vanaf het moment dat er een pot is gedeeld; en de tekst van het spel meldt dat ze samen winnen.
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
      if (/winnen samen: .+ krijgt \d+ kaart(en)?/.test(snap.text)) rfText++; else failures.push('Koninklijk paar: de tekst meldt niet dat ze samen winnen: "' + snap.text + '"');
      const ffEnd = JSON.parse(run(`(() => { fastForward(); const total = game.players.reduce((s, p) => s + p.deck.length, 0) + game.pot.length + game.discard.length;
        return JSON.stringify({ total, phase, decks: game.players.map(p => p.deck.length) }); })()`));
      const liveEnd = ffEnd.phase !== 'game-over' ? null : JSON.parse(run('numPlayers = ' + n + '; dealNewGame(); (() => { launchGame(); for (let i = 0; i < ' + snap.steps + '; i++) advance(); let j = 0; while (phase !== \'game-over\' && phase !== \'cycle-over\' && j < 20000){ advance(); j++; } return JSON.stringify({ phase, decks: game.players.map(p => p.deck.length) }); })()'));
      midRF++;
      const label = ids.join('+') + ', ' + n + ' spelers, seed ' + seed + ' (na ' + snap.steps + ' stappen)';
      if (ffEnd.total !== 52) failures.push('Koninklijk paar: fast-forward midden in een spel verliest kaarten (' + label + '): ' + ffEnd.total);
      if (liveEnd && (liveEnd.phase !== 'game-over' || JSON.stringify(ffEnd.decks) !== JSON.stringify(liveEnd.decks))) failures.push('Koninklijk paar: fast-forward midden in een spel wijkt af van zelf uitspelen (' + label + ')');
    }
    if (midRF < 8) failures.push('Koninklijk paar: te weinig spellen om fast-forward midden in een spel te testen (' + midRF + ')');
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
  run(`game = __state([['A♠']]); game.rules = Object.assign({}, game.rules, { testBattleDiscard: true }); updateDiscardPile();`);
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
const optionLabels = document.getElementById('rulesList').children.filter(n => (n.className || '').split(' ').includes('rule-row')).map(row => row.children[0]);
if (optionLabels.length !== CATALOG.length) failures.push('startscherm: ' + optionLabels.length + ' vinkjes voor ' + CATALOG.length + ' regels');
CATALOG.forEach((r, i) => {
  const label = optionLabels[i];
  const input = label && label.children[0], text = label && label.children[1];
  if (!input || input.id !== r.id + 'Input' || input.type !== 'checkbox') failures.push('startscherm: vinkje voor ' + r.id + ' ontbreekt of heeft een verkeerd id');
  if (!text || text.textContent !== r.title) failures.push('startscherm: naam bij het vinkje van ' + r.id + ' is niet de naam uit het regelboek');
  // De i-knop toont de volledige uitleg, en klapt die open en dicht.
  const listKids = document.getElementById('rulesList').children;
  const row = listKids.find(n => (n.className || '').split(' ').includes('rule-row') && n.children[0] === label);
  const info = row && row.children.find(n => (n.className || '').includes('rule-info-btn'));
  const panel = row && listKids[listKids.indexOf(row) + 1];
  if (!info || info.getAttribute('aria-expanded') !== 'false' || !panel || panel.textContent !== r.description || !panel.hidden)
    failures.push('startscherm: de i-knop bij ' + r.id + ' ontbreekt, of de uitleg klopt niet (' + JSON.stringify({ info: !!info, exp: info && info.getAttribute('aria-expanded'), panel: !!panel, txt: panel && panel.textContent === r.description, hidden: panel && panel.hidden, cls: row && row.className, kids: row && row.children.length }) + ')');
  else { info.handlers.click(); if (info.getAttribute('aria-expanded') !== 'true' || panel.hidden) failures.push('startscherm: de i-knop klapt de uitleg niet open bij ' + r.id); info.handlers.click(); if (!panel.hidden) failures.push('startscherm: de i-knop klapt de uitleg niet weer dicht bij ' + r.id); }
  // De browser mag vinkjes niet zelf terugzetten bij verversen (dan staan er regels aan waar geen winnaar voor gekozen heeft).
  if (!input || input.getAttribute('autocomplete') !== 'off') failures.push('startscherm: het vinkje van ' + r.id + ' hoort autocomplete="off" te hebben, anders zet de browser het bij verversen zelf terug');
});
if (!/<input[^>]*id="seedInput"[^>]*autocomplete="off"/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))) failures.push('startscherm: het seed-veld hoort autocomplete="off" te hebben, anders zet de browser een oude seed terug bij verversen');

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

// ---- Bij gelijkspel beslist het symbool ----
{
  const SB = { suitBreak: true };
  const fwSuit = (cards, rules) => run('__fw(' + JSON.stringify(cards) + ', ' + JSON.stringify(rules) + ')');
  const check = (name, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) failures.push('symbool "' + name + '": verwacht ' + JSON.stringify(exp) + ', kreeg ' + JSON.stringify(got)); };
  const only = o => Object.assign({}, OFF, o);
  check('standaardvolgorde: ♠ boven ♥', fwSuit(['K♥', 'K♠', '3♦'], only(SB)), [1]);
  check('standaardvolgorde: ♦ boven ♣', fwSuit(['K♣', 'K♦'], only(SB)), [1]);
  check('eigen volgorde ♣ ♦ ♥ ♠', fwSuit(['K♥', 'K♠'], only({ suitBreak: true, suitOrder: ['♣', '♦', '♥', '♠'] })), [0]);
  check('ongeldige volgorde (dubbel) valt terug op de standaard', fwSuit(['K♥', 'K♠'], only({ suitBreak: true, suitOrder: ['♣', '♣', '♥', '♠'] })), [1]);
  check('ongeldige volgorde (geen lijst) valt terug op de standaard', fwSuit(['K♥', 'K♠'], only({ suitBreak: true, suitOrder: 'abc' })), [1]);
  check('onbekend symbool: battle zoals gewoonlijk', fwSuit(['K', 'K♠'], only(SB)), [0, 1]);
  check('zonder regel: gewoon battle', fwSuit(['K♥', 'K♠'], OFF), [0, 1]);
  check('geen gelijkspel: niets verandert', fwSuit(['A♥', 'K♠'], only(SB)), [0]);
  check('drie gelijke: hoogste symbool wint', fwSuit(['7♣', '7♥', '7♠'], only(SB)), [2]);
  check('met gelijke kaarten gaan voor: paar beslist op symbool', fwSuit(['A♦', 'K♥', 'K♠'], only({ suitBreak: true, battleFirst: true })), [2]);
  check('met 2 verslaat Aas: twee 2\'s beslist op symbool', fwSuit(['2♦', '2♣', 'A♠'], only({ suitBreak: true, twoBeatsAce: true })), [0]);
  check('met alle drie: het hoogste paar (Azen) beslist op symbool', fwSuit(['2♥', '2♠', 'A♠', 'A♦'], only({ suitBreak: true, twoBeatsAce: true, battleFirst: true })), [2]);
  // De spelkern: geen battle, de gebeurtenis meldt het symbool, en Battle ruimt de pot op doet niets.
  const ev = JSON.parse(run(`(() => {
    const c = (rank, suit) => ({ rank, suit, value: RANKS.indexOf(rank) + 2 });
    const mk = rules => createGameState([
      { id: 0, name: 'a', deck: [c('K', '♥'), c('2', '♣')] }, { id: 1, name: 'b', deck: [c('K', '♠'), c('3', '♣')] }, { id: 2, name: 'c', deck: [c('4', '♠'), c('5', '♣')] }
    ], rules);
    const out = {};
    for (const [name, rules] of [['aan', { suitBreak: true }], ['met opruimen', { suitBreak: true, battleDiscard: true }], ['uit', {}]]){
      const st = mk(rules); engineStartRound(st); const e = engineResolve(st);
      out[name] = { type: e.type, winner: e.winner && e.winner.id, potSize: e.potSize, discarded: e.discarded, tie: e.tieBroken ? { rule: e.tieBroken.ruleId, tied: e.tieBroken.tied.map(p => p.id), suit: e.tieBroken.suit } : null, discard: st.discard.length, battles: st.battleLevel };
    }
    return JSON.stringify(out);
  })()`));
  const expTie = { type: 'win', winner: 1, potSize: 3, discarded: 0, tie: { rule: 'suitBreak', tied: [0, 1], suit: '♠' }, discard: 0, battles: 0 };
  check('spelkern met regel aan', ev['aan'], expTie);
  check('spelkern met opruimen erbij: niets afgelegd', ev['met opruimen'], expTie);
  check('spelkern zonder regel: battle', ev['uit'].type, 'battle');
  // Hele spellen: nooit een battle, altijd 52 unieke kaarten, en met opruimen erbij wordt er nooit afgelegd.
  let games = 0, ties = 0;
  for (const n of [2, 3, 4, 8]) for (const seed of ['s1', 's2', 's3', 's4']) for (const ids of [['suitBreak'], ['suitBreak', 'battleFirst'], ['suitBreak', 'twoBeatsAce'], ['suitBreak', 'battleDiscard'], ['suitBreak', 'royalFamily', 'secondChance']]){
    const r = JSON.parse(run(`(() => {
      const rules = { suitOrder: ['♥', '♣', '♠', '♦'] }; for (const id of ${JSON.stringify(ids)}) rules[id] = true;
      const deck = shuffleWith(${JSON.stringify(seed)});
      const dealt = []; for (let i = 0; i < ${n}; i++) dealt.push({ id: i, name: 'S' + i, deck: [] });
      deck.forEach((c, i) => dealt[i % ${n}].deck.push(c));
      const st = createGameState(dealt, rules); let battles = 0, ties = 0, bad = null;
      for (let r = 0; r < 300 && !bad; r++){
        if (engineActivePlayers(st).length <= 1) break;
        engineStartRound(st);
        let e = engineResolve(st);
        while (e.type === 'battle'){ battles++; e = engineLayBattleCards(st); while (e.type === 'battle-revealed') e = engineResolve(st); }
        if (e.tieBroken) ties++;
        engineEndRound(st);
        const all = [...st.players.flatMap(p => p.deck), ...st.pot, ...st.discard];
        if (all.length !== 52 || new Set(all.map(c => c.rank + c.suit)).size !== 52) bad = 'ronde ' + r + ': ' + all.length + ' kaarten';
      }
      return JSON.stringify({ battles, ties, bad, discard: st.discard.length });
    })()`));
    games++; ties += r.ties;
    const label = 'symbool-spel (' + n + ' spelers, seed ' + seed + ', ' + ids.join('+') + ')';
    if (r.bad) failures.push(label + ': ' + r.bad);
    if (r.battles !== 0) failures.push(label + ': er waren ' + r.battles + ' battles, dat hoort niet met deze regel');
    if (ids.includes('battleDiscard') && r.discard !== 0) failures.push(label + ': er is toch afgelegd (' + r.discard + ')');
  }
  if (ties < 100) failures.push('symbool: in ' + games + ' spellen slechts ' + ties + ' gelijkspellen beslist op symbool');
}

// ---- gedeelde spelstand: één bron per gegeven ----
{
  const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));
  for (const f of jsFiles){
    const lines = fs.readFileSync(path.join(root, 'js', f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      // De fase verandert alleen in setPhase (game.js): die werkt ook de knoppen bij.
      if (/(^|[^\w.])phase\s*=[^=]/.test(code) && !/^let phase = 'idle';/.test(code) && !/^\s*phase = next;/.test(code))
        failures.push('js/' + f + ':' + (i + 1) + ': de fase wordt buiten setPhase gezet (gebruik setPhase, die werkt ook de knoppen bij)');
      if (/updateButtonLabel\(\)/.test(code) && f !== 'game.js') failures.push('js/' + f + ':' + (i + 1) + ': updateButtonLabel hoort alleen via setPhase te lopen');
      // De spelers staan alleen in game.players; een losse kopie kan uit de pas lopen. Hetzelfde voor de bron van toeval.
      if (/^(let|var|const)\s+(players|rng)\b/.test(code)) failures.push('js/' + f + ':' + (i + 1) + ': geen losse globale ' + code.match(/(players|rng)/)[0] + ' (de spelers staan in game.players, toeval gaat als argument naar shuffle)');
    });
  }
  if (run("typeof players !== 'undefined' || typeof rng !== 'undefined'")) failures.push('er bestaat nog een globale players of rng');
  // dealGame: zelfde seed = zelfde deling, 52 unieke kaarten, om de beurt verdeeld, seed bewaard; zonder seed willekeurig.
  const deal = (n, seed) => JSON.parse(run(`(() => { const g = dealGame(${JSON.stringify(Array.from({ length: n }, (_, i) => 'S' + i))}, { twoBeatsAce: true }, ${JSON.stringify(seed)});
    return JSON.stringify({ seed: g.seed, names: g.players.map(p => p.name), ids: g.players.map(p => p.id), decks: g.players.map(p => p.deck.map(c => c.rank + c.suit)), rule: g.rules.twoBeatsAce, other: g.rules.battleFirst }); })()`));
  for (const n of [2, 3, 5, 8]){
    const a = deal(n, 'abc'), b = deal(n, 'abc'), c = deal(n, 'abd');
    const all = a.decks.flat();
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push('dealGame: dezelfde seed geeft niet dezelfde deling (' + n + ' spelers)');
    if (JSON.stringify(a.decks) === JSON.stringify(c.decks)) failures.push('dealGame: een andere seed geeft dezelfde deling (' + n + ' spelers)');
    if (all.length !== 52 || new Set(all).size !== 52) failures.push('dealGame: geen 52 unieke kaarten (' + n + ' spelers)');
    const sizes = a.decks.map(d => d.length);
    if (Math.max(...sizes) - Math.min(...sizes) > 1 || sizes.some((x, i) => i > 0 && x > sizes[i - 1])) failures.push('dealGame: kaarten niet om de beurt verdeeld: ' + JSON.stringify(sizes));
    if (a.seed !== 'abc' || JSON.stringify(a.ids) !== JSON.stringify(a.names.map((_, i) => i)) || a.names[n - 1] !== 'S' + (n - 1)) failures.push('dealGame: seed, ids of namen kloppen niet');
    if (a.rule !== true || a.other !== false) failures.push('dealGame: de regels komen niet in de spelstand');
  }
  const r1 = deal(4, ''), r2 = deal(4, null);
  if (r1.seed !== null || r2.seed !== null) failures.push('dealGame: zonder seed hoort seed null te zijn');
  if (JSON.stringify(r1.decks) === JSON.stringify(r2.decks)) failures.push('dealGame: twee willekeurige delingen zijn gelijk');
  // setPhase zet de fase en de knoppen in één keer.
  const btn = JSON.parse(run(`(() => { const before = phase; setPhase('game-over'); const a = { phase, play: playBtn.disabled, ff: fastForwardBtn.disabled };
    setPhase('idle'); const b = { phase, play: playBtn.disabled, ff: fastForwardBtn.disabled, label: playBtn.textContent }; setPhase(before); return JSON.stringify({ a, b }); })()`));
  if (JSON.stringify(btn) !== JSON.stringify({ a: { phase: 'game-over', play: true, ff: true }, b: { phase: 'idle', play: false, ff: false, label: 'Speel ronde' } })) failures.push('setPhase: knoppen volgen de fase niet: ' + JSON.stringify(btn));
}

// ---- wat regels over het spel melden (stateNote) ----
{
  const notes = rules => JSON.parse(run('JSON.stringify(ruleStateNotes(' + JSON.stringify(rules) + '))'));
  const same = (name, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) failures.push('stateNote "' + name + '": verwacht ' + JSON.stringify(exp) + ', kreeg ' + JSON.stringify(got)); };
  same('regel uit', notes({ suitBreak: false, suitOrder: ['♣', '♦', '♥', '♠'] }), []);
  same('standaardvolgorde', notes({ suitBreak: true }), ['Symbolen van hoog naar laag: ♠ ♥ ♦ ♣.']);
  same('eigen volgorde', notes({ suitBreak: true, suitOrder: ['♣', '♦', '♥', '♠'] }), ['Symbolen van hoog naar laag: ♣ ♦ ♥ ♠.']);
  same('ongeldige volgorde', notes({ suitBreak: true, suitOrder: ['♣'] }), ['Symbolen van hoog naar laag: ♠ ♥ ♦ ♣.']);
  same('andere regels melden niets', notes({ twoBeatsAce: true, battleFirst: true, battleDiscard: true, secondChance: true, royalFamily: true }), []);
  // Het regelboek toont de melding alleen bij een regel die aan staat.
  const withNote = textOf(run('buildRulebook(RULES, BASE_RULES, { suitBreak: true, suitOrder: ["♦", "♣", "♥", "♠"] })'));
  const without = textOf(run('buildRulebook(RULES, BASE_RULES, { suitBreak: false, suitOrder: ["♦", "♣", "♥", "♠"] })'));
  if (!withNote.includes('Symbolen van hoog naar laag: ♦ ♣ ♥ ♠. De voorbeelden gebruiken de standaardvolgorde ♠ ♥ ♦ ♣.')) failures.push('regelboek: de gekozen symboolvolgorde ontbreekt bij de regel');
  if (without.includes('Symbolen van hoog naar laag')) failures.push('regelboek: de symboolvolgorde staat er terwijl de regel uit staat');
}

// ---- regels als beschrijving (js/rule-dsl.js) ----
{
  const fail = t => failures.push('regelbeschrijving: ' + t);
  const errorsOf = logic => JSON.parse(run('JSON.stringify(validateRuleLogic(' + JSON.stringify(logic) + '))'));
  // Elke regel in de catalogus heeft een beschrijving die klopt.
  const logics = JSON.parse(run('JSON.stringify(RULES.map(r => ({ id: r.id, logic: r.logic || null })))'));
  for (const r of logics){
    if (!r.logic){ fail(r.id + ' heeft geen logic'); continue; }
    const e = errorsOf(r.logic);
    if (e.length) fail(r.id + ': ' + e.join('; '));
  }

  // De regels zoals ze met de hand geschreven waren voordat ze een beschrijving werden. Ze doen in het spel niet meer mee: ze staan
  // hier alleen als referentie, zodat de test blijft bewijzen dat de beschrijvingen precies hetzelfde doen.
  run(`globalThis.__REF = {
  twoBeatsAce: {
    decide(inPlay){
      const twos = inPlay.filter(p => p.faceCard.rank === '2');
      const aces = inPlay.filter(p => p.faceCard.rank === 'A');
      return twos.length > 0 && aces.length > 0 ? twos : null;
    }
  },
  battleFirst: {
    decide(inPlay){
      const groups = new Map(); // waarde -> spelers met die kaart
      for (const p of inPlay){
        if (!groups.has(p.faceCard.value)) groups.set(p.faceCard.value, []);
        groups.get(p.faceCard.value).push(p);
      }
      let best = null;
      for (const [value, group] of groups){
        if (group.length >= 2 && (best === null || value > best[0])) best = [value, group];
      }
      return best ? best[1] : null;
    }
  },
  battleDiscard: {
    onAward(ctx){
      if (ctx.state.battleLevel > 0) engineDiscardPot(ctx.state);
    }
  },
  secondChance: {
    onRoundEnd(ctx){
      const state = ctx.state;
      if (state.players.filter(p => p.deck.length > 0).length < 2) return;
      const dead = state.players.filter(p => p.deck.length === 0);
      // De gevers worden bepaald vóór er kaarten verschuiven, zodat een speler die net een kaart kreeg niet meteen weer geeft.
      const givers = dead.map(p => engineNeighbor(state, p.id, 'left'));
      dead.forEach((p, i) => { if (givers[i]) engineTransferCards(state, givers[i].id, p.id, 1); });
    }
  },
  royalFamily: {
    onAward(ctx){
      const state = ctx.state;
      if (ctx.how === 'void' || !ctx.winner || state.pot.length === 0) return;
      const start = state.opening[ctx.winner.id];
      if (!start || start.rank !== 'K') return;
      const women = state.players.filter(p => p.id !== ctx.winner.id && state.opening[p.id] && state.opening[p.id].rank === 'Q');
      if (women.length === 0) return;
      engineSharePot(state, [ctx.winner.id].concat(women.map(p => p.id)));
    }
  },
  suitBreak: {
    breakTie(winners, rules){
      const order = suitOrderOf(rules);
      const rank = p => order.indexOf(p.faceCard.suit);
      if (winners.some(p => rank(p) < 0)) return null;
      const best = Math.min(...winners.map(rank));
      const top = winners.filter(p => rank(p) === best);
      return top.length === 1 ? top : null;
    }
  }
};`);
  {
    const refIds = JSON.parse(run('JSON.stringify(Object.keys(__REF))'));
    if (JSON.stringify(refIds.slice().sort()) !== JSON.stringify(RULE_IDS.slice().sort())) fail('de referentie dekt niet precies de regels van de catalogus: ' + JSON.stringify(refIds));
    // Geen enkele regel in de catalogus schrijft zijn functies nog zelf: ze komen uit de beschrijving.
    const src = fs.readFileSync(path.join(root, 'js', 'rules.js'), 'utf8');
    const own = src.split('\n').filter(l => /^\s+(decide|breakTie|onAward|onRoundEnd)\s*\(/.test(l));
    if (own.length) fail('js/rules.js bevat nog met de hand geschreven regelfuncties: ' + JSON.stringify(own.map(l => l.trim())));
  }

  // 1. Beslissen en gelijkspel: op duizenden willekeurige tafels doet de beschrijving precies wat de functie doet.
  const mismatch = run(`(() => {
    const rnd = mulberry32(12345);
    const pick = n => Math.floor(rnd() * n);
    const orders = [undefined, ['♣', '♦', '♥', '♠'], ['♥', '♠', '♣', '♦'], ['♣'], 'x'];
    for (let t = 0; t < 6000; t++){
      const deck = shuffle(buildDeck(), rnd);
      const n = 2 + pick(7);
      // Weinig verschillende waarden geeft veel paren; soms een kaart zonder symbool (zoals in de voorbeelden van het regelboek).
      const few = pick(3) === 0 ? null : 2 + pick(4);
      const inPlay = [];
      for (let i = 0; i < n; i++){
        const c = Object.assign({}, deck[i]);
        if (few){ const v = 2 + pick(few) + (pick(4) === 0 ? 8 : 0); c.value = Math.min(14, v); c.rank = RANKS[c.value - 2]; }
        if (pick(25) === 0) c.suit = null;
        inPlay.push({ id: i, faceCard: c });
      }
      const rules = { suitOrder: orders[pick(orders.length)] };
      const ids = list => list ? list.map(p => p.id).join(',') : 'null';
      for (const r of RULES){
        const ref = __REF[r.id];
        if (typeof ref.decide === 'function'){
          const a = ids(ref.decide(inPlay)), b = ids(r.decide(inPlay, rules));
          if (a !== b) return r.id + ' decide op ' + inPlay.map(p => p.faceCard.rank + (p.faceCard.suit || '')).join(' ') + ': functie ' + a + ', beschrijving ' + b;
        }
        if (typeof ref.breakTie === 'function'){
          const a = ids(ref.breakTie(inPlay, rules)), b = ids(r.breakTie(inPlay, rules));
          if (a !== b) return r.id + ' breakTie op ' + inPlay.map(p => p.faceCard.rank + (p.faceCard.suit || '')).join(' ') + ' met ' + JSON.stringify(rules.suitOrder) + ': functie ' + a + ', beschrijving ' + b;
        }
      }
    }
    return '';
  })()`);
  if (mismatch) fail('wijkt af van de functie: ' + mismatch);

  // 2. Hele spellen: met de referentiefuncties in plaats van de beschrijvingen verloopt elk spel precies hetzelfde (alle regelcombinaties).
  run(`globalThis.__swapLogic = on => { for (const r of RULES){
    if (on){ r.__orig = { decide: r.decide, breakTie: r.breakTie, onAward: r.onAward, onRoundEnd: r.onRoundEnd };
      const c = __REF[r.id];
      for (const k of Object.keys(r.__orig)){ if (!!r.__orig[k] !== !!c[k]) throw new Error(r.id + ': beschrijving en referentie hebben niet dezelfde functies (' + k + ')'); if (c[k]) r[k] = c[k]; }
    } else if (r.__orig){ for (const k of Object.keys(r.__orig)) if (r.__orig[k]) r[k] = r.__orig[k]; delete r.__orig; } } };
  globalThis.__playSig = (n, seed, rules) => { const g = dealGame(Array.from({ length: n }, (_, i) => 'S' + i), rules, seed);
    const t = simulateFullTrace(g.players, 400, g.rules);
    return t.outcome + '|' + t.rounds + '|' + stateSignature(t.finalPlayers, t.finalDiscard) + '|' + t.trace.length + '|' + JSON.stringify(t.finalMoved); };`);
  let compared = 0;
  for (const setName of Object.keys(RULE_SETS)) for (const n of [3, 4, 8]) for (const seed of ['L1', 'L2', 'L3']){
    const rules = Object.assign({}, RULE_SETS[setName], { suitOrder: seed === 'L2' ? ['♦', '♣', '♥', '♠'] : undefined });
    const args = n + ', ' + JSON.stringify(seed) + ', ' + JSON.stringify(rules);
    const a = run('__playSig(' + args + ')');
    const b = run('(() => { __swapLogic(true); try { return __playSig(' + args + '); } finally { __swapLogic(false); } })()');
    compared++;
    if (a !== b){ fail('spel ' + n + '|' + seed + '|' + setName + ' verloopt anders met de beschrijvingen'); break; }
  }
  if (compared < 150) fail('te weinig spellen vergeleken (' + compared + ')');
  run('delete globalThis.__swapLogic; delete globalThis.__playSig; delete globalThis.__REF;');

  // 3. De controle weigert wat niet klopt, met een melding; compileRuleLogic weigert het dan ook.
  const bad = [
    ['geen object', 'x'],
    ['onbekend moment', { moment: 'later', then: { win: { all: true } } }],
    ['then ontbreekt', { moment: 'decide' }],
    ['onbekend onderdeel', { moment: 'decide', then: { win: { all: true } }, code: 'alert(1)' }],
    ['onbekende waarde', { moment: 'decide', then: { win: { rank: '1' } } }],
    ['onbekend symbool', { moment: 'decide', then: { win: { suit: 'x' } } }],
    ['twee keuzes tegelijk', { moment: 'decide', then: { win: { rank: 'K', suit: '♥' } } }],
    ['groep te klein', { moment: 'decide', then: { win: { group: { relation: 'sameRank', min: 1, pick: 'highest' } } } }],
    ['onbekende relatie', { moment: 'decide', then: { win: { group: { relation: 'friends', min: 2, pick: 'highest' } } } }],
    ['award-gevolg bij decide', { moment: 'decide', then: { discardPot: true } }],
    ['win bij award', { moment: 'award', then: { win: { all: true } } }],
    ['battle-voorwaarde bij decide', { moment: 'decide', if: { battle: true }, then: { win: { all: true } } }],
    ['exists bij award', { moment: 'award', if: { exists: { rank: 'K' } }, then: { discardPot: true } }],
    ['winner bij roundEnd', { moment: 'roundEnd', then: { forEach: 'winner', discardTop: 1 } }],
    ['neighbor buiten from', { moment: 'roundEnd', then: { forEach: { neighbor: 'left' }, discardTop: 1 } }],
    ['count zonder grens', { moment: 'decide', if: { count: { all: true } }, then: { win: { all: true } } }],
    ['gever zonder kaarten', { moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { withoutCards: true }, count: 1 } } }],
    ['transfer zonder aantal', { moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { neighbor: 'left' } } } }],
    ['lege lijst', { moment: 'decide', then: { win: { and: [] } } }],
    ['te diep', { moment: 'decide', then: { win: { not: { not: { not: { not: { not: { not: { not: { not: { not: { all: true } } } } } } } } } } } }]
  ];
  for (const [name, logic] of bad){
    if (errorsOf(logic).length === 0) fail('de controle laat door: ' + name);
    const threw = run('(() => { try { compileRuleLogic(' + JSON.stringify(logic) + '); return false; } catch (e){ return true; } })()');
    if (!threw) fail('compileRuleLogic maakt toch een regel van: ' + name);
  }

  // 4. De bouwstenen die nog geen regel gebruikt: relaties tussen kaarten, laagste, tellen.
  const win = (cards, logic, rules) => JSON.parse(run(`(() => { const c = compileRuleLogic(${JSON.stringify(logic)});
    const inPlay = ${JSON.stringify(cards)}.map((t, i) => ({ id: i, faceCard: parseExampleCard(t) }));
    const out = (c.decide || c.breakTie)(inPlay, ${JSON.stringify(rules || {})}); return JSON.stringify(out ? out.map(p => p.id) : null); })()`));
  const same = (name, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) fail(name + ': verwacht ' + JSON.stringify(exp) + ', kreeg ' + JSON.stringify(got)); };
  const grp = (relation, min) => ({ moment: 'decide', then: { win: { group: { relation, min, pick: 'highest' } } } });
  same('opeenvolgend 7-8-9 wint van een A', win(['7♠', 'A♥', '8♦', '9♣'], grp('consecutive', 3)), [0, 2, 3]);
  same('opeenvolgend: te korte reeks', win(['7♠', 'A♥', '8♦', '3♣'], grp('consecutive', 3)), null);
  same('opeenvolgend: de hoogste reeks', win(['2♠', '3♥', 'Q♦', 'K♣', '7♠'], grp('consecutive', 2)), [2, 3]);
  same('zelfde symbool', win(['7♠', 'A♥', '8♠', '9♣'], grp('sameSuit', 2)), [0, 2]);
  same('zelfde symbool: hoogste kaart beslist tussen groepen', win(['7♠', 'A♥', '8♠', '3♥'], grp('sameSuit', 2)), [1, 3]);
  same('zelfde symbool: gelijke stand, de grootste groep', win(['K♠', 'K♥', '8♠', '3♥', '2♠'], grp('sameSuit', 2)), [0, 2, 4]);
  same('zelfde symbool: nog gelijk, dan samen', win(['K♠', 'K♥', '8♠', '3♥'], grp('sameSuit', 2)), [0, 1, 2, 3]);
  same('zelfde kleur', win(['7♠', 'A♥', '8♣', '9♦', '2♥'], grp('sameColor', 3)), [1, 3, 4]);
  same('kaart zonder symbool hoort bij geen kleurgroep', win(['7', 'A', '8♣', '9♣'], grp('sameColor', 2)), [2, 3]);
  same('laagste wint', win(['7♠', 'A♥', '3♣'], { moment: 'decide', then: { win: { lowest: 'value' } } }), [2]);
  same('hoogste rode kaart', win(['K♠', '9♥', '3♦', 'A♣'], { moment: 'decide', then: { win: { highest: 'value', of: { color: 'red' } } } }), [1]);
  same('alleen bij precies twee Azen', win(['A♠', 'A♥', 'K♦'], { moment: 'decide', if: { count: { rank: 'A' }, min: 2, max: 2 }, then: { win: { rank: 'K' } } }), [2]);
  same('niet bij drie Azen', win(['A♠', 'A♥', 'A♦', 'K♣'], { moment: 'decide', if: { count: { rank: 'A' }, min: 2, max: 2 }, then: { win: { rank: 'K' } } }), null);
  same('en / niet', win(['K♠', 'K♥', 'Q♥'], { moment: 'decide', then: { win: { and: [{ suit: '♥' }, { not: { rank: 'K' } }] } } }), [2]);
  same('gelijkspel: laagste symbool met eigen volgorde', win(['K♠', 'K♥'], { moment: 'tiebreak', then: { win: { lowest: 'suitOrder' } } }, { suitOrder: ['♥', '♠', '♦', '♣'] }), [0]);
  // Afleggen aan het einde van de ronde (nog door geen regel gebruikt).
  const dis = JSON.parse(run(`(() => { const c = compileRuleLogic({ moment: 'roundEnd', if: { playersWithCards: { min: 2 } }, then: { forEach: { opened: { rank: 'A' } }, discardTop: 2 } });
    const st = __state([['A♠', '4♠', '5♠', '6♠'], ['K♥', '7♥', '8♥']]); engineStartRound(st); c.onRoundEnd({ state: st });
    return JSON.stringify({ decks: st.players.map(p => p.deck.length), discard: st.discard.length }); })()`));
  same('discardTop', dis, { decks: [1, 2], discard: 2 });
  // De pot verdelen kan alleen met een winnaar, buiten een ronde zonder winnaar ('void') en met een pot die niet leeg is.
  const share = JSON.parse(run(`(() => { const c = compileRuleLogic({ moment: 'award', then: { sharePot: [{ opened: { rank: 'Q' } }] } });
    const play = (how, winner, emptyPot) => { const st = __state([['K♠', '4♠'], ['Q♥', '7♥'], ['9♦', '8♦']]); engineStartRound(st);
      if (emptyPot) st.pot = []; c.onAward({ state: st, winner: winner === null ? null : st.players[winner], how });
      return { pot: st.pot.length, shared: st.moved.shared.length, q: st.players[1].deck.length }; };
    return JSON.stringify({ normaal: play('normal', 0, false), void: play('void', 0, false), geenWinnaar: play('normal', null, false), legePot: play('normal', 0, true) }); })()`));
  same('sharePot met winnaar', share.normaal, { pot: 0, shared: 1, q: 4 });
  same('sharePot in een ronde zonder winnaar', share.void, { pot: 3, shared: 0, q: 1 });
  same('sharePot zonder winnaar', share.geenWinnaar, { pot: 3, shared: 0, q: 1 });
  same('sharePot met lege pot', share.legePot, { pot: 0, shared: 0, q: 1 });
  // exclude: 'winner' laat de winnaar zelf buiten de keuze: is hij de enige met zo'n kaart, dan is er "geen andere speler".
  const excl = JSON.parse(run(`(() => { const mk = sel => compileRuleLogic({ moment: 'award', if: { anyPlayer: sel }, then: { discardPot: true } });
    const play = (c, decks) => { const st = __state(decks); engineStartRound(st); c.onAward({ state: st, winner: st.players[0], how: 'normal' }); return st.discard.length; };
    const withEx = mk({ opened: { rank: 'K' }, exclude: 'winner' }), without = mk({ opened: { rank: 'K' } });
    return JSON.stringify({ alleenWinnaar: play(withEx, [['K♠'], ['Q♥'], ['9♦']]), ookAnder: play(withEx, [['K♠'], ['K♥'], ['9♦']]), zonderExclude: play(without, [['K♠'], ['Q♥'], ['9♦']]) }); })()`));
  same('exclude winner', excl, { alleenWinnaar: 0, ookAnder: 3, zonderExclude: 3 });
  // Een gever die geen buur is: wie zonder kaarten zit, krijgt er twee van de speler die de ronde met een Aas begon.
  const give = JSON.parse(run(`(() => { const c = compileRuleLogic({ moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { opened: { rank: 'A' } }, count: 2 } } });
    const st = __state([['K♠'], ['9♥', '7♥'], ['A♦', '4♦', '5♦', '6♦']]); engineStartRound(st); st.players[0].deck = []; c.onRoundEnd({ state: st });
    return JSON.stringify({ decks: st.players.map(p => p.deck.map(x => x.rank).join('')), transfers: st.moved.transfers }); })()`));
  same('transfer van een niet-buur', give, { decks: ['45', '7', '6'], transfers: [{ from: 2, to: 0, count: 2 }] });
  // Een beschrijving in de catalogus die niet klopt, laat het laden stoppen met een duidelijke melding.
  const loadError = run(`(() => { try { compileRuleLogic({ moment: 'decide', then: { win: { rank: 'Z' } } }); return ''; } catch (e){ return e.message; } })()`);
  if (!/Regelbeschrijving klopt niet/.test(loadError) || !/onbekende waarde/.test(loadError)) fail('een kapotte beschrijving geeft geen duidelijke melding: ' + JSON.stringify(loadError));
}

// ---- eigen regels (js/custom-rules.js) ----
{
  const fail = t => failures.push('eigen regels: ' + t);
  const J = v => JSON.stringify(v);
  const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v; // de volgorde van de velden doet er niet toe
  const eq = (name, got, exp) => { if (J(canon(got)) !== J(canon(exp))) fail(name + ': verwacht ' + J(exp) + ', kreeg ' + J(got)); };
  const catalogState = () => JSON.parse(run('JSON.stringify({ rules: RULES.map(r => r.id), defaults: DEFAULT_RULES, priority: RULES_BY_PRIORITY.map(r => r.id) })'));
  const before = catalogState();
  const sample = JSON.parse(run('JSON.stringify(CUSTOM_RULE_SAMPLE)'));
  const parse = text => JSON.parse(run('JSON.stringify(parseCustomRule(' + J(text) + '))'));
  const parseObj = obj => parse(J(obj));
  const mut = f => { const o = JSON.parse(J(sample)); f(o); return o; };

  // 1. Het voorbeeldblok klopt, en de voorbeelden worden nagespeeld.
  const ok1 = parseObj(sample);
  eq('het voorbeeldblok wordt geaccepteerd', ok1.errors, []);
  eq('de gecontroleerde regel is een kopie van het blok', ok1.def, sample);
  const chk = JSON.parse(run('JSON.stringify(checkCustomRuleExamples(parseCustomRule(' + J(J(sample)) + ').def))'));
  eq('de voorbeelden van het voorbeeldblok kloppen', chk, { total: 2, passed: 2, failures: [] });
  eq('het nakijken laat de catalogus zoals hij was', catalogState(), before);
  // Een voorbeeld dat niet klopt wordt gevonden.
  const wrong = parseObj(mut(o => { o.examples[0].winners = [3]; })).def;
  const chkWrong = JSON.parse(run('JSON.stringify(checkCustomRuleExamples(' + J(wrong) + '))'));
  if (chkWrong.passed !== 1 || chkWrong.failures.length !== 1 || !/voorbeeld 1/.test(chkWrong.failures[0])) fail('een fout voorbeeld wordt niet gevonden: ' + J(chkWrong));

  // 2. Toevoegen en weghalen: de regel doet mee, en daarna is alles weer zoals het was.
  const game = (rules, n, seed) => run('(() => { const g = dealGame(Array.from({ length: ' + n + ' }, (_, i) => "S" + i), ' + J(rules) + ', ' + J(seed) + '); const t = simulateFullTrace(g.players, 600, g.rules); return t.outcome + "|" + t.rounds + "|" + stateSignature(t.finalPlayers, t.finalDiscard); })()');
  const baseline = [[3, 'e1'], [4, 'e2'], [6, 'e3']].map(([n, seed]) => game({}, n, seed));
  const table = rules => JSON.parse(run('JSON.stringify(__fw(["7♠", "8♥", "9♦", "A♣"], ' + J(rules) + '))'));
  run('addCustomRule(parseCustomRule(' + J(J(sample)) + ').def)');
  const added = catalogState();
  if (!added.rules.includes('custom-opeenvolgend') || added.defaults['custom-opeenvolgend'] !== false || added.priority[added.priority.length - 1] !== 'custom-opeenvolgend')
    fail('na toevoegen staat de regel niet (uit, als laatste) in de catalogus: ' + J(added));
  eq('de regel is herkenbaar als eigen regel', JSON.parse(run('JSON.stringify(customRules().map(r => r.id))')), ['custom-opeenvolgend']);
  eq('uit: de hoogste kaart wint', table({ 'custom-opeenvolgend': false }), [3]);
  eq('aan: de reeks 7-8-9 beslist', table({ 'custom-opeenvolgend': true }), [0, 1, 2]);
  eq('nieuwe spelstand kent de regel (uit)', JSON.parse(run('JSON.stringify(createGameState([{ id: 0, name: "a", deck: [] }, { id: 1, name: "b", deck: [] }], {}).rules["custom-opeenvolgend"])')), false);
  eq('een eigen regel die uit staat verandert geen spel', [[3, 'e1'], [4, 'e2'], [6, 'e3']].map(([n, seed]) => game({}, n, seed)), baseline);
  const playedOn = game({ 'custom-opeenvolgend': true }, 4, 'e2');
  if (playedOn === baseline[1]) fail('met de regel aan verloopt een spel hetzelfde als zonder (ongeloofwaardig)');
  // Opnieuw toevoegen vervangt, het vervangt nooit een regel van het spel.
  run('addCustomRule(Object.assign({}, parseCustomRule(' + J(J(mut(o => { o.title = 'Tweede versie'; }))) + ').def))');
  eq('dezelfde id vervangt de eerdere regel', JSON.parse(run('JSON.stringify(RULES.filter(r => r.id === "custom-opeenvolgend").map(r => r.title))')), ['Tweede versie']);
  const builtin = run('(() => { try { addCustomRule(Object.assign({}, parseCustomRule(' + J(J(sample)) + ').def, { id: "twoBeatsAce" })); return "toegevoegd"; } catch (e){ return e.message; } })()');
  if (!/kan niet worden vervangen/.test(builtin)) fail('een regel van het spel kan worden vervangen: ' + builtin);
  eq('weghalen', run('removeCustomRule("custom-opeenvolgend")'), true);
  eq('weghalen van iets wat er niet is', run('removeCustomRule("custom-opeenvolgend")'), false);
  eq('weghalen van een regel van het spel mag niet', run('removeCustomRule("twoBeatsAce")'), false);
  eq('na weghalen is de catalogus weer zoals hij was', catalogState(), before);
  eq('na weghalen verlopen de spellen weer zoals eerst', [[3, 'e1'], [4, 'e2'], [6, 'e3']].map(([n, seed]) => game({}, n, seed)), baseline);

  // 3. Wat niet mag: elk van deze blokken wordt geweigerd.
  const bad = [
    ['leeg', ''], ['geen JSON', '{ dit is geen json'], ['een lijst', '[1, 2]'], ['een getal', '5'],
    ['te groot', J(mut(o => { o.description = 'x'.repeat(21000); }))],
    ['onbekend veld', mut(o => { o.code = 'alert(1)'; })],
    ['__proto__ als veld', '{"__proto__": {"polluted": true}, "id": "custom-x"}'],
    ['constructor als veld', J(mut(o => { o.constructor = { prototype: {} }; }))],
    ['id zonder prefix', mut(o => { o.id = 'twoBeatsAce'; })],
    ['id in kleine letters zonder prefix', mut(o => { o.id = 'mijn-regel'; })],
    ['id alleen de prefix', mut(o => { o.id = 'custom-'; })],
    ['id met dubbele streep', mut(o => { o.id = 'custom--regel'; })],
    ['id eindigt op een streep', mut(o => { o.id = 'custom-regel-'; })],
    ['id met hoofdletters', mut(o => { o.id = 'custom-Mijn'; })],
    ['id met spatie', mut(o => { o.id = 'custom-mijn regel'; })],
    ['id met punt', mut(o => { o.id = 'custom-a.b'; })],
    ['id __proto__', mut(o => { o.id = 'custom-__proto__'; })],
    ['id te lang', mut(o => { o.id = 'custom-' + 'a'.repeat(40); })],
    ['id ontbreekt', mut(o => { delete o.id; })],
    ['titel leeg', mut(o => { o.title = '  '; })],
    ['titel geen tekst', mut(o => { o.title = 5; })],
    ['titel te lang', mut(o => { o.title = 'x'.repeat(61); })],
    ['stuurteken in titel', mut(o => { o.title = 'a\u0007b'; })],
    ['uitleg te lang', mut(o => { o.description = 'x'.repeat(1501); })],
    ['prioriteit te laag', mut(o => { o.priority = 60; })],
    ['prioriteit te hoog', mut(o => { o.priority = 1000; })],
    ['prioriteit geen geheel getal', mut(o => { o.priority = 200.5; })],
    ['prioriteit tekst', mut(o => { o.priority = '200'; })],
    ['logic ontbreekt', mut(o => { delete o.logic; })],
    ['logic onbekend onderdeel', mut(o => { o.logic.code = 'x'; })],
    ['logic onbekende waarde', mut(o => { o.logic.then.win = { rank: 'Z' }; })],
    ['logic te diep', mut(o => { let n = { all: true }; for (let i = 0; i < 12; i++) n = { not: n }; o.logic.then.win = n; })],
    ['geen voorbeelden', mut(o => { o.examples = []; })],
    ['te veel voorbeelden', mut(o => { o.examples = Array.from({ length: 13 }, () => o.examples[0]); })],
    ['voorbeeld onbekende kaart', mut(o => { o.examples[0].cards[0] = '1♠'; })],
    ['voorbeeld winnaar buiten de tafel', mut(o => { o.examples[0].winners = [9]; })],
    ['voorbeeld winnaars dubbel', mut(o => { o.examples[0].winners = [0, 0]; })],
    ['voorbeeld zonder tekst', mut(o => { delete o.examples[0].text; })],
    ['voorbeeld met onbekend veld', mut(o => { o.examples[0].html = '<b>'; })],
    ['voorbeeld met onbekende regel', mut(o => { o.examples[0].with = ['bestaat-niet']; })],
    ['voorbeeld met te veel spelers', mut(o => { o.examples[0].cards = ['2', '3', '4', '5', '6', '7', '8', '9', '10']; o.examples[0].winners = [0]; })],
    ['stapels bij het moment decide', mut(o => { o.examples = [{ decks: [['K'], ['Q']], after: [['K', 'Q'], []], discarded: 0, text: 'x' }]; })],
    ['open kaarten bij het moment roundEnd', mut(o => { o.logic = { moment: 'roundEnd', then: { forEach: { withoutCards: true }, discardTop: 1 } }; })]
  ];
  for (const [name, input] of bad){
    const r = typeof input === 'string' ? parse(input) : parseObj(input);
    if (r.def !== null || r.errors.length === 0) fail('wordt toch geaccepteerd: ' + name);
  }
  // Een kwaadwillig blok verandert niets aan de pagina: de vervuiling via __proto__ is niet gelukt.
  eq('geen vervuiling van Object.prototype', run('({}).polluted === undefined'), true);

  // 4. Teksten blijven precies zoals ze zijn ingevoerd (ze gaan later alleen als gewone tekst in de pagina).
  const html = '<img src=x onerror=1> & "quotes"';
  const rh = parseObj(mut(o => { o.title = html; o.short = html; o.description = html + '\nTweede regel'; }));
  eq('HTML in teksten blijft tekst', [rh.def && rh.def.title, rh.def && rh.def.short, rh.def && rh.def.description], [html, html, html + '\nTweede regel']);
  // Delen: exporteren en weer inlezen geeft hetzelfde.
  const exported = run('exportCustomRule(' + J(sample) + ')');
  eq('exporteren en inlezen', parse(exported).def, sample);

  // 5. Een regel zonder beslissing (moment roundEnd) met een voorbeeld met stapels.
  const revival = { id: 'custom-terugkeer', title: 'Terugkeer', short: 'Wie geen kaarten heeft, krijgt er één van de linkerbuur', description: 'Wie aan het einde van de ronde geen kaarten heeft, krijgt de bovenste kaart van de linkerbuur met kaarten.',
    logic: { moment: 'roundEnd', if: { playersWithCards: { min: 2 } }, then: { forEach: { withoutCards: true }, transfer: { from: { neighbor: 'left' }, count: 1 } } },
    examples: [{ decks: [['K', '4'], ['3'], ['9', '5']], after: [['4', 'K', '3', '9'], ['5'], []], discarded: 0, text: 'Speler 2 heeft na de ronde geen kaarten en krijgt de 5 van zijn linkerbuur.' }] };
  const pr = parseObj(revival);
  eq('een regel met moment roundEnd wordt geaccepteerd', [pr.errors, pr.def && pr.def.priority, pr.def && pr.def.examples.length], [[], 200, 1]);
  eq('de stapels in het voorbeeld kloppen', JSON.parse(run('JSON.stringify(checkCustomRuleExamples(' + J(pr.def) + '))')), { total: 1, passed: 1, failures: [] });
  const badAfter = parseObj(Object.assign({}, revival, { examples: [Object.assign({}, revival.examples[0], { after: [['4', 'K', '3', '9'], [], ['5']] })] })).def;
  eq('klopt het voorbeeld niet, dan wordt dat gemeld', JSON.parse(run('JSON.stringify(checkCustomRuleExamples(' + J(badAfter) + ').passed)')), 0);
  const withDiscard = parseObj(Object.assign({}, revival, { id: 'custom-afleggen', logic: { moment: 'roundEnd', then: { forEach: { opened: { rank: 'A' } }, discardTop: 1 } },
    examples: [{ decks: [['A', '4'], ['K', '3']], after: [[], ['3', 'A', 'K']], discarded: 1, text: 'x' }] }));
  eq('een regel die afgelegd kaarten gebruikt toont de aflegstapel', withDiscard.errors, []);
  run('addCustomRule(' + J(withDiscard.def) + ')');
  eq('usesDiscard volgt uit de beschrijving', run('RULES.find(r => r.id === "custom-afleggen").usesDiscard'), true);
  run('removeCustomRule("custom-afleggen")');

  // 6. Proefspellen.
  const trial = (def, opts, extra) => run('(() => { const t = createCustomTrial(' + J(def) + ', ' + J(opts) + '); try { t.step(1e9); ' + (extra || '') + ' return JSON.stringify(t.report()); } finally { t.dispose(); } })()');
  const rep = JSON.parse(trial(sample, { games: 12, players: [3, 4] }));
  eq('aantal gespeelde proefspellen', rep.played, 12);
  eq('elk proefspel heeft een uitkomst, met en zonder de regel', [rep.with.win + rep.with.cycle + rep.with.unknown, rep.without.win + rep.without.cycle + rep.without.unknown], [12, 12]);
  eq('er gaat geen kaart verloren of dubbel', [rep.conservationFailures, rep.errors, rep.examples.failures, rep.ok], [[], [], [], true]);
  eq('na de proef is de catalogus zoals hij was', catalogState(), before);
  // "zonder" is hetzelfde als een gewoon spel op dezelfde deling.
  const direct = JSON.parse(run('(() => { const o = { win: 0, cycle: 0, unknown: 0 }; for (let i = 0; i < 12; i++){ const g = dealGame(Array.from({ length: [3, 4][i % 2] }, (_, k) => "S" + k), {}, "trial-" + i); o[simulateFullTrace(g.players, SIM_ROUND_CAP, g.rules).outcome]++; } return JSON.stringify(o); })()'));
  eq('de kant zonder regel is een gewoon spel', { win: rep.without.win, cycle: rep.without.cycle, unknown: rep.without.unknown }, direct);
  if (rep.with.win === rep.without.win && rep.with.cycle === rep.without.cycle && rep.with.unknown === rep.without.unknown && rep.avgWinRounds.with === rep.avgWinRounds.without) fail('met en zonder de regel geven precies hetzelfde: de regel doet niets in de proef');
  // Andere regels die aan staan tellen mee aan beide kanten.
  const rep2 = JSON.parse(trial(sample, { games: 6, players: [4], base: { battleFirst: true } }));
  eq('met een andere regel aan blijven de proefspellen kloppen', [rep2.played, rep2.ok], [6, true]);
  // De grenzen van het aantal proefspellen.
  const gamesFor = g => JSON.parse(run('(() => { const t = createCustomTrial(' + J(sample) + ', { games: ' + J(g) + ' }); try { return t.report().games; } finally { t.dispose(); } })()'));
  eq('te veel proefspellen', gamesFor(5000), 1000);
  eq('geen of negatieve proefspellen', [gamesFor(0), gamesFor(-5)], [1, 1]);
  eq('geen getal: de standaard', gamesFor('veel'), 200);
  // Stap voor stap: met een klok die per aanroep tien milliseconden verder gaat, past er bij een budget van 25 ms telkens een paar spellen in.
  const stepped = JSON.parse(run(`(() => { let clock = 0; const t = createCustomTrial(${J(sample)}, { games: 10, players: [3], now: () => (clock += 10) });
    try { const seen = []; let guard = 0; while (!t.step(25) && guard++ < 100) seen.push(Math.round(t.progress() * 100)); return JSON.stringify({ seen, done: t.done, played: t.report().played }); } finally { t.dispose(); } })()`));
  if (stepped.seen.length < 2 || !stepped.done || stepped.played !== 10 || stepped.seen.some((v, i) => i > 0 && v <= stepped.seen[i - 1])) fail('stap voor stap loopt niet goed: ' + J(stepped));
  eq('de catalogus is na de stappen weer zoals hij was', catalogState(), before);

  // 7. De proef vindt een regel die kaarten kwijtraakt, en een regel die een fout geeft.
  const broken = JSON.parse(run(`(() => { const t = createCustomTrial(${J(sample)}, { games: 6, players: [3] });
    try { RULES.find(r => r.id === 'custom-opeenvolgend').onRoundEnd = ctx => { ctx.state.players[0].deck.pop(); }; t.step(1e9); return JSON.stringify(t.report()); } finally { t.dispose(); } })()`));
  if (broken.conservationFailures.length === 0 || broken.ok) fail('een regel die kaarten kwijtraakt wordt niet gevonden: ' + J(broken.conservationFailures));
  const thrower = JSON.parse(run(`(() => { const t = createCustomTrial(${J(sample)}, { games: 4, players: [3] });
    try { RULES.find(r => r.id === 'custom-opeenvolgend').onRoundEnd = () => { throw new Error('boem'); }; t.step(1e9); return JSON.stringify(t.report()); } finally { t.dispose(); } })()`));
  if (thrower.errors.length === 0 || !/boem/.test(thrower.errors[0].message) || thrower.ok || thrower.played !== 4) fail('een regel die een fout geeft wordt niet gemeld: ' + J(thrower.errors));
  eq('de catalogus is na een kapotte proef weer zoals hij was', catalogState(), before);
  // Spelersaantallen buiten 2 t/m 8 worden genegeerd (anders de standaard), en het rapport is een kopie.
  const odd = JSON.parse(trial(sample, { games: 4, players: [0, 1, 99, 'x', 3.5] }));
  eq('onzinnige aantallen spelers geven geen fouten', [odd.played, odd.conservationFailures, odd.ok], [4, [], true]);
  const copy = JSON.parse(run(`(() => { const t = createCustomTrial(${J(sample)}, { games: 3, players: [3] });
    try { t.step(1e9); const a = t.report(); a.without.win = 999; a.errors.push('x'); a.examples.failures.push('y'); const b = t.report();
      return JSON.stringify({ win: b.without.win, errors: b.errors.length, failures: b.examples.failures.length }); } finally { t.dispose(); } })()`));
  if (copy.win === 999 || copy.errors !== 0 || copy.failures !== 0) fail('het rapport is geen kopie van de interne stand: ' + J(copy));

  // Het rapport als tabel en zinnen (js/custom-rules-ui.js).
  const side = (win, cycle, unknown, winRounds) => ({ win, cycle, unknown, winRounds, maxWinRounds: 0 });
  const fakeReport = over => Object.assign({ games: 10, played: 10, without: side(2, 3, 5, 400), with: side(4, 1, 5, 1000), conservationFailures: [], errors: [], ms: 1234,
    examples: { total: 3, passed: 3, failures: [] }, avgWinRounds: { without: 200, with: 250 }, ok: true }, over);
  const sumOf = rep => JSON.parse(run('JSON.stringify(customReportSummary(' + J(rep) + '))'));
  const good = sumOf(fakeReport({}));
  eq('rapport: tabel', good.rows, [['Gespeelde spellen', '10', '10'], ['Eindigen met een winnaar', '2 (20%)', '4 (40%)'], ['Lopen vast in een cyclus', '3 (30%)', '1 (10%)'],
    ['Niet beslist na 3000 rondes', '5 (50%)', '5 (50%)'], ['Gemiddelde lengte (spellen met een winnaar)', '200 rondes', '250 rondes']]);
  eq('rapport: alles in orde', [good.ok, good.notes.map(n => n.ok)], [true, [true, true, true]]);
  const noWin = sumOf(fakeReport({ without: side(0, 0, 10, 0), avgWinRounds: { without: null, with: 250 } }));
  eq('rapport: geen enkel spel met een winnaar', [noWin.rows[1][1], noWin.rows[4][1]], ['0 (0%)', '–']);
  const badRep = sumOf(fakeReport({ played: 6, ok: false, conservationFailures: [{ game: 4, players: 3, seed: 'trial-3', side: 'met' }], errors: [{ game: 2, players: 3, seed: 'trial-1', message: 'boem' }],
    examples: { total: 3, passed: 2, failures: ['x'] } }));
  eq('rapport: wat misgaat wordt gemeld', [badRep.ok, badRep.notes.map(n => n.ok), badRep.notes.map(n => n.text)],
    [false, [false, false, false, false], ['Gestopt na 6 van de 10 spellen.', 'Er gingen kaarten verloren of dubbel in 1 spellen (eerste: spel 4, met de regel).', 'De regel gaf een fout in 1 spellen: boem', 'Van de voorbeelden kloppen er 2 van de 3.']]);
  eq('er blijft geen eigen regel achter', run('RULES.every(r => !r.custom)'), true);
}

// ---- regels in gewone taal (js/rule-text.js) ----
{
  const fail = t => failures.push('regel in gewone taal: ' + t);
  const J = v => JSON.stringify(v);
  const describe = logic => run('describeRuleLogic(' + J(logic) + ')');
  // De zes regels van het spel, zoals ze in het regelboek en in de bouwer worden gelezen.
  const sixRules = JSON.parse(run('JSON.stringify(RULES.map(r => [r.id, describeRuleLogic(r.logic)]))'));
  const expectSix = {
    twoBeatsAce: 'Als er een 2 ligt en er een Aas ligt, dan winnen de spelers met een 2. Zijn het er meer dan één, dan battlen zij.',
    battleFirst: 'Altijd winnen de spelers in de hoogste groep van minstens 2 kaarten met dezelfde waarde. Zijn het er meer dan één, dan battlen zij.',
    battleDiscard: 'Als er een battle is geweest, dan gaat de hele pot naar de aflegstapel.',
    secondChance: 'Aan het einde van de ronde: als minstens 2 spelers kaarten hebben, dan krijgt elke speler zonder kaarten 1 kaart van de linkerbuur met kaarten.',
    royalFamily: 'Als de winnaar de ronde begon met een Heer en er een andere speler is die de ronde begon met een Vrouw, dan wordt de pot verdeeld over de winnaar en alle andere spelers die de ronde begonnen met een Vrouw, de hoogste kaart eerst.',
    suitBreak: 'Bij een gelijkspel wint de speler met het hoogste symbool.'
  };
  if (J(sixRules.map(r => r[0])) !== J(Object.keys(expectSix))) fail('de catalogus heeft andere regels dan de test kent: ' + J(sixRules.map(r => r[0])));
  for (const [id, text] of sixRules) if (text !== expectSix[id]) fail('zin van ' + id + ': verwacht ' + J(expectSix[id]) + ', kreeg ' + J(text));

  // Zinnen voor alle bouwstenen (nagelezen op Nederlands).
  const golden = [
    [{"moment": "decide", "then": {"win": {"rank": "2"}}}, "Altijd winnen de spelers met een 2. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"rank": ["K", "Q", "A"]}}}, "Altijd winnen de spelers met een Heer, een Vrouw of een Aas. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"rank": "10"}}}, "Altijd winnen de spelers met een 10. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"rank": "J"}}}, "Altijd winnen de spelers met een Boer. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"suit": "♥"}}}, "Altijd winnen de spelers met een kaart van harten. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"suit": ["♥", "♦"]}}}, "Altijd winnen de spelers met een kaart van harten of ruiten. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"color": "red"}}}, "Altijd winnen de spelers met een rode kaart. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"color": "black"}}}, "Altijd winnen de spelers met een zwarte kaart. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"all": true}}}, "Altijd winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"highest": "value"}}}, "Altijd winnen de spelers met de hoogste kaart. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"lowest": "value"}}}, "Altijd winnen de spelers met de laagste kaart. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"highest": "suitOrder"}}}, "Altijd winnen de spelers met het hoogste symbool. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"lowest": "suitOrder"}}}, "Altijd winnen de spelers met het laagste symbool. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"highest": "value", "of": {"color": "red"}}}}, "Altijd winnen de spelers met de hoogste kaart onder de rode kaarten. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"highest": "suitOrder", "of": {"rank": "K"}}}}, "Altijd winnen de spelers met het hoogste symbool onder de Heren. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"group": {"relation": "sameRank", "min": 2, "pick": "highest"}}}}, "Altijd winnen de spelers in de hoogste groep van minstens 2 kaarten met dezelfde waarde. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"group": {"relation": "sameSuit", "min": 3, "pick": "highest"}}}}, "Altijd winnen de spelers in de hoogste groep van minstens 3 kaarten van hetzelfde symbool. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"group": {"relation": "sameColor", "min": 4, "pick": "highest"}}}}, "Altijd winnen de spelers in de hoogste groep van minstens 4 kaarten van dezelfde kleur. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"group": {"relation": "consecutive", "min": 3, "pick": "highest"}}}}, "Altijd winnen de spelers in de hoogste groep van minstens 3 kaarten met opeenvolgende waarden. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"and": [{"color": "red"}, {"rank": "K"}]}}}, "Altijd winnen de spelers met een rode kaart die ook een Heer is. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"and": [{"suit": "♥"}, {"not": {"rank": "K"}}]}}}, "Altijd winnen de spelers met een kaart van harten die ook geen Heer is. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"or": [{"rank": "K"}, {"color": "red"}]}}}, "Altijd winnen de spelers met een Heer of een rode kaart. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"not": {"rank": ["K", "Q"]}}}}, "Altijd winnen de spelers met een kaart die geen Heer of Vrouw is. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "then": {"win": {"and": [{"suit": "♥"}, {"rank": "K"}, {"not": {"rank": "A"}}]}}}, "Altijd winnen de spelers met een kaart van harten die ook een Heer is en ook geen Aas is. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "tiebreak", "then": {"win": {"highest": "suitOrder"}}}, "Bij een gelijkspel wint de speler met het hoogste symbool."],
    [{"moment": "tiebreak", "then": {"win": {"rank": "K"}}}, "Bij een gelijkspel wint de speler met een Heer."],
    [{"moment": "tiebreak", "if": {"exists": {"rank": "A"}}, "then": {"win": {"lowest": "suitOrder"}}}, "Bij een gelijkspel: als er een Aas ligt, dan wint de speler met het laagste symbool."],
    [{"moment": "decide", "if": {"exists": {"suit": "♠"}}, "then": {"win": {"all": true}}}, "Als er een kaart van schoppen ligt, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"exists": {"group": {"relation": "sameRank", "min": 2, "pick": "highest"}}}, "then": {"win": {"all": true}}}, "Als er een groep van minstens 2 kaarten met dezelfde waarde ligt, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"exists": {"highest": "value"}}, "then": {"win": {"all": true}}}, "Als er een kaart die de hoogste kaart is ligt, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "min": 2}, "then": {"win": {"all": true}}}, "Als er minstens 2 Azen liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "min": 1}, "then": {"win": {"all": true}}}, "Als er minstens één Aas ligt, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "max": 1}, "then": {"win": {"all": true}}}, "Als er ten hoogste één Aas ligt, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "max": 0}, "then": {"win": {"all": true}}}, "Als er geen Azen liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "min": 0, "max": 0}, "then": {"win": {"all": true}}}, "Als er geen Azen liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "min": 2, "max": 2}, "then": {"win": {"all": true}}}, "Als er precies 2 Azen liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "min": 1, "max": 1}, "then": {"win": {"all": true}}}, "Als er precies één Aas ligt, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "min": 1, "max": 3}, "then": {"win": {"all": true}}}, "Als er tussen 1 en 3 Azen liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"rank": "A"}, "min": 0}, "then": {"win": {"all": true}}}, "Als er minstens 0 Azen liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"color": "red"}, "min": 3}, "then": {"win": {"all": true}}}, "Als er minstens 3 rode kaarten liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"count": {"suit": "♥"}, "max": 2}, "then": {"win": {"all": true}}}, "Als er ten hoogste 2 kaarten van harten liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"and": [{"exists": {"rank": "A"}}, {"exists": {"rank": "2"}}, {"count": {"rank": "K"}, "min": 2}]}, "then": {"win": {"all": true}}}, "Als er een Aas ligt, er een 2 ligt en er minstens 2 Heren liggen, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"or": [{"exists": {"rank": "A"}}, {"and": [{"exists": {"rank": "2"}}, {"exists": {"rank": "3"}}]}]}, "then": {"win": {"all": true}}}, "Als er een Aas ligt of (er een 2 ligt en er een 3 ligt), dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"not": {"exists": {"rank": "A"}}}, "then": {"win": {"all": true}}}, "Als het niet zo is dat er een Aas ligt, dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "decide", "if": {"not": {"or": [{"exists": {"rank": "A"}}, {"exists": {"rank": "2"}}]}}, "then": {"win": {"all": true}}}, "Als het niet zo is dat (er een Aas ligt of er een 2 ligt), dan winnen alle spelers. Zijn het er meer dan één, dan battlen zij."],
    [{"moment": "award", "if": {"battle": true}, "then": {"discardPot": true}}, "Als er een battle is geweest, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"winnerOpened": {"rank": "A"}}, "then": {"discardPot": true}}, "Als de winnaar de ronde begon met een Aas, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"winnerOpened": {"color": "red"}}, "then": {"discardPot": true}}, "Als de winnaar de ronde begon met een rode kaart, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"winnerOpened": {"and": [{"rank": "K"}, {"suit": "♠"}]}}, "then": {"discardPot": true}}, "Als de winnaar de ronde begon met een Heer die ook een kaart van schoppen is, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"anyPlayer": {"opened": {"rank": "Q"}}}, "then": {"discardPot": true}}, "Als er een speler is die de ronde begon met een Vrouw, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"anyPlayer": {"opened": {"rank": "Q"}, "exclude": "winner"}}, "then": {"discardPot": true}}, "Als er een andere speler is die de ronde begon met een Vrouw, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"anyPlayer": {"withoutCards": true}}, "then": {"discardPot": true}}, "Als er een speler zonder kaarten is, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"anyPlayer": "winner"}, "then": {"discardPot": true}}, "Als er een winnaar is, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"playersWithCards": {"min": 2}}, "then": {"discardPot": true}}, "Als minstens 2 spelers kaarten hebben, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"playersWithCards": {"min": 1}}, "then": {"discardPot": true}}, "Als minstens één speler kaarten heeft, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"playersWithCards": {"max": 2}}, "then": {"discardPot": true}}, "Als ten hoogste 2 spelers kaarten hebben, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"playersWithCards": {"max": 0}}, "then": {"discardPot": true}}, "Als geen enkele speler kaarten heeft, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"playersWithCards": {"min": 3, "max": 3}}, "then": {"discardPot": true}}, "Als precies 3 spelers kaarten hebben, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"playersWithCards": {"min": 2, "max": 4}}, "then": {"discardPot": true}}, "Als tussen 2 en 4 spelers kaarten hebben, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"playersWithCards": {"min": 1, "max": 1}}, "then": {"discardPot": true}}, "Als precies één speler kaarten heeft, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"not": {"battle": true}}, "then": {"discardPot": true}}, "Als het niet zo is dat er een battle is geweest, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "if": {"and": [{"battle": true}, {"winnerOpened": {"rank": "K"}}]}, "then": {"discardPot": true}}, "Als er een battle is geweest en de winnaar de ronde begon met een Heer, dan gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "then": {"discardPot": true}}, "Altijd gaat de hele pot naar de aflegstapel."],
    [{"moment": "award", "then": {"sharePot": ["winner"]}}, "Altijd wordt de pot verdeeld over de winnaar, de hoogste kaart eerst."],
    [{"moment": "award", "then": {"sharePot": ["winner", {"opened": {"rank": "Q"}, "exclude": "winner"}]}}, "Altijd wordt de pot verdeeld over de winnaar en alle andere spelers die de ronde begonnen met een Vrouw, de hoogste kaart eerst."],
    [{"moment": "award", "then": {"sharePot": [{"opened": {"rank": "K"}}, {"opened": {"rank": "Q"}}, {"withoutCards": true}]}}, "Altijd wordt de pot verdeeld over alle spelers die de ronde begonnen met een Heer, alle spelers die de ronde begonnen met een Vrouw en alle spelers zonder kaarten, de hoogste kaart eerst."],
    [{"moment": "award", "then": {"sharePot": [{"withoutCards": true}]}}, "Altijd wordt de pot verdeeld over alle spelers zonder kaarten, de hoogste kaart eerst."],
    [{"moment": "roundEnd", "then": {"forEach": {"withoutCards": true}, "transfer": {"from": {"neighbor": "right"}, "count": 2}}}, "Aan het einde van de ronde krijgt elke speler zonder kaarten 2 kaarten van de rechterbuur met kaarten."],
    [{"moment": "roundEnd", "then": {"forEach": {"withoutCards": true}, "transfer": {"from": {"opened": {"rank": "A"}}, "count": 1}}}, "Aan het einde van de ronde krijgt elke speler zonder kaarten 1 kaart van de eerste speler die de ronde begon met een Aas."],
    [{"moment": "roundEnd", "then": {"forEach": {"opened": {"rank": "K"}}, "discardTop": 1}}, "Aan het einde van de ronde legt elke speler die de ronde begon met een Heer zijn bovenste kaart af."],
    [{"moment": "roundEnd", "then": {"forEach": {"opened": {"rank": ["K", "Q"]}}, "discardTop": 3}}, "Aan het einde van de ronde legt elke speler die de ronde begon met een Heer of een Vrouw zijn bovenste 3 kaarten af."],
    [{"moment": "roundEnd", "then": {"forEach": {"withoutCards": true}, "discardTop": 1}}, "Aan het einde van de ronde legt elke speler zonder kaarten zijn bovenste kaart af."],
    [{"moment": "roundEnd", "if": {"anyPlayer": {"opened": {"rank": "A"}}}, "then": {"forEach": {"withoutCards": true}, "discardTop": 1}}, "Aan het einde van de ronde: als er een speler is die de ronde begon met een Aas, dan legt elke speler zonder kaarten zijn bovenste kaart af."],
    [{"moment": "roundEnd", "if": {"playersWithCards": {"max": 1}}, "then": {"forEach": {"withoutCards": true}, "discardTop": 1}}, "Aan het einde van de ronde: als ten hoogste één speler kaarten heeft, dan legt elke speler zonder kaarten zijn bovenste kaart af."]
  ];
  for (const [logic, text] of golden){
    const got = describe(logic);
    if (got !== text) fail('zin voor ' + J(logic) + ': verwacht ' + J(text) + ', kreeg ' + J(got));
  }
  // Geen zin voor een beschrijving die niet klopt.
  for (const bad of [null, 'x', {}, { moment: 'decide', then: { win: { rank: 'Z' } } }, { moment: 'award', then: { win: { all: true } } }, { moment: 'decide', then: { win: { all: true } }, code: 1 }])
    if (describe(bad) !== '') fail('een beschrijving die niet klopt krijgt toch een zin: ' + J(bad));
  // Elke zin begint met een hoofdletter en eindigt op een punt; geen dubbele spaties.
  for (const [logic] of golden){
    const t = describe(logic);
    if (!/^[A-Z]/.test(t) || !/\.$/.test(t) || /  /.test(t)) fail('zin ziet er niet uit als een zin: ' + J(t));
  }

  // De lijst met bouwstenen komt precies overeen met de controle: een bouwsteen die bij een moment wordt aangeboden, wordt door de controle
  // geaccepteerd, en een die er niet bij hoort, geweigerd.
  const valid = logic => JSON.parse(run('JSON.stringify(validateRuleLogic(' + J(logic) + '))')).length === 0;
  const blocks = JSON.parse(run('JSON.stringify(RULE_BLOCKS)'));
  const sample = (key, group, moment) => JSON.parse(run('JSON.stringify(ruleBlockSample(RULE_BLOCKS.' + group + '.find(b => b.key === ' + J(key) + '), ' + J(moment) + '))'));
  const effectFor = { decide: { win: { all: true } }, tiebreak: { win: { all: true } }, award: { discardPot: true }, roundEnd: { forEach: { withoutCards: true }, discardTop: 1 } };
  for (const moment of ['decide', 'tiebreak', 'award', 'roundEnd']){
    for (const b of blocks.conditions){
      const logic = { moment, if: sample(b.key, 'conditions', moment), then: effectFor[moment] };
      const wanted = b.moments.includes(moment), got = valid(logic);
      if (wanted !== got) fail('voorwaarde ' + b.key + ' bij ' + moment + ': de lijst zegt ' + wanted + ', de controle ' + got);
      if (got && describe(logic) === '') fail('voorwaarde ' + b.key + ' bij ' + moment + ' geeft geen zin');
    }
    for (const b of blocks.effects){
      const logic = { moment, then: sample(b.key, 'effects', moment) };
      const wanted = b.moments.includes(moment), got = valid(logic);
      if (wanted !== got) fail('gevolg ' + b.key + ' bij ' + moment + ': de lijst zegt ' + wanted + ', de controle ' + got);
      if (got && describe(logic) === '') fail('gevolg ' + b.key + ' bij ' + moment + ' geeft geen zin');
    }
    const choices = JSON.parse(run('JSON.stringify(ruleChoicesFor(' + J(moment) + '))'));
    if (J(choices.conditions.map(c => c.key)) !== J(blocks.conditions.filter(b => b.moments.includes(moment)).map(b => b.key))) fail('ruleChoicesFor(' + moment + ') geeft andere voorwaarden dan de lijst');
    if (J(choices.effects.map(c => c.key)) !== J(blocks.effects.filter(b => b.moments.includes(moment)).map(b => b.key))) fail('ruleChoicesFor(' + moment + ') geeft andere gevolgen dan de lijst');
    if (!choices.moment || !choices.moment.label || choices.cards.length !== blocks.cards.length) fail('ruleChoicesFor(' + moment + ') mist het moment of de kaarten');
    if (J(choices.singleCards.map(c => c.key)) !== J(blocks.singleCards)) fail('ruleChoicesFor(' + moment + ') geeft andere enkele kaarten dan de lijst');
  }
  if (run('ruleChoicesFor("bestaat-niet").moment') !== null) fail('ruleChoicesFor van een onbekend moment hoort geen moment te geven');
  // Kaarten: elke keuze past bij "deze spelers winnen"; alleen de enkele soorten passen bij "begon met een kaart".
  for (const b of blocks.cards){
    const inWin = valid({ moment: 'decide', then: { win: b.sample } });
    if (!inWin) fail('kaartkeuze ' + b.key + ' wordt bij winnen geweigerd');
    const asSingle = valid({ moment: 'award', if: { winnerOpened: b.sample }, then: { discardPot: true } });
    if (asSingle !== blocks.singleCards.includes(b.key)) fail('kaartkeuze ' + b.key + ': de lijst met enkele kaarten klopt niet met de controle (' + asSingle + ')');
    if (describe({ moment: 'decide', then: { win: b.sample } }) === '') fail('kaartkeuze ' + b.key + ' geeft geen zin');
  }
  // Spelers: elke keuze past precies op de plekken en bij de momenten die de lijst noemt (de winnaar bestaat alleen bij award).
  const slotLogic = {
    sharePot: (p, m) => ({ moment: m, then: { sharePot: [p] } }),
    forEach: (p, m) => ({ moment: m, then: { forEach: p, discardTop: 1 } }),
    anyPlayer: (p, m) => ({ moment: m, if: { anyPlayer: p }, then: m === 'award' ? { discardPot: true } : { forEach: { withoutCards: true }, discardTop: 1 } }),
    from: (p, m) => ({ moment: m, then: { forEach: { withoutCards: true }, transfer: { from: p, count: 1 } } })
  };
  const slotMoments = blocks.playerSlots;
  for (const b of blocks.players) for (const slot of Object.keys(slotLogic)){
    // Op een plek die bij dit moment niet bestaat, hoort de keuze er niet te staan.
    const slotWanted = b.slots.includes(slot);
    for (const moment of ['decide', 'tiebreak', 'award', 'roundEnd']){
      const slotExists = slotMoments[slot].includes(moment);
      if (!slotExists) continue; // bestaat de plek niet bij dit moment, dan is het blok sowieso ongeldig
      const wanted = slotWanted && b.moments.includes(moment), got = valid(slotLogic[slot](b.sample, moment));
      if (wanted !== got) fail('spelerskeuze ' + b.key + ' op plek ' + slot + ' bij ' + moment + ': de lijst zegt ' + wanted + ', de controle ' + got);
      if (got && describe(slotLogic[slot](b.sample, moment)) === '') fail('spelerskeuze ' + b.key + ' op plek ' + slot + ' bij ' + moment + ' geeft geen zin');
      const listed = JSON.parse(run('JSON.stringify(rulePlayerChoices(' + J(slot) + ', ' + J(moment) + ').map(c => c.key))')).includes(b.key);
      if (listed !== wanted) fail('rulePlayerChoices(' + slot + ', ' + moment + ') en de lijst wijken af voor ' + b.key);
      if (b.key === 'opened'){ // "behalve de winnaar"
        const ex = { opened: { rank: 'Q' }, exclude: 'winner' };
        const wantedEx = wanted && b.excludeMoments.includes(moment);
        if (valid(slotLogic[slot](ex, moment)) !== wantedEx) fail('"behalve de winnaar" op plek ' + slot + ' bij ' + moment + ': de lijst zegt ' + wantedEx);
      }
    }
    const listedAny = JSON.parse(run('JSON.stringify(rulePlayerChoices(' + J(slot) + ').map(c => c.key))')).includes(b.key);
    if (listedAny !== slotWanted) fail('rulePlayerChoices(' + slot + ') en de lijst wijken af voor ' + b.key);
  }
  // Elke keuze heeft een naam, en de namen zijn uniek binnen hun lijst.
  for (const group of ['conditions', 'effects', 'cards', 'players']){
    const labels = blocks[group].map(b => b.label);
    if (labels.some(l => typeof l !== 'string' || l.trim() === '') || new Set(labels).size !== labels.length) fail('de namen in ' + group + ' ontbreken of zijn niet uniek');
    if (new Set(blocks[group].map(b => b.key)).size !== blocks[group].length) fail('dubbele sleutel in ' + group);
  }
  // Elke regel van het spel en elk voorbeeldblok krijgt een zin (de spelers lezen die straks in het venster).
  if (describe(JSON.parse(run('JSON.stringify(CUSTOM_RULE_SAMPLE.logic)'))) !== 'Altijd winnen de spelers in de hoogste groep van minstens 3 kaarten met opeenvolgende waarden. Zijn het er meer dan één, dan battlen zij.') fail('het voorbeeldblok krijgt een andere zin');
}

// ---- de regelbouwer (js/rule-builder.js) ----
{
  const fail = t => failures.push('regelbouwer: ' + t);
  const J = v => JSON.stringify(v);
  const R = code => JSON.parse(run('JSON.stringify(' + code + ')'));
  const catalogBefore = J(R('RULES.map(r => r.id)'));

  // 1. Alle zes regels van het spel, en het voorbeeldblok, zijn te tonen in de bouwer en komen er identiek weer uit.
  const roundTrip = JSON.parse(run(`JSON.stringify(RULES.map(r => ({ id: r.id, logic: r.logic })).concat([{ id: 'sample', logic: CUSTOM_RULE_SAMPLE.logic }]).map(x => {
    const st = rbFromLogic(x.logic); const back = st ? rbToLogic(st) : null;
    return [x.id, !!st, back && back.logic ? JSON.stringify(back.logic) === JSON.stringify(x.logic) : false]; }))`));
  for (const [id, shown, same] of roundTrip){
    if (!shown) fail(id + ' is niet te tonen in de bouwer');
    else if (!same) fail(id + ' komt na de bouwer niet identiek terug');
  }

  // 2. Stand -> beschrijving -> stand -> beschrijving, voor veel standen die elk soort keuze gebruiken (en de bouwer verandert de stand niet).
  const states = JSON.parse(run(`(() => {
    const cs = (kind, extra) => Object.assign(rbNewCards(kind), extra || {});
    const cardKinds = [cs('rank', { ranks: ['K', 'Q'] }), cs('rank', { ranks: ['10'], not: true }), cs('suit', { suits: ['♥', '♦'] }), cs('color', { color: 'black' }), cs('all'),
      cs('highest'), cs('highest', { by: 'suitOrder', of: 'red' }), cs('lowest', { by: 'value', of: 'black' }), cs('group', { relation: 'consecutive', min: 3 }), cs('group', { relation: 'sameSuit', min: 2 }),
      cs('rank', { ranks: ['A'], also: cs('suit', { suits: ['♠'] }) }), cs('color', { color: 'red', not: true, also: cs('rank', { ranks: ['K'] }) })];
    const single = cardKinds.filter(c => ['rank', 'suit', 'color'].includes(c.kind));
    const out = [];
    const st = (moment, conds, effect, mode) => { const s = rbNewState(moment); s.conds = conds; s.effect = effect; s.condMode = mode || 'and'; return s; };
    const win = c => Object.assign(rbNewEffect('win'), { cs: c });
    for (const c of cardKinds){
      out.push(st('decide', [], win(c)));
      out.push(st('tiebreak', [], win(c)));
      out.push(st('decide', [Object.assign(rbNewCond('exists'), { cs: c })], win(cs('rank', { ranks: ['2'] }))));
      for (const mode of ['min', 'max', 'exact', 'between']) out.push(st('decide', [Object.assign(rbNewCond('count'), { cs: c, mode, n: 1, m: 3, not: mode === 'max' })], win(cs('all'))));
    }
    for (const c of single){
      out.push(st('award', [Object.assign(rbNewCond('winnerOpened'), { cs: c })], rbNewEffect('discardPot')));
      out.push(st('award', [Object.assign(rbNewCond('anyPlayer'), { who: 'opened', cs: c, other: true })], rbNewEffect('discardPot')));
      out.push(st('roundEnd', [Object.assign(rbNewCond('anyPlayer'), { who: 'opened', cs: c })], rbNewEffect('discardTop')));
      const eff = Object.assign(rbNewEffect('discardTop'), { each: Object.assign(rbNewPlayer('opened'), { cs: c }), count: 2 });
      out.push(st('roundEnd', [], eff));
      const tr = Object.assign(rbNewEffect('transfer'), { each: rbNewPlayer('withoutCards'), from: Object.assign(rbNewPlayer('opened'), { cs: c }), count: 3 });
      out.push(st('roundEnd', [], tr));
    }
    out.push(st('award', [Object.assign(rbNewCond('anyPlayer'), { who: 'winner' }), Object.assign(rbNewCond('battle'), { not: true })], rbNewEffect('sharePot'), 'or'));
    out.push(st('award', [Object.assign(rbNewCond('playersWithCards'), { mode: 'between', n: 2, m: 4 })], Object.assign(rbNewEffect('sharePot'), { who: [rbNewPlayer('winner'), Object.assign(rbNewPlayer('opened'), { other: true }), rbNewPlayer('withoutCards')] })));
    out.push(st('roundEnd', [Object.assign(rbNewCond('playersWithCards'), { mode: 'max', n: 3 })], Object.assign(rbNewEffect('transfer'), { each: rbNewPlayer('withoutCards'), from: Object.assign(rbNewPlayer('neighbor'), { side: 'right' }), count: 2 })));
    for (const m of ['decide', 'tiebreak', 'award', 'roundEnd']) out.push(rbNewState(m));
    out.push(st('decide', [Object.assign(rbNewCond('exists'), { cs: cs('rank', { ranks: ['A'] }) }), Object.assign(rbNewCond('count'), { cs: cs('rank', { ranks: ['2'] }), mode: 'min', n: 2 }), Object.assign(rbNewCond('exists'), { cs: cs('suit', { suits: ['♣'] }), not: true })], win(cs('highest')), 'or'));
    return JSON.stringify(out); })()`));
  let built = 0;
  for (const st of states){
    const before = J(st);
    const r = JSON.parse(run('JSON.stringify(rbToLogic(' + before + '))'));
    if (r.error){ fail('een stand die hoort te kloppen geeft een fout: ' + r.error + ' bij ' + before.slice(0, 200)); continue; }
    built++;
    const again = JSON.parse(run('(() => { const st = ' + before + '; const a = rbToLogic(st); const back = rbFromLogic(a.logic); return JSON.stringify({ same: JSON.stringify(st) === ' + J(before) + ', back: back ? rbToLogic(back) : null, sentence: describeRuleLogic(a.logic) }); })()'));
    if (!again.same) fail('rbToLogic verandert de stand');
    if (!again.back || J(again.back.logic) !== J(r.logic)) fail('niet identiek na terugtonen: ' + J(r.logic).slice(0, 300) + ' -> ' + J(again.back && again.back.logic).slice(0, 300));
    if (!again.sentence) fail('geen zin voor ' + J(r.logic).slice(0, 200));
  }
  if (built < 60) fail('te weinig standen getest (' + built + ')');

  // 2b. Vaste uitkomsten: een stand geeft precies deze beschrijving (de terugweg alleen bewijst niet dat niets verloren gaat).
  const golden = JSON.parse(run(`(() => {
    const cs = (kind, extra) => Object.assign(rbNewCards(kind), extra || {});
    const st = (moment, conds, effect, mode) => { const s = rbNewState(moment); s.conds = conds; s.effect = effect; s.condMode = mode || 'and'; return s; };
    const win = c => Object.assign(rbNewEffect('win'), { cs: c });
    const cond = (key, extra) => Object.assign(rbNewCond(key), extra);
    const cases = [
      ['waarden staan op volgorde, hoogste eerst', st('decide', [], win(cs('rank', { ranks: ['Q', '2', 'A', 'K'] }))), { moment: 'decide', then: { win: { rank: ['A', 'K', 'Q', '2'] } } }],
      ['symbolen op volgorde van het spel', st('decide', [], win(cs('suit', { suits: ['♣', '♥', '♠'] }))), { moment: 'decide', then: { win: { suit: ['♠', '♥', '♣'] } } }],
      ['niet', st('decide', [], win(cs('rank', { ranks: ['10'], not: true }))), { moment: 'decide', then: { win: { not: { rank: '10' } } } }],
      ['een tweede eis', st('decide', [], win(cs('suit', { suits: ['♠'], also: cs('rank', { ranks: ['K'] }) }))), { moment: 'decide', then: { win: { and: [{ suit: '♠' }, { rank: 'K' }] } } }],
      ['een tweede eis met niet', st('decide', [], win(cs('color', { color: 'red', not: true, also: cs('rank', { ranks: ['K'] }) }))), { moment: 'decide', then: { win: { not: { and: [{ color: 'red' }, { rank: 'K' }] } } } }],
      ['hoogste onder rood', st('decide', [], win(cs('highest', { by: 'suitOrder', of: 'red' }))), { moment: 'decide', then: { win: { highest: 'suitOrder', of: { color: 'red' } } } }],
      ['laagste zonder beperking', st('decide', [], win(cs('lowest', { of: 'none' }))), { moment: 'decide', then: { win: { lowest: 'value' } } }],
      ['groep', st('decide', [], win(cs('group', { relation: 'consecutive', min: 4 }))), { moment: 'decide', then: { win: { group: { relation: 'consecutive', min: 4, pick: 'highest' } } } }],
      ['tellen: minstens', st('decide', [cond('count', { cs: cs('rank', { ranks: ['A'] }), mode: 'min', n: 2 })], win(cs('all'))), { moment: 'decide', if: { count: { rank: 'A' }, min: 2 }, then: { win: { all: true } } }],
      ['tellen: ten hoogste', st('decide', [cond('count', { cs: cs('rank', { ranks: ['A'] }), mode: 'max', n: 1 })], win(cs('all'))), { moment: 'decide', if: { count: { rank: 'A' }, max: 1 }, then: { win: { all: true } } }],
      ['tellen: precies', st('decide', [cond('count', { cs: cs('rank', { ranks: ['A'] }), mode: 'exact', n: 2 })], win(cs('all'))), { moment: 'decide', if: { count: { rank: 'A' }, min: 2, max: 2 }, then: { win: { all: true } } }],
      ['tellen: tussen', st('decide', [cond('count', { cs: cs('rank', { ranks: ['A'] }), mode: 'between', n: 1, m: 3 })], win(cs('all'))), { moment: 'decide', if: { count: { rank: 'A' }, min: 1, max: 3 }, then: { win: { all: true } } }],
      ['voorwaarde niet', st('decide', [cond('exists', { cs: cs('rank', { ranks: ['A'] }), not: true })], win(cs('all'))), { moment: 'decide', if: { not: { exists: { rank: 'A' } } }, then: { win: { all: true } } }],
      ['twee voorwaarden met en', st('decide', [cond('exists', { cs: cs('rank', { ranks: ['A'] }) }), cond('exists', { cs: cs('rank', { ranks: ['2'] }) })], win(cs('all'))), { moment: 'decide', if: { and: [{ exists: { rank: 'A' } }, { exists: { rank: '2' } }] }, then: { win: { all: true } } }],
      ['twee voorwaarden met of', st('decide', [cond('exists', { cs: cs('rank', { ranks: ['A'] }) }), cond('exists', { cs: cs('rank', { ranks: ['2'] }) })], win(cs('all')), 'or'), { moment: 'decide', if: { or: [{ exists: { rank: 'A' } }, { exists: { rank: '2' } }] }, then: { win: { all: true } } }],
      ['de winnaar begon met', st('award', [cond('winnerOpened', { cs: cs('rank', { ranks: ['K'] }) })], rbNewEffect('discardPot')), { moment: 'award', if: { winnerOpened: { rank: 'K' } }, then: { discardPot: true } }],
      ['een andere speler begon met', st('award', [cond('anyPlayer', { who: 'opened', cs: cs('rank', { ranks: ['Q'] }), other: true })], rbNewEffect('discardPot')), { moment: 'award', if: { anyPlayer: { opened: { rank: 'Q' }, exclude: 'winner' } }, then: { discardPot: true } }],
      ['aantal spelers met kaarten', st('roundEnd', [cond('playersWithCards', { mode: 'between', n: 2, m: 5 })], rbNewEffect('discardTop')), { moment: 'roundEnd', if: { playersWithCards: { min: 2, max: 5 } }, then: { forEach: { opened: { rank: 'A' } }, discardTop: 1 } }],
      ['de pot verdelen', st('award', [], Object.assign(rbNewEffect('sharePot'), { who: [rbNewPlayer('winner'), Object.assign(rbNewPlayer('opened'), { cs: cs('rank', { ranks: ['Q'] }), other: true })] })), { moment: 'award', then: { sharePot: ['winner', { opened: { rank: 'Q' }, exclude: 'winner' }] } }],
      ['kaarten krijgen van een buur', st('roundEnd', [], Object.assign(rbNewEffect('transfer'), { each: rbNewPlayer('withoutCards'), from: Object.assign(rbNewPlayer('neighbor'), { side: 'right' }), count: 2 })), { moment: 'roundEnd', then: { forEach: { withoutCards: true }, transfer: { from: { neighbor: 'right' }, count: 2 } } }],
      ['kaarten afleggen', st('roundEnd', [], Object.assign(rbNewEffect('discardTop'), { each: Object.assign(rbNewPlayer('opened'), { cs: cs('suit', { suits: ['♥'] }) }), count: 3 })), { moment: 'roundEnd', then: { forEach: { opened: { suit: '♥' } }, discardTop: 3 } }],
      ['de beginstand per moment', rbNewState('tiebreak'), { moment: 'tiebreak', then: { win: { highest: 'suitOrder' } } }],
      ['een groep: a en (b of c)', st('decide', [cond('exists', { cs: cs('rank', { ranks: ['2'] }) }), Object.assign(rbNewCond('group'), { mode: 'or', conds: [cond('exists', { cs: cs('rank', { ranks: ['A'] }) }), cond('exists', { cs: cs('rank', { ranks: ['K'] }) })] })], win(cs('all'))),
        { moment: 'decide', if: { and: [{ exists: { rank: '2' } }, { or: [{ exists: { rank: 'A' } }, { exists: { rank: 'K' } }] }] }, then: { win: { all: true } } }],
      ['een groep met niet: a of niet (b en c)', st('decide', [cond('exists', { cs: cs('rank', { ranks: ['2'] }) }), Object.assign(rbNewCond('group'), { mode: 'and', not: true, conds: [cond('exists', { cs: cs('rank', { ranks: ['A'] }) }), cond('count', { cs: cs('rank', { ranks: ['K'] }), mode: 'min', n: 2 })] })], win(cs('all')), 'or'),
        { moment: 'decide', if: { or: [{ exists: { rank: '2' } }, { not: { and: [{ exists: { rank: 'A' } }, { count: { rank: 'K' }, min: 2 }] } }] }, then: { win: { all: true } } }],
      ['een groep met één voorwaarde is die voorwaarde', st('decide', [Object.assign(rbNewCond('group'), { conds: [cond('exists', { cs: cs('rank', { ranks: ['A'] }) })] })], win(cs('all'))),
        { moment: 'decide', if: { exists: { rank: 'A' } }, then: { win: { all: true } } }],
      ['alleen een ontkende groep', st('award', [Object.assign(rbNewCond('group'), { mode: 'or', not: true, conds: [cond('battle', {}), cond('winnerOpened', { cs: cs('rank', { ranks: ['K'] }) })] })], rbNewEffect('discardPot')),
        { moment: 'award', if: { not: { or: [{ battle: true }, { winnerOpened: { rank: 'K' } }] } }, then: { discardPot: true } }]
    ];
    return JSON.stringify(cases.map(([name, state, expected]) => [name, JSON.stringify(rbToLogic(state).logic) === JSON.stringify(expected), rbToLogic(state).logic || rbToLogic(state).error])); })()`));
  for (const [name, same, got] of golden) if (!same) fail('vaste uitkomst "' + name + '": kreeg ' + J(got));
  if (golden.length < 20) fail('te weinig vaste uitkomsten (' + golden.length + ')');

  // 3. Meldingen bij een stand die nog niet klopt.
  const errorOf = code => R('(() => { const st = ' + code + '; return rbToLogic(st).error || null; })()');
  const bad = [
    ['geen waarde', 'Object.assign(rbNewState("decide"), { effect: Object.assign(rbNewEffect("win"), { cs: Object.assign(rbNewCards("rank"), { ranks: [] }) }) })', 'Kies minstens één waarde.'],
    ['geen symbool', 'Object.assign(rbNewState("decide"), { effect: Object.assign(rbNewEffect("win"), { cs: Object.assign(rbNewCards("suit"), { suits: [] }) }) })', 'Kies minstens één symbool.'],
    ['groep van 1', 'Object.assign(rbNewState("decide"), { effect: Object.assign(rbNewEffect("win"), { cs: Object.assign(rbNewCards("group"), { min: 1 }) }) })', 'Aantal kaarten in de groep: een getal van 2 t/m 8 verwacht.'],
    ['groep geen getal', 'Object.assign(rbNewState("decide"), { effect: Object.assign(rbNewEffect("win"), { cs: Object.assign(rbNewCards("group"), { min: NaN }) }) })', 'Aantal kaarten in de groep: een getal van 2 t/m 8 verwacht.'],
    ['tweede aantal te klein', 'Object.assign(rbNewState("decide"), { conds: [Object.assign(rbNewCond("count"), { mode: "between", n: 3, m: 2 })] })', 'Het tweede aantal moet minstens zo groot zijn als het eerste.'],
    ['aantal geen getal', 'Object.assign(rbNewState("decide"), { conds: [Object.assign(rbNewCond("count"), { n: NaN })] })', 'Het aantal: een getal van 0 t/m 52 verwacht.'],
    ['aantal spelers te groot', 'Object.assign(rbNewState("award"), { conds: [Object.assign(rbNewCond("playersWithCards"), { n: 9 })] })', 'Het aantal: een getal van 0 t/m 8 verwacht.'],
    ['winnaar bij roundEnd', 'Object.assign(rbNewState("roundEnd"), { conds: [Object.assign(rbNewCond("anyPlayer"), { who: "winner" })] })', 'De winnaar bestaat alleen als de pot wordt toegekend.'],
    ['behalve de winnaar bij roundEnd', 'Object.assign(rbNewState("roundEnd"), { effect: Object.assign(rbNewEffect("discardTop"), { each: Object.assign(rbNewPlayer("opened"), { other: true }) }) })', '"Behalve de winnaar" kan alleen als de pot wordt toegekend.'],
    ['verdelen over niemand', 'Object.assign(rbNewState("award"), { effect: Object.assign(rbNewEffect("sharePot"), { who: [] }) })', 'Kies over welke spelers de pot wordt verdeeld.'],
    ['0 kaarten afleggen', 'Object.assign(rbNewState("roundEnd"), { effect: Object.assign(rbNewEffect("discardTop"), { count: 0 }) })', 'Het aantal kaarten: een getal van 1 t/m 52 verwacht.'],
    ['geen kant van de buur', 'Object.assign(rbNewState("roundEnd"), { effect: Object.assign(rbNewEffect("transfer"), { from: Object.assign(rbNewPlayer("neighbor"), { side: "boven" }) }) })', 'Kies de linker- of rechterbuur.'],
    ['geen soort kaarten', 'Object.assign(rbNewState("decide"), { effect: Object.assign(rbNewEffect("win"), { cs: { kind: "iets" } }) })', 'Kies welke kaarten bedoeld zijn.'],
    ['geen gevolg', 'Object.assign(rbNewState("decide"), { effect: { key: "iets" } })', 'Kies wat er gebeurt.'],
    ['lege groep', 'Object.assign(rbNewState("decide"), { conds: [rbNewCond("group")] })', 'Voeg een voorwaarde toe aan de groep.'],
    ['groep in een groep', 'Object.assign(rbNewState("decide"), { conds: [Object.assign(rbNewCond("group"), { conds: [Object.assign(rbNewCond("group"), { conds: [rbNewCond("exists")] })] })] })', 'Een groep binnen een groep kan de bouwer niet maken.'],
    ['andere soort bij begon met', 'Object.assign(rbNewState("award"), { conds: [Object.assign(rbNewCond("winnerOpened"), { cs: rbNewCards("highest") })] })', 'Hier past alleen een waarde, een symbool of een kleur.']
  ];
  for (const [name, code, expected] of bad){
    const got = errorOf(code);
    if (got !== expected) fail('melding bij "' + name + '": verwacht ' + J(expected) + ', kreeg ' + J(got));
  }

  // 4. Wat de bouwer niet kan tonen, geeft null (geen fout), en een kapot blok ook.
  const unsupported = [
    { moment: 'decide', if: { and: [{ or: [{ exists: { rank: 'A' } }, { and: [{ exists: { rank: 'K' } }, { exists: { rank: 'Q' } }] }] }, { exists: { rank: '2' } }] }, then: { win: { rank: '2' } } },
    { moment: 'decide', if: { not: { not: { exists: { rank: 'A' } } } }, then: { win: { rank: '2' } } },
    { moment: 'decide', then: { win: { and: [{ rank: 'K' }, { suit: '♥' }, { color: 'red' }] } } },
    { moment: 'decide', then: { win: { highest: 'value', of: { rank: 'K' } } } },
    { moment: 'decide', then: { win: { or: [{ rank: 'K' }, { rank: 'Q' }] } } },
    { moment: 'decide', then: { win: { not: { not: { rank: 'K' } } } } },
    { moment: 'decide', then: { win: { not: { highest: 'value' } } } },
    { moment: 'decide', then: { win: { rank: 'Z' } } }
  ];
  for (const u of unsupported) if (R('rbFromLogic(' + J(u) + ')') !== null) fail('de bouwer toont iets wat hij niet kan: ' + J(u).slice(0, 120));

  // 4b. Groepen komen identiek terug uit de bouwer (ook de ontkende groep op het hoogste niveau), met een zin.
  for (const logic of [
    { moment: 'decide', if: { and: [{ exists: { rank: '2' } }, { or: [{ exists: { rank: 'A' } }, { exists: { rank: 'K' } }] }] }, then: { win: { all: true } } },
    { moment: 'decide', if: { or: [{ and: [{ exists: { rank: '2' } }, { exists: { rank: '3' } }] }, { not: { or: [{ exists: { rank: 'A' } }, { count: { suit: '♥' }, max: 1 }] } }] }, then: { win: { all: true } } },
    { moment: 'award', if: { not: { and: [{ battle: true }, { winnerOpened: { rank: 'K' } }] } }, then: { discardPot: true } },
    { moment: 'roundEnd', if: { and: [{ playersWithCards: { min: 2 } }, { or: [{ anyPlayer: { withoutCards: true } }, { anyPlayer: { opened: { rank: 'A' } } }] }] }, then: { forEach: { withoutCards: true }, discardTop: 1 } }
  ]){
    const back = R('(() => { const st = rbFromLogic(' + J(logic) + '); return st ? { logic: rbToLogic(st).logic, sentence: describeRuleLogic(rbToLogic(st).logic) } : null; })()');
    if (!back || J(back.logic) !== J(logic) || !back.sentence) fail('een groep komt niet identiek terug: ' + J(logic).slice(0, 160) + ' -> ' + J(back).slice(0, 200));
  }

  // 5. Het blok: id en teksten, en de voorbeelden kloppen met het spel.
  const blockOf = (title, moment) => R('(() => { const st = rbNewState(' + J(moment || 'decide') + '); st.title = ' + J(title) + '; const b = rbBlock(st); return b.def ? { id: b.def.id, title: b.def.title, short: b.def.short, descr: b.def.description, n: b.def.examples.length } : b; })()');
  const idTests = [['Mijn Regel é!', 'custom-mijn-regel-e', 'Mijn Regel é!'], ['', 'custom-nieuwe-regel', 'Nieuwe regel'], ['   ', 'custom-nieuwe-regel', 'Nieuwe regel'], ['###', 'custom-nieuwe-regel', '###'],
    ['Heel erg lange titel over iets dat nergens op slaat', 'custom-heel-erg-lange-titel-over-iets', 'Heel erg lange titel over iets dat nergens op slaat'], ['Ça va très bien', 'custom-ca-va-tres-bien', 'Ça va très bien'], ['  rood  ', 'custom-rood', 'rood']];
  for (const [title, id, shownTitle] of idTests){
    const b = blockOf(title);
    if (b.id !== id || b.title !== shownTitle) fail('titel ' + J(title) + ': verwacht id ' + id + ' en titel ' + J(shownTitle) + ', kreeg ' + J(b));
    if (!/^custom-[a-z0-9]+(-[a-z0-9]+)*$/.test(b.id) || b.id.length > 40) fail('id ' + b.id + ' voldoet niet aan de eisen');
  }
  eq2('een titel van 80 tekens wordt afgekapt op 60', blockOf('x'.repeat(80)).title.length, 60);
  function eq2(name, got, exp){ if (J(got) !== J(exp)) fail(name + ': verwacht ' + J(exp) + ', kreeg ' + J(got)); }

  // Regels zonder naam krijgen een id die nog vrij is; een regel met een naam houdt de id van die naam (dezelfde naam is dezelfde regel).
  const idFor = (title, taken) => R('(() => { const st = rbNewState("decide"); st.title = ' + J(title) + '; const b = rbBlock(st, ' + J(taken) + '); return [b.def.id, b.def.title]; })()');
  eq2('zonder naam, nog niets toegevoegd', idFor('', []), ['custom-nieuwe-regel', 'Nieuwe regel']);
  eq2('zonder naam, de eerste bestaat al', idFor('', ['custom-nieuwe-regel']), ['custom-nieuwe-regel-2', 'Nieuwe regel 2']);
  eq2('zonder naam, twee bestaan al', idFor('  ', ['custom-nieuwe-regel', 'custom-nieuwe-regel-2', 'custom-iets']), ['custom-nieuwe-regel-3', 'Nieuwe regel 3']);
  eq2('zonder naam, alleen de tweede bestaat', idFor('', ['custom-nieuwe-regel-2']), ['custom-nieuwe-regel', 'Nieuwe regel']);
  eq2('met een naam die al bestaat: dezelfde regel', idFor('Rood', ['custom-rood']), ['custom-rood', 'Rood']);
  eq2('zonder lijst van bestaande regels', R('(() => { const b = rbBlock(rbNewState("decide")); return b.def.id; })()'), 'custom-nieuwe-regel');
  for (const [, id] of [[0, idFor('', ['custom-nieuwe-regel'])[0]]]) if (!/^custom-[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail('de vrije id voldoet niet aan de eisen: ' + id);

  // Een geladen blok blijft dezelfde regel: id, prioriteit, uitleg en voorbeelden blijven zolang de regel zelf niet verandert.
  const loaded = R(`(() => {
    const def = parseCustomRule(JSON.stringify(Object.assign({}, CUSTOM_RULE_SAMPLE, { priority: 345 }))).def;
    const st = rbFromLogic(def.logic); st.title = def.title; st.meta = rbMetaFrom(def, st);
    const same = rbBlock(st, [def.id]);
    st.title = 'Andere naam';
    const renamed = rbBlock(st, [def.id]);
    st.effect.cs.min = 4;
    const changed = rbBlock(st, [def.id]);
    st.effect.cs.min = 3;
    const back = rbBlock(st, [def.id]);
    const moved = Object.assign(rbNewState('award'), { title: st.title, meta: st.meta });
    const other = rbBlock(moved, [def.id]);
    const pick = b => ({ id: b.def.id, title: b.def.title, priority: b.def.priority, short: b.def.short, description: b.def.description, examples: b.def.examples, kept: b.kept, regenerated: b.regenerated });
    return { def, same: pick(same), renamed: pick(renamed), changed: pick(changed), back: pick(back), other: pick(other), metaUntouched: JSON.stringify(st.meta.examples) === JSON.stringify(def.examples) };
  })()`);
  const d0 = loaded.def;
  eq2('geladen en niets veranderd: het blok is hetzelfde', [loaded.same.id, loaded.same.title, loaded.same.priority, loaded.same.short, loaded.same.description, loaded.same.examples, loaded.same.kept, loaded.same.regenerated],
    [d0.id, d0.title, 345, d0.short, d0.description, d0.examples, true, false]);
  eq2('andere naam: de id blijft, de teksten ook', [loaded.renamed.id, loaded.renamed.title, loaded.renamed.description, loaded.renamed.kept], [d0.id, 'Andere naam', d0.description, true]);
  eq2('regel veranderd: id en prioriteit blijven, uitleg en voorbeelden zijn opnieuw gemaakt', [loaded.changed.id, loaded.changed.priority, loaded.changed.kept, loaded.changed.regenerated, loaded.changed.description === d0.description, J(loaded.changed.examples) === J(d0.examples)],
    [d0.id, 345, false, true, false, false]);
  eq2('regel weer terug: de eigen uitleg en voorbeelden komen terug', [loaded.back.kept, loaded.back.description, loaded.back.examples], [true, d0.description, d0.examples]);
  eq2('ander moment: nog steeds dezelfde regel (id, prioriteit)', [loaded.other.id, loaded.other.priority, loaded.other.regenerated], [d0.id, 345, true]);
  eq2('de bewaarde voorbeelden worden niet aangetast', loaded.metaUntouched, true);
  // De volgorde van waarden in een geladen blok mag anders zijn dan de bouwer haar schrijft: het blijft dezelfde regel.
  const reordered = R(`(() => { const def = parseCustomRule(JSON.stringify({ id: 'custom-volgorde', title: 'Volgorde', short: 'kort', description: 'eigen uitleg', logic: { moment: 'decide', then: { win: { rank: ['Q', 'K'] } } },
    examples: [{ cards: ['K', 'Q', '3'], winners: [0, 1], text: 'eigen voorbeeld' }] })).def;
    const st = rbFromLogic(def.logic); st.title = def.title; st.meta = rbMetaFrom(def, st); const b = rbBlock(st, []);
    return [b.kept, b.def.description, b.def.examples[0].text, b.def.logic.then.win.rank]; })()`);
  eq2('andere schrijfwijze van dezelfde regel', reordered, [true, 'eigen uitleg', 'eigen voorbeeld', ['K', 'Q']]);

  // Elke stand levert een blok dat door de controle van laag 2 komt, met voorbeelden die het spel zelf nakijkt.
  let blocksChecked = 0;
  for (const st of states.filter((_, i) => i % 3 === 0)){
    const r = JSON.parse(run('(() => { const b = rbBlock(' + J(st) + '); if (b.errors) return JSON.stringify({ errors: b.errors }); const p = parseCustomRule(JSON.stringify(b.def)); ' +
      'return JSON.stringify({ parseErrors: p.errors, check: p.def ? checkCustomRuleExamples(p.def) : null, n: b.def.examples.length, found: b.found }); })()'));
    blocksChecked++;
    if (r.errors || r.parseErrors.length) fail('een blok uit de bouwer wordt door de controle geweigerd: ' + J(r).slice(0, 300));
    else if (r.check.failures.length || r.n < 1 || r.n > 3) fail('voorbeelden van de bouwer kloppen niet: ' + J(r).slice(0, 300));
  }
  if (blocksChecked < 20) fail('te weinig blokken gecontroleerd (' + blocksChecked + ')');
  // Deterministisch: twee keer dezelfde voorbeelden.
  const stamp = () => J(R('rbSuggestExamples(RULES[0].logic)'));
  if (stamp() !== stamp()) fail('de voorbeelden zijn niet elke keer hetzelfde');
  // De voorbeelden laten zien waar de regel iets doet: bij een regel die altijd iets verandert zit er een voorbeeld met een ander resultaat zonder de regel.
  const sug = R('rbSuggestExamples(RULES[0].logic)');
  if (!sug.found || sug.examples.length < 2 || !sug.examples.some(e => /Met de regel: speler \d wint\. Zonder de regel: speler \d wint\./.test(e.text) || /battlen/.test(e.text))) fail('voorbeelden voor 2 verslaat Aas: ' + J(sug).slice(0, 300));
  // Een regel die nooit iets doet krijgt een opmerking.
  const never = R('rbSuggestExamples({ moment: "decide", if: { count: { rank: "A" }, min: 5 }, then: { win: { rank: "A" } } })');
  if (never.found !== 0 || !/niets/.test(never.note) || never.examples.length < 1) fail('een regel die nooit iets doet: ' + J(never).slice(0, 300));
  eq2('het zoeken van voorbeelden laat de catalogus zoals hij was', J(R('RULES.map(r => r.id)')), catalogBefore);
  eq2('het zoeken van voorbeelden laat geen eigen regel achter', run('RULES.every(r => !r.custom)'), true);
}

// ---- de instructie voor een taalmodel (js/rule-prompt.js) ----
{
  const fail = t => failures.push('instructie: ' + t);
  const J = v => JSON.stringify(v);
  const prompt = run('buildRulePrompt(' + J('twee Vrouwen winnen samen van een Heer') + ')');
  if (!prompt.includes('Mijn regel:\ntwee Vrouwen winnen samen van een Heer\n')) fail('de wens staat er niet in');
  // Elk sleutelwoord dat de controle kent, staat in de uitleg (anders kan het model die bouwsteen niet gebruiken).
  const grammar = run('RULE_PROMPT_GRAMMAR');
  const words = ['moment', 'if', 'then', 'decide', 'tiebreak', 'award', 'roundEnd', 'rank', 'suit', 'color', 'red', 'black', 'all', 'highest', 'lowest', 'value', 'suitOrder', 'of', 'group', 'relation',
    'sameRank', 'sameSuit', 'sameColor', 'consecutive', 'min', 'max', 'pick', 'and', 'or', 'not', 'winner', 'opened', 'exclude', 'withoutCards', 'neighbor', 'left', 'right',
    'exists', 'count', 'battle', 'winnerOpened', 'anyPlayer', 'playersWithCards', 'win', 'discardPot', 'sharePot', 'forEach', 'transfer', 'from', 'discardTop'];
  for (const w of words) if (!grammar.includes('"' + w + '"')) fail('de uitleg noemt "' + w + '" niet');
  // En omgekeerd: elk woord tussen aanhalingstekens in de uitleg is een bekend sleutelwoord, een waarde of een symbool.
  const known = new Set(words.concat(JSON.parse(run('JSON.stringify(RANKS.concat(SUITS))'))));
  for (const m of grammar.matchAll(/"([^"]+)"/g)) if (!known.has(m[1])) fail('de uitleg noemt een onbekend woord: "' + m[1] + '"');
  // De sleutels van de bouwstenenlijst (die met de controle is vergeleken) staan er ook allemaal in.
  const blockKeys = JSON.parse(run('JSON.stringify([].concat(RULE_BLOCKS.conditions, RULE_BLOCKS.effects, RULE_BLOCKS.cards, RULE_BLOCKS.players).map(b => b.key))'));
  for (const k of blockKeys) if (!grammar.includes('"' + k + '"')) fail('de uitleg mist de bouwsteen ' + k);
  // De regels van het spel staan erin als voorbeeld, met zin en beschrijving, net als de grenzen en het voorbeeldblok.
  const ruleInfo = JSON.parse(run('JSON.stringify(RULES.map(r => [r.title, describeRuleLogic(r.logic), JSON.stringify(r.logic)]))'));
  for (const [title, sentence, logic] of ruleInfo) if (!prompt.includes('- ' + title + ': ' + sentence + '\n  ' + logic)) fail('de regel ' + title + ' staat niet als voorbeeld in de instructie');
  const limits = JSON.parse(run('JSON.stringify(CUSTOM_LIMITS)'));
  for (const n of [limits.idMax, limits.title, limits.short, limits.description, limits.priorityMin, limits.priorityMax, limits.examples, limits.players]) if (!prompt.includes(String(n))) fail('de grens ' + n + ' staat niet in de instructie');
  if (!prompt.includes(run('JSON.stringify(CUSTOM_RULE_SAMPLE, null, 2)'))) fail('het voorbeeldblok staat niet in de instructie');
  // Een eigen regel die is toegevoegd hoort niet bij de voorbeelden van het spel.
  const withCustom = run('(() => { addCustomRule(parseCustomRule(JSON.stringify(CUSTOM_RULE_SAMPLE)).def); try { return buildRulePrompt("x"); } finally { removeCustomRule(CUSTOM_RULE_SAMPLE.id); } })()');
  if (withCustom.includes('- Opeenvolgende kaarten: ')) fail('een eigen regel staat tussen de voorbeelden van het spel');
  // De wens: één regel, begrensd, en nooit leeg.
  const wishOf = w => run('rulePromptWish(' + J(w) + ')');
  if (wishOf('  a\n\nb\t c  ') !== 'a b c') fail('de wens wordt niet tot één regel gemaakt: ' + J(wishOf('  a\n\nb\t c  ')));
  if (wishOf('x'.repeat(900)).length !== 600) fail('de wens wordt niet afgekapt op 600 tekens');
  for (const empty of ['', '   ', null, undefined]) if (run('rulePromptWish(' + (empty === undefined ? 'undefined' : J(empty)) + ')') !== '(vul hier in wat de regel moet doen)') fail('een lege wens geeft geen invulregel');
  if (run('rulePromptWish(42)') !== '42') fail('een wens die geen tekst is');

  // Het regelblok uit een antwoord halen.
  const sampleText = run('JSON.stringify(CUSTOM_RULE_SAMPLE)');
  const extract = t => run('extractRuleJson(' + J(t) + ')');
  const cases2 = [
    ['al JSON: ongewijzigd', '  ' + sampleText + '\n', '  ' + sampleText + '\n'],
    ['codeblok met taal', 'Hier is je regel:\n```json\n' + sampleText + '\n```\nSucces!', sampleText],
    ['codeblok zonder taal', '```\n' + sampleText + '\n```', sampleText],
    ['tekst eromheen zonder codeblok', 'Zie hier: ' + sampleText + ' Dat is hem.', sampleText],
    ['twee codeblokken: het eerste', '```json\n{"a":1}\n```\nen\n```json\n{"b":2}\n```', '{"a":1}'],
    ['geen JSON te vinden: ongewijzigd', 'Dit kan niet met de bouwstenen.', 'Dit kan niet met de bouwstenen.'],
    ['kapotte JSON in een codeblok: ongewijzigd', '```json\n{ kapot\n```', '```json\n{ kapot\n```'],
    ['een getal is geen blok', '5', '5'],
    ['leeg', '', '']
  ];
  for (const [name, input, expected] of cases2) if (extract(input) !== expected) fail('uit een antwoord halen, ' + name + ': kreeg ' + J(extract(input)).slice(0, 120));
  if (run('extractRuleJson(null)') !== null) fail('extractRuleJson(null)');
  // Wat eruit komt gaat door de gewone controle.
  const viaAnswer = JSON.parse(run('JSON.stringify(parseCustomRule(extractRuleJson(' + J('Hier:\n```json\n' + sampleText + '\n```') + ')).errors)'));
  if (viaAnswer.length) fail('een blok uit een antwoord komt niet door de controle: ' + J(viaAnswer));
  for (const id of ['customWish', 'customPromptCopy', 'customPromptStatus', 'customPromptOut', 'ruleBuilderNotice', 'ruleBuilderReplace', 'ruleBuilderReset', 'ruleBuilderLoad', 'ruleBuilderForm', 'ruleBuilderSentence']) if (!fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('id="' + id + '"')) fail('index.html mist het element met id ' + id);
}

// ---- testgevallen ----
const cases = [];
for (const n of [2, 3, 4, 6, 8]) for (const seed of ['1', '2', '3', '4', '5', '6']) for (const rules of Object.keys(RULE_SETS)) cases.push({ n, seed, rules });
const key = c => c.n + '|' + c.seed + '|' + c.rules;

const expected = update || !fs.existsSync(expectedFile) ? {} : JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
const actual = {};
let liveChecked = 0;

// ---- stap terug (undo.js) ----
{
  const start = (seed, ruleSet, n = 4) => {
    document.getElementById('seedInput').value = seed;
    for (const id of RULE_IDS) document.getElementById(id + 'Input').checked = RULE_SETS[ruleSet][id];
    document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
    run('numPlayers = ' + n + '; dealNewGame(); launchGame();');
  };
  const sig = () => run('stateSignature(game.players, game.discard)');
  const phaseNow = () => run('phase');
  const finishRound = () => run(`(() => { let i = 0; do { advance(); i++; } while (!['cleared', 'game-over', 'cycle-over'].includes(phase) && i < 50); return phase; })()`);
  const stats = () => run('JSON.stringify(statsSnapshot())');
  const visited = () => run('visitedStates.size + "/" + visitedLog.length');
  const undoDisabled = () => run('undoBtn.disabled');
  const undo = () => run('undoBtn.handlers.click()');
  const fail = t => failures.push('stap terug: ' + t);

  // Een paar rondes terug en weer vooruit: dezelfde standen, tellers, statistieken en geen valse cyclusmelding.
  for (const set of ['standard', 'twoBeatsAce+battleFirst']){
    start('11', set);
    if (!undoDisabled()) fail('aan het begin van een spel hoort de knop uit te staan (' + set + ')');
    const sigs = [sig()], sts = [stats()], vis = [visited()];
    for (let i = 0; i < 6; i++){
      if (finishRound() !== 'cleared') fail('het testspel eindigde te vroeg (' + set + ')');
      sigs.push(sig()); sts.push(stats()); vis.push(visited());
    }
    if (undoDisabled()) fail('na gespeelde rondes hoort de knop aan te staan');
    for (const k of [5, 4]){
      undo();
      if (sig() !== sigs[k] || phaseNow() !== 'cleared') fail('een ronde terug hoort de stand van ronde ' + k + ' te geven (' + set + ')');
      if (stats() !== sts[k]) fail('de statistieken horen mee terug te gaan (' + set + ', ronde ' + k + '): ' + stats() + ' i.p.v. ' + sts[k]);
      if (visited() !== vis[k]) fail('de lijst met geziene standen hoort mee terug te gaan (' + set + ', ronde ' + k + '): ' + visited() + ' i.p.v. ' + vis[k]);
    }
    for (const k of [5, 6]){
      if (finishRound() !== 'cleared') fail('na terugzetten hoort het spel gewoon door te kunnen (' + set + ')');
      if (sig() !== sigs[k] || stats() !== sts[k] || visited() !== vis[k]) fail('opnieuw spelen hoort dezelfde stand, statistieken en lijst te geven (' + set + ', ronde ' + k + ')');
    }
    // Midden in een ronde terug gaat naar het begin van die ronde.
    run('advance()');
    if (phaseNow() !== 'revealed') fail('verwacht de fase "revealed" midden in een ronde, kreeg ' + phaseNow());
    undo();
    if (sig() !== sigs[6] || phaseNow() !== 'cleared' || stats() !== sts[6]) fail('midden in een ronde terug hoort het begin van die ronde te geven (' + set + ')');
    if (run('game.players.some(p => p.faceCard)')) fail('na terugzetten liggen er geen open kaarten op tafel');
  }

  // Ten hoogste tien rondes terug.
  start('12', 'standard');
  let played = 0;
  for (let i = 0; i < 15; i++){ if (finishRound() === 'cleared') played++; else break; }
  const depth = run('undoStack.length');
  if (played === 15 && depth !== 10) fail('er horen ten hoogste 10 stappen bewaard te worden, er zijn er ' + depth);
  for (let i = 0; i < depth; i++) undo();
  if (!undoDisabled()) fail('als alle stappen terug zijn hoort de knop uit te staan');

  // Doorspoelen is één stap terug.
  start('13', 'standard');
  for (let i = 0; i < 3; i++) finishRound();
  const sigBefore = sig(), stBefore = stats(), visBefore = visited();
  run('fastForward()');
  const afterFF = { phase: phaseNow(), sig: sig() };
  if (afterFF.phase === 'cleared') fail('doorspoelen hoort tot het einde te gaan');
  undo();
  if (sig() !== sigBefore || stats() !== stBefore || visited() !== visBefore || phaseNow() !== 'cleared') fail('na doorspoelen hoort een stap terug de stand van ervoor te geven');
  run('fastForward()');
  if (phaseNow() !== afterFF.phase || sig() !== afterFF.sig) fail('opnieuw doorspoelen na terugzetten hoort hetzelfde einde te geven');

  // Na het einde van het spel: de laatste ronde opnieuw spelen, met hetzelfde einde en zonder valse cyclusmelding.
  for (const [seed, n] of [['1', 8], ['2', 3]]){ // spellen die in tests/expected.json met een winnaar eindigen (77 en 124 rondes)
    start(seed, 'standard', n);
    let end = null;
    for (let i = 0; i < 6000 && !end; i++){ const ph = finishRound(); if (ph !== 'cleared') end = ph; }
    if (end !== 'game-over') fail('het testspel (seed ' + seed + ', ' + n + ' spelers) hoort met een winnaar te eindigen, kreeg ' + end);
    if (!end) continue;
    const finalSig = sig(), finalStats = stats();
    const banner = document.getElementById('endBanner');
    undo();
    if (phaseNow() !== 'cleared' || banner.children.length !== 0) fail('na het einde van het spel hoort een stap terug de eindbanner weg te halen (seed ' + seed + ')');
    if (run('playBtn.disabled')) fail('na een stap terug hoort "Speel ronde" weer te werken (seed ' + seed + ')');
    const again = finishRound();
    if (again !== end || sig() !== finalSig || stats() !== finalStats) fail('na een stap terug hoort het einde hetzelfde te zijn (seed ' + seed + ': ' + end + ' → ' + again + ')');
  }

  // Een nieuw spel begint zonder geschiedenis.
  start('16', 'standard');
  finishRound();
  if (undoDisabled()) fail('na een ronde hoort de knop aan te staan');
  start('17', 'standard');
  if (!undoDisabled() || run('undoStack.length') !== 0) fail('een nieuw spel hoort zonder geschiedenis te beginnen');
}

// ---- de winnaar kiest een regel (winner-rule.js) ----
{
  // Een keuze verandert een kopie, nooit de oude lijst; een onbekende regel of onzin geeft null.
  const old = { battleFirst: { on: true, by: 'Cas' } };
  const chosen = JSON.parse(run('JSON.stringify(chooseWinnerRule(' + JSON.stringify(old) + ', "twoBeatsAce", true, "Dirk"))'));
  if (JSON.stringify(chosen) !== JSON.stringify({ battleFirst: { on: true, by: 'Cas' }, twoBeatsAce: { on: true, by: 'Dirk' } })) failures.push('winnaarsregel: keuze toevoegen: ' + JSON.stringify(chosen));
  if (run('(() => { const o = {}; chooseWinnerRule(o, "twoBeatsAce", true, "x"); return Object.keys(o).length; })()') !== 0) failures.push('winnaarsregel: chooseWinnerRule mag de oude lijst niet veranderen');
  for (const bad of ['"nietBestaand", true, "x"', '"__proto__", true, "x"', '"twoBeatsAce", "ja", "x"']) if (run('chooseWinnerRule({}, ' + bad + ')') !== null) failures.push('winnaarsregel: onzinnige keuze (' + bad + ') hoort null te geven');
  const long = JSON.parse(run('JSON.stringify(chooseWinnerRule({}, "twoBeatsAce", true, "  ' + 'x'.repeat(100) + '  "))'));
  if (long.twoBeatsAce.by.length !== 30 || Object.keys(long.twoBeatsAce).sort().join() !== 'by,on') failures.push('winnaarsregel: de naam hoort een korte gewone tekst te zijn');
  if (run('chooseWinnerRule({}, "twoBeatsAce", true, 42).twoBeatsAce.by') !== '') failures.push('winnaarsregel: een naam die geen tekst is hoort leeg te worden');

  // De keuze staat alleen in het geheugen van de pagina: er wordt niets bewaard, en wat een eerdere versie bewaarde wordt gewist.
  run('winnerRules = {};');
  if (run('JSON.stringify(currentWinnerRules())') !== '{}') failures.push('winnaarsregel: een nieuwe pagina begint zonder keuzes');
  run(`globalThis.localStorage = { data: { [WINNER_OLD_STORAGE_KEY]: '{"battleFirst":{"on":true,"by":"Oud"}}', other: 'blijft' }, calls: [],
    getItem(k){ this.calls.push('get'); return k in this.data ? this.data[k] : null; }, setItem(k, v){ this.calls.push('set'); this.data[k] = v; }, removeItem(k){ delete this.data[k]; } };`);
  run('forgetOldWinnerRules()');
  if (run('WINNER_OLD_STORAGE_KEY in localStorage.data') || run('localStorage.data.other') !== 'blijft') failures.push('winnaarsregel: de keuzes die een eerdere versie bewaarde horen gewist te worden, en niets anders');
  run('applyWinnerRuleChoice(RULES[0], true, "Eva")');
  if (JSON.stringify(JSON.parse(run('JSON.stringify(currentWinnerRules())'))) !== JSON.stringify({ [RULE_IDS[0]]: { on: true, by: 'Eva' } })) failures.push('winnaarsregel: de keuze hoort in het geheugen te staan');
  if (run('localStorage.calls.length') !== 0) failures.push('winnaarsregel: er mag niets in de opslag van de browser gelezen of geschreven worden (alleen het oude item wissen)');
  run(`globalThis.localStorage = { getItem(){ throw new Error('geblokkeerd'); }, setItem(){ throw new Error('geblokkeerd'); }, removeItem(){ throw new Error('geblokkeerd'); } };`);
  try { run('forgetOldWinnerRules(); applyWinnerRuleChoice(RULES[1], true, "x")'); } catch (e){ failures.push('winnaarsregel: geblokkeerde opslag mag geen fout geven: ' + e.message); }
  run('delete globalThis.localStorage; winnerRules = {};');

  // Het scherm na een spel: knoppen alleen bij een winnaar, één keuze, namen als gewone tekst.
  const evilName = '<img src=x onerror=alert(1)>' + 'x'.repeat(40);
  run(`game = createGameState([{ id: 0, name: ${JSON.stringify(evilName)}, deck: [] }, { id: 1, name: 'B', deck: [] }], { twoBeatsAce: true });`);
  const banner = () => document.getElementById('endBanner');
  const choiceBox = () => banner().children.find(c => c.className === 'winner-choice');
  const savedNow = () => JSON.parse(run('JSON.stringify(currentWinnerRules())'));
  run('endGame(game.players[0])');
  const box = choiceBox();
  if (!box) failures.push('winnaarsregel: na een spel met een winnaar horen de keuzeknoppen er te zijn');
  else {
    const btns = box.children[1].children;
    if (box.children[0].textContent !== evilName + ' mag één regel omzetten voor het volgende spel:') failures.push('winnaarsregel: de naam van de winnaar hoort gewone tekst te zijn: ' + box.children[0].textContent);
    if (btns.length !== RULE_IDS.length) failures.push('winnaarsregel: er hoort één knop per regel te zijn (' + btns.length + ' van ' + RULE_IDS.length + ')');
    const titleOf = id => CATALOG.find(r => r.id === id).title;
    if (btns[RULE_IDS.indexOf('twoBeatsAce')].textContent !== 'Zet uit: ' + titleOf('twoBeatsAce')) failures.push('winnaarsregel: een regel die aan staat krijgt "Zet uit": ' + btns[RULE_IDS.indexOf('twoBeatsAce')].textContent);
    if (btns[RULE_IDS.indexOf('secondChance')].textContent !== 'Zet aan: ' + titleOf('secondChance')) failures.push('winnaarsregel: een regel die uit staat krijgt "Zet aan"');
    const i = RULE_IDS.indexOf('secondChance');
    btns[i].handlers.click();
    const saved = savedNow();
    if (JSON.stringify(Object.keys(saved)) !== '["secondChance"]' || saved.secondChance.on !== true || saved.secondChance.by !== evilName.slice(0, 30)) failures.push('winnaarsregel: de keuze is verkeerd onthouden: ' + JSON.stringify(saved));
    if (!ruleChoiceCheckedIs('secondChance', true)) failures.push('winnaarsregel: het vinkje op het startscherm volgt de keuze niet');
    if (box.children.length !== 2 || box.children[0].textContent !== titleOf('secondChance') + ' staat in het volgende spel aan, gekozen door ' + evilName + '.' || box.children[1].className !== 'winner-next') failures.push('winnaarsregel: na de keuze hoort de tekst met de uitkomst en de knop "Volgend spel" te staan: ' + JSON.stringify(box.children.map(c => c.textContent)));
    btns[RULE_IDS.indexOf('battleFirst')].handlers.click(); // nog eens kiezen mag niet
    if (JSON.stringify(Object.keys(savedNow())) !== '["secondChance"]') failures.push('winnaarsregel: er mag per spel maar één regel omgezet worden');
  }
  function ruleChoiceCheckedIs(id, v){ return run(`ruleChoiceInputs[${JSON.stringify(id)}].checked`) === v; }
  // Zonder winnaar (gelijkspel) geen keuze.
  run('endGame(null)');
  if (choiceBox()) failures.push('winnaarsregel: bij gelijkspel kiest niemand een regel');

  // Het startscherm volgt de keuzes van de winnaars zolang de pagina openstaat; een nieuwe pagina (F5) begint op de standaard,
  // ook als een eerdere versie iets in de browser bewaarde.
  run(`winnerRules = { battleFirst: { on: true, by: 'Anna' }, twoBeatsAce: { on: false, by: 'Bo' } }; renderRuleOptions();`);
  const wasDefault = id => CATALOG.find(r => r.id === id).default;
  if (!ruleChoiceCheckedIs('battleFirst', true) || !ruleChoiceCheckedIs('twoBeatsAce', false)) failures.push('startscherm: de keuzes van winnaars zijn niet het begin van de vinkjes');
  if (ruleChoiceCheckedIs('royalFamily', true) !== wasDefault('royalFamily')) failures.push('startscherm: regels zonder keuze horen op hun standaard te staan');
  const noteOf = id => run(`ruleChoiceNotes[${JSON.stringify(id)}] ? ruleChoiceNotes[${JSON.stringify(id)}].textContent : null`);
  if (noteOf('battleFirst') !== '(gekozen door Anna)' || noteOf('twoBeatsAce') !== '(gekozen door Bo)' || noteOf('royalFamily') !== null) failures.push('startscherm: "gekozen door" staat niet bij de juiste regels');
  run(`globalThis.localStorage = { data: { [WINNER_OLD_STORAGE_KEY]: '{"battleFirst":{"on":true,"by":"Oud"},"royalFamily":{"on":true,"by":"Oud"}}' }, getItem(k){ return k in this.data ? this.data[k] : null; }, setItem(){}, removeItem(k){ delete this.data[k]; } };`);
  run('winnerRules = {}; forgetOldWinnerRules(); renderRuleOptions();'); // een nieuwe pagina
  if (ruleChoiceCheckedIs('battleFirst', true) !== wasDefault('battleFirst') || ruleChoiceCheckedIs('royalFamily', true) !== wasDefault('royalFamily') || noteOf('battleFirst') !== null || noteOf('royalFamily') !== null) failures.push('startscherm: na verversen hoort alles weer standaard te zijn, ook als een eerdere versie keuzes bewaarde');
  run('delete globalThis.localStorage; game = null;');
  banner().innerHTML = '';
}

// ---- het volgende spel en de cyclusmelding (setup.js) ----
{
  const start = (seed, n) => {
    document.getElementById('seedInput').value = seed;
    for (const id of RULE_IDS) document.getElementById(id + 'Input').checked = RULE_SETS['standard'][id];
    document.getElementById('namesList').children = Array.from({ length: n }, () => ({ value: '' }));
    run('numPlayers = ' + n + '; dealNewGame(); launchGame();');
  };
  const fail = t => failures.push('volgend spel: ' + t);
  const banner = document.getElementById('endBanner');
  const hidden = id => document.getElementById(id).classList.contains('hidden');
  const winnerBox = () => banner.children.find(c => c.className === 'winner-choice');
  const nextBtn = () => winnerBox() && winnerBox().children.find(c => c.className === 'winner-next');
  const simOutcome = () => run('simulateOutcome(game.players, game.rules).outcome');
  const seedNow = () => run('game.seed');
  const rulesNow = () => run('JSON.stringify(game.rules)');
  run('globalThis.localStorage = { data: {}, getItem(k){ return k in this.data ? this.data[k] : null; }, setItem(k, v){ this.data[k] = v; } };');

  // Na een spel met een winnaar staat de knop er, ook zonder dat er een regel is omgezet; hij start een ander spel met dezelfde spelers en regels.
  start('1', 3);
  run('fastForward()');
  if (run('phase') !== 'game-over' || !winnerBox()) fail('het testspel (3 spelers, seed 1) hoort met een winnaar te eindigen');
  const rulesBefore = rulesNow();
  if (!nextBtn() || nextBtn().textContent !== 'Volgend spel ▶') fail('de knop "Volgend spel" ontbreekt na een spel met een winnaar');
  else {
    nextBtn().handlers.click();
    if (run('phase') !== 'idle' || run('game.players.length') !== 3 || banner.children.length !== 0) fail('het volgende spel hoort te starten met dezelfde spelers en een lege eindbanner');
    if (seedNow() !== '2') fail('het volgende spel hoort de volgende seed te krijgen, kreeg ' + seedNow());
    if (rulesNow() !== rulesBefore) fail('het volgende spel hoort dezelfde regels te hebben');
    if (simOutcome() !== 'win') fail('het volgende spel hoort een spel te zijn dat eindigt');
    if (run('undoStack.length') !== 0 || run('statsRoundCount') !== 0) fail('een nieuw spel begint zonder geschiedenis en statistieken');
  }

  // Na het omzetten van een regel blijft de knop er (en staat de uitkomst erbij).
  start('1', 3);
  run('fastForward()');
  const box = winnerBox();
  if (box) {
    box.children[1].children[0].handlers.click();
    if (!nextBtn()) fail('na het omzetten van een regel hoort de knop "Volgend spel" er nog te staan');
  }

  // Een deling die niet eindigt wordt overgeslagen: het wordt de eerste seed erna waarmee het spel wel eindigt.
  // Daarvoor zoeken we met 3 spelers een seed w waarmee het spel eindigt terwijl seed w-1 dat niet doet, en beginnen we twee seeds eerder.
  const outcomes = JSON.parse(run(`(() => { const out = {}; for (let s = 1; s <= 80; s++){ document.getElementById('seedInput').value = String(s); dealNewGame(); out[s] = simulateOutcome(game.players, game.rules).outcome; } return JSON.stringify(out); })()`));
  const w = Object.keys(outcomes).map(Number).find(k => k >= 5 && outcomes[k] === 'win' && outcomes[k - 1] !== 'win');
  if (!w) fail('geen testseed gevonden waarmee een eerdere seed wordt overgeslagen');
  else {
    start(String(w - 2), 3);
    run('startNextGame()');
    if (seedNow() !== String(w) || simOutcome() !== 'win' || run('phase') !== 'idle') fail('een deling die niet eindigt hoort overgeslagen te worden: verwacht seed ' + w + ', kreeg ' + seedNow());
  }

  // Zonder seed wordt er willekeurig gedeeld en blijft het veld leeg.
  const realRandom = Math.random; let lcg = 12345;
  Math.random = () => (lcg = (lcg * 1664525 + 1013904223) % 4294967296) / 4294967296;
  try {
    start('', 3);
    run('startNextGame()');
    if (seedNow() !== null || document.getElementById('seedInput').value !== '' || run('phase') !== 'idle' || simOutcome() !== 'win') fail('zonder seed hoort er willekeurig gedeeld te worden, met een lege seed en een spel dat eindigt');
  } finally { Math.random = realRandom; }

  // Lukt het niet, dan terug naar het startscherm met de melding (en de melding scrolt in beeld).
  run('globalThis.__sim = simulateOutcome; globalThis.__calls = 0; simulateOutcome = () => { __calls++; return { outcome: "cycle", rounds: 5 }; };');
  try {
    start('1', 3);
    run('__calls = 0;');
    let scrolled = 0; document.getElementById('cycleWarning').scrollIntoView = () => { scrolled++; };
    run('startNextGame()');
    if (run('__calls') !== run('NEXT_GAME_TRIES')) fail('er horen ten hoogste NEXT_GAME_TRIES pogingen gedaan te worden, het waren er ' + run('__calls'));
    if (hidden('setup') || !hidden('game') || hidden('cycleWarning')) fail('als geen deling eindigt hoort het startscherm met de melding terug te komen');
    if (document.getElementById('seedInput').value !== '2' || seedNow() !== '2') fail('als geen deling eindigt hoort de seed bij de eerste geprobeerde deling te blijven (2), niet tientallen plaatsen op te springen: ' + document.getElementById('seedInput').value + ' / ' + seedNow());
    if (!document.getElementById('cycleWarningText').textContent.includes('cyclus')) fail('de melding noemt de cyclus niet');
    if (scrolled !== 1) fail('de melding hoort in beeld te scrollen');
    // Hetzelfde bij "Begin het spel": de melding scrolt in beeld.
    document.getElementById('cycleWarning').classList.add('hidden');
    document.getElementById('startBtn').handlers.click();
    if (hidden('cycleWarning') || scrolled !== 2) fail('"Begin het spel" op een deling die niet eindigt hoort de melding in beeld te brengen');
  } finally {
    run('simulateOutcome = __sim; delete globalThis.__sim; delete globalThis.__calls;');
    document.getElementById('cycleWarning').classList.add('hidden');
    delete document.getElementById('cycleWarning').scrollIntoView;
    document.getElementById('setup').classList.remove('hidden'); document.getElementById('game').classList.add('hidden');
  }
  // Met 2 spelers en de gewone regels eindigt geen enkele deling: dan terug naar het startscherm met de melding, bij seed 2.
  start('1', 2);
  run('startNextGame()');
  if (hidden('setup') || !hidden('game') || hidden('cycleWarning') || seedNow() !== '2' || document.getElementById('seedInput').value !== '2') fail('met 2 spelers hoort het startscherm met de melding terug te komen, bij seed 2 (kreeg seed ' + seedNow() + ')');
  document.getElementById('cycleWarning').classList.add('hidden'); document.getElementById('setup').classList.remove('hidden'); document.getElementById('game').classList.add('hidden');
  // Een regel die de winnaar omzet staat ook echt aan (of uit) in het spel dat met "Volgend spel" begint. In de echte pagina is het
  // vinkje op het startscherm één element; de nagebootste pagina maakt er twee, dus hier koppelen we ze aan elkaar.
  const bindInputs = ruleSet => {
    const saved = {};
    for (const id of RULE_IDS){
      saved[id] = els[id + 'Input'];
      const el = run('ruleChoiceInputs[' + JSON.stringify(id) + ']');
      el.checked = RULE_SETS[ruleSet][id];
      els[id + 'Input'] = el;
    }
    return () => { for (const id of RULE_IDS){ if (saved[id]) els[id + 'Input'] = saved[id]; else delete els[id + 'Input']; } };
  };
  const flipAndContinue = (ruleSet, flipId) => {
    run('renderRuleOptions()');
    const unbind = bindInputs(ruleSet);
    try {
      document.getElementById('seedInput').value = '1';
      document.getElementById('namesList').children = Array.from({ length: 3 }, () => ({ value: '' }));
      run('numPlayers = 3; dealNewGame(); launchGame(); showWinnerRuleChoice(game.players[0]);');
      const before = JSON.parse(rulesNow());
      const choice = banner.children.find(c => c.className === 'winner-choice');
      choice.children[1].children[RULE_IDS.indexOf(flipId)].handlers.click(); // de knop van deze regel
      choice.children.find(c => c.className === 'winner-next').handlers.click();
      return { before, after: JSON.parse(rulesNow()) };
    } finally { unbind(); }
  };
  const on = flipAndContinue('standard', 'secondChance');
  if (on.before.secondChance !== false || on.after.secondChance !== true) fail('een regel die de winnaar aanzet hoort aan te staan in het volgende spel: ' + on.before.secondChance + ' → ' + on.after.secondChance);
  const off = flipAndContinue('twoBeatsAce', 'twoBeatsAce');
  if (off.before.twoBeatsAce !== true || off.after.twoBeatsAce !== false) fail('een regel die de winnaar uitzet hoort uit te staan in het volgende spel: ' + off.before.twoBeatsAce + ' → ' + off.after.twoBeatsAce);
  for (const [name, r] of [['aan', on], ['uit', off]]){
    const flipped = name === 'aan' ? 'secondChance' : 'twoBeatsAce';
    for (const id of RULE_IDS) if (id !== flipped && r.before[id] !== r.after[id]) fail('de andere regels horen gelijk te blijven bij het omzetten van een regel (' + name + '): ' + id);
  }
  run('winnerRules = {}; renderRuleOptions()');

  run('delete globalThis.localStorage; winnerRules = {}; renderRuleOptions(); game = null;');
  banner.innerHTML = '';
}

// ---- doorspoelen en de statistieken (controls.js, stats.js) ----
{
  const fail = t => failures.push('doorspoelen: ' + t);
  document.getElementById('seedInput').value = '1000';
  for (const id of RULE_IDS) document.getElementById(id + 'Input').checked = RULE_SETS['standard'][id];
  document.getElementById('namesList').children = Array.from({ length: 4 }, () => ({ value: '' }));
  run('numPlayers = 4; dealNewGame(); launchGame();');
  const state = () => run('JSON.stringify({ h: statsHistory, w: statsWins, b: statsTotalBattles, l: statsLongestTie, r: statsRoundCount })');
  // Hoe vaak het paneel getekend wordt tellen we met een stand-in; de grafiek tekent de hele geschiedenis, dus elke tekenbeurt kost tijd.
  run('globalThis.__draws = 0; globalThis.__origDraw = renderStatsPanel; renderStatsPanel = () => { __draws++; };');
  try {
    const snap0 = run('JSON.stringify(statsSnapshot())');
    run('fastForward()');
    if (run('phase') !== 'round-over') fail('het testspel (4 spelers, seed 1000) hoort niet binnen 3000 rondes te eindigen, fase: ' + run('phase'));
    if (run('__draws') !== 1) fail('doorspoelen hoort het statistiekenpaneel één keer te tekenen, niet na elke ronde (' + run('__draws') + ' keer)');
    const fresh = state();
    // Dezelfde cijfers als wanneer elke ronde apart wordt geteld (zoals het spel zelf doet): terug naar de stand van vóór het doorspoelen en dan de oude manier.
    run('undoStep()');
    run('statsRestore(' + snap0 + ');');
    run(`(() => { const r = simulateFullTrace(game.players, SIM_ROUND_CAP, game.rules, { discard: game.discard, moved: game.moved });
      r.trace.forEach(e => { if (e.type === 'battle') statsRecordBattle(e.depth); else if (e.type === 'win') statsRecordRoundWin(e.winnerIds || e.winnerId, e.counts); }); })()`);
    if (state() !== fresh) fail('de statistieken na doorspoelen horen gelijk te zijn aan wanneer elke ronde apart wordt geteld');
    run('statsRestore(' + snap0 + ');');
    // Opnieuw en nog eens doorspoelen (bij een spel dat niet eindigt kan dat): elke klik tekent het paneel één keer.
    for (let k = 1; k <= 3; k++){
      run('__draws = 0; fastForward();');
      if (run('__draws') !== 1) fail('klik ' + k + ' op doorspoelen hoort het paneel één keer te tekenen (' + run('__draws') + ' keer)');
    }
    if (run('statsHistory.length') < 3 * 2000) fail('na drie keer doorspoelen horen de rondes in de statistieken te staan (' + run('statsHistory.length') + ')');
  } finally {
    run('renderStatsPanel = __origDraw; delete globalThis.__draws; delete globalThis.__origDraw; game = null;');
    document.getElementById('endBanner').innerHTML = '';
  }
}

own('fixed', () => {
  for (const c of cases){
    document.getElementById("seedInput").value = c.seed;
    for (const id of RULE_IDS) document.getElementById(id + 'Input').checked = RULE_SETS[c.rules][id];
    document.getElementById("namesList").children = Array.from({ length: c.n }, () => ({ value: '' }));
    run('numPlayers = ' + c.n + '; dealNewGame();');
    if (run('game.seed') !== c.seed) failures.push(key(c) + ': game.seed is ' + run('game.seed') + ', verwacht ' + c.seed);
    const sim = JSON.parse(run(`(() => {
      const r = simulateFullTrace(game.players, SIM_ROUND_CAP, typeof game !== 'undefined' && game ? game.rules : undefined);
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
