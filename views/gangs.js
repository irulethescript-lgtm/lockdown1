const express = require('express');
const { run, get, all, getUser, addEvent } = require('../middleware/db');
const { requireAuth } = require('../middleware/auth');
const { PRISONS, JOBS, getTitle } = require('../middleware/gamedata');
const router = express.Router();

// ── Tunables ─────────────────────────────────────────────
const CREATE_COST = 500;
const MAX_MEMBERS = 20;
const INVITE_TTL  = 7 * 24 * 3600;   // invites expire after 7 days
const MAX_AMOUNT  = 1e12;

// Ranks: Leader > Officer > Member
//   Leader  : everything (withdraw, promote/demote, kick anyone, transfer, disband)
//   Officer : invite, kick regular Members
//   Member  : deposit, leave
const canInvite = rank => rank === 'Leader' || rank === 'Officer';

const now = () => Math.floor(Date.now() / 1000);

// Money rules: every balance change below is ONE guarded UPDATE
// (e.g. "cash = cash - ? WHERE cash >= ?") and we check `changes`, so two
// requests at once can never spend or withdraw the same dollars twice.
function parseAmount(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= MAX_AMOUNT ? n : null;
}

// Same as renderPage() in routes/game.js (kept local so this file stands alone)
async function renderPage(res, view, user, extra = {}) {
  const gang = user.gang_id ? await get('SELECT * FROM gangs WHERE id=?', [user.gang_id]) : null;
  const unreadMail = (await get('SELECT COUNT(*) as c FROM mail WHERE to_id=? AND read=0', [user.id]))?.c || 0;
  const unreadEvents = (await get('SELECT COUNT(*) as c FROM events WHERE user_id=? AND read=0', [user.id]))?.c || 0;
  const title = getTitle(user.rep);
  const xpPct = Math.floor((user.xp / user.xp_needed) * 100);
  const hpPct = Math.floor((user.hp / user.max_hp) * 100);
  const energyPct = Math.floor((user.energy / user.max_energy) * 100);
  const nervePct = Math.floor((user.nerve / user.max_nerve) * 100);
  res.render(view, { user, gang, title, unreadMail, unreadEvents, xpPct, hpPct, energyPct, nervePct, PRISONS, JOBS, ...extra });
}

// Handler wrappers: load the user, and turn crashes into a clean response
const page = fn => [requireAuth, async (req, res, next) => {
  try {
    const user = await getUser(req.session.userId);
    if (!user) return res.redirect('/login');
    await fn(user, req, res);
  } catch (e) { console.error('[gangs]', req.path, e); next(e); }
}];
const act = fn => [requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.session.userId);
    if (!user) return res.json({ error: 'Session expired. Please log in again.' });
    await fn(user, req, res);
  } catch (e) {
    console.error('[gangs]', req.path, e);
    if (!res.headersSent) res.json({ error: 'Something went wrong. Try again.' });
  }
}];

// The gang a player belongs to (gang_members is the source of truth), plus their rank
const membership = userId => get(
  `SELECT g.*, gm.rank AS my_rank FROM gang_members gm JOIN gangs g ON g.id = gm.gang_id WHERE gm.user_id = ?`,
  [userId]);

const gangLog = (gangId, user, action, amount, note) => run(
  'INSERT INTO gang_logs (gang_id,user_id,username,action,amount,note,created_at) VALUES (?,?,?,?,?,?,?)',
  [gangId, user.id, user.username, action, amount || 0, note || '', now()]
).catch(e => console.error('[gangs] log failed', e.message));

const cashLog = (type, row) => run(
  `INSERT INTO transaction_logs (type,from_id,to_id,from_name,to_name,cash_amount,note) VALUES (?,?,?,?,?,?,?)`,
  [type, row.from_id || null, row.to_id || null, row.from_name || null, row.to_name || null, row.amount || 0, row.note || '']
).catch(() => {});

// ── LIST ─────────────────────────────────────────────────
router.get('/gangs', ...page(async (user, req, res) => {
  const gangs = await all(`SELECT g.*, COUNT(gm.user_id) AS member_count, u.username AS leader_name
    FROM gangs g JOIN users u ON u.id = g.leader_id
    LEFT JOIN gang_members gm ON gm.gang_id = g.id
    GROUP BY g.id ORDER BY g.bank DESC`);
  await renderPage(res, 'gangs', user, { gangs });
}));

