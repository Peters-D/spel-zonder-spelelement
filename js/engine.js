// Spelkern: voert de spelregels uit. Geen DOM en geen weergave.
// Het zichtbare spel (game.js) en de simulatie (simulation.js) gebruiken allebei
// deze functies, zodat de regels maar op één plek staan.
//
// Een spelstand ziet er zo uit:
//   {
//     players:     [{ id, name, deck: [kaarten, bovenste eerst], out, faceCard }],
//     rules:       { <regel-id>: true/false, ... }   (zie RULES in rules.js)
//     pot:         kaarten die deze ronde op tafel liggen
//     discard:     de aflegstapel: kaarten die zijn afgelegd, bovenste kaart eerst (index 0)
//     moved:       tellers { discarded, returned } van alle kaarten die zijn afgelegd/teruggehaald
//     contenders:  ids van de spelers die nog meedingen naar de pot
//     battleLevel: hoeveel battles er deze ronde al zijn geweest
//   }
// Spelers worden herkend aan hun id (niet aan hun naam), zodat dubbele namen geen probleem zijn.
//
// De kaarten zitten altijd op precies één plek: een stapel, de pot of de aflegstapel (samen 52).
// De aflegstapel ligt gesloten maar op volgorde. Tot er regels zijn die kaarten terug kunnen brengen,
// zijn afgelegde kaarten uit het spel: ze tellen niet mee voor het einde van het spel.
//
// Regels (zie RULES in rules.js) kunnen kaarten afleggen en terughalen met deze handelingen:
//   engineDiscardCards(state, kaarten)            legt kaarten af die de aanroeper al uit hun plek heeft gehaald
//   engineDiscardPot(state)                       legt de hele pot af
//   engineDiscardFromDeck(state, spelerId, n)     legt de bovenste n kaarten van een stapel af
//   engineReturnFromDiscard(state, n, naar)       haalt de bovenste n kaarten van de aflegstapel terug, op volgorde,
//                                                 naar 'pot' of naar { player: id, position: 'top' | 'bottom' }
// en via twee haken die een regel kan hebben (alleen aangeroepen voor regels die aan staan):
//   onAward(ctx)     bij het toekennen van de pot; ctx = { state, winner, how, potSize }. Kaarten die de haak uit de pot
//                    haalt (bijv. afleggen) gaan niet naar de winnaar; wat er in de pot blijft, krijgt de winnaar.
//   onRoundEnd(ctx)  aan het einde van de ronde, vóór het uitschakelen; ctx = { state }
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
    discard: [],
    moved: { discarded: 0, returned: 0 },
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
//   { type: 'battle', level, contenders: [spelers], overruled: [spelers], ruleId }
//                                                                gelijkspel (of een regel die een battle afdwingt), battle-kaarten nodig;
//                                                                overruled = spelers die zonder die regel hadden gewonnen
//   { type: 'void',   potSize }                                  niemand kon spelen (zeldzaam)
function engineResolve(state){
  const inPlay = state.players.filter(p => !p.out && state.contenders.includes(p.id) && p.faceCard);
  if (inPlay.length === 0) return engineAwardToFirstActive(state);
  const { winners, rule } = decideRound(inPlay, state.rules);
  if (winners.length === 1){
    return engineAwardPot(state, winners[0], state.battleLevel > 0 ? 'battle' : 'normal');
  }
  state.battleLevel++;
  state.contenders = winners.map(p => p.id);
  // Spelers die zonder de beslissende regel hadden gewonnen, maar nu zijn overruled (alleen voor
  // regels met een overruledMessage, zoals "gelijke kaarten gaan voor").
  const overruled = rule && rule.overruledMessage
    ? decideRound(inPlay, Object.assign({}, state.rules, { [rule.id]: false })).winners.filter(p => !winners.includes(p))
    : [];
  return { type: 'battle', level: state.battleLevel, contenders: winners, overruled, ruleId: rule ? rule.id : null };
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

// Einde van de ronde: eerst de haken onRoundEnd van de actieve regels, daarna ligt eruit wie geen kaarten meer heeft.
// Geeft terug of het spel voorbij is en zo ja wie er wint (null als er niemand over is), plus hoeveel kaarten
// de haken hebben afgelegd en teruggehaald. Kaarten op de aflegstapel tellen niet mee: het spel eindigt zodra
// er één speler met kaarten over is.
function engineEndRound(state){
  const moved = engineRunHooks(state, 'onRoundEnd', {});
  state.players.forEach(p => { if (p.deck.length === 0) p.out = true; });
  const alive = engineActivePlayers(state);
  return { gameOver: alive.length <= 1, winner: alive[0] || null, discarded: moved.discarded, returned: moved.returned };
}

// Geeft de pot aan de winnaar, nadat de haken onAward van de actieve regels hun kans hebben gehad.
// Geeft het aantal afgelegde kaarten (discarded) en wat de winnaar kreeg (toWinner) mee in de gebeurtenis.
function engineAwardPot(state, winner, how){
  const potSize = state.pot.length;
  const moved = engineRunHooks(state, 'onAward', { winner, how, potSize });
  const toWinner = state.pot.length;
  winner.deck.push(...state.pot);
  state.pot = [];
  return { type: 'win', winner, potSize, how, discarded: moved.discarded, toWinner };
}

function engineAwardToFirstActive(state){
  const potSize = state.pot.length;
  const alive = engineActivePlayers(state);
  const moved = engineRunHooks(state, 'onAward', { winner: alive[0] || null, how: 'void', potSize });
  const toWinner = state.pot.length;
  if (alive.length) alive[0].deck.push(...state.pot);
  state.pot = [];
  return { type: 'void', potSize, discarded: moved.discarded, toWinner };
}

// ---- aflegstapel en haken ----

// De regels die aan staan, in volgorde van prioriteit.
function engineActiveRules(state){
  return RULES.filter(r => state.rules[r.id]).sort((a, b) => a.priority - b.priority);
}

// Roept een haak ('onAward', 'onRoundEnd') aan bij elke actieve regel die hem heeft.
// Geeft terug hoeveel kaarten de haken hebben afgelegd en teruggehaald.
function engineRunHooks(state, hook, info){
  const before = { discarded: state.moved.discarded, returned: state.moved.returned };
  for (const rule of engineActiveRules(state)){
    if (typeof rule[hook] === 'function') rule[hook](Object.assign({ state }, info));
  }
  return { discarded: state.moved.discarded - before.discarded, returned: state.moved.returned - before.returned };
}

// Legt kaarten af die de aanroeper al uit hun plek heeft gehaald. De kaarten worden een voor een op de
// aflegstapel gelegd, in de gegeven volgorde: de laatste kaart komt bovenop.
function engineDiscardCards(state, cards){
  for (const c of cards) state.discard.unshift(c);
  state.moved.discarded += cards.length;
  return cards.length;
}

function engineDiscardPot(state){
  return engineDiscardCards(state, state.pot.splice(0));
}

function engineDiscardFromDeck(state, playerId, count){
  const p = enginePlayerById(state, playerId);
  return engineDiscardCards(state, p.deck.splice(0, Math.max(0, count | 0)));
}

// Haalt de bovenste kaarten van de aflegstapel terug, in de volgorde waarin ze lagen (niet geschud).
//   naar: 'pot' of { player: id, position: 'top' | 'bottom' } (standaard onderaan de stapel)
// Een uitgeschakelde speler krijgt niets terug (geeft 0): een regel die dat wil, moet hem eerst weer meedoen.
function engineReturnFromDiscard(state, count, to){
  const target = to === 'pot' ? null : enginePlayerById(state, to.player);
  if (target && target.out) return 0;
  const cards = state.discard.splice(0, Math.max(0, count | 0));
  if (!target) state.pot.push(...cards);
  else if (to.position === 'top') target.deck.unshift(...cards);
  else target.deck.push(...cards);
  state.moved.returned += cards.length;
  return cards.length;
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
