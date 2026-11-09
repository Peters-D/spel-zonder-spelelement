// De tekst na de rooktest, uit de tellers en de fouten. Gebruikt door tests/smoke.js (alle processen samen) en tests/smoke-run.js (los).
function sumCounts(list){
  const total = {};
  for (const c of list) for (const [k, v] of Object.entries(c)) total[k] = (total[k] || 0) + v;
  return total;
}

function summaryLine(c){
  return c.scripts + ' scripts geladen, ' + c.rules + ' regels + ' + c.base + ' basisregels in het regelboek (' + c.examples + ' voorbeelden getest), ' +
    c.cases + ' seeds gesimuleerd, ' + c.live + ' spellen live uitgespeeld, aflegstapel: ' + c.used +
    ' van 80 testspellen met afgelegde kaarten, ' + c.reviveGames + ' spellen waarin een speler terugkwam, ' + c.compared +
    ' spellen vergeleken (simulatie, zichtbaar spel, fast-forward), ' + c.midGame + ' keer fast-forward midden in een spel.';
}

function failureText(failures){
  return '\n' + failures.length + ' fout(en):\n' + failures.map(f => ' - ' + f).join('\n');
}

module.exports = { sumCounts, summaryLine, failureText };