// ── MY GANG ──────────────────────────────────────────────
router.get('/my-gang', ...page(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) {
    if (user.gang_id) await run('UPDATE users SET gang_id=NULL WHERE id=?', [user.id]);
    user.gang_id = null;
    return renderPage(res, 'gang_create', user);
  }
  if (user.gang_id !== gang.id) {
    await run('UPDATE users SET gang_id=? WHERE id=?', [gang.id, user.id]);
    user.gang_id = gang.id;
  }
  const members = await all(`SELECT u.id AS user_id, u.username, u.level, u.rep, u.wins, gm.rank
    FROM gang_members gm JOIN users u ON u.id = gm.user_id WHERE gm.gang_id = ?
    ORDER BY CASE gm.rank WHEN 'Leader' THEN 0 WHEN 'Officer' THEN 1 ELSE 2 END, u.rep DESC`, [gang.id]);
  const logs = await all('SELECT * FROM gang_logs WHERE gang_id = ? ORDER BY id DESC LIMIT 15', [gang.id]);
  await renderPage(res, 'my_gang', user, { gang, members, logs, myRank: gang.my_rank, maxMembers: MAX_MEMBERS });
}));

// ── CREATE ───────────────────────────────────────────────
router.post('/gang/create', ...act(async (user, req, res) => {
  if (await membership(user.id)) return res.json({ error: 'Already in a gang.' });
  const name = String(req.body.name || '').trim();
  const tag = String(req.body.tag || '').trim().toUpperCase();
  const description = String(req.body.description || '').trim().slice(0, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$/.test(name))
    return res.json({ error: 'Gang name must be 3-24 characters (letters, numbers, spaces, - and _).' });
  if (!/^[A-Z0-9]{2,4}$/.test(tag)) return res.json({ error: 'Tag must be 2-4 letters or numbers.' });
  if (await get('SELECT id FROM gangs WHERE name = ? COLLATE NOCASE OR tag = ? COLLATE NOCASE', [name, tag]))
    return res.json({ error: 'Name or tag already taken.' });

  const paid = await run('UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ?', [CREATE_COST, user.id, CREATE_COST]);
  if (!paid.changes) return res.json({ error: `You need $${CREATE_COST} to start a gang.` });
  const refund = () => run('UPDATE users SET cash = cash + ? WHERE id = ?', [CREATE_COST, user.id]);

  let gangId;
  try {
    gangId = (await run('INSERT INTO gangs (name,tag,description,leader_id) VALUES (?,?,?,?)',
      [name, tag, description, user.id])).lastID;
  } catch (e) { await refund(); return res.json({ error: 'Name or tag already taken.' }); }

  try {
    await run("INSERT INTO gang_members (gang_id,user_id,rank) VALUES (?,?,'Leader')", [gangId, user.id]);
  } catch (e) {
    await run('DELETE FROM gangs WHERE id = ?', [gangId]);
    await refund();
    return res.json({ error: 'Already in a gang.' });
  }
  await run('UPDATE users SET gang_id = ? WHERE id = ?', [gangId, user.id]);
  await gangLog(gangId, user, 'create', CREATE_COST, `Founded ${name} [${tag}]`);
  await cashLog('gang_create', { from_id: user.id, from_name: user.username, to_name: name, amount: CREATE_COST, note: 'Gang founding fee' });
  res.json({ msg: `Gang "${name}" created!`, redirect: '/my-gang' });
}));

