// Regels als beschrijving. Een regel kan hier worden opgeschreven als gegevens (een "logic"-object) in plaats van als code.
// Dit bestand controleert zo'n beschrijving (validateRuleLogic) en maakt er de functies van die de spelkern aanroept
// (compileRuleLogic): decide, breakTie, onAward en onRoundEnd, zie de uitleg bovenaan rules.js en engine.js.
//
// Waarom gegevens en geen code: een beschrijving kan het spel controleren vóór ze meedoet, en ze bestaat alleen uit de
// bouwstenen hieronder. Zo kan een regel later van buiten komen (invoeren, of door een taalmodel laten opstellen) zonder dat
// er vreemde code in de pagina draait.
//
// Een beschrijving:
//   { moment, if (optioneel), then }
//
// moment      'decide'    wie wint de open kaarten (meer dan één speler = battle)
//             'tiebreak'  er zijn meerdere winnaars: wie van hen wint
//             'award'     de pot wordt toegekend
//             'roundEnd'  de ronde is voorbij, vóór het uitschakelen
//
// Kaarten kiezen (bij 'decide' uit alle open kaarten, bij 'tiebreak' uit de kaarten van de spelers die gelijk eindigden):
//   { rank: 'K' } of { rank: ['K', 'Q'] }      kaarten met die waarde
//   { suit: '♥' } of { suit: ['♥', '♦'] }      kaarten met dat symbool
//   { color: 'red' | 'black' }                 rood (♥ ♦) of zwart (♠ ♣)
//   { all: true }                              alle kaarten
//   { highest: 'value' | 'suitOrder', of }     de hoogste op waarde (bij gelijke waarde allemaal), of op de volgorde van de
//   { lowest:  'value' | 'suitOrder', of }     symbolen (rules.suitOrder; is een symbool onbekend, dan niemand). of (optioneel)
//                                              is een keuze waarbinnen gezocht wordt.
//   { group: { relation, min, pick: 'highest' } }
//                                              de hoogste groep kaarten die bij elkaar horen, van minstens min kaarten (min 2).
//                                              relation: 'sameRank' (gelijke waarde), 'sameSuit' (zelfde symbool), 'sameColor'
//                                              (zelfde kleur) of 'consecutive' (opeenvolgende waarden, bijv. 7-8-9; hier telt
//                                              min de verschillende waarden: 7-7-8 is een reeks van twee, alle drie doen mee).
//                                              De hoogste groep is die met de hoogste kaart; bij gelijke stand de grootste, en
//                                              zijn ze dan nog gelijk, dan doen ze samen mee.
//   { and: [..] }, { or: [..] }, { not: .. }   doorsnede, vereniging, de rest
//
// Spelers kiezen (bij 'award' en 'roundEnd'):
//   'winner'                                   de winnaar van de ronde (alleen bij 'award')
//   { opened: <kaart>, exclude: 'winner' }     spelers die de ronde begonnen met zo'n kaart (<kaart>: rank/suit/color/and/or/not);
//                                              exclude (optioneel) laat de winnaar weg
//   { withoutCards: true }                     spelers zonder kaarten
//   { withoutCards: true, secondChance: true } spelers zonder kaarten die hun tweede kans nog hebben. Elke speler heeft er één:
//                                              wie bij forEach + transfer kaarten krijgt, gebruikt hem; wie een ronde wint (ook samen),
//                                              krijgt hem terug. Wie zonder kaarten en zonder tweede kans zit, valt definitief af.
//   { neighbor: 'left' | 'right' }             bij forEach: de eerstvolgende speler met kaarten links of rechts van die speler
//
// Voorwaarden (if):
//   { exists: <kaarten> }                      er ligt minstens één zo'n kaart              (decide, tiebreak)
//   { count: <kaarten>, min, max }             het aantal ligt tussen min en max            (decide, tiebreak); min > max is fout
//   { battle: true }                           er was deze ronde een battle                 (award)
//   { winnerOpened: <kaart> }                  de winnaar begon de ronde met zo'n kaart     (award)
//   { anyPlayer: <spelers> }                   er is minstens één zo'n speler               (award, roundEnd)
//   { playersWithCards: { min, max } }         zoveel spelers hebben kaarten                (award, roundEnd)
//   { and: [..] }, { or: [..] }, { not: .. }
//
// Gevolgen (then):
//   decide, tiebreak   { win: <kaarten> }      die spelers winnen. Bij 'tiebreak' moet er precies één overblijven, anders
//                                              beslist de regel niets.
//   award              { discardPot: true }    de hele pot gaat naar de aflegstapel
//                      { sharePot: [<spelers>, ..] }
//                                              de pot wordt verdeeld over die spelers, in deze volgorde (zie engineSharePot).
//                                              Alleen als er een winnaar is en de pot niet leeg is.
//   roundEnd           { forEach: <spelers>, transfer: { from: <spelers>, count } }
//                                              elke gekozen speler krijgt count kaarten van from (bepaald vóór er iets verschuift)
//                      { forEach: <spelers>, discardTop: n }
//                                              elke gekozen speler legt zijn bovenste n kaarten af
//                                              (count en n: 1 t/m 52)

