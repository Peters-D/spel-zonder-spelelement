// De regelbouwer, zonder scherm: een regel die je aan elkaar klikt is een "stand" (gewone gegevens, zie rbNewState). Dit bestand zet
// zo'n stand om in een regelbeschrijving (logic, zie js/rule-dsl.js) en terug, en bedenkt voorbeelden voor de regel. Het scherm
// (js/rule-builder-ui.js) vult alleen de stand en laat het resultaat zien.
//
//   rbNewState(moment)            een lege stand voor een moment, met een gevolg dat klopt
//   rbToLogic(state)              { logic } of { error } (een melding in gewone taal)
//   rbFromLogic(logic)            de stand bij een beschrijving, of null als de bouwer die niet kan tonen (dieper dan één groep,
//                                 meer dan twee eisen aan een kaart)
//   rbSuggestExamples(logic)      { examples, note }: voorbeelden die het spel zelf zoekt (zie hieronder)
//   rbBlock(state)                het hele regelblok: { def, sentence, note } of { errors }
//
// De stand:
//   { moment, title, condMode: 'and' | 'or', conds: [voorwaarde, ...], effect }
// Een keuze van kaarten (cs): { kind, ranks, suits, color, by, of, relation, min, not, also }
//   kind: 'rank' | 'suit' | 'color' | 'all' | 'highest' | 'lowest' | 'group'; not (niet) en also (en ook een tweede eis) kunnen alleen bij
//   rank, suit en color.
// Een voorwaarde: { key, not, ... } (key: exists, count, battle, winnerOpened, anyPlayer, playersWithCards), of een groep
// voorwaarden { key: 'group', not, mode: 'and' | 'or', conds: [...] } (één niveau diep): daarmee maak je "a en (b of c)".
// Een gevolg: { key, ... } (key: win, discardPot, sharePot, transfer, discardTop)
//
// De voorbeelden: het spel zoekt zelf een paar willekeurige tafels (of verdelingen) waarop de regel iets anders doet dan het gewone spel, en
// legt vast wat er dan gebeurt. Ze bewijzen dat het blok doet wat het doet, niet dat het doet wat je bedoelde.

const RB_SINGLE = ['rank', 'suit', 'color'];
const RB_RANKS_DESC = RANKS.slice().reverse(); // A K Q J 10 ... 2, zoals in een zin

function RB_ERR(message){
  const e = new Error(message);
  e.rb = true;
  return e;
}

function rbNewCards(kind){
  return { kind: kind || 'rank', ranks: ['A'], suits: ['♥'], color: 'red', by: 'value', of: 'none', relation: 'sameRank', min: 2, not: false, also: null };
}

const rbInt = (v, min, max, what) => {
  if (!Number.isInteger(v) || v < min || v > max) throw RB_ERR(what + ': een getal van ' + min + ' t/m ' + max + ' verwacht.');
  return v;
};

// Een keuze van kaarten -> beschrijving. singleOnly: alleen een soort kaart (waarde, symbool of kleur), zoals bij "begon met".
function rbCards(cs, singleOnly){
  if (!cs || typeof cs !== 'object') throw RB_ERR('Kies welke kaarten bedoeld zijn.');
  if (singleOnly && !RB_SINGLE.includes(cs.kind)) throw RB_ERR('Hier past alleen een waarde, een symbool of een kleur.');
  let node;
  if (cs.kind === 'rank'){
    const ranks = RB_RANKS_DESC.filter(r => (cs.ranks || []).includes(r));
    if (ranks.length === 0) throw RB_ERR('Kies minstens één waarde.');
    node = { rank: ranks.length === 1 ? ranks[0] : ranks };
  } else if (cs.kind === 'suit'){
    const suits = SUITS.filter(x => (cs.suits || []).includes(x));
    if (suits.length === 0) throw RB_ERR('Kies minstens één symbool.');
    node = { suit: suits.length === 1 ? suits[0] : suits };
  } else if (cs.kind === 'color'){
    if (!['red', 'black'].includes(cs.color)) throw RB_ERR('Kies rood of zwart.');
    node = { color: cs.color };
  } else if (cs.kind === 'all'){
    node = { all: true };
  } else if (cs.kind === 'highest' || cs.kind === 'lowest'){
    if (!['value', 'suitOrder'].includes(cs.by)) throw RB_ERR('Kies of de hoogste op waarde of op symbool gaat.');
    node = { [cs.kind]: cs.by };
    if (cs.of === 'red' || cs.of === 'black') node.of = { color: cs.of };
  } else if (cs.kind === 'group'){
    if (!['sameRank', 'sameSuit', 'sameColor', 'consecutive'].includes(cs.relation)) throw RB_ERR('Kies welke kaarten bij elkaar horen.');
    node = { group: { relation: cs.relation, min: rbInt(cs.min, 2, 8, 'Aantal kaarten in de groep'), pick: 'highest' } };
  } else throw RB_ERR('Kies welke kaarten bedoeld zijn.');
  if (RB_SINGLE.includes(cs.kind)){
    if (cs.also) node = { and: [node, rbCards(cs.also, true)] };
    if (cs.not) node = { not: node };
  }
  return node;
}

