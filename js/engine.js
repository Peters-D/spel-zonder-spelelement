// Spelkern: voert de spelregels uit. Geen DOM en geen weergave.
// Het zichtbare spel (game.js) en de simulatie (simulation.js) gebruiken allebei
// deze functies, zodat de regels maar op één plek staan.
//
// Een spelstand ziet er zo uit:
//   {
//     players:     [{ id, name, deck: [kaarten, bovenste eerst], out, faceCard }],
//     rules:       { <regel-id>: true/false, ... }   (zie RULES in rules.js), eventueel plus suitOrder: ['♠','♥','♦','♣'] (volgorde van de symbolen, hoog naar laag)
//     pot:         kaarten die deze ronde op tafel liggen
//     discard:     de aflegstapel: kaarten die zijn afgelegd, bovenste kaart eerst (index 0)
//     opening:     per speler-id de kaart waarmee die speler deze ronde begon (een battle overschrijft faceCard, dit blijft staan)
//     moved:       { discarded, returned, revived, transferred, transfers, shared }: tellers van afgelegde, teruggehaalde en
//                  tussen spelers verplaatste kaarten, de ids van spelers die weer meedoen, de overdrachten en de verdeelde potten
//                  (shared: [{ to, count }], zie engineSharePot)
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
//                                                 naar { player: id, position: 'top' | 'bottom' } (nooit naar de pot)
// Wie kaarten terugkrijgt doet weer mee: een uitgeschakelde speler is dan niet meer uitgeschakeld en speelt vanaf de
// volgende ronde mee. Is er niets om terug te krijgen, dan blijft hij uitgeschakeld.
// Kaarten van de aflegstapel gaan alleen naar een speler, nooit naar de pot (die wordt elke ronde geleegd).
//
// Kaarten van de ene speler naar de andere (ook dan doet een uitgeschakelde ontvanger weer mee):
//   engineTransferCards(state, vanId, naarId, n, positie)   de bovenste n kaarten van een speler gaan naar een andere,
//                                                           standaard onderaan zijn stapel ('top' = bovenop)
//   engineNeighbor(state, spelerId, 'left' | 'right')       de eerstvolgende speler met kaarten links of rechts
//   engineRichestPlayer(state, spelerId)                    de speler met de meeste kaarten (niet de speler zelf)
// De spelers zitten in een kring in de volgorde van state.players. Met de klok mee tellen zit het volgende nummer
// links: speler 2 zit links van speler 1, en de laatste speler zit rechts van speler 1.
// en via twee haken die een regel kan hebben (alleen aangeroepen voor regels die aan staan):
//   onAward(ctx)     bij het toekennen van de pot; ctx = { state, winner, how, potSize }. Kaarten die de haak uit de pot
//                    haalt (bijv. afleggen) gaan niet naar de winnaar; wat er in de pot blijft, krijgt de winnaar.
//                    Met engineSharePot kan de haak de pot verdelen over meer winnaars (state.opening zegt wie met welke kaart begon).
//   onRoundEnd(ctx)  aan het einde van de ronde, vóór het uitschakelen; ctx = { state }
//
// Verloop van één ronde:
//   engineStartRound → engineResolve → ('battle' → engineLayBattleCards → engineResolve → …) → engineEndRound

// Deelt een nieuw spel: schudt een spel van 52 kaarten en verdeelt het om de beurt over de spelers (namen, in tafelvolgorde).
// Met een seed (tekst) is de deling altijd dezelfde; zonder seed (leeg of null) is ze willekeurig. De seed staat in state.seed
// (null = willekeurig spel).
function dealGame(names, rules, seed){
  const deck = shuffle(buildDeck(), seed ? mulberry32(hashSeed(seed)) : Math.random);
  const dealt = names.map((name, i) => ({ id: i, name, deck: [] }));
  let idx = 0;
  while (deck.length){
    dealt[idx % dealt.length].deck.push(deck.pop());
    idx++;
  }
  const state = createGameState(dealt, rules);
  state.seed = seed || null;
  return state;
}

