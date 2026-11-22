// De instructie voor een taalmodel (bijvoorbeeld Claude) om een regel te schrijven als regelblok. Het spel maakt zelf geen verbinding:
// de speler kopieert deze tekst, plakt hem in een gesprek met het model en plakt het antwoord terug in het venster "Eigen regel".
// Daar gaat het door dezelfde controle als elk ander blok, dus een fout antwoord kan het spel niet beschadigen.
//
//   buildRulePrompt(wish)       de hele instructie, met de wens van de speler erin
//   extractRuleJson(text)       haalt het regelblok uit een antwoord dat er tekst of een codeblok omheen heeft
//
// De uitleg van de bouwstenen komt uit het register (prompt bij elk moment en elke bouwsteen); de test controleert dat elk
// sleutelwoord van de controle erin voorkomt en dat de voorbeelden (de regels van het spel zelf) erbij staan.

const RULE_PROMPT_WISH_MAX = 600;

// De uitleg komt uit het register (js/rule-registry.js): elk moment en elke bouwsteen heeft zijn eigen regel(s) in prompt.
function rulePromptGrammar(){
  const lines = kind => registryBlocks(kind).flatMap(b => b.prompt).map(t => '  ' + t);
  // De gevolgen met dezelfde momenten op één regel: "  award:             { ... }   of   { ... }".
  const effects = [];
  for (const b of registryBlocks('effect')){
    const label = b.moments.join(', ') + ':';
    let group = effects.find(g => g.label === label);
    if (!group) effects.push(group = { label, items: [], notes: [] });
    group.items.push(b.prompt);
    if (b.promptNote) group.notes.push(b.promptNote);
  }
  return [
    'logic is een object { "moment": ..., "if": ... (optioneel), "then": ... }.',
    '',
    'moment (kies er één):',
    ...RULE_REGISTRY.moments.map(m => '  ' + JSON.stringify(m.id).padEnd(11) + ' ' + m.prompt),
    '',
    'Kaarten kiezen (bij decide uit alle open kaarten, bij tiebreak uit de kaarten van de spelers die gelijk eindigden):',
    ...lines('cards'),
    '',
    'Eén soort kaart (voor "opened" en "winnerOpened"): alleen ' + registryBlocks('cards').filter(b => b.single).map(b => b.key).join(', ') + '.',
    '',
    'Spelers kiezen (alleen bij award en roundEnd):',
    ...lines('players'),
    '',
    'Voorwaarden (if):',
    ...lines('condition'),
    '',
    'Gevolgen (then):',
    ...effects.flatMap(g => ['  ' + g.label.padEnd(19) + g.items.join('   of   ')].concat(g.notes.map(n => ' '.repeat(21) + n))),
    '',
    'Er bestaat niets anders: geen andere sleutels, geen code, geen geheugen over meerdere rondes en geen keuzes van spelers.'
  ].join('\n');
}
const RULE_PROMPT_GRAMMAR = rulePromptGrammar();

// De wens van de speler als één regel tekst van beperkte lengte (hij komt midden in de instructie te staan).
function rulePromptWish(wish){
  const text = String(wish === undefined || wish === null ? '' : wish).replace(/\s+/g, ' ').trim().slice(0, RULE_PROMPT_WISH_MAX);
  return text || '(vul hier in wat de regel moet doen)';
}