const DSL_MOMENTS = RULE_REGISTRY.moments.map(m => m.id); // zie js/rule-registry.js
const DSL_RELATIONS = ['sameRank', 'sameSuit', 'sameColor', 'consecutive'];
const DSL_MAX_DEPTH = 8;
const DSL_MAX_CARDS = 52; // meer kaarten dan er in het spel zitten kan een gevolg niet verplaatsen

// ---- controleren ----

// Geeft een lijst met fouten (leeg = de beschrijving klopt). Elke fout noemt de plek in de beschrijving.
function validateRuleLogic(logic){
  const errors = [];
  const err = (path, text) => { errors.push((path || 'logic') + ': ' + text); };
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const only = (node, path, keys) => { for (const k of Object.keys(node)) if (!keys.includes(k)) err(path, 'onbekend onderdeel "' + k + '"'); };
  const oneOf = (node, path, keys) => {
    const present = keys.filter(k => k in node);
    if (present.length !== 1) err(path, 'precies één van ' + keys.join(', ') + ' verwacht');
    return present[0];
  };
  const listOf = (value, path, allowed, what) => {
    const list = Array.isArray(value) ? value : [value];
    if (list.length === 0) err(path, 'lege lijst');
    for (const v of list) if (!allowed.includes(v)) err(path, 'onbekende ' + what + ' ' + JSON.stringify(v));
  };
  const int = (value, path, min, max) => {
    if (!Number.isInteger(value) || value < min || (max !== undefined && value > max))
      err(path, 'een geheel getal van ' + (max !== undefined ? min + ' t/m ' + max : 'minstens ' + min) + ' verwacht');
  };
  const range = (node, path) => {
    if (!('min' in node) && !('max' in node)) err(path, 'min of max verwacht');
    if ('min' in node) int(node.min, path + '.min', 0);
    if ('max' in node) int(node.max, path + '.max', 0);
    if (Number.isInteger(node.min) && Number.isInteger(node.max) && node.min > node.max) err(path, 'min is groter dan max: de voorwaarde kan nooit kloppen');
  };
  const deep = (path, depth) => { if (depth > DSL_MAX_DEPTH){ err(path, 'te diep genest'); return true; } return false; };

  // Eén kaart: rank / suit / color / and / or / not
  const card = (node, path, depth) => {
    if (!isObj(node)) return err(path, 'een kaartbeschrijving verwacht');
    if (deep(path, depth)) return;
    const key = oneOf(node, path, ['rank', 'suit', 'color', 'and', 'or', 'not']);
    only(node, path, [key]);
    if (key === 'rank') listOf(node.rank, path + '.rank', RANKS, 'waarde');
    else if (key === 'suit') listOf(node.suit, path + '.suit', SUITS, 'symbool');
    else if (key === 'color'){ if (!['red', 'black'].includes(node.color)) err(path + '.color', '"red" of "black" verwacht'); }
    else if (key === 'not') card(node.not, path + '.not', depth + 1);
    else if (key){ if (!Array.isArray(node[key]) || node[key].length === 0) err(path + '.' + key, 'een lijst verwacht'); else node[key].forEach((x, i) => card(x, path + '.' + key + '[' + i + ']', depth + 1)); }
  };
  // Kaarten op tafel
  const cards = (node, path, depth) => {
    if (!isObj(node)) return err(path, 'een keuze van kaarten verwacht');
    if (deep(path, depth)) return;
    const key = oneOf(node, path, ['rank', 'suit', 'color', 'all', 'highest', 'lowest', 'group', 'and', 'or', 'not']);
    if (key === 'rank' || key === 'suit' || key === 'color') return card(node, path, depth);
    if (key === 'all'){ only(node, path, ['all']); if (node.all !== true) err(path + '.all', 'true verwacht'); }
    else if (key === 'highest' || key === 'lowest'){
      only(node, path, [key, 'of']);
      if (!['value', 'suitOrder'].includes(node[key])) err(path + '.' + key, '"value" of "suitOrder" verwacht');
      if ('of' in node) cards(node.of, path + '.of', depth + 1);
    } else if (key === 'group'){
      only(node, path, ['group']);
      const g = node.group;
      if (!isObj(g)) return err(path + '.group', 'een beschrijving van de groep verwacht');
      only(g, path + '.group', ['relation', 'min', 'pick']);
      if (!DSL_RELATIONS.includes(g.relation)) err(path + '.group.relation', 'een van ' + DSL_RELATIONS.join(', ') + ' verwacht');
      int(g.min, path + '.group.min', 2);
      if (g.pick !== 'highest') err(path + '.group.pick', '"highest" verwacht');
    } else if (key === 'not'){ only(node, path, ['not']); cards(node.not, path + '.not', depth + 1); }
    else if (key){
      only(node, path, [key]);
      if (!Array.isArray(node[key]) || node[key].length === 0) err(path + '.' + key, 'een lijst verwacht');
      else node[key].forEach((x, i) => cards(x, path + '.' + key + '[' + i + ']', depth + 1));
    }
  };
  // Spelers. allowWinner: mag 'winner' (alleen bij award); allowNeighbor: mag neighbor (alleen als from bij forEach).
  const players = (node, path, allowWinner, allowNeighbor) => {
    if (node === 'winner'){ if (!allowWinner) err(path, '"winner" kan alleen bij het moment award'); return; }
    if (!isObj(node)) return err(path, 'een keuze van spelers verwacht');
    const key = oneOf(node, path, ['opened', 'withoutCards', 'neighbor']);
    if (key === 'opened'){
      only(node, path, ['opened', 'exclude']);
      card(node.opened, path + '.opened', 1);
      if ('exclude' in node && (node.exclude !== 'winner' || !allowWinner)) err(path + '.exclude', '"winner" verwacht (alleen bij het moment award)');
    } else if (key === 'withoutCards'){
      only(node, path, ['withoutCards', 'secondChance']);
      if (node.withoutCards !== true) err(path + '.withoutCards', 'true verwacht');
      if ('secondChance' in node && node.secondChance !== true) err(path + '.secondChance', 'true verwacht');
    }
    else if (key === 'neighbor'){
      only(node, path, ['neighbor']);
      if (!allowNeighbor) err(path, '"neighbor" kan alleen als from bij forEach');
      if (!['left', 'right'].includes(node.neighbor)) err(path + '.neighbor', '"left" of "right" verwacht');
    }
  };
  // Een voorwaarde: precies één van de voorwaarden uit het register, met alleen haar eigen sleutels, bij een moment waar ze kan.
  const condition = (node, path, moment, depth) => {
    if (!isObj(node)) return err(path, 'een voorwaarde verwacht');
    if (deep(path, depth)) return;
    const key = oneOf(node, path, registryBlocks('condition').map(b => b.key));
    if (!key) return;
    const block = registryBlock('condition', key);
    only(node, path, block.fields);
    if (!block.moments.includes(moment)) err(path, '"' + key + '" kan alleen bij ' + block.moments.join(' en '));
    block.validate(node, path, v, moment, depth);
  };
  // De gedeelde hulpjes, voor de controle van de bouwstenen in het register (zie js/rule-registry.js).
  const v = { err, isObj, only, oneOf, int, range, card, cards, players, condition };
  // Het gevolg: de bouwstenen van het moment uit het register. Heeft een moment één gevolg (decide, tiebreak), dan is dat verplicht;
  // anders precies één van de gevolgen, plus de velden die alle gevolgen van het moment delen (bij roundEnd: forEach).
  const effect = (node, path, moment) => {
    if (!isObj(node)) return err(path, 'een gevolg verwacht');
    const m = registryMoment(moment), keys = registryBlocks('effect', moment).map(b => b.key);
    if (keys.length === 1){
      only(node, path, keys);
      if (!(keys[0] in node)) err(path, '"' + keys[0] + '" verwacht'); else registryBlock('effect', keys[0]).validate(node, path, v, moment);
      return;
    }
    const key = oneOf(node, path, keys);
    const shared = m.shared || [];
    only(node, path, shared.map(f => f.key).concat([key]));
    for (const f of shared) f.validate(node, path, v);
    if (key) registryBlock('effect', key).validate(node, path, v, moment);
  };

  if (!isObj(logic)){ err('', 'een beschrijving verwacht'); return errors; }
  only(logic, '', ['moment', 'if', 'then']);
  if (!DSL_MOMENTS.includes(logic.moment)){ err('moment', 'een van ' + DSL_MOMENTS.join(', ') + ' verwacht'); return errors; }
  if ('if' in logic) condition(logic.if, 'if', logic.moment, 1);
  if (!('then' in logic)) err('then', 'ontbreekt'); else effect(logic.then, 'then', logic.moment);
  return errors;
}

