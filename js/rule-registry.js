// Het register van bouwstenen: elke bouwsteen van een regelbeschrijving (zie js/rule-dsl.js) staat hier op één plek, met alles
// wat het spel ervan moet weten. De andere bestanden lezen het register in plaats van hun eigen lijsten. Een nieuwe bouwsteen
// toevoegen is dan één object in een van de js/blocks-*.js-bestanden (en een test).
//
// Wat er in het register staat:
//   momenten    defineMoment({ id, label, prompt, onTable, shared, compile })
//                 id        'decide' | 'tiebreak' | 'award' | 'roundEnd' (de volgorde van de momenten in meldingen en keuzelijsten)
//                 label     de naam in de regelbouwer
//                 prompt    de uitleg van het moment aan een taalmodel (js/rule-prompt.js)
//                 onTable   true als de regel naar de open kaarten kijkt (beslissen, gelijkspel)
//                 shared    velden die elk gevolg op dit moment heeft (bij roundEnd: forEach), met hun controle
//                 compile   maakt van de voorwaarde en het gevolg de functie die de spelkern aanroept (zie compileRuleLogic)
//   bouwstenen  defineBlock(soort, { key, moments, label, sample, ... })
//                 soort     'effect' (gevolg, js/blocks-effects.js), 'condition' (voorwaarde, js/blocks-conditions.js),
//                           'players' (keuze van spelers, js/blocks-players.js) of 'cards' (keuze van kaarten, js/blocks-cards.js)
//                 key       de sleutel in de beschrijving, bijv. 'discardPot'
//                 moments   bij welke momenten de bouwsteen kan
//                 label     de naam in de regelbouwer
//                 sample    een voorbeeld dat klopt (voor de tests en de bouwer)
//               en per soort de onderdelen die het spel gebruikt. Voor een gevolg:
//                 validate(node, path, v, moment)   de controle; v bevat de gedeelde hulpjes van validateRuleLogic (err, only, ...)
//                 run(then, ctx, extra)              wat het gevolg doet (zie het moment voor ctx en extra)
//                 describe(then, cond, moment)       de hele zin, of
//                 parts(then)                        { s, v, r }: onderwerp, persoonsvorm en de rest, voor de gewone zinsbouw
//                 usesDiscard                         true als het gevolg kaarten aflegt (dan staat de aflegstapel op het scherm)
//               en bij elke soort ook prompt (de uitleg aan een taalmodel) en builder (het deel voor de regelbouwer); zie de
//               uitleg bovenaan elk js/blocks-*.js-bestand.
//
// De volgorde van defineBlock telt: in die volgorde staan de bouwstenen in meldingen ("precies één van ... verwacht") en keuzelijsten.

const RULE_REGISTRY = { moments: [], effect: [], condition: [], players: [], cards: [] };

function defineMoment(m){
  RULE_REGISTRY.moments.push(m);
  return m;
}

// De onderdelen die elke bouwsteen van een soort moet hebben; zie de uitleg bovenaan elk js/blocks-*.js-bestand.
// builder: de onderdelen van het bouwerdeel (of builder: false, als de bouwer de bouwsteen zelf maakt).
const REGISTRY_REQUIRED = {
  effect: { fns: ['validate', 'run'], values: ['moments', 'prompt'], builder: ['fresh', 'toLogic', 'fromLogic', 'editor'] },
  condition: { fns: ['validate', 'test', 'sentence'], values: ['moments', 'fields', 'prompt'], builder: ['fresh', 'toLogic', 'fromLogic', 'editor'] },
  players: { fns: ['validate', 'select', 'phrase'], values: ['moments', 'slots', 'prompt'], builder: ['label', 'toLogic', 'fromLogic', 'editor'] },
  cards: { fns: ['validate', 'select', 'phrase'], values: ['fields', 'prompt'], builder: ['label', 'toLogic', 'fromLogic', 'editor'] }
};

// De ontbrekende onderdelen van een bouwsteen (leeg = compleet).
function registryMissing(kind, block){
  const need = REGISTRY_REQUIRED[kind], missing = [];
  for (const k of ['key', 'label', 'sample']) if (block[k] === undefined) missing.push(k);
  for (const k of need.fns) if (typeof block[k] !== 'function') missing.push(k);
  for (const k of need.values) if (block[k] === undefined) missing.push(k);
  if (kind === 'effect' && typeof block.describe !== 'function' && typeof block.parts !== 'function') missing.push('describe of parts');
  if (kind === 'cards' && block.single && typeof block.matches !== 'function') missing.push('matches');
  if (block.builder !== false){
    if (!block.builder || typeof block.builder !== 'object') missing.push('builder');
    else for (const k of need.builder) if (block.builder[k] === undefined) missing.push('builder.' + k);
  }
  return missing;
}

