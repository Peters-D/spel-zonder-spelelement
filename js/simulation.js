// ===== CYCLUSDETECTIE & FAST-FORWARD =====
// Sinds de pot niet meer geschud wordt is het spel na de deal 100% deterministisch,
// dus kunnen we het silently vooruit simuleren — zowel om te checken of het ooit
// eindigt, als om in één klap naar de winnaar te springen.

function stateSignature(playerList){
  return playerList.map(p =>
    p.name + ':' + (p.out ? 'UIT' : p.deck.map(c => c.rank + c.suit).join(','))
  ).join('|');
}

// Speelt één volledige ronde (incl. eventuele battles) op een losse kopie van de spelers.
// Geeft de winnaarsnaam terug (of null bij een zeldzame "niemand kon spelen"-situatie)
// plus het aantal battle-niveaus dat deze ronde nodig had.
function simulateOneRound(simPlayers){
  let contenders = simPlayers.filter(p => !p.out).map(p => p.name);
  let pot = [];
  let battleLevels = 0;
  simPlayers.forEach(p => {
    if (!p.out){
      p.faceCard = p.deck.length ? p.deck.shift() : null;
      if (p.faceCard) pot.push(p.faceCard);
    }
  });
  while (true){
    const inPlay = simPlayers.filter(p => !p.out && contenders.includes(p.name) && p.faceCard);
    if (inPlay.length === 0){
      const alive = simPlayers.filter(p => !p.out);
      if (alive.length) alive[0].deck.push(...pot);
      return { winnerName: null, battleLevels };
    }
    const winners = findWinningPlayers(inPlay);
    if (winners.length === 1){
      winners[0].deck.push(...pot);
      simPlayers.forEach(p => { if (!p.out && p.deck.length === 0) p.out = true; });
      return { winnerName: winners[0].name, battleLevels };
    }
    battleLevels++;
    contenders = winners.map(p => p.name);
    for (const w of winners){
      if (w.deck.length >= 1){
        const up = w.deck.shift();
        pot.push(up);
        w.faceCard = up;
      } else {
        w.out = true;
        w.faceCard = null;
      }
    }
    contenders = contenders.filter(name => {
      const p = simPlayers.find(pp => pp.name === name);
      return p && !p.out;
    });
    if (contenders.length === 0){
      const alive = simPlayers.filter(p => !p.out);
      if (alive.length) alive[0].deck.push(...pot);
      return { winnerName: null, battleLevels };
    }
    if (contenders.length === 1){
      const w = simPlayers.find(p => p.name === contenders[0]);
      w.deck.push(...pot);
      simPlayers.forEach(p => { if (!p.out && p.deck.length === 0) p.out = true; });
      return { winnerName: w.name, battleLevels };
    }
    // anders: nog een battle-niveau, loop gaat door
  }
}

const SIM_ROUND_CAP = 3000;

// Simuleert vanaf een gegeven spelerstand tot een winnaar, een cyclus, of de rondelimiet.
// trace bevat per gebeurtenis een 'battle'-entry (voor statsRecordBattle) en/of een
// 'win'-entry (voor statsRecordRoundWin), in de exacte volgorde zoals live zou gebeuren.
function simulateFullTrace(startPlayers, capRounds){
  const simPlayers = startPlayers.map(p => ({ name: p.name, deck: p.deck.slice(), out: p.out || false, faceCard: null }));
  const seen = new Set();
  let rounds = 0;
  const trace = [];
  while (rounds < capRounds){
    const active = simPlayers.filter(p => !p.out);
    if (active.length <= 1){
      return { outcome: 'win', winner: active[0] ? active[0].name : null, rounds, trace, finalPlayers: simPlayers };
    }
    const sig = stateSignature(simPlayers);
    if (seen.has(sig)){
      return { outcome: 'cycle', rounds, trace, finalPlayers: simPlayers };
    }
    seen.add(sig);
    const result = simulateOneRound(simPlayers);
    rounds++;
    for (let lvl = 1; lvl <= result.battleLevels; lvl++){
      trace.push({ type: 'battle', depth: lvl });
    }
    if (result.winnerName){
      const counts = {};
      simPlayers.forEach(p => { counts[p.name] = p.deck.length; });
      trace.push({ type: 'win', winnerName: result.winnerName, counts });
    }
  }
  return { outcome: 'unknown', rounds: capRounds, trace, finalPlayers: simPlayers };
}

function simulateOutcome(dealtPlayers){
  const result = simulateFullTrace(dealtPlayers, SIM_ROUND_CAP);
  return { outcome: result.outcome, winner: result.winner, rounds: result.rounds };
}

// Live vingerafdrukken tijdens het echte spel — noodstop als er onverwacht toch een cyclus optreedt.
let visitedStates = new Set();

function checkLiveCycle(){
  const sig = stateSignature(players);
  if (visitedStates.has(sig)) return true;
  visitedStates.add(sig);
  return false;
}
