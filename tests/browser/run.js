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
async function open(viewport = { width: 420, height: 900 }, extra = {}){
  const context = await browser.newContext(Object.assign({ viewport }, extra));
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

// Zelfde inhoud, los van de volgorde van de velden in een object.
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
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
  eq(await text(page, '#autoPlayBtn'), '▶ Speel vanzelf', 'knop na stap terug');
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
  // Sinds de stoelfix eindigt het spel meestal bij de eerste klik; daarna is de knop uit. Ook dan blijven snelle extra klikken onschuldig.
  for (let i = 0; i < 4; i++) await page.click('#fastForwardBtn', { force: true });
  ok(Date.now() - t0 < 10000, 'vier klikken op ⏩ duurden langer dan 10 seconden');
  ok(['game-over', 'round-over', 'cycle-over'].includes(await page.evaluate(() => phase)), 'na doorspoelen hoort het spel op een rondegrens of aan het einde te staan');
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
  eq(await text(page, '#autoPlayBtn'), '▶ Speel vanzelf', 'Spatie op auto-play');
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
  // ♥ en ♦ staan rood in hun vakje, ♠ en ♣ niet; de kleur volgt het symbool, ook in het vakje dat meewisselde.
  const colors = await page.$$eval('.suit-picker select', s => s.map(x => [x.value, x.classList.contains('red-suit'), getComputedStyle(x).color]));
  eq(colors.map(c => c[1]), [false, true, true, false], 'welke vakjes rood zijn (♣ ♥ ♦ ♠)');
  ok(colors[1][2] === colors[2][2] && colors[0][2] === colors[3][2] && colors[0][2] !== colors[1][2], 'rood en zwart zijn niet te onderscheiden: ' + JSON.stringify(colors));
  await page.selectOption('.suit-picker select >> nth=0', '♥');
  eq(await page.$$eval('.suit-picker select', s => s.map(x => x.value + (x.classList.contains('red-suit') ? 'r' : 'z')).join(' ')), '♥r ♣z ♦r ♠z', 'kleuren na nog een wissel');
  await page.selectOption('.suit-picker select >> nth=0', '♣');
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

// ---- Statistieken ----
test('grafiek wordt niet getekend terwijl het paneel dicht is, en klopt bij het openen', async page => {
  await startGame(page);
  await page.evaluate(() => { window.__draws = 0; const orig = renderStatsChart; renderStatsChart = () => { window.__draws++; orig(); }; });
  for (let i = 0; i < 12; i++) await page.click('#playBtn');
  eq(await page.evaluate(() => window.__draws), 0, 'aantal keer getekend met het paneel dicht');
  await page.click('#statsToggleBtn');
  ok(await page.isVisible('#statsPanel'), 'paneel opent niet');
  eq(await page.evaluate(() => window.__draws), 1, 'aantal keer getekend bij het openen');
  const rounds = await page.evaluate(() => statsRoundCount);
  ok(rounds >= 2, 'er zijn te weinig rondes geteld (' + rounds + ')');
  ok((await text(page, '#statsSummary')).includes('Rondes gespeeld: ' + rounds), 'de samenvatting loopt achter op het spel');
  eq(await page.locator('#statsLegend .stats-legend-item').count(), 4, 'aantal spelers in de legenda');
  // Met het paneel open tekent elke afgeronde ronde opnieuw.
  const before = await page.evaluate(() => window.__draws);
  for (let i = 0; i < 6; i++) await page.click('#playBtn');
  ok(await page.evaluate(() => window.__draws) > before, 'met het paneel open wordt de grafiek niet bijgewerkt');
  ok((await text(page, '#statsSummary')).includes('Rondes gespeeld: ' + await page.evaluate(() => statsRoundCount)), 'de samenvatting loopt achter met het paneel open');
  noErrors(page);
});

// ---- Spelersnamen ----
test('spelersnamen worden niet afgesneden (ook niet met accenten) en lange namen worden afgekapt', async page => {
  await page.fill('#namesList input >> nth=0', 'ÁÉgjpqÅ');
  await page.fill('#namesList input >> nth=1', 'WWWWWWWWWWWWWW');
  await startGame(page, { players: 8 });
  const m = await page.$$eval('.pname', els => els.slice(0, 3).map(e => {
    const cs = getComputedStyle(e);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontSize + ' ' + cs.fontFamily;
    const t = c.measureText(e.textContent.toUpperCase());
    const lead = (e.clientHeight - (t.fontBoundingBoxAscent + t.fontBoundingBoxDescent)) / 2;
    return { text: e.textContent, size: parseFloat(cs.fontSize), height: e.clientHeight, top: lead + t.fontBoundingBoxAscent - t.actualBoundingBoxAscent,
      bottom: lead + t.fontBoundingBoxDescent - t.actualBoundingBoxDescent, cut: e.scrollWidth > e.clientWidth, overflow: cs.textOverflow };
  }));
  for (const x of m){
    // De regel is ruim hoger dan de letter: het lettertype van het spel steekt boven zijn eigen opgegeven hoogte uit.
    ok(x.height >= x.size * 1.5, 'de regel van "' + x.text + '" is te laag (' + x.height + ' px bij ' + x.size + ' px letters)');
    ok(x.top >= 0 && x.bottom >= 0, 'de letters van "' + x.text + '" steken buiten de regel: boven ' + x.top + ', onder ' + x.bottom);
    eq(x.overflow, 'ellipsis', 'afkappen van lange namen');
  }
  eq(await hScroll(page), 0, 'horizontaal scrollen met een lange naam');
  noErrors(page);
});

// ---- Animaties ----
const ghosts = page => page.locator('#animLayer .anim-ghost').count();
// Speelt door tot de gevraagde fase (met de knop "Speel ronde"); geeft false als dat niet lukt binnen max klikken.
async function playUntil(page, wanted, max = 400){
  for (let i = 0; i < max; i++){
    if (await page.evaluate(() => phase) === wanted) return true;
    await page.click('#playBtn');
  }
  return await page.evaluate(() => phase) === wanted;
}

test('animaties: bij het opruimen schuiven de open kaarten naar de winnaar en verdwijnen daarna', async page => {
  await startGame(page);
  eq(await page.locator('#animToggle').count(), 0, 'er hoort geen schakelaar voor animaties meer te zijn');
  ok(await playUntil(page, 'round-over'), 'geen ronde afgerond');
  const pot = await page.evaluate(() => roundPot.length);
  ok(pot >= 2, 'de pot van de ronde is niet bijgehouden (' + pot + ')');
  await page.click('#playBtn'); // ruim tafel op
  eq(await ghosts(page), pot, 'aantal kaarten onderweg (de hele pot)');
  {
    // De kopieën hebben de maat van een gewone kaart, ook als de kaart nog aan het omdraaien was toen de tafel werd opgeruimd.
    const sizes = await page.evaluate(() => ({ card: document.querySelector('#playerGrid .card').offsetWidth,
      ghosts: [...document.querySelectorAll('#animLayer .anim-ghost')].map(g => g.offsetWidth) }));
    ok(sizes.ghosts.every(w => Math.abs(w - sizes.card) <= 1), 'kaarten onderweg hebben niet de maat van een kaart: ' + JSON.stringify(sizes));
  }
  eq(await page.locator('#playerGrid .card:not(.back)').count(), 0, 'de tafel zelf is al opgeruimd');
  await page.waitForTimeout(700);
  eq(await ghosts(page), 0, 'kaarten die nog onderweg zijn na afloop van de animatie');
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet');
  noErrors(page);
});

test('animaties: doorklikken wacht niet en laat geen kaarten achter', async page => {
  await startGame(page);
  ok(await playUntil(page, 'round-over'), 'geen ronde afgerond');
  await page.click('#playBtn'); // ruim tafel op: kaarten onderweg
  await page.click('#playBtn'); // meteen de volgende ronde
  eq(await page.evaluate(() => phase), 'revealed', 'fase na direct doorklikken');
  eq(await ghosts(page), 0, 'kaarten van de vorige stap die nog onderweg zijn');
  // Stap terug midden in een animatie.
  ok(await playUntil(page, 'round-over'), 'geen tweede ronde afgerond');
  await page.click('#playBtn');
  await page.click('#undoBtn');
  eq(await ghosts(page), 0, 'kaarten onderweg na stap terug');
  // Doorspoelen midden in een animatie.
  ok(await playUntil(page, 'round-over'), 'geen ronde afgerond na stap terug');
  await page.click('#playBtn');
  await page.click('#fastForwardBtn');
  eq(await ghosts(page), 0, 'kaarten onderweg na doorspoelen');
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet');
  noErrors(page);
});

test('animaties: bij een battle schuiven kaarten naar de pot', async page => {
  await startGame(page, { players: 4, seed: '3' });
  ok(await playUntil(page, 'battle-pending'), 'geen battle gevonden met dit seed');
  // De klik die de battle vaststelde liet de kaarten van wie niet meedoet naar de pot schuiven; die animatie loopt nog of is klaar.
  const contenders = await page.evaluate(() => game.contenders.length);
  await page.waitForTimeout(600);
  eq(await ghosts(page), 0, 'kaarten onderweg vóór het leggen van de battle-kaarten');
  await page.click('#playBtn'); // leg battle-kaarten
  eq(await ghosts(page), contenders, 'aantal kaarten dat naar de pot schuift');
  await page.waitForTimeout(700);
  eq(await ghosts(page), 0, 'kaarten onderweg na afloop');
  noErrors(page);
});

test('animaties: een oude keuze "uit" uit een eerdere versie telt niet meer en wordt gewist', async () => {
  const page = await open({ width: 420, height: 900 });
  try {
    await page.addInitScript(() => { try { localStorage.setItem('spelzonderspelelement.animaties', 'uit'); } catch (e) {} });
    await page.reload();
    await startGame(page);
    ok(await page.evaluate(() => localStorage.getItem('spelzonderspelelement.animaties')) === null, 'de oude keuze hoort gewist te zijn');
    ok(await playUntil(page, 'round-over'), 'geen ronde afgerond');
    await page.click('#playBtn');
    ok(await ghosts(page) > 0, 'ondanks de oude keuze "uit" horen de kaarten te schuiven');
    noErrors(page);
  } finally { await page.ctx.close(); }
});

test('animaties: blijven uit als het apparaat om minder beweging vraagt', async () => {
  const page = await open({ width: 420, height: 900 }, { reducedMotion: 'reduce' });
  try {
    await startGame(page);
    ok(await playUntil(page, 'round-over'), 'geen ronde afgerond');
    await page.click('#playBtn');
    eq(await ghosts(page), 0, 'kaarten onderweg');
    noErrors(page);
  } finally { await page.ctx.close(); }
});

// ---- stempels, bediening en kopteksten ----
// Zet een eigen stand klaar (stapels per speler, bovenste kaart eerst) zonder de deling van het spel.
async function setDecks(page, decks, rules = {}){
  await page.evaluate(([d, r]) => {
    const c = t => { const rank = t.slice(0, -1), suit = t.slice(-1); return { rank, suit, value: { J: 11, Q: 12, K: 13, A: 14 }[rank] || +rank }; };
    game.players.forEach((p, i) => { p.out = !d[i] || d[i].length === 0; p.deck = (d[i] || []).map(c); p.faceCard = null; });
    Object.assign(game.rules, r); game.pot = []; game.discard = []; game.contenders = []; setPhase('idle');
  }, [decks, rules]);
}
const stampText = page => page.evaluate(() => { const s = document.querySelector('#battlefield .stamp'); return s ? s.innerText.replace(/\s+/g, ' ').trim() : null; });

test('stempel: elke uitkomst heeft er een, het blijft staan tot de volgende klik en staat in het midden', async page => {
  await startGame(page, { players: 3 });
  await setDecks(page, [['K♠', '2♠', '9♠'], ['K♥', '3♥', '4♥'], ['5♦', '6♦', '7♦']]);
  await page.click('#playBtn'); // speel ronde: nog geen stempel
  eq(await stampText(page), null, 'geen stempel voordat er iets gebeurt');
  await page.click('#playBtn'); // bepaal winnaar: twee Heren, dus een battle
  const battle = await stampText(page);
  ok(battle && battle.startsWith('BATTLE') && battle.includes('Speler 1 en Speler 2 battlen'), 'stempel bij de start van een battle: ' + battle);
  await page.waitForTimeout(2500);
  eq(await stampText(page), battle, 'het stempel blijft staan tot de volgende klik');
  const pos = await page.evaluate(() => { const s = document.querySelector('#battlefield .stamp').getBoundingClientRect(), f = document.getElementById('battlefield').getBoundingClientRect();
    return { dx: Math.abs((s.left + s.width / 2) - (f.left + f.width / 2)), dy: Math.abs((s.top + s.height / 2) - (f.top + f.height / 2)) }; });
  ok(pos.dx < 3 && pos.dy < 3, 'het stempel staat in het midden van het speelveld: ' + JSON.stringify(pos));
  await page.click('#playBtn'); // leg battle-kaarten
  eq(await stampText(page), null, 'het stempel van de vorige stap is weg');
  await page.click('#playBtn'); // bepaal winnaar
  const won = await stampText(page);
  ok(won && won.startsWith('BATTLE GEWONNEN') && /verovert \d+ kaarten/.test(won), 'stempel bij het winnen van een battle: ' + won);
  await page.click('#playBtn'); // ruim tafel op
  eq(await stampText(page), null, 'na het opruimen staat er geen stempel meer');
  noErrors(page);
});

test('stempel: een afgelegde pot heet POT AFGELEGD', async page => {
  await startGame(page, { players: 3 });
  await setDecks(page, [['K♠', '2♠', '9♠'], ['K♥', '3♥', '4♥'], ['5♦', '6♦', '7♦']], { battleDiscard: true });
  await playUntil(page, 'round-over');
  const t = await stampText(page);
  ok(t && t.startsWith('POT AFGELEGD') && t.includes('gaan naar de aflegstapel'), 'stempel als de pot naar de aflegstapel gaat: ' + t);
  noErrors(page);
});

test('stempel: Revival staat in het stempel', async page => {
  await startGame(page, { players: 4 });
  await setDecks(page, [['3♥'], [], ['K♠'], ['5♦', '6♦']], { secondChance: true });
  await page.click('#playBtn'); await page.click('#playBtn');
  const r = await stampText(page);
  ok(r && r.startsWith('OVERWINNING') && r.includes('doet weer mee'), 'Revival staat in het stempel: ' + r);
  noErrors(page);
});

test('bediening: "Speel vanzelf" en "Pauzeer" zijn even breed en het schuifje blijft staan', async () => {
  for (const width of [420, 900]){
    const page = await open({ width, height: 900 });
    try {
      await startGame(page);
      const geo = () => page.evaluate(() => { const r = id => { const e = document.getElementById(id).getBoundingClientRect(); return [Math.round(e.left), Math.round(e.width)]; };
        return { knop: r('autoPlayBtn'), schuif: r('speedSlider'), label: r('speedLabel'), tekst: document.getElementById('autoPlayBtn').textContent }; });
      const voor = await geo();
      await page.click('#autoPlayBtn'); await page.waitForTimeout(150);
      const na = await geo();
      await page.click('#autoPlayBtn');
      ok(voor.tekst !== na.tekst, 'de knoptekst hoort te wisselen');
      eq(JSON.stringify([na.knop, na.schuif]), JSON.stringify([voor.knop, voor.schuif]), 'knop en schuifje bij ' + width + ' px');
      ok(voor.schuif[1] >= 80, 'het schuifje is breed genoeg (' + voor.schuif[1] + ' px bij ' + width + ' px)');
      noErrors(page);
    } finally { await page.ctx.close(); }
  }
});

test('startscherm: de kop is "Seed" zonder uitleg', async page => {
  eq((await page.locator('#setup h2').allTextContents()).filter(t => t.startsWith('Seed')), ['Seed'], 'koppen die met Seed beginnen');
});

test('animaties: snel auto-play slaat ze over en het spel blijft kloppen', async page => {
  await startGame(page);
  await page.fill('#speedSlider', '100');
  await page.dispatchEvent('#speedSlider', 'input');
  await page.click('#autoPlayBtn');
  let seen = 0;
  for (let i = 0; i < 12; i++){ seen += await ghosts(page); await page.waitForTimeout(60); }
  await page.click('#autoPlayBtn');
  eq(seen, 0, 'kaarten onderweg tijdens auto-play op 100 ms');
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet');
  noErrors(page);
});

// Waar de kaarten die onderweg zijn heen gaan: { 'player-0': 3, discard: 2, ... }
const ghostTargets = page => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('#animLayer .anim-ghost').forEach(g => { out[g.dataset.to] = (out[g.dataset.to] || 0) + 1; });
  return out;
});
// Zet regels aan en zoek een seed waarbij het spel start (met of zonder cyclusmelding).
async function startWith(page, rules, opts){
  for (const id of rules) await page.check('#' + id + 'Input');
  await startGame(page, opts);
}
// Speelt rondes tot een ronde eindigt waarvoor test(…) waar is (gekeken op het moment 'round-over'); ruimt tussendoor op.
async function playUntilRound(page, test, maxRounds = 150){
  for (let r = 0; r < maxRounds; r++){
    if (!(await playUntil(page, 'round-over', 30))) return false;
    if (await page.evaluate(test)) return true;
    await page.click('#playBtn'); // ruim tafel op
    if (['game-over', 'cycle-over'].includes(await page.evaluate(() => phase))) return false;
  }
  return false;
}

