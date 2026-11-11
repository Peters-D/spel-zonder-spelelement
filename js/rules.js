// Spelregels: de catalogus van extra regels.
//
// Elke extra regel is hier EEN object met alles wat erbij hoort:
//   id          sleutel in het regels-object dat de spelkern doorgeeft (en in de testsleutels)
//   priority    volgorde van toepassen; een lager getal gaat eerst. Dit bepaalt echt de werking.
//   title       naam van de regel
//   short       korte tekst bij het vinkje op het startscherm
//   description uitleg voor het regelboek
//   default     staat de regel standaard aan?
//   examples    voorbeelden: { cards: [kaarten die open liggen, per speler: 'A' of met kleur 'A♠'], winners: [indexen van de
//               spelers die (voorlopig) winnen of gaan battlen], text: uitleg, with: [andere regels
//               die in dit voorbeeld ook aan staan] }. Ze worden getoond in het regelboek EN door de
//               test uitgevoerd tegen decide(): een voorbeeld dat het spel anders speelt, laat de test falen.
//               Een regel zonder decide (alleen haken) laat een scenario zien: { decks: [de stapels vóór de ronde, per speler, bovenste
//               kaart eerst], after: [de stapels na de ronde], discarded: aantal kaarten op de aflegstapel na de ronde, text,
//               with }. Het scenario wordt een ronde lang gespeeld door de spelkern (de test controleert het).
//   decide      (optioneel) decide(inPlay) geeft de winnende spelers terug, of null als de regel niets beslist
//   overruledMessage (optioneel) tekst voor spelers die zonder deze regel hadden gewonnen
//   usesDiscard (optioneel) true als de regel kaarten aflegt of terughaalt: dan staat de aflegstapel op het scherm
//   onAward(ctx), onRoundEnd(ctx)  (optioneel) haken voor regels die iets doen na de beslissing, bijvoorbeeld kaarten
//               afleggen. Zie engine.js voor ctx en voor de handelingen voor de aflegstapel.
// Een regel heeft minstens een decide of een haak nodig.
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
        text: 'Het paar gaat voor: de zevens battlen.' }
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
        text: 'Het paar gaat voor: de Azen battlen, de 2 doet niet mee.' }
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
  },
  {
    id: 'battleDiscard',
    priority: 30,
    title: 'Battle ruimt de pot op',
    short: 'Na een battle gaat de hele pot naar de aflegstapel (niemand wint kaarten)',
    description: 'Is er in een ronde een battle geweest, dan wint niemand de pot: alle kaarten op tafel gaan naar de aflegstapel, ' +
      'ook die van de spelers die niet meededen aan de battle. De winnaar van de battle krijgt dus niets. ' +
      'Zonder battle verandert er niets. Afgelegde kaarten blijven uit het spel. Heeft een speler daardoor geen kaarten meer, dan ligt die eruit; ' +
      'hebben alle spelers geen kaarten meer, dan is het gelijkspel.',
    default: false,
    usesDiscard: true,
    examples: [
      { decks: [['K', '4', '2'], ['K', '9', '3'], ['5', '7', '6']], after: [['2'], ['3'], ['7', '6']], discarded: 5,
        text: 'Speler 1 en 2 leggen allebei een K: battle. Speler 2 wint de battle met de 9, maar alle 5 kaarten op tafel gaan naar de aflegstapel. Speler 3 doet niet mee aan de battle en verliest de 5 ook.' },
      { decks: [['A', '4'], ['K', '9']], after: [['4', 'A', 'K'], ['9']], discarded: 0,
        text: 'Zonder battle wint speler 1 de pot gewoon.' },
      { decks: [['K'], ['K', '3']], after: [[], []], discarded: 3,
        text: 'Speler 1 heeft in de battle geen kaart meer. Speler 2 wint de battle, maar de pot gaat naar de aflegstapel. Nu hebben beide spelers geen kaarten meer: gelijkspel.' }
    ],
    onAward(ctx){
      if (ctx.state.battleLevel > 0) engineDiscardPot(ctx.state);
    }
  },
  {
    id: 'secondChance',
    priority: 40,
    title: 'Tweede kans',
    short: 'Wie zonder kaarten valt, krijgt de bovenste kaart van de linkerbuur (zolang minstens 3 spelers kaarten hebben)',
    description: 'Heeft een speler aan het einde van een ronde geen kaarten meer, dan krijgt die speler de bovenste kaart van de speler links van hem ' +
      '(spelers zonder kaarten worden overgeslagen) en doet vanaf de volgende ronde weer mee. Dat geldt voor iedere speler zonder kaarten, dus ook voor een speler die al eerder was uitgeschakeld. ' +
      'Dit gebeurt alleen zolang er op dat moment nog minstens 3 spelers kaarten hebben; ' +
      'zijn het er minder, dan komt niemand terug en eindigt het spel gewoon. Met 2 of 3 spelers doet de regel dus niets. ' +
      'Vallen er meer spelers tegelijk af, dan gaat dat in de volgorde van de tafel; heeft de buur geen kaart meer te geven, dan krijgt die speler niets. ' +
      'Raakt een buur zijn laatste kaart kwijt, dan valt die zelf af en komt aan het einde van een volgende ronde in aanmerking voor een kaart.',
    default: false,
    examples: [
      { decks: [['K', '4'], ['3'], ['9', '5', '6'], ['2', '8']], after: [['4', 'K', '3', '9', '2'], ['5'], ['6'], ['8']], discarded: 0,
        text: 'Speler 1 wint de ronde. Speler 2 had maar één kaart en is die kwijt, maar krijgt de bovenste kaart van speler 3 (de linkerbuur) en doet de volgende ronde weer mee.' },
      { decks: [['K', '4'], ['3'], ['5'], ['9', '6', '7', '4'], ['2', '8']], after: [['4', 'K', '3', '5', '9', '2'], ['6'], ['7'], ['4'], ['8']], discarded: 0,
        text: 'Speler 2 en 3 vallen tegelijk af. Voor allebei is speler 4 de eerste buur met kaarten: speler 2 krijgt de bovenste kaart van speler 4, speler 3 de volgende.' },
      { decks: [['K', '4'], ['3'], ['9', '5']], after: [['4', 'K', '3', '9'], [], ['5']], discarded: 0,
        text: 'Nog maar 2 spelers houden kaarten over, dus speler 2 komt niet terug.' }
    ],
    onRoundEnd(ctx){
      const state = ctx.state;
      if (state.players.filter(p => p.deck.length > 0).length < 3) return;
      const dead = state.players.filter(p => p.deck.length === 0);
      // De gevers worden bepaald vóór er kaarten verschuiven, zodat een speler die net een kaart kreeg niet meteen weer geeft.
      const givers = dead.map(p => engineNeighbor(state, p.id, 'left'));
      dead.forEach((p, i) => { if (givers[i]) engineTransferCards(state, givers[i].id, p.id, 1); });
    }
  },
  {
    id: 'royalFamily',
    priority: 50,
    title: 'Koninklijk gezin',
    short: 'Wint een Heer terwijl er een Vrouw op tafel ligt, dan winnen ze samen (de Heer kiest eerst)',
    description: 'Begon de winnaar van de ronde met een Heer (K) en lag er die ronde ook een Vrouw (Q) van een andere speler open, dan winnen zij samen. ' +
      'De pot wordt verdeeld van hoog naar laag: de Heer kiest de hoogste kaart, de Vrouw de tweede, de Heer de derde, enzovoort. ' +
      'Zo krijgen ze evenveel kaarten (bij een oneven pot krijgt de Heer er één meer), maar de Heer krijgt altijd de beste. ' +
      'Liggen er meer Vrouwen, dan delen ze allemaal mee, in de volgorde van de tafel. Gaat de pot naar de aflegstapel (Battle ruimt de pot op), dan is er niets te verdelen. ' +
      'Een Vrouw telt ook als winnaar van de ronde in de statistieken.',
    default: false,
    examples: [
      { decks: [['K', '4', '2'], ['Q', '7', '3'], ['9', '5', '6']], after: [['4', '2', 'K', '9'], ['7', '3', 'Q'], ['5', '6']], discarded: 0,
        text: 'De Heer van speler 1 wint en er ligt een Vrouw van speler 2. De pot (K, Q, 9) gaat van hoog naar laag: de Heer krijgt K, de Vrouw Q, de Heer de 9.' },
      { decks: [['K', '4'], ['Q', '7'], ['Q', '3'], ['9', '5']], after: [['4', 'K', '9'], ['7', 'Q'], ['3', 'Q'], ['5']], discarded: 0,
        text: 'Twee Vrouwen: ze delen allebei mee. De Heer kiest K, de eerste Vrouw Q, de tweede Vrouw Q, daarna weer de Heer (9).' },
      { decks: [['A', '4'], ['K', '7'], ['Q', '3']], after: [['4', 'A', 'K', 'Q'], ['7'], ['3']], discarded: 0,
        text: 'Wint de Aas, dan is er geen Heer die wint en krijgt speler 1 de hele pot.' },
      { decks: [['K', '4'], ['J', '7'], ['3', '3']], after: [['4', 'K', 'J', '3'], ['7'], ['3']], discarded: 0,
        text: 'Er ligt een Heer maar geen Vrouw: de Heer wint de hele pot, zoals altijd.' },
      { decks: [['K', '9', '2'], ['K', '5', '3'], ['Q', '6', '4']], after: [['2', 'K', 'Q', '5'], ['3'], ['6', '4', 'K', '9']], discarded: 0,
        text: 'Twee Heren battlen en speler 1 wint met de 9. Er ligt ook een Vrouw (speler 3), dus de pot (K, K, Q, 9, 5) wordt verdeeld: de Heer kiest K, de Vrouw de andere K, de Heer Q, de Vrouw 9, de Heer 5.' },
      { decks: [['K', '9', '2'], ['K', '5', '3'], ['Q', '6', '4']], after: [['2'], ['3'], ['6', '4']], discarded: 5, with: ['battleDiscard'],
        text: 'Dezelfde battle, maar de hele pot gaat naar de aflegstapel: er is dan niets meer te verdelen.' }
    ],
    onAward(ctx){
      const state = ctx.state;
      if (ctx.how === 'void' || !ctx.winner || state.pot.length === 0) return;
      const start = state.opening[ctx.winner.id];
      if (!start || start.rank !== 'K') return;
      const women = state.players.filter(p => p.id !== ctx.winner.id && state.opening[p.id] && state.opening[p.id].rank === 'Q');
      if (women.length === 0) return;
      engineSharePot(state, [ctx.winner.id].concat(women.map(p => p.id)));
    }
  }
];

