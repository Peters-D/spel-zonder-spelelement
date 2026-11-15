// Eigen regels: een regel als tekstblok (JSON) invoeren, keuren, uitproberen en toevoegen aan het spel.
// Dit bestand heeft geen scherm; het scherm komt apart (en gebruikt alleen de functies hieronder).
//
// Een regelblok is de beschrijving uit js/rule-dsl.js (logic) plus de teksten die bij een regel horen:
//   {
//     "id": "custom-opeenvolgend",          verplicht; begint met "custom-", daarna kleine letters, cijfers en streepjes
//     "title": "...", "short": "...", "description": "...",       verplicht (de uitleg komt in het regelboek)
//     "priority": 200,                      optioneel, een geheel getal van 101 t/m 999 (standaard 200): altijd ná de regels van het spel
//     "logic": { ... },                     verplicht, zie js/rule-dsl.js
//     "examples": [ ... ]                   verplicht, 1 t/m 12 voorbeelden in dezelfde vorm als bij de regels van het spel
//   }
// Een voorbeeld kan ook "with": [regel-id, ...] hebben: andere regels die in dat voorbeeld meedoen.
//
// Veiligheid: het blok is gegevens, geen code. parseCustomRule kopieert alleen de bekende velden naar een nieuw object (alles
// anders is een fout), begrenst alle lengtes en aantallen en laat de beschrijving controleren door validateRuleLogic. Teksten gaan
// later alleen als gewone tekst in de pagina. Een eigen regel kan nooit een regel van het spel vervangen: de id begint met "custom-".
//
// Wat hier staat:
//   parseCustomRule(text)             tekst -> { def, errors }: de gecontroleerde regel, of een lijst fouten
//   checkCustomRuleExamples(def)      speelt de voorbeelden na tegen de spelkern -> { total, passed, failures }
//   createCustomTrial(def, options)   proefspellen met en zonder de regel, in stukjes (step), -> rapport
//   addCustomRule(def), removeCustomRule(id), customRules()    de regel meedoen laten in het spel (of weer weghalen)
//   exportCustomRule(def)             het blok als tekst, om te delen
//   CUSTOM_RULE_SAMPLE                een geldig voorbeeldblok

const CUSTOM_LIMITS = {
  textBytes: 20000, idPattern: /^custom-[a-z0-9]+(-[a-z0-9]+)*$/, idMax: 40,
  title: 60, short: 160, description: 1500, exampleText: 300,
  priorityMin: 101, priorityMax: 999, priorityDefault: 200,
  examples: 12, players: 8, deck: 12, withRules: 8,
  trialGames: { min: 1, max: 1000, default: 200 }
};

// ---- controleren ----

const customIsObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function customValidCard(text){
  if (typeof text !== 'string' || text.length === 0 || text.length > 3) return false;
  const last = text.slice(-1);
  const rank = SUITS.includes(last) ? text.slice(0, -1) : text;
  return RANKS.includes(rank);
}

// Tekst in een regelblok: een gewone tekst van beperkte lengte, zonder stuurtekens (nieuwe regels mogen in de uitleg).
function customText(value, path, max, errors, allowNewlines){
  if (typeof value !== 'string' || value.trim().length === 0){ errors.push(path + ': een tekst verwacht'); return null; }
  if (value.length > max){ errors.push(path + ': te lang (' + value.length + ' tekens, ten hoogste ' + max + ')'); return null; }
  // eslint-disable-next-line no-control-regex
  if (new RegExp(allowNewlines ? '[\\u0000-\\u0009\\u000b\\u000c\\u000e-\\u001f\\u007f]' : '[\\u0000-\\u001f\\u007f]').test(value)){ errors.push(path + ': bevat stuurtekens'); return null; }
  return value.trim();
}

