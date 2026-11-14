// Browsertests: het echte spel in een echte (headless) Chromium. Ze vangen wat de logica-tests niet zien: klikken, toetsenbord,
// focus, thema's, het regelboek en smalle schermen. Uitvoeren: `npm install` + `npx playwright install chromium` in deze map,
// daarna `node run.js`. Het spel wordt rechtstreeks uit de map hierboven geladen (file://), er is geen server nodig.
//
// Elke test begint met een schone browser (geen opgeslagen thema), een vast seed en zonder netwerk naar lettertypen.

const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const results = [];
const only = process.argv[2] || null; // optioneel: alleen tests waarvan de naam deze tekst bevat

let browser;

// Opent een schone pagina. Fouten in de pagina (uitzonderingen) worden verzameld en laten de test falen.
async function open(viewport = { width: 420, height: 900 }){
  const context = await browser.newContext({ viewport });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(URL);
  page.ctx = context;
  return page;
}

// Start een spel met vast seed en het opgegeven aantal spelers.
async function startGame(page, { players = 4, seed = '1000' } = {}){
  await page.click('#countGrid button:has-text("' + players + '")');
  await page.fill('#seedInput', seed);
  await page.click('#startBtn');
  await page.waitForSelector('#game:not(.hidden), #cycleWarning:not(.hidden)');
  // Lijkt de indeling vast te lopen, dan vraagt het spel of je toch wilt doorspelen: dat doen we, dit gaat hier niet om de seed.
  if (await page.isVisible('#cycleWarning')){
    await page.click('#cycleProceedBtn');
    await page.waitForSelector('#game:not(.hidden)');
  }
}

const eq = (got, exp, what) => { if (JSON.stringify(got) !== JSON.stringify(exp)) throw new Error(what + ': verwacht ' + JSON.stringify(exp) + ', kreeg ' + JSON.stringify(got)); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = page => eq(page.errors, [], 'fouten in de pagina');
const text = (page, sel) => page.textContent(sel).then(t => t.trim());
const hScroll = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---- Undo en auto-play ----
test('stap terug tijdens auto-play stopt het auto-play en klopt met de kaarten', async page => {
  await startGame(page);
  await page.fill('#speedSlider', '100');
  await page.dispatchEvent('#speedSlider', 'input');
  await page.click('#autoPlayBtn');
  await page.waitForFunction(() => !document.getElementById('undoBtn').disabled);
  await page.waitForTimeout(400); // een paar rondes laten lopen
  await page.click('#undoBtn');
  eq(await text(page, '#autoPlayBtn'), '▶ Auto-play', 'knop na stap terug');
  await page.waitForTimeout(500); // als het auto-play doorliep, zou de stand nu veranderd zijn
  const a = await page.evaluate(() => stateSignature(game.players, game.discard));
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => stateSignature(game.players, game.discard));
  eq(a, b, 'stand na stap terug blijft staan');
  ok(!(await page.isDisabled('#playBtn')), 'de knop "Speel ronde" hoort weer te werken');
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet');
  noErrors(page);
});

test('stap terug tot het begin zet de knop uit', async page => {
  await startGame(page);
  ok(await page.isDisabled('#undoBtn'), 'stap terug staat aan bij de start');
  await page.click('#playBtn');
  await page.click('#playBtn');
  ok(!(await page.isDisabled('#undoBtn')), 'stap terug hoort aan te staan na een ronde');
  for (let i = 0; i < 12 && !(await page.isDisabled('#undoBtn')); i++) await page.click('#undoBtn');
  ok(await page.isDisabled('#undoBtn'), 'stap terug hoort uit te staan als er niets meer terug kan');
  noErrors(page);
});

// ---- Fast-forward ----
test('meerdere keren snel op ⏩ klikken loopt niet vast', async page => {
  await startGame(page, { players: 3 });
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) await page.click('#fastForwardBtn');
  ok(Date.now() - t0 < 10000, 'vier klikken op ⏩ duurden langer dan 10 seconden');
  await page.waitForTimeout(300);
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet na ⏩');
  // Het spel reageert nog: stap terug werkt na het doorspoelen.
  await page.click('#undoBtn');
  noErrors(page);
});

