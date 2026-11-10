// De winnaar kiest een regel: na een spel met een winnaar mag die winnaar één regel uit de catalogus (RULES in rules.js)
// omzetten voor het volgende spel: een regel die uit stond gaat aan, een regel die aan stond gaat uit. De keuze blijft bewaard in de
// browser en is daarna de standaard bij het startscherm (met "gekozen door ..." erbij). Er komen geen nieuwe regels bij: de
// winnaar kiest alleen uit de bestaande.
//
// Bewaard wordt: { <regel-id>: { on: true/false, by: 'naam van de winnaar' } }, alleen voor regels waar een winnaar iets aan veranderd
// heeft. Wat uit de opslag komt wordt altijd gecontroleerd (alleen bekende regels, alleen echte waarden).

const WINNER_RULES_KEY = 'spelzonderspelelement.winnaarsregels';
const WINNER_BY_MAX = 30;

function normalizeWinnerRules(data){
  const out = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const rule of RULES){
    if (!Object.prototype.hasOwnProperty.call(data, rule.id)) continue;
    const v = data[rule.id];
    if (!v || typeof v !== 'object' || typeof v.on !== 'boolean') continue;
    out[rule.id] = { on: v.on, by: typeof v.by === 'string' ? v.by.trim().slice(0, WINNER_BY_MAX) : '' };
  }
  return out;
}

function loadWinnerRules(){
  try {
    const text = localStorage.getItem(WINNER_RULES_KEY);
    return text ? normalizeWinnerRules(JSON.parse(text)) : {};
  } catch (e){ return {}; }
}

// Geeft false als bewaren niet lukt (bijvoorbeeld geblokkeerde opslag); het spel werkt dan gewoon door.
function saveWinnerRules(map){
  try { localStorage.setItem(WINNER_RULES_KEY, JSON.stringify(map)); return true; } catch (e){ return false; }
}

// Een nieuwe lijst waarin de regel de gekozen stand heeft (de oude lijst blijft ongewijzigd), of null als de keuze niet klopt.
function chooseWinnerRule(map, ruleId, on, by){
  if (!RULES.some(r => r.id === ruleId) || typeof on !== 'boolean') return null;
  return Object.assign({}, map, { [ruleId]: { on, by: typeof by === 'string' ? by.trim().slice(0, WINNER_BY_MAX) : '' } });
}

function applyWinnerRuleChoice(rule, on, byName){
  const next = chooseWinnerRule(loadWinnerRules(), rule.id, on, byName);
  if (next) saveWinnerRules(next);
  if (typeof markRuleChoice === 'function') markRuleChoice(rule.id, on, byName); // het vinkje op het startscherm
}

// Onder de eindbanner: de winnaar zet één regel om. Na één keuze verdwijnen de knoppen. Namen komen alleen als gewone tekst
// in de pagina.
function showWinnerRuleChoice(winner){
  const banner = document.getElementById('endBanner');
  const box = document.createElement('div');
  box.className = 'winner-choice';
  const intro = document.createElement('p');
  intro.textContent = winner.name + ' mag één regel omzetten voor het volgende spel:';
  box.appendChild(intro);
  const buttons = document.createElement('div');
  buttons.className = 'winner-choice-buttons';
  let done = false;
  // Doorgaan naar het volgende spel kan altijd, met of zonder een regel om te zetten (zie startNextGame in setup.js).
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'winner-next';
  nextBtn.textContent = 'Volgend spel ▶';
  nextBtn.addEventListener('click', () => startNextGame());
  for (const rule of RULES){
    const wasOn = !!(game && game.rules && game.rules[rule.id]);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = (wasOn ? 'Zet uit: ' : 'Zet aan: ') + rule.title;
    btn.addEventListener('click', () => {
      if (done) return;
      done = true;
      applyWinnerRuleChoice(rule, !wasOn, winner.name);
      box.innerHTML = '';
      const result = document.createElement('p');
      result.textContent = rule.title + ' staat in het volgende spel ' + (wasOn ? 'uit' : 'aan') + ', gekozen door ' + winner.name + '.';
      box.appendChild(result);
      box.appendChild(nextBtn);
    });
    buttons.appendChild(btn);
  }
  box.appendChild(buttons);
  box.appendChild(nextBtn);
  banner.appendChild(box);
}
