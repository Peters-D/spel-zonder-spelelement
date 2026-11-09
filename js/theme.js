// Thema's: de lijst, de keuze op het startscherm en het onthouden van die keuze.
// Een thema verandert alleen het uiterlijk: de spelkern (engine, regels, simulatie) kent geen thema's.
// De kleuren en versieringen per thema staan in css/themes.css; hier staan alleen de namen.
const THEMES = [
  { id: 'oorlog', name: 'Oorlog' },
  { id: 'sovjet', name: 'Sovjet' }
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

const themeButtons = [];

// Zet het thema (een onbekend thema wordt het standaardthema) en markeert de knop. Geeft het gekozen thema terug.
function applyTheme(id){
  if (!isKnownTheme(id)) id = DEFAULT_THEME;
  document.documentElement.dataset.theme = id;
  themeButtons.forEach(b => {
    const on = b.dataset.theme === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  return id;
}

const themeGrid = document.getElementById('themeGrid');
for (const t of THEMES){
  const b = document.createElement('button');
  b.className = 'count-btn theme-btn';
  b.textContent = t.name;
  b.dataset.theme = t.id;
  b.addEventListener('click', () => { themeSave(applyTheme(t.id)); });
  themeButtons.push(b);
  themeGrid.appendChild(b);
}
applyTheme(themeStored());
