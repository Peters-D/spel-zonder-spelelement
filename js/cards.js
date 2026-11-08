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

function shuffle(arr){
  for (let i=arr.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}
function isRed(c){ return c.suit==='♥'||c.suit==='♦'; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