test('animaties: na een battle schuift de hele pot mee, ook de kaarten van de battle zelf', async page => {
  await startGame(page, { players: 4, seed: '3' });
  ok(await playUntilRound(page, () => game.battleLevel > 0 && roundPot.length > 0), 'geen ronde met een battle gevonden');
  const info = await page.evaluate(() => ({ pot: roundPot.length, open: document.querySelectorAll('#playerGrid .card:not(.back)').length,
    sidelined: roundSidelined.length, potText: document.getElementById('potCount').textContent }));
  ok(info.pot > info.open, 'na een battle horen er meer kaarten in de pot te zitten dan er open liggen: ' + JSON.stringify(info));
  eq(String(info.pot), info.potText, 'de bijgehouden pot is even groot als "Pot: N kaarten"');
  // Wie niet meedeed aan de battle heeft tot het opruimen een dichte kaart.
  eq(await page.evaluate(() => roundSidelined.every(id => document.querySelectorAll('#playerGrid .pslot')[game.players.findIndex(p => p.id === id)].querySelector('.card').classList.contains('back'))), true, 'kaart van wie niet meedeed is dicht');
  const winner = await page.evaluate(() => game.players.findIndex(p => p.deck.some(c => c === roundPot[0] || (c.rank === roundPot[0].rank && c.suit === roundPot[0].suit))));
  await page.click('#playBtn'); // ruim tafel op
  eq(await ghosts(page), info.pot, 'aantal kaarten onderweg na een battle');
  eq(await ghostTargets(page), { ['player-' + winner]: info.pot }, 'bestemming van de kaarten');
  await page.waitForTimeout(900);
  eq(await ghosts(page), 0, 'kaarten onderweg na afloop');
  noErrors(page);
});

