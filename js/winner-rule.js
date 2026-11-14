// De winnaar kiest een regel: na een spel met een winnaar mag die winnaar één regel uit de catalogus (RULES in rules.js)
// omzetten voor het volgende spel: een regel die uit stond gaat aan, een regel die aan stond gaat uit. De keuze geldt voor de spellen
// daarna zolang de pagina openstaat en staat op het startscherm als vinkje, met "gekozen door ..." erbij. Er komen geen nieuwe
// regels bij: de winnaar kiest alleen uit de bestaande.
//
// De keuze wordt nergens bewaard: na verversen (F5) is alles weer standaard. Eerdere versies bewaarden haar in de browser; wat daar
// nog staat wordt bij het laden gewist (forgetOldWinnerRules).

const WINNER_BY_MAX = 30;
const WINNER_OLD_STORAGE_KEY = 'spelzonderspelelement.winnaarsregels';
// { <regel-id>: { on: true/false, by: 'naam van de winnaar' } }, alleen voor regels waar een winnaar iets aan veranderd heeft
let winnerRules = {};
// De keuze die in het lopende spel al gemaakt is (de tekst ervan), of null. Een winnaar zet per spel één regel om: wie na de keuze
// een ronde terugstapt en het spel opnieuw uitspeelt, krijgt de knoppen niet nog een keer. Een nieuw spel begint weer met null.
let winnerChoiceDone = null;
function winnerChoiceReset(){
  winnerChoiceDone = null;
}

function currentWinnerRules(){
  return Object.assign({}, winnerRules);
}

function forgetOldWinnerRules(){
  try { localStorage.removeItem(WINNER_OLD_STORAGE_KEY); } catch (e){ /* geen opslag: er is niets te wissen */ }
}
forgetOldWinnerRules();

// Een nieuwe lijst waarin de regel de gekozen stand heeft (de oude lijst blijft ongewijzigd), of null als de keuze niet klopt.
function chooseWinnerRule(map, ruleId, on, by){
  if (!RULES.some(r => r.id === ruleId) || typeof on !== 'boolean') return null;
  return Object.assign({}, map, { [ruleId]: { on, by: typeof by === 'string' ? by.trim().slice(0, WINNER_BY_MAX) : '' } });
}

function applyWinnerRuleChoice(rule, on, byName){
  const next = chooseWinnerRule(winnerRules, rule.id, on, byName);
  if (next) winnerRules = next;
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
  if (winnerChoiceDone){ // in dit spel is al gekozen (het einde is opnieuw bereikt na "stap terug")
    intro.textContent = winnerChoiceDone;
    box.appendChild(nextBtn);
    banner.appendChild(box);
    return;
  }
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
      winnerChoiceDone = result.textContent;
      box.appendChild(result);
      box.appendChild(nextBtn);
    });
    buttons.appendChild(btn);
  }
  box.appendChild(buttons);
  box.appendChild(nextBtn);
  banner.appendChild(box);
}