// ---- uitvoeren ----

const dslList = v => Array.isArray(v) ? v : [v];
const dslIsRed = card => card.suit === '♥' || card.suit === '♦';
const dslColor = card => card.suit ? (dslIsRed(card) ? 'red' : 'black') : null;

// Past één kaart bij de beschrijving?
function dslCardMatches(card, node){
  if ('rank' in node) return dslList(node.rank).includes(card.rank);
  if ('suit' in node) return dslList(node.suit).includes(card.suit);
  if ('color' in node) return dslColor(card) === node.color;
  if ('and' in node) return node.and.every(x => dslCardMatches(card, x));
  if ('or' in node) return node.or.some(x => dslCardMatches(card, x));
  return !dslCardMatches(card, node.not);
}

// De hoogste groep volgens een relatie (zie de uitleg bovenaan). Geeft de spelers, in de volgorde van de tafel.
function dslBestGroup(scope, group){
  let groups = [];
  // De lengte van een groep. Bij een reeks tellen de verschillende waarden (7-7-8 is een reeks van twee), anders de kaarten.
  let size = g => g.length;
  if (group.relation === 'consecutive'){
    size = g => new Set(g.map(p => p.faceCard.value)).size;
    const values = Array.from(new Set(scope.map(p => p.faceCard.value))).sort((a, b) => a - b);
    let run = [];
    const close = () => { if (run.length) groups.push(scope.filter(p => run.includes(p.faceCard.value))); run = []; };
    for (const v of values){ if (run.length && v !== run[run.length - 1] + 1) close(); run.push(v); }
    close();
  } else {
    const keyOf = group.relation === 'sameRank' ? p => p.faceCard.value : group.relation === 'sameSuit' ? p => p.faceCard.suit : p => dslColor(p.faceCard);
    const byKey = new Map();
    for (const p of scope){
      const k = keyOf(p);
      if (k === null || k === undefined) continue; // een kaart zonder symbool hoort bij geen symbool- of kleurgroep
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(p);
    }
    groups = Array.from(byKey.values());
  }
  groups = groups.filter(g => size(g) >= group.min);
  if (groups.length === 0) return [];
  const top = g => Math.max(...g.map(p => p.faceCard.value));
  const bestTop = Math.max(...groups.map(top));
  groups = groups.filter(g => top(g) === bestTop);
  const bestSize = Math.max(...groups.map(size));
  const members = new Set(groups.filter(g => size(g) === bestSize).flat());
  return scope.filter(p => members.has(p));
}

