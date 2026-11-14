// Regelboek: een venster met alle regels, opgebouwd uit de catalogus (RULES en BASE_RULES in rules.js).
// Er staat hier geen uitleg van regels zelf: alles komt uit rules.js, zodat tekst en voorbeelden niet kunnen afwijken.

// Kleine hulp om een element met klasse en tekst te maken (alleen createElement/textContent, geen losse HTML).
function rbEl(tag, className, text){
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Een voorbeeld: kaartjes per speler, winnaars gemarkeerd (met ★ en rand, niet alleen met kleur), uitleg eronder.
function rbBuildExample(ex, allRules){
  const box = rbEl('div', 'rb-example');
  if (ex.with && ex.with.length > 0){
    const titles = ex.with.map(id => (allRules.find(r => r.id === id) || { title: id }).title);
    box.appendChild(rbEl('div', 'rb-with', 'Met erbij: ' + titles.join(', ')));
  }
  if (isScenarioExample(ex)){
    rbBuildScenario(ex, box);
    return box;
  }
  const row = rbEl('div', 'rb-cards');
  ex.cards.forEach((text, i) => {
    const card = parseExampleCard(text);
    const isWinner = ex.winners.includes(i);
    const player = rbEl('div', 'rb-player ' + (isWinner ? 'rb-winner' : 'rb-out'));
    player.appendChild(rbEl('div', 'rb-card' + (card.suit && isRed(card) ? ' red-suit' : ''), card.rank + (card.suit || '')));
    player.appendChild(rbEl('div', 'rb-caption', 'Speler ' + (i + 1) + (isWinner ? ' ★' : '')));
    row.appendChild(player);
  });
  box.appendChild(row);
  box.appendChild(rbEl('p', 'rb-example-text', ex.text));
  return box;
}

// Een scenario: per speler de stapel vóór en na een ronde (bovenste kaart links), en hoeveel kaarten er zijn afgelegd.
function rbBuildScenario(ex, box){
  box.appendChild(rbEl('div', 'rb-with', 'Stapels vóór en na één ronde (bovenste kaart links)'));
  const chips = (parent, cards) => {
    if (cards.length === 0) parent.appendChild(rbEl('span', 'rb-none', 'uit'));
    for (const text of cards){
      const card = parseExampleCard(text);
      parent.appendChild(rbEl('div', 'rb-card rb-mini' + (card.suit && isRed(card) ? ' red-suit' : ''), card.rank + (card.suit || '')));
    }
  };
  ex.decks.forEach((deck, i) => {
    const row = rbEl('div', 'rb-scenario-row');
    row.appendChild(rbEl('div', 'rb-caption rb-scenario-name', 'Speler ' + (i + 1)));
    const before = rbEl('div', 'rb-scenario-deck');
    chips(before, deck);
    row.appendChild(before);
    row.appendChild(rbEl('span', 'rb-arrow', '→'));
    const after = rbEl('div', 'rb-scenario-deck');
    chips(after, ex.after[i]);
    row.appendChild(after);
    box.appendChild(row);
  });
  box.appendChild(rbEl('div', 'rb-scenario-discard', 'Aflegstapel: ' + ex.discarded + (ex.discarded === 1 ? ' kaart' : ' kaarten')));
  box.appendChild(rbEl('p', 'rb-example-text', ex.text));
}

// Bouwt de inhoud van het regelboek.
//   rules:  de catalogus van extra regels (RULES)
//   base:   de basisregels (BASE_RULES)
//   active: { regel-id: true/false }, welke extra regels aan staan
function buildRulebook(rules, base, active){
  const root = rbEl('div', 'rb-root');

  root.appendChild(rbEl('h3', 'rb-heading', 'Basisregels'));
  for (const section of base){
    const box = rbEl('section', 'rb-section');
    box.appendChild(rbEl('h4', 'rb-title', section.title));
    box.appendChild(rbEl('p', 'rb-text', section.description));
    for (const ex of section.examples || []) box.appendChild(rbBuildExample(ex, rules));
    root.appendChild(box);
  }

  root.appendChild(rbEl('h3', 'rb-heading', 'Extra regels'));
  for (const rule of rules){
    const on = !!active[rule.id];
    const box = rbEl('section', 'rb-section rb-rule');
    const head = rbEl('div', 'rb-rule-head');
    head.appendChild(rbEl('h4', 'rb-title rb-rule-title', rule.title));
    head.appendChild(rbEl('span', 'rb-badge ' + (on ? 'rb-on' : 'rb-off'), on ? 'aan' : 'uit'));
    box.appendChild(head);
    box.appendChild(rbEl('p', 'rb-text rb-rule-text', rule.description));
    const note = on && typeof rule.stateNote === 'function' ? rule.stateNote(active, true) : null;
    if (note) box.appendChild(rbEl('p', 'rb-text rb-rule-note', note));
    for (const ex of rule.examples || []) box.appendChild(rbBuildExample(ex, rules));
    root.appendChild(box);
  }

  // De volgorde waarin de extra regels worden toegepast (uit de prioriteit in de catalogus).
  // Alleen regels die kunnen beslissen wie een ronde wint doen mee aan de botsingen.
  const ordered = rules.filter(r => typeof r.decide === 'function' || typeof r.breakTie === 'function').sort((a, b) => a.priority - b.priority);
  const order = rbEl('section', 'rb-section rb-order');
  order.appendChild(rbEl('h3', 'rb-heading', 'Volgorde bij botsingen'));
  order.appendChild(rbEl('p', 'rb-text',
    'Staan er meer extra regels aan, dan beslist de eerste regel in deze lijst die iets te zeggen heeft. ' +
    'Heeft geen enkele regel iets te zeggen, dan wint de hoogste kaart. ' +
    'Blijft er daarna een gelijkspel over en staat "Bij gelijkspel beslist het symbool" aan, dan beslist het symbool.'));
  const list = rbEl('ol', 'rb-order-list');
  for (const rule of ordered){
    list.appendChild(rbEl('li', 'rb-order-item' + (active[rule.id] ? ' rb-on' : ''), rule.title + (active[rule.id] ? ' (aan)' : ' (uit)')));
  }
  order.appendChild(list);
  root.appendChild(order);
  return root;
}

// ---- het venster ----
let rulebookOpener = null;

// Welke extra regels aan staan: in het spel de regels van het lopende spel, op het startscherm de vinkjes.
function currentRuleState(){
  const gameVisible = !document.getElementById('game').classList.contains('hidden');
  if (gameVisible && game) return Object.assign({}, game.rules);
  const state = {};
  for (const rule of RULES) state[rule.id] = document.getElementById(rule.id + 'Input').checked;
  if (typeof readSuitOrder === 'function') state.suitOrder = readSuitOrder(); // de volgorde die nu op het startscherm staat
  return state;
}

function openRulebook(opener){
  rulebookOpener = opener || null;
  const body = document.getElementById('rulebookBody');
  body.innerHTML = '';
  body.appendChild(buildRulebook(RULES, BASE_RULES, currentRuleState()));
  const box = document.getElementById('rulebook');
  box.classList.add('show');
  box.setAttribute('aria-hidden', 'false');
  document.getElementById('rulebookInner').scrollTop = 0;
  document.getElementById('rulebookClose').focus();
}

function closeRulebook(){
  const box = document.getElementById('rulebook');
  box.classList.remove('show');
  box.setAttribute('aria-hidden', 'true');
  if (rulebookOpener && rulebookOpener.focus) rulebookOpener.focus();
  rulebookOpener = null;
}

for (const id of ['rulebookBtnSetup', 'rulebookBtnGame']){
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => openRulebook(btn));
}
document.getElementById('rulebookClose').addEventListener('click', closeRulebook);
document.getElementById('rulebook').addEventListener('click', (e) => {
  if (e.target.id === 'rulebook') closeRulebook(); // buiten het venster klikken
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('rulebook').classList.contains('show')) closeRulebook();
});
