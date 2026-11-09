# Spel zonder spelelement

Een kaartspel in de stijl van "oorlogje" voor 2 tot 8 spelers, in de browser. Spelers maken geen keuzes: zodra de kaarten gedeeld zijn, ligt de uitkomst vast. Vandaar de naam.

<!-- REGELS:BEGIN -->
<!-- Dit deel is automatisch gemaakt uit js/rules.js met `node tools/build-readme.js`. Niet met de hand aanpassen. -->

## Spelregels

### Basisregels

Bij een voorbeeld staan de open kaarten in de volgorde van de spelers (speler 1, speler 2, enzovoort).

- **Delen.** Een gewoon kaartspel van 52 kaarten wordt geschud en zo gelijk mogelijk verdeeld over de spelers. Iedere speler krijgt een gesloten stapel. Spelers maken geen keuzes: zodra de kaarten zijn gedeeld, ligt de uitkomst vast. Met dezelfde seed wordt altijd hetzelfde spel gedeeld.
- **Een ronde.** Elke speler die nog kaarten heeft, legt de bovenste kaart van de eigen stapel open op tafel. Alle open kaarten vormen samen de pot. De winnaar van de ronde krijgt de hele pot; die gaat onderop de eigen stapel, in de volgorde waarin de kaarten zijn gelegd. De pot wordt niet geschud.
- **Wie wint een ronde?** De hoogste kaart wint. De volgorde van laag naar hoog is 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A. De kleur van een kaart telt niet mee, tenzij een extra regel dat zegt.
  - Voorbeeld: `A · K · Q` – De Aas is het hoogst en wint.
- **Battle.** Hebben twee of meer spelers dezelfde hoogste kaart, dan is er een battle. Alleen die spelers leggen een nieuwe kaart open (bovenop de pot); de andere spelers doen niet meer mee en hun kaarten blijven in de pot. De hoogste nieuwe kaart wint de hele pot. Zijn die weer gelijk, dan volgt een nieuwe battle. Heeft een speler in een battle geen kaart meer om te leggen, dan ligt die speler eruit.
  - Voorbeeld: `K · K · 5` – Twee Koningen: die twee battlen. De 5 doet niet mee.
- **Uitgeschakeld en winnen.** Een speler zonder kaarten ligt eruit. Blijft er één speler over, dan wint die het spel: de laatste speler met kaarten.
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

### Volgorde bij botsingen

Staan er meer extra regels aan, dan beslist de eerste regel in deze lijst die iets te zeggen heeft. Heeft geen enkele regel iets te zeggen, dan wint de hoogste kaart.

1. Gelijke kaarten gaan voor
2. 2 verslaat Aas

Dezelfde uitleg staat in het spel zelf, onder de knop **📖 Spelregels**.
<!-- REGELS:EINDE -->

## Functies

- Stap voor stap spelen, auto-play met instelbare snelheid, of direct doorspoelen naar de winnaar (⏩).
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

1. Voeg een object toe aan `RULES` in `js/rules.js`, met `id`, `priority`, `title`, `short`, `description`, `default`, `examples` en `decide`. Zie de uitleg bovenaan dat bestand. Een regel die kaarten moet afleggen of terughalen gebruikt de haken `onAward` en `onRoundEnd` en de handelingen voor de aflegstapel uit `js/engine.js`, en zet `usesDiscard: true`.
2. Draai `node tools/build-readme.js`. Dat werkt het regel-gedeelte van deze README bij. Pas dat gedeelte niet met de hand aan.
3. Draai `node tests/smoke.js --update` en bekijk het verschil in `tests/expected.json`: dat zijn de nieuwe regelcombinaties.
4. Draai `node tests/smoke.js`. Die moet slagen. De CI controleert dit ook, en dat de README klopt met de regels.

## Online spelen

Speel het spel online: https://peters-d.github.io/spel-zonder-spelelement/

## Licentie

Alle rechten voorbehouden.
