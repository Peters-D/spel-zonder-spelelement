// Test van tools/build-readme.js: node tests/readme-check.js
// Werkt op een kopie van README.md en js/ in een tijdelijke map; de echte bestanden worden niet aangepast.
// De controle van de echte README doet de CI apart met: node tools/build-readme.js --check
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'tools', 'build-readme.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-check-'));
fs.mkdirSync(path.join(tmp, 'js'));
const fresh = () => {
  fs.copyFileSync(path.join(repo, 'README.md'), path.join(tmp, 'README.md'));
  for (const f of ['cards.js', 'rules.js']) fs.copyFileSync(path.join(repo, 'js', f), path.join(tmp, 'js', f));
};
const run = (...a) => spawnSync(process.execPath, [script, tmp, ...a], { encoding: 'utf8' });
const read = f => fs.readFileSync(path.join(tmp, f), 'utf8');
const write = (f, t) => fs.writeFileSync(path.join(tmp, f), t);
const replaceOnce = (f, from, to) => {
  const t = read(f);
  if (!t.includes(from)) throw new Error('testopzet kapot: "' + from + '" staat niet in ' + f);
  write(f, t.replace(from, to));
};

const failures = [];
const expect = (name, cond, detail) => { if (!cond) failures.push(name + (detail ? ': ' + detail : '')); };

// 1. De README in de repo klopt met de catalogus.
fresh();
let r = run('--check');
expect('actuele README wordt goedgekeurd', r.status === 0, r.stderr || r.stdout);

// 2. Een regeltekst wijzigen zonder opnieuw te genereren: --check faalt en noemt de oplossing.
replaceOnce('js/rules.js', 'Liggen er zowel een 2 als een Aas', 'Liggen er zowel een 2 als een Heer');
r = run('--check');
expect('gewijzigde regeltekst zonder genereren faalt', r.status === 1, 'exit ' + r.status);
expect('foutmelding noemt de oplossing', /node tools\/build-readme\.js/.test(r.stderr), r.stderr);
expect('--check schrijft niets', read('README.md') === fs.readFileSync(path.join(repo, 'README.md'), 'utf8').replace(/\r\n/g, '\n'));

// 3. Genereren werkt, is stabiel (twee keer draaien geeft hetzelfde) en daarna slaagt --check.
r = run();
expect('genereren slaagt', r.status === 0, r.stderr);
expect('de nieuwe tekst staat in de README', read('README.md').includes('een 2 als een Heer'));
const once = read('README.md');
r = run();
expect('opnieuw genereren verandert niets', read('README.md') === once && /al bijgewerkt/.test(r.stdout));
expect('--check slaagt na genereren', run('--check').status === 0);
expect('de rest van de README is onaangetast', read('README.md').startsWith('# Spel zonder spelelement') && read('README.md').includes('## Online spelen'));

// 4. De README met de hand aanpassen in het regel-gedeelte: --check faalt.
fresh();
replaceOnce('README.md', '**Battle.**', '**Gevecht.**');
r = run('--check');
expect('handmatig aangepaste README faalt', r.status === 1, 'exit ' + r.status);

// 5. Markeringen ontbreken: aparte foutcode.
fresh();
replaceOnce('README.md', '<!-- REGELS:EINDE -->', '');
r = run('--check');
expect('ontbrekende markering geeft exit 2', r.status === 2, 'exit ' + r.status);
expect('foutmelding noemt de markeringen', /REGELS:BEGIN/.test(r.stderr), r.stderr);

// 6. Windows-regeleinden mogen geen verschil geven.
fresh();
write('README.md', read('README.md').replace(/\n/g, '\r\n'));
expect('CRLF-README wordt goedgekeurd', run('--check').status === 0);

// 7. Tekens met een markdown-betekenis in een regeltekst worden onschadelijk gemaakt.
fresh();
replaceOnce('js/rules.js', "title: '2 verslaat Aas',", "title: '2 *verslaat* Aas',");
r = run();
expect('genereren met speciale tekens slaagt', r.status === 0, r.stderr);
expect('sterretjes in een titel worden onschadelijk gemaakt', read('README.md').includes('2 \\*verslaat\\* Aas'));

// 8. Een titel die op een vraagteken eindigt krijgt geen extra punt.
fresh();
run();
expect('geen punt achter een vraagteken', read('README.md').includes('**Wie wint een ronde?**') && !read('README.md').includes('ronde?.'));

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length){
  console.error(failures.length + ' fout(en):\n' + failures.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('README-script: alle controles in orde.');
