// ===== CYCLUSDETECTIE & FAST-FORWARD =====
// Sinds de pot niet meer geschud wordt is het spel na de deal 100% deterministisch,
// dus kunnen we het silently vooruit simuleren — zowel om te checken of het ooit
// eindigt, als om in één klap naar de winnaar te springen.
// De simulatie gebruikt dezelfde spelkern (engine.js) als het zichtbare spel.

function stateSignature(playerList){
  return playerList.map(p =>
    p.id + ':' + (p.out ? 'UIT' : p.deck.map(c => c.rank + c.suit).join(','))
  ).join('|');
}

const SIM_ROUND_CAP = 3000;

// Simuleert vanaf een gegeven spelerstand tot een winnaar, een cyclus, of de rondelimiet.
// trace bevat per gebeurtenis een 'battle'-entry (voor statsRecordBattle) en/of een
// 'win'-entry (voor statsRecordRoundWin), in de exacte volgorde zoals live zou gebeuren.
function simulateFullTrace(startPlayers, capRounds, rules){
  const state = createGameState(startPlayers, rules);
  const seen = new Set();
  let rounds = 0;
  const trace = [];
  while (rounds < capRounds){
    const active = engineActivePlayers(state);
    if (active.length <= 1){
      return { outcome: 'win', winnerId: active[0] ? active[0].id : null, rounds, trace, finalPlayers: state.players };
    }
    const sig = stateSignature(state.players);
    if (seen.has(sig)){
      return { outcome: 'cycle', rounds, trace, finalPlayers: state.players };
    }
    seen.add(sig);
    const result = enginePlayRound(state);
    rounds++;
    for (let lvl = 1; lvl <= result.battleLevels; lvl++){
      trace.push({ type: 'battle', depth: lvl });
    }
    if (result.winner){
      const counts = {};
      state.players.forEach(p => { counts[p.id] = p.deck.length; });
      trace.push({ type: 'win', winnerId: result.winner.id, counts });
    }
  }
  return { outcome: 'unknown', rounds: capRounds, trace, finalPlayers: state.players };
}

function simulateOutcome(dealtPlayers, rules){
  const result = simulateFullTrace(dealtPlayers, SIM_ROUND_CAP, rules);
  return { outcome: result.outcome, winnerId: result.winnerId, rounds: result.rounds };
}

// Live vingerafdrukken tijdens het echte spel — noodstop als er onverwacht toch een cyclus optreedt.
let visitedStates = new Set();

function checkLiveCycle(){
  const sig = stateSignature(players);
  if (visitedStates.has(sig)) return true;
  visitedStates.add(sig);
  return false;
}
