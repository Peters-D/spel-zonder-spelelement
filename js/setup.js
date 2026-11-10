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

// Eén vinkje per extra regel, opgebouwd uit de catalogus (RULES in rules.js). Heeft een winnaar een regel omgezet
// (zie winner-rule.js), dan is dat de stand van het vinkje, met "gekozen door ..." erachter.
const ruleChoiceInputs = {}, ruleChoiceLabels = {}, ruleChoiceNotes = {};
function renderRuleOptions(){
  const list = document.getElementById('rulesList');
  list.innerHTML = '';
  const chosen = loadWinnerRules();
  for (const k of Object.keys(ruleChoiceNotes)) delete ruleChoiceNotes[k];
  for (const rule of RULES){
    const label = document.createElement('label');
    label.className = 'rule-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = rule.id + 'Input';
    input.checked = chosen[rule.id] ? chosen[rule.id].on : rule.default;
    input.setAttribute('autocomplete', 'off'); // de browser zet vinkjes niet zelf terug bij verversen: alleen de bewaarde winnaarskeuzes tellen
    const text = document.createElement('span');
    text.textContent = rule.short;
    label.appendChild(input);
    label.appendChild(text);
    list.appendChild(label);
    ruleChoiceInputs[rule.id] = input;
    ruleChoiceLabels[rule.id] = label;
    if (chosen[rule.id] && chosen[rule.id].by) markRuleNote(rule.id, chosen[rule.id].by);
  }
}

// Zet "gekozen door ..." achter het vinkje van een regel (alleen tekst).
function markRuleNote(ruleId, byName){
  let note = ruleChoiceNotes[ruleId];
  if (!note){
    note = document.createElement('span');
    note.className = 'rule-by';
    ruleChoiceLabels[ruleId].appendChild(note);
    ruleChoiceNotes[ruleId] = note;
  }
  note.textContent = '(gekozen door ' + byName + ')';
}

// Een winnaar zette een regel om: het vinkje op het startscherm volgt, de andere vinkjes blijven zoals ze staan.
function markRuleChoice(ruleId, on, byName){
  if (!ruleChoiceInputs[ruleId]) return;
  ruleChoiceInputs[ruleId].checked = on;
  if (byName) markRuleNote(ruleId, byName);
}
renderRuleOptions();

// ===== Spel starten (met cyclus-precheck) =====

function dealNewGame(){
  const seedValue = document.getElementById('seedInput').value.trim();
  rng = seedValue ? mulberry32(hashSeed(seedValue)) : Math.random;
  const rules = Object.assign({}, DEFAULT_RULES);
  for (const rule of RULES) rules[rule.id] = document.getElementById(rule.id + 'Input').checked;
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
  game.seed = seedValue || null; // de gebruikte seed, om te tonen (null = willekeurig spel)
  players = game.players;
}

function launchGame(){
  document.getElementById('cycleWarning').classList.add('hidden');
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('endBanner').innerHTML = '';
  document.getElementById('seedLine').textContent = game.seed ? 'Seed: ' + game.seed : 'Seed: geen (willekeurig spel)';
  visitedStates = new Set();
  visitedStates.add(stateSignature(players, game.discard));
  visitedLog = [stateSignature(players, game.discard)];
  if (typeof undoReset === 'function') undoReset(); // een nieuw spel begint zonder geschiedenis
  phase = 'idle';
  displayPot = 0; // pot-teller van een vorig spel niet meenemen
  updateButtonLabel();
  setDispatch('Klaar om te beginnen. Speel een ronde.');
  renderGrid(true);
  if (typeof statsResetAll === 'function') statsResetAll(); // STATS HOOK
}

// De melding dat dit spel waarschijnlijk nooit eindigt. Hij staat onder de startknop en kan op een smal scherm buiten beeld
// vallen; dan lijkt de knop niets te doen. Daarom scrollt de pagina hem in beeld.
function showCycleWarning(result){
  const text = result.outcome === 'cycle'
    ? 'Deze indeling loopt na ' + result.rounds + ' rondes in een cyclus — het spel zou nooit eindigen.'
    : 'Geen winnaar gevonden binnen ' + result.rounds + ' rondes — waarschijnlijk een (zeer lange) cyclus.';
  document.getElementById('cycleWarningText').textContent = text;
  const warning = document.getElementById('cycleWarning');
  warning.classList.remove('hidden');
  if (typeof warning.scrollIntoView === 'function') warning.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

document.getElementById('startBtn').addEventListener('click', () => {
  dealNewGame();
  const result = simulateOutcome(players, game.rules);
  if (result.outcome === 'cycle' || result.outcome === 'unknown'){
    showCycleWarning(result);
  } else {
    launchGame();
  }
});

// Het volgende spel met dezelfde spelers en regels, op een andere deling (met dezelfde deling zou een regel die de winnaar
// omzette kunnen leiden tot een spel dat nooit eindigt). Staat er een seed ingevuld, dan is het de volgende seed (zie nextSeed);
// anders wordt er willekeurig gedeeld. Eindigt de deling niet, dan probeert het spel er nog een paar (ten hoogste NEXT_GAME_TRIES;
// met de gewone regels eindigt maar ongeveer 1 op de 10 delingen, en met 2 spelers geen enkele). Lukt dat niet, dan staat het
// startscherm er weer met de melding, bij de eerste seed die is geprobeerd (de seed springt dus niet tientallen plaatsen op);
// "Toch doorspelen" speelt die deling.
const NEXT_GAME_TRIES = 60;
function startNextGame(){
  if (typeof stopAutoPlay === 'function') stopAutoPlay();
  const seedInput = document.getElementById('seedInput');
  const fixedSeed = seedInput.value.trim() !== '';
  let first = null, result = null;
  for (let i = 0; i < NEXT_GAME_TRIES; i++){
    if (fixedSeed) seedInput.value = nextSeed(seedInput.value);
    dealNewGame();
    result = simulateOutcome(players, game.rules);
    if (!first) first = { seed: seedInput.value, result };
    if (result.outcome === 'win'){
      launchGame();
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      return;
    }
  }
  if (fixedSeed){ // terug naar de eerste deling, zodat de seed en het spel bij de melding horen
    seedInput.value = first.seed;
    dealNewGame();
    result = first.result;
  }
  document.getElementById('game').classList.add('hidden');
  document.getElementById('setup').classList.remove('hidden');
  showCycleWarning(result);
}

document.getElementById('cycleProceedBtn').addEventListener('click', () => {
  launchGame();
});

// Kiest de volgende seed (zie nextSeed in cards.js). Het spel start niet vanzelf: "Begin het spel" probeert de nieuwe seed.
document.getElementById('cycleNewSeedBtn').addEventListener('click', () => {
  document.getElementById('cycleWarning').classList.add('hidden');
  const seedInput = document.getElementById('seedInput');
  seedInput.value = nextSeed(seedInput.value);
  document.getElementById('startBtn').focus();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  stopAutoPlay();
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('game').classList.add('hidden');
});
