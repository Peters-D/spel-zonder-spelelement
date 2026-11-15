// Het scherm voor eigen regels: een venster om een regelblok te plakken, te controleren, uit te proberen met proefspellen en toe te
// voegen. De logica zelf staat in js/custom-rules.js; hier zit alleen wat je ziet en doet. Alle teksten gaan als gewone tekst in de
// pagina (textContent), nooit als HTML.

let customDef = null;      // het laatst gecontroleerde blok dat klopt (vervalt bij elke wijziging in het tekstvak)
let customRun = null;      // de lopende proef: { trial, timer }
let customOpener = null;   // de knop die het venster opende, om de focus daar terug te zetten

const customEl = id => document.getElementById(id);

// ---- het rapport als gegevens (zonder pagina, dus te testen) ----

function customFormatCount(n, total){
  return n + (total ? ' (' + Math.round(n * 100 / total) + '%)' : '');
}

// Maakt van het rapport van een proef een tabel en een paar zinnen. rows: [[label, zonder de regel, met de regel]],
// notes: [{ ok, text }] (ok true = in orde, false = let op).
function customReportSummary(report){
  const n = report.played;
  const side = s => [customFormatCount(s.win, n), customFormatCount(s.cycle, n), customFormatCount(s.unknown, n)];
  const wo = side(report.without), wi = side(report.with);
  const avg = v => (v === null ? '–' : v + ' rondes');
  const rows = [
    ['Gespeelde spellen', String(n), String(n)],
    ['Eindigen met een winnaar', wo[0], wi[0]],
    ['Lopen vast in een cyclus', wo[1], wi[1]],
    ['Niet beslist na ' + SIM_ROUND_CAP + ' rondes', wo[2], wi[2]],
    ['Gemiddelde lengte (spellen met een winnaar)', avg(report.avgWinRounds.without), avg(report.avgWinRounds.with)]
  ];
  const notes = [];
  if (n < report.games) notes.push({ ok: false, text: 'Gestopt na ' + n + ' van de ' + report.games + ' spellen.' });
  const lost = report.conservationFailures.length;
  notes.push(lost ? { ok: false, text: 'Er gingen kaarten verloren of dubbel in ' + lost + ' spellen (eerste: spel ' + report.conservationFailures[0].game + ', ' + report.conservationFailures[0].side + ' de regel).' }
    : { ok: true, text: 'In alle spellen bleven het 52 verschillende kaarten.' });
  notes.push(report.errors.length ? { ok: false, text: 'De regel gaf een fout in ' + report.errors.length + ' spellen: ' + report.errors[0].message }
    : { ok: true, text: 'De regel gaf geen fouten.' });
  const ex = report.examples;
  notes.push(ex.failures.length ? { ok: false, text: 'Van de voorbeelden kloppen er ' + ex.passed + ' van de ' + ex.total + '.' }
    : { ok: true, text: 'De voorbeelden kloppen: ' + ex.passed + ' van de ' + ex.total + '.' });
  return { rows, notes, ok: report.ok && n === report.games };
}

// ---- opbouw van het scherm ----

function customLine(parent, ok, text){
  const li = document.createElement('li');
  li.className = ok === true ? 'cr-ok' : ok === false ? 'cr-bad' : 'cr-info';
  li.textContent = (ok === true ? '✓ ' : ok === false ? '✗ ' : 'ℹ ') + text; // het teken erbij, zodat het niet alleen aan de kleur ligt
  parent.appendChild(li);
}

function customShowMessages(lines){
  const list = customEl('customRuleMessages');
  list.innerHTML = '';
  for (const [ok, text] of lines) customLine(list, ok, text);
}

function customClearReport(){
  customEl('customRuleReport').innerHTML = '';
  customEl('customRuleProgress').hidden = true;
}