// ---- Toetsenbord ----
test('tabvolgorde op het startscherm en Enter op de startknop', async page => {
  const seen = [];
  for (let i = 0; i < 40; i++){
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const e = document.activeElement;
      return e && e !== document.body ? (e.id || e.className || e.tagName) + (e.offsetParent === null && e.id !== 'themeToggle' ? ' (onzichtbaar!)' : '') : null;
    });
    if (id === null) break;
    seen.push(id);
    if (id === 'startBtn') break;
  }
  ok(!seen.some(s => s.includes('onzichtbaar')), 'een onzichtbaar element krijgt focus: ' + seen.join(', '));
  eq(seen[0], 'themeToggle', 'eerste Tab-stop');
  const idx = id => seen.indexOf(id);
  ok(idx('seedInput') > idx('themeToggle') && idx('startBtn') > idx('seedInput'), 'volgorde thema → seed → start klopt niet: ' + seen.join(', '));
  await page.keyboard.press('Enter');
  // Met het standaard-seed meldt het spel een mogelijke cyclus: ook dat is een geslaagde start.
  await page.waitForSelector('#game:not(.hidden), #cycleWarning:not(.hidden)');
  noErrors(page);
});

test('Enter en Spatie op de knoppen in het spel', async page => {
  await startGame(page);
  const before = await page.evaluate(() => stateSignature(game.players, game.discard));
  await page.focus('#playBtn');
  await page.keyboard.press('Enter');
  const mid = await page.evaluate(() => stateSignature(game.players, game.discard));
  ok(mid !== before, 'Enter op "Speel ronde" deed niets');
  await page.keyboard.press('Space');
  const after = await page.evaluate(() => stateSignature(game.players, game.discard));
  ok(after !== mid, 'Spatie op "Speel ronde" deed niets');
  await page.focus('#autoPlayBtn');
  await page.keyboard.press('Enter');
  eq(await text(page, '#autoPlayBtn'), '⏸ Pauzeer', 'Enter op auto-play');
  await page.keyboard.press('Space');
  eq(await text(page, '#autoPlayBtn'), '▶ Auto-play', 'Spatie op auto-play');
  noErrors(page);
});

// ---- Thema ----
test('thema kiezen met het toetsenbord, bewaren en terugkomen na verversen', async page => {
  eq(await page.getAttribute('html', 'data-theme'), 'oorlog', 'standaardthema');
  await page.focus('#themeToggle');
  await page.keyboard.press('Enter');
  ok(await page.isVisible('#themeMenu'), 'menu opent niet');
  eq(await page.getAttribute('#themeToggle', 'aria-expanded'), 'true', 'aria-expanded open');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const chosen = await page.getAttribute('html', 'data-theme');
  ok(chosen !== 'oorlog', 'thema is niet veranderd');
  ok(!(await page.isVisible('#themeMenu')), 'menu sluit niet na kiezen');
  eq(await page.evaluate(() => document.activeElement.id), 'themeToggle', 'focus na kiezen');
  await page.reload();
  eq(await page.getAttribute('html', 'data-theme'), chosen, 'thema na verversen');
  noErrors(page);
});

test('thema-menu sluit met Escape en met een klik ernaast', async page => {
  await page.click('#themeToggle');
  ok(await page.isVisible('#themeMenu'), 'menu opent niet');
  await page.keyboard.press('Escape');
  ok(!(await page.isVisible('#themeMenu')), 'Escape sluit het menu niet');
  eq(await page.evaluate(() => document.activeElement.id), 'themeToggle', 'focus na Escape');
  await page.click('#themeToggle');
  await page.mouse.click(5, 700); // ergens naast het menu
  ok(!(await page.isVisible('#themeMenu')), 'een klik ernaast sluit het menu niet');
  noErrors(page);
});

test('elk thema geeft in het spel een leesbare, ongebroken pagina', async page => {
  await startGame(page);
  for (const theme of ['oorlog', 'sovjet', 'semechki', 'bobr']){
    await page.evaluate(t => applyTheme(t), theme);
    await page.click('#playBtn');
    eq(await page.getAttribute('html', 'data-theme'), theme, 'thema');
    eq(await hScroll(page), 0, 'horizontaal scrollen in thema ' + theme);
  }
  noErrors(page);
});

