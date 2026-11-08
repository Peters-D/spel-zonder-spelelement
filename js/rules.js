// Spelregels: bepalen wie een ronde wint.
let twoBeatsAceRule = false;

// If the 2-beats-Aas rule is on and both a 2 and an Aas are among the
// revealed cards, the 2(s) win outright over everyone — Aas included.
// Otherwise, normal highest-value comparison applies.
function findWinningPlayers(inPlay){
  if (twoBeatsAceRule){
    const twos = inPlay.filter(p => p.faceCard.rank === '2');
    const aces = inPlay.filter(p => p.faceCard.rank === 'A');
    if (twos.length > 0 && aces.length > 0){
      return twos;
    }
  }
  const maxVal = Math.max(...inPlay.map(p => p.faceCard.value));
  return inPlay.filter(p => p.faceCard.value === maxVal);
}
