/*
 * EFL Fund Tracker – FPL mini-league weekly prize tracker.
 * All data is one JSON object (same shape as data.json). It is kept in the
 * browser's localStorage and, when the app is opened through server.js, also
 * written to data.json on every change. Settings → Export / Import moves it
 * around as a .json file.
 */

const STORAGE_KEY = 'efl-data';

const DEFAULT_DATA = {
  version: 1,
  settings: {
    weeklyFee: 100,
    prizes: [300, 200, 100],
    gameweeksPerQuarter: 9,
    totalGameweeks: 38
  },
  players: [
    { id: 'p1', name: 'Friend 1' },
    { id: 'p2', name: 'Friend 2' },
    { id: 'p3', name: 'Friend 3' },
    { id: 'p4', name: 'Friend 4' },
    { id: 'p5', name: 'Friend 5' },
    { id: 'p6', name: 'Friend 6' }
  ],
  gameweeks: []
};

/* ---------- Rules (no DOM) ---------- */

// scores: { playerId: points } -> { playerId: { rank, prize, tied } }
// Tied players share the prizes of the places they occupy equally, e.g. two
// players tied for 2nd get (200 + 100) / 2 = 150 each.
function computePayouts(scores, prizes) {
  const list = Object.entries(scores)
    .map(([id, pts]) => ({ id, pts: Number(pts) }))
    .sort((a, b) => b.pts - a.pts);
  const result = {};
  let pos = 0;
  while (pos < list.length) {
    let end = pos;
    while (end + 1 < list.length && list[end + 1].pts === list[pos].pts) end++;
    let pot = 0;
    for (let k = pos; k <= end; k++) pot += prizes[k] || 0;
    const share = pot / (end - pos + 1);
    for (let k = pos; k <= end; k++) {
      result[list[k].id] = { rank: pos + 1, prize: share, tied: end > pos };
    }
    pos = end + 1;
  }
  return result;
}

// 38 GWs / 9 per quarter -> 4 quarters; leftover GWs (37, 38) join the last one.
function quarterCount(s) {
  return Math.max(1, Math.floor(s.totalGameweeks / s.gameweeksPerQuarter));
}
function quarterOf(gw, s) {
  return Math.min(Math.ceil(gw / s.gameweeksPerQuarter), quarterCount(s));
}
function quarterRange(q, s) {
  const start = (q - 1) * s.gameweeksPerQuarter + 1;
  const end = q === quarterCount(s) ? s.totalGameweeks : q * s.gameweeksPerQuarter;
  return [start, end];
}

function summarize(players, gameweeks) {
  const rows = new Map(players.map(p => [p.id, {
    id: p.id, name: p.name, gws: 0, points: 0, podium: [0, 0, 0], contribution: 0, won: 0, owes: 0
  }]));
  const totals = { pool: 0, paidOut: 0, pending: 0 };
  for (const g of gameweeks) {
    const res = computePayouts(g.scores, g.prizes);
    for (const [id, pts] of Object.entries(g.scores)) {
      const row = rows.get(id);
      if (!row) continue;
      const r = res[id];
      row.gws++;
      row.points += pts;
      row.contribution += g.fee;
      row.won += r.prize;
      if (r.rank <= 3) row.podium[r.rank - 1]++;
      if (!g.paid[id]) { row.owes += g.fee; totals.pending += g.fee; }
      totals.pool += g.fee;
      totals.paidOut += r.prize;
    }
  }
  const list = [...rows.values()].sort((a, b) => b.won - a.won || b.points - a.points);
  return { list, totals };
}

function normalize(d) {
  if (!d || !Array.isArray(d.players) || !Array.isArray(d.gameweeks)) {
    throw new Error('not an EFL data file (needs "players" and "gameweeks" arrays)');
  }
  d.settings = Object.assign({}, DEFAULT_DATA.settings, d.settings);
  for (const g of d.gameweeks) {
    g.gw = Number(g.gw);
    g.scores = g.scores || {};
    g.paid = g.paid || {};
    g.fee = g.fee != null ? g.fee : d.settings.weeklyFee;
    g.prizes = g.prizes || d.settings.prizes.slice();
  }
  d.gameweeks.sort((a, b) => a.gw - b.gw);
  return d;
}

