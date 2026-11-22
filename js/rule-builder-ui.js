// Het scherm van de regelbouwer: je kiest een moment, voorwaarden en een gevolg, en het spel maakt er een regelblok van (zie
// js/rule-builder.js) dat in het tekstvak van het venster "Eigen regel" komt en meteen wordt gecontroleerd. Alle teksten gaan als
// gewone tekst in de pagina (textContent).

let rb = null;            // de stand van de bouwer (zie rbNewState)
let rbFocus = 0;          // de teller voor de bedieningselementen, om de focus na opnieuw tekenen terug te zetten
let rbFocusWanted = -1;

// De namen in de keuzelijsten komen uit het register (label in js/blocks-cards.js, CARD_RELATIONS).
const RB_CARD_LABELS = Object.fromEntries(rbCardKinds(false).map(b => [b.key, b.label]));
const RB_RELATION_LABELS = CARD_RELATIONS;
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
  const kinds = rbCardKinds(single);
  box.appendChild(rbSelect(kinds.map(b => [b.key, b.label]), cs.kind, label + ': welke kaarten?', v => { cs.kind = v; }, true));
  const block = registryBlock('cards', cs.kind);
  if (block && block.builder) block.builder.editor(box, cs, label); // zie js/blocks-cards.js
  if (RB_SINGLE.includes(cs.kind)){
    box.appendChild(rbCheck('juist niet deze kaarten', cs.not, v => { cs.not = v; }, false));
    if (cs.also){
      const also = rbMake('div', 'bld-also');
      also.appendChild(rbMake('span', 'bld-word', 'en ook:'));
      also.appendChild(rbCardsEditor(cs.also, true, label + ' (tweede eis)'));
      also.appendChild(rbButton('× tweede eis weghalen', label + ': tweede eis weghalen', () => { cs.also = null; }));
      box.appendChild(also);
    } else {
      box.appendChild(rbButton('+ nog een eis voor dezelfde kaart', label + ': tweede eis toevoegen', () => { cs.also = rbNewCards('suit'); }));
    }
  }
  return box;
}

function rbRangeEditor(c, max, label){
  const box = rbMake('span', 'bld-range');
  box.appendChild(rbSelect(Object.entries(RB_MODE_LABELS), c.mode, label + ': hoeveel?', v => { c.mode = v; }, true));
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
  if (!choices.some(c => c.key === p.kind)) p.kind = choices[0].key;
  box.appendChild(rbSelect(choices.map(c => [c.key, c.label]), p.kind, label + ': welke spelers?', v => { p.kind = v; }, true));
  registryBlock('players', p.kind).builder.editor(box, p, label); // zie js/blocks-players.js
  return box;
}

// ---- voorwaarden en gevolg ----

// De soorten voorwaarden bij het moment (zonder en/of/niet: daarvoor zijn de groep en het vinkje "niet").
function rbCondKinds(){
  return registryBlocks('condition', rb.moment).filter(b => b.builder).map(b => ({ key: b.key, label: b.label }));
}

// Eén voorwaarde. list: de lijst waar hij in staat (de voorwaarden van de regel, of die van een groep); prefix: het nummer van de groep.
function rbCondRow(c, i, list, prefix){
  const nested = !!prefix;
  const row = rbMake('div', 'bld-row' + (c.key === 'group' ? ' bld-group' : ''));
  const label = 'Voorwaarde ' + (prefix || '') + (i + 1);
  const options = rbCondKinds().map(k => [k.key, k.label]);
  if (!nested) options.push(['group', 'een groepje voorwaarden (en / of)']);
  const head = rbMake('div', 'bld-head');
  head.appendChild(rbSelect(options, c.key, label + ': wat moet er kloppen?', v => {
    list[i] = rbNewCond(v);
    if (v === 'group') list[i].conds = [rbNewCond(rbCondKinds()[0].key), rbNewCond(rbCondKinds()[0].key)];
  }, true));
  head.appendChild(rbCheck('juist niet', c.not, v => { c.not = v; }, false));
  head.appendChild(rbButton('× weghalen', label + ' weghalen', () => { list.splice(i, 1); }));
  row.appendChild(head);
  if (c.key === 'group'){
    row.appendChild(rbSelect([['or', 'één van deze is genoeg'], ['and', 'deze moeten allemaal kloppen']], c.mode, label + ': moeten ze allemaal kloppen?', v => { c.mode = v; }, false));
    c.conds.forEach((sub, k) => row.appendChild(rbCondRow(sub, k, c.conds, (i + 1) + '.')));
    row.appendChild(rbButton('+ voorwaarde in de groep', label + ': voorwaarde toevoegen aan de groep', () => { c.conds.push(rbNewCond(rbCondKinds()[0].key)); }));
  }
  const block = registryBlock('condition', c.key);
  if (block && block.builder) block.builder.editor(row, c, label); // zie js/blocks-conditions.js
  return row;
}

