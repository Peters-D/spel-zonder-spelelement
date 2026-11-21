// Bouwstenen: de gevolgen (then) van een regelbeschrijving. Zie js/rule-registry.js voor wat elk onderdeel betekent.
// De volgorde hieronder is de volgorde in meldingen en keuzelijsten.

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
  }
});

// award: ctx = { state, winner, how, potSize } (zie engineRunHooks).
defineBlock('effect', {
  key: 'discardPot', moments: ['award'], label: 'de hele pot gaat naar de aflegstapel', sample: { discardPot: true }, usesDiscard: true,
  validate(node, path, v){ if (node.discardPot !== true) v.err(path + '.discardPot', 'true verwacht'); },
  run(then, ctx){ engineDiscardPot(ctx.state); },
  parts(){ return { s: 'de hele pot', v: 'gaat', r: 'naar de aflegstapel' }; }
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
    const from = 'neighbor' in t.from ? rtPlayer(t.from, false)
      : 'de eerste speler die de ronde begon met ' + rtCards(t.from.opened).single;
    return { s: rtPlayer(then.forEach, true), v: 'krijgt', r: n + ' van ' + from };
  }
});

defineBlock('effect', {
  key: 'discardTop', moments: ['roundEnd'], label: 'spelers leggen kaarten af', sample: { forEach: { opened: { rank: 'K' } }, discardTop: 1 }, usesDiscard: true,
  validate(node, path, v){ v.int(node.discardTop, path + '.discardTop', 1, DSL_MAX_CARDS); },
  run(then, ctx, targets){ targets.forEach(p => engineDiscardFromDeck(ctx.state, p.id, then.discardTop)); },
  parts(then){
    return { s: rtPlayer(then.forEach, true), v: 'legt', r: (then.discardTop === 1 ? 'zijn bovenste kaart' : 'zijn bovenste ' + then.discardTop + ' kaarten') + ' af' };
  }
});