// Een voorbeeld met stapels (decks) in plaats van open kaarten: zie de uitleg bovenaan.
function isScenarioExample(ex){
  return Array.isArray(ex.decks);
}

// Basisregels: de regels die altijd gelden. Ze staan hier als tekst voor het regelboek.
// Alleen de voorbeelden (examples, zelfde formaat als bij RULES, met alle extra regels uit) worden door de
// test tegen de regelcode uitgevoerd; de rest is gewone tekst en wordt met de hand gecontroleerd tegen engine.js.
const BASE_RULES = [
  {
    id: 'delen',
    title: 'Delen',
    description: 'Een gewoon kaartspel van 52 kaarten wordt geschud en zo gelijk mogelijk verdeeld over de spelers. ' +
      'Iedere speler krijgt een gesloten stapel. Spelers maken geen keuzes: zodra de kaarten zijn gedeeld, ligt de uitkomst vast. ' +
      'Met dezelfde seed wordt altijd hetzelfde spel gedeeld.'
  },
  {
    id: 'ronde',
    title: 'Een ronde',
    description: 'Elke speler die nog kaarten heeft, legt de bovenste kaart van de eigen stapel open op tafel. ' +
      'Alle open kaarten vormen samen de pot. De winnaar van de ronde krijgt de hele pot; die gaat onderop de eigen stapel, ' +
      'in de volgorde waarin de kaarten zijn gelegd. De pot wordt niet geschud.'
  },
  {
    id: 'wie-wint',
    title: 'Wie wint een ronde?',
    description: 'De hoogste kaart wint. De volgorde van laag naar hoog is 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A. ' +
      'De kleur van een kaart telt niet mee, tenzij een extra regel dat zegt.',
    examples: [
      { cards: ['A', 'K', 'Q'], winners: [0], text: 'De Aas is het hoogst en wint.' }
    ]
  },
  {
    id: 'battle',
    title: 'Battle',
    description: 'Hebben twee of meer spelers dezelfde hoogste kaart, dan is er een battle. Alleen die spelers leggen een nieuwe kaart open ' +
      '(bovenop de pot); de andere spelers doen niet meer mee en hun kaarten blijven in de pot. De hoogste nieuwe kaart wint de hele pot. ' +
      'Zijn die weer gelijk, dan volgt een nieuwe battle. Heeft een speler in een battle geen kaart meer om te leggen, dan ligt die speler eruit.',
    examples: [
      { cards: ['K', 'K', '5'], winners: [0, 1], text: 'Twee Koningen: die twee battlen. De 5 doet niet mee.' }
    ]
  },
  {
    id: 'uitschakelen',
    title: 'Uitgeschakeld en winnen',
    description: 'Een speler zonder kaarten ligt eruit. Blijft er één speler over, dan wint die het spel: de laatste speler met kaarten.'
  },
  {
    id: 'winnaarkiest',
    title: 'De winnaar kiest een regel',
    description: 'Wie een spel wint, mag één van de extra regels omzetten voor het volgende spel: een regel die uit stond gaat aan, een regel die aan stond ' +
      'gaat uit. Die keuze geldt voor de spellen daarna zolang de pagina openstaat en staat op het startscherm als vinkje met de naam van de winnaar erbij; na verversen is alles weer standaard. ' +
      'Dat vinkje kun je voor een spel nog zelf omzetten. Met de knop "Volgend spel" ga je meteen verder met dezelfde spelers en regels, op een andere deling (met een ingevulde seed wordt dat de volgende seed). ' +
      'Bij gelijkspel of een spel zonder einde kiest niemand.'
  },
  {
    id: 'eindeloos',
    title: 'Spellen die niet eindigen',
    description: 'Omdat de pot niet geschud wordt, kan een spel eindeloos doorgaan. Het spel rekent bij de start na of een spel zal eindigen ' +
      'en waarschuwt als dat niet zo lijkt. Komt er tijdens het spelen toch een eerdere stand terug, dan stopt het spel als onbeslist.'
  }
];

