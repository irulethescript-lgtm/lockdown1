// ═══════════════════════════════════════════════
//  LOCKDOWN — Client JS
// ═══════════════════════════════════════════════

let socket;

function initSocket(user) {
  socket = io();
  socket.on('connect', () => socket.emit('auth'));
  socket.on('shout_error', message => flash(message, 'error'));
  socket.on('online_count', (count) => {
    const el = document.getElementById('onlineCount');
    const fe = document.getElementById('footerOnline');
    if (el) el.textContent = count;
    if (fe) fe.textContent = count;
  });

  // Shoutbox live messages
  socket.on('shout', (data) => {
    const box = document.getElementById('shoutMessages');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'shout-entry';
    div.innerHTML = `<span class="shout-time">${data.time}</span> <span class="shout-name">${esc(data.username)}</span> <span class="shout-level">[${data.level}]</span>: <span class="shout-msg">${esc(data.message)}</span>`;
    box.insertBefore(div, box.firstChild);
    // Keep max 50
    while (box.children.length > 50) box.removeChild(box.lastChild);
  });
}

// ── STAT UPDATER ──────────────────────────────
function updateStats(u) {
  setText('um_level', u.level);
  setText('um_cash', formatCash(u.cash));
  setText('um_rep', u.rep);
  setText('um_favors', u.favors ?? 0);
  setText('um_stamina', (u.stamina ?? 100) + '%');
  const staminaBar = document.getElementById('um_stamina_bar');
  if (staminaBar) staminaBar.style.width = Math.max(0, Math.min(100, u.stamina ?? 100)) + '%';
  setText('um_strength', Number(u.strength).toLocaleString());
  setText('um_defense', Number(u.defense).toLocaleString());
  setText('um_speed', Number(u.speed).toLocaleString());
  setText('um_dexterity', Number(u.dexterity).toLocaleString());
  setBar('um_happiness_bar', 'um_happiness', u.happiness, u.max_happiness);

  setBar('um_hp_bar', 'um_hp', u.hp, u.max_hp);
  setBar('um_energy_bar', 'um_energy', u.energy, u.max_energy);
  setBar('um_nerve_bar', 'um_nerve', u.nerve, u.max_nerve);

  const xpPct = Math.floor((u.xp / u.xp_needed) * 100);
  const xpBar = document.getElementById('um_exp_bar');
  const xpText = document.getElementById('um_exp');
  if (xpBar) xpBar.style.width = xpPct + '%';
  if (xpText) xpText.textContent = xpPct + '%';
  const travelNotice=document.getElementById('travelNotice');
  if(travelNotice && u.travel) {
    const away=u.travel.phase!=='home';travelNotice.hidden=!away;
    const text=document.getElementById('travelNoticeText');
    if(text)text.textContent=u.travel.phase==='outbound'?'You are travelling to another city.':u.travel.phase==='returning'?'You are travelling home with your cargo.':'You are visiting another city. Return home to use home facilities.';
  }
  if(u.cooldowns) for(const key of ['medical','drug']){const n=document.getElementById('header-'+key);if(n)n.dataset.timer=u.cooldowns.find(c=>c.category===key)?.ready_at||0;}
  document.dispatchEvent(new CustomEvent('player:updated', { detail: u }));
}

function setBar(barId, textId, val, max) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  const bar = document.getElementById(barId);
  const txt = document.getElementById(textId);
  if (bar) bar.style.width = pct + '%';
  if (txt) txt.textContent = val + '/' + max;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── AJAX ACTION HANDLER ───────────────────────
function doAction(url, data, onResult) {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
    .then(r => r.json())
    .then(d => {
      if (d.error) { flash(d.error, 'error'); return; }
      if (d.user) updateStats(d.user);
      if (d.levelUp && d.levelUp.length) d.levelUp.forEach(m => flash(m, 'success'));
      if (onResult) onResult(d);
      else if (d.msg) flash(d.msg, d.won === false ? 'error' : 'success');
      if (d.redirect) setTimeout(() => location.href = d.redirect, 800);
    })
    .catch(() => flash('Network error.', 'error'));
}

// ── FLASH MESSAGE ─────────────────────────────
let flashTimer;
function flash(msg, type = 'default') {
  const el = document.getElementById('flashMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'flash-msg' + (type === 'success' ? ' success' : type === 'info' ? ' info' : '');
  el.style.display = 'block';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.style.display = 'none', 3500);
}

// ── HELPERS ───────────────────────────────────
function formatCash(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' Bil';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' Mil';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString();
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── AUTO-POLL STATS every 60s ─────────────────
setInterval(() => {
  fetch('/api/stats')
    .then(r => r.json())
    .then(u => updateStats(u))
    .catch(() => {});
}, 60000);