test('animaties: met "Battle ruimt de pot op" schuift de hele pot naar de aflegstapel', async page => {
  await startWith(page, ['battleDiscard'], { players: 4, seed: '3' });
  ok(await playUntilRound(page, () => game.battleLevel > 0 && roundPot.length > 0), 'geen ronde met een battle gevonden');
  const pot = await page.evaluate(() => roundPot.length);
  await page.click('#playBtn');
  eq(await ghostTargets(page), { discard: pot }, 'bestemming van de kaarten');
  await page.waitForTimeout(900);
  eq(await ghosts(page), 0, 'kaarten onderweg na afloop');
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet');
  noErrors(page);
});

test('animaties: bij Koninklijk paar schuift elke kaart naar wie hem krijgt', async page => {
  await startWith(page, ['royalFamily'], { players: 6, seed: '2' });
  ok(await playUntilRound(page, () => /winnen samen/.test(document.getElementById('dispatch').textContent)), 'geen ronde gevonden waarin Heer en Vrouw samen winnen');
  const expected = await page.evaluate(() => {
    const out = {};
    for (const card of roundPot){
      const i = game.players.findIndex(p => p.deck.some(c => c.rank === card.rank && c.suit === card.suit));
      out['player-' + i] = (out['player-' + i] || 0) + 1;
    }
    return out;
  });
  ok(Object.keys(expected).length >= 2, 'de pot is niet verdeeld: ' + JSON.stringify(expected));
  await page.click('#playBtn');
  eq(await ghostTargets(page), expected, 'bestemming van de kaarten');
  noErrors(page);
});

test('animaties: bij Revival schuift een kaart van de linkerbuur naar de speler die zijn tweede kans krijgt', async page => {
  await startWith(page, ['secondChance'], { players: 4, seed: '5' });
  let seen = null;
  for (let i = 0; i < 2500 && !seen; i++){
    await page.click('#playBtn');
    if (/geeft \d+ kaarte?n? aan/.test(await page.textContent('#dispatch'))) seen = await ghostTargets(page); // iemand krijgt zijn tweede kans
    if (['game-over', 'cycle-over'].includes(await page.evaluate(() => phase))) break;
  }
  ok(seen, 'geen ronde gevonden waarin een speler zijn tweede kans krijgt');
  ok(Object.keys(seen).some(k => k.startsWith('player-')), 'er schuift geen kaart naar de speler die terugkomt: ' + JSON.stringify(seen));
  noErrors(page);
});

// ---- Eigen regels ----
const CR = '#customRule';
const crOpen = async page => { await page.click('#customRuleBtn'); await page.waitForSelector(CR + '.show'); };
const crMessages = page => page.$$eval('#customRuleMessages li', x => x.map(e => e.textContent));
const crNoCustom = page => page.evaluate(() => RULES.every(r => !r.custom) && customRun === null);
// Vult het tekstvak met het voorbeeldblok (of een eigen blok), laat het controleren en geeft het blok terug.
async function crFill(page, obj){
  await page.fill('#customRuleText', JSON.stringify(obj));
  await page.click('#customRuleCheck');
}
const crSample = page => page.evaluate(() => JSON.parse(JSON.stringify(CUSTOM_RULE_SAMPLE)));

test('eigen regels: venster openen en sluiten met toetsenbord, kruisje en klik ernaast', async page => {
  await page.click('#customRuleBtn');
  eq(await page.getAttribute(CR, 'aria-hidden'), 'false', 'aria-hidden open');
  eq(await page.evaluate(() => document.activeElement.id), 'customRuleText', 'focus bij openen');
  await page.keyboard.press('Escape');
  eq(await page.getAttribute(CR, 'aria-hidden'), 'true', 'aria-hidden dicht na Escape');
  eq(await page.evaluate(() => document.activeElement.id), 'customRuleBtn', 'focus terug naar de knop');
  await page.focus('#customRuleBtn');
  await page.keyboard.press('Enter');
  await page.waitForSelector(CR + '.show');
  await page.click('#customRuleClose');
  eq(await page.getAttribute(CR, 'aria-hidden'), 'true', 'kruisje sluit');
  await crOpen(page);
  await page.mouse.click(2, 2);
  eq(await page.getAttribute(CR, 'aria-hidden'), 'true', 'klik ernaast sluit');
  noErrors(page);
});

test('eigen regels: de focus blijft in het venster', async page => {
  await crOpen(page);
  await page.focus('#customRuleClose');
  await page.keyboard.press('Shift+Tab');
  eq(await page.evaluate(() => document.activeElement.id), 'customPromptCopy', 'Shift+Tab voor de eerste gaat naar de laatste');
  await page.keyboard.press('Tab');
  eq(await page.evaluate(() => document.activeElement.id), 'customRuleClose', 'Tab na de laatste gaat naar de eerste');
  noErrors(page);
});

test('eigen regels: voorbeeld, controleren en wijzigen', async page => {
  await crOpen(page);
  ok(await page.isDisabled('#customRuleTrialBtn') && await page.isDisabled('#customRuleAdd'), 'proefspellen en toevoegen staan aan zonder een goed blok');
  await page.click('#customRuleSample');
  const text = await page.inputValue('#customRuleText');
  eq(JSON.parse(text).id, 'custom-opeenvolgend', 'het voorbeeld staat in het tekstvak');
  ok(await page.isDisabled('#customRuleAdd'), 'toevoegen kan pas na controleren');
  await page.click('#customRuleCheck');
  eq(await crMessages(page), ['✓ De regel klopt.', '✓ De voorbeelden kloppen: 2 van de 2.', 'ℹ Dit doet je regel: De kaarten van de hoogste groep van minstens 3 kaarten met opeenvolgende waarden winnen. Bij gelijk spel: BATTLE!'], 'meldingen');
  ok(!(await page.isDisabled('#customRuleTrialBtn')) && !(await page.isDisabled('#customRuleAdd')), 'knoppen na een goede controle');
  await page.fill('#customRuleText', text + ' ');
  ok(await page.isDisabled('#customRuleTrialBtn') && await page.isDisabled('#customRuleAdd'), 'wijzigen haalt de goedkeuring weg');
  ok(await crNoCustom(page), 'niets toegevoegd');
  noErrors(page);
});

test('eigen regels: fouten staan er in gewone taal, en het blok wordt niet toegevoegd', async page => {
  await crOpen(page);
  await page.fill('#customRuleText', '{ geen json');
  await page.click('#customRuleCheck');
  ok((await crMessages(page))[0].startsWith('✗ Het spel kan deze tekst niet lezen'), 'melding bij kapotte JSON: ' + (await crMessages(page))[0]);
  const sample = await crSample(page);
  sample.code = 'alert(1)'; sample.id = 'mijn-regel'; sample.logic.then.win = { rank: 'Z' };
  await crFill(page, sample);
  const msgs = (await crMessages(page)).join(' | ');
  ok(msgs.includes('onbekend onderdeel "code"') && msgs.includes('id:') && msgs.includes('onbekende waarde'), 'meldingen noemen alle drie de fouten: ' + msgs);
  ok(await page.isDisabled('#customRuleTrialBtn') && await page.isDisabled('#customRuleAdd'), 'knoppen blijven uit');
  // Een voorbeeld dat niet klopt wordt gemeld en laat het toevoegen niet toe.
  const wrong = await crSample(page);
  wrong.examples[0].winners = [3];
  await crFill(page, wrong);
  const msgs2 = await crMessages(page);
  ok(msgs2[0].startsWith('✗ voorbeeld 1') && msgs2[msgs2.length - 1].includes('1 van de 2'), 'melding bij een fout voorbeeld: ' + msgs2.join(' | '));
  ok(await page.isDisabled('#customRuleAdd'), 'een blok met een fout voorbeeld kan niet worden toegevoegd');
  ok(await crNoCustom(page), 'niets toegevoegd');
  noErrors(page);
});