// De spelers bij award en roundEnd.
function rbPlayer(p, moment){
  if (!p || typeof p !== 'object') throw RB_ERR('Kies welke spelers bedoeld zijn.');
  if (p.kind === 'winner'){
    if (moment !== 'award') throw RB_ERR('De winnaar bestaat alleen als de pot wordt toegekend.');
    return 'winner';
  }
  if (p.kind === 'withoutCards') return { withoutCards: true };
  if (p.kind === 'neighbor'){
    if (!['left', 'right'].includes(p.side)) throw RB_ERR('Kies de linker- of rechterbuur.');
    return { neighbor: p.side };
  }
  if (p.kind === 'opened'){
    const node = { opened: rbCards(p.cs, true) };
    if (p.other){
      if (moment !== 'award') throw RB_ERR('"Behalve de winnaar" kan alleen als de pot wordt toegekend.');
      node.exclude = 'winner';
    }
    return node;
  }
  throw RB_ERR('Kies welke spelers bedoeld zijn.');
}

// min/max uit een keuze (minstens, ten hoogste, precies, tussen).
function rbRange(c, max){
  const n = rbInt(c.n, 0, max, 'Het aantal');
  if (c.mode === 'min') return { min: n };
  if (c.mode === 'max') return { max: n };
  if (c.mode === 'exact') return { min: n, max: n };
  if (c.mode === 'between'){
    const m = rbInt(c.m, 0, max, 'Het tweede aantal');
    if (m < n) throw RB_ERR('Het tweede aantal moet minstens zo groot zijn als het eerste.');
    return { min: n, max: m };
  }
  throw RB_ERR('Kies minstens, ten hoogste, precies of tussen.');
}

function rbCond(c, moment, nested){
  let node;
  if (c.key === 'group'){ // een groep voorwaarden binnen de lijst: (a of b), één niveau diep
    if (nested) throw RB_ERR('Een groep binnen een groep kan de bouwer niet maken.');
    const items = (c.conds || []).map(x => rbCond(x, moment, true));
    if (items.length === 0) throw RB_ERR('Voeg een voorwaarde toe aan de groep.');
    node = items.length === 1 ? items[0] : { [c.mode === 'and' ? 'and' : 'or']: items };
    return c.not ? { not: node } : node;
  }
  if (c.key === 'exists') node = { exists: rbCards(c.cs, false) };
  else if (c.key === 'count') node = Object.assign({ count: rbCards(c.cs, false) }, rbRange(c, 52));
  else if (c.key === 'battle') node = { battle: true };
  else if (c.key === 'winnerOpened') node = { winnerOpened: rbCards(c.cs, true) };
  else if (c.key === 'anyPlayer') node = { anyPlayer: rbPlayer({ kind: c.who, cs: c.cs, other: c.other }, moment) };
  else if (c.key === 'playersWithCards') node = { playersWithCards: rbRange(c, 8) };
  else throw RB_ERR('Kies een voorwaarde.');
  return c.not ? { not: node } : node;
}

function rbEffect(e, moment){
  if (e.key === 'win') return { win: rbCards(e.cs, false) };
  if (e.key === 'discardPot') return { discardPot: true };
  if (e.key === 'sharePot'){
    if (!Array.isArray(e.who) || e.who.length === 0) throw RB_ERR('Kies over welke spelers de pot wordt verdeeld.');
    return { sharePot: e.who.map(p => rbPlayer(p, moment)) };
  }
  if (e.key === 'transfer'){
    return { forEach: rbPlayer(e.each, moment), transfer: { from: rbPlayer(e.from, moment), count: rbInt(e.count, 1, 52, 'Het aantal kaarten') } };
  }
  if (e.key === 'discardTop') return { forEach: rbPlayer(e.each, moment), discardTop: rbInt(e.count, 1, 52, 'Het aantal kaarten') };
  throw RB_ERR('Kies wat er gebeurt.');
}

