# Spel zonder spelelement

Een kaartspel in de stijl van "oorlogje" voor 2 tot 8 spelers, in de browser. Spelers maken geen keuzes: zodra de kaarten gedeeld zijn, ligt de uitkomst vast. Vandaar de naam.

<!-- REGELS:BEGIN -->
<!-- Dit deel is automatisch gemaakt uit js/rules.js met `node tools/build-readme.js`. Niet met de hand aanpassen. -->

## Spelregels

### Basisregels

Bij een voorbeeld staan de open kaarten in de volgorde van de spelers (speler 1, speler 2, enzovoort). Bij een voorbeeld met stapels staat van elke speler de bovenste kaart voorop.

- **Delen.** Een gewoon kaartspel van 52 kaarten wordt geschud en zo gelijk mogelijk verdeeld over de spelers. Iedere speler krijgt een gesloten stapel. Spelers maken geen keuzes: zodra de kaarten zijn gedeeld, ligt de uitkomst vast. Met dezelfde seed wordt altijd hetzelfde spel gedeeld.
- **Een ronde.** Elke speler die nog kaarten heeft, legt de bovenste kaart van de eigen stapel open op tafel. Alle open kaarten vormen samen de pot. De winnaar van de ronde krijgt de hele pot; die gaat onderop de eigen stapel, in de volgorde waarin de kaarten zijn gelegd. De pot wordt niet geschud.
- **Wie wint een ronde?** De hoogste kaart wint. De volgorde van laag naar hoog is 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A. De kleur van een kaart telt niet mee, tenzij een extra regel dat zegt.
  - Voorbeeld: `A · K · Q` – De Aas is het hoogst en wint.
- **Battle.** Hebben twee of meer spelers dezelfde hoogste kaart, dan is er een battle. Alleen die spelers leggen een nieuwe kaart open (bovenop de pot); de andere spelers doen niet meer mee en hun kaarten blijven in de pot. De hoogste nieuwe kaart wint de hele pot. Zijn die weer gelijk, dan volgt een nieuwe battle. Heeft een speler in een battle geen kaart meer om te leggen, dan ligt die speler eruit.
  - Voorbeeld: `K · K · 5` – Twee Koningen: die twee battlen. De 5 doet niet mee.
- **Uitgeschakeld en winnen.** Een speler zonder kaarten ligt eruit. Blijft er één speler over, dan wint die het spel: de laatste speler met kaarten.
- **De winnaar kiest een regel.** Wie een spel wint, mag één van de extra regels omzetten voor het volgende spel: een regel die uit stond gaat aan, een regel die aan stond gaat uit. Die keuze geldt voor de spellen daarna zolang de pagina openstaat en staat op het startscherm als vinkje met de naam van de winnaar erbij; na verversen is alles weer standaard. Dat vinkje kun je voor een spel nog zelf omzetten. Met de knop "Volgend spel" ga je meteen verder met dezelfde spelers en regels, op een andere deling (met een ingevulde seed wordt dat de volgende seed). Bij gelijkspel of een spel zonder einde kiest niemand.
- **Spellen die niet eindigen.** Omdat de pot niet geschud wordt, kan een spel eindeloos doorgaan. Het spel rekent bij de start na of een spel zal eindigen en waarschuwt als dat niet zo lijkt. Komt er tijdens het spelen toch een eerdere stand terug, dan stopt het spel als onbeslist.

### Extra regels

Extra regels zijn optioneel en aan te vinken bij het starten van een spel.

- **2 verslaat Aas** (standaard uit). Liggen er zowel een 2 als een Aas, dan wint de 2 van alle kaarten op tafel, dus ook van een K. Zo blijft er altijd een duidelijke winnaar: zonder deze afspraak zou 2 verslaat A, A verslaat K en K verslaat 2 een cirkel zijn. Ligt er geen Aas, dan is de 2 gewoon de laagste kaart. Liggen er meerdere 2's, dan battlen die.
  - Voorbeeld: `2 · A` – De 2 wint van de Aas.
  - Voorbeeld: `2 · A · K` – De 2 wint van alles, ook van de K.
  - Voorbeeld: `2 · K` – Zonder Aas is de 2 gewoon de laagste kaart: de K wint.
  - Voorbeeld: `2 · 2 · A` – Twee 2's: die battlen. De Aas doet niet mee.
  - Voorbeeld: `2 · A · A` – De 2 wint van beide Azen.
  - Voorbeeld: `2 · A · 7 · 7` (met "Gelijke kaarten gaan voor" aan) – Het paar gaat voor: de zevens battlen.