// Kopieert en controleert één voorbeeld. Geeft het gekopieerde voorbeeld, of null (met fouten).
function customExample(ex, path, errors, ownId){
  if (!customIsObject(ex)){ errors.push(path + ': een voorbeeld verwacht'); return null; }
  const before = errors.length;
  const out = {};
  const allowed = Array.isArray(ex.decks) ? ['decks', 'after', 'discarded', 'text', 'with'] : ['cards', 'winners', 'text', 'with'];
  for (const k of Object.keys(ex)) if (!allowed.includes(k)) errors.push(path + ': onbekend onderdeel "' + k + '"');
  out.text = customText(ex.text, path + '.text', CUSTOM_LIMITS.exampleText, errors, false);
  if ('with' in ex){
    if (!Array.isArray(ex.with) || ex.with.length > CUSTOM_LIMITS.withRules) errors.push(path + '.with: een lijst van ten hoogste ' + CUSTOM_LIMITS.withRules + ' regel-id\'s verwacht');
    else {
      out.with = [];
      ex.with.forEach((id, i) => {
        if (typeof id !== 'string' || (id !== ownId && !RULES.some(r => r.id === id))) errors.push(path + '.with[' + i + ']: onbekende regel ' + JSON.stringify(id));
        else out.with.push(id);
      });
    }
  }
  const cardList = (list, p, min, max) => {
    if (!Array.isArray(list) || list.length < min || list.length > max || !list.every(customValidCard)){
      errors.push(p + ': ' + min + ' t/m ' + max + ' kaarten verwacht, zoals "K" of "K♥"'); return null;
    }
    return list.slice();
  };
  if (Array.isArray(ex.decks)){
    const decks = [];
    if (ex.decks.length < 2 || ex.decks.length > CUSTOM_LIMITS.players) errors.push(path + '.decks: 2 t/m ' + CUSTOM_LIMITS.players + ' stapels verwacht');
    else ex.decks.forEach((d, i) => decks.push(cardList(d, path + '.decks[' + i + ']', 1, CUSTOM_LIMITS.deck)));
    out.decks = decks;
    const after = [];
    if (!Array.isArray(ex.after) || ex.after.length !== ex.decks.length) errors.push(path + '.after: evenveel stapels als decks verwacht');
    else ex.after.forEach((d, i) => after.push(cardList(d, path + '.after[' + i + ']', 0, CUSTOM_LIMITS.deck * CUSTOM_LIMITS.players)));
    out.after = after;
    if (!Number.isInteger(ex.discarded) || ex.discarded < 0 || ex.discarded > 100) errors.push(path + '.discarded: een geheel getal van 0 t/m 100 verwacht');
    else out.discarded = ex.discarded;
  } else {
    out.cards = cardList(ex.cards, path + '.cards', 2, CUSTOM_LIMITS.players);
    if (!Array.isArray(ex.winners) || ex.winners.length === 0 || !ex.winners.every(i => Number.isInteger(i) && i >= 0 && out.cards && i < out.cards.length) ||
        new Set(ex.winners).size !== ex.winners.length) errors.push(path + '.winners: een lijst met nummers van spelers (vanaf 0) verwacht');
    else out.winners = ex.winners.slice();
  }
  return errors.length === before ? out : null;
}

