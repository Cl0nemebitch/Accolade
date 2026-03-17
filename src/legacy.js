let volPin = '';
let volPinStr = '';
let volAuthenticated = false;
let adminAuthenticated = false;
let adminPassword = '';
let foundIdAw = null;
let foundIdCt = null;
let selectedItem = null;
let menuItems = [];
let allParticipants = [];
let lbInterval = null;
let searchTimers = {};
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(method, path, body, headers = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch((API_BASE ? API_BASE + '/api' : '/api') + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function volHeaders() { return { 'x-volunteer-pin': volPinStr }; }
function adminHeaders() { return { 'x-admin-password': adminPassword }; }

function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.background = isErr ? 'var(--red)' : 'var(--text)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function setMsg(id, text, ok = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = text ? `<div class="msg ${ok ? 'msg-ok' : 'msg-err'}">${escapeHtml(text)}</div>` : '';
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  const btns = document.querySelectorAll('.nav-link');
  const map = { landing: 0, balance: 1, leaderboard: 2, volunteer: 3, admin: 4 };
  if (btns[map[name]]) btns[map[name]].classList.add('active');
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'volunteer' && volAuthenticated) { loadMenu(); loadTodayRedemptions(); }
  if (name === 'admin' && adminAuthenticated) loadAnalytics();
}

async function refreshCount() {
  try {
    const data = await api('GET', '/participants');
    allParticipants = data;
    const el = document.getElementById('nav-count');
    if (el) el.textContent = data.length + ' participants';
  } catch (e) {}
}

async function searchBalance() {
  const q = document.getElementById('bal-input').value.trim();
  const out = document.getElementById('bal-result');
  if (!q) { out.innerHTML = ''; return; }
  out.innerHTML = '<div class="spinner"></div>';
  try {
    const results = await api('GET', '/participants/search?q=' + encodeURIComponent(q));
    if (!results.length) {
      out.innerHTML = '<div class="msg msg-err">No participant found. Check your ID or name.</div>';
      return;
    }
    const p = results[0];
    const todayBadge = p.redeemed_today
      ? '<span class="badge badge-red">Canteen used today</span>'
      : '<span class="badge badge-green">Canteen available today</span>';
    out.innerHTML = `
      <div class="search-result">
        <p class="muted" style="margin-bottom:3px">Participant</p>
        <p style="font-size:16px;font-weight:600;margin-bottom:14px">${escapeHtml(p.name)} <span style="font-weight:400;color:var(--text2);font-size:13px">#${escapeHtml(p.participant_id)}</span></p>
        <p class="muted" style="margin-bottom:6px">A Coins balance</p>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class="badge badge-amber" style="font-size:18px;padding:7px 16px">${escapeHtml(p.coins_balance)} A Coins</span>
          ${todayBadge}
        </div>
      </div>`;
  } catch (e) {
    out.innerHTML = `<div class="msg msg-err">${escapeHtml(e.message)}</div>`;
  }
}

const rankBg = ['#fef3c7', '#f0ede8', '#faece7'];
const rankColor = ['#92400e', '#5f5e5a', '#7c2d12'];
const rankLabel = ['1st', '2nd', '3rd'];