- **Gelijke kaarten gaan voor** (standaard uit). Liggen er twee of meer kaarten van dezelfde waarde, dan begint daar een battle, ook als een andere speler een hogere kaart heeft. Liggen er meerdere paren, dan battlet het hoogste paar. De overige spelers doen niet meer mee; hun kaarten blijven in de pot. De regel geldt ook in elke volgende battle-ronde en gaat vóór andere extra regels. Met 2 spelers verandert er niets.
  - Voorbeeld: `A · 3 · 3` – Aas, 3 en 3: de twee drieën battlen. De Aas doet niet mee.
  - Voorbeeld: `A · 3 · 3 · 7 · 7` – Twee paren: het hoogste paar (de zevens) battlet.
  - Voorbeeld: `3 · 3 · 3 · A` – Drie gelijke kaarten battlen allemaal.
  - Voorbeeld: `A · K · Q` – Zonder paar wint gewoon de hoogste kaart.
  - Voorbeeld: `2 · A · A` (met "2 verslaat Aas" aan) – Het paar gaat voor: de Azen battlen, de 2 doet niet mee.
- **Battle ruimt de pot op** (standaard uit). Is er in een ronde een battle geweest, dan wint niemand de pot: alle kaarten op tafel gaan naar de aflegstapel, ook die van de spelers die niet meededen aan de battle. De winnaar van de battle krijgt dus niets. Zonder battle verandert er niets (ook als "Bij gelijkspel beslist het symbool" aan staat: dan is er nooit een battle). Afgelegde kaarten blijven uit het spel. Heeft een speler daardoor geen kaarten meer, dan ligt die eruit; hebben alle spelers geen kaarten meer, dan is het gelijkspel.
  - Voorbeeld: stapels `K 4 2 · K 9 3 · 5 7 6` worden na één ronde `2 · 3 · 7 6`, met 5 kaarten op de aflegstapel – Speler 1 en 2 leggen allebei een K: battle. Speler 2 wint de battle met de 9, maar alle 5 kaarten op tafel gaan naar de aflegstapel. Speler 3 doet niet mee aan de battle en verliest de 5 ook.
  - Voorbeeld: stapels `A 4 · K 9` worden na één ronde `4 A K · 9`, met 0 kaarten op de aflegstapel – Zonder battle wint speler 1 de pot gewoon.
  - Voorbeeld: stapels `K · K 3` worden na één ronde `uit · uit`, met 3 kaarten op de aflegstapel – Speler 1 heeft in de battle geen kaart meer. Speler 2 wint de battle, maar de pot gaat naar de aflegstapel. Nu hebben beide spelers geen kaarten meer: gelijkspel.
- **Revival** (standaard uit). Heeft een speler aan het einde van een ronde geen kaarten meer, dan krijgt die speler de bovenste kaart van de speler links van hem (spelers zonder kaarten worden overgeslagen) en doet vanaf de volgende ronde weer mee. Dat geldt voor iedere speler zonder kaarten, dus ook voor een speler die al eerder was uitgeschakeld. Dit gebeurt alleen zolang er op dat moment nog minstens 2 spelers kaarten hebben; is er nog maar één speler met kaarten, dan komt niemand terug en eindigt het spel gewoon. Met 2 spelers doet de regel dus niets, met 3 of meer wel. Vallen er meer spelers tegelijk af, dan gaat dat in de volgorde van de tafel; heeft de buur geen kaart meer te geven, dan krijgt die speler niets. Raakt een buur zijn laatste kaart kwijt, dan valt die zelf af en komt aan het einde van een volgende ronde in aanmerking voor een kaart.
  - Voorbeeld: stapels `K 4 · 3 · 9 5 6 · 2 8` worden na één ronde `4 K 3 9 2 · 5 · 6 · 8`, met 0 kaarten op de aflegstapel – Speler 1 wint de ronde. Speler 2 had maar één kaart en is die kwijt, maar krijgt de bovenste kaart van speler 3 (de linkerbuur) en doet de volgende ronde weer mee.
  - Voorbeeld: stapels `K 4 · 3 · 5 · 9 6 7 4 · 2 8` worden na één ronde `4 K 3 5 9 2 · 6 · 7 · 4 · 8`, met 0 kaarten op de aflegstapel – Speler 2 en 3 vallen tegelijk af. Voor allebei is speler 4 de eerste buur met kaarten: speler 2 krijgt de bovenste kaart van speler 4, speler 3 de volgende.
  - Voorbeeld: stapels `K 4 · 3 · 9 5` worden na één ronde `4 K 3 9 · 5 · uit`, met 0 kaarten op de aflegstapel – De regel werkt ook met 3 spelers: speler 2 krijgt de bovenste kaart van speler 3 (de linkerbuur) en doet de volgende ronde weer mee.
  - Voorbeeld: stapels `K 4 · 3 · 9` worden na één ronde `4 K 3 9 · uit · uit`, met 0 kaarten op de aflegstapel – Nog maar één speler houdt kaarten over: niemand komt terug en het spel is afgelopen.
