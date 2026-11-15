// Het scherm van de regelbouwer: je kiest een moment, voorwaarden en een gevolg, en het spel maakt er een regelblok van (zie
// js/rule-builder.js) dat in het tekstvak van het venster "Eigen regel" komt en meteen wordt gecontroleerd. Alle teksten gaan als
// gewone tekst in de pagina (textContent).

let rb = null;            // de stand van de bouwer (zie rbNewState)
let rbFocus = 0;          // de teller voor de bedieningselementen, om de focus na opnieuw tekenen terug te zetten
let rbFocusWanted = -1;

const RB_CARD_LABELS = { rank: 'een bepaalde waarde', suit: 'een bepaald symbool', color: 'rode of zwarte kaarten', all: 'alle kaarten',
  highest: 'de hoogste kaart', lowest: 'de laagste kaart', group: 'de hoogste groep kaarten' };
const RB_RELATION_LABELS = { sameRank: 'met dezelfde waarde', sameSuit: 'van hetzelfde symbool', sameColor: 'van dezelfde kleur', consecutive: 'met opeenvolgende waarden' };
const RB_MODE_LABELS = { min: 'minstens', max: 'ten hoogste', exact: 'precies', between: 'tussen' };

const bldById = id => document.getElementById(id);

// ---- kleine bouwstenen voor het formulier ----

