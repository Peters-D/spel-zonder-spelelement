// Spelregels. Alle instelbare regels staan in één object; de spelkern (engine.js)
// geeft dat object door, zodat elke regel overal hetzelfde wordt toegepast.
const DEFAULT_RULES = {
  twoBeatsAce: false, // 2 verslaat Aas: ligt er een Aas, dan wint de 2 van alle kaarten
  battleFirst: false  // gelijke kaarten gaan voor: een paar begint een battle, ook als een andere kaart hoger is
};

// Bepaalt wie van de spelers in inPlay de ronde (voorlopig) wint.
// Meer dan één speler terug betekent gelijkspel → battle.
// Regel battleFirst (gaat vóór alle andere regels): liggen er kaarten van dezelfde waarde, dan
//   battlen alleen die spelers, ook als een andere speler een hogere kaart heeft. Zijn er meer
//   paren, dan battlet het paar met de hoogste waarde. De overige spelers doen niet meer mee.
// Regel twoBeatsAce: liggen er zowel een 2 als een Aas, dan winnen de 2('s) van alle andere kaarten,
//   ook van een K (anders zou 2 > A > K > 2 een cirkel zijn). Zonder Aas is de 2 gewoon de laagste kaart.
// Anders wint de hoogste kaart.
function findWinningPlayers(inPlay, rules){
  if (rules.battleFirst){
    const pairs = new Map(); // waarde -> spelers met die kaart
    for (const p of inPlay){
      if (!pairs.has(p.faceCard.value)) pairs.set(p.faceCard.value, []);
      pairs.get(p.faceCard.value).push(p);
    }
    let best = null;
    for (const [value, group] of pairs){
      if (group.length >= 2 && (best === null || value > best[0])) best = [value, group];
    }
    if (best) return best[1];
  }
  if (rules.twoBeatsAce){
    const twos = inPlay.filter(p => p.faceCard.rank === '2');
    const aces = inPlay.filter(p => p.faceCard.rank === 'A');
    if (twos.length > 0 && aces.length > 0){
      return twos;
    }
  }
  const maxVal = Math.max(...inPlay.map(p => p.faceCard.value));
  return inPlay.filter(p => p.faceCard.value === maxVal);
}
