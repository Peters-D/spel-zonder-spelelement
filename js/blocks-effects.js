// Bouwstenen: de gevolgen (then) van een regelbeschrijving. Zie js/rule-registry.js voor wat elk onderdeel betekent.
// De volgorde hieronder is de volgorde in meldingen en keuzelijsten.
//
// Naast validate, run, describe/parts en usesDiscard (zie js/rule-registry.js) heeft elk gevolg:
//   prompt                    het gevolg in de uitleg aan een taalmodel (js/rule-prompt.js); de gevolgen met dezelfde momenten staan
//                             daar op één regel, met "of" ertussen
//   promptNote                (optioneel) een opmerking op een eigen regel onder die regel
//   builder                   het deel voor de regelbouwer (js/rule-builder.js):
//     fresh(e)                vult een nieuw gevolg e ({ key }) met de beginwaarden
//     toLogic(e, moment)      e -> beschrijving (then); een fout is een RB_ERR
//     fromLogic(node, e)      vult e vanuit de beschrijving; geeft e, of null als de bouwer het niet kan tonen
//     editor(box, e)          de velden in het formulier (na de keuzelijst)

// decide, tiebreak: die spelers winnen. env: { scope, rules } (de open kaarten die meedoen).
defineBlock('effect', {
  key: 'win', moments: ['decide', 'tiebreak'], label: 'deze kaarten winnen', sample: { win: { rank: '2' } },
  validate(node, path, v){ v.cards(node.win, path + '.win', 1); },
  run(then, env){ return dslSelectCards(env.scope, then.win, env.rules); },
  describe(then, cond, moment){
    const x = rtCards(then.win), verb = x.verbSingular ? 'wint' : 'winnen';
    if (moment === 'tiebreak') return 'Bij een gelijkspel' + (cond ? ', als ' + cond + ', dan' : '') + (x.verbSingular ? ' wint ' + x.single : ' winnen ' + x.plural) + '.';
    const s = cond ? 'Als ' + cond + ', dan ' + verb + ' ' + x.plural + '.' : rtUpper(x.plural) + ' ' + verb + '.';
    return s + ' Bij gelijk spel: BATTLE!';
  },
  prompt: '{ "win": <kaarten> }',
  builder: {
    fresh(e){ e.cs = rbNewCards('rank'); },
    toLogic(e){ return { win: rbCards(e.cs, false) }; },
    fromLogic(node, e){ e.cs = rbCardsFrom(node.win); return e.cs ? e : null; },
    editor(box, e){ box.appendChild(rbCardsEditor(e.cs, false, 'Gevolg')); }
  }
});

// award: ctx = { state, winner, how, potSize } (zie engineRunHooks).
defineBlock('effect', {
  key: 'discardPot', moments: ['award'], label: 'de hele pot gaat naar de aflegstapel', sample: { discardPot: true }, usesDiscard: true,
  validate(node, path, v){ if (node.discardPot !== true) v.err(path + '.discardPot', 'true verwacht'); },
  run(then, ctx){ engineDiscardPot(ctx.state); },
  parts(){ return { s: 'de hele pot', v: 'gaat', r: 'naar de aflegstapel' }; },
  prompt: '{ "discardPot": true }',
  builder: { fresh(){}, toLogic(){ return { discardPot: true }; }, fromLogic(node, e){ return e; }, editor(){} }
});

defineBlock('effect', {
  key: 'sharePot', moments: ['award'], label: 'de pot wordt verdeeld over deze spelers', sample: { sharePot: ['winner', { opened: { rank: 'Q' }, exclude: 'winner' }] },
  validate(node, path, v){
    if (!Array.isArray(node.sharePot) || node.sharePot.length === 0) v.err(path + '.sharePot', 'een lijst van spelers verwacht');
    else node.sharePot.forEach((x, i) => v.players(x, path + '.sharePot[' + i + ']', true, false));
  },
  run(then, ctx){
    const state = ctx.state;
    if (ctx.how === 'void' || !ctx.winner || state.pot.length === 0) return; // verdelen kan alleen met een winnaar en een pot
    const ids = [];
    for (const sel of then.sharePot) for (const p of dslSelectPlayers(sel, ctx)) if (!ids.includes(p.id)) ids.push(p.id);
    if (ids.length > 0) engineSharePot(state, ids);
  },
  parts(then){
    const who = then.sharePot.map(p => rtPlayer(p, false));
    return { s: 'de pot', v: 'wordt', r: 'verdeeld over ' + rtJoin(who, 'en') + ', de hoogste kaart eerst' };
  },
  prompt: '{ "sharePot": [<spelers>, ...] }   (verdelen van hoog naar laag, in deze volgorde)',
  builder: {
    fresh(e){ e.who = [rbNewPlayer('winner')]; },
    toLogic(e, moment){
      if (!Array.isArray(e.who) || e.who.length === 0) throw RB_ERR('Kies over welke spelers de pot wordt verdeeld.');
      return { sharePot: e.who.map(p => rbPlayer(p, moment)) };
    },
    fromLogic(node, e){
      const who = node.sharePot.map(rbPlayerFrom);
      if (who.some(p => !p || p.kind === 'neighbor')) return null;
      e.who = who;
      return e;
    },
    editor(box, e){
      e.who.forEach((p, i) => {
        const line = rbMake('div', 'bld-line');
        line.appendChild(rbPlayerEditor(p, 'sharePot', 'Verdelen over ' + (i + 1)));
        if (e.who.length > 1) line.appendChild(rbButton('× weghalen', 'Spelers ' + (i + 1) + ' weghalen', () => { e.who.splice(i, 1); }));
        box.appendChild(line);
      });
      box.appendChild(rbButton('+ spelers erbij', 'Spelers toevoegen', () => { e.who.push(rbNewPlayer('opened')); }));
    }
  }
});