function createGameState(players, rules){
  return {
    players: players.map(p => ({
      id: p.id, name: p.name, deck: p.deck.slice(), out: !!p.out, faceCard: null
    })),
    rules: Object.assign({}, DEFAULT_RULES, rules),
    pot: [],
    opening: {},
    discard: [],
    moved: { discarded: 0, returned: 0, revived: [], transferred: 0, transfers: [], shared: [] },
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
  state.opening = {};
  state.players.forEach(p => { if (!p.out && p.faceCard) state.opening[p.id] = p.faceCard; });
}

// Vergelijkt de open kaarten van de spelers die nog meedingen. Geeft terug:
//   { type: 'win',    winner, potSize, how: 'normal' | 'battle', tieBroken }  één winnaar, krijgt de pot (tieBroken: { ruleId, tied, suit }
//                                                                als een gelijkspel op symbool is beslist, anders null)
//   { type: 'battle', level, contenders: [spelers], overruled: [spelers], ruleId }
//                                                                gelijkspel (of een regel die een battle afdwingt), battle-kaarten nodig;
//                                                                overruled = spelers die zonder die regel hadden gewonnen
//   { type: 'void',   potSize }                                  niemand kon spelen (zeldzaam)
function engineResolve(state){
  const inPlay = state.players.filter(p => !p.out && state.contenders.includes(p.id) && p.faceCard);
  if (inPlay.length === 0) return engineAwardToFirstActive(state);
  const { winners, rule, tieBreak } = decideRound(inPlay, state.rules);
  if (winners.length === 1){
    return engineAwardPot(state, winners[0], state.battleLevel > 0 ? 'battle' : 'normal', tieBreak);
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
  return { gameOver: alive.length <= 1, winner: alive[0] || null, discarded: moved.discarded, returned: moved.returned, revived: moved.revived, transfers: moved.transfers };
}

// Geeft de pot aan de winnaar, nadat de haken onAward van de actieve regels hun kans hebben gehad.
// Geeft het aantal afgelegde kaarten (discarded) en wat de winnaar kreeg (toWinner) mee in de gebeurtenis.
function engineAwardPot(state, winner, how, tieBreak){
  const potSize = state.pot.length;
  const moved = engineRunHooks(state, 'onAward', { winner, how, potSize });
  const toWinner = state.pot.length;
  winner.deck.push(...state.pot);
  state.pot = [];
  return { type: 'win', winner, potSize, how, discarded: moved.discarded, toWinner, revived: moved.revived, transfers: moved.transfers, shared: moved.shared,
    tieBroken: tieBreak ? { ruleId: tieBreak.rule.id, tied: tieBreak.tied, suit: tieBreak.suit } : null };
}

function engineAwardToFirstActive(state){
  const potSize = state.pot.length;
  const alive = engineActivePlayers(state);
  const moved = engineRunHooks(state, 'onAward', { winner: alive[0] || null, how: 'void', potSize });
  const toWinner = state.pot.length;
  if (alive.length) alive[0].deck.push(...state.pot);
  state.pot = [];
  return { type: 'void', potSize, discarded: moved.discarded, toWinner, revived: moved.revived, transfers: moved.transfers, shared: moved.shared };
}

// ---- aflegstapel en haken ----

// De regels die aan staan, in volgorde van prioriteit.
function engineActiveRules(state){
  return RULES.filter(r => state.rules[r.id]).sort((a, b) => a.priority - b.priority);
}

// Roept een haak ('onAward', 'onRoundEnd') aan bij elke actieve regel die hem heeft.
// Geeft terug hoeveel kaarten de haken hebben afgelegd en teruggehaald.
function engineRunHooks(state, hook, info){
  const before = { discarded: state.moved.discarded, returned: state.moved.returned, revived: state.moved.revived.length,
    transfers: state.moved.transfers.length, shared: state.moved.shared.length };
  for (const rule of engineActiveRules(state)){
    if (typeof rule[hook] === 'function') rule[hook](Object.assign({ state }, info));
  }
  return {
    discarded: state.moved.discarded - before.discarded,
    returned: state.moved.returned - before.returned,
    revived: state.moved.revived.slice(before.revived).map(id => enginePlayerById(state, id)),
    transfers: state.moved.transfers.slice(before.transfers).map(t => ({ from: enginePlayerById(state, t.from), to: enginePlayerById(state, t.to), count: t.count })),
    shared: state.moved.shared.slice(before.shared).map(x => ({ player: enginePlayerById(state, x.to), count: x.count }))
  };
}

// Een uitgeschakelde speler die kaarten krijgt doet weer mee.
function engineRevive(state, player){
  if (!player.out) return;
  player.out = false;
  state.moved.revived.push(player.id);
}

// ---- kaarten tussen spelers ----

function enginePosition(state, playerId){
  return state.players.findIndex(p => p.id === playerId);
}

// De eerstvolgende speler met kaarten links ('left') of rechts ('right') van een speler. Spelers zonder kaarten
// (ook uitgeschakelde) worden overgeslagen. Geeft null als niemand anders kaarten heeft.
function engineNeighbor(state, playerId, direction){
  const n = state.players.length;
  const step = direction === 'left' ? 1 : -1;
  const start = enginePosition(state, playerId);
  for (let k = 1; k < n; k++){
    const p = state.players[(((start + step * k) % n) + n) % n];
    if (p.deck.length > 0) return p;
  }
  return null;
}

// De speler met de meeste kaarten, behalve de speler zelf. Zijn er meer met evenveel kaarten, dan geldt degene die het
// eerst links van de speler zit. Geeft null als niemand anders kaarten heeft.
function engineRichestPlayer(state, playerId){
  const n = state.players.length;
  const start = enginePosition(state, playerId);
  let best = null;
  for (let k = 1; k < n; k++){
    const p = state.players[(start + k) % n];
    if (p.deck.length > 0 && (best === null || p.deck.length > best.deck.length)) best = p;
  }
  return best;
}

// De bovenste n kaarten van een speler gaan naar een andere speler, onderaan zijn stapel (position 'top': bovenop),
// in de volgorde waarin ze lagen. Een uitgeschakelde ontvanger doet weer mee. Geeft het aantal verplaatste kaarten.
function engineTransferCards(state, fromId, toId, count, position){
  if (fromId === toId) return 0;
  const from = enginePlayerById(state, fromId);
  const to = enginePlayerById(state, toId);
  const cards = from.deck.splice(0, Math.max(0, count | 0));
  if (position === 'top') to.deck.unshift(...cards);
  else to.deck.push(...cards);
  if (cards.length > 0){
    state.moved.transferred += cards.length;
    state.moved.transfers.push({ from: fromId, to: toId, count: cards.length });
    engineRevive(state, to);
  }
  return cards.length;
}

// ---- de pot delen ----

// Verdeelt de hele pot over een groep spelers die samen winnen. memberIds staat in kiesvolgorde: de pot gaat van hoog naar
// laag (bij gelijke waarde in de volgorde van leggen) en de eerste kiest de hoogste kaart, de tweede de volgende, enzovoort
// en daarna weer van voren af aan. Elke speler krijgt zijn kaarten onderop zijn stapel, in de volgorde waarin ze lagen.
// Bedoeld voor onAward: de pot is daarna leeg, dus de winnaar krijgt niets meer. Geeft per speler het aantal kaarten.
function engineSharePot(state, memberIds){
  const members = memberIds.map(id => enginePlayerById(state, id));
  const picks = state.pot.map((card, i) => ({ card, i })).sort((a, b) => (b.card.value - a.card.value) || (a.i - b.i));
  const shares = members.map(() => []);
  picks.forEach((x, k) => shares[k % members.length].push(x));
  const result = [];
  members.forEach((m, j) => {
    const cards = shares[j].sort((a, b) => a.i - b.i).map(x => x.card);
    m.deck.push(...cards);
    if (cards.length > 0){
      state.moved.shared.push({ to: m.id, count: cards.length });
      engineRevive(state, m);
    }
    result.push({ id: m.id, count: cards.length });
  });
  state.pot = [];
  return result;
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
//   naar: { player: id, position: 'top' | 'bottom' } (standaard onderaan de stapel)
// Een uitgeschakelde speler die kaarten terugkrijgt doet weer mee (zie engineRevive).
function engineReturnFromDiscard(state, count, to){
  const target = enginePlayerById(state, to.player);
  const cards = state.discard.splice(0, Math.max(0, count | 0));
  if (to.position === 'top') target.deck.unshift(...cards);
  else target.deck.push(...cards);
  if (cards.length > 0) engineRevive(state, target);
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
  const shared = ev.type === 'win' && ev.shared.length > 0 ? ev.shared.map(x => x.player.id) : [];
  return { winner: ev.type === 'win' ? ev.winner : null, shared, battleLevels, end };
}