function rbNewCond(key){
  const c = { key, not: false };
  if (key === 'exists' || key === 'count' || key === 'winnerOpened') c.cs = rbNewCards('rank');
  if (key === 'count') Object.assign(c, { mode: 'min', n: 2, m: 3 });
  if (key === 'anyPlayer') Object.assign(c, { who: 'withoutCards', cs: rbNewCards('rank'), other: false });
  if (key === 'playersWithCards') Object.assign(c, { mode: 'min', n: 2, m: 3 });
  if (key === 'group') Object.assign(c, { mode: 'or', conds: [] });
  return c;
}

function rbNewPlayer(kind){
  return { kind, cs: rbNewCards('rank'), other: false, side: 'left' };
}

function rbNewEffect(key){
  const e = { key };
  if (key === 'win') e.cs = rbNewCards('rank');
  if (key === 'sharePot') e.who = [rbNewPlayer('winner')];
  if (key === 'transfer') Object.assign(e, { each: rbNewPlayer('withoutCards'), from: rbNewPlayer('neighbor'), count: 1 });
  if (key === 'discardTop') Object.assign(e, { each: rbNewPlayer('opened'), count: 1 });
  return e;
}

// Een lege stand voor een moment, met een gevolg dat bij dat moment past.
function rbNewState(moment){
  const effects = { decide: 'win', tiebreak: 'win', award: 'discardPot', roundEnd: 'discardTop' };
  const effect = rbNewEffect(effects[moment] || 'win');
  if (moment === 'tiebreak') effect.cs = Object.assign(rbNewCards('highest'), { by: 'suitOrder' });
  return { moment: moment || 'decide', title: '', condMode: 'and', conds: [], effect };
}

// stand -> { logic } of { error }
function rbToLogic(st){
  try {
    const moment = st.moment;
    const logic = { moment };
    const conds = (st.conds || []).map(c => rbCond(c, moment));
    if (conds.length === 1) logic.if = conds[0];
    else if (conds.length > 1) logic.if = { [st.condMode === 'or' ? 'or' : 'and']: conds };
    logic.then = rbEffect(st.effect, moment);
    const errors = validateRuleLogic(logic);
    if (errors.length) throw RB_ERR('De regel klopt nog niet: ' + errors[0]);
    return { logic };
  } catch (e){
    if (e && e.rb) return { error: e.message };
    throw e;
  }
}

// ---- beschrijving -> stand (voor een blok dat al bestaat) ----

function rbCardsFrom(node){
  const out = rbNewCards('rank');
  if ('not' in node){
    const inner = rbCardsFrom(node.not);
    if (!inner || !RB_SINGLE.includes(inner.kind) || inner.not) return null;
    inner.not = true;
    return inner;
  }
  if ('and' in node){
    if (node.and.length !== 2) return null;
    const a = rbCardsFrom(node.and[0]), b = rbCardsFrom(node.and[1]);
    if (!a || !b || !RB_SINGLE.includes(a.kind) || !RB_SINGLE.includes(b.kind) || a.not || a.also || b.also) return null;
    a.also = b;
    return a;
  }
  if ('rank' in node){ out.kind = 'rank'; out.ranks = rtList(node.rank).slice(); return out; }
  if ('suit' in node){ out.kind = 'suit'; out.suits = rtList(node.suit).slice(); return out; }
  if ('color' in node){ out.kind = 'color'; out.color = node.color; return out; }
  if ('all' in node){ out.kind = 'all'; return out; }
  if ('highest' in node || 'lowest' in node){
    out.kind = 'highest' in node ? 'highest' : 'lowest';
    out.by = node[out.kind];
    if ('of' in node){
      if (!('color' in node.of)) return null;
      out.of = node.of.color;
    }
    return out;
  }
  if ('group' in node){ out.kind = 'group'; out.relation = node.group.relation; out.min = node.group.min; return out; }
  return null;
}

function rbPlayerFrom(node){
  if (node === 'winner') return rbNewPlayer('winner');
  const p = rbNewPlayer('withoutCards');
  if ('withoutCards' in node) return p;
  if ('neighbor' in node){ p.kind = 'neighbor'; p.side = node.neighbor; return p; }
  p.kind = 'opened';
  p.cs = rbCardsFrom(node.opened);
  if (!p.cs || !RB_SINGLE.includes(p.cs.kind)) return null;
  p.other = node.exclude === 'winner';
  return p;
}

function rbRangeFrom(node, out){
  const has = k => node[k] !== undefined;
  if (has('min') && has('max')){ out.mode = node.min === node.max ? 'exact' : 'between'; out.n = node.min; out.m = node.max; }
  else if (has('min')){ out.mode = 'min'; out.n = node.min; }
  else { out.mode = 'max'; out.n = node.max; }
}