test('eigen regels: proefspellen met voortgang en rapport', async page => {
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#customRuleCheck');
  await page.selectOption('#customTrialGames', '50');
  await page.click('#customRuleTrialBtn');
  eq(await text(page, '#customRuleTrialBtn'), 'Stop', 'knop tijdens de proef');
  ok(await page.isDisabled('#customRuleAdd') && await page.isDisabled('#customRuleCheck'), 'tijdens de proef kan er niets worden toegevoegd of gecontroleerd');
  await page.waitForSelector('#customRuleReport table', { timeout: 60000 });
  eq(await text(page, '#customRuleTrialBtn'), 'Speel proefspellen', 'knop na de proef');
  ok(await page.isHidden('#customRuleProgress'), 'voortgangsbalk weg na de proef');
  ok(!(await page.isDisabled('#customRuleAdd')), 'toevoegen kan weer');
  const rows = await page.$$eval('#customRuleReport .cr-table tr', trs => trs.map(tr => [...tr.children].map(c => c.textContent)));
  eq(rows.map(r => r[0]), ['', 'Gespeelde spellen', 'Eindigen met een winnaar', 'Eindigen nooit (dezelfde stand komt terug)', 'Nog bezig na 3000 rondes', 'Gemiddeld aantal rondes (spellen met een winnaar)'], 'rijen van het rapport');
  eq(rows[1], ['Gespeelde spellen', '50', '50'], 'aantal spellen');
  const notes = await page.$$eval('#customRuleReport .cr-messages li', x => x.map(e => e.textContent));
  eq(notes.map(n => n[0]), ['✓', '✓', '✓'], 'alles in orde');
  ok(await crNoCustom(page), 'de regel staat na de proef niet in het spel');
  noErrors(page);
});

test('eigen regels: stoppen, en sluiten tijdens een proef, laat niets achter', async page => {
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#customRuleCheck');
  await page.selectOption('#customTrialGames', '1000');
  await page.click('#customRuleTrialBtn');
  await page.waitForFunction(() => document.getElementById('customRuleProgress').value > 0);
  eq(await page.evaluate(() => RULES.some(r => r.custom)), true, 'de regel staat tijdens de proef tijdelijk in het spel');
  await page.click('#customRuleTrialBtn'); // Stop
  ok(await crNoCustom(page), 'na stoppen is de regel weer weg');
  eq(await text(page, '#customRuleTrialBtn'), 'Speel proefspellen', 'knop na stoppen');
  await page.click('#customRuleTrialBtn');
  await page.waitForFunction(() => document.getElementById('customRuleProgress').value > 0);
  await page.keyboard.press('Escape'); // venster dicht tijdens de proef
  ok(await crNoCustom(page), 'na sluiten is de regel weer weg');
  await page.waitForTimeout(200);
  ok(await crNoCustom(page), 'en blijft weg (de proef loopt niet door)');
  noErrors(page);
});

test('eigen regels: de proef kan meespelen met de regels die zijn aangevinkt', async page => {
  await page.evaluate(() => { const orig = createCustomTrial; window.__opts = []; createCustomTrial = (d, o) => { window.__opts.push(o); return orig(d, o); }; });
  await page.check('#battleFirstInput');
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#customRuleCheck');
  await page.selectOption('#customTrialGames', '50');
  await page.click('#customRuleTrialBtn');
  await page.waitForSelector('#customRuleReport table', { timeout: 60000 });
  await page.check('#customTrialBase');
  await page.click('#customRuleTrialBtn');
  await page.waitForFunction(() => window.__opts.length === 2);
  // Wachten tot de tweede proef klaar is. Niet op "Stop" klikken: sinds de stoelfix eindigen de proefspellen zo snel dat de proef
  // vaak al klaar is, en dan start dezelfde knop een derde proef.
  await page.waitForFunction(() => document.getElementById('customRuleTrialBtn').textContent === 'Speel proefspellen', null, { timeout: 60000 });
  eq(await page.evaluate(() => window.__opts.map(o => [o.games, o.base])), [[50, {}], [50, { battleFirst: true }]], 'opties van de proef');
  noErrors(page);
});

test('eigen regels: toevoegen zet een aangevinkt vinkje bij, en laat de andere keuzes staan', async page => {
  await page.check('#twoBeatsAceInput');
  await page.check('#suitBreakInput');
  await page.selectOption('.suit-picker select >> nth=0', '♣');
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#customRuleCheck');
  await page.click('#customRuleAdd');
  eq(await page.getAttribute(CR, 'aria-hidden'), 'true', 'venster dicht na toevoegen');
  eq(await page.evaluate(() => document.activeElement.id), 'custom-opeenvolgendInput', 'focus op het nieuwe vinkje');
  ok(await page.isChecked('#custom-opeenvolgendInput'), 'het nieuwe vinkje staat aan');
  ok((await text(page, '#customRuleStatus')).includes('Opeenvolgende kaarten'), 'melding: ' + await text(page, '#customRuleStatus'));
  ok((await page.textContent('#custom-opeenvolgendInput >> xpath=..')).includes('(eigen regel)'), 'label noemt het een eigen regel');
  ok(await page.isChecked('#twoBeatsAceInput') && await page.isChecked('#suitBreakInput'), 'andere vinkjes blijven aan');
  ok(!(await page.isChecked('#battleFirstInput')), 'vinkjes die uit stonden blijven uit');
  eq(await page.$$eval('.suit-picker select', s => s.map(x => x.value).join('')), '♣♥♦♠', 'volgorde van de symbolen blijft');
  // Het regelboek kent de regel, met zijn voorbeelden en een label.
  await page.click('#rulebookBtnSetup');
  const book = await text(page, '#rulebookBody');
  ok(book.includes('Opeenvolgende kaarten') && book.includes('eigen regel') && book.includes('Geen reeks van drie'), 'regelboek toont de eigen regel met zijn voorbeelden');
  await page.keyboard.press('Escape');
  noErrors(page);
});

test('eigen regels: het spel gebruikt de regel, en F5 zet alles terug', async page => {
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#customRuleCheck');
  await page.click('#customRuleAdd');
  await startGame(page, { players: 4, seed: 'cr1' });
  eq(await page.evaluate(() => game.rules['custom-opeenvolgend']), true, 'de regel staat aan in het spel');
  eq(await page.evaluate(() => JSON.stringify(findWinningPlayers(['7♠', '8♥', '9♦', 'A♣'].map((c, i) => ({ id: i, faceCard: parseExampleCard(c) })), game.rules).map(p => p.id))), '[0,1,2]', 'de regel beslist een tafel');
  for (let i = 0; i < 40; i++) await page.click('#playBtn');
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet');
  await page.click('#rulebookBtnGame');
  ok((await text(page, '#rulebookBody')).includes('Opeenvolgende kaarten'), 'regelboek in het spel kent de regel');
  await page.keyboard.press('Escape');
  await page.reload();
  eq(await page.locator('#custom-opeenvolgendInput').count(), 0, 'na verversen is de eigen regel weg');
  noErrors(page);
});

test('eigen regels: dezelfde id vervangt, exporteren en weghalen werken', async page => {
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#customRuleCheck');
  await page.click('#customRuleAdd');
  const second = await crSample(page);
  second.title = 'Tweede versie'; second.short = 'Tweede korte tekst';
  await crOpen(page);
  await crFill(page, second);
  ok((await crMessages(page)).some(m => m.includes('dan vervangt hij de oude')), 'melding dat er al een regel met deze id is');
  await page.click('#customRuleAdd');
  eq(await page.locator('#rulesList label.rule-check').count(), 7, 'nog steeds één vinkje erbij');
  ok((await page.textContent('#custom-opeenvolgendInput >> xpath=..')).includes('Tweede versie'), 'het vinkje toont de naam van de nieuwste versie');
  await crOpen(page);
  eq(await page.$$eval('#customRuleAdded li span', x => x.map(e => e.textContent)), ['Tweede versie (custom-opeenvolgend)'], 'lijst met toegevoegde regels');
  await page.click('#customRuleAdded button:has-text("Exporteer")');
  eq(await page.evaluate(() => JSON.parse(document.getElementById('customRuleText').value).title), 'Tweede versie', 'export zet het blok in het tekstvak');
  eq(await crMessages(page), ['✓ De regel klopt.', '✓ De voorbeelden kloppen: 2 van de 2.', 'ℹ Dit doet je regel: De kaarten van de hoogste groep van minstens 3 kaarten met opeenvolgende waarden winnen. Bij gelijk spel: BATTLE!', 'ℹ Je hebt al een eigen regel met deze id. Voeg je deze toe, dan vervangt hij de oude.'], 'export wordt meteen gecontroleerd');
  await page.click('#customRuleAdded button:has-text("Haal weg")');
  eq(await page.locator('#custom-opeenvolgendInput').count(), 0, 'vinkje is weg');
  eq(await page.locator('#rulesList label.rule-check').count(), 6, 'zes vinkjes over');
  ok((await text(page, '#customRuleStatus')).includes('weggehaald'), 'melding na weghalen');
  ok(await crNoCustom(page), 'regel is weg uit het spel');
  noErrors(page);
});