// roundEnd: ctx = { state }; targets = de spelers uit forEach (bepaald vóór er iets verschuift).
defineBlock('effect', {
  key: 'transfer', moments: ['roundEnd'], label: 'spelers krijgen kaarten van een andere speler',
  sample: { forEach: { withoutCards: true }, transfer: { from: { neighbor: 'left' }, count: 1 } },
  validate(node, path, v){
    if (!v.isObj(node.transfer)) return v.err(path + '.transfer', '{ from, count } verwacht');
    v.only(node.transfer, path + '.transfer', ['from', 'count']);
    v.players(node.transfer.from, path + '.transfer.from', false, true);
    if (v.isObj(node.transfer.from) && 'withoutCards' in node.transfer.from) v.err(path + '.transfer.from', 'spelers zonder kaarten kunnen geen kaarten geven');
    v.int(node.transfer.count, path + '.transfer.count', 1, DSL_MAX_CARDS);
  },
  run(then, ctx, targets){
    const state = ctx.state;
    // Wie geeft, staat vast vóór er kaarten verschuiven: een speler die net een kaart kreeg, geeft niet meteen door.
    const from = then.transfer.from;
    const givers = targets.map(p => 'neighbor' in from ? engineNeighbor(state, p.id, from.neighbor) : dslSelectPlayers(from, ctx).find(g => g.id !== p.id) || null);
    const second = then.forEach !== 'winner' && then.forEach.secondChance === true;
    targets.forEach((p, i) => {
      if (givers[i] && engineTransferCards(state, givers[i].id, p.id, then.transfer.count) > 0 && second) p.chanceUsed = true; // de tweede kans is gebruikt
    });
  },
  parts(then){
    const t = then.transfer, n = t.count === 1 ? '1 kaart' : t.count + ' kaarten';
    const giver = registryPlayersOf(t.from), from = giver.giverPhrase ? giver.giverPhrase(t.from) : rtPlayer(t.from, false);
    return { s: rtPlayer(then.forEach, true), v: 'krijgt', r: n + ' van ' + from };
  },
  prompt: '{ "forEach": <spelers>, "transfer": { "from": <spelers>, "count": n } }',
  builder: {
    fresh(e){ Object.assign(e, { each: rbNewPlayer('withoutCards'), from: rbNewPlayer('neighbor'), count: 1 }); },
    toLogic(e, moment){
      return { forEach: rbPlayer(e.each, moment), transfer: { from: rbPlayer(e.from, moment), count: rbInt(e.count, 1, 52, 'Het aantal kaarten') } };
    },
    fromLogic(node, e){
      const each = rbPlayerFrom(node.forEach), from = rbPlayerFrom(node.transfer.from);
      if (!each || !from || each.kind === 'neighbor' || each.kind === 'winner' || from.kind === 'withoutCards' || from.kind === 'winner') return null;
      e.each = each; e.from = from; e.count = node.transfer.count;
      return e;
    },
    editor(box, e){
      box.appendChild(rbMake('span', 'bld-word', 'Wie krijgt kaarten:'));
      box.appendChild(rbPlayerEditor(e.each, 'forEach', 'Wie krijgt kaarten'));
      box.appendChild(rbMake('span', 'bld-word', 'Aantal kaarten:'));
      box.appendChild(rbNumber(e.count, 1, 52, 'Aantal kaarten', v => { e.count = v; }));
      box.appendChild(rbMake('span', 'bld-word', 'Van wie:'));
      box.appendChild(rbPlayerEditor(e.from, 'from', 'Van wie'));
    }
  }
});

defineBlock('effect', {
  key: 'discardTop', moments: ['roundEnd'], label: 'spelers leggen kaarten af', sample: { forEach: { opened: { rank: 'K' } }, discardTop: 1 }, usesDiscard: true,
  validate(node, path, v){ v.int(node.discardTop, path + '.discardTop', 1, DSL_MAX_CARDS); },
  run(then, ctx, targets){ targets.forEach(p => engineDiscardFromDeck(ctx.state, p.id, then.discardTop)); },
  parts(then){
    return { s: rtPlayer(then.forEach, true), v: 'legt', r: (then.discardTop === 1 ? 'zijn bovenste kaart' : 'zijn bovenste ' + then.discardTop + ' kaarten') + ' af' };
  },
  prompt: '{ "forEach": <spelers>, "discardTop": n }',
  promptNote: '(count en discardTop: een geheel getal van 1 t/m 52)',
  builder: {
    fresh(e){ Object.assign(e, { each: rbNewPlayer('opened'), count: 1 }); },
    toLogic(e, moment){ return { forEach: rbPlayer(e.each, moment), discardTop: rbInt(e.count, 1, 52, 'Het aantal kaarten') }; },
    fromLogic(node, e){
      const each = rbPlayerFrom(node.forEach);
      if (!each || each.kind === 'neighbor' || each.kind === 'winner') return null;
      e.each = each; e.count = node.discardTop;
      return e;
    },
    editor(box, e){
      box.appendChild(rbMake('span', 'bld-word', 'Wie legt af:'));
      box.appendChild(rbPlayerEditor(e.each, 'forEach', 'Wie legt af'));
      box.appendChild(rbMake('span', 'bld-word', 'Aantal kaarten:'));
      box.appendChild(rbNumber(e.count, 1, 52, 'Aantal kaarten', v => { e.count = v; }));
    }
  }
});
