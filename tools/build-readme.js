// Maakt het regel-gedeelte van de README uit de catalogus in js/rules.js (RULES en BASE_RULES).
// Zo staat de uitleg van de regels niet op twee plekken die uit elkaar kunnen lopen.
//
//   node tools/build-readme.js            schrijft het gedeelte tussen de markeringen in README.md
//   node tools/build-readme.js --check    schrijft niets; stopt met een foutmelding als README.md niet klopt
//   node tools/build-readme.js [map]      gebruikt README.md en js/ uit een andere map (voor de test)
//
// Alleen wat tussen <!-- REGELS:BEGIN --> en <!-- REGELS:EINDE --> staat wordt gemaakt of gecontroleerd.
// De rest van de README is handwerk. Geen externe pakketten nodig.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BEGIN = '<!-- REGELS:BEGIN -->';
const EINDE = '<!-- REGELS:EINDE -->';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const root = path.resolve(args.find(a => !a.startsWith('--')) || path.join(__dirname, '..'));
const readmeFile = path.join(root, 'README.md');

// ---- regels laden (dezelfde bestanden als de browser, zonder pagina) ----
function loadCatalogue(){
  const ctx = vm.createContext({ console, Math, JSON, Set, Map, Array, Object });
  for (const f of ['js/cards.js', 'js/rules.js']){
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  // Functies (decide, overruledMessage) vallen bij JSON weg; alleen de gegevens zijn nodig.
  return JSON.parse(vm.runInContext(
    "JSON.stringify({ rules: RULES.map(r => Object.assign({ hasDecide: typeof r.decide === 'function' }, r)), base: BASE_RULES })", ctx));
}

// ---- markdown ----
// Teksten uit de catalogus zijn gewone zinnen; tekens met een markdown-betekenis worden onschadelijk gemaakt.
const md = text => text.replace(/[\\`*_<]/g, c => '\\' + c);
// Titel met een punt erachter, behalve als er al een leesteken staat ("Wie wint een ronde?").
const titleDot = title => md(title) + (/[.!?:]$/.test(title) ? '' : '.');

function exampleLine(ex, rules){
  if (Array.isArray(ex.decks)){ // scenario: stapels vóór en na een ronde
    const decks = list => list.map(d => d.length ? d.join(' ') : 'uit').join(' · ');
    const withText = (ex.with || []).map(id => '"' + md((rules.find(r => r.id === id) || { title: id }).title) + '"');
    return '  - Voorbeeld: stapels `' + decks(ex.decks) + '`' + (withText.length ? ' (met ' + withText.join(' en ') + ' aan)' : '') +
      ' worden na één ronde `' + decks(ex.after) + '`, met ' + ex.discarded + (ex.discarded === 1 ? ' kaart' : ' kaarten') +
      ' op de aflegstapel – ' + md(ex.text);
  }
  const cards = '`' + ex.cards.join(' · ') + '`';
  const extra = (ex.with || []).map(id => '"' + md((rules.find(r => r.id === id) || { title: id }).title) + '"');
  return '  - Voorbeeld: ' + cards + (extra.length ? ' (met ' + extra.join(' en ') + ' aan)' : '') + ' – ' + md(ex.text);
}

function buildBlock({ rules, base }){
  const out = [];
  out.push(BEGIN);
  out.push('<!-- Dit deel is automatisch gemaakt uit js/rules.js met `node tools/build-readme.js`. Niet met de hand aanpassen. -->');
  out.push('');
  out.push('## Spelregels');
  out.push('');
  out.push('### Basisregels');
  out.push('');
  out.push('Bij een voorbeeld staan de open kaarten in de volgorde van de spelers (speler 1, speler 2, enzovoort). ' +
    'Bij een voorbeeld met stapels staat van elke speler de bovenste kaart voorop.');
  out.push('');
  for (const section of base){
    out.push('- **' + titleDot(section.title) + '** ' + md(section.description));
    for (const ex of section.examples || []) out.push(exampleLine(ex, rules));
  }
  out.push('');
  out.push('### Extra regels');
  out.push('');
  out.push('Extra regels zijn optioneel en aan te vinken bij het starten van een spel.');
  out.push('');
  for (const rule of rules){
    out.push('- **' + md(rule.title) + '** (standaard ' + (rule.default ? 'aan' : 'uit') + '). ' + md(rule.description));
    for (const ex of rule.examples || []) out.push(exampleLine(ex, rules));
  }
  out.push('');
  out.push('### Volgorde bij botsingen');
  out.push('');
  out.push('Staan er meer extra regels aan, dan beslist de eerste regel in deze lijst die iets te zeggen heeft. ' +
    'Heeft geen enkele regel iets te zeggen, dan wint de hoogste kaart.');
  out.push('');
  rules.filter(r => r.hasDecide).sort((a, b) => a.priority - b.priority).forEach((r, i) => out.push((i + 1) + '. ' + md(r.title)));
  out.push('');
  out.push('Dezelfde uitleg staat in het spel zelf, onder de knop **📖 Spelregels**.');
  out.push(EINDE);
  return out.join('\n');
}

// ---- README bijwerken of controleren ----
function fail(code, message){
  console.error(message);
  process.exit(code);
}

let readme;
try { readme = fs.readFileSync(readmeFile, 'utf8'); }
catch (e){ fail(2, 'README.md niet gevonden in ' + root); }
const text = readme.replace(/\r\n/g, '\n'); // CRLF (Windows) mag geen verschil geven

const start = text.indexOf(BEGIN);
const end = text.indexOf(EINDE);
if (start === -1 || end === -1 || end < start || text.indexOf(BEGIN, start + 1) !== -1 || text.indexOf(EINDE, end + 1) !== -1){
  fail(2, 'README.md moet precies één keer ' + BEGIN + ' en daarna ' + EINDE + ' bevatten. Zet die twee regels om het regel-gedeelte.');
}

const wanted = buildBlock(loadCatalogue());
const current = text.slice(start, end + EINDE.length);

if (checkOnly){
  if (current === wanted){
    console.log('README.md klopt met de regels in js/rules.js.');
    process.exit(0);
  }
  const a = current.split('\n'), b = wanted.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  fail(1, 'README.md klopt niet met de regels in js/rules.js.\n' +
    '  Eerste verschil op regel ' + (i + 1) + ' van het regel-gedeelte:\n' +
    '    README.md: ' + (a[i] === undefined ? '(einde)' : a[i].slice(0, 140)) + '\n' +
    '    verwacht:  ' + (b[i] === undefined ? '(einde)' : b[i].slice(0, 140)) + '\n' +
    '  Oplossing: draai `node tools/build-readme.js` en neem de wijziging in README.md mee.\n' +
    '  Pas het regel-gedeelte van de README niet met de hand aan: wijzig js/rules.js.');
}

if (current === wanted){
  console.log('README.md was al bijgewerkt.');
} else {
  fs.writeFileSync(readmeFile, text.slice(0, start) + wanted + text.slice(end + EINDE.length));
  console.log('README.md bijgewerkt.');
}