test('eigen regels: teksten blijven tekst, ook met HTML erin', async page => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const sample = await crSample(page);
  sample.title = evil; sample.short = evil + ' kort'; sample.description = evil + ' uitleg';
  await crOpen(page);
  await crFill(page, sample);
  await page.click('#customRuleAdd');
  const label = await page.textContent('#custom-opeenvolgendInput >> xpath=..');
  ok(label.includes(evil), 'het label toont de naam letterlijk: ' + label);
  await page.click('#rulebookBtnSetup');
  ok((await text(page, '#rulebookBody')).includes(evil + ' uitleg'), 'het regelboek toont de tekst letterlijk');
  await page.keyboard.press('Escape');
  await crOpen(page);
  ok((await text(page, '#customRuleAdded')).includes(evil), 'de lijst toont de tekst letterlijk');
  eq(await page.locator('img[src="x"]').count(), 0, 'er is geen img-element ontstaan');
  eq(await page.evaluate(() => window.__pwned), undefined, 'er is niets uitgevoerd');
  noErrors(page);
});

test('eigen regels: het venster past op smalle schermen', async () => {
  for (const width of [320, 412]){
    const page = await open({ width, height: 700 });
    try {
      await crOpen(page);
      await page.click('#customRuleSample');
      await page.click('#customRuleCheck');
      await page.selectOption('#customTrialGames', '50');
      await page.click('#customRuleTrialBtn');
      await page.waitForSelector('#customRuleReport table', { timeout: 60000 });
      eq(await hScroll(page), 0, 'horizontaal scrollen bij ' + width + ' px');
      const inner = await page.evaluate(() => { const i = document.getElementById('customRuleInner'); return { scroll: i.scrollWidth - i.clientWidth, w: i.getBoundingClientRect().width }; });
      ok(inner.scroll <= 1 && inner.w <= width, 'het venster is te breed bij ' + width + ' px: ' + JSON.stringify(inner));
      for (const id of ['customRuleSample', 'customRuleCheck', 'customRuleTrialBtn', 'customRuleAdd', 'customRuleClose']){
        const box = await page.locator('#' + id).boundingBox();
        ok(box && box.x >= 0 && box.x + box.width <= width + 0.5, 'knop ' + id + ' valt buiten het scherm bij ' + width + ' px');
      }
      noErrors(page);
    } finally { await page.ctx.close(); }
  }
});

test('eigen regels: het venster leest de regel terug in gewone taal', async page => {
  await crOpen(page);
  const rood = await page.evaluate(() => ({ id: 'custom-rood', title: 'Rood', short: 'Rood gaat voor', description: 'Rood gaat voor.', logic: { moment: 'decide', if: { exists: { color: 'red' } }, then: { win: { highest: 'value', of: { color: 'red' } } } },
    examples: [{ cards: ['K♠', '9♥', '3♦'], winners: [1], text: 'x' }] }));
  await crFill(page, rood);
  const msgs = await crMessages(page);
  eq(msgs[2], 'ℹ Dit doet je regel: Als er een rode kaart ligt, dan wint de hoogste rode kaart. Bij gelijk spel: BATTLE!', 'zin bij een regel met een voorwaarde');
  // Bij een blok dat niet klopt is er geen zin.
  rood.logic.then.win = { rank: 'Z' };
  await crFill(page, rood);
  ok(!(await crMessages(page)).some(m => m.includes('Zo leest')), 'een kapot blok krijgt geen zin');
  noErrors(page);
});

// ---- De regelbouwer ----
const bSentence = page => text(page, '#ruleBuilderSentence');
const bPick = (page, label, value) => page.selectOption('[aria-label="' + label + '"]', value);
const bBlock = page => page.evaluate(() => JSON.parse(document.getElementById('customRuleText').value));
// Zet een waarde (rank-chip) aan of uit in een groep chips.
const bChip = (page, group, name, on) => page.locator('[aria-label="' + group + '"] label', { hasText: new RegExp('^' + name + '$') }).locator('input').setChecked(on);

test('regelbouwer: de bouwer staat in het venster en maakt een blok bij elke keuze', async page => {
  await crOpen(page);
  ok(await page.isVisible('#ruleBuilderForm'), 'het formulier staat in het venster');
  eq(await page.$$eval('[aria-label="Wanneer?"] option', o => o.map(x => x.textContent)),
    ['Als de kaarten open liggen: wie wint de ronde?', 'Als spelers gelijk eindigen: wie van hen wint?', 'Als de winnaar de pot krijgt', 'Aan het einde van de ronde'], 'momenten');
  ok((await bSentence(page)).startsWith('Hier komt in gewone taal'), 'uitleg voordat er iets is gekozen');
  eq(await page.inputValue('#customRuleText'), '', 'het tekstvak blijft leeg tot je iets kiest');
  await page.fill('.bld-title', 'Aas en twee');
  eq((await bBlock(page)).id, 'custom-aas-en-twee', 'id uit de naam');
  eq(await bSentence(page), 'Kaarten met een Aas winnen. Bij gelijk spel: BATTLE!', 'zin bij de beginstand');
  const msgs = await crMessages(page);
  ok(msgs[0] === '✓ De regel klopt.' && msgs[1].startsWith('✓ De voorbeelden kloppen'), 'het blok wordt meteen gecontroleerd: ' + msgs.join(' | '));
  ok(!(await page.isDisabled('#customRuleTrialBtn')) && !(await page.isDisabled('#customRuleAdd')), 'knoppen na een goed blok');
  noErrors(page);
});

test('regelbouwer: waarden en symbolen kiezen, en voorwaarden samenstellen', async page => {
  await crOpen(page);
  await page.click('text=+ voorwaarde');
  await bPick(page, 'Voorwaarde 1: welke kaarten?', 'rank');
  await bChip(page, 'Voorwaarde 1: waarden', 'K', true);
  await bChip(page, 'Voorwaarde 1: waarden', 'A', false);
  await bPick(page, 'Gevolg: welke kaarten?', 'suit');
  await bChip(page, 'Gevolg: symbolen', '♥', false);
  eq(await bSentence(page), 'Nog niet klaar: Kies minstens één symbool.', 'melding bij een lege keuze');
  ok(await page.isDisabled('#customRuleAdd'), 'toevoegen kan niet zonder complete regel');
  await bChip(page, 'Gevolg: symbolen', '♥', true);
  await bChip(page, 'Gevolg: symbolen', '♦', true);
  eq(await bSentence(page), 'Als er een Heer ligt, dan winnen kaarten van harten of ruiten. Bij gelijk spel: BATTLE!', 'zin met een voorwaarde en twee symbolen');
  // Een tweede voorwaarde, samengevoegd met "of", en "niet".
  await page.click('text=+ voorwaarde');
  await page.locator('.bld-row').nth(1).locator('label', { hasText: /^juist niet$/ }).locator('input').check();
  await page.selectOption('[aria-label="Moeten alle voorwaarden kloppen?"]', 'or');
  eq(await bSentence(page), 'Als er een Heer ligt of er geen Aas ligt, dan winnen kaarten van harten of ruiten. Bij gelijk spel: BATTLE!', 'de voorwaarden zijn met "of" verbonden en de tweede is ontkend');
  const block = await bBlock(page);
  eq(Object.keys(block.logic.if), ['or'], 'de beschrijving heeft een "or"');
  noErrors(page);
});

