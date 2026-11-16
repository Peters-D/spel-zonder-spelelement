// Animaties: kaarten schuiven zichtbaar naar de pot en naar de winnaar. Dit is alleen weergave: het spel zelf, de regels en de
// volgorde van de stappen veranderen niet.
//
// Hoe het werkt: het scherm wordt bij elke stap opnieuw opgebouwd (renderGrid in render.js). Vlak vóór zo'n stap maakt
// animCapture kopieën van de open kaarten en onthoudt waar ze staan; na de stap laat animFly die kopieën naar hun bestemming
// schuiven, in een losse laag boven de pagina. De echte pagina staat dan al in de eindstand. Daardoor geldt:
//   - animaties uit = precies het gedrag zonder dit bestand;
//   - een volgende stap (klik, auto-play, stap terug, doorspoelen) haalt lopende kopieën weg: niemand hoeft te wachten.
//
// De animaties staan altijd aan, er is geen schakelaar. Eén uitzondering: vraagt het apparaat om minder beweging
// (prefers-reduced-motion), dan blijven ze uit. Bij auto-play sneller dan ANIM_MIN_STEP ms per stap worden ze overgeslagen,
// anders loopt het beeld achter.

const ANIM_STORAGE_KEY = 'spelzonderspelelement.animaties';
const ANIM_DURATION = 350;   // ms per beweging
const ANIM_MIN_STEP = 300;   // auto-play sneller dan dit: geen animaties
const ANIM_SUPPORTED = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

const animRunning = []; // kopieën die nu onderweg zijn

// Aan, tenzij het apparaat om minder beweging vraagt.
const animOn = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// Lopen er nu animaties mee? Niet als ze uit staan, de browser ze niet kan, of auto-play te snel gaat.
function animActive(){
  if (!animOn || !ANIM_SUPPORTED) return false;
  if (typeof autoPlayActive !== 'undefined' && autoPlayActive && autoPlaySpeed < ANIM_MIN_STEP) return false;
  return true;
}

// Bij auto-play duurt een beweging nooit langer dan (bijna) de tijd tot de volgende stap.
function animDuration(){
  const step = typeof autoPlayActive !== 'undefined' && autoPlayActive ? autoPlaySpeed * 0.8 : ANIM_DURATION;
  return Math.min(ANIM_DURATION, step);
}

// Haalt alle kopieën die onderweg zijn weg: het beeld springt naar de eindstand (die staat er al onder).
function animFinishAll(){
  while (animRunning.length){
    const g = animRunning.pop();
    if (g.animation) g.animation.cancel();
    g.node.remove();
  }
}