// ── INVITES ──────────────────────────────────────────────
router.post('/gang/invite', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  if (!canInvite(gang.my_rank)) return res.json({ error: 'Only the leader or officers can invite.' });
  const target = await get('SELECT id, username FROM users WHERE username = ?', [String(req.body.username || '').trim()]);
  if (!target) return res.json({ error: 'User not found.' });
  if (target.id === user.id) return res.json({ error: "You're already in your own gang." });
  if (await membership(target.id)) return res.json({ error: `${target.username} is already in a gang.` });
  const count = (await get('SELECT COUNT(*) AS c FROM gang_members WHERE gang_id = ?', [gang.id])).c;
  if (count >= MAX_MEMBERS) return res.json({ error: `Your gang is full (${MAX_MEMBERS} members).` });
  const pending = await get('SELECT id FROM gang_invites WHERE gang_id = ? AND user_id = ? AND created_at > ?',
    [gang.id, target.id, now() - INVITE_TTL]);
  if (pending) return res.json({ error: `${target.username} already has a pending invite.` });

  await run(`INSERT INTO gang_invites (gang_id,user_id,invited_by,created_at) VALUES (?,?,?,?)
    ON CONFLICT(gang_id,user_id) DO UPDATE SET invited_by = excluded.invited_by, created_at = excluded.created_at`,
    [gang.id, target.id, user.id, now()]);
  await addEvent(target.id, 'gang_invite', `${user.username} invited you to join ${gang.name} [${gang.tag}]. Go to /gang-invites to respond.`);
  res.json({ msg: `Invite sent to ${target.username}.` });
}));

router.get('/gang-invites', ...page(async (user, req, res) => {
  const invites = await all(`SELECT i.id, i.created_at, g.name, g.tag, g.description, u.username AS inviter,
      (SELECT COUNT(*) FROM gang_members WHERE gang_id = g.id) AS member_count
    FROM gang_invites i JOIN gangs g ON g.id = i.gang_id JOIN users u ON u.id = i.invited_by
    WHERE i.user_id = ? AND i.created_at > ? ORDER BY i.created_at DESC`, [user.id, now() - INVITE_TTL]);
  await renderPage(res, 'gang_invites', user, { invites, maxMembers: MAX_MEMBERS });
}));

router.post('/gang/join', ...act(async (user, req, res) => {
  if (await membership(user.id)) return res.json({ error: 'Already in a gang.' });
  const invite = await get(`SELECT i.id, i.gang_id, g.name, g.tag, g.leader_id
    FROM gang_invites i JOIN gangs g ON g.id = i.gang_id
    WHERE i.id = ? AND i.user_id = ? AND i.created_at > ?`,
    [parseInt(req.body.invite_id, 10) || 0, user.id, now() - INVITE_TTL]);
  if (!invite) return res.json({ error: 'Invite not found or expired.' });

  // Size check + insert in ONE statement so the gang can't overfill.
  // gang_members.user_id is UNIQUE, so a double-click can't join twice either.
  let joined;
  try {
    joined = await run(`INSERT INTO gang_members (gang_id,user_id,rank)
      SELECT ?, ?, 'Member' WHERE (SELECT COUNT(*) FROM gang_members WHERE gang_id = ?) < ?`,
      [invite.gang_id, user.id, invite.gang_id, MAX_MEMBERS]);
  } catch (e) { return res.json({ error: 'Already in a gang.' }); }
  if (!joined.changes) return res.json({ error: 'That gang is full.' });

  await run('UPDATE users SET gang_id = ? WHERE id = ?', [invite.gang_id, user.id]);
  await run('DELETE FROM gang_invites WHERE user_id = ?', [user.id]);
  await gangLog(invite.gang_id, user, 'join', 0, `${user.username} joined`);
  await addEvent(invite.leader_id, 'gang_join', `${user.username} joined ${invite.name}.`);
  res.json({ msg: `Joined ${invite.name}!`, redirect: '/my-gang' });
}));

router.post('/gang/decline', ...act(async (user, req, res) => {
  await run('DELETE FROM gang_invites WHERE id = ? AND user_id = ?', [parseInt(req.body.invite_id, 10) || 0, user.id]);
  res.json({ msg: 'Invite declined.' });
}));

// ── MEMBERSHIP ───────────────────────────────────────────
router.post('/gang/leave', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  if (gang.my_rank === 'Leader') return res.json({ error: 'Leaders must transfer leadership or disband the gang first.' });
  await run("DELETE FROM gang_members WHERE gang_id = ? AND user_id = ? AND rank != 'Leader'", [gang.id, user.id]);
  await run('UPDATE users SET gang_id = NULL WHERE id = ?', [user.id]);
  await gangLog(gang.id, user, 'leave', 0, `${user.username} left`);
  res.json({ msg: 'Left the gang.', redirect: '/gangs' });
}));

