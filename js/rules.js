// Spelregels: de catalogus van extra regels.
//
// Elke extra regel is hier EEN object met alles wat erbij hoort:
//   id          sleutel in het regels-object dat de spelkern doorgeeft (en in de testsleutels)
//   priority    volgorde van toepassen; een lager getal gaat eerst. Dit bepaalt echt de werking.
//   title       naam van de regel
//   short       korte tekst bij het vinkje op het startscherm
//   description uitleg voor het regelboek
//   default     staat de regel standaard aan?
//   examples    voorbeelden: { cards: [kaarten die open liggen, per speler], winners: [indexen van de
//               spelers die (voorlopig) winnen of gaan battlen], text: uitleg, with: [andere regels
//               die in dit voorbeeld ook aan staan] }. Ze worden getoond in het regelboek EN door de
//               test uitgevoerd tegen decide(): een voorbeeld dat het spel anders speelt, laat de test falen.
//   decide      decide(inPlay) geeft de winnende spelers terug, of null als de regel niets beslist
//   overruledMessage (optioneel) tekst voor spelers die zonder deze regel hadden gewonnen
//
// Een nieuwe regel toevoegen = een object toevoegen aan RULES. De volgorde van RULES is de volgorde
// van de vinkjes op het scherm.
const RULES = [
  {
    id: 'twoBeatsAce',
    priority: 20,
    title: '2 verslaat Aas',
    short: '2 verslaat Aas (ligt er een Aas, dan wint de 2 van alle kaarten)',
    description: 'Liggen er zowel een 2 als een Aas, dan wint de 2 van alle kaarten op tafel, dus ook van een K. ' +
      'Zo blijft er altijd een duidelijke winnaar: zonder deze afspraak zou 2 verslaat A, A verslaat K en K verslaat 2 een cirkel zijn. ' +
      'Ligt er geen Aas, dan is de 2 gewoon de laagste kaart. Liggen er meerdere 2\'s, dan battlen die.',
    default: false,
    examples: [
      { cards: ['2', 'A'], winners: [0], text: 'De 2 wint van de Aas.' },
      { cards: ['2', 'A', 'K'], winners: [0], text: 'De 2 wint van alles, ook van de K.' },
      { cards: ['2', 'K'], winners: [1], text: 'Zonder Aas is de 2 gewoon de laagste kaart: de K wint.' },
      { cards: ['2', '2', 'A'], winners: [0, 1], text: 'Twee 2\'s: die battlen. De Aas doet niet mee.' },
      { cards: ['2', 'A', 'A'], winners: [0], text: 'De 2 wint van beide Azen.' },
      { cards: ['2', 'A', '7', '7'], with: ['battleFirst'], winners: [2, 3],
        text: 'Met "Gelijke kaarten gaan voor" erbij gaat het paar voor: de zevens battlen.' }
    ],
    decide(inPlay){
      const twos = inPlay.filter(p => p.faceCard.rank === '2');
      const aces = inPlay.filter(p => p.faceCard.rank === 'A');
      return twos.length > 0 && aces.length > 0 ? twos : null;
    }
  },
  {
    id: 'battleFirst',
    priority: 10,
    title: 'Gelijke kaarten gaan voor',
    short: 'Gelijke kaarten gaan voor (een paar begint een battle, ook als een andere kaart hoger is)',
    description: 'Liggen er twee of meer kaarten van dezelfde waarde, dan begint daar een battle, ook als een andere speler ' +
      'een hogere kaart heeft. Liggen er meerdere paren, dan battlet het hoogste paar. De overige spelers doen niet meer mee; ' +
      'hun kaarten blijven in de pot. De regel geldt ook in elke volgende battle-ronde en gaat vóór andere extra regels. ' +
      'Met 2 spelers verandert er niets.',
    default: false,
    examples: [
      { cards: ['A', '3', '3'], winners: [1, 2], text: 'Aas, 3 en 3: de twee drieën battlen. De Aas doet niet mee.' },
      { cards: ['A', '3', '3', '7', '7'], winners: [3, 4], text: 'Twee paren: het hoogste paar (de zevens) battlet.' },
      { cards: ['3', '3', '3', 'A'], winners: [0, 1, 2], text: 'Drie gelijke kaarten battlen allemaal.' },
      { cards: ['A', 'K', 'Q'], winners: [0], text: 'Zonder paar wint gewoon de hoogste kaart.' },
      { cards: ['2', 'A', 'A'], with: ['twoBeatsAce'], winners: [1, 2],
        text: 'Met "2 verslaat Aas" erbij gaat het paar voor: de Azen battlen, de 2 doet niet mee.' }
    ],
    decide(inPlay){
      const groups = new Map(); // waarde -> spelers met die kaart
      for (const p of inPlay){
        if (!groups.has(p.faceCard.value)) groups.set(p.faceCard.value, []);
        groups.get(p.faceCard.value).push(p);
      }
      let best = null;
      for (const [value, group] of groups){
        if (group.length >= 2 && (best === null || value > best[0])) best = [value, group];
      }
      return best ? best[1] : null;
    },
    overruledMessage: names => names + ' had de winnende kaart, maar gelijke kaarten gaan voor.'
  }
];

// Alle regels staan standaard op hun default (afgeleid uit de catalogus).
const DEFAULT_RULES = Object.fromEntries(RULES.map(r => [r.id, r.default]));

// Regels in de volgorde waarin ze worden toegepast.
const RULES_BY_PRIORITY = RULES.slice().sort((a, b) => a.priority - b.priority);

// Bepaalt wie van de spelers in inPlay de ronde (voorlopig) wint. Geeft { winners, rule } terug:
// rule is de regel die besliste, of null als de hoogste kaart wint. Meer dan één winnaar
// betekent gelijkspel → battle.
function decideRound(inPlay, rules){
  for (const rule of RULES_BY_PRIORITY){
    if (!rules[rule.id]) continue;
    const winners = rule.decide(inPlay);
    if (winners) return { winners, rule };
  }
  const maxVal = Math.max(...inPlay.map(p => p.faceCard.value));
  return { winners: inPlay.filter(p => p.faceCard.value === maxVal), rule: null };
}

function findWinningPlayers(inPlay, rules){
  return decideRound(inPlay, rules).winners;
}
