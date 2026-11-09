// ---- Auto-play ----
let autoPlayActive = false;
let autoPlayTimer = null;
let autoPlaySpeed = 800;

const autoPlayBtn = document.getElementById('autoPlayBtn');
const speedSlider = document.getElementById('speedSlider');
const speedLabel = document.getElementById('speedLabel');

speedSlider.addEventListener('input', () => {
  autoPlaySpeed = parseInt(speedSlider.value);
  speedLabel.textContent = autoPlaySpeed + ' ms';
});

function autoPlayTick(){
  if (!autoPlayActive) return;
  if (phase === 'game-over' || phase === 'cycle-over'){
    stopAutoPlay();
    return;
  }
  advance();
  autoPlayTimer = setTimeout(autoPlayTick, autoPlaySpeed);
}

function startAutoPlay(){
  autoPlayActive = true;
  autoPlayBtn.textContent = '⏸ Pauzeer';
  autoPlayBtn.classList.add('active');
  playBtn.disabled = true;
  autoPlayTick();
}

function stopAutoPlay(){
  autoPlayActive = false;
  if (autoPlayTimer) clearTimeout(autoPlayTimer);
  autoPlayTimer = null;
  autoPlayBtn.textContent = '▶ Auto-play';
  autoPlayBtn.classList.remove('active');
  if (phase !== 'game-over' && phase !== 'cycle-over') playBtn.disabled = false;
}

autoPlayBtn.addEventListener('click', () => {
  if (autoPlayActive) stopAutoPlay(); else startAutoPlay();
});

// ===== FAST-FORWARD =====
const fastForwardBtn = document.getElementById('fastForwardBtn');

function fastForward(){
  if (!(phase === 'idle' || phase === 'round-over' || phase === 'cleared')) return;
  stopAutoPlay();
  if (typeof undoPush === 'function') undoPush(); // het doorspoelen telt als één stap terug

  const result = simulateFullTrace(players, SIM_ROUND_CAP, game.rules, { discard: game.discard, moved: game.moved });

  // Speel de volledige trace na in de statistieken, ronde voor ronde.
  result.trace.forEach(entry => {
    if (entry.type === 'battle'){
      if (typeof statsRecordBattle === 'function') statsRecordBattle(entry.depth); // STATS HOOK
    } else if (entry.type === 'win'){
      if (typeof statsRecordRoundWin === 'function') statsRecordRoundWin(entry.winnerIds || entry.winnerId, entry.counts); // STATS HOOK
    }
  });

  // Pas de eindstand toe op het echte spel.
  result.finalPlayers.forEach((sp, i) => {
    players[i].deck = sp.deck;
    players[i].out = sp.out;
    players[i].faceCard = null;
  });
  game.pot = [];
  game.discard = result.finalDiscard;
  game.moved = result.finalMoved;
  displayPot = 0;

  if (result.outcome === 'win'){
    const winnerObj = players.find(p => p.id === result.winnerId);
    endGame(winnerObj);
    phase = 'game-over';
  } else if (result.outcome === 'cycle'){
    endCycleDetected();
    phase = 'cycle-over';
  } else {
    setDispatch('Fast-forward gestopt na ' + result.rounds + ' rondes zonder winnaar.');
    phase = 'round-over';
  }
  updateButtonLabel();
  renderGrid(true);
}

fastForwardBtn.addEventListener('click', fastForward);
