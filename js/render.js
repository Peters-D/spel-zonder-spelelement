// Weergave: tafel, spelers, stapelviewer, pot en controle op 52 kaarten.
function setDispatch(text, isWar){
  const el = document.getElementById('dispatch');
  el.className = 'dispatch' + (isWar ? ' war' : '');
  el.textContent = text;
}

function renderGrid(faceDown, warFlags){
  const grid = document.getElementById('playerGrid');
  grid.innerHTML = '';
  const inBattle = (phase === 'battle-pending' || phase === 'battle-revealed');
  players.forEach((p, i) => {
    const slot = document.createElement('div');
    const isTied = inBattle && !p.out && game.contenders.includes(p.id);
    slot.className = 'pslot' + (p.out ? ' eliminated' : '') + (warFlags && warFlags[i] ? ' winner-flash' : '') + (isTied ? ' tie-flash' : '');
    const pname = document.createElement('div');
    pname.className = 'pname';
    pname.textContent = p.name;
    const cardEl = document.createElement('div');
    const isSidelined = inBattle && !p.out && !game.contenders.includes(p.id);
    if (p.out){
      cardEl.className = 'card back';
      cardEl.style.opacity = '0.4';
    } else if (isSidelined){
      cardEl.className = 'card back';
      cardEl.style.opacity = '0.35';
    } else if (faceDown || !p.faceCard){
      cardEl.className = 'card back';
    } else {
      cardEl.className = 'card flip' + (isRed(p.faceCard) ? ' red-suit' : '');
      cardEl.textContent = p.faceCard.rank + p.faceCard.suit;
      cardEl.dataset.card = cardKey(p.faceCard);
    }
    const pcount = document.createElement('div');
    pcount.className = 'pcount';
    pcount.textContent = isSidelined ? 'in de pot' : (p.deck.length + ' kaarten');
    const phint = document.createElement('div');
    phint.className = 'phint';
    phint.textContent = 'tik voor stapel';
    slot.appendChild(pname);
    slot.appendChild(cardEl);
    slot.appendChild(pcount);
    slot.appendChild(phint);
    slot.addEventListener('click', () => showDeckViewer(p));
    grid.appendChild(slot);
  });
  updatePotPile();
  updateDiscardPile();
  updateIntegrity();
}

// Venster met een lijst kaarten, bovenste kaart eerst (stapel van een speler of de aflegstapel).
function showCardList(title, subtitle, cards, emptyText){
  document.getElementById('deckViewerTitle').textContent = title;
  document.getElementById('deckViewerSub').textContent = subtitle;
  const listEl = document.getElementById('deckViewerList');
  listEl.innerHTML = '';
  if (cards.length === 0){
    const empty = document.createElement('div');
    empty.className = 'deck-viewer-empty';
    empty.textContent = emptyText;
    listEl.appendChild(empty);
  } else {
    cards.forEach(c => {
      const cd = document.createElement('div');
      cd.className = 'deck-viewer-card' + (isRed(c) ? ' red-suit' : '');
      cd.textContent = c.rank + c.suit;
      cd.dataset.card = cardKey(c);
      listEl.appendChild(cd);
    });
  }
  document.getElementById('deckViewer').classList.add('show');
}

function showDeckViewer(p){
  showCardList(p.name + ' — stapel (' + p.deck.length + ')', 'Bovenste kaart eerst', p.deck, 'Geen kaarten meer.');
}

// De aflegstapel ligt gesloten, maar op volgorde: hier zie je de kaarten.
function showDiscardViewer(){
  showCardList('Aflegstapel (' + game.discard.length + ')', 'Ligt gesloten, op volgorde. Bovenste kaart eerst.', game.discard, 'De aflegstapel is leeg.');
}

function hideDeckViewer(){
  document.getElementById('deckViewer').classList.remove('show');
}
document.getElementById('deckViewerClose').addEventListener('click', hideDeckViewer);
document.getElementById('discardPile').addEventListener('click', showDiscardViewer);
document.getElementById('deckViewer').addEventListener('click', (e) => {
  if (e.target.id === 'deckViewer') hideDeckViewer();
});

function updateIntegrity(){
  const line = document.getElementById('integrityLine');
  const totalEl = document.getElementById('totalCount');
  const statusEl = document.getElementById('integrityStatus');
  // "In het spel" zijn de stapels en de pot; afgelegde kaarten staan er apart bij. Samen moeten het er 52 zijn.
  const inGame = players.reduce((sum, p) => sum + p.deck.length, 0) + game.pot.length;
  const away = game.discard.length;
  totalEl.textContent = inGame;
  document.getElementById('discardNote').textContent = away > 0 ? ' (afgelegd: ' + away + ')' : '';
  if (inGame + away === 52){
    statusEl.textContent = '✓ klopt';
    line.classList.remove('mismatch');
  } else {
    statusEl.textContent = '⚠ klopt niet (verwacht 52)';
    line.classList.add('mismatch');
  }
}

// De aflegstapel is alleen zichtbaar als een actieve regel hem gebruikt of er kaarten op liggen.
function updateDiscardPile(){
  const used = game.discard.length > 0 || RULES.some(r => r.usesDiscard && game.rules[r.id]);
  document.getElementById('discardPile').classList.toggle('hidden', !used);
  document.getElementById('discardCount').textContent = game.discard.length;
}

function updatePotPile(){
  const potPile = document.getElementById('potPile');
  const potCount = document.getElementById('potCount');
  potCount.textContent = displayPot;
  if (displayPot > 0){
    potPile.classList.remove('empty');
  } else {
    potPile.classList.add('empty');
  }
}

function showStamp(text, color){
  const bf = document.getElementById('battlefield');
  const s = document.createElement('div');
  s.className = 'stamp';
  s.textContent = text;
  if (color) s.style.borderColor = color, s.style.color = color;
  bf.appendChild(s);
  requestAnimationFrame(()=>s.classList.add('show'));
  setTimeout(()=>s.remove(), 900);
}

