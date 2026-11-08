// Statistieken-module. Verwijder dit bestand, de <script> in index.html, het
// stats-blok in de HTML en css/stats.css om de functie te verwijderen.
let statsHistory = [];      // [{round, counts:{name: cardCount}}]
let statsWins = {};         // speler-id -> aantal rondes gewonnen
let statsTotalBattles = 0;  // aantal keer dat een battle is gestart
let statsLongestTie = 0;    // diepste aantal opeenvolgende battle-niveaus in één ronde
let statsRoundCount = 0;    // aantal afgeronde rondes (met een winnaar)

function statsColors(){
  return ['#c9a227','#a8402b','#6f8f6a','#7a92c9','#c97ab0','#8ac9c2','#c9895a','#9a9a9a'];
}

function statsResetAll(){
  statsHistory = [];
  statsWins = {};
  statsTotalBattles = 0;
  statsLongestTie = 0;
  statsRoundCount = 0;
  renderStatsPanel();
}

function statsRecordBattle(depth){
  statsTotalBattles++;
  statsLongestTie = Math.max(statsLongestTie, depth);
}

function statsRecordRoundWin(winnerId, countsOverride){
  statsWins[winnerId] = (statsWins[winnerId] || 0) + 1;
  statsRoundCount++;
  let counts = countsOverride;
  if (!counts){
    counts = {};
    players.forEach(p => { counts[p.id] = p.deck.length; });
  }
  statsHistory.push({ round: statsRoundCount, counts });
  renderStatsPanel();
}

function renderStatsChart(){
  const canvas = document.getElementById('statsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (statsHistory.length === 0){
    ctx.fillStyle = 'rgba(237,228,208,0.35)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Nog geen data — speel een ronde.', W/2, H/2);
    return;
  }
  const maxVal = 52;
  const padL = 24, padB = 20, padT = 8, padR = 8;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  ctx.strokeStyle = 'rgba(237,228,208,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();

  const colors = statsColors();
  players.forEach((p, idx) => {
    ctx.strokeStyle = colors[idx % colors.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    statsHistory.forEach((snap, i) => {
      const x = padL + (statsHistory.length === 1 ? 0 : (plotW * i / (statsHistory.length - 1)));
      const val = snap.counts[p.id] !== undefined ? snap.counts[p.id] : 0;
      const y = (H - padB) - (val / maxVal) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function renderStatsLegend(){
  const el = document.getElementById('statsLegend');
  if (!el) return;
  const colors = statsColors();
  el.innerHTML = players.map((p, i) =>
    '<span class="stats-legend-item"><span class="stats-dot" style="background:' + colors[i % colors.length] + '"></span>' + p.name + '</span>'
  ).join('');
}

function renderStatsSummary(){
  const el = document.getElementById('statsSummary');
  if (!el) return;
  let html = '<div class="stats-summary-item">Totaal battles: <strong>' + statsTotalBattles + '</strong></div>';
  html += '<div class="stats-summary-item">Langste tie-break: <strong>' + statsLongestTie + '</strong> ' + (statsLongestTie === 1 ? 'niveau' : 'niveaus') + '</div>';
  html += '<div class="stats-summary-item">Rondes gespeeld: <strong>' + statsRoundCount + '</strong></div>';
  players.forEach(p => {
    const wins = statsWins[p.id] || 0;
    const pct = statsRoundCount > 0 ? Math.round((wins / statsRoundCount) * 100) : 0;
    html += '<div class="stats-summary-item">' + p.name + ': <strong>' + pct + '%</strong> (' + wins + '/' + statsRoundCount + ')</div>';
  });
  el.innerHTML = html;
}

function renderStatsPanel(){
  renderStatsChart();
  renderStatsLegend();
  renderStatsSummary();
}

const statsToggleBtn = document.getElementById('statsToggleBtn');
if (statsToggleBtn){
  statsToggleBtn.addEventListener('click', () => {
    document.getElementById('statsPanel').classList.toggle('hidden');
    renderStatsPanel();
  });
}