// ---- Regelboek ----
test('regelboek: openen, focus, sluiten met Escape, kruisje en klik ernaast', async page => {
  await page.click('#rulebookBtnSetup');
  eq(await page.getAttribute('#rulebook', 'aria-hidden'), 'false', 'aria-hidden open');
  eq(await page.evaluate(() => document.activeElement.id), 'rulebookClose', 'focus bij openen');
  ok((await text(page, '#rulebookBody')).includes('Delen'), 'regelboek toont de basisregels niet');
  await page.keyboard.press('Escape');
  eq(await page.getAttribute('#rulebook', 'aria-hidden'), 'true', 'aria-hidden dicht na Escape');
  eq(await page.evaluate(() => document.activeElement.id), 'rulebookBtnSetup', 'focus terug naar de knop');
  await page.click('#rulebookBtnSetup');
  await page.click('#rulebookClose');
  eq(await page.getAttribute('#rulebook', 'aria-hidden'), 'true', 'kruisje sluit niet');
  await page.click('#rulebookBtnSetup');
  await page.mouse.click(2, 2); // buiten het venster
  eq(await page.getAttribute('#rulebook', 'aria-hidden'), 'true', 'klik buiten het venster sluit niet');
  noErrors(page);
});

test('regelboek volgt de vinkjes op het startscherm', async page => {
  await page.check('#twoBeatsAceInput');
  await page.click('#rulebookBtnSetup');
  const t = await text(page, '#rulebookBody');
  ok(/2 verslaat Aas\s*\(aan\)/.test(t), 'volgorde-lijst toont "2 verslaat Aas (aan)" niet');
  noErrors(page);
});

// ---- Startscherm: de volgorde van de symbolen ----
test('symboolvolgorde: alleen zichtbaar bij de regel, wisselt en geldt in het spel', async page => {
  ok(!(await page.isVisible('.suit-picker')), 'keuzelijsten staan al in beeld zonder de regel');
  await page.check('#suitBreakInput');
  ok(await page.isVisible('.suit-picker'), 'keuzelijsten verschijnen niet bij de regel');
  ok(!(await page.isVisible('.suit-hint')), 'waarschuwing staat in beeld zonder "Battle ruimt de pot op"');
  await page.check('#battleDiscardInput');
  ok(await page.isVisible('.suit-hint'), 'waarschuwing verschijnt niet met "Battle ruimt de pot op"');
  await page.selectOption('.suit-picker select >> nth=0', '♣');
  eq(await page.$$eval('.suit-picker select', s => s.map(x => x.value).join('')), '♣♥♦♠', 'volgorde na wisselen');
  await page.uncheck('#battleDiscardInput');
  await startGame(page, { players: 4, seed: 'sy1' });
  eq(await page.evaluate(() => game.rules.suitOrder.join('')), '♣♥♦♠', 'volgorde in het spel');
  noErrors(page);
});

// ---- Startscherm: namen ----
test('ingevulde namen blijven staan als het aantal spelers wijzigt', async page => {
  await page.fill('#namesList input >> nth=0', 'Anna');
  await page.fill('#namesList input >> nth=3', 'Dirk');
  await page.click('#countGrid button:has-text("6")');
  eq(await page.$$eval('#namesList input', x => x.map(i => i.value)), ['Anna', '', '', 'Dirk', '', ''], 'namen na 4 → 6');
  await page.click('#countGrid button:has-text("2")');
  await page.click('#countGrid button:has-text("4")');
  eq(await page.$$eval('#namesList input', x => x.map(i => i.value)), ['Anna', '', '', 'Dirk'], 'namen na 6 → 2 → 4');
  await startGame(page, { players: 4 });
  eq(await page.$$eval('.pname', x => x.map(e => e.textContent)), ['Anna', 'Speler 2', 'Speler 3', 'Dirk'], 'namen in het spel');
  noErrors(page);
});

// ---- De winnaar kiest één regel per spel ----
test('na stap terug en opnieuw uitspelen kan de winnaar niet nog een regel omzetten', async page => {
  for (const id of ['twoBeatsAce', 'battleFirst', 'battleDiscard', 'secondChance', 'royalFamily']) await page.check('#' + id + 'Input');
  // Zoek een seed die met een winnaar eindigt (anders komt er geen keuze).
  let found = false;
  for (let s = 1; s <= 40 && !found; s++){
    await page.fill('#seedInput', String(s));
    await page.click('#startBtn');
    found = await page.isVisible('#game');
  }
  ok(found, 'geen seed gevonden die met een winnaar eindigt');
  await page.click('#fastForwardBtn');
  const count = await page.locator('.winner-choice-buttons button').count();
  ok(count >= 6, 'de winnaar krijgt geen keuzeknoppen (' + count + ')');
  await page.click('.winner-choice-buttons button >> nth=0');
  const chosenText = await text(page, '.winner-choice p');
  await page.click('#undoBtn');
  await page.click('#fastForwardBtn');
  eq(await page.locator('.winner-choice-buttons button').count(), 0, 'keuzeknoppen na stap terug en opnieuw uitspelen');
  eq(await text(page, '.winner-choice p'), chosenText, 'de eerdere keuze staat er weer');
  eq(await page.evaluate(() => Object.keys(winnerRules).length), 1, 'aantal omgezette regels');
  // In het volgende spel mag de winnaar weer kiezen.
  await page.click('.winner-next');
  await page.waitForSelector('#game:not(.hidden), #cycleWarning:not(.hidden)');
  if (await page.isVisible('#game')){
    await page.click('#fastForwardBtn');
    if (await page.locator('.winner-choice').count()) ok(await page.locator('.winner-choice-buttons button').count() >= 6, 'in het volgende spel ontbreken de keuzeknoppen');
  }
  noErrors(page);
});