function rbMake(tag, className, text){
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Een bedieningselement krijgt een volgnummer; na opnieuw tekenen krijgt het element met hetzelfde nummer de focus terug.
function rbRegister(el){
  const n = rbFocus++;
  el.dataset.rbn = String(n);
  if (n === rbFocusWanted) rbFocusPending = el;
  return el;
}
let rbFocusPending = null;

// structural: na de wijziging moet het formulier opnieuw worden getekend (er komen andere velden).
function rbSelect(options, value, label, onChange, structural){
  const sel = rbRegister(rbMake('select'));
  sel.setAttribute('aria-label', label);
  for (const [v, text] of options){
    const o = rbMake('option', '', text);
    o.value = v;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener('change', () => { onChange(sel.value); rbChanged(structural); });
  return sel;
}

function rbNumber(value, min, max, label, onChange){
  const inp = rbRegister(rbMake('input', 'bld-number'));
  inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.value = String(value);
  inp.setAttribute('aria-label', label);
  inp.addEventListener('input', () => { onChange(inp.value === '' ? NaN : parseInt(inp.value, 10)); rbChanged(false); });
  return inp;
}

function rbCheck(text, checked, onChange, structural, className){
  const lab = rbMake('label', 'bld-check' + (className ? ' ' + className : ''));
  const inp = rbRegister(rbMake('input'));
  inp.type = 'checkbox'; inp.checked = !!checked;
  inp.addEventListener('change', () => { onChange(inp.checked); rbChanged(structural); });
  lab.appendChild(inp);
  lab.appendChild(rbMake('span', '', text));
  return lab;
}

function rbButton(text, label, onClick){
  const b = rbRegister(rbMake('button', 'bld-small', text));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => { onClick(); rbChanged(true); });
  return b;
}

// Een rij chips om een of meer waarden te kiezen (waarden of symbolen).
function rbChips(options, selected, label, onChange){
  const box = rbMake('div', 'bld-chips');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', label);
  for (const [v, text, red] of options){
    box.appendChild(rbCheck(text, selected.includes(v), on => { onChange(v, on); }, false, 'bld-chip' + (red ? ' red-suit' : '')));
  }
  return box;
}

// ---- keuzes van kaarten, spelers, aantallen ----

function rbCardsEditor(cs, single, label){
  const box = rbMake('div', 'bld-cards');
  const kinds = single ? ['rank', 'suit', 'color'] : ['rank', 'suit', 'color', 'all', 'highest', 'lowest', 'group'];
  box.appendChild(rbSelect(kinds.map(k => [k, RB_CARD_LABELS[k]]), cs.kind, label + ': soort kaarten', v => { cs.kind = v; }, true));
  if (cs.kind === 'rank'){
    box.appendChild(rbChips(RANKS.slice().reverse().map(r => [r, r]), cs.ranks, label + ': waarden', (v, on) => {
      cs.ranks = on ? cs.ranks.concat(v) : cs.ranks.filter(x => x !== v);
    }));
  } else if (cs.kind === 'suit'){
    box.appendChild(rbChips(SUITS.map(s => [s, s, s === '♥' || s === '♦']), cs.suits, label + ': symbolen', (v, on) => {
      cs.suits = on ? cs.suits.concat(v) : cs.suits.filter(x => x !== v);
    }));
  } else if (cs.kind === 'color'){
    box.appendChild(rbSelect([['red', 'rode kaarten'], ['black', 'zwarte kaarten']], cs.color, label + ': kleur', v => { cs.color = v; }, false));
  } else if (cs.kind === 'highest' || cs.kind === 'lowest'){
    box.appendChild(rbSelect([['value', 'op waarde'], ['suitOrder', 'op symbool (jouw volgorde)']], cs.by, label + ': hoogste of laagste op', v => { cs.by = v; }, false));
    box.appendChild(rbSelect([['none', 'onder alle kaarten'], ['red', 'onder de rode kaarten'], ['black', 'onder de zwarte kaarten']], cs.of, label + ': onder welke kaarten', v => { cs.of = v; }, false));
  } else if (cs.kind === 'group'){
    box.appendChild(rbSelect(Object.entries(RB_RELATION_LABELS), cs.relation, label + ': kaarten die bij elkaar horen', v => { cs.relation = v; }, false));
    box.appendChild(rbMake('span', 'bld-word', 'minstens'));
    box.appendChild(rbNumber(cs.min, 2, 8, label + ': minstens zoveel kaarten', v => { cs.min = v; }));
  }
  if (['rank', 'suit', 'color'].includes(cs.kind)){
    box.appendChild(rbCheck('niet deze', cs.not, v => { cs.not = v; }, false));
    if (cs.also){
      const also = rbMake('div', 'bld-also');
      also.appendChild(rbMake('span', 'bld-word', 'en ook:'));
      also.appendChild(rbCardsEditor(cs.also, true, label + ' (tweede eis)'));
      also.appendChild(rbButton('× tweede eis weg', label + ': tweede eis weghalen', () => { cs.also = null; }));
      box.appendChild(also);
    } else {
      box.appendChild(rbButton('+ en ook een tweede eis', label + ': tweede eis toevoegen', () => { cs.also = rbNewCards('suit'); }));
    }
  }
  return box;
}

function rbRangeEditor(c, max, label){
  const box = rbMake('span', 'bld-range');
  box.appendChild(rbSelect(Object.entries(RB_MODE_LABELS), c.mode, label + ': minstens, ten hoogste, precies of tussen', v => { c.mode = v; }, true));
  box.appendChild(rbNumber(c.n, 0, max, label + ': aantal', v => { c.n = v; }));
  if (c.mode === 'between'){
    box.appendChild(rbMake('span', 'bld-word', 'en'));
    box.appendChild(rbNumber(c.m, 0, max, label + ': tweede aantal', v => { c.m = v; }));
  }
  return box;
}

// Een speler of groep spelers; slot: sharePot, forEach, anyPlayer of from (zie rulePlayerChoices).
function rbPlayerEditor(p, slot, label){
  const box = rbMake('div', 'bld-player');
  const choices = rulePlayerChoices(slot, rb.moment);
  const names = { winner: 'de winnaar', opened: 'spelers die begonnen met een kaart', withoutCards: 'spelers zonder kaarten', neighbor: 'de linker- of rechterbuur' };
  if (!choices.some(c => c.key === p.kind)) p.kind = choices[0].key;
  box.appendChild(rbSelect(choices.map(c => [c.key, names[c.key]]), p.kind, label + ': welke spelers', v => { p.kind = v; }, true));
  if (p.kind === 'opened'){
    box.appendChild(rbCardsEditor(p.cs, true, label));
    if (RULE_BLOCKS.players.find(b => b.key === 'opened').excludeMoments.includes(rb.moment)) box.appendChild(rbCheck('behalve de winnaar', p.other, v => { p.other = v; }, false));
  } else if (p.kind === 'neighbor'){
    box.appendChild(rbSelect([['left', 'de linkerbuur'], ['right', 'de rechterbuur']], p.side, label + ': links of rechts', v => { p.side = v; }, false));
  }
  return box;
}

// ---- voorwaarden en gevolg ----

function rbCondRow(c, i){
  const row = rbMake('div', 'bld-row');
  const label = 'Voorwaarde ' + (i + 1);
  const keys = ruleChoicesFor(rb.moment).conditions.filter(x => !['and', 'or', 'not'].includes(x.key));
  const head = rbMake('div', 'bld-head');
  head.appendChild(rbSelect(keys.map(k => [k.key, k.label]), c.key, label + ': soort', v => { rb.conds[i] = rbNewCond(v); }, true));
  head.appendChild(rbCheck('niet', c.not, v => { c.not = v; }, false));
  head.appendChild(rbButton('× weg', label + ' weghalen', () => { rb.conds.splice(i, 1); }));
  row.appendChild(head);
  if (c.key === 'exists') row.appendChild(rbCardsEditor(c.cs, false, label));
  if (c.key === 'count'){ row.appendChild(rbRangeEditor(c, 52, label)); row.appendChild(rbCardsEditor(c.cs, false, label)); }
  if (c.key === 'winnerOpened') row.appendChild(rbCardsEditor(c.cs, true, label));
  if (c.key === 'playersWithCards'){ row.appendChild(rbRangeEditor(c, 8, label)); row.appendChild(rbMake('span', 'bld-word', 'spelers hebben kaarten')); }
  if (c.key === 'anyPlayer'){
    // Een voorwaarde "er is een speler die ..." heeft dezelfde velden als een speler, onder andere namen: de keuzes gaan direct naar c.
    const p = { get kind(){ return c.who; }, set kind(v){ c.who = v; }, get cs(){ return c.cs; }, set cs(v){ c.cs = v; }, get other(){ return c.other; }, set other(v){ c.other = v; } };
    row.appendChild(rbPlayerEditor(p, 'anyPlayer', label));
  }
  return row;
}

function rbEffectEditor(e){
  const box = rbMake('div', 'bld-row');
  const keys = ruleChoicesFor(rb.moment).effects;
  box.appendChild(rbSelect(keys.map(k => [k.key, k.label]), e.key, 'Gevolg: soort', v => { rb.effect = rbNewEffect(v); if (rb.moment === 'tiebreak' && v === 'win') rb.effect.cs = Object.assign(rbNewCards('highest'), { by: 'suitOrder' }); }, true));
  if (e.key === 'win') box.appendChild(rbCardsEditor(e.cs, false, 'Gevolg'));
  if (e.key === 'sharePot'){
    e.who.forEach((p, i) => {
      const line = rbMake('div', 'bld-line');
      line.appendChild(rbPlayerEditor(p, 'sharePot', 'Verdelen over ' + (i + 1)));
      if (e.who.length > 1) line.appendChild(rbButton('× weg', 'Spelers ' + (i + 1) + ' weghalen', () => { e.who.splice(i, 1); }));
      box.appendChild(line);
    });
    box.appendChild(rbButton('+ spelers erbij', 'Spelers toevoegen', () => { e.who.push(rbNewPlayer('opened')); }));
  }
  if (e.key === 'transfer'){
    box.appendChild(rbMake('span', 'bld-word', 'Wie krijgt kaarten:'));
    box.appendChild(rbPlayerEditor(e.each, 'forEach', 'Wie krijgt kaarten'));
    box.appendChild(rbMake('span', 'bld-word', 'Aantal kaarten:'));
    box.appendChild(rbNumber(e.count, 1, 52, 'Aantal kaarten', v => { e.count = v; }));
    box.appendChild(rbMake('span', 'bld-word', 'Van wie:'));
    box.appendChild(rbPlayerEditor(e.from, 'from', 'Van wie'));
  }
  if (e.key === 'discardTop'){
    box.appendChild(rbMake('span', 'bld-word', 'Wie legt af:'));
    box.appendChild(rbPlayerEditor(e.each, 'forEach', 'Wie legt af'));
    box.appendChild(rbMake('span', 'bld-word', 'Aantal kaarten:'));
    box.appendChild(rbNumber(e.count, 1, 52, 'Aantal kaarten', v => { e.count = v; }));
  }
  return box;
}

// ---- tekenen en bijwerken ----

function rbRender(){
  const form = bldById('ruleBuilderForm');
  if (!form) return;
  rbFocus = 0;
  rbFocusPending = null;
  form.innerHTML = '';
  const top = rbMake('div', 'bld-top');
  const title = rbMake('input', 'bld-title');
  title.type = 'text'; title.maxLength = 60; title.value = rb.title; title.placeholder = 'Naam van de regel';
  title.setAttribute('aria-label', 'Naam van de regel');
  title.setAttribute('autocomplete', 'off');
  title.addEventListener('input', () => { rb.title = title.value; rbChanged(false); });
  top.appendChild(title);
  top.appendChild(rbSelect(RULE_MOMENTS.map(m => [m.id, m.label]), rb.moment, 'Moment', v => { rb = Object.assign(rbNewState(v), { title: rb.title }); }, true));
  form.appendChild(top);

  const conds = rbMake('div', 'bld-section');
  conds.appendChild(rbMake('h4', 'bld-sub', 'Voorwaarden (niet verplicht)'));
  rb.conds.forEach((c, i) => conds.appendChild(rbCondRow(c, i)));
  if (rb.conds.length > 1){
    conds.appendChild(rbSelect([['and', 'alle voorwaarden moeten gelden'], ['or', 'één voorwaarde is genoeg']], rb.condMode, 'Hoe de voorwaarden samengaan', v => { rb.condMode = v; }, false));
  }
  conds.appendChild(rbButton('+ voorwaarde', 'Voorwaarde toevoegen', () => {
    const first = ruleChoicesFor(rb.moment).conditions.find(x => !['and', 'or', 'not'].includes(x.key));
    rb.conds.push(rbNewCond(first.key));
  }));
  form.appendChild(conds);

  const eff = rbMake('div', 'bld-section');
  eff.appendChild(rbMake('h4', 'bld-sub', 'Wat gebeurt er?'));
  eff.appendChild(rbEffectEditor(rb.effect));
  form.appendChild(eff);
  if (rbFocusPending) rbFocusPending.focus();
  rbFocusWanted = -1;
}

// Na een wijziging: opnieuw tekenen (bij andere velden), en het regelblok bijwerken.
function rbChanged(structural){
  if (structural){
    const active = document.activeElement;
    rbFocusWanted = active && active.dataset && active.dataset.rbn !== undefined ? parseInt(active.dataset.rbn, 10) : -1;
    rbRender();
  }
  rbRefreshOutput();
}

function rbRefreshOutput(){
  const sentence = bldById('ruleBuilderSentence');
  const built = rbBlock(rb);
  if (built.errors){
    sentence.textContent = 'Nog niet klaar: ' + built.errors[0];
    customInvalidate();
    customShowMessages([[false, built.errors[0]]]);
    return;
  }
  sentence.textContent = built.sentence;
  customEl('customRuleText').value = JSON.stringify(built.def, null, 2);
  customCheck();
  if (built.note){
    const list = customEl('customRuleMessages');
    customLine(list, null, built.note);
  }
}

function rbOpen(){
  if (!rb){
    rb = rbNewState('decide');
    rbRender();
    bldById('ruleBuilderSentence').textContent = 'Kies hierboven wat de regel doet; hier staat dan in gewone taal wat het spel ervan maakt.';
  }
}

// Het blok uit het tekstvak in de bouwer laden.
function rbLoad(){
  const parsed = parseCustomRule(customEl('customRuleText').value);
  if (parsed.errors.length){
    customShowMessages(parsed.errors.map(e => [false, e]));
    return;
  }
  const st = rbFromLogic(parsed.def.logic);
  if (!st){
    customShowMessages([[false, 'De bouwer kan dit blok niet tonen (bijvoorbeeld door "en" of "of" binnen een voorwaarde). Je kunt het blok wel gewoon controleren en toevoegen.']]);
    return;
  }
  st.title = parsed.def.title;
  rb = st;
  rbRender();
  rbRefreshOutput();
}

(function wireBuilder(){
  const loadBtn = bldById('ruleBuilderLoad');
  if (loadBtn && loadBtn.addEventListener) loadBtn.addEventListener('click', rbLoad);
  const open = bldById('customRuleBtn');
  if (open && open.addEventListener) open.addEventListener('click', rbOpen);
})();
