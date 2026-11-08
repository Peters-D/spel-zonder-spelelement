// Spelkern: voert de spelregels uit. Geen DOM en geen weergave.
// Het zichtbare spel (game.js) en de simulatie (simulation.js) gebruiken allebei
// deze functies, zodat de regels maar op één plek staan.
//
// Een spelstand ziet er zo uit:
//   {
//     players:     [{ id, name, deck: [kaarten, bovenste eerst], out, faceCard }],
//     rules:       { twoBeatsAce, ... }   (zie rules.js)
//     pot:         kaarten die deze ronde op tafel liggen
//     contenders:  ids van de spelers die nog meedingen naar de pot
//     battleLevel: hoeveel battles er deze ronde al zijn geweest
//   }
// Spelers worden herkend aan hun id (niet aan hun naam), zodat dubbele namen geen probleem zijn.
//
// Verloop van één ronde:
//   engineStartRound → engineResolve → ('battle' → engineLayBattleCards → engineResolve → …) → engineEndRound

function createGameState(players, rules){
  return {
    players: players.map(p => ({
      id: p.id, name: p.name, deck: p.deck.slice(), out: !!p.out, faceCard: null
    })),
    rules: Object.assign({}, DEFAULT_RULES, rules),
    pot: [],
    contenders: [],
    battleLevel: 0
  };
}

function engineActivePlayers(state){
  return state.players.filter(p => !p.out);
}

function enginePlayerById(state, id){
  return state.players.find(p => p.id === id);
}

// Iedere speler die nog meedoet legt de bovenste kaart open in de pot.
function engineStartRound(state){
  state.pot = [];
  state.contenders = engineActivePlayers(state).map(p => p.id);
  state.battleLevel = 0;
  state.players.forEach(p => { if (!p.out) p.faceCard = p.deck.length ? p.deck.shift() : null; });
  state.players.forEach(p => { if (!p.out && p.faceCard) state.pot.push(p.faceCard); });
}

// Vergelijkt de open kaarten van de spelers die nog meedingen. Geeft terug:
//   { type: 'win',    winner, potSize, how: 'normal' | 'battle' }  één winnaar, krijgt de pot
//   { type: 'battle', level, contenders: [spelers] }             gelijkspel, battle-kaarten nodig
//   { type: 'void',   potSize }                                  niemand kon spelen (zeldzaam)
function engineResolve(state){
  const inPlay = state.players.filter(p => !p.out && state.contenders.includes(p.id) && p.faceCard);
  if (inPlay.length === 0) return engineAwardToFirstActive(state);
  const winners = findWinningPlayers(inPlay, state.rules);
  if (winners.length === 1){
    return engineAwardPot(state, winners[0], state.battleLevel > 0 ? 'battle' : 'normal');
  }
  state.battleLevel++;
  state.contenders = winners.map(p => p.id);
  return { type: 'battle', level: state.battleLevel, contenders: winners };
}

// De spelers in de battle leggen elk een nieuwe kaart open. Wie geen kaart meer heeft, ligt eruit.
// Geeft terug:
//   { type: 'battle-revealed' }                              nog minstens twee in de battle: opnieuw vergelijken
//   { type: 'win', winner, potSize, how: 'last-standing' }   nog één over in de battle, krijgt de pot
//   { type: 'void', potSize }                                niemand meer over in de battle (zeldzaam)
function engineLayBattleCards(state){
  for (const id of state.contenders){
    const w = enginePlayerById(state, id);
    if (w.deck.length >= 1){
      const up = w.deck.shift();
      state.pot.push(up);
      w.faceCard = up;
    } else {
      w.out = true;
      w.faceCard = null;
    }
  }
  state.contenders = state.contenders.filter(id => !enginePlayerById(state, id).out);
  if (state.contenders.length === 0) return engineAwardToFirstActive(state);
  if (state.contenders.length === 1){
    return engineAwardPot(state, enginePlayerById(state, state.contenders[0]), 'last-standing');
  }
  return { type: 'battle-revealed' };
}

// Einde van de ronde: wie geen kaarten meer heeft, ligt eruit.
// Geeft terug of het spel voorbij is en zo ja wie er wint (null als er niemand over is).
function engineEndRound(state){
  state.players.forEach(p => { if (p.deck.length === 0) p.out = true; });
  const alive = engineActivePlayers(state);
  return { gameOver: alive.length <= 1, winner: alive[0] || null };
}

function engineAwardPot(state, winner, how){
  const potSize = state.pot.length;
  winner.deck.push(...state.pot);
  state.pot = [];
  return { type: 'win', winner, potSize, how };
}

function engineAwardToFirstActive(state){
  const potSize = state.pot.length;
  const alive = engineActivePlayers(state);
  if (alive.length) alive[0].deck.push(...state.pot);
  state.pot = [];
  return { type: 'void', potSize };
}

// Speelt één ronde in één keer helemaal uit (voor de simulatie).
// Geeft de winnaar (of null) en het aantal battles in deze ronde terug.
function enginePlayRound(state){
  engineStartRound(state);
  let ev = engineResolve(state);
  let battleLevels = 0;
  while (ev.type === 'battle'){
    battleLevels = ev.level;
    ev = engineLayBattleCards(state);
    if (ev.type === 'battle-revealed') ev = engineResolve(state);
  }
  const end = engineEndRound(state);
  return { winner: ev.type === 'win' ? ev.winner : null, battleLevels, end };
}