- **Koninklijk paar** (standaard uit). Begon de winnaar van de ronde met een Heer (K) en lag er die ronde ook een Vrouw (Q) van een andere speler open, dan winnen zij samen. De pot wordt verdeeld van hoog naar laag: de Heer kiest de hoogste kaart, de Vrouw de tweede, de Heer de derde, enzovoort. Zo krijgen ze evenveel kaarten (bij een oneven pot krijgt de Heer er één meer), maar de Heer krijgt altijd de beste. Liggen er meer Vrouwen, dan delen ze allemaal mee, in de volgorde van de tafel. Gaat de pot naar de aflegstapel (Battle ruimt de pot op), dan is er niets te verdelen. Een Vrouw telt ook als winnaar van de ronde in de statistieken.
  - Voorbeeld: stapels `K 4 2 · Q 7 3 · 9 5 6` worden na één ronde `4 2 K 9 · 7 3 Q · 5 6`, met 0 kaarten op de aflegstapel – De Heer van speler 1 wint en er ligt een Vrouw van speler 2. De pot (K, Q, 9) gaat van hoog naar laag: de Heer krijgt K, de Vrouw Q, de Heer de 9.
  - Voorbeeld: stapels `K 4 · Q 7 · Q 3 · 9 5` worden na één ronde `4 K 9 · 7 Q · 3 Q · 5`, met 0 kaarten op de aflegstapel – Twee Vrouwen: ze delen allebei mee. De Heer kiest K, de eerste Vrouw Q, de tweede Vrouw Q, daarna weer de Heer (9).
  - Voorbeeld: stapels `A 4 · K 7 · Q 3` worden na één ronde `4 A K Q · 7 · 3`, met 0 kaarten op de aflegstapel – Wint de Aas, dan is er geen Heer die wint en krijgt speler 1 de hele pot.
  - Voorbeeld: stapels `K 4 · J 7 · 3 3` worden na één ronde `4 K J 3 · 7 · 3`, met 0 kaarten op de aflegstapel – Er ligt een Heer maar geen Vrouw: de Heer wint de hele pot, zoals altijd.
  - Voorbeeld: stapels `K 9 2 · K 5 3 · Q 6 4` worden na één ronde `2 K Q 5 · 3 · 6 4 K 9`, met 0 kaarten op de aflegstapel – Twee Heren battlen en speler 1 wint met de 9. Er ligt ook een Vrouw (speler 3), dus de pot (K, K, Q, 9, 5) wordt verdeeld: de Heer kiest K, de Vrouw de andere K, de Heer Q, de Vrouw 9, de Heer 5.
  - Voorbeeld: stapels `K 9 2 · K 5 3 · Q 6 4` (met "Battle ruimt de pot op" aan) worden na één ronde `2 · 3 · 6 4`, met 5 kaarten op de aflegstapel – Dezelfde battle, maar de hele pot gaat naar de aflegstapel: er is dan niets meer te verdelen.
- **Bij gelijkspel beslist het symbool** (standaard uit). Voor je begint kies je een volgorde van de vier symbolen: standaard ♠, ♥, ♦, ♣ (van hoog naar laag). Eindigen twee of meer spelers gelijk, dan wint de speler met het hoogste symbool en is er geen battle. Dat geldt ook voor gelijke kaarten bij "Gelijke kaarten gaan voor" en voor meerdere 2's bij "2 verslaat Aas". Omdat er geen battle meer komt, doet "Battle ruimt de pot op" dan niets. Staat het symbool niet bekend, dan battlen de spelers zoals gewoonlijk.
  - Voorbeeld: `K♥ · K♠ · 3` – Twee Heren: ♠ staat hoger dan ♥, dus de ♠ wint en er is geen battle.
  - Voorbeeld: `A · K♠ · 3` – Zonder gelijkspel verandert er niets: de Aas wint.
  - Voorbeeld: `A · K♥ · K♠` (met "Gelijke kaarten gaan voor" aan) – Met "Gelijke kaarten gaan voor" winnen de Heren, en ♠ beslist welke: speler 3 wint meteen.
  - Voorbeeld: `2♦ · 2♣ · A` (met "2 verslaat Aas" aan) – Twee 2's winnen van de Aas; ♦ staat hoger dan ♣, dus speler 1 wint.

### Volgorde bij botsingen

Staan er meer extra regels aan, dan beslist de eerste regel in deze lijst die iets te zeggen heeft. Heeft geen enkele regel iets te zeggen, dan wint de hoogste kaart. Blijft er daarna een gelijkspel over en staat "Bij gelijkspel beslist het symbool" aan, dan beslist het symbool.

1. Gelijke kaarten gaan voor
2. 2 verslaat Aas
3. Bij gelijkspel beslist het symbool

Dezelfde uitleg staat in het spel zelf, onder de knop **📖 Spelregels**.
<!-- REGELS:EINDE -->