// Kaarten in voorbeelden: 'A' (kleur doet er niet toe) of 'A♠' (met kleur, voor regels die op kleur letten).
function parseExampleCard(text){
  const last = text.slice(-1);
  const suit = SUITS.includes(last) ? last : null;
  const rank = suit ? text.slice(0, -1) : text;
  return { rank, suit, value: RANKS.indexOf(rank) + 2 };
}

// Alle regels staan standaard op hun default (afgeleid uit de catalogus).
const DEFAULT_RULES = Object.fromEntries(RULES.map(r => [r.id, r.default]));

// Regels in de volgorde waarin ze worden toegepast.
const RULES_BY_PRIORITY = RULES.slice().sort((a, b) => a.priority - b.priority);

// Bepaalt wie van de spelers in inPlay de ronde (voorlopig) wint. Geeft { winners, rule } terug:
// rule is de regel die besliste, of null als de hoogste kaart wint. Meer dan één winnaar
// betekent gelijkspel → battle.
function decideRound(inPlay, rules){
  for (const rule of RULES_BY_PRIORITY){
    if (!rules[rule.id] || typeof rule.decide !== 'function') continue;
    const winners = rule.decide(inPlay);
    if (winners) return { winners, rule };
  }
  const maxVal = Math.max(...inPlay.map(p => p.faceCard.value));
  return { winners: inPlay.filter(p => p.faceCard.value === maxVal), rule: null };
}

function findWinningPlayers(inPlay, rules){
  return decideRound(inPlay, rules).winners;
}