test('regelbouwer: het moment bepaalt wat er te kiezen valt', async page => {
  await crOpen(page);
  const effects = () => page.$$eval('[aria-label="Wat gebeurt er?"] option', o => o.map(x => x.value));
  eq(await effects(), ['win'], 'gevolgen bij het bepalen van de winnaar');
  await bPick(page, 'Wanneer?', 'award');
  eq(await effects(), ['discardPot', 'sharePot'], 'gevolgen bij het toekennen van de pot');
  eq(await bSentence(page), 'De hele pot gaat naar de aflegstapel.', 'zin na wisselen van moment');
  await page.click('text=+ voorwaarde');
  eq(await page.$$eval('[aria-label="Voorwaarde 1: wat moet er kloppen?"] option', o => o.map(x => x.value)), ['battle', 'winnerOpened', 'anyPlayer', 'playersWithCards', 'group'], 'voorwaarden bij award (en een groep)');
  await bPick(page, 'Voorwaarde 1: wat moet er kloppen?', 'anyPlayer');
  eq(await page.$$eval('[aria-label="Voorwaarde 1: welke spelers?"] option', o => o.map(x => x.value)), ['winner', 'opened', 'withoutCards'], 'spelers bij award, met de winnaar');
  await bPick(page, 'Wanneer?', 'roundEnd');
  eq(await page.$$eval('[aria-label="Wat gebeurt er?"] option', o => o.map(x => x.value)), ['transfer', 'discardTop'], 'gevolgen aan het einde van de ronde');
  await page.click('text=+ voorwaarde');
  await bPick(page, 'Voorwaarde 1: wat moet er kloppen?', 'anyPlayer');
  eq(await page.$$eval('[aria-label="Voorwaarde 1: welke spelers?"] option', o => o.map(x => x.value)), ['opened', 'withoutCards'], 'spelers aan het einde van de ronde, zonder de winnaar');
  await bPick(page, 'Voorwaarde 1: welke spelers?', 'opened');
  eq(await page.locator('text=behalve de winnaar').count(), 0, 'behalve de winnaar bestaat alleen bij award');
  await bPick(page, 'Wanneer?', 'award');
  await page.click('text=+ voorwaarde');
  await bPick(page, 'Voorwaarde 1: wat moet er kloppen?', 'anyPlayer');
  await bPick(page, 'Voorwaarde 1: welke spelers?', 'opened');
  eq(await page.locator('text=behalve de winnaar').count(), 1, 'bij award staat behalve de winnaar er wel');
  // De keuzes bij "er is een speler die ..." worden echt onthouden (ze lagen eerst in een kopie).
  await page.locator('label', { hasText: 'behalve de winnaar' }).locator('input').check();
  await bChip(page, 'Voorwaarde 1: waarden', 'A', false);
  await bChip(page, 'Voorwaarde 1: waarden', 'Q', true);
  eq(await bSentence(page), 'Als er een andere speler is die de ronde met een Vrouw begon, dan gaat de hele pot naar de aflegstapel.', 'zin na het kiezen van spelers');
  eq((await bBlock(page)).logic.if, { anyPlayer: { opened: { rank: 'Q' }, exclude: 'winner' } }, 'beschrijving na het kiezen van spelers');
  noErrors(page);
});

test('regelbouwer: het vinkje "tweede kans" bij "er is een speler" wordt onthouden, ook na laden', async page => {
  await crOpen(page);
  await bPick(page, 'Wanneer?', 'award');
  await page.click('text=+ voorwaarde');
  await bPick(page, 'Voorwaarde 1: wat moet er kloppen?', 'anyPlayer');
  await bPick(page, 'Voorwaarde 1: welke spelers?', 'withoutCards');
  const box = page.locator('label', { hasText: 'alleen spelers die nog een tweede kans hebben' }).locator('input');
  await box.check();
  eq((await bBlock(page)).logic.if, { anyPlayer: { withoutCards: true, secondChance: true } }, 'de tweede kans staat in de beschrijving');
  ok((await bSentence(page)).startsWith('Als er een speler zonder kaarten is die nog een tweede kans heeft, dan gaat de hele pot naar de aflegstapel.'), 'zin met de tweede kans');
  // Het blok opnieuw in de bouwer laden: het vinkje staat er nog.
  await page.click('#ruleBuilderLoad');
  ok(await page.locator('label', { hasText: 'alleen spelers die nog een tweede kans hebben' }).locator('input').isChecked(), 'het vinkje staat aan na laden');
  await page.locator('label', { hasText: 'alleen spelers die nog een tweede kans hebben' }).locator('input').uncheck();
  eq((await bBlock(page)).logic.if, { anyPlayer: { withoutCards: true } }, 'uitvinken haalt de tweede kans weg');
  noErrors(page);
});

test('regelbouwer: de zes regels van het spel komen uit de bouwer als dezelfde regel', async page => {
  // Alle zes laden in de bouwer en weer eruit; de beschrijving blijft precies hetzelfde.
  const same = await page.evaluate(() => RULES.map(r => { rb = rbFromLogic(r.logic); return [r.id, rb !== null && JSON.stringify(rbToLogic(rb).logic) === JSON.stringify(r.logic)]; }));
  eq(same.filter(x => !x[1]), [], 'regels die niet identiek terugkomen');
  noErrors(page);
});

test('regelbouwer: een bestaand blok in de bouwer laden', async page => {
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#ruleBuilderLoad');
  eq(await page.inputValue('.bld-title'), 'Opeenvolgende kaarten', 'naam uit het blok');
  eq(await page.$eval('[aria-label="Gevolg: welke kaarten?"]', e => e.value), 'group', 'de keuze van kaarten is geladen');
  eq(await bSentence(page), 'De kaarten van de hoogste groep van minstens 3 kaarten met opeenvolgende waarden winnen. Bij gelijk spel: BATTLE!', 'zin');
  // Aanpassen in de bouwer werkt het blok bij.
  await bPick(page, 'Gevolg: hoe horen ze bij elkaar?', 'sameSuit');
  eq((await bBlock(page)).logic.then.win.group.relation, 'sameSuit', 'het blok volgt de bouwer');
  // Een blok dat de bouwer niet kan tonen geeft een melding en laat het tekstvak staan.
  const odd = await crSample(page);
  odd.logic = { moment: 'decide', if: { and: [{ or: [{ exists: { rank: 'A' } }, { and: [{ exists: { rank: 'K' } }, { exists: { rank: 'Q' } }] }] }, { exists: { rank: '2' } }] }, then: { win: { rank: '2' } } };
  odd.examples = [{ cards: ['A♠', '2♥'], winners: [1], text: 'x' }];
  await page.fill('#customRuleText', JSON.stringify(odd));
  await page.click('#ruleBuilderLoad');
  ok((await crMessages(page))[0].includes('kan deze regel niet laten zien'), 'melding: ' + (await crMessages(page))[0]);
  eq((await bBlock(page)).logic.moment, 'decide', 'tekstvak blijft zoals het was');
  // Een kapot blok geeft de meldingen van de controle.
  await page.fill('#customRuleText', '{ kapot');
  await page.click('#ruleBuilderLoad');
  ok((await crMessages(page))[0].startsWith('✗ Het spel kan deze tekst niet lezen'), 'melding bij kapotte JSON');
  noErrors(page);
});

test('regelbouwer: een bovengrens van 9 spelers wordt bij laden 8, met een melding', async page => {
  await crOpen(page);
  const block = await crSample(page);
  block.logic = { moment: 'award', if: { playersWithCards: { min: 2, max: 9 } }, then: { discardPot: true } };
  block.examples = await page.evaluate(logic => rbSuggestExamples(logic).examples, block.logic); // voorbeelden die het spel zelf vindt
  await page.fill('#customRuleText', JSON.stringify(block));
  await page.click('#ruleBuilderLoad');
  const msgs = await crMessages(page);
  ok(msgs.some(m => m.includes('De bovengrens van 9 spelers is in de bouwer 8 geworden')), 'melding over de aanpassing: ' + msgs.join(' | '));
  eq(await page.$eval('[aria-label="Voorwaarde 1: hoeveel?"]', e => e.value), 'between', 'tussen ... en ...');
  eq(await page.$eval('[aria-label="Voorwaarde 1: tweede aantal"]', e => e.value), '8', 'het tweede aantal is 8');
  eq((await bBlock(page)).logic.if, { playersWithCards: { min: 2, max: 8 } }, 'het blok heeft nu 8');
  // Een ondergrens boven 8 zou de regel echt veranderen: die toont de bouwer niet.
  block.logic = { moment: 'award', if: { playersWithCards: { min: 9 } }, then: { discardPot: true } };
  await page.fill('#customRuleText', JSON.stringify(block));
  await page.click('#ruleBuilderLoad');
  ok((await crMessages(page))[0].includes('kan deze regel niet laten zien'), 'minstens 9 kan de bouwer niet tonen');
  noErrors(page);
});