router.post('/gang/kick', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  if (!canInvite(gang.my_rank)) return res.json({ error: 'Only the leader or officers can remove members.' });
  const targetId = parseInt(req.body.user_id, 10);
  if (!targetId) return res.json({ error: 'Pick a member.' });
  if (targetId === user.id) return res.json({ error: 'Use Leave Gang to leave.' });
  const t = await get(`SELECT gm.rank, u.username FROM gang_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.gang_id = ? AND gm.user_id = ?`, [gang.id, targetId]);
  if (!t) return res.json({ error: 'That inmate is not in your gang.' });
  if (t.rank === 'Leader') return res.json({ error: "You can't remove the leader." });
  if (gang.my_rank === 'Officer' && t.rank !== 'Member') return res.json({ error: 'Officers can only remove regular members.' });

  const del = await run('DELETE FROM gang_members WHERE gang_id = ? AND user_id = ? AND rank = ?', [gang.id, targetId, t.rank]);
  if (!del.changes) return res.json({ error: 'Their rank just changed. Try again.' });
  await run('UPDATE users SET gang_id = NULL WHERE id = ? AND gang_id = ?', [targetId, gang.id]);
  await gangLog(gang.id, user, 'kick', 0, `${user.username} removed ${t.username}`);
  await addEvent(targetId, 'gang_kick', `You were removed from ${gang.name} [${gang.tag}] by ${user.username}.`);
  res.json({ msg: `${t.username} removed from the gang.` });
}));

router.post('/gang/rank', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  if (gang.my_rank !== 'Leader') return res.json({ error: 'Only the leader can change ranks.' });
  const newRank = req.body.rank;
  if (!['Officer', 'Member'].includes(newRank)) return res.json({ error: 'Invalid rank.' });
  const targetId = parseInt(req.body.user_id, 10);
  if (targetId === user.id) return res.json({ error: "You can't change your own rank." });
  const t = await get(`SELECT u.username FROM gang_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.gang_id = ? AND gm.user_id = ?`, [gang.id, targetId]);
  if (!t) return res.json({ error: 'That inmate is not in your gang.' });
  await run("UPDATE gang_members SET rank = ? WHERE gang_id = ? AND user_id = ? AND rank != 'Leader'", [newRank, gang.id, targetId]);
  await gangLog(gang.id, user, 'rank', 0, `${t.username} is now ${newRank}`);
  await addEvent(targetId, 'gang_rank', `You are now an ${newRank} in ${gang.name}.`.replace('an Member', 'a Member'));
  res.json({ msg: `${t.username} is now ${newRank}.` });
}));

router.post('/gang/transfer', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  if (gang.my_rank !== 'Leader') return res.json({ error: 'Only the leader can hand over leadership.' });
  const targetId = parseInt(req.body.user_id, 10);
  if (targetId === user.id) return res.json({ error: "You're already the leader." });
  const t = await get(`SELECT u.username FROM gang_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.gang_id = ? AND gm.user_id = ?`, [gang.id, targetId]);
  if (!t) return res.json({ error: 'That inmate is not in your gang.' });

  const moved = await run('UPDATE gangs SET leader_id = ? WHERE id = ? AND leader_id = ?', [targetId, gang.id, user.id]);
  if (!moved.changes) return res.json({ error: 'Leadership has already changed.' });
  await run("UPDATE gang_members SET rank = 'Leader' WHERE gang_id = ? AND user_id = ?", [gang.id, targetId]);
  await run("UPDATE gang_members SET rank = 'Officer' WHERE gang_id = ? AND user_id = ?", [gang.id, user.id]);
  await gangLog(gang.id, user, 'transfer', 0, `${user.username} handed leadership to ${t.username}`);
  await addEvent(targetId, 'gang_rank', `You are now the leader of ${gang.name} [${gang.tag}].`);
  res.json({ msg: `${t.username} is now the leader.` });
}));

