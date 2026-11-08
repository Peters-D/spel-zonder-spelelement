// Instelscherm: spelers, namen, seed, delen en starten.
let numPlayers = 4;
let game = null;   // spelstand van de spelkern (zie engine.js)
let players = []; // = game.players: [{id, name, deck: [], out: false, faceCard: null}]

const countGrid = document.getElementById('countGrid');
const namesList = document.getElementById('namesList');
for (let n=2;n<=8;n++){
  const b = document.createElement('button');
  b.className = 'count-btn' + (n===4 ? ' active' : '');
  b.textContent = n;
  b.addEventListener('click', () => {
    numPlayers = n;
    document.querySelectorAll('.count-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    renderNameInputs();
  });
  countGrid.appendChild(b);
}

function renderNameInputs(){
  namesList.innerHTML = '';
  for (let i=0;i<numPlayers;i++){
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Speler ' + (i+1);
    inp.maxLength = 14;
    inp.dataset.idx = i;
    namesList.appendChild(inp);
  }
}
renderNameInputs();

// ===== Spel starten (met cyclus-precheck) =====

function dealNewGame(){
  const seedValue = document.getElementById('seedInput').value.trim();
  rng = seedValue ? mulberry32(hashSeed(seedValue)) : Math.random;
  const rules = Object.assign({}, DEFAULT_RULES, {
    twoBeatsAce: document.getElementById('twoBeatsAceInput').checked,
    battleFirst: document.getElementById('battleFirstInput').checked
  });
  const inputs = namesList.querySelectorAll('input');
  const deck = shuffle(buildDeck());
  const dealt = [];
  for (let i=0;i<numPlayers;i++){
    const nm = inputs[i].value.trim() || ('Speler ' + (i+1));
    dealt.push({ id: i, name: nm, deck: [] });
  }
  let idx = 0;
  while (deck.length){
    dealt[idx % numPlayers].deck.push(deck.pop());
    idx++;
  }
  game = createGameState(dealt, rules);
  players = game.players;
}

function launchGame(){
  document.getElementById('cycleWarning').classList.add('hidden');
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('endBanner').innerHTML = '';
  visitedStates = new Set();
  visitedStates.add(stateSignature(players));
  phase = 'idle';
  displayPot = 0; // pot-teller van een vorig spel niet meenemen
  updateButtonLabel();
  setDispatch('Klaar om te beginnen. Speel een ronde.');
  renderGrid(true);
  if (typeof statsResetAll === 'function') statsResetAll(); // STATS HOOK
}

document.getElementById('startBtn').addEventListener('click', () => {
  dealNewGame();
  const result = simulateOutcome(players, game.rules);
  if (result.outcome === 'cycle' || result.outcome === 'unknown'){
    const text = result.outcome === 'cycle'
      ? 'Deze indeling loopt na ' + result.rounds + ' rondes in een cyclus — het spel zou nooit eindigen.'
      : 'Geen winnaar gevonden binnen ' + result.rounds + ' rondes — waarschijnlijk een (zeer lange) cyclus.';
    document.getElementById('cycleWarningText').textContent = text;
    document.getElementById('cycleWarning').classList.remove('hidden');
  } else {
    launchGame();
  }
});

document.getElementById('cycleProceedBtn').addEventListener('click', () => {
  launchGame();
});

document.getElementById('cycleNewSeedBtn').addEventListener('click', () => {
  document.getElementById('cycleWarning').classList.add('hidden');
  const seedInput = document.getElementById('seedInput');
  seedInput.focus();
  seedInput.select();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  stopAutoPlay();
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('game').classList.add('hidden');
});