// De spelers uit scope (elk met een open kaart) die bij de keuze horen, in de volgorde van de tafel.
function dslSelectCards(scope, node, rules){
  if ('all' in node) return scope.slice();
  if ('highest' in node || 'lowest' in node){
    const within = 'of' in node ? dslSelectCards(scope, node.of, rules) : scope;
    if (within.length === 0) return [];
    const high = 'highest' in node;
    if ((high ? node.highest : node.lowest) === 'value'){
      const values = within.map(p => p.faceCard.value);
      const best = high ? Math.max(...values) : Math.min(...values);
      return within.filter(p => p.faceCard.value === best);
    }
    const order = suitOrderOf(rules);
    const place = p => order.indexOf(p.faceCard.suit);
    if (within.some(p => place(p) < 0)) return []; // onbekend symbool: de regel beslist niets
    const places = within.map(place);
    const best = high ? Math.min(...places) : Math.max(...places);
    return within.filter(p => place(p) === best);
  }
  if ('group' in node) return dslBestGroup(scope, node.group);
  if ('and' in node){ const sets = node.and.map(x => dslSelectCards(scope, x, rules)); return scope.filter(p => sets.every(s => s.includes(p))); }
  if ('or' in node){ const sets = node.or.map(x => dslSelectCards(scope, x, rules)); return scope.filter(p => sets.some(s => s.includes(p))); }
  if ('not' in node){ const out = dslSelectCards(scope, node.not, rules); return scope.filter(p => !out.includes(p)); }
  return scope.filter(p => dslCardMatches(p.faceCard, node));
}