// ── BANK ─────────────────────────────────────────────────
router.post('/gang/deposit', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  const amount = parseAmount(req.body.amount);
  if (!amount) return res.json({ error: 'Enter a whole dollar amount.' });

  const paid = await run('UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ?', [amount, user.id, amount]);
  if (!paid.changes) return res.json({ error: "You don't have that much cash." });
  // Only credits the bank if you're still a member (protects against a disband mid-request)
  const credited = await run(`UPDATE gangs SET bank = bank + ? WHERE id = ?
    AND EXISTS (SELECT 1 FROM gang_members WHERE gang_id = ? AND user_id = ?)`, [amount, gang.id, gang.id, user.id]);
  if (!credited.changes) {
    await run('UPDATE users SET cash = cash + ? WHERE id = ?', [amount, user.id]);
    return res.json({ error: 'You are no longer in that gang.' });
  }
  await gangLog(gang.id, user, 'deposit', amount, `${user.username} deposited $${amount.toLocaleString()}`);
  await cashLog('gang_deposit', { from_id: user.id, from_name: user.username, to_name: gang.name, amount, note: 'Gang bank deposit' });
  res.json({ msg: `Deposited $${amount.toLocaleString()} into the gang bank.` });
}));

router.post('/gang/withdraw', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  if (gang.my_rank !== 'Leader') return res.json({ error: 'Only the leader can withdraw from the gang bank.' });
  const amount = parseAmount(req.body.amount);
  if (!amount) return res.json({ error: 'Enter a whole dollar amount.' });

  const taken = await run('UPDATE gangs SET bank = bank - ? WHERE id = ? AND leader_id = ? AND bank >= ?',
    [amount, gang.id, user.id, amount]);
  if (!taken.changes) return res.json({ error: "The gang bank doesn't have that much." });
  const paid = await run('UPDATE users SET cash = cash + ? WHERE id = ?', [amount, user.id]);
  if (!paid.changes) {
    await run('UPDATE gangs SET bank = bank + ? WHERE id = ?', [amount, gang.id]);
    return res.json({ error: 'Withdrawal failed. Nothing was taken.' });
  }
  await gangLog(gang.id, user, 'withdraw', amount, `${user.username} withdrew $${amount.toLocaleString()}`);
  await cashLog('gang_withdraw', { to_id: user.id, to_name: user.username, from_name: gang.name, amount, note: 'Gang bank withdrawal' });
  res.json({ msg: `Withdrew $${amount.toLocaleString()} from the gang bank.` });
}));

// ── DISBAND ──────────────────────────────────────────────
router.post('/gang/disband', ...act(async (user, req, res) => {
  const gang = await membership(user.id);
  if (!gang) return res.json({ error: 'Not in a gang.' });
  if (gang.my_rank !== 'Leader') return res.json({ error: 'Only the leader can disband the gang.' });

  const members = await all('SELECT user_id FROM gang_members WHERE gang_id = ?', [gang.id]);
  // 1. Remove everyone first — deposits/withdrawals check membership, so the bank freezes
  await run('DELETE FROM gang_members WHERE gang_id = ?', [gang.id]);
  await run('UPDATE users SET gang_id = NULL WHERE gang_id = ?', [gang.id]);
  // 2. Pay the remaining bank to the leader (guarded so it can only be taken once)
  let payout = 0;
  for (let i = 0; i < 3; i++) {
    const fresh = await get('SELECT bank FROM gangs WHERE id = ?', [gang.id]);
    if (!fresh || fresh.bank === 0) break;
    const took = await run('UPDATE gangs SET bank = 0 WHERE id = ? AND bank = ?', [gang.id, fresh.bank]);
    if (took.changes) {
      await run('UPDATE users SET cash = cash + ? WHERE id = ?', [fresh.bank, user.id]);
      payout = fresh.bank;
      break;
    }
  }
  // 3. Remove the gang
  await run('DELETE FROM gang_invites WHERE gang_id = ?', [gang.id]);
  await run('DELETE FROM gangs WHERE id = ?', [gang.id]);
  for (const m of members) {
    if (m.user_id !== user.id) await addEvent(m.user_id, 'gang_disband', `${gang.name} [${gang.tag}] was disbanded by ${user.username}.`);
  }
  if (payout) await cashLog('gang_disband', { to_id: user.id, to_name: user.username, from_name: gang.name, amount: payout, note: 'Gang bank paid out on disband' });
  res.json({ msg: payout ? `Gang disbanded. $${payout.toLocaleString()} from the bank was paid to you.` : 'Gang disbanded.', redirect: '/gangs' });
}));

module.exports = router;