async function loadLeaderboard() {
  const el = document.getElementById('lb-container');
  try {
    const data = await api('GET', '/participants');
    allParticipants = data;
    const count = document.getElementById('nav-count');
    if (count) count.textContent = data.length + ' participants';
    if (!data.length) { el.innerHTML = '<p class="muted">No participants yet.</p>'; return; }
    el.innerHTML = data.slice(0, 20).map((p, i) => `
      <div class="lb-row">
        <div class="rank" style="background:${i < 3 ? rankBg[i] : 'var(--bg2)'};color:${i < 3 ? rankColor[i] : 'var(--text2)'}">
          ${i < 3 ? rankLabel[i] : (i + 1)}
        </div>
        <div style="flex:1">
          <p style="font-size:14px;font-weight:${i < 3 ? 600 : 400}">${escapeHtml(p.name)}</p>
          <p style="font-size:12px;color:var(--text2)">#${escapeHtml(p.participant_id)}</p>
        </div>
        <span class="badge badge-amber">${escapeHtml(p.coins_balance)} coins</span>
      </div>`).join('');
    document.getElementById('lb-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    if (lbInterval) clearInterval(lbInterval);
    lbInterval = setInterval(loadLeaderboard, 30000);
  } catch (e) {
    el.innerHTML = `<div class="msg msg-err">${e.message}</div>`;
  }
}

function toggleFullscreen() {
  const pg = document.getElementById('page-leaderboard');
  if (pg) pg.classList.toggle('fullscreen');
}

function vPin(d) {
  if (volPin.length >= 4) return;
  volPin += d; updatePinDots();
  if (volPin.length === 4) setTimeout(checkVolPin, 180);
}
function vPinBack() { volPin = volPin.slice(0, -1); updatePinDots(); }
function vPinClear() { volPin = ''; updatePinDots(); }
function updatePinDots() {
  for (let i = 0; i < 4; i++)
    document.getElementById('pd' + i).classList.toggle('filled', i < volPin.length);
}
async function checkVolPin() {
  try {
    await api('GET', '/redeem/today', null, { 'x-volunteer-pin': volPin });
    volPinStr = volPin; volAuthenticated = true;
    document.getElementById('vol-pin').style.display = 'none';
    document.getElementById('vol-panel').style.display = 'block';
    loadMenu(); loadTodayRedemptions();
  } catch (e) {
    document.getElementById('vol-pin-err').textContent = 'Incorrect PIN. Try again.';
    volPin = ''; updatePinDots();
  }
}
function volLogout() {
  volPin = ''; volPinStr = ''; volAuthenticated = false;
  updatePinDots();
  document.getElementById('vol-pin').style.display = 'block';
  document.getElementById('vol-panel').style.display = 'none';
  document.getElementById('vol-pin-err').textContent = '';
}

function switchVTab(tab) {
  ['reg', 'award', 'canteen', 'menu'].forEach(t => {
    document.getElementById('vsec-' + t).classList.toggle('on', t === tab);
    const b = document.getElementById('vt-' + t);
    if (b) b.classList.toggle('on', t === tab);
  });
  if (tab === 'canteen') { loadMenu(); loadTodayRedemptions(); }
  if (tab === 'menu') loadMenuEditor();
}

async function registerParticipant() {
  const participant_id = document.getElementById('reg-id').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const coins_balance = parseInt(document.getElementById('reg-coins').value) || 0;
  if (!participant_id || !name) { setMsg('reg-msg', 'ID and name are required.', false); return; }
  try {
    await api('POST', '/participants', { participant_id, name, coins_balance }, volHeaders());
    setMsg('reg-msg', `${name} registered with ${coins_balance} A Coins.`);
    document.getElementById('reg-id').value = '';
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-coins').value = '';
    refreshCount();
  } catch (e) { setMsg('reg-msg', e.message, false); }
}

function debounceSearch(ctx) {
  clearTimeout(searchTimers[ctx]);
  searchTimers[ctx] = setTimeout(() => searchParticipant(ctx), 300);
}

async function searchParticipant(ctx) {
  const q = document.getElementById(ctx + '-search').value.trim();
  const el = document.getElementById(ctx + '-found');
  if (ctx === 'aw') foundIdAw = null; else foundIdCt = null;
  if (!q) { el.innerHTML = ''; return; }
  try {
    const results = await api('GET', '/participants/search?q=' + encodeURIComponent(q));
    if (!results.length) { el.innerHTML = '<span style="color:var(--red)">Not found</span>'; return; }
    const p = results[0];
    if (ctx === 'aw') foundIdAw = p.participant_id; else foundIdCt = p.participant_id;
    el.innerHTML = `Found: <strong>${escapeHtml(p.name)}</strong> &mdash; <span class="badge badge-amber">${escapeHtml(p.coins_balance)} coins</span>`;
  } catch (e) { el.innerHTML = `<span style="color:var(--red)">${escapeHtml(e.message)}</span>`; }
}

async function awardCoins() {
  if (!foundIdAw) { setMsg('aw-msg', 'Find a participant first.', false); return; }
  const coins_awarded = parseInt(document.getElementById('aw-coins').value);
  const reason = document.getElementById('aw-reason').value.trim();
  if (!coins_awarded || coins_awarded <= 0) { setMsg('aw-msg', 'Enter a valid coin amount.', false); return; }
  try {
    const p = await api('POST', '/coins/award', { participant_id: foundIdAw, coins_awarded, reason }, volHeaders());
    setMsg('aw-msg', `Awarded ${coins_awarded} coins to ${p.name}. New balance: ${p.coins_balance}.`);
    document.getElementById('aw-search').value = '';
    document.getElementById('aw-coins').value = '';
    document.getElementById('aw-reason').value = '';
    document.getElementById('aw-found').innerHTML = '';
    foundIdAw = null;
    refreshCount();
  } catch (e) { setMsg('aw-msg', e.message, false); }
}

async function loadMenu() {
  try {
    menuItems = await api('GET', '/menu');
    renderCtMenu();
  } catch (e) {}
}

function renderCtMenu() {
  const el = document.getElementById('ct-menu-list');
  if (!el) return;
  el.innerHTML = menuItems.map(item => `
    <div class="menu-item ${selectedItem === item.item_id ? 'selected' : ''}" onclick="selectItem('${item.item_id}')">
      <span style="font-size:14px;font-weight:500;flex:1">${escapeHtml(item.name)}</span>
      <span class="badge badge-amber">${escapeHtml(item.coins_cost)} coins</span>
    </div>`).join('');
}

function selectItem(id) { selectedItem = selectedItem === id ? null : id; renderCtMenu(); }

async function processRedeem() {
  if (!foundIdCt) { setMsg('ct-msg', 'Find a participant first.', false); return; }
  if (!selectedItem) { setMsg('ct-msg', 'Select an item.', false); return; }
  try {
    const { participant, item, coins_spent } = await api('POST', '/redeem',
      { participant_id: foundIdCt, item_id: selectedItem }, volHeaders());
    setMsg('ct-msg', `Done. ${participant.name} redeemed ${item.name} for ${coins_spent} coins. Balance: ${participant.coins_balance}.`);
    document.getElementById('ct-search').value = '';
    document.getElementById('ct-found').innerHTML = '';
    foundIdCt = null; selectedItem = null;
    renderCtMenu(); loadTodayRedemptions();
  } catch (e) { setMsg('ct-msg', e.message, false); }
}

async function loadTodayRedemptions() {
  const el = document.getElementById('ct-history');
  if (!el) return;
  try {
    const data = await api('GET', '/redeem/today', null, volHeaders());
    if (!data.length) { el.innerHTML = '<p class="muted">No redemptions yet today.</p>'; return; }
    el.innerHTML = data.map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border)">
        <div><strong>${escapeHtml(r.name)}</strong> <span class="muted">- ${escapeHtml(r.item_name)}</span></div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge badge-red">-${escapeHtml(r.coins_spent)}</span>
          <span class="muted">${new Date(r.redeemed_at).toLocaleTimeString()}</span>
        </div>
      </div>`).join('');
  } catch (e) { el.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
}

async function loadMenuEditor() {
  try {
    menuItems = await api('GET', '/menu');
    renderMenuEditor();
  } catch (e) {}
}

function renderMenuEditor() {
  const el = document.getElementById('menu-editor');
  if (!el) return;
  el.innerHTML = menuItems.map((item, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input type="text" id="me-name-${i}" value="${escapeHtml(item.name)}" placeholder="Item name" style="flex:2"/>
      <input type="number" id="me-cost-${i}" value="${escapeHtml(item.coins_cost)}" placeholder="Coins" min="1" style="flex:1;min-width:70px"/>
      <button class="btn btn-secondary btn-sm" onclick="saveMenuItem(${i},'${item.item_id}')">Save</button>
    </div>`).join('');
}

