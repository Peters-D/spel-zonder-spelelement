// ---- Click-driven phase system ----
// phases: 'idle' -> 'revealed' -> 'battle-pending' -> 'battle-revealed' -> 'round-over' -> (back to 'idle' via next round) / 'game-over'
let phase = 'idle';
let pot = [];
let displayPot = 0; // settled pot count shown to the user — only updates once a battle round is resolved
let contenders = [];
let warLevel = 0;

const playBtn = document.getElementById('playBtn');

function updateButtonLabel(){
  if (phase === 'idle') playBtn.textContent = 'Speel ronde';
  else if (phase === 'revealed') playBtn.textContent = 'Bepaal winnaar';
  else if (phase === 'battle-pending') playBtn.textContent = 'Leg battle-kaarten';
  else if (phase === 'battle-revealed') playBtn.textContent = 'Bepaal winnaar';
  else if (phase === 'round-over') playBtn.textContent = 'Ruim tafel op';
  else if (phase === 'cleared') playBtn.textContent = 'Speel ronde';
  playBtn.disabled = (phase === 'game-over' || phase === 'cycle-over');
  fastForwardBtn.disabled = !(phase === 'idle' || phase === 'round-over' || phase === 'cleared');
}

function clearBoard(){
  pot = [];
  displayPot = 0;
  players.forEach(p => { p.faceCard = null; });
  renderGrid(true);
  setDispatch('Tafel opgeruimd. Klaar voor de volgende ronde.');
  phase = 'cleared';
  updateButtonLabel();
}

function startRound(){
  pot = [];
  contenders = activePlayers().map(p => p.name);
  warLevel = 0;

  players.forEach(p => { if (!p.out) p.faceCard = p.deck.length ? p.deck.shift() : null; });
  players.forEach(p => { if (!p.out && p.faceCard) pot.push(p.faceCard); });
  displayPot = pot.length;
  renderGrid(false);
  setDispatch('Bekijk de kaarten en bepaal de winnaar.');
  phase = 'revealed';
  updateButtonLabel();
}

function layBattleCards(){
  const warriors = contenders.map(name => players.find(p => p.name === name));
  for (const w of warriors){
    if (w.deck.length >= 1){
      const up = w.deck.shift();
      pot.push(up);
      w.faceCard = up;
    } else {
      w.out = true;
      w.faceCard = null;
    }
  }
  renderGrid(false);
  contenders = contenders.filter(name => {
    const p = players.find(pp => pp.name === name);
    return p && !p.out;
  });

  if (contenders.length === 0){
    const alive = activePlayers();
    displayPot = pot.length;
    if (alive.length){ alive[0].deck.push(...pot); }
    pot = [];
    finalizeRoundOver();
    return;
  }
  if (contenders.length === 1){
    const w = players.find(p => p.name === contenders[0]);
    displayPot = pot.length;
    w.deck.push(...pot);
    pot = [];
    showStamp('LAATSTE OVER', '#c9a227');
    setDispatch(w.name + ' is de laatste in de battle en wint ' + displayPot + ' kaarten!');
    finalizeRoundOver();
    if (typeof statsRecordRoundWin === 'function') statsRecordRoundWin(w.name); // STATS HOOK
    renderGrid(false, players.map(p => p===w));
    return;
  }
  setDispatch('Bekijk de battle-kaarten en bepaal de winnaar.', true);
  phase = 'battle-revealed';
  updateButtonLabel();
}

function compareAndResolve(){
  const inPlay = players.filter(p => !p.out && contenders.includes(p.name) && p.faceCard);
  if (inPlay.length === 0){
    const alive = activePlayers();
    displayPot = pot.length;
    if (alive.length){ alive[0].deck.push(...pot); }
    pot = [];
    finalizeRoundOver();
    return;
  }
  const winners = findWinningPlayers(inPlay);

  if (winners.length === 1){
    const w = winners[0];
    displayPot = pot.length;
    w.deck.push(...pot);
    pot = [];
    showStamp(warLevel > 0 ? 'BATTLE GEWONNEN' : 'OVERWINNING', '#c9a227');
    setDispatch(w.name + ' verovert ' + displayPot + ' kaarten!');
    finalizeRoundOver();
    if (typeof statsRecordRoundWin === 'function') statsRecordRoundWin(w.name); // STATS HOOK
    renderGrid(false, players.map(p => p===w));
  } else {
    warLevel++;
    if (typeof statsRecordBattle === 'function') statsRecordBattle(warLevel); // STATS HOOK
    contenders = winners.map(p => p.name);
    displayPot = pot.length;
    setDispatch('BATTLE tussen ' + formatNamesNL(contenders) + '! Klik om battle-kaarten te leggen.', true);
    phase = 'battle-pending';
    updateButtonLabel();
    renderGrid(false);
  }
}

function finalizeRoundOver(){
  updateEliminations();
  const alive = activePlayers();
  if (alive.length <= 1){
    endGame(alive[0]);
    phase = 'game-over';
    updateButtonLabel();
    return;
  }
  if (checkLiveCycle()){
    endCycleDetected();
    phase = 'cycle-over';
    updateButtonLabel();
    return;
  }
  phase = 'round-over';
  updateButtonLabel();
}

function updateEliminations(){
  players.forEach(p => { if (p.deck.length === 0) p.out = true; });
}

function endGame(winner){
  const banner = document.getElementById('endBanner');
  if (winner){
    banner.innerHTML = '<div class="end-banner">★ ' + winner.name.toUpperCase() + ' WINT HET SPEL ★<br><span style="font-family:Inter;font-size:13px;">Alle andere spelers hebben geen kaarten meer.</span></div>';
  }
}

function endCycleDetected(){
  const banner = document.getElementById('endBanner');
  banner.innerHTML = '<div class="end-banner" style="background:rgba(168,64,43,0.15);color:var(--red);border-color:var(--red);">⚠ CYCLUS GEDETECTEERD ★<br><span style="font-family:Inter;font-size:13px;">Deze spelstand kwam al eerder voor — het spel zou nooit eindigen. Onbeslist.</span></div>';
  if (typeof stopAutoPlay === 'function' && autoPlayActive) stopAutoPlay();
}

function advance(){
  if (phase === 'idle') startRound();
  else if (phase === 'revealed') compareAndResolve();
  else if (phase === 'battle-pending') layBattleCards();
  else if (phase === 'battle-revealed') compareAndResolve();
  else if (phase === 'round-over') clearBoard();
  else if (phase === 'cleared') startRound();
}

playBtn.addEventListener('click', advance);