// Spelers kiezen bij award en roundEnd. ctx: { state, winner }.
function dslSelectPlayers(node, ctx){
  const state = ctx.state;
  if (node === 'winner') return ctx.winner ? [ctx.winner] : [];
  if ('opened' in node){
    return state.players.filter(p => state.opening[p.id] && dslCardMatches(state.opening[p.id], node.opened) &&
      !(node.exclude === 'winner' && ctx.winner && p.id === ctx.winner.id));
  }
  return state.players.filter(p => p.deck.length === 0 && !(node.secondChance && p.chanceUsed)); // withoutCards (met secondChance: nog een tweede kans)
}

// Klopt een voorwaarde? De voorwaarden staan in het register (js/blocks-conditions.js).
function dslTest(node, env){
  return registryConditionOf(node).test(node, env);
}

// Maakt van een beschrijving de functie die de spelkern aanroept: { decide } | { breakTie } | { onAward } | { onRoundEnd }.
// Een beschrijving die niet klopt geeft een fout (met de meldingen van validateRuleLogic).
function compileRuleLogic(logic){
  const errors = validateRuleLogic(logic);
  if (errors.length) throw new Error('Regelbeschrijving klopt niet: ' + errors.join('; '));
  return registryMoment(logic.moment).compile(logic.if, logic.then); // het moment en het gevolg staan in het register
}