function rbCondFrom(node, nested){
  let not = false;
  if ('not' in node){ not = true; node = node.not; }
  let c;
  if ('and' in node || 'or' in node){ // een groep, één niveau diep
    if (nested) return null;
    const mode = 'and' in node ? 'and' : 'or';
    const conds = node[mode].map(x => rbCondFrom(x, true));
    if (conds.some(x => !x)) return null;
    return { key: 'group', not, mode, conds };
  }
  if ('exists' in node){ c = rbNewCond('exists'); c.cs = rbCardsFrom(node.exists); if (!c.cs) return null; }
  else if ('count' in node){ c = rbNewCond('count'); c.cs = rbCardsFrom(node.count); if (!c.cs) return null; rbRangeFrom(node, c); }
  else if ('battle' in node) c = rbNewCond('battle');
  else if ('winnerOpened' in node){ c = rbNewCond('winnerOpened'); c.cs = rbCardsFrom(node.winnerOpened); if (!c.cs) return null; }
  else if ('anyPlayer' in node){
    c = rbNewCond('anyPlayer');
    const p = rbPlayerFrom(node.anyPlayer);
    if (!p || p.kind === 'neighbor') return null;
    c.who = p.kind; c.cs = p.cs; c.other = p.other;
  } else if ('playersWithCards' in node){ c = rbNewCond('playersWithCards'); rbRangeFrom(node.playersWithCards, c); }
  else return null; // dubbele "niet": dat toont de bouwer niet
  c.not = not;
  return c;
}

function rbEffectFrom(node){
  if ('win' in node){ const e = rbNewEffect('win'); e.cs = rbCardsFrom(node.win); return e.cs ? e : null; }
  if ('discardPot' in node) return rbNewEffect('discardPot');
  if ('sharePot' in node){
    const who = node.sharePot.map(rbPlayerFrom);
    if (who.some(p => !p || p.kind === 'neighbor')) return null;
    const e = rbNewEffect('sharePot');
    e.who = who;
    return e;
  }
  if ('transfer' in node){
    const e = rbNewEffect('transfer'), each = rbPlayerFrom(node.forEach), from = rbPlayerFrom(node.transfer.from);
    if (!each || !from || each.kind === 'neighbor' || each.kind === 'winner' || from.kind === 'withoutCards' || from.kind === 'winner') return null;
    e.each = each; e.from = from; e.count = node.transfer.count;
    return e;
  }
  const e = rbNewEffect('discardTop'), each = rbPlayerFrom(node.forEach);
  if (!each || each.kind === 'neighbor' || each.kind === 'winner') return null;
  e.each = each; e.count = node.discardTop;
  return e;
}

// beschrijving -> stand, of null als de bouwer die niet kan tonen (bijvoorbeeld en/of binnen een voorwaarde, of meer dan twee eisen).
function rbFromLogic(logic){
  if (validateRuleLogic(logic).length) return null;
  const st = rbNewState(logic.moment);
  st.conds = [];
  if ('if' in logic){
    const top = logic.if;
    const list = 'and' in top ? { mode: 'and', items: top.and } : 'or' in top ? { mode: 'or', items: top.or } : { mode: 'and', items: [top] };
    st.condMode = list.mode;
    for (const item of list.items){
      const c = rbCondFrom(item);
      if (!c) return null;
      st.conds.push(c);
    }
  }
  const effect = rbEffectFrom(logic.then);
  if (!effect) return null;
  st.effect = effect;
  return st;
}

// ---- voorbeelden zoeken ----

function rbFormatPlayers(ids){
  const names = ids.map(i => String(i + 1));
  return (ids.length > 1 ? 'speler ' + names.slice(0, -1).join(', ') + ' en ' + names[names.length - 1] : 'speler ' + names[0]);
}
function rbOutcome(ids){ return ids.length > 1 ? rbFormatPlayers(ids) + ' battlen' : rbFormatPlayers(ids) + ' wint'; }
const rbCardText = c => c.rank + c.suit;
const rbTrim = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

// Deelt n verschillende kaarten uit een deel van het spel: met "few" een paar waarden (dan zijn er vaak paren), anders alle.
function rbDeal(rnd, n, few){
  let deck = buildDeck();
  if (few){
    const ranks = shuffle(RANKS.slice(), rnd).slice(0, few);
    deck = deck.filter(c => ranks.includes(c.rank));
  }
  return shuffle(deck, rnd).slice(0, n);
}

