// Gang system upgrade — run once (safe to re-run):  node migrate_gangs.js
// ⚠ Back up db/lockdown.db first (just copy the file).
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'db', 'lockdown.db'));
const run = (sql, p = []) => new Promise((res, rej) =>
  db.run(sql, p, function (e) { e ? rej(e) : res({ changes: this.changes }); }));
const all = (sql, p = []) => new Promise((res, rej) =>
  db.all(sql, p, (e, rows) => e ? rej(e) : res(rows || [])));

const columns = async t => (await all(`PRAGMA table_info(${t})`)).map(c => c.name);

async function addColumn(table, col, ddl) {
  if ((await columns(table)).includes(col)) return console.log(`  ok      ${table}.${col}`);
  await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  console.log(`  ADDED   ${table}.${col}`);
}

(async () => {
  console.log('Upgrading gang tables...\n');

  const have = (await all(`SELECT name FROM sqlite_master WHERE type='table'`)).map(r => r.name);
  if (!have.includes('gangs') || !have.includes('gang_members')) {
    console.log('gangs / gang_members tables not found. Start the server once (node server.js), stop it, then run this again.');
    return db.close();
  }

  // 1. Columns the game code already expects (older migrate.js schema lacked them)
  await addColumn('gangs', 'description', "TEXT DEFAULT ''");
  await addColumn('gangs', 'bank', 'INTEGER DEFAULT 0');
  await addColumn('gang_members', 'rank', "TEXT DEFAULT 'Member'");

  // 2. If the old schema used `role`, carry it over into `rank`
  if ((await columns('gang_members')).includes('role')) {
    await run(`UPDATE gang_members SET rank = CASE
      WHEN lower(role) = 'leader' THEN 'Leader'
      WHEN lower(role) IN ('officer','co-leader','coleader') THEN 'Officer'
      ELSE 'Member' END`);
    console.log('  copied  gang_members.role -> rank');
  }

  // 3. New tables
  await run(`CREATE TABLE IF NOT EXISTS gang_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gang_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    invited_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(gang_id, user_id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS gang_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gang_id INTEGER NOT NULL,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    amount INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_gang_logs_gang ON gang_logs(gang_id, id)`);
  await run(`CREATE TABLE IF NOT EXISTS transaction_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, from_id INTEGER, to_id INTEGER, from_name TEXT, to_name TEXT,
    item_key TEXT, item_type TEXT, quantity INTEGER DEFAULT 1,
    cash_amount INTEGER DEFAULT 0, note TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  console.log('  ok      gang_invites, gang_logs, transaction_logs');

  // 4. Case-insensitive uniqueness for names/tags (skipped with a warning if duplicates already exist)
  for (const [idx, col] of [['idx_gangs_name_nocase', 'name'], ['idx_gangs_tag_nocase', 'tag']]) {
    try { await run(`CREATE UNIQUE INDEX IF NOT EXISTS ${idx} ON gangs(${col} COLLATE NOCASE)`); }
    catch (e) { console.log(`  WARN    could not add unique index on gangs.${col} — duplicates exist, rename them`); }
  }

  // 5. Repair data so gang_members is the single source of truth
  await run(`INSERT OR IGNORE INTO gang_members (gang_id, user_id, rank)
             SELECT id, leader_id, 'Leader' FROM gangs`);
  await run(`UPDATE gang_members SET rank = 'Leader'
             WHERE user_id IN (SELECT leader_id FROM gangs WHERE gangs.id = gang_members.gang_id)`);
  await run(`UPDATE gang_members SET rank = 'Member'
             WHERE rank = 'Leader'
               AND user_id NOT IN (SELECT leader_id FROM gangs WHERE gangs.id = gang_members.gang_id)`);
  const a = await run(`UPDATE users SET gang_id = (SELECT gang_id FROM gang_members WHERE user_id = users.id)
             WHERE id IN (SELECT user_id FROM gang_members)
               AND (gang_id IS NULL OR gang_id != (SELECT gang_id FROM gang_members WHERE user_id = users.id))`);
  const b = await run(`UPDATE users SET gang_id = NULL
             WHERE gang_id IS NOT NULL AND id NOT IN (SELECT user_id FROM gang_members)`);
  console.log(`  repaired users.gang_id: ${a.changes} re-linked, ${b.changes} cleared`);

  console.log('\n✅ Done. Now add the gangs router to server.js (see instructions) and restart.');
  db.close();
})().catch(e => { console.error('Migration failed:', e.message); db.close(); process.exit(1); });
