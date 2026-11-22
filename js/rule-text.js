// Regels in gewone taal: maakt van een beschrijving (logic, zie js/rule-dsl.js) een Nederlandse zin, en bevat de lijst met keuzes die
// bij elk moment horen (voor de regelbouwer, waarmee je een regel aan elkaar klikt). Alleen tekst en gegevens: geen scherm.
//
//   describeRuleLogic(logic)       de beschrijving als zin(nen), of '' als de beschrijving niet klopt
//   RULE_MOMENTS                   de momenten met hun Nederlandse naam (de bouwstenen staan in het register, js/rule-registry.js)
//   ruleChoicesFor(moment)         wat er bij dat moment gekozen kan worden: voorwaarden, gevolgen, kaarten
//   rulePlayerChoices(slot, moment) welke keuzes van spelers er op een plek (en bij een moment) passen
//
// De zinnen zelf staan bij de bouwstenen (sentence, phrase, describe/parts in js/blocks-*.js); dit bestand zet ze in elkaar.

const RT_NUMBER = { 1: 'één', 2: 'twee', 3: 'drie', 4: 'vier', 5: 'vijf', 6: 'zes', 7: 'zeven', 8: 'acht' };

const rtList = v => Array.isArray(v) ? v : [v];

// "a", "a of b", "a, b of c"
function rtJoin(items, word){
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' ' + word + ' ' + items[items.length - 1];
}
const rtUpper = t => t.charAt(0).toUpperCase() + t.slice(1);

// Een keuze van kaarten als zinsdelen:
//   single: de kaart als zinsdeel ("een 2", "de hoogste kaart"); in een bijzin staat het werkwoord erna ("er een 2 ligt")
//   plural: de kaarten als onderwerp, met een meervoudig werkwoord ("kaarten met een 2")
//   verbSingular: true als het onderwerp één kaart is ("de hoogste kaart wint")
function rtCards(node){
  return registryCardsOf(node).phrase(node); // zie js/blocks-cards.js
}

// Een keuze van spelers, als zinsdeel. forEach: "elke speler ..."; anders "de spelers ...".
function rtPlayer(node, forEach){
  return registryPlayersOf(node).phrase(node, forEach); // zie js/blocks-players.js
}

// Een aantal in een bijzin, met het werkwoord achteraan: "er minstens twee Azen liggen", "geen enkele speler kaarten heeft".
// o: pre (begin), sing/plural (het naamwoord bij 1 en bij meer), vs/vp (werkwoord bij 1 en bij meer), none (de zin bij 0).
// Staat er een getal boven de 8 in, dan staan alle getallen als cijfer, zodat woorden en cijfers niet door elkaar staan.
function rtAmount(node, o){
  const lo = node.min, hi = node.max;
  const digits = [lo, hi].some(v => v !== undefined && v > 8);
  const n = v => (digits ? String(v) : v === 0 ? 'nul' : v === 1 ? 'één' : RT_NUMBER[v]);
  const unit = v => (v === 1 ? o.sing : o.plural), verb = v => (v === 1 ? o.vs : o.vp);
  if (hi === 0 && (lo === undefined || lo === 0)) return o.none;
  if (lo !== undefined && hi !== undefined){
    if (lo === hi) return o.pre + 'precies ' + n(lo) + ' ' + unit(lo) + ' ' + verb(lo);
    return o.pre + 'tussen ' + n(lo) + ' en ' + n(hi) + ' ' + o.plural + ' ' + o.vp;
  }
  if (lo !== undefined) return o.pre + 'minstens ' + n(lo) + ' ' + unit(lo) + ' ' + verb(lo);
  return o.pre + 'ten hoogste ' + n(hi) + ' ' + unit(hi) + ' ' + verb(hi);
}

// Een voorwaarde als bijzin, met het werkwoord achteraan (hij staat na "Als"): "er een 2 ligt", "er minstens twee Azen liggen".
// De zinnen staan bij de voorwaarden in het register (js/blocks-conditions.js).
function rtCondition(node){
  return registryConditionOf(node).sentence(node);
}

// Een voorwaarde binnen een andere: "en" en "of" komen tussen haakjes.
function rtWrapCondition(node){
  return registryConditionOf(node).grouping ? '(' + rtCondition(node) + ')' : rtCondition(node);
}

// Een gewone zin uit een gevolg in drie delen ({ s, v, r }: onderwerp, persoonsvorm en de rest; zie parts in js/blocks-effects.js),
// met de voorwaarde en het moment. Na "dan" komt de persoonsvorm eerst: "dan gaat de hele pot naar de aflegstapel".
function rtEffectSentence(e, cond, moment){
  if (moment === 'roundEnd') return cond
    ? 'Aan het einde van de ronde, als ' + cond + ', dan ' + e.v + ' ' + e.s + ' ' + e.r + '.'
    : 'Aan het einde van de ronde ' + e.v + ' ' + e.s + ' ' + e.r + '.';
  return cond
    ? 'Als ' + cond + ', dan ' + e.v + ' ' + e.s + ' ' + e.r + '.'
    : rtUpper(e.s) + ' ' + e.v + ' ' + e.r + '.';
}

// De hele regel als zin(nen). Geeft '' als de beschrijving niet klopt (zie validateRuleLogic).
function describeRuleLogic(logic){
  const base = rtDescribeCore(logic);
  // Een tweede kans (zie rule-dsl.js) legt de zin zelf niet uit: erbij zetten hoe hij werkt.
  return base && JSON.stringify(logic).includes('"secondChance"') ? base + ' Een tweede kans heeft elke speler één keer: wie een ronde wint, krijgt hem terug.' : base;
}

function rtDescribeCore(logic){
  if (validateRuleLogic(logic).length) return '';
  const cond = 'if' in logic ? rtCondition(logic.if) : null;
  const effect = registryEffectOf(logic.then, logic.moment);
  return effect.describe ? effect.describe(logic.then, cond, logic.moment) : rtEffectSentence(effect.parts(logic.then), cond, logic.moment);
}

// ---- de keuzes voor de regelbouwer ----

const RULE_MOMENTS = RULE_REGISTRY.moments.map(m => ({ id: m.id, label: m.label })); // zie js/rule-registry.js

// sample: een voorbeeld dat bij de controle klopt (voor de tests); bij een samengestelde voorwaarde een functie van het moment.
function ruleBlockSample(block, moment){
  return typeof block.sample === 'function' ? block.sample(moment) : block.sample;
}

// De keuzes die bij een moment passen, met hun Nederlandse naam.
function ruleChoicesFor(moment){
  const pick = b => ({ key: b.key, label: b.label });
  return {
    moment: RULE_MOMENTS.find(m => m.id === moment) || null,
    conditions: RULE_REGISTRY.condition.filter(b => b.moments.includes(moment)).map(pick),
    effects: RULE_REGISTRY.effect.filter(b => b.moments.includes(moment)).map(pick),
    cards: registryBlocks('cards').map(pick),
    singleCards: registryBlocks('cards').filter(b => b.single).map(pick)
  };
}

// De keuzes van spelers die op een plek passen (sharePot, forEach, anyPlayer of from). Met een moment erbij alleen de keuzes die bij dat
// moment horen ("de winnaar" bestaat alleen bij award).
function rulePlayerChoices(slot, moment){
  return registryBlocks('players', moment).filter(b => b.slots.includes(slot)).map(b => ({ key: b.key, label: b.label }));
}