function rbSuggestExamples(logic){
  const id = 'custom-voorbeeld-zoeken';
  const def = { id, title: 't', short: 't', description: 't', priority: 200, logic, examples: [] };
  const rnd = mulberry32(hashSeed('voorbeelden'));
  const off = {}, on = {};
  for (const r of RULES){ off[r.id] = false; on[r.id] = false; }
  on[id] = true;
  const preview = customPreview(def);
  try {
    const moment = logic.moment;
    const picks = { diff: [], same: [] };
    const add = (kind, item) => { if (picks[kind].length < (kind === 'diff' ? 12 : 1)) picks[kind].push(item); };
    for (let t = 0; t < 600 && (picks.diff.length < 12 || picks.same.length < 1); t++){
      if (moment === 'decide' || moment === 'tiebreak'){
        const n = 2 + Math.floor(rnd() * 4);
        const few = moment === 'tiebreak' || t % 2 === 0 ? 3 + Math.floor(rnd() * 3) : 0;
        const cards = rbDeal(rnd, n, few);
        const inPlay = cards.map((c, i) => ({ id: i, faceCard: c }));
        const a = findWinningPlayers(inPlay, off).map(p => p.id), b = findWinningPlayers(inPlay, on).map(p => p.id);
        const item = { cards: cards.map(rbCardText), winners: b, text: 'Met de regel: ' + rbOutcome(b) + '. Zonder de regel: ' + rbOutcome(a) + '.', n, key: JSON.stringify(b) };
        add(JSON.stringify(a) === JSON.stringify(b) ? 'same' : 'diff', item);
      } else {
        const n = 2 + Math.floor(rnd() * 3);
        const pool = rbDeal(rnd, 12, t % 2 === 0 ? 4 : 0);
        const sizes = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 4));
        if (sizes.reduce((x, y) => x + y, 0) > pool.length) continue;
        let at = 0;
        const decks = sizes.map(k => pool.slice(at, (at += k)));
        const play = rules => {
          const st = createGameState(decks.map((d, i) => ({ id: i, name: 'S' + i, deck: d.map(c => Object.assign({}, c)) })), rules);
          enginePlayRound(st);
          return { after: st.players.map(p => p.deck.map(rbCardText)), discarded: st.discard.length };
        };
        const a = play(off), b = play(on);
        const show = r => r.after.map((d, i) => 'speler ' + (i + 1) + ': ' + (d.length ? d.join(' ') : 'geen kaarten')).join('; ') + (r.discarded ? ' (afgelegd: ' + r.discarded + ')' : '');
        const item = { decks: decks.map(d => d.map(rbCardText)), after: b.after, discarded: b.discarded, text: 'Met de regel: ' + show(b) + '. Zonder de regel: ' + show(a) + '.', n, key: JSON.stringify(b) };
        add(JSON.stringify(a) === JSON.stringify(b) ? 'same' : 'diff', item);
      }
    }
    // Twee die iets doen (liefst verschillende uitkomsten en aantallen spelers), en een waar de regel niets doet.
    const chosen = [];
    for (const item of picks.diff){
      if (chosen.length < 2 && !chosen.some(c => c.key === item.key || c.n === item.n)) chosen.push(item);
    }
    for (const item of picks.diff) if (chosen.length < 2 && !chosen.includes(item)) chosen.push(item);
    if (picks.same.length) chosen.push(picks.same[0]);
    const examples = chosen.map(item => {
      const out = Object.assign({}, item);
      delete out.n; delete out.key;
      out.text = rbTrim(out.text, 300);
      return out;
    });
    const note = picks.diff.length === 0
      ? 'De regel deed op de geprobeerde situaties niets; de voorbeelden laten dat zien. Voeg zelf een voorbeeld toe als je een situatie weet waarin hij wél iets doet.'
      : picks.same.length === 0 ? 'De regel deed op elke geprobeerde situatie iets; er is geen voorbeeld waar hij niets doet.' : '';
    return { examples, note, found: picks.diff.length };
  } finally { preview.restore(); }
}

// ---- het blok ----

function rbSlug(text){
  const slug = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
  return slug || 'nieuwe-regel';
}

// stand -> het regelblok (zoals parseCustomRule het verwacht), de zin en een eventuele opmerking over de voorbeelden.
function rbBlock(st){
  const r = rbToLogic(st);
  if (r.error) return { errors: [r.error] };
  const sentence = describeRuleLogic(r.logic);
  const title = (st.title || '').trim().slice(0, 60) || 'Nieuwe regel';
  const ex = rbSuggestExamples(r.logic);
  const def = { id: 'custom-' + rbSlug(title), title, short: rbTrim(sentence, 160), description: rbTrim(sentence, 1500), priority: 200, logic: r.logic, examples: ex.examples };
  return { def, sentence, note: ex.note, found: ex.found };
}