// ---- De gekozen symboolvolgorde is te zien ----
test('symboolvolgorde staat in het spel en in het regelboek', async page => {
  await page.check('#suitBreakInput');
  await page.selectOption('.suit-picker select >> nth=0', '♣');
  await page.click('#rulebookBtnSetup');
  ok((await text(page, '#rulebookBody')).includes('Symbolen van hoog naar laag: ♣ ♥ ♦ ♠.'), 'regelboek op het startscherm toont de gekozen volgorde niet');
  await page.keyboard.press('Escape');
  await startGame(page, { players: 4, seed: 'sy1' });
  ok(await page.isVisible('#rulesLine'), 'de regel met de volgorde staat niet in het spel');
  eq(await text(page, '#rulesLine'), 'Symbolen van hoog naar laag: ♣ ♥ ♦ ♠.', 'de volgorde in het spel');
  await page.click('#rulebookBtnGame');
  const rb = await text(page, '#rulebookBody');
  ok(rb.includes('Symbolen van hoog naar laag: ♣ ♥ ♦ ♠.') && rb.includes('standaardvolgorde ♠ ♥ ♦ ♣'), 'regelboek in het spel toont de gekozen volgorde niet');
  noErrors(page);
});

test('zonder de symboolregel staat er geen regel over de volgorde', async page => {
  await startGame(page);
  ok(!(await page.isVisible('#rulesLine')), 'de regel over de volgorde staat er zonder de symboolregel');
  await page.click('#rulebookBtnGame');
  ok(!(await text(page, '#rulebookBody')).includes('Symbolen van hoog naar laag'), 'regelboek noemt de volgorde terwijl de regel uit staat');
  noErrors(page);
});

// ---- Smalle schermen ----
for (const width of [320, 360, 420, 768]){
  test('geen horizontaal scrollen bij ' + width + ' px (start en spel met 8 spelers)', async () => {
    const page = await open({ width, height: 800 });
    try {
      eq(await hScroll(page), 0, 'startscherm');
      ok(await page.isVisible('#startBtn'), 'startknop niet zichtbaar');
      await startGame(page, { players: 8 });
      await page.click('#playBtn');
      eq(await hScroll(page), 0, 'speelscherm');
      for (const id of ['playBtn', 'autoPlayBtn', 'undoBtn', 'fastForwardBtn', 'resetBtn']){
        const box = await page.locator('#' + id).boundingBox();
        ok(box && box.x >= 0 && box.x + box.width <= width + 0.5, 'knop ' + id + ' valt buiten het scherm');
        ok(box.height >= 24, 'knop ' + id + ' is te klein om aan te raken (' + Math.round(box.height) + ' px)');
      }
      noErrors(page);
    } finally { await page.ctx.close(); }
  });
}

// ---- uitvoeren ----
(async () => {
  browser = await chromium.launch();
  for (const t of tests){
    if (only && !t.name.includes(only)) continue;
    const started = Date.now();
    let page = null, error = null;
    try {
      if (t.fn.length === 0){ await t.fn(); } else { page = await open(); await t.fn(page); }
    } catch (e){ error = e; }
    finally { if (page) await page.ctx.close(); }
    results.push({ name: t.name, error, ms: Date.now() - started });
    console.log((error ? '✗ ' : '✓ ') + t.name + ' (' + (Date.now() - started) + ' ms)' + (error ? '\n    ' + String(error.message).split('\n')[0] : ''));
  }
  await browser.close();
  const failed = results.filter(r => r.error);
  console.log('\n' + (results.length - failed.length) + ' van ' + results.length + ' browsertests geslaagd.');
  process.exit(failed.length ? 1 : 0);
})();