function rbEffectEditor(e){
  const box = rbMake('div', 'bld-row');
  const keys = ruleChoicesFor(rb.moment).effects;
  box.appendChild(rbSelect(keys.map(k => [k.key, k.label]), e.key, 'Wat gebeurt er?', v => { rb.effect = rbNewEffect(v); if (rb.moment === 'tiebreak' && v === 'win') rb.effect.cs = Object.assign(rbNewCards('highest'), { by: 'suitOrder' }); }, true));
  const block = registryBlock('effect', e.key);
  if (block) block.builder.editor(box, e); // zie js/blocks-effects.js
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
  top.appendChild(rbSelect(RULE_MOMENTS.map(m => [m.id, m.label]), rb.moment, 'Wanneer?', v => { rb = Object.assign(rbNewState(v), { title: rb.title, meta: rb.meta }); }, true));
  form.appendChild(top);

  const conds = rbMake('div', 'bld-section');
  conds.appendChild(rbMake('h4', 'bld-sub', 'Alleen als… (mag je leeg laten)'));
  rb.conds.forEach((c, i) => conds.appendChild(rbCondRow(c, i, rb.conds, '')));
  if (rb.conds.length > 1){
    conds.appendChild(rbSelect([['and', 'alle voorwaarden moeten kloppen'], ['or', 'één voorwaarde is genoeg']], rb.condMode, 'Moeten alle voorwaarden kloppen?', v => { rb.condMode = v; }, false));
  }
  conds.appendChild(rbButton('+ voorwaarde toevoegen', 'Voorwaarde toevoegen', () => {
    rb.conds.push(rbNewCond(rbCondKinds()[0].key));
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

// De tekst die de bouwer het laatst in het tekstvak heeft gezet. Staat er iets anders (zelf geplakt of getypt, het voorbeeld, een
// export), dan schrijft de bouwer er niet zomaar overheen: eerst vraagt hij het (zie rbNotice).
let rbLastWritten = null;

function rbOwnTextInBox(){
  const value = customEl('customRuleText').value;
  return value.trim() !== '' && value !== rbLastWritten;
}

function rbNotice(show){
  const box = bldById('ruleBuilderNotice');
  if (box) box.hidden = !show;
}

// force: de speler heeft gezegd dat het tekstvak vervangen mag worden.
function rbRefreshOutput(force){
  const sentence = bldById('ruleBuilderSentence');
  const built = rbBlock(rb, customRules().map(r => r.id));
  const blocked = rbOwnTextInBox() && !force;
  rbNotice(blocked);
  if (built.errors){
    sentence.textContent = 'Nog niet klaar: ' + built.errors[0];
    if (blocked) return; // het eigen blok in het tekstvak blijft zoals het is
    customInvalidate();
    customShowMessages([[false, built.errors[0]]]);
    return;
  }
  sentence.textContent = built.sentence;
  if (blocked) return;
  const box = customEl('customRuleText');
  box.value = JSON.stringify(built.def, null, 2);
  rbLastWritten = box.value;
  customCheck();
  const list = customEl('customRuleMessages');
  if (built.note) customLine(list, null, built.note);
  if (built.regenerated) customLine(list, null, 'De regel is veranderd: de uitleg en de voorbeelden zijn opnieuw gemaakt. De id blijft ' + built.def.id + '.');
}

function rbOpen(){
  if (!rb) rbReset();
}

// Een lege bouwer. Het tekstvak blijft zoals het is.
function rbReset(){
  rb = rbNewState('decide');
  rbRender();
  rbNotice(false);
  bldById('ruleBuilderSentence').textContent = 'Hier komt in gewone taal te staan wat je regel doet.';
}

// Het blok uit het tekstvak in de bouwer laden. De id, de prioriteit, de uitleg en de voorbeelden van het blok blijven (zie rbMetaFrom).
function rbLoad(){
  const parsed = parseCustomRule(customEl('customRuleText').value);
  if (parsed.errors.length){
    customShowMessages(parsed.errors.map(e => [false, e]));
    return;
  }
  const notes = [];
  const st = rbFromLogic(parsed.def.logic, notes);
  if (!st){
    customShowMessages([[false, 'De bouwer kan deze regel niet laten zien (bijvoorbeeld door een groep binnen een groep, of meer dan twee eisen aan een kaart). Controleren en toevoegen kan wel gewoon.']]);
    return;
  }
  st.title = parsed.def.title;
  st.meta = rbMetaFrom(parsed.def, st);
  rb = st;
  rbRender();
  rbRefreshOutput(true); // het tekstvak bevat dit blok zelf: het mag in de vorm van de bouwer worden gezet
  for (const n of notes) customLine(customEl('customRuleMessages'), null, n); // wat de bouwer heeft aangepast om de regel te tonen
}

(function wireBuilder(){
  const loadBtn = bldById('ruleBuilderLoad');
  if (loadBtn && loadBtn.addEventListener) loadBtn.addEventListener('click', rbLoad);
  const replaceBtn = bldById('ruleBuilderReplace');
  if (replaceBtn && replaceBtn.addEventListener) replaceBtn.addEventListener('click', () => rbRefreshOutput(true));
  const resetBtn = bldById('ruleBuilderReset');
  if (resetBtn && resetBtn.addEventListener) resetBtn.addEventListener('click', rbReset);
  const open = bldById('customRuleBtn');
  if (open && open.addEventListener) open.addEventListener('click', rbOpen);
})();