async function saveMenuItem(i, item_id) {
  const name = document.getElementById('me-name-' + i).value.trim();
  const coins_cost = parseInt(document.getElementById('me-cost-' + i).value);
  if (!name || !coins_cost) { toast('Name and cost required', true); return; }
  try {
    await api('PUT', '/menu/' + item_id, { name, coins_cost }, volHeaders());
    toast('Saved.');
    menuItems[i].name = name; menuItems[i].coins_cost = coins_cost;
  } catch (e) { toast(e.message, true); }
}

async function addMenuItem() {
  const id = 'item_' + Date.now();
  try {
    await api('POST', '/menu', { item_id: id, name: 'New item', coins_cost: 30 }, volHeaders());
    toast('Item added'); loadMenuEditor();
  } catch (e) { toast(e.message, true); }
}

async function adminLogin() {
  const pass = document.getElementById('admin-pass').value;
  if (!pass) { setMsg('admin-login-msg', 'Enter password.', false); return; }
  try {
    await api('GET', '/analytics', null, { 'x-admin-password': pass });
    adminPassword = pass; adminAuthenticated = true;
    document.getElementById('admin-login').style.display = 'none';
    document.getElementById('admin-dash').style.display = 'block';
    loadAnalytics();
  } catch (e) { setMsg('admin-login-msg', 'Incorrect password.', false); }
}
function adminLogout() {
  adminPassword = ''; adminAuthenticated = false;
  document.getElementById('admin-login').style.display = 'block';
  document.getElementById('admin-dash').style.display = 'none';
  document.getElementById('admin-pass').value = '';
}