test('regelbouwer: van bouwen tot meespelen, met proefspellen', async page => {
  await crOpen(page);
  await page.fill('.bld-title', 'Rood gaat voor');
  await page.click('text=+ voorwaarde');
  await bPick(page, 'Voorwaarde 1: welke kaarten?', 'color');
  await bPick(page, 'Gevolg: welke kaarten?', 'highest');
  await bPick(page, 'Gevolg: van welke kaarten?', 'red');
  eq(await bSentence(page), 'Als er een rode kaart ligt, dan wint de hoogste rode kaart. Bij gelijk spel: BATTLE!', 'zin');
  const examples = (await bBlock(page)).examples;
  ok(examples.length >= 2 && examples.length <= 3, 'het spel zoekt voorbeelden: ' + examples.length);
  ok(examples.some(e => /Zonder de regel: speler \d wint/.test(e.text) || /battlen/.test(e.text)), 'de voorbeelden vergelijken met en zonder de regel');
  await page.selectOption('#customTrialGames', '50');
  await page.click('#customRuleTrialBtn');
  await page.waitForSelector('#customRuleReport table', { timeout: 60000 });
  await page.click('#customRuleAdd');
  ok(await page.isChecked('#custom-rood-gaat-voorInput'), 'het vinkje staat aan');
  await startGame(page, { players: 4, seed: 'b1' });
  eq(await page.evaluate(() => JSON.stringify(findWinningPlayers(['K♠', '9♥', '3♦'].map((c, i) => ({ id: i, faceCard: parseExampleCard(c) })), game.rules).map(p => p.id))), '[1]', 'de rode 9 wint van de zwarte Heer');
  for (let i = 0; i < 30; i++) await page.click('#playBtn');
  ok((await text(page, '#integrityStatus')).includes('klopt'), 'kaartentelling klopt niet');
  noErrors(page);
});

test('regelbouwer: de focus blijft bij het veld dat je wijzigt', async page => {
  await crOpen(page);
  await page.click('text=+ voorwaarde');
  await page.focus('[aria-label="Voorwaarde 1: welke kaarten?"]');
  await bPick(page, 'Voorwaarde 1: welke kaarten?', 'suit');
  eq(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Voorwaarde 1: welke kaarten?', 'focus na wisselen van soort');
  await page.focus('[aria-label="Wanneer?"]');
  await bPick(page, 'Wanneer?', 'tiebreak');
  eq(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Wanneer?', 'focus na wisselen van moment');
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => !!document.activeElement.closest('#ruleBuilderForm')), 'Tab gaat verder in de bouwer');
  noErrors(page);
});

test('regelbouwer: teksten uit de naam blijven tekst', async page => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  await crOpen(page);
  await page.fill('.bld-title', evil);
  const block = await bBlock(page);
  eq(block.title, evil.slice(0, 60), 'de naam blijft zoals getypt');
  eq(block.id, 'custom-img-src-x-onerror-window-pwned', 'de id bevat alleen veilige tekens');
  await page.click('#customRuleAdd');
  ok((await page.textContent('#custom-img-src-x-onerror-window-pwnedInput >> xpath=..')).length > 0, 'het vinkje bestaat');
  eq(await page.locator('img[src="x"]').count(), 0, 'er is geen img-element ontstaan');
  eq(await page.evaluate(() => window.__pwned), undefined, 'er is niets uitgevoerd');
  noErrors(page);
});

test('regelbouwer: de bouwer past op smalle schermen', async () => {
  const page = await open({ width: 320, height: 700 });
  try {
    await crOpen(page);
    await page.click('text=+ voorwaarde');
    await bPick(page, 'Wanneer?', 'award');
    await page.click('text=+ voorwaarde');
    await bPick(page, 'Voorwaarde 1: wat moet er kloppen?', 'anyPlayer');
    await bPick(page, 'Voorwaarde 1: welke spelers?', 'opened');
    await bPick(page, 'Wat gebeurt er?', 'sharePot');
    await page.click('text=+ spelers erbij');
    eq(await hScroll(page), 0, 'horizontaal scrollen');
    const inner = await page.evaluate(() => { const i = document.getElementById('customRuleInner'); return { scroll: i.scrollWidth - i.clientWidth }; });
    ok(inner.scroll <= 1, 'het venster scrolt zijwaarts: ' + JSON.stringify(inner));
    noErrors(page);
  } finally { await page.ctx.close(); }
});

test('regelbouwer: een groep voorwaarden (a en (b of c))', async page => {
  await crOpen(page);
  await page.click('text=+ voorwaarde');
  await bChip(page, 'Voorwaarde 1: waarden', 'A', false);
  await bChip(page, 'Voorwaarde 1: waarden', '2', true);
  await page.click('text=+ voorwaarde');
  await bPick(page, 'Voorwaarde 2: wat moet er kloppen?', 'group');
  eq(await page.$$eval('[aria-label="Voorwaarde 2.1: wat moet er kloppen?"] option', o => o.map(x => x.value)), ['exists', 'count'], 'in een groep kan geen groep');
  await bChip(page, 'Voorwaarde 2.2: waarden', 'A', false);
  await bChip(page, 'Voorwaarde 2.2: waarden', 'K', true);
  eq(await bSentence(page), 'Als er een 2 ligt en (er een Aas ligt of er een Heer ligt), dan winnen kaarten met een Aas. Bij gelijk spel: BATTLE!', 'zin met een groep');
  eq((await bBlock(page)).logic.if, { and: [{ exists: { rank: '2' } }, { or: [{ exists: { rank: 'A' } }, { exists: { rank: 'K' } }] }] }, 'beschrijving met een groep');
  await bPick(page, 'Voorwaarde 2: moeten ze allemaal kloppen?', 'and');
  await page.click('[aria-label="Voorwaarde 2: voorwaarde toevoegen aan de groep"]');
  eq((await bBlock(page)).logic.if.and[1].and.length, 3, 'derde voorwaarde in de groep');
  await page.click('[aria-label="Voorwaarde 2.3 weghalen"]');
  await page.click('[aria-label="Voorwaarde 2.2 weghalen"]');
  eq((await bBlock(page)).logic.if, { and: [{ exists: { rank: '2' } }, { exists: { rank: 'A' } }] }, 'een groep met één voorwaarde is die voorwaarde');
  await page.click('[aria-label="Voorwaarde 2.1 weghalen"]');
  eq(await bSentence(page), 'Nog niet klaar: Voeg een voorwaarde toe aan de groep.', 'melding bij een lege groep');
  // Een blok met een groep laadt in de bouwer.
  const blk = await crSample(page);
  blk.logic = { moment: 'decide', if: { or: [{ exists: { rank: '2' } }, { not: { and: [{ exists: { rank: 'A' } }, { exists: { rank: 'K' } }] } }] }, then: { win: { rank: '2' } } };
  blk.examples = [{ cards: ['2♠', 'A♥'], winners: [0], text: 'x' }];
  await page.fill('#customRuleText', JSON.stringify(blk));
  await page.click('#ruleBuilderLoad');
  eq(await page.$eval('[aria-label="Voorwaarde 2: wat moet er kloppen?"]', e => e.value), 'group', 'de groep is geladen');
  eq((await bBlock(page)).logic, blk.logic, 'de beschrijving blijft gelijk na laden');
  noErrors(page);
});

test('regelbouwer: een geladen blok blijft dezelfde regel, met de eigen uitleg en voorbeelden', async page => {
  await crOpen(page);
  await page.click('#customRuleSample');
  const original = await bBlock(page);
  await page.click('#ruleBuilderLoad');
  eq(canon(await bBlock(page)), canon(original), 'na laden heeft het blok dezelfde inhoud');
  ok(await page.isHidden('#ruleBuilderNotice'), 'geen melding over eigen tekst na laden');
  // De naam wijzigen: de id, de uitleg en de voorbeelden blijven.
  await page.fill('.bld-title', 'Reeksen');
  let blk = await bBlock(page);
  eq(canon([blk.id, blk.title, blk.description, blk.examples]), canon([original.id, 'Reeksen', original.description, original.examples]), 'na een andere naam');
  // De regel zelf wijzigen: zelfde id, nieuwe uitleg en voorbeelden, met een melding.
  await bPick(page, 'Gevolg: hoe horen ze bij elkaar?', 'sameSuit');
  blk = await bBlock(page);
  eq(blk.id, original.id, 'de id blijft na een wijziging van de regel');
  ok(blk.description !== original.description && JSON.stringify(canon(blk.examples)) !== JSON.stringify(canon(original.examples)), 'uitleg en voorbeelden zijn opnieuw gemaakt');
  ok((await crMessages(page)).some(m => m.includes('opnieuw gemaakt') && m.includes(original.id)), 'melding dat de uitleg en voorbeelden opnieuw zijn gemaakt: ' + (await crMessages(page)).join(' | '));
  // Terug naar de oorspronkelijke regel: de eigen teksten komen terug.
  await bPick(page, 'Gevolg: hoe horen ze bij elkaar?', 'consecutive');
  blk = await bBlock(page);
  eq(canon([blk.description, blk.examples]), canon([original.description, original.examples]), 'de eigen uitleg en voorbeelden komen terug');
  // Toevoegen en opnieuw laden en wijzigen vervangt dezelfde regel (geen tweede).
  await page.click('#customRuleAdd');
  await crOpen(page);
  await bPick(page, 'Gevolg: hoe horen ze bij elkaar?', 'sameColor');
  await page.click('#customRuleAdd');
  eq(await page.evaluate(() => customRules().map(r => r.id + ':' + r.logic.then.win.group.relation)), [original.id + ':sameColor'], 'één regel, de gewijzigde');
  noErrors(page);
});

