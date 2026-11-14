// Stap terug: een paar rondes terug in het lopende spel, bijvoorbeeld om een battle nog eens te spelen.
// Aan het begin van elke ronde (en voor het doorspoelen) bewaart het spel een kopie van de stand; "↩" zet de laatste kopie terug.
// Er blijven er ten hoogste UNDO_MAX bewaard (de laatste tien rondes). Een nieuw spel begint met een lege lijst.
//
// Wat er mee terug gaat: de spelstand (stapels, aflegstapel, tellers), de lijst met eerder geziene standen voor de cyclusmelding
// (anders zou een stand die je opnieuw speelt als cyclus gelden) en de statistieken. Het spel ligt na het delen vast, dus opnieuw
// spelen geeft dezelfde standen. Midden in een ronde terug gaat naar het begin van die ronde; na het einde van het spel
// kun je de laatste ronde nog eens spelen.
const UNDO_MAX = 10;
let undoStack = [];
const undoBtn = document.getElementById('undoBtn');

function updateUndoButton(){
  undoBtn.disabled = undoStack.length === 0;
}

function undoReset(){
  undoStack = [];
  updateUndoButton();
}

// Een diepe kopie van de stand op een ronde-grens: zoals clearBoard het tafelblad leegt (geen open kaarten, lege pot).
function undoPush(){
  const copy = JSON.parse(JSON.stringify(game));
  copy.pot = [];
  copy.opening = {};
  copy.contenders = [];
  copy.battleLevel = 0;
  copy.players.forEach(p => { p.faceCard = null; });
  undoStack.push({ game: copy, visited: visitedLog.length, stats: typeof statsSnapshot === 'function' ? statsSnapshot() : null });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  updateUndoButton();
}

function undoStep(){
  const snap = undoStack.pop();
  if (!snap) return;
  stopAutoPlay();
  game = snap.game;
  while (visitedLog.length > snap.visited) visitedStates.delete(visitedLog.pop());
  if (snap.stats && typeof statsRestore === 'function') statsRestore(snap.stats);
  document.getElementById('endBanner').innerHTML = '';
  displayPot = 0;
  setPhase('cleared');
  renderGrid(true);
  setDispatch('Teruggezet naar het begin van een ronde. Speel de ronde opnieuw.');
}

undoBtn.addEventListener('click', undoStep);
