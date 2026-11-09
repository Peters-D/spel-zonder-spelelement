// Thema's: de lijst, de keuze (een icoonknop rechtsboven met een uitklapmenu, zoals een taalkeuze) en het onthouden van die keuze.
// Een thema verandert alleen het uiterlijk: de spelkern (engine, regels, simulatie) kent geen thema's.
// De kleuren en versieringen per thema staan in css/themes.css; hier staan de naam en het icoon.
// Het icoon is voorlopig een emoji (die er per apparaat anders uitziet); het is één regel per thema om dat later te vervangen.
const THEMES = [
  { id: 'oorlog', name: 'Oorlog', icon: '\u{1FA96}' },        // 🪖
  { id: 'sovjet', name: 'Sovjet', icon: '\u{1F6E0}️' }    // 🛠️
];
const DEFAULT_THEME = 'oorlog';
const THEME_STORAGE_KEY = 'spelzonderspelelement.thema'; // dezelfde sleutel staat in het scriptje in de <head> van index.html

function isKnownTheme(id){
  return THEMES.some(t => t.id === id);
}

// Het onthouden werkt alleen als de browser het toestaat (privévenster, geblokkeerde opslag); zonder gaat het spel gewoon door.
function themeStored(){
  try { return localStorage.getItem(THEME_STORAGE_KEY); } catch (e){ return null; }
}
function themeSave(id){
  try { localStorage.setItem(THEME_STORAGE_KEY, id); } catch (e){ /* niet erg */ }
}

const themeSwitch = document.getElementById('themeSwitch');
const themeToggle = document.getElementById('themeToggle');
const themeToggleIcon = document.getElementById('themeToggleIcon');
const themeMenu = document.getElementById('themeMenu');
const themeItems = [];
let themeMenuIsOpen = false;

// Zet het thema (een onbekend thema wordt het standaardthema), toont het icoon en markeert het item in het menu.
// Geeft het gekozen thema terug.
function applyTheme(id){
  if (!isKnownTheme(id)) id = DEFAULT_THEME;
  const theme = THEMES.find(t => t.id === id);
  document.documentElement.dataset.theme = id;
  themeToggleIcon.textContent = theme.icon;
  themeToggle.setAttribute('aria-label', 'Thema: ' + theme.name + '. Kies een thema');
  themeItems.forEach(item => {
    const on = item.dataset.theme === id;
    item.classList.toggle('active', on);
    item.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  return id;
}

function themeMenuOpen(){
  themeMenuIsOpen = true;
  themeMenu.classList.remove('hidden');
  themeToggle.setAttribute('aria-expanded', 'true');
  const active = themeItems.find(item => item.classList.contains('active')) || themeItems[0];
  if (active) active.focus();
}

function themeMenuClose(){
  themeMenuIsOpen = false;
  themeMenu.classList.add('hidden');
  themeToggle.setAttribute('aria-expanded', 'false');
}

// Kiest een thema, bewaart de keuze, tekent de grafiek opnieuw (die haalt zijn kleuren uit het thema) en sluit het menu.
function themeChoose(id){
  themeSave(applyTheme(id));
  if (typeof renderStatsPanel === 'function') renderStatsPanel();
  themeMenuClose();
  themeToggle.focus();
}

// Escape sluit het menu; pijltjes bewegen door de items.
function themeOnKeydown(e){
  if (!themeMenuIsOpen) return;
  if (e.key === 'Escape'){
    themeMenuClose();
    themeToggle.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    const i = themeItems.findIndex(item => item === document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % themeItems.length : (i <= 0 ? themeItems.length - 1 : i - 1);
    themeItems[next].focus();
    if (e.preventDefault) e.preventDefault();
  }
}

// Een klik buiten de themakeuze sluit het menu. Klikken binnen de keuze komen hier niet (zie stopPropagation hieronder).
function themeOnDocumentClick(){
  if (themeMenuIsOpen) themeMenuClose();
}

for (const t of THEMES){
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'theme-item'; // niet 'count-btn': setup.js haalt bij een nieuw aantal spelers de markering van alle count-btn's weg
  item.setAttribute('role', 'menuitemradio');
  item.dataset.theme = t.id;
  const icon = document.createElement('span');
  icon.className = 'theme-item-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = t.icon;
  const name = document.createElement('span');
  name.textContent = t.name;
  item.appendChild(icon);
  item.appendChild(name);
  item.addEventListener('click', () => themeChoose(t.id));
  themeItems.push(item);
  themeMenu.appendChild(item);
}

themeToggle.addEventListener('click', () => { if (themeMenuIsOpen) themeMenuClose(); else themeMenuOpen(); });
themeSwitch.addEventListener('click', (e) => { if (e.stopPropagation) e.stopPropagation(); });
document.addEventListener('click', themeOnDocumentClick);
document.addEventListener('keydown', themeOnKeydown);
themeMenuClose();
applyTheme(themeStored());
