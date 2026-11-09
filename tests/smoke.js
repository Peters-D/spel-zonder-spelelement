// Rooktest zonder browser en zonder externe pakketten: node tests/smoke.js [map] [--update] [--serial]
//
// De test duurt lang genoeg om hem te verdelen: dit bestand start een kopie van tests/smoke-run.js per processorkern (ten hoogste 4),
// elk met een deel van de zware onderdelen, en voegt de uitkomsten samen. Wat de test controleert staat in tests/smoke-run.js.
//   --update   schrijft tests/expected.json opnieuw (draait in één proces)
//   --serial   draait alles in één proces (handig om te zoeken waar iets misgaat)
// Wijzig je bewust een spelregel? Draai dan `node tests/smoke.js --update` en bekijk in de pull request het verschil in
// tests/expected.json: dat is precies wat de regel verandert.
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const report = require('./smoke-report');

const args = process.argv.slice(2);
const single = args.includes('--update') || args.includes('--serial');
const count = single ? 1 : Math.max(1, Math.min(4, os.cpus().length));
const script = path.join(__dirname, 'smoke-run.js');
const passthrough = args.filter(a => a !== '--serial');

const results = [];
let pending = count;
for (let i = 0; i < count; i++){
  const child = spawn(process.execPath, [script, ...passthrough, '--shard=' + i + '/' + count], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  child.on('close', code => {
    results[i] = { code, out, err };
    if (--pending === 0) finish();
  });
}

function finish(){
  const parsed = [];
  let crashed = false;
  for (const [i, r] of results.entries()){
    const line = r.out.split('\n').find(l => l.startsWith('@@SMOKE@@'));
    if (line){ parsed.push(JSON.parse(line.slice('@@SMOKE@@'.length))); continue; }
    // Geen uitkomst: bijvoorbeeld --update (die meldt zelf wat hij deed) of een crash.
    process.stdout.write(r.out);
    process.stderr.write(r.err);
    if (r.code !== 0){ crashed = true; console.error('smoke-run.js (deel ' + i + ' van ' + count + ') stopte met code ' + r.code); }
  }
  if (crashed) process.exit(1);
  if (parsed.length === 0) process.exit(0); // --update
  const failures = parsed.flatMap(p => p.failures);
  console.log(report.summaryLine(report.sumCounts(parsed.map(p => p.counts))));
  if (failures.length){
    console.error(report.failureText(failures));
    process.exit(1);
  }
  console.log('Alles in orde.');
}