function customRenderReport(report){
  const box = customEl('customRuleReport');
  box.innerHTML = '';
  const sum = customReportSummary(report);
  const table = document.createElement('table');
  table.className = 'cr-table';
  const head = document.createElement('tr');
  for (const t of ['', 'Zonder de regel', 'Met de regel']){
    const th = document.createElement('th');
    th.textContent = t;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const row of sum.rows){
    const tr = document.createElement('tr');
    row.forEach((t, i) => {
      const td = document.createElement(i === 0 ? 'th' : 'td');
      td.textContent = t;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }
  box.appendChild(table);
  const list = document.createElement('ul');
  list.className = 'cr-messages';
  for (const n of sum.notes) customLine(list, n.ok, n.text);
  box.appendChild(list);
  const time = document.createElement('p');
  time.className = 'cr-time';
  time.textContent = 'Rekentijd: ' + (report.ms / 1000).toFixed(1) + ' seconde.';
  box.appendChild(time);
}

function customRenderAdded(){
  const list = customEl('customRuleAdded');
  list.innerHTML = '';
  const rules = customRules();
  if (rules.length === 0){
    const li = document.createElement('li');
    li.className = 'cr-info';
    li.textContent = 'Nog geen eigen regels toegevoegd.';
    list.appendChild(li);
    return;
  }
  for (const rule of rules){
    const li = document.createElement('li');
    li.className = 'cr-added-item';
    const name = document.createElement('span');
    name.textContent = rule.title + ' (' + rule.id + ')';
    li.appendChild(name);
    for (const [label, fn] of [['Exporteer', () => customExport(rule)], ['Haal weg', () => customRemove(rule)]]){
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = !!customRun;
      b.setAttribute('aria-label', label + ': ' + rule.title);
      b.addEventListener('click', fn);
      li.appendChild(b);
    }
    list.appendChild(li);
  }
}

// De knoppen volgen de stand: tijdens een proef kan er niets worden toegevoegd of weggehaald (de regel staat dan tijdelijk in het
// spel), en zonder een goed blok kan er niet worden geprobeerd of toegevoegd.
function customUpdateButtons(){
  const running = !!customRun;
  customEl('customRuleTrialBtn').disabled = !customDef && !running;
  customEl('customRuleTrialBtn').textContent = running ? 'Stop' : 'Speel proefspellen';
  customEl('customRuleAdd').disabled = !customDef || running;
  customEl('customRuleCheck').disabled = running;
  customEl('customRuleSample').disabled = running;
}

// ---- acties ----

function customInvalidate(){
  customCancelRun();
  customDef = null;
  customClearReport();
  customUpdateButtons();
}

function customCheck(){
  customCancelRun();
  customClearReport();
  customDef = null;
  const parsed = parseCustomRule(customEl('customRuleText').value);
  if (parsed.errors.length){
    customShowMessages(parsed.errors.map(e => [false, e]));
    customUpdateButtons();
    return;
  }
  const ex = checkCustomRuleExamples(parsed.def);
  const lines = [];
  if (ex.failures.length){
    ex.failures.forEach(f => lines.push([false, f]));
    lines.push([false, 'Van de voorbeelden kloppen er ' + ex.passed + ' van de ' + ex.total + '. Pas het blok of de voorbeelden aan.']);
  } else {
    lines.push([true, 'Het blok klopt.']);
    lines.push([true, 'De voorbeelden kloppen: ' + ex.passed + ' van de ' + ex.total + '.']);
    if (customRules().some(r => r.id === parsed.def.id)) lines.push([null, 'Er is al een eigen regel met deze id: toevoegen vervangt die.']);
    customDef = parsed.def;
  }
  customShowMessages(lines);
  customUpdateButtons();
}

function customSample(){
  customInvalidate();
  customEl('customRuleText').value = JSON.stringify(CUSTOM_RULE_SAMPLE, null, 2);
  customShowMessages([[null, 'Dit is een voorbeeld. Druk op "Controleer".']]);
}

function customTrialOptions(){
  const base = {};
  if (customEl('customTrialBase').checked){
    for (const rule of RULES){
      const input = customEl(rule.id + 'Input');
      if (input && input.checked && rule.id !== customDef.id) base[rule.id] = true;
    }
  }
  return { games: parseInt(customEl('customTrialGames').value, 10), base };
}

function customCancelRun(){
  if (!customRun) return;
  clearTimeout(customRun.timer);
  customRun.trial.dispose();
  customRun = null;
  customEl('customRuleProgress').hidden = true;
  customUpdateButtons();
  customRenderAdded();
}

// Speelt de proefspellen in stukjes van ongeveer 40 ms, zodat het scherm blijft reageren.
function customTrialToggle(){
  if (customRun){ // Stop: het rapport tot nu toe blijft staan
    const partial = customRun.trial.report();
    customCancelRun();
    if (partial.played > 0) customRenderReport(partial);
    return;
  }
  if (!customDef) return;
  const trial = createCustomTrial(customDef, customTrialOptions());
  const progress = customEl('customRuleProgress');
  customClearReport();
  progress.hidden = false;
  progress.value = 0;
  customRun = { trial, timer: 0 };
  customUpdateButtons();
  customRenderAdded();
  const tick = () => {
    if (!customRun || customRun.trial !== trial) return;
    const done = trial.step(40);
    progress.value = trial.progress();
    if (done){
      const report = trial.report();
      customRun = null;
      trial.dispose();
      progress.hidden = true;
      customRenderReport(report);
      customUpdateButtons();
      customRenderAdded();
    } else {
      customRun.timer = setTimeout(tick, 0);
    }
  };
  customRun.timer = setTimeout(tick, 0);
}

function customStatus(text){
  customEl('customRuleStatus').textContent = text;
}

function customAdd(){
  if (!customDef || customRun) return;
  const def = customDef;
  addCustomRule(def);
  refreshRuleOptions(def.id); // het vinkje komt erbij en staat aan: de speler heeft de regel net zelf toegevoegd
  customStatus('Eigen regel toegevoegd en aangevinkt: ' + def.title + '.');
  closeCustomRuleDialog();
  const input = customEl(def.id + 'Input');
  if (input && input.focus) input.focus();
}

function customRemove(rule){
  if (customRun) return;
  removeCustomRule(rule.id);
  refreshRuleOptions();
  customRenderAdded();
  customStatus('Eigen regel verwijderd: ' + rule.title + '.');
}

function customExport(rule){
  customInvalidate();
  customEl('customRuleText').value = exportCustomRule(rule);
  customCheck();
}

// ---- het venster ----

function openCustomRuleDialog(opener){
  customOpener = opener || null;
  customRenderAdded();
  customUpdateButtons();
  const box = customEl('customRule');
  box.classList.add('show');
  box.setAttribute('aria-hidden', 'false');
  customEl('customRuleInner').scrollTop = 0;
  customEl('customRuleText').focus();
}

function closeCustomRuleDialog(){
  customCancelRun();
  const box = customEl('customRule');
  box.classList.remove('show');
  box.setAttribute('aria-hidden', 'true');
  if (customOpener && customOpener.focus) customOpener.focus();
  customOpener = null;
}

// De focus blijft in het venster: Tab na de laatste knop gaat naar de eerste, Shift+Tab voor de eerste naar de laatste.
function customTrapFocus(e){
  const focusable = [...customEl('customRuleInner').querySelectorAll('button, textarea, select, input')].filter(x => !x.disabled && !x.hidden);
  if (focusable.length === 0) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first){ last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last){ first.focus(); e.preventDefault(); }
}

(function wire(){
  const on = (id, type, fn) => { const el = customEl(id); if (el && el.addEventListener) el.addEventListener(type, fn); };
  on('customRuleBtn', 'click', () => openCustomRuleDialog(customEl('customRuleBtn')));
  on('customRuleClose', 'click', closeCustomRuleDialog);
  on('customRule', 'click', e => { if (e.target && e.target.id === 'customRule') closeCustomRuleDialog(); }); // buiten het venster klikken
  on('customRuleSample', 'click', customSample);
  on('customRuleCheck', 'click', customCheck);
  on('customRuleTrialBtn', 'click', customTrialToggle);
  on('customRuleAdd', 'click', customAdd);
  on('customRuleText', 'input', customInvalidate);
  if (document.addEventListener) document.addEventListener('keydown', e => {
    const box = customEl('customRule');
    if (!box || !box.classList.contains('show')) return;
    if (e.key === 'Escape') closeCustomRuleDialog();
    else if (e.key === 'Tab') customTrapFocus(e);
  });
})();
