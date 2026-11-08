# Spel zonder spelelement

Een kaartspel in de stijl van "oorlogje" voor 2 tot 8 spelers, in de browser. Spelers maken geen keuzes: zodra de kaarten gedeeld zijn, ligt de uitkomst vast. Vandaar de naam.

## Spelregels (kort)

- Een standaard kaartspel van 52 kaarten wordt geschud en gelijk verdeeld over de spelers.
- Elke ronde legt iedere speler de bovenste kaart van de eigen stapel open. De hoogste kaart wint alle kaarten in de pot; die gaan onder op de stapel van de winnaar.
- Volgorde van laag naar hoog: 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A. De kleur (♠ ♥ ♦ ♣) telt niet mee.
- **Battle:** bij een gelijke hoogste kaart leggen alleen de betrokken spelers een nieuwe kaart open. Dit herhaalt zich tot er één winnaar is. Wie tijdens een battle geen kaarten meer heeft, ligt eruit.
- Wie geen kaarten meer heeft, is uitgeschakeld. De laatste speler met kaarten wint het spel.
- **Extra regel (optioneel): 2 verslaat Aas.** Liggen er zowel een 2 als een Aas, dan wint de 2. Tegen 3 t/m K verliest de 2 gewoon.

## Functies

- Stap voor stap spelen, auto-play met instelbare snelheid, of direct doorspoelen naar de winnaar (⏩).
- **Seed:** met dezelfde seed wordt altijd hetzelfde spel gedeeld. Laat het veld leeg voor een willekeurig spel.
- **Cyclusdetectie:** het spel controleert vooraf en tijdens het spelen of een verdeling eindeloos doorgaat.
- Tik op een speler om diens stapel te bekijken.
- Statistieken: verloop van het aantal kaarten per speler, gewonnen rondes en battles.

## Lokaal openen

Clone de repository en open `index.html` in een browser. Er is geen installatie of build-stap nodig.

```bash
git clone https://github.com/Peters-D/spel-zonder-spelelement.git
```

## Online spelen

Speel het spel online: https://peters-d.github.io/spel-zonder-spelelement/

## Licentie

Alle rechten voorbehouden.