function defineBlock(kind, block){
  if (!RULE_REGISTRY[kind]) throw new Error('Onbekende soort bouwsteen: ' + kind);
  if (RULE_REGISTRY[kind].some(b => b.key === block.key)) throw new Error('Bouwsteen bestaat al: ' + kind + ' ' + block.key);
  const missing = registryMissing(kind, block);
  if (missing.length) throw new Error('Bouwsteen ' + kind + ' ' + block.key + ' mist: ' + missing.join(', '));
  RULE_REGISTRY[kind].push(block);
  return block;
}

function registryMoment(id){
  return RULE_REGISTRY.moments.find(m => m.id === id) || null;
}

// De bouwstenen van een soort, eventueel alleen die bij een moment kunnen.
function registryBlocks(kind, moment){
  return RULE_REGISTRY[kind].filter(b => !moment || b.moments.includes(moment));
}

function registryBlock(kind, key){
  return RULE_REGISTRY[kind].find(b => b.key === key) || null;
}

// De voorwaarde in een beschrijving (if, of een deel daarvan): de bouwsteen waarvan de sleutel erin staat.
function registryConditionOf(node){
  return RULE_REGISTRY.condition.find(b => b.key in node) || null;
}

// De keuze van spelers in een beschrijving: 'winner', of het object met de sleutel van de bouwsteen.
function registryPlayersOf(node){
  if (typeof node === 'string') return RULE_REGISTRY.players.find(b => b.literal && b.key === node) || null;
  return RULE_REGISTRY.players.find(b => !b.literal && b.key in node) || null;
}

// De keuze van kaarten (of één kaart) in een beschrijving: de bouwsteen waarvan de sleutel erin staat.
function registryCardsOf(node){
  return RULE_REGISTRY.cards.find(b => b.key in node) || null;
}

// Het gevolg in een beschrijving (then): de bouwsteen waarvan de sleutel erin staat.
function registryEffectOf(then, moment){
  return registryBlocks('effect', moment).find(b => b.key in then) || null;
}

// ---- de momenten ----
// compile(cond, then) geeft de functie(s) voor de spelkern. Voorwaarden test dslTest (js/rule-dsl.js); het gevolg doet run.

defineMoment({
  id: 'decide', label: 'Als de kaarten open liggen: wie wint de ronde?', prompt: 'wie wint de open kaarten; winnen er meer spelers, dan battlen zij', onTable: true,
  compile(cond, then){
    const effect = registryEffectOf(then, 'decide');
    return { decide(inPlay, rules){
      const env = { scope: inPlay, rules: rules || {} };
      if (cond && !dslTest(cond, env)) return null;
      const winners = effect.run(then, env);
      return winners.length > 0 ? winners : null;
    } };
  }
});

// Bij tiebreak moet er precies één winnaar overblijven, anders beslist de regel niets.
defineMoment({
  id: 'tiebreak', label: 'Als spelers gelijk eindigen: wie van hen wint?', prompt: 'er zijn meerdere winnaars: wie van hen wint (er moet precies één overblijven)', onTable: true,
  compile(cond, then){
    const effect = registryEffectOf(then, 'tiebreak');
    return { breakTie(winners, rules){
      const env = { scope: winners, rules: rules || {} };
      if (cond && !dslTest(cond, env)) return null;
      const one = effect.run(then, env);
      return one.length === 1 ? one : null;
    } };
  }
});

defineMoment({
  id: 'award', label: 'Als de winnaar de pot krijgt', prompt: 'de pot wordt toegekend', onTable: false,
  compile(cond, then){
    const effect = registryEffectOf(then, 'award');
    return { onAward(ctx){
      if (cond && !dslTest(cond, { ctx })) return;
      effect.run(then, ctx);
    } };
  }
});

// Aan het einde van de ronde: vóór spelers zonder kaarten afvallen.
defineMoment({
  id: 'roundEnd', label: 'Aan het einde van de ronde', prompt: 'de ronde is voorbij', onTable: false,
  // Elk gevolg aan het einde van de ronde heeft forEach: de spelers die het overkomt.
  shared: [{ key: 'forEach', validate(node, path, v){ if (!('forEach' in node)) v.err(path, '"forEach" verwacht'); else v.players(node.forEach, path + '.forEach', false, false); } }],
  compile(cond, then){
    const effect = registryEffectOf(then, 'roundEnd');
    return { onRoundEnd(ctx){
      if (cond && !dslTest(cond, { ctx })) return;
      effect.run(then, ctx, dslSelectPlayers(then.forEach, ctx));
    } };
  }
});
