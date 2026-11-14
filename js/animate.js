// Animaties: kaarten schuiven zichtbaar naar de pot en naar de winnaar. Dit is alleen weergave: het spel zelf, de regels en de
// volgorde van de stappen veranderen niet.
//
// Hoe het werkt: het scherm wordt bij elke stap opnieuw opgebouwd (renderGrid in render.js). Vlak vóór zo'n stap maakt
// animCapture kopieën van de open kaarten en onthoudt waar ze staan; na de stap laat animFly die kopieën naar hun bestemming
// schuiven, in een losse laag boven de pagina. De echte pagina staat dan al in de eindstand. Daardoor geldt:
//   - animaties uit = precies het gedrag zonder dit bestand;
//   - een volgende stap (klik, auto-play, stap terug, doorspoelen) haalt lopende kopieën weg: niemand hoeft te wachten.
//
// Aan of uit: de schakelaar "Animaties" bij de bediening. De keuze wordt onthouden in de browser. Zonder eerdere keuze staan
// ze aan, behalve als het apparaat om minder beweging vraagt (prefers-reduced-motion). Bij auto-play sneller dan
// ANIM_MIN_STEP ms per stap worden ze overgeslagen, anders loopt het beeld achter.

const ANIM_STORAGE_KEY = 'spelzonderspelelement.animaties';
const ANIM_DURATION = 350;   // ms per beweging
const ANIM_MIN_STEP = 300;   // auto-play sneller dan dit: geen animaties
const ANIM_SUPPORTED = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

let animOn = false;
const animRunning = []; // kopieën die nu onderweg zijn

function animStored(){
  try { return localStorage.getItem(ANIM_STORAGE_KEY); } catch (e){ return null; }
}
function animSave(on){
  try { localStorage.setItem(ANIM_STORAGE_KEY, on ? 'aan' : 'uit'); } catch (e){ /* niet erg: de keuze geldt dan tot verversen */ }
}

// De stand zonder eerdere keuze: aan, tenzij het apparaat om minder beweging vraagt.
function animDefault(){
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !reduce;
}

function animSet(on){
  animOn = !!on;
  const toggle = document.getElementById('animToggle');
  if (toggle) toggle.checked = animOn;
  if (document.body && document.body.classList) document.body.classList.toggle('anim-on', animOn);
  if (!animOn) animFinishAll();
}

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

// Laat de kopieën naar een element schuiven (en daar klein en doorzichtig worden).
function animFly(ghosts, target){
  if (!ghosts || ghosts.length === 0 || !target || !animActive()) return;
  const to = target.getBoundingClientRect();
  const layer = animLayer();
  const duration = animDuration();
  for (const g of ghosts){
    const node = g.node;
    node.classList.remove('flip');
    node.style.animation = 'none'; // de kopie draait niet nog eens om
    node.classList.add('anim-ghost');
    node.style.left = g.rect.left + 'px';
    node.style.top = g.rect.top + 'px';
    node.style.width = g.rect.width + 'px';
    node.style.height = g.rect.height + 'px';
    layer.appendChild(node);
    const dx = (to.left + to.width / 2) - (g.rect.left + g.rect.width / 2);
    const dy = (to.top + to.height / 2) - (g.rect.top + g.rect.height / 2);
    const entry = { node, animation: null };
    entry.animation = node.animate(
      [{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.55)', opacity: 0.15 }],
      { duration, easing: 'ease-in', fill: 'forwards' });
    entry.animation.onfinish = () => {
      node.remove();
      const k = animRunning.indexOf(entry);
      if (k >= 0) animRunning.splice(k, 1);
    };
    animRunning.push(entry);
  }
}

// Naar het vak van een speler (zijn kaart), of naar de pot.
function animFlyToPlayer(ghosts, playerId){
  if (!ghosts || ghosts.length === 0 || !game) return;
  const index = game.players.findIndex(p => p.id === playerId);
  const slot = document.querySelectorAll('#playerGrid .pslot')[index];
  animFly(ghosts, slot ? slot.querySelector('.card') : null);
}
function animFlyToPot(ghosts){
  if (!ghosts || ghosts.length === 0) return;
  animFly(ghosts, document.querySelector('#potPile .pot-stack'));
}

// De schakelaar.
(function(){
  const stored = animStored();
  animSet(stored === 'aan' ? true : stored === 'uit' ? false : animDefault());
  const toggle = document.getElementById('animToggle');
  if (toggle && toggle.addEventListener) toggle.addEventListener('change', () => { animSet(toggle.checked); animSave(animOn); });
})();