## Functies

- Stap voor stap spelen, auto-play met instelbare snelheid, of direct doorspoelen naar de winnaar (⏩). Met ↩️ ga je tot tien rondes terug, bijvoorbeeld om een battle nog eens te spelen.
- **Seed:** met dezelfde seed wordt altijd hetzelfde spel gedeeld, en de gebruikte seed staat in het spel. Laat het veld leeg voor een willekeurig spel. Loopt een spel vast, dan kiest **Nieuwe seed proberen** de volgende seed (1000 wordt 1001).
- **Cyclusdetectie:** het spel controleert vooraf en tijdens het spelen of een verdeling eindeloos doorgaat.
- Tik op een speler om diens stapel te bekijken.
- Statistieken: verloop van het aantal kaarten per speler, gewonnen rondes en battles.

## Lokaal openen

Clone de repository en open `index.html` in een browser. Er is geen installatie of build-stap nodig.

```bash
git clone https://github.com/Peters-D/spel-zonder-spelelement.git
```

## Een nieuwe regel toevoegen

De regels staan op één plek: de catalogus in `js/rules.js`. Het vinkje bij het starten, het regelboek in het spel en het regel-gedeelte van deze README volgen daaruit vanzelf.

1. Voeg een object toe aan `RULES` in `js/rules.js`, met `id`, `priority`, `title`, `short`, `description`, `default`, `examples` en `decide`. Zie de uitleg bovenaan dat bestand. Een regel die kaarten moet afleggen of terughalen gebruikt de haken `onAward` en `onRoundEnd`, een regel die een gelijkspel beslist de haak `breakTie`, en de handelingen voor de aflegstapel en voor kaarten tussen spelers uit `js/engine.js`, en zet `usesDiscard: true`. Een regel met alleen haken heeft geen `decide`; laat dan in `examples` een scenario met stapels zien (`decks`, `after`, `discarded`, `text`), zie de uitleg bovenaan `js/rules.js`.
2. Draai `node tools/build-readme.js`. Dat werkt het regel-gedeelte van deze README bij. Pas dat gedeelte niet met de hand aan.
3. Draai `node tests/smoke.js --update` en bekijk het verschil in `tests/expected.json`: dat zijn de nieuwe regelcombinaties.
4. Draai `node tests/smoke.js`. Die moet slagen. De CI controleert dit ook, en dat de README klopt met de regels.

De test verdeelt zichzelf over de processorkernen (ten hoogste 4) en duurt dan op een computer met 4 kernen ongeveer 25 seconden (op GitHub kan dat anders uitvallen). Met `--serial` draait hij in één proces (ongeveer een minuut), handig om te zoeken waar iets misgaat. De test zelf staat in `tests/smoke-run.js`.

## Thema's

Het spel heeft vier thema's: **Oorlog** (groen met goud en rangstrepen, standaard), **Sovjet** (rood met goud en de rode ster), **Semechki** (zwart en wit, met een zonnebloempit met drie strepen als embleem) en **Bóbr** (bruin en crème, met een wodkafles als embleem en eigen kaarten met illustraties: de vier kleuren zijn Hamer & Sikkel, Sovjetster, Trainingspak en Semitsjki). Rechtsboven staat een knop met het icoon van het huidige thema (altijd zichtbaar, ook tijdens het spel); een klik opent een menu om te kiezen, zoals bij een taalkeuze. De keuze wordt in de browser onthouden. Thema's veranderen alleen het uiterlijk, nooit de spelregels.

Alle kleuren en versieringen staan in `css/themes.css`, als variabelen per thema (uitleg bovenaan dat bestand). De rest van de opmaak en het spel zelf gebruiken alleen die variabelen. Het thema staat in het attribuut `data-theme` van het `<html>`-element. De kaarten van Bóbr staan als SVG in `img/bobr` en worden in `css/cards-bobr.css` aan de kaarten gekoppeld (via het attribuut `data-card`, bijv. `h14` voor A♥).

Een thema met eigen kaartafbeeldingen (zoals Bóbr) zet in `THEME_CARD_FILES` in `js/theme.js` waar ze staan; ze worden dan alvast opgehaald zodra het thema gekozen is.

Een nieuw thema toevoegen:
1. Voeg in `css/themes.css` een blok `[data-theme="naam"]` toe met dezelfde variabelen als de andere thema's.
2. Voeg het thema toe aan `THEMES` in `js/theme.js` (id, naam en icoon), dan komt het in het menu.
3. Draai `node tests/smoke.js`. De test controleert dat een thema geen variabele vergeet, dat er buiten `themes.css` geen vaste kleuren staan en dat `THEMES` en de CSS overeenkomen.

## Online spelen

Speel het spel online: https://peters-d.github.io/spel-zonder-spelelement/

## Licentie

Alle rechten voorbehouden.
