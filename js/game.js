// ---- Click-driven phase system ----
// Dit bestand regelt alleen wat je ziet en wanneer. De spelregels zelf staan in engine.js.
// phases: 'idle' -> 'revealed' -> 'battle-pending' -> 'battle-revealed' -> 'round-over' -> (back to 'idle' via next round) / 'game-over'
let phase = 'idle';
let displayPot = 0; // settled pot count shown to the user — only updates once a battle round is resolved

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
  game.pot = [];
  displayPot = 0;
  players.forEach(p => { p.faceCard = null; });
  renderGrid(true);
  setDispatch('Tafel opgeruimd. Klaar voor de volgende ronde.');
  phase = 'cleared';
  updateButtonLabel();
}

function startRound(){
  engineStartRound(game);
  displayPot = game.pot.length;
  renderGrid(false);
  setDispatch('Bekijk de kaarten en bepaal de winnaar.');
  phase = 'revealed';
  updateButtonLabel();
}

function layBattleCards(){
  const ev = engineLayBattleCards(game);
  if (ev.type === 'battle-revealed'){
    renderGrid(false);
    setDispatch('Bekijk de battle-kaarten en bepaal de winnaar.', true);
    phase = 'battle-revealed';
    updateButtonLabel();
    return;
  }
  showRoundResult(ev);
}

function compareAndResolve(){
  const ev = engineResolve(game);
  if (ev.type === 'battle'){
    if (typeof statsRecordBattle === 'function') statsRecordBattle(ev.level); // STATS HOOK
    displayPot = game.pot.length;
    const names = formatNamesNL(ev.contenders.map(p => p.name));
    if (ev.overruled && ev.overruled.length > 0){
      setDispatch(formatNamesNL(ev.overruled.map(p => p.name)) + ' had de winnende kaart, maar gelijke kaarten gaan voor. BATTLE tussen ' + names + '! Klik om battle-kaarten te leggen.', true);
    } else {
      setDispatch('BATTLE tussen ' + names + '! Klik om battle-kaarten te leggen.', true);
    }
    phase = 'battle-pending';
    updateButtonLabel();
    renderGrid(false);
    return;
  }
  showRoundResult(ev);
}

// De ronde is beslist: toon de winnaar (of, zeldzaam, dat niemand de pot kon winnen).
function showRoundResult(ev){
  displayPot = ev.potSize;
  if (ev.type !== 'win'){
    finalizeRoundOver();
    renderGrid(false);
    return;
  }
  const w = ev.winner;
  if (ev.how === 'last-standing'){
    showStamp('LAATSTE OVER', '#c9a227');
    setDispatch(w.name + ' is de laatste in de battle en wint ' + displayPot + ' kaarten!');
  } else {
    showStamp(ev.how === 'battle' ? 'BATTLE GEWONNEN' : 'OVERWINNING', '#c9a227');
    setDispatch(w.name + ' verovert ' + displayPot + ' kaarten!');
  }
  finalizeRoundOver();
  if (typeof statsRecordRoundWin === 'function') statsRecordRoundWin(w.id); // STATS HOOK
  renderGrid(false, players.map(p => p === w));
}

function finalizeRoundOver(){
  const end = engineEndRound(game);
  if (end.gameOver){
    endGame(end.winner);
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