function buildRulePrompt(wish){
  const lim = CUSTOM_LIMITS;
  const examples = RULES.filter(r => !r.custom && r.logic).map(r => '- ' + r.title + ': ' + describeRuleLogic(r.logic) + '\n  ' + JSON.stringify(r.logic));
  return [
    'Ik speel "Spel zonder spelelement", een kaartspel in de browser voor 2 tot 8 spelers (een variant op Oorlog: iedereen legt zijn bovenste kaart open, de hoogste kaart wint de pot, bij gelijke kaarten volgt een battle).',
    'Het spel kent extra regels die je zelf kunt toevoegen als een "regelblok": een stuk JSON dat het spel controleert en daarna uitvoert. Ik wil dat je voor mij zo\'n regelblok schrijft.',
    '',
    'Mijn regel:',
    rulePromptWish(wish),
    '',
    'Wat ik van je nodig heb',
    '- Geef precies één JSON-object in een codeblok, zonder commentaar in de JSON. Ik plak het rechtstreeks in het spel, en dat accepteert alleen geldige JSON.',
    '- Gebruik alleen de bouwstenen hieronder. Het spel weigert elk onbekend onderdeel.',
    '- Kan mijn regel niet met deze bouwstenen, schrijf dan géén blok dat er alleen op lijkt. Leg in gewone taal uit welke bouwsteen ontbreekt en stel de dichtstbijzijnde regel voor die wel kan.',
    '- De voorbeelden die je meegeeft worden door het spel nagespeeld. Klopt er één niet, dan wordt het hele blok afgekeurd; reken ze dus na.',
    '',
    'De vorm van een regelblok',
    '{',
    '  "id": "custom-" gevolgd door kleine letters, cijfers en streepjes (ten hoogste ' + lim.idMax + ' tekens),',
    '  "title": een korte naam (ten hoogste ' + lim.title + ' tekens),',
    '  "short": één zin voor bij het vinkje (ten hoogste ' + lim.short + ' tekens),',
    '  "description": de uitleg voor het regelboek (ten hoogste ' + lim.description + ' tekens),',
    '  "priority": een geheel getal van ' + lim.priorityMin + ' t/m ' + lim.priorityMax + ' (optioneel; eigen regels komen altijd na de regels van het spel),',
    '  "logic": wat de regel doet, zie hieronder,',
    '  "examples": 1 t/m ' + lim.examples + ' voorbeelden',
    '}',
    '',
    'Voorbeelden',
    '- Bij moment "decide" of "tiebreak": { "cards": ["K♠", "9♥", "3♦"], "winners": [1], "text": "uitleg" }. "cards" zijn de open kaarten per speler (2 t/m ' + lim.players + '), "winners" de nummers van de spelers die winnen of gaan battlen, geteld vanaf 0. In een voorbeeld staan alle andere extra regels uit.',
    '- Bij moment "award" of "roundEnd": { "decks": [["K", "4"], ["3"]], "after": [["4", "K", "3"], []], "discarded": 0, "text": "uitleg" }. "decks" zijn de stapels vóór één ronde (bovenste kaart eerst), "after" de stapels erna, "discarded" het aantal kaarten op de aflegstapel. De winnaar krijgt de pot onderop zijn stapel, in de volgorde waarin de kaarten zijn gelegd.',
    '- Een kaart is een waarde met eventueel een symbool: "K" of "K♠".',
    '',
    'De bouwstenen voor "logic"',
    RULE_PROMPT_GRAMMAR,
    '',
    'Zo zien de regels van het spel zelf eruit (ter voorbeeld; de zin erbij is hoe het spel de beschrijving leest)',
    examples.join('\n'),
    '',
    'Een volledig regelblok als voorbeeld',
    JSON.stringify(CUSTOM_RULE_SAMPLE, null, 2)
  ].join('\n');
}

// Haalt het regelblok uit een antwoord: is de tekst zelf geen JSON, dan het eerste codeblok (```), en anders alles van de eerste { tot
// de laatste }. Geeft de tekst ongewijzigd terug als er niets te vinden is (de controle meldt dan wat er mis is).
function extractRuleJson(text){
  if (typeof text !== 'string') return text;
  const tryParse = t => { try { const v = JSON.parse(t); return v !== null && typeof v === 'object'; } catch (e){ return false; } };
  const trimmed = text.trim();
  if (trimmed === '' || tryParse(trimmed)) return text;
  const fence = trimmed.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/);
  if (fence && tryParse(fence[1].trim())) return fence[1].trim();
  const first = trimmed.indexOf('{'), last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first && tryParse(trimmed.slice(first, last + 1))) return trimmed.slice(first, last + 1);
  return text;
}