test('regelbouwer: de bouwer schrijft niet over eigen tekst in het tekstvak heen', async page => {
  await crOpen(page);
  const own = '{"mijn": "eigen tekst"}';
  await page.fill('#customRuleText', own);
  await page.fill('.bld-title', 'Iets');
  eq(await page.inputValue('#customRuleText'), own, 'het tekstvak na een wijziging in de bouwer');
  ok(await page.isVisible('#ruleBuilderNotice'), 'de melding staat er');
  ok((await bSentence(page)).startsWith('Kaarten'), 'de zin van de bouwer werkt wel bij');
  await page.click('text=+ voorwaarde');
  eq(await page.inputValue('#customRuleText'), own, 'ook na meer wijzigingen blijft de eigen tekst staan');
  // Een onvolledige regel in de bouwer raakt het eigen blok ook niet.
  await bChip(page, 'Voorwaarde 1: waarden', 'A', false);
  eq(await page.inputValue('#customRuleText'), own, 'de eigen tekst blijft bij een onvolledige regel');
  await bChip(page, 'Voorwaarde 1: waarden', 'A', true);
  // Pas na de knop wordt het tekstvak vervangen; daarna schrijft de bouwer weer gewoon.
  await page.click('#ruleBuilderReplace');
  eq((await bBlock(page)).id, 'custom-iets', 'na vervangen staat de regel uit de bouwer in het tekstvak');
  ok(await page.isHidden('#ruleBuilderNotice'), 'de melding is weg');
  await page.fill('.bld-title', 'Iets anders');
  eq((await bBlock(page)).id, 'custom-iets-anders', 'de bouwer schrijft weer mee');
  // Het voorbeeld en een geëxporteerd blok tellen ook als eigen tekst.
  await page.click('#customRuleSample');
  await page.fill('.bld-title', 'Nog iets');
  eq((await bBlock(page)).id, 'custom-opeenvolgend', 'het voorbeeld blijft staan');
  ok(await page.isVisible('#ruleBuilderNotice'), 'de melding staat er weer');
  // Een leeg tekstvak mag de bouwer altijd vullen.
  await page.fill('#customRuleText', '');
  await page.fill('.bld-title', 'Leeg');
  eq((await bBlock(page)).id, 'custom-leeg', 'een leeg tekstvak wordt gevuld');
  noErrors(page);
});

test('regelbouwer: twee regels zonder naam worden twee regels, en opnieuw beginnen', async page => {
  await crOpen(page);
  await page.click('text=+ voorwaarde');
  await page.click('#customRuleAdd');
  await crOpen(page);
  await bPick(page, 'Wanneer?', 'award');
  eq([(await bBlock(page)).id, (await bBlock(page)).title], ['custom-nieuwe-regel-2', 'Nieuwe regel 2'], 'de tweede regel zonder naam');
  await page.click('#customRuleAdd');
  eq(await page.evaluate(() => customRules().map(r => r.id + ':' + r.logic.moment)), ['custom-nieuwe-regel:decide', 'custom-nieuwe-regel-2:award'], 'twee eigen regels');
  eq(await page.locator('#rulesList label.rule-check').count(), 8, 'twee vinkjes erbij');
  // Opnieuw beginnen maakt de bouwer leeg, laat het tekstvak staan en vergeet een geladen blok.
  await crOpen(page);
  await page.click('#customRuleSample');
  await page.click('#ruleBuilderLoad');
  await page.click('#ruleBuilderReset');
  eq(await page.inputValue('.bld-title'), '', 'de naam is leeg');
  eq((await bBlock(page)).id, 'custom-opeenvolgend', 'het tekstvak blijft staan');
  ok((await bSentence(page)).startsWith('Hier komt in gewone taal'), 'de uitleg staat er weer');
  await page.fill('#customRuleText', '');
  await page.fill('.bld-title', 'Vers');
  eq((await bBlock(page)).id, 'custom-vers', 'na opnieuw beginnen is het een nieuwe regel (niet de geladen id)');
  noErrors(page);
});

// ---- De instructie voor Claude ----
test('instructie voor Claude: kopiëren, en een antwoord met tekst eromheen plakken', async () => {
  const page = await open({ width: 420, height: 900 }, { permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await crOpen(page);
    ok(await page.isHidden('#customPromptOut'), 'het vak met de instructie staat al open');
    await page.fill('#customWish', 'twee Vrouwen winnen samen van een Heer');
    await page.click('#customPromptCopy');
    await page.waitForFunction(() => document.getElementById('customPromptStatus').textContent.startsWith('Gekopieerd'));
    const shown = await page.inputValue('#customPromptOut');
    ok(shown.includes('Mijn regel:\ntwee Vrouwen winnen samen van een Heer') && shown.includes('"winnerOpened"') && shown.includes('custom-opeenvolgend'), 'de instructie staat in het vak');
    eq(await page.evaluate(() => navigator.clipboard.readText()), shown, 'het klembord bevat de instructie');
    ok(await page.isVisible('#customPromptOut'), 'het vak met de instructie is zichtbaar');
    // Een antwoord zoals een taalmodel het geeft: tekst, een codeblok, en nog wat tekst.
    const sample = await crSample(page);
    await page.fill('#customRuleText', 'Hier is je regel:\n\n```json\n' + JSON.stringify(sample, null, 2) + '\n```\n\nVeel plezier!');
    await page.click('#customRuleCheck');
    eq((await crMessages(page))[0], '✓ De regel klopt.', 'het blok uit het antwoord klopt');
    eq(await bBlock(page), sample, 'alleen het blok blijft in het tekstvak staan');
    // Een antwoord zonder blok (het model legt uit dat het niet kan) geeft een gewone melding en blijft staan.
    await page.fill('#customRuleText', 'Dit kan niet met de bouwstenen: er is geen geheugen over rondes.');
    await page.click('#customRuleCheck');
    ok((await crMessages(page))[0].startsWith('✗ Het spel kan deze tekst niet lezen'), 'melding bij een antwoord zonder blok');
    eq(await page.inputValue('#customRuleText'), 'Dit kan niet met de bouwstenen: er is geen geheugen over rondes.', 'het antwoord blijft staan');
    noErrors(page);
  } finally { await page.ctx.close(); }
});

test('instructie voor Claude: als kopiëren niet mag, staat de tekst klaar om zelf te kopiëren', async page => {
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('nee')) }, configurable: true }); });
  await crOpen(page);
  await page.click('#customPromptCopy');
  await page.waitForFunction(() => document.getElementById('customPromptStatus').textContent.startsWith('Kopiëren lukte niet'));
  eq(await page.evaluate(() => document.activeElement.id), 'customPromptOut', 'de focus staat op de tekst');
  const sel = await page.evaluate(() => { const t = document.getElementById('customPromptOut'); return [t.selectionStart, t.selectionEnd === t.value.length, t.value.includes('(vul hier in wat de regel moet doen)')]; });
  eq(sel, [0, true, true], 'de hele tekst is geselecteerd, met een invulregel voor de wens');
  // Zonder klembord in de browser hetzelfde.
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); document.getElementById('customPromptStatus').textContent = ''; });
  await page.click('#customPromptCopy');
  ok((await text(page, '#customPromptStatus')).startsWith('Kopiëren lukte niet'), 'melding zonder klembord');
  noErrors(page);
});

// ---- Namen en uitleg op het startscherm ----
test('startscherm: het vinkje heet als de regel in het regelboek, en de i-knop toont de uitleg zonder het vinkje aan te zetten', async page => {
  const names = await page.$$eval('#rulesList label.rule-check > span:not(.rule-by)', x => x.map(e => e.textContent));
  const book = await page.evaluate(() => RULES.map(r => r.title));
  eq(names, book, 'namen bij de vinkjes');
  eq(await page.locator('#rulesList .rule-info-btn').count(), book.length, 'een i-knop per regel');
  const before = await page.isChecked('#battleDiscardInput');
  await page.click('#battleDiscardInfo');
  ok(await page.isVisible('#battleDiscardInfoText'), 'de uitleg staat open na klikken op de i');
  eq(await page.getAttribute('#battleDiscardInfo', 'aria-expanded'), 'true', 'aria-expanded open');
  eq(await page.isChecked('#battleDiscardInput'), before, 'de i-knop zet het vinkje niet aan');
  eq(await text(page, '#battleDiscardInfoText'), await page.evaluate(() => RULES.find(r => r.id === 'battleDiscard').description), 'de volledige uitleg');
  await page.click('#battleDiscardInfo');
  ok(!(await page.isVisible('#battleDiscardInfoText')), 'de uitleg klapt weer dicht');
  await page.click('#battleDiscardInput + span');
  eq(await page.isChecked('#battleDiscardInput'), !before, 'klikken op de naam zet het vinkje wel aan');
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