// De lengte van een tekst in bytes (UTF-8), zonder iets van de browser te vragen.
function customByteLength(text){
  let n = 0;
  for (const ch of text){
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

// Tekst -> { def, errors }. def is een nieuw, gecontroleerd object (nooit het ingevoerde object zelf); bij fouten is def null.
function parseCustomRule(text){
  const errors = [];
  if (typeof text !== 'string' || text.trim() === '') return { def: null, errors: ['Het tekstvak is leeg.'] };
  if (customByteLength(text) > CUSTOM_LIMITS.textBytes) return { def: null, errors: ['De tekst is te groot (ten hoogste ' + CUSTOM_LIMITS.textBytes + ' bytes).'] };
  let raw;
  try { raw = JSON.parse(text); } catch (e){ return { def: null, errors: ['Dit is geen geldige JSON: ' + e.message] }; }
  if (!customIsObject(raw)) return { def: null, errors: ['Een regelblok is een object met velden tussen { en }.'] };
  for (const k of Object.keys(raw)) if (!['id', 'title', 'short', 'description', 'priority', 'logic', 'examples'].includes(k)) errors.push('onbekend onderdeel "' + k + '"');

  const def = {};
  if (typeof raw.id !== 'string' || !CUSTOM_LIMITS.idPattern.test(raw.id) || raw.id.length > CUSTOM_LIMITS.idMax)
    errors.push('id: begint met "custom-", daarna kleine letters, cijfers en streepjes (ten hoogste ' + CUSTOM_LIMITS.idMax + ' tekens), bijvoorbeeld "custom-mijn-regel"');
  else def.id = raw.id;
  def.title = customText(raw.title, 'title', CUSTOM_LIMITS.title, errors, false);
  def.short = customText(raw.short, 'short', CUSTOM_LIMITS.short, errors, false);
  def.description = customText(raw.description, 'description', CUSTOM_LIMITS.description, errors, true);
  if (!('priority' in raw)) def.priority = CUSTOM_LIMITS.priorityDefault;
  else if (!Number.isInteger(raw.priority) || raw.priority < CUSTOM_LIMITS.priorityMin || raw.priority > CUSTOM_LIMITS.priorityMax)
    errors.push('priority: een geheel getal van ' + CUSTOM_LIMITS.priorityMin + ' t/m ' + CUSTOM_LIMITS.priorityMax + ' verwacht (eigen regels komen na de regels van het spel)');
  else def.priority = raw.priority;

  if (!customIsObject(raw.logic)) errors.push('logic: de beschrijving van de regel ontbreekt');
  else {
    const logicErrors = validateRuleLogic(raw.logic);
    logicErrors.forEach(e => errors.push('logic' + (e.startsWith('logic') ? e.slice(5) : ': ' + e)));
    if (!logicErrors.length) def.logic = JSON.parse(JSON.stringify(raw.logic)); // een eigen kopie
  }
  if (!Array.isArray(raw.examples) || raw.examples.length === 0 || raw.examples.length > CUSTOM_LIMITS.examples) errors.push('examples: 1 t/m ' + CUSTOM_LIMITS.examples + ' voorbeelden verwacht');
  else {
    def.examples = raw.examples.map((ex, i) => customExample(ex, 'examples[' + i + ']', errors, def.id));
    // Een regel zonder beslissing (moment award of roundEnd) kan alleen met stapels worden uitgelegd, niet met open kaarten.
    if (def.logic && ['award', 'roundEnd'].includes(def.logic.moment))
      raw.examples.forEach((ex, i) => { if (customIsObject(ex) && !Array.isArray(ex.decks)) errors.push('examples[' + i + ']: bij het moment ' + def.logic.moment + ' horen voorbeelden met stapels (decks, after, discarded)'); });
    if (def.logic && ['decide', 'tiebreak'].includes(def.logic.moment))
      raw.examples.forEach((ex, i) => { if (customIsObject(ex) && Array.isArray(ex.decks)) errors.push('examples[' + i + ']: bij het moment ' + def.logic.moment + ' horen voorbeelden met open kaarten (cards, winners)'); });
  }
  return errors.length ? { def: null, errors } : { def, errors: [] };
}

// ---- in het spel zetten ----

// De regel zoals de catalogus hem kent: de gecontroleerde gegevens plus de functies uit de beschrijving.
function customToRule(def){
  const then = def.logic.then || {};
  return Object.assign({
    id: def.id, priority: def.priority, title: def.title, short: def.short, description: def.description, default: false,
    examples: def.examples.map(e => JSON.parse(JSON.stringify(e))), logic: JSON.parse(JSON.stringify(def.logic)),
    usesDiscard: 'discardPot' in then || 'discardTop' in then,
    custom: true
  }, compileRuleLogic(def.logic));
}

function customRules(){
  return RULES.filter(r => r.custom);
}

// Zet de regel in de catalogus (een eerdere regel met dezelfde id wordt vervangen). Geeft de regel terug.
function addCustomRule(def){
  const rule = customToRule(def);
  const old = RULES.findIndex(r => r.id === def.id);
  if (old >= 0){
    if (!RULES[old].custom) throw new Error('Een regel van het spel kan niet worden vervangen: ' + def.id);
    RULES.splice(old, 1);
  }
  RULES.push(rule);
  rulesRefresh();
  return rule;
}

function removeCustomRule(id){
  const i = RULES.findIndex(r => r.id === id && r.custom);
  if (i < 0) return false;
  RULES.splice(i, 1);
  rulesRefresh();
  return true;
}

// Zet de regel tijdelijk in de catalogus (voor het nakijken van voorbeelden en voor proefspellen) en geeft een functie terug die
// de vorige stand terugzet.
function customPreview(def){
  const before = RULES.slice();
  const rule = addCustomRule(def);
  return { rule, restore(){ RULES.length = 0; RULES.push(...before); rulesRefresh(); } };
}

function exportCustomRule(def){
  const out = { id: def.id, title: def.title, short: def.short, description: def.description, priority: def.priority, logic: def.logic, examples: def.examples };
  return JSON.stringify(out, null, 2);
}

// ---- voorbeelden nakijken ----

function customExampleRules(ex, id){
  const rules = {};
  for (const r of RULES) rules[r.id] = false;
  rules[id] = true;
  for (const w of ex.with || []) rules[w] = true;
  return rules;
}

// Speelt de voorbeelden van de regel na tegen de spelkern, zoals de test dat bij de regels van het spel doet.
// Geeft { total, passed, failures: [tekst] }.
function checkCustomRuleExamples(def){
  const failures = [];
  const preview = customPreview(def);
  try {
    def.examples.forEach((ex, i) => {
      const label = 'voorbeeld ' + (i + 1);
      const rules = customExampleRules(ex, def.id);
      try {
        if (Array.isArray(ex.decks)){
          const st = createGameState(ex.decks.map((d, k) => ({ id: k, name: 'S' + k, deck: d.map(parseExampleCard) })), rules);
          enginePlayRound(st);
          const same = (card, token) => (SUITS.includes(token.slice(-1)) ? card.rank + card.suit === token : card.rank === token);
          const ok = st.players.every((p, k) => p.deck.length === ex.after[k].length && p.deck.every((c, j) => same(c, ex.after[k][j]))) && st.discard.length === ex.discarded;
          if (!ok) failures.push(label + ': het spel geeft stapels ' + JSON.stringify(st.players.map(p => p.deck.map(c => c.rank + c.suit))) +
            ' en ' + st.discard.length + ' afgelegd, het voorbeeld zegt ' + JSON.stringify(ex.after) + ' en ' + ex.discarded);
        } else {
          const inPlay = ex.cards.map((c, k) => ({ id: k, faceCard: parseExampleCard(c) }));
          const got = findWinningPlayers(inPlay, rules).map(p => p.id);
          if (JSON.stringify(got) !== JSON.stringify(ex.winners)) failures.push(label + ' (' + ex.cards.join(' ') + '): het spel geeft winnaars ' + JSON.stringify(got) + ', het voorbeeld zegt ' + JSON.stringify(ex.winners));
        }
      } catch (e){
        failures.push(label + ': fout bij het nakijken: ' + e.message);
      }
    });
  } finally { preview.restore(); }
  return { total: def.examples.length, passed: def.examples.length - failures.length, failures };
}

// ---- proefspellen ----

// Proefspellen met en zonder de regel, op dezelfde delingen. De regel staat tijdelijk in de catalogus tot dispose().
// options: games (1 t/m 1000, standaard 200), players (lijst met aantallen spelers, standaard [3, 4, 5, 6]), base (andere regels die
// aan staan, standaard geen), now (de klok, voor de test).
// step(budgetMs) speelt zoveel spellen als er in die tijd passen (altijd minstens één) en geeft true zodra alles klaar is. Zo kan het
// scherm tussendoor blijven reageren. Het rapport (report()) kan ook halverwege worden opgevraagd.
function createCustomTrial(def, options){
  const opt = options || {};
  const lim = CUSTOM_LIMITS.trialGames;
  const games = Math.max(lim.min, Math.min(lim.max, Number.isInteger(opt.games) ? opt.games : lim.default));
  const counts = Array.isArray(opt.players) && opt.players.length ? opt.players : [3, 4, 5, 6];
  const baseRules = {};
  for (const r of RULES) baseRules[r.id] = !!(opt.base && opt.base[r.id]);
  const withRules = Object.assign({}, baseRules, { [def.id]: true });
  const now = opt.now || (() => Date.now());
  const preview = customPreview(def);
  const side = () => ({ win: 0, cycle: 0, unknown: 0, winRounds: 0, maxWinRounds: 0 });
  const report = { games, played: 0, without: side(), with: side(), conservationFailures: [], errors: [], ms: 0, examples: checkCustomRuleExamples(def) };
  let done = false, started = null;

  // Het totaal aan kaarten moet na afloop 52 unieke zijn (stapels, pot en aflegstapel), met de regel en zonder.
  const conserved = t => {
    const all = [].concat(...t.finalPlayers.map(p => p.deck), t.finalDiscard);
    return all.length === 52 && new Set(all.map(c => c.rank + c.suit)).size === 52;
  };
  const playOne = (n, seed, rules, s, label, index) => {
    const g = dealGame(Array.from({ length: n }, (_, i) => 'S' + i), rules, seed);
    const t = simulateFullTrace(g.players, SIM_ROUND_CAP, g.rules);
    s[t.outcome]++;
    if (t.outcome === 'win'){ s.winRounds += t.rounds; s.maxWinRounds = Math.max(s.maxWinRounds, t.rounds); }
    if (!conserved(t)) report.conservationFailures.push({ game: index + 1, players: n, seed, side: label });
  };

  const api = {
    step(budgetMs){
      if (done) return true;
      const t0 = now();
      if (started === null) started = t0;
      do {
        const i = report.played;
        const n = counts[i % counts.length], seed = 'trial-' + i;
        try {
          playOne(n, seed, baseRules, report.without, 'zonder', i);
          playOne(n, seed, withRules, report.with, 'met', i);
        } catch (e){
          if (report.errors.length < 10) report.errors.push({ game: i + 1, players: n, seed, message: String(e && e.message || e) });
        }
        report.played++;
      } while (report.played < games && now() - t0 < budgetMs);
      report.ms += now() - t0;
      if (report.played >= games) done = true;
      return done;
    },
    get done(){ return done; },
    progress(){ return report.played / games; },
    report(){
      const avg = s => (s.win ? Math.round(s.winRounds / s.win) : null);
      return Object.assign({}, report, { avgWinRounds: { without: avg(report.without), with: avg(report.with) },
        ok: report.conservationFailures.length === 0 && report.errors.length === 0 && report.examples.failures.length === 0 });
    },
    dispose(){ preview.restore(); }
  };
  return api;
}

// ---- een voorbeeld ----

const CUSTOM_RULE_SAMPLE = {
  id: 'custom-opeenvolgend',
  title: 'Opeenvolgende kaarten',
  short: 'Liggen er drie of meer opeenvolgende kaarten (zoals 7-8-9), dan battlen die, ook als een andere kaart hoger is',
  description: 'Liggen er drie of meer kaarten met opeenvolgende waarden (bijvoorbeeld 7, 8 en 9), dan beslissen die de ronde: zij battlen met elkaar, ook als een andere speler een hogere kaart heeft. Zijn er meerdere reeksen, dan geldt de reeks met de hoogste kaart.',
  priority: 200,
  logic: { moment: 'decide', then: { win: { group: { relation: 'consecutive', min: 3, pick: 'highest' } } } },
  examples: [
    { cards: ['7♠', '8♥', '9♦', 'A♣'], winners: [0, 1, 2], text: 'De 7, 8 en 9 volgen elkaar op: zij battlen, de Aas doet niet mee.' },
    { cards: ['7♠', '9♥', 'A♦'], winners: [2], text: 'Geen reeks van drie: de hoogste kaart wint gewoon.' }
  ]
};
