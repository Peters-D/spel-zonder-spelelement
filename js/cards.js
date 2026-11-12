// Kaarten, seed-RNG en kleine hulpfuncties.
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function formatNamesNL(names){
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' en ' + names[names.length - 1];
}

function buildDeck(){
  const deck = [];
  for (const s of SUITS) for (let i=0;i<RANKS.length;i++) deck.push({rank:RANKS[i], suit:s, value:i+2});
  return deck;
}

// Seeded RNG support — for reproducible test games. Defaults to Math.random.
let rng = Math.random;
function hashSeed(str){
  let h = 0;
  for (let i=0;i<str.length;i++){ h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
  return h;
}
function mulberry32(seed){
  let a = seed;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// De volgende seed, afgeleid van de huidige zodat het te herhalen is:
//   "1000" -> "1001", "test123" -> "test124", "007" -> "008" (voorloopnullen blijven), "test" -> "test2".
// Is er geen seed (leeg veld), dan een willekeurig getal van vier cijfers (randomFn is er voor de test).
function nextSeed(seed, randomFn){
  const s = String(seed || '').trim();
  if (s === '') return String(1000 + Math.floor((randomFn || Math.random)() * 9000));
  const m = s.match(/^(.*?)(\d+)$/);
  if (!m) return s + '2';
  return m[1] + (BigInt(m[2]) + 1n).toString().padStart(m[2].length, '0');
}

function shuffle(arr){
  for (let i=arr.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}
// Korte sleutel per kaart, bijv. "h14" voor A♥: een thema met eigen kaarten koppelt daar een afbeelding aan (css/cards-bobr.css).
const SUIT_KEY = {'♠':'s','♥':'h','♦':'d','♣':'c'};
function cardKey(c){ return SUIT_KEY[c.suit] + c.value; }
function isRed(c){ return c.suit==='♥'||c.suit==='♦'; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