const clone = obj => JSON.parse(JSON.stringify(obj));

/* ---------- UI ---------- */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const money = n => '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN');
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const medal = rank => ['🥇', '🥈', '🥉'][rank - 1] || '';

let data;
let shownGw = 0; // gameweek currently loaded in the form

// Opened through server.js (http) -> changes are also written to data.json. Opened as a file -> browser only.
const SERVER_MODE = typeof location !== 'undefined' && location.protocol.startsWith('http');
let fileQueue = Promise.resolve();

function store() {
  data.updatedAt = new Date().toISOString();
  const json = JSON.stringify(data, null, 2);
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    if (!SERVER_MODE) alert('This browser could not save the data. Use Settings → Export JSON to keep a copy.');
  }
  if (SERVER_MODE) saveToFile(json);
}

// Saves run one after another so an older save can never land after a newer one.
function saveToFile(json) {
  fileQueue = fileQueue
    .then(() => fetch('data.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json }))
    .then(res => renderStorageStatus(res.ok), () => renderStorageStatus(false));
}

function renderStorageStatus(fileOk) {
  const el = $('#storageStatus');
  $('#saveWarning').hidden = !SERVER_MODE || fileOk;
  if (!SERVER_MODE) {
    el.textContent = 'Saved in this browser only — data.json is not changed when index.html is opened directly. ' +
      'To keep data.json up to date, run "node server.js" in the app folder and open http://localhost:3000.';
    el.className = 'rules';
  } else if (fileOk) {
    el.textContent = '✓ Every change is saved to data.json (with a backup copy in this browser).';
    el.className = 'rules pos';
  } else {
    el.textContent = '⚠ Could not write data.json — is "node server.js" running? Changes are kept in this browser for now.';
    el.className = 'rules neg';
  }
}

// Short feedback message that fades out after a few seconds.
function flash(el, text, isError) {
  el.textContent = text;
  el.className = 'msg ' + (isError ? 'err' : 'ok');
  clearTimeout(el.fadeTimer);
  el.fadeTimer = setTimeout(() => el.classList.add('fade'), isError ? 6000 : 3000);
}

const findGw = gw => data.gameweeks.find(g => g.gw === gw);
const playerName = id => (data.players.find(p => p.id === id) || { name: id }).name;
const selectedGw = () => Number($('#gwSelect').value);

function renderAll(draft) {
  renderHeader();
  refreshGwViews(draft);
  renderSettings();
}

// Everything that depends on gameweek results; leaves the Settings form alone.
function refreshGwViews(draft) {
  renderGwSelect();
  renderGwForm(draft);
  renderPeriodSelect();
  renderStandings();
  renderHistory();
  renderJson();
}

function renderHeader() {
  const s = data.settings;
  const pot = s.weeklyFee * data.players.length;
  $('#summaryLine').textContent =
    `${data.players.length} players × ${money(s.weeklyFee)} = ${money(pot)} per gameweek · ` +
    `${money(pot * s.gameweeksPerQuarter)} per quarter (${s.gameweeksPerQuarter} GWs)`;
}

/* Gameweek tab */

function nextGw() {
  const last = data.gameweeks.length ? data.gameweeks[data.gameweeks.length - 1].gw : 0;
  return Math.min(last + 1, data.settings.totalGameweeks);
}

function renderGwSelect() {
  const sel = $('#gwSelect');
  const total = data.settings.totalGameweeks;
  let current = selectedGw();
  if (!current || current > total) current = nextGw();
  sel.innerHTML = '';
  for (let gw = 1; gw <= total; gw++) sel.add(new Option(`GW ${gw}${findGw(gw) ? '  ✓' : ''}`, gw));
  sel.value = current;
}

// draft: unsaved form values to put back after a re-render (see readDraft).
function renderGwForm(draft) {
  const gw = selectedGw();
  const rec = findGw(gw);
  const prizes = rec ? rec.prizes : data.settings.prizes;
  shownGw = gw;
  $('#gwQuarter').textContent = `Quarter ${quarterOf(gw, data.settings)}`;
  $('#deleteGw').hidden = !rec;
  $('#shareGw').hidden = !rec;
  $('#sharePanel').hidden = true;
  $('#gwMsg').textContent = '';
  $('#gwBody').innerHTML = data.players.map(p => {
    const pts = rec && rec.scores[p.id] != null ? rec.scores[p.id] : '';
    const paid = rec && rec.paid[p.id] ? 'checked' : '';
    return `<tr data-id="${esc(p.id)}">
      <td>${esc(p.name)}</td>
      <td><input type="number" class="pts" step="1" inputmode="numeric" value="${pts}"></td>
      <td class="c"><input type="checkbox" class="paid" ${paid}></td>
      <td class="c rank">–</td>
      <td class="r prize"></td>
    </tr>`;
  }).join('');
  if (draft && draft.gw === gw) {
    for (const tr of $$('#gwBody tr')) {
      const d = draft.rows[tr.dataset.id];
      if (!d) continue;
      tr.querySelector('.pts').value = d.pts;
      tr.querySelector('.paid').checked = d.paid;
    }
  }
  $('#rules').textContent =
    `Prizes: 1st ${money(prizes[0])} · 2nd ${money(prizes[1])} · 3rd ${money(prizes[2])}. ` +
    `Tied players split the prizes of the places they share equally — e.g. a tie for 2nd pays ` +
    `(${prizes[1]} + ${prizes[2]}) ÷ 2 = ${money((prizes[1] + prizes[2]) / 2)} each.`;
  $('#gwHint').textContent = rec
    ? 'Fee paid ticks are saved as soon as you tick them. Changed points need "Save gameweek".'
    : 'Points and Fee paid ticks are saved together when you press "Save gameweek".';
  syncPaidAll();
  updatePreview();
}

function readForm() {
  const scores = {}, paid = {};
  let complete = true;
  for (const tr of $$('#gwBody tr')) {
    const v = tr.querySelector('.pts').value.trim();
    if (v === '' || isNaN(Number(v))) complete = false;
    else scores[tr.dataset.id] = Number(v);
    paid[tr.dataset.id] = tr.querySelector('.paid').checked;
  }
  return { scores, paid, complete };
}

// True when the form differs from what's saved for the shown gameweek.
// (Paid ticks on a saved gameweek are stored instantly, so only points count there.)
function isDirty() {
  const rec = findGw(shownGw);
  return $$('#gwBody tr').some(tr => {
    const v = tr.querySelector('.pts').value.trim();
    if (!rec) return v !== '' || tr.querySelector('.paid').checked;
    const saved = rec.scores[tr.dataset.id];
    return v === '' ? saved != null : Number(v) !== saved;
  });
}

// Unsaved form values, so a re-render (e.g. after saving settings) doesn't wipe them.
function readDraft() {
  if (!isDirty()) return null;
  const rows = {};
  for (const tr of $$('#gwBody tr')) {
    rows[tr.dataset.id] = { pts: tr.querySelector('.pts').value, paid: tr.querySelector('.paid').checked };
  }
  return { gw: shownGw, rows };
}

function confirmLeaveGw() {
  return !isDirty() || confirm(`GW ${shownGw} has unsaved changes. Discard them?`);
}

function renderGwStatus() {
  const dirty = isDirty();
  const el = $('#gwStatus');
  el.textContent = dirty ? '● Unsaved changes' : findGw(shownGw) ? '✓ Saved' : 'Not saved yet';
  el.className = dirty ? 'muted warn' : 'muted';
}

// Header "all paid" box (half-filled when only some have paid) and the "x / y paid" counter.
function syncPaidAll() {
  const boxes = $$('#gwBody .paid');
  const paid = boxes.filter(b => b.checked).length;
  $('#paidAll').checked = paid > 0 && paid === boxes.length;
  $('#paidAll').indeterminate = paid > 0 && paid < boxes.length;
  $('#paidCount').textContent = `💰 ${paid} / ${boxes.length} paid`;
  $('#paidCount').className = paid === boxes.length ? 'muted pos' : 'muted';
}

// Live ranks/prizes as points are typed (only once every player has a score).
function updatePreview() {
  const { scores, complete } = readForm();
  const rec = findGw(shownGw);
  const res = complete ? computePayouts(scores, rec ? rec.prizes : data.settings.prizes) : {};
  for (const tr of $$('#gwBody tr')) {
    const r = res[tr.dataset.id];
    tr.classList.toggle('winner', !!(r && r.prize > 0));
    tr.querySelector('.rank').textContent = r ? `${medal(r.rank)} ${r.rank}${r.tied ? '=' : ''}` : '–';
    tr.querySelector('.prize').textContent = r && r.prize > 0 ? money(r.prize) : '';
  }
  renderGwStatus();
}

function saveGw() {
  const gw = shownGw;
  const { scores, paid, complete } = readForm();
  if (!complete) return flash($('#gwMsg'), 'Enter points for every player first.', true);
  const old = findGw(gw);
  const rec = {
    gw, scores, paid,
    // A gameweek keeps the fee/prizes it was first saved with, so later settings changes don't rewrite history.
    fee: old ? old.fee : data.settings.weeklyFee,
    prizes: old ? old.prizes : data.settings.prizes.slice()
  };
  data.gameweeks = data.gameweeks.filter(g => g.gw !== gw).concat(rec).sort((a, b) => a.gw - b.gw);
  store();
  refreshGwViews();
  flash($('#gwMsg'), `GW ${gw} saved.`);
}

function deleteGw() {
  const gw = shownGw;
  if (!confirm(`Delete all data for GW ${gw}?`)) return;
  data.gameweeks = data.gameweeks.filter(g => g.gw !== gw);
  store();
  refreshGwViews();
  flash($('#gwMsg'), `GW ${gw} deleted.`);
}

/* Share a saved gameweek with the group */

// Plain-text summary for the group chat (WhatsApp shows *text* as bold).
function gwSummary(gw) {
  const g = findGw(gw);
  const s = data.settings;
  const res = computePayouts(g.scores, g.prizes);
  const ranked = Object.keys(g.scores).sort((a, b) => res[a].rank - res[b].rank || g.scores[b] - g.scores[a]);
  const lines = [`⚽ *EFL · GW ${gw} results*`, ''];
  for (const id of ranked) {
    const r = res[id];
    const prize = r.prize > 0 ? ` · *${money(r.prize)}*` : '';
    lines.push(`${medal(r.rank) || r.rank + '.'} ${playerName(id)}${r.tied ? ' (tie)' : ''} — ${g.scores[id]} pts${prize}`);
  }
  const unpaid = ranked.filter(id => !g.paid[id]).map(playerName);
  lines.push('', unpaid.length
    ? `💰 Fees: ${ranked.length - unpaid.length}/${ranked.length} paid · still to pay: ${unpaid.join(', ')}`
    : '💰 All fees paid ✅');

  const q = quarterOf(gw, s);
  const [a, b] = quarterRange(q, s);
  const qGws = data.gameweeks.filter(x => x.gw >= a && x.gw <= b);
  lines.push('', `📊 *Quarter ${q} winnings* (${qGws.length}/${b - a + 1} GWs played)`);
  summarize(data.players, qGws).list.filter(r => r.gws).forEach((r, i) => {
    lines.push(`${i + 1}. ${r.name} — ${money(r.won)}${r.owes ? ` (owes ${money(r.owes)})` : ''}`);
  });
  return lines.join('\n');
}

function fillShare() {
  $('#shareText').value = gwSummary(shownGw);
  updateWaLink();
}

function updateWaLink() {
  $('#waShare').href = 'https://wa.me/?text=' + encodeURIComponent($('#shareText').value);
}

function openShare() {
  if (isDirty()) return flash($('#gwMsg'), 'Save the gameweek first, then share it.', true);
  fillShare();
  $('#sharePanel').hidden = false;
}

// Keep an open summary in step with payment changes.
function refreshSharePanel() {
  if (!$('#sharePanel').hidden && findGw(shownGw)) fillShare();
}

async function copyShare() {
  const text = $('#shareText').value;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    $('#shareText').select();
    document.execCommand('copy');
  }
  flash($('#gwMsg'), 'Summary copied — paste it in the group chat.');
}

// Ticking "Fee paid" (one player or all) on an already-saved gameweek is stored straight away.
function onPaidChange(e) {
  if (e.target.id === 'paidAll') $$('#gwBody .paid').forEach(b => { b.checked = e.target.checked; });
  else if (!e.target.classList.contains('paid')) return;
  syncPaidAll();
  renderGwStatus();
  const rec = findGw(shownGw);
  if (!rec) return;
  rec.paid = readForm().paid;
  store();
  renderStandings();
  renderHistory();
  renderJson();
  refreshSharePanel();
  flash($('#gwMsg'), 'Payment status saved.');
}

/* Standings tab */

function renderPeriodSelect() {
  const sel = $('#periodSelect');
  const s = data.settings;
  const prev = sel.value;
  sel.innerHTML = '';
  for (let q = 1; q <= quarterCount(s); q++) {
    const [a, b] = quarterRange(q, s);
    sel.add(new Option(`Quarter ${q} (GW ${a}–${b})`, q));
  }
  sel.add(new Option('Whole season', 'season'));
  const last = data.gameweeks[data.gameweeks.length - 1];
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : (last ? quarterOf(last.gw, s) : 1);
}

// Gameweeks in the period picked on the Standings tab, and how many GWs that period spans.
function periodGameweeks() {
  const s = data.settings;
  const period = $('#periodSelect').value;
  if (period === 'season') return { gws: data.gameweeks, span: s.totalGameweeks };
  const [a, b] = quarterRange(Number(period), s);
  return { gws: data.gameweeks.filter(g => g.gw >= a && g.gw <= b), span: b - a + 1 };
}

function renderStandings() {
  const { gws, span } = periodGameweeks();
  const { list, totals } = summarize(data.players, gws);
  const target = data.settings.weeklyFee * data.players.length * span;

  $('#poolCards').innerHTML = [
    ['Gameweeks played', `${gws.length} / ${span}`],
    ['Pool so far', `${money(totals.pool)} <small>of ${money(target)}</small>`],
    ['Prizes won', money(totals.paidOut)],
    ['Fees still to collect', money(totals.pending)]
  ].map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  $('#standingsBody').innerHTML = gws.length ? list.map((r, i) => {
    const net = r.won - r.contribution;
    const owes = r.owes
      ? `${money(r.owes)} <button class="link settle" data-id="${esc(r.id)}" title="Mark all of these fees as paid">Mark paid</button>`
      : '–';
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(r.name)}</td>
      <td class="r">${r.gws}</td>
      <td class="r">${r.points}</td>
      ${r.podium.map(n => `<td class="c">${n || ''}</td>`).join('')}
      <td class="r">${money(r.contribution)}</td>
      <td class="r">${money(r.won)}</td>
      <td class="r ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${signed(net)}</td>
      <td class="r nowrap ${r.owes ? 'neg' : ''}">${owes}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="11" class="empty">No gameweeks saved for this period yet.</td></tr>';
}

// Marks every unpaid fee of one player in the shown period as paid.
function settlePlayer(id) {
  const due = periodGameweeks().gws.filter(g => id in g.scores && !g.paid[id]);
  if (!due.length) return;
  const amount = due.reduce((sum, g) => sum + g.fee, 0);
  if (!confirm(`Mark ${playerName(id)}'s ${money(amount)} as paid (GW ${due.map(g => g.gw).join(', ')})?`)) return;
  due.forEach(g => { g.paid[id] = true; });
  store();
  // Tick the box in the gameweek form too, without re-rendering it (that would drop unsaved points).
  const row = $$('#gwBody tr').find(tr => tr.dataset.id === id);
  if (row && due.some(g => g.gw === shownGw)) {
    row.querySelector('.paid').checked = true;
    syncPaidAll();
  }
  renderStandings();
  renderHistory();
  renderJson();
  refreshSharePanel();
}

/* History tab */

function renderHistory() {
  $('#historyBody').innerHTML = data.gameweeks.length ? data.gameweeks.slice().reverse().map(g => {
    const res = computePayouts(g.scores, g.prizes);
    const winners = Object.keys(res)
      .filter(id => res[id].prize > 0)
      .sort((a, b) => res[a].rank - res[b].rank)
      .map(id => `${medal(res[id].rank)} ${esc(playerName(id))} <b>${money(res[id].prize)}</b> <small>(${g.scores[id]} pts)</small>`)
      .join('<br>');
    const unpaid = Object.keys(g.scores).filter(id => !g.paid[id]).map(id => esc(playerName(id)));
    return `<tr data-gw="${g.gw}">
      <td>GW ${g.gw}</td>
      <td>Q${quarterOf(g.gw, data.settings)}</td>
      <td>${winners}</td>
      <td class="${unpaid.length ? 'neg' : 'pos'}">${unpaid.length ? unpaid.join(', ') : '✓ All paid'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">No gameweeks saved yet.</td></tr>';
}

/* Settings tab – nothing here is stored until "Save settings" */

function playerRow(p) {
  return `<div class="prow">
      <input type="text" class="pname" data-id="${esc(p.id)}" value="${esc(p.name)}" placeholder="Player name">
      <button class="icon removePlayer" title="Remove player">✕</button>
    </div>`;
}

function renderSettings() {
  const s = data.settings;
  $('#playerInputs').innerHTML = data.players.map(playerRow).join('');
  $('#setFee').value = s.weeklyFee;
  $('#setP1').value = s.prizes[0];
  $('#setP2').value = s.prizes[1];
  $('#setP3').value = s.prizes[2];
  $('#setPerQ').value = s.gameweeksPerQuarter;
  $('#setTotal').value = s.totalGameweeks;
  onSettingsEdit();
}

function renderJson() {
  $('#jsonView').value = JSON.stringify(data, null, 2);
}

// True when the Settings form differs from the saved players/settings.
function settingsDirty() {
  const s = data.settings;
  const names = $$('.pname');
  const numbers = [['#setFee', s.weeklyFee], ['#setP1', s.prizes[0]], ['#setP2', s.prizes[1]],
    ['#setP3', s.prizes[2]], ['#setPerQ', s.gameweeksPerQuarter], ['#setTotal', s.totalGameweeks]];
  return names.length !== data.players.length ||
    names.some((i, k) => i.dataset.id !== data.players[k].id || i.value.trim() !== data.players[k].name) ||
    numbers.some(([id, v]) => Number($(id).value) !== v);
}

function onSettingsEdit() {
  checkPrizeBalance();
  const dirty = settingsDirty();
  $('#settingsStatus').textContent = dirty ? '● Unsaved changes' : '';
  $('#settingsStatus').className = dirty ? 'muted warn' : 'muted';
}

function checkPrizeBalance() {
  const pot = Number($('#setFee').value) * $$('.pname').length;
  const prizes = ['#setP1', '#setP2', '#setP3'].reduce((sum, id) => sum + Number($(id).value), 0);
  const el = $('#prizeCheck');
  el.textContent = prizes === pot
    ? `✓ Prizes (${money(prizes)}) use the whole weekly pot (${money(pot)}).`
    : `⚠ Prizes add up to ${money(prizes)} but the weekly pot is ${money(pot)}.`;
  el.className = 'rules ' + (prizes === pot ? 'pos' : 'neg');
}

function saveSettings() {
  const msg = $('#settingsMsg');
  const nameInputs = $$('.pname');
  if (nameInputs.length < 2) return flash(msg, 'Add at least two players.', true);
  if (nameInputs.some(i => !i.value.trim())) return flash(msg, 'Player names cannot be empty.', true);
  const num = id => Number($(id).value);
  const s = {
    weeklyFee: num('#setFee'),
    prizes: [num('#setP1'), num('#setP2'), num('#setP3')],
    gameweeksPerQuarter: num('#setPerQ'),
    totalGameweeks: num('#setTotal')
  };
  const badCounts = ![s.gameweeksPerQuarter, s.totalGameweeks].every(Number.isInteger) ||
    s.gameweeksPerQuarter < 1 || s.totalGameweeks < s.gameweeksPerQuarter;
  if (!(s.weeklyFee >= 0) || s.prizes.some(p => !(p >= 0)) || badCounts) {
    return flash(msg, 'Please check the numbers.', true);
  }
  const draft = readDraft();
  data.players = nameInputs.map(i => ({ id: i.dataset.id, name: i.value.trim() }));
  data.settings = s;
  store();
  renderAll(draft);
  flash(msg, 'Saved. Gameweeks already entered keep the fee and prizes they were saved with.');
}

function addPlayer() {
  $('#playerInputs').insertAdjacentHTML('beforeend', playerRow({ id: 'p' + Date.now().toString(36), name: '' }));
  $('#playerInputs .prow:last-child .pname').focus();
  onSettingsEdit();
}

function removePlayer(row) {
  const input = row.querySelector('.pname');
  if (data.gameweeks.some(g => input.dataset.id in g.scores)) {
    return alert(`${input.value || 'This player'} has gameweek results and can't be removed.`);
  }
  row.remove();
  onSettingsEdit();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `efl-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJson(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = normalize(JSON.parse(await file.text()));
    if (!confirm(`Replace all current data with "${file.name}"?`)) return;
    data = d;
    store();
    renderAll();
    flash($('#dataMsg'), `Imported ${d.players.length} players and ${d.gameweeks.length} gameweeks.`);
  } catch (err) {
    flash($('#dataMsg'), 'Import failed: ' + err.message, true);
  }
}

function resetData() {
  if (!confirm('Delete ALL players, results and settings? Export a backup first if unsure.')) return;
  data = clone(DEFAULT_DATA);
  store();
  renderAll();
}

/* Start-up */

function showTab(name) {
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
}

async function init() {
  // This browser's copy and (through server.js) data.json can differ if the server was down; the newest wins.
  const copies = [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) copies.push(normalize(JSON.parse(saved)));
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  if (SERVER_MODE) {
    try {
      const res = await fetch('data.json', { cache: 'no-store' });
      if (res.ok) copies.push(normalize(await res.json()));
    } catch (e) {
      console.warn('Could not load data.json', e);
    }
  }
  copies.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  data = copies[0] || clone(DEFAULT_DATA);

  $$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#gwSelect').addEventListener('change', () => {
    if (confirmLeaveGw()) renderGwForm();
    else $('#gwSelect').value = shownGw;
  });
  $('#gwBody').addEventListener('input', updatePreview);
  $('#gwBody').addEventListener('change', onPaidChange);
  $('#paidAll').addEventListener('change', onPaidChange);
  $('#saveGw').addEventListener('click', saveGw);
  $('#deleteGw').addEventListener('click', deleteGw);
  $('#shareGw').addEventListener('click', openShare);
  $('#copyShare').addEventListener('click', copyShare);
  $('#closeShare').addEventListener('click', () => { $('#sharePanel').hidden = true; });
  $('#shareText').addEventListener('input', updateWaLink);
  $('#periodSelect').addEventListener('change', renderStandings);
  $('#standingsBody').addEventListener('click', e => {
    const btn = e.target.closest('.settle');
    if (btn) settlePlayer(btn.dataset.id);
  });
  $('#historyBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-gw]');
    if (!tr) return;
    const gw = Number(tr.dataset.gw);
    if (gw !== shownGw) {
      if (!confirmLeaveGw()) return;
      $('#gwSelect').value = gw;
      renderGwForm();
    }
    showTab('gw');
  });
  $('#addPlayer').addEventListener('click', addPlayer);
  $('#playerInputs').addEventListener('click', e => {
    const btn = e.target.closest('.removePlayer');
    if (btn) removePlayer(btn.closest('.prow'));
  });
  $('#tab-settings').addEventListener('input', e => {
    if (e.target.closest('#playerInputs, .grid')) onSettingsEdit();
  });
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#exportJson').addEventListener('click', exportJson);
  $('#importFile').addEventListener('change', importJson);
  $('#resetData').addEventListener('click', resetData);
  window.addEventListener('beforeunload', e => {
    if (isDirty() || settingsDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  renderAll();
  renderStorageStatus(true);
  // Bring data.json in line with the copy in use (this also checks the server accepts saves).
  if (SERVER_MODE) saveToFile(JSON.stringify(data, null, 2));
}

if (typeof document !== 'undefined') init();
if (typeof module !== 'undefined') module.exports = { computePayouts, quarterOf, quarterRange, summarize };