async function loadAnalytics() {
  try {
    const d = await api('GET', '/analytics', null, adminHeaders());
    document.getElementById('admin-stats').innerHTML = [
      ['Total Participants', d.summary.total_participants],
      ['Coins Awarded', d.summary.total_coins_awarded],
      ['Coins Redeemed', d.summary.total_coins_redeemed],
      ['Canteen Redemptions', d.summary.total_redemptions],
    ].map(([label, val]) => `
      <div class="stat"><div class="stat-val">${escapeHtml(val)}</div><div class="stat-label">${escapeHtml(label)}</div></div>`).join('');

    renderBarChart('chart-reasons', d.awardsByReason, 'reason', 'total');
    renderBarChart('chart-items', d.redemptionsByItem, 'name', 'redemptions');

    document.getElementById('admin-top').innerHTML = d.topEarners.map((p, i) => `
      <div class="lb-row">
        <div class="rank" style="background:${i < 3 ? rankBg[i] : 'var(--bg2)'};color:${i < 3 ? rankColor[i] : 'var(--text2)'}">
          ${i < 3 ? rankLabel[i] : (i + 1)}
        </div>
        <div style="flex:1"><p style="font-size:14px;font-weight:${i < 3 ? 600 : 400}">${escapeHtml(p.name)}</p>
          <p class="muted">#${escapeHtml(p.participant_id)}</p></div>
        <span class="badge badge-amber">${escapeHtml(p.coins_balance)}</span>
      </div>`).join('');

    renderAdminTable(allParticipants.length ? allParticipants : await api('GET', '/participants'));
  } catch (e) { toast(e.message, true); }
}

function renderBarChart(id, data, labelKey, valKey) {
  const el = document.getElementById(id);
  if (!data.length) { el.innerHTML = '<p class="muted">No data yet.</p>'; return; }
  const max = Math.max(...data.map(d => d[valKey]));
  el.innerHTML = '<div class="bar-chart">' + data.map(d => `
    <div class="bar-row">
      <span class="bar-label" title="${escapeHtml(d[labelKey])}">${escapeHtml(d[labelKey])}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(d[valKey] / max * 100)}%"></div></div>
      <span class="bar-val">${escapeHtml(d[valKey])}</span>
    </div>`).join('') + '</div>';
}

function renderAdminTable(data) {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;
  allParticipants = data;
  tbody.innerHTML = data.map(p => `
    <tr>
      <td><code>${escapeHtml(p.participant_id)}</code></td>
      <td>${escapeHtml(p.name)}</td>
      <td><span class="badge badge-amber">${escapeHtml(p.coins_balance)}</span></td>
      <td class="muted">${new Date(p.created_at).toLocaleDateString()}</td>
    </tr>`).join('');
}

function filterAdminTable() {
  const q = document.getElementById('admin-search').value.toLowerCase();
  const filtered = allParticipants.filter(p =>
    p.name.toLowerCase().includes(q) || p.participant_id.toLowerCase().includes(q));
  renderAdminTable(filtered);
}

async function exportCSV() {
  const url = '/api/export/participants';
  const res = await fetch(url, { headers: adminHeaders() });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'accolade-participants.csv';
  a.click();
}

export function initLegacy() {
  Object.assign(window, {
    showPage,
    searchBalance,
    loadLeaderboard,
    toggleFullscreen,
    vPin,
    vPinBack,
    vPinClear,
    switchVTab,
    volLogout,
    registerParticipant,
    debounceSearch,
    awardCoins,
    processRedeem,
    selectItem,
    saveMenuItem,
    addMenuItem,
    adminLogin,
    adminLogout,
    filterAdminTable,
    exportCSV,
    loadAnalytics
  });

  refreshCount();
  setInterval(refreshCount, 60000);
}