function animLayer(){
  let layer = document.getElementById('animLayer');
  if (!layer){
    layer = document.createElement('div');
    layer.id = 'animLayer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

// Kopieën van de open kaarten op tafel, met hun plek, vóórdat het scherm opnieuw wordt opgebouwd.
// keep(player) kiest welke spelers meedoen (zonder keep: iedereen met een open kaart). Geeft [] als animaties niet meelopen.
function animCapture(keep){
  if (!animActive() || !game) return [];
  const out = [];
  document.querySelectorAll('#playerGrid .pslot').forEach((slot, i) => {
    const card = slot.querySelector('.card');
    const player = game.players[i];
    if (!card || !player || card.classList.contains('back')) return;
    if (keep && !keep(player)) return;
    // De plek zonder een eventuele lopende draai-animatie: het midden van de kaart en zijn gewone maat (een kaart die nog
    // aan het omdraaien is, is op dat moment smal).
    const r = card.getBoundingClientRect();
    const w = card.offsetWidth || r.width, h = card.offsetHeight || r.height;
    out.push({ node: card.cloneNode(true), rect: { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h } });
  });
  return out;
}

// Zet één kopie in de laag en laat hem naar een element schuiven (en daar klein en doorzichtig worden).
// g: { node, rect }, target: het element waar hij heen gaat, delay: ms wachten (de kopie blijft zolang op zijn plek staan),
// label: waar hij heen gaat, als data-to op de kopie (voor de tests en om te kunnen nakijken).
function animFlyOne(g, target, delay, label){
  if (!target) return;
  const to = target.getBoundingClientRect();
  const node = g.node;
  node.classList.remove('flip');
  node.style.animation = 'none'; // de kopie draait niet nog eens om
  node.classList.add('anim-ghost');
  node.style.left = g.rect.left + 'px';
  node.style.top = g.rect.top + 'px';
  node.style.width = g.rect.width + 'px';
  node.style.height = g.rect.height + 'px';
  if (label) node.dataset.to = label;
  animLayer().appendChild(node);
  const dx = (to.left + to.width / 2) - (g.rect.left + g.rect.width / 2);
  const dy = (to.top + to.height / 2) - (g.rect.top + g.rect.height / 2);
  const entry = { node, animation: null };
  entry.animation = node.animate(
    [{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.55)', opacity: 0.15 }],
    { duration: animDuration(), delay: delay || 0, easing: 'ease-in', fill: 'both' });
  entry.animation.onfinish = () => {
    node.remove();
    const k = animRunning.indexOf(entry);
    if (k >= 0) animRunning.splice(k, 1);
  };
  animRunning.push(entry);
}

// Laat de kopieën naar een element schuiven.
function animFly(ghosts, target, label){
  if (!ghosts || ghosts.length === 0 || !target || !animActive()) return;
  for (const g of ghosts) animFlyOne(g, target, 0, label);
}

function animSlotCard(index){
  const slot = document.querySelectorAll('#playerGrid .pslot')[index];
  return slot ? slot.querySelector('.card') : null;
}
function animPotElement(){ return document.querySelector('#potPile .pot-stack'); }
function animDiscardElement(){ return document.querySelector('#discardPile .discard-stack'); }

// Naar het vak van een speler (zijn kaart), of naar de pot.
function animFlyToPlayer(ghosts, playerId){
  if (!ghosts || ghosts.length === 0 || !game) return;
  const index = game.players.findIndex(p => p.id === playerId);
  animFly(ghosts, animSlotCard(index), 'player-' + index);
}
function animFlyToPot(ghosts){
  if (!ghosts || ghosts.length === 0) return;
  animFly(ghosts, animPotElement(), 'pot');
}

// Een nieuw kaartje voor de laag: een open kaart (zoals op tafel) of, zonder kaart, een dichte kaart.
function animMakeCard(card){
  const el = document.createElement('div');
  if (!card){ el.className = 'card back'; return el; }
  el.className = 'card' + (isRed(card) ? ' red-suit' : '');
  el.textContent = card.rank + card.suit;
  el.dataset.card = cardKey(card);
  return el;
}

// De plek van een element met de maat van een kaart, gecentreerd op dat element (voor kaarten die uit de pot vertrekken).
function animRectAt(el, size){
  const r = el.getBoundingClientRect();
  return { left: r.left + r.width / 2 - size.width / 2, top: r.top + r.height / 2 - size.height / 2, width: size.width, height: size.height };
}
function animCardSize(){
  const any = document.querySelector('#playerGrid .card');
  return any ? { width: any.offsetWidth, height: any.offsetHeight } : null;
}

const animSame = (a, b) => a && b && a.rank === b.rank && a.suit === b.suit;

// Het opruimen van de tafel: álle kaarten van de pot van deze ronde gaan zichtbaar naar waar ze terechtkwamen (de stapel van een
// speler of de aflegstapel), dus ook de kaarten die bij een battle al in de pot lagen. Aanroepen vóór het scherm opnieuw wordt
// opgebouwd; het resultaat gaat daarna naar animRunClear. Kaarten die open in een vak liggen vertrekken daar, de rest uit de pot.
function animPlanClear(potCards){
  if (!animActive() || !game || !potCards || potCards.length === 0) return [];
  const size = animCardSize(), pot = animPotElement();
  if (!size || !pot) return [];
  const plan = [];
  let fromPot = 0;
  potCards.forEach(card => {
    const owner = game.players.findIndex(p => p.deck.some(c => animSame(c, card)));
    const to = owner >= 0 ? 'player-' + owner : game.discard.some(c => animSame(c, card)) ? 'discard' : null;
    if (!to) return;
    const at = game.players.findIndex(p => animSame(p.faceCard, card));
    const shown = at >= 0 ? animSlotCard(at) : null;
    if (shown && !shown.classList.contains('back')){
      const r = shown.getBoundingClientRect();
      plan.push({ node: shown.cloneNode(true), rect: { left: r.left + r.width / 2 - size.width / 2, top: r.top + r.height / 2 - size.height / 2, width: size.width, height: size.height }, to, order: -1 });
    } else {
      plan.push({ node: animMakeCard(card), rect: animRectAt(pot, size), to, order: fromPot++ });
    }
  });
  return plan;
}

// Na het opnieuw opbouwen van het scherm: de kaarten van animPlanClear vertrekken. Kaarten uit de pot gaan kort na elkaar.
function animRunClear(plan){
  if (!plan || plan.length === 0 || !animActive()) return;
  const fromPot = plan.filter(x => x.order >= 0).length;
  const gap = fromPot > 1 ? Math.min(45, animDuration() / fromPot) : 0;
  for (const item of plan){
    const target = item.to === 'discard' ? animDiscardElement() : animSlotCard(Number(item.to.slice('player-'.length)));
    animFlyOne(item, target, item.order >= 0 ? item.order * gap : 0, item.to);
  }
}

// Kaarten die een regel van de ene speler naar de andere verplaatst (bijv. Revival): een dichte kaart per overdracht.
function animFlyTransfers(transfers){
  if (!transfers || transfers.length === 0 || !animActive() || !game) return;
  const size = animCardSize();
  if (!size) return;
  for (const t of transfers){
    const from = game.players.findIndex(p => p.id === t.from.id), to = game.players.findIndex(p => p.id === t.to.id);
    const src = animSlotCard(from);
    if (!src) continue;
    animFlyOne({ node: animMakeCard(null), rect: animRectAt(src, size) }, animSlotCard(to), 0, 'player-' + to);
  }
}

// Een eerdere versie bewaarde de keuze van de schakelaar in de browser; die is er niet meer en wordt gewist.
(function(){
  if (document.body && document.body.classList) document.body.classList.toggle('anim-on', animOn);
  try { localStorage.removeItem(ANIM_STORAGE_KEY); } catch (e){ /* geen opslag: er is niets te wissen */ }
})();
