// ---- Click-driven phase system ----
// Dit bestand regelt alleen wat je ziet en wanneer. De spelregels zelf staan in engine.js.
// phases: 'idle' -> 'revealed' -> 'battle-pending' -> 'battle-revealed' -> 'round-over' -> (back to 'idle' via next round) / 'game-over'
let phase = 'idle';
let displayPot = 0; // settled pot count shown to the user — only updates once a battle round is resolved

const playBtn = document.getElementById('playBtn');

// De enige plek waar de fase verandert. De knoppen volgen meteen, zodat ze nooit bij een andere fase horen dan die het spel heeft.
function setPhase(next){
  phase = next;
  updateButtonLabel();
}

function updateButtonLabel(){
  if (phase === 'idle') playBtn.textContent = 'Speel ronde';
  else if (phase === 'revealed') playBtn.textContent = 'Bepaal winnaar';
  else if (phase === 'battle-pending') playBtn.textContent = 'Leg battle-kaarten';
  else if (phase === 'battle-revealed') playBtn.textContent = 'Bepaal winnaar';
  else if (phase === 'round-over') playBtn.textContent = 'Ruim tafel op';
  else if (phase === 'cleared') playBtn.textContent = 'Speel ronde';
  playBtn.disabled = (phase === 'game-over' || phase === 'cycle-over');
  fastForwardBtn.disabled = !(phase === 'idle' || phase === 'round-over' || phase === 'cleared');
  if (typeof updateUndoButton === 'function') updateUndoButton();
}

function clearBoard(){
  game.pot = [];
  displayPot = 0;
  game.players.forEach(p => { p.faceCard = null; });
  renderGrid(true);
  setDispatch('Tafel opgeruimd. Klaar voor de volgende ronde.');
  setPhase('cleared');
}

function startRound(){
  if (typeof undoPush === 'function') undoPush(); // de stand aan het begin van de ronde, voor "stap terug"
  engineStartRound(game);
  displayPot = game.pot.length;
  renderGrid(false);
  setDispatch('Bekijk de kaarten en bepaal de winnaar.');
  setPhase('revealed');
}

function layBattleCards(){
  const ev = engineLayBattleCards(game);
  if (ev.type === 'battle-revealed'){
    renderGrid(false);
    setDispatch('Bekijk de battle-kaarten en bepaal de winnaar.', true);
    setPhase('battle-revealed');
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
    const rule = ev.ruleId ? RULES.find(r => r.id === ev.ruleId) : null;
    if (ev.overruled && ev.overruled.length > 0 && rule && rule.overruledMessage){
      setDispatch(rule.overruledMessage(formatNamesNL(ev.overruled.map(p => p.name))) + ' BATTLE tussen ' + names + '! Klik om battle-kaarten te leggen.', true);
    } else {
      setDispatch('BATTLE tussen ' + names + '! Klik om battle-kaarten te leggen.', true);
    }
    setPhase('battle-pending');
    renderGrid(false);
    return;
  }
  showRoundResult(ev);
}

// De ronde is beslist: toon de winnaar (of, zeldzaam, dat niemand de pot kon winnen).
// "Speler 2 geeft 1 kaart aan Speler 3." (leeg als er niets is overgedragen).
function transferNote(list){
  if (!list || list.length === 0) return '';
  return list.map(t => t.from.name + ' geeft ' + t.count + (t.count === 1 ? ' kaart' : ' kaarten') + ' aan ' + t.to.name + '.').join(' ');
}

// Wat regels met kaarten tussen spelers deden (overdrachten en spelers die weer meedoen), voor de tekst van het spel.
function playerNotes(ev){
  return [transferNote(ev.transfers), revivedNote(ev.revived)].filter(Boolean).join(' ');
}

// "Speler 3 doet weer mee." (leeg als er niemand terug is).
function revivedNote(list){
  if (!list || list.length === 0) return '';
  return formatNamesNL(list.map(p => p.name)) + (list.length > 1 ? ' doen' : ' doet') + ' weer mee.';
}

