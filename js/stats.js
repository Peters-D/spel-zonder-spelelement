// Statistieken-module. Verwijder dit bestand, de <script> in index.html, het
// stats-blok in de HTML en css/stats.css om de functie te verwijderen.
// De spelers van het lopende spel; vóór het eerste spel (het paneel wordt ook getekend bij een themawissel) zijn er geen.
function statsPlayers(){ return typeof game !== 'undefined' && game ? game.players : []; }
let statsHistory = [];      // [{round, counts:{name: cardCount}}]
let statsWins = {};         // speler-id -> aantal rondes gewonnen
let statsTotalBattles = 0;  // aantal keer dat een battle is gestart
let statsLongestTie = 0;    // diepste aantal opeenvolgende battle-niveaus in één ronde
let statsRoundCount = 0;    // aantal afgeronde rondes (met een winnaar)

// De kleuren komen uit het thema (css/themes.css). Zonder pagina (de test) is het resultaat leeg.
function statsThemeColor(name){
  return typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
}

function statsColors(){
  return [1, 2, 3, 4, 5, 6, 7, 8].map(i => statsThemeColor('--chart-' + i));
}

function statsResetAll(){
  statsHistory = [];
  statsWins = {};
  statsTotalBattles = 0;
  statsLongestTie = 0;
  statsRoundCount = 0;
  renderStatsPanel();
}

// De tellers van nu, om bij "stap terug" (undo.js) weer terug te zetten. De geschiedenis groeit alleen aan, dus de lengte is genoeg.
function statsSnapshot(){
  return { history: statsHistory.length, wins: Object.assign({}, statsWins), battles: statsTotalBattles, longest: statsLongestTie, rounds: statsRoundCount };
}

function statsRestore(s){
  statsHistory.length = s.history;
  statsWins = Object.assign({}, s.wins);
  statsTotalBattles = s.battles;
  statsLongestTie = s.longest;
  statsRoundCount = s.rounds;
  renderStatsPanel();
}

function statsRecordBattle(depth){
  statsTotalBattles++;
  statsLongestTie = Math.max(statsLongestTie, depth);
}

// winnerId is één speler-id, of een lijst met ids als meer spelers de ronde samen winnen (dan telt de ronde voor allemaal).
// statsAddRoundWin telt de ronde mee zonder het paneel te tekenen: het doorspoelen (controls.js) telt duizenden rondes mee en
// tekent het paneel daarna één keer. Zou het na elke ronde tekenen, dan kostte elke klik seconden (de grafiek tekent de hele geschiedenis).
function statsAddRoundWin(winnerId, countsOverride){
  for (const id of (Array.isArray(winnerId) ? winnerId : [winnerId])) statsWins[id] = (statsWins[id] || 0) + 1;
  statsRoundCount++;
  let counts = countsOverride;
  if (!counts){
    counts = {};
    statsPlayers().forEach(p => { counts[p.id] = p.deck.length; });
  }
  statsHistory.push({ round: statsRoundCount, counts });
}

function statsRecordRoundWin(winnerId, countsOverride){
  statsAddRoundWin(winnerId, countsOverride);
  renderStatsPanel();
}

function renderStatsChart(){
  const canvas = document.getElementById('statsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (statsHistory.length === 0){
    ctx.fillStyle = statsThemeColor('--chart-text');
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Nog geen data — speel een ronde.', W/2, H/2);
    return;
  }
  const maxVal = 52;
  const padL = 24, padB = 20, padT = 8, padR = 8;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  ctx.strokeStyle = statsThemeColor('--chart-grid');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();

  const colors = statsColors();
  statsPlayers().forEach((p, idx) => {
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

// Namen van spelers gaan als gewone tekst in de pagina (nooit als HTML), zodat een naam met HTML erin niets kan uitvoeren.
function renderStatsLegend(){
  const el = document.getElementById('statsLegend');
  if (!el) return;
  const colors = statsColors();
  el.innerHTML = '';
  statsPlayers().forEach((p, i) => {
    const item = document.createElement('span');
    item.className = 'stats-legend-item';
    const dot = document.createElement('span');
    dot.className = 'stats-dot';
    dot.style.background = colors[i % colors.length];
    item.appendChild(dot);
    item.appendChild(document.createTextNode(p.name));
    el.appendChild(item);
  });
}

// Eén regel van de samenvatting: tekst, een vetgedrukt stuk en eventueel tekst erna.
function statsLine(el, label, boldText, rest){
  const row = document.createElement('div');
  row.className = 'stats-summary-item';
  row.appendChild(document.createTextNode(label));
  const strong = document.createElement('strong');
  strong.textContent = boldText;
  row.appendChild(strong);
  if (rest) row.appendChild(document.createTextNode(rest));
  el.appendChild(row);
}

function renderStatsSummary(){
  const el = document.getElementById('statsSummary');
  if (!el) return;
  el.innerHTML = '';
  statsLine(el, 'Totaal battles: ', String(statsTotalBattles));
  statsLine(el, 'Langste tie-break: ', String(statsLongestTie), ' ' + (statsLongestTie === 1 ? 'niveau' : 'niveaus'));
  statsLine(el, 'Rondes gespeeld: ', String(statsRoundCount));
  statsPlayers().forEach(p => {
    const wins = statsWins[p.id] || 0;
    const pct = statsRoundCount > 0 ? Math.round((wins / statsRoundCount) * 100) : 0;
    statsLine(el, p.name + ': ', pct + '%', ' (' + wins + '/' + statsRoundCount + ')');
  });
}

// Tekent het paneel alleen als het open staat: dicht ziet niemand het, en de grafiek tekent elke keer de hele geschiedenis.
// Bij het openen (de knop hieronder) wordt het bijgewerkt.
function renderStatsPanel(){
  const panel = document.getElementById('statsPanel');
  if (panel && panel.classList.contains('hidden')) return;
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
