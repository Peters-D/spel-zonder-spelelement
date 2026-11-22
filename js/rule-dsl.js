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
// De momenten en bouwstenen staan in het register, elk met zijn controle, gedrag, zin, bouwerdeel en uitleg:
//   js/rule-registry.js        hoe het register werkt, en de momenten (decide, tiebreak, award, roundEnd)
//   js/blocks-effects.js       de gevolgen (then)
//   js/blocks-conditions.js    de voorwaarden (if)
//   js/blocks-players.js       de keuzes van spelers (bij award en roundEnd)
//   js/blocks-cards.js         de keuzes van kaarten (en van één kaart)
// Alles in één lijst: de uitleg voor een taalmodel (RULE_PROMPT_GRAMMAR in js/rule-prompt.js), die uit hetzelfde register komt.
// Een bouwsteen toevoegen: zie de README ("Een nieuwe bouwsteen toevoegen").

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
    const present = keys.filter(k => registryHas(node, k));
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

  // De keuzes van kaarten staan in het register (js/blocks-cards.js).
  // Eén kaart: precies één van de bouwstenen met single (rank / suit / color / and / or / not), zonder andere sleutels.
  const card = (node, path, depth) => {
    if (!isObj(node)) return err(path, 'een kaartbeschrijving verwacht');
    if (deep(path, depth)) return;
    const key = oneOf(node, path, registryBlocks('cards').filter(b => b.single).map(b => b.key));
    only(node, path, [key]);
    if (key) registryBlock('cards', key).validate(node, path, v, depth, true);
  };
  // Kaarten op tafel: precies één van de bouwstenen; rank, suit en color worden gecontroleerd als één kaart.
  const cards = (node, path, depth) => {
    if (!isObj(node)) return err(path, 'een keuze van kaarten verwacht');
    if (deep(path, depth)) return;
    const key = oneOf(node, path, registryBlocks('cards').map(b => b.key));
    if (!key) return;
    const block = registryBlock('cards', key);
    if (block.leaf) return card(node, path, depth);
    only(node, path, block.fields);
    block.validate(node, path, v, depth, false);
  };
  // Spelers. allowWinner: mag 'winner' (alleen bij award); allowNeighbor: mag neighbor (alleen als from bij forEach).
  // De keuzes van spelers staan in het register (js/blocks-players.js): 'winner', of een object met precies één van de andere sleutels.
  const players = (node, path, allowWinner, allowNeighbor) => {
    const allow = { winner: allowWinner, neighbor: allowNeighbor };
    const literal = typeof node === 'string' ? registryPlayersOf(node) : null;
    if (literal) return literal.validate(node, path, v, allow);
    if (!isObj(node)) return err(path, 'een keuze van spelers verwacht');
    const key = oneOf(node, path, registryBlocks('players').filter(b => !b.literal).map(b => b.key));
    if (!key) return;
    const block = registryBlock('players', key);
    only(node, path, block.fields);
    block.validate(node, path, v, allow);
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
  const v = { err, isObj, only, oneOf, listOf, int, range, card, cards, players, condition };
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
  if (!RULE_MOMENT_IDS.includes(logic.moment)){ err('moment', 'een van ' + RULE_MOMENT_IDS.join(', ') + ' verwacht'); return errors; }
  if ('if' in logic) condition(logic.if, 'if', logic.moment, 1);
  if (!('then' in logic)) err('then', 'ontbreekt'); else effect(logic.then, 'then', logic.moment);
  return errors;
}

// ---- uitvoeren ----

// Past één kaart bij de beschrijving? Zie js/blocks-cards.js.
function dslCardMatches(card, node){
  return registryCardsOf(node).matches(card, node);
}

// De spelers uit scope (elk met een open kaart) die bij de keuze horen, in de volgorde van de tafel. Zie js/blocks-cards.js.
function dslSelectCards(scope, node, rules){
  return registryCardsOf(node).select(scope, node, rules);
}

// Spelers kiezen bij award en roundEnd. ctx: { state, winner }.
// De keuzes van spelers staan in het register (js/blocks-players.js).
function dslSelectPlayers(node, ctx){
  return registryPlayersOf(node).select(node, ctx);
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