function showRoundResult(ev){
  displayPot = ev.potSize;
  if (ev.type !== 'win'){
    const text = [ev.discarded > 0 ? ev.discarded + ' kaarten gaan naar de aflegstapel.' : '', playerNotes(ev)].filter(Boolean).join(' ');
    if (text) setDispatch(text);
    finalizeRoundOver();
    renderGrid(false);
    return;
  }
  const w = ev.winner;
  // Winnen er meer spelers samen (een regel die de pot deelt), dan staan zij in ev.shared.
  const sharedWinners = ev.shared && ev.shared.length > 0 ? ev.shared : null;
  const sharedText = sharedWinners
    ? formatNamesNL(sharedWinners.map(x => x.player.name)) + ' winnen samen: ' +
      sharedWinners.map(x => x.player.name + ' krijgt ' + x.count + (x.count === 1 ? ' kaart' : ' kaarten')).join(', ') + '.'
    : null;
  // Zonder afgelegde kaarten zijn de teksten gelijk aan voorheen.
  const outcome = sharedText ? sharedText : ev.discarded === 0 ? null
    : ev.toWinner === 0 ? w.name + ' wint, maar alle ' + ev.potSize + ' kaarten gaan naar de aflegstapel.'
    : w.name + ' verovert ' + ev.toWinner + ' van de ' + ev.potSize + ' kaarten. De rest (' + ev.discarded + ') gaat naar de aflegstapel.';
  if (ev.how === 'last-standing'){
    showStamp('LAATSTE OVER');
    setDispatch(outcome || w.name + ' is de laatste in de battle en wint ' + displayPot + ' kaarten!');
  } else {
    showStamp(sharedWinners ? 'SAMEN GEWONNEN' : ev.tieBroken ? 'SYMBOOL BESLIST' : ev.how === 'battle' ? 'BATTLE GEWONNEN' : 'OVERWINNING');
    setDispatch(outcome || w.name + ' verovert ' + displayPot + ' kaarten!');
  }
  if (ev.tieBroken){ // gelijke kaarten: het symbool besliste, er is geen battle
    document.getElementById('dispatch').textContent = w.name + ' wint op symbool (' + ev.tieBroken.suit + '). ' + document.getElementById('dispatch').textContent;
  }
  const more = playerNotes(ev);
  if (more) document.getElementById('dispatch').textContent += ' ' + more;
  finalizeRoundOver();
  const winnerIds = sharedWinners ? sharedWinners.map(x => x.player.id) : [w.id];
  if (typeof statsRecordRoundWin === 'function') statsRecordRoundWin(winnerIds.length > 1 ? winnerIds : w.id); // STATS HOOK
  renderGrid(false, game.players.map(p => winnerIds.includes(p.id)));
}

function finalizeRoundOver(){
  const end = engineEndRound(game);
  // Berichten over wat regels aan het einde van de ronde deden (zonder zulke regels verandert er niets).
  const notes = [end.discarded > 0 ? end.discarded + ' kaarten gaan naar de aflegstapel.' : '', playerNotes(end)].filter(Boolean);
  if (notes.length) document.getElementById('dispatch').textContent += ' ' + notes.join(' ');
  if (end.gameOver){
    endGame(end.winner);
    setPhase('game-over');
    return;
  }
  if (checkLiveCycle()){
    endCycleDetected();
    setPhase('cycle-over');
    return;
  }
  setPhase('round-over');
}

// Zet een banner onder de titel. De tekst gaat als gewone tekst in de pagina (nooit als HTML), zodat een naam met HTML erin
// niets kan uitvoeren.
function showEndBanner(title, sub, extraClass){
  const banner = document.getElementById('endBanner');
  banner.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'end-banner' + (extraClass ? ' ' + extraClass : '');
  box.appendChild(document.createTextNode(title));
  box.appendChild(document.createElement('br'));
  const small = document.createElement('span');
  small.className = 'end-banner-sub';
  small.textContent = sub;
  box.appendChild(small);
  banner.appendChild(box);
}

function endGame(winner){
  if (winner) showEndBanner('★ ' + winner.name.toUpperCase() + ' WINT HET SPEL ★', 'Alle andere spelers hebben geen kaarten meer.');
  else showEndBanner('★ GELIJKSPEL ★', 'Niemand heeft nog kaarten.');
  if (winner) showWinnerRuleChoice(winner); // de winnaar zet één regel om voor het volgende spel (winner-rule.js)
}

function endCycleDetected(){
  showEndBanner('⚠ CYCLUS GEDETECTEERD ★', 'Deze spelstand kwam al eerder voor — het spel zou nooit eindigen. Onbeslist.', 'end-banner-warning');
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
