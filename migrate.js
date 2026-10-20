// One-time migration — run with: node migrate.js
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const db = new sqlite3.Database(path.join(dbDir, 'lockdown.db'));
console.log('Running migrations...\n');

// All migrations — safe to re-run, errors on duplicates are silently ignored
const migrations = [
  // ── TABLES ──
  [`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, xp_needed INTEGER DEFAULT 100,
    hp INTEGER DEFAULT 100, max_hp INTEGER DEFAULT 100,
    energy INTEGER DEFAULT 10, max_energy INTEGER DEFAULT 10,
    nerve INTEGER DEFAULT 5,  max_nerve INTEGER DEFAULT 5,
    stamina INTEGER DEFAULT 100,
    strength INTEGER DEFAULT 10, defense INTEGER DEFAULT 8, speed INTEGER DEFAULT 8,
    cash INTEGER DEFAULT 500, bank INTEGER DEFAULT 0, rep INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
    gang_id INTEGER DEFAULT NULL, prison_id INTEGER DEFAULT 1,
    energy_last_regen INTEGER DEFAULT (strftime('%s','now')),
    nerve_last_regen  INTEGER DEFAULT (strftime('%s','now')),
    in_hospital INTEGER DEFAULT 0, hospital_until INTEGER DEFAULT 0, hospital_reason TEXT DEFAULT NULL,
    in_jail INTEGER DEFAULT 0,     jail_until INTEGER DEFAULT 0,     jail_reason TEXT DEFAULT NULL,
    stamina_last_regen INTEGER DEFAULT (strftime('%s','now')),
    cell_size TEXT DEFAULT '8x12',
    favors INTEGER DEFAULT 0,
    blurb TEXT DEFAULT '',
    job_key TEXT DEFAULT NULL,
    job_prison_id INTEGER DEFAULT NULL,
    last_daily_pay INTEGER DEFAULT 0,
    last_active INTEGER DEFAULT (strftime('%s','now')),
    avatar TEXT DEFAULT NULL
  )`, 'users table'],

  [`CREATE TABLE IF NOT EXISTS gangs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    tag TEXT DEFAULT '',
    leader_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'gangs table'],

  [`CREATE TABLE IF NOT EXISTS gang_members (
    user_id INTEGER PRIMARY KEY,
    gang_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'gang_members table'],

  [`CREATE TABLE IF NOT EXISTS attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attacker_id INTEGER NOT NULL, defender_id INTEGER NOT NULL,
    attacker_won INTEGER NOT NULL,
    damage_dealt INTEGER DEFAULT 0, damage_taken INTEGER DEFAULT 0,
    cash_stolen INTEGER DEFAULT 0, rep_gained INTEGER DEFAULT 0,
    log TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'attacks table'],

  [`CREATE TABLE IF NOT EXISTS attack_cooldowns (
    attacker_id INTEGER NOT NULL, defender_id INTEGER NOT NULL,
    last_attack INTEGER NOT NULL,
    PRIMARY KEY(attacker_id, defender_id)
  )`, 'attack_cooldowns table'],

  [`CREATE TABLE IF NOT EXISTS mug_cooldowns (
    mugger_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
    last_mug INTEGER NOT NULL,
    PRIMARY KEY(mugger_id, target_id)
  )`, 'mug_cooldowns table'],

  [`CREATE TABLE IF NOT EXISTS spy_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spy_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
    result TEXT DEFAULT '{}', cost INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'spy_logs table'],

  [`CREATE TABLE IF NOT EXISTS cell_combos (
    user_id INTEGER PRIMARY KEY,
    combo TEXT NOT NULL DEFAULT '12345'
  )`, 'cell_combos table'],

  [`CREATE TABLE IF NOT EXISTS raid_cooldowns (
    raider_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
    last_raid INTEGER NOT NULL,
    PRIMARY KEY(raider_id, target_id)
  )`, 'raid_cooldowns table'],

  [`CREATE TABLE IF NOT EXISTS raid_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raider_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
    combo_tried TEXT NOT NULL, correct_positions TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'raid_attempts table'],

  [`CREATE TABLE IF NOT EXISTS shoutbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, username TEXT NOT NULL,
    message TEXT NOT NULL, gang_only INTEGER DEFAULT 0, gang_id INTEGER DEFAULT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'shoutbox table'],

  [`CREATE TABLE IF NOT EXISTS mail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
    subject TEXT DEFAULT 'No Subject', body TEXT NOT NULL,
    read INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'mail table'],

  [`CREATE TABLE IF NOT EXISTS missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, mission_key TEXT NOT NULL,
    completed_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, mission_key)
  )`, 'missions table'],

  [`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, item_key TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'item', quantity INTEGER DEFAULT 1,
    UNIQUE(user_id, item_key, item_type)
  )`, 'inventory table'],

  [`CREATE TABLE IF NOT EXISTS hitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id INTEGER NOT NULL, poster_id INTEGER NOT NULL,
    reward INTEGER DEFAULT 0, reason TEXT DEFAULT '',
    active INTEGER DEFAULT 1, created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'hitlist table'],

  [`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, type TEXT NOT NULL,
    message TEXT NOT NULL, read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'events table'],

  [`CREATE TABLE IF NOT EXISTS cell_amenities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, item_key TEXT NOT NULL,
    quantity INTEGER DEFAULT 1, placed_tile INTEGER DEFAULT NULL,
    protected INTEGER DEFAULT 0
  )`, 'cell_amenities table'],

  [`CREATE TABLE IF NOT EXISTS equipment (
    user_id INTEGER PRIMARY KEY,
    weapon TEXT DEFAULT NULL, armor TEXT DEFAULT NULL, gear TEXT DEFAULT NULL
  )`, 'equipment table'],

  [`CREATE TABLE IF NOT EXISTS open_market (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL, prison_id INTEGER NOT NULL DEFAULT 1,
    item_type TEXT NOT NULL, item_key TEXT NOT NULL,
    quantity INTEGER DEFAULT 1, price INTEGER NOT NULL,
    listed_at INTEGER DEFAULT (strftime('%s','now')), active INTEGER DEFAULT 1
  )`, 'open_market table'],

  [`CREATE TABLE IF NOT EXISTS avatar_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, slot INTEGER NOT NULL DEFAULT 1,
    name TEXT DEFAULT 'Preset', layers TEXT NOT NULL DEFAULT '{}',
    UNIQUE(user_id, slot)
  )`, 'avatar_presets table'],

  [`CREATE TABLE IF NOT EXISTS surgeon_unlocks (
    user_id INTEGER NOT NULL, item_key TEXT NOT NULL,
    PRIMARY KEY(user_id, item_key)
  )`, 'surgeon_unlocks table'],

  [`CREATE TABLE IF NOT EXISTS yard_positions (
    user_id INTEGER PRIMARY KEY, x REAL DEFAULT 50, y REAL DEFAULT 75
  )`, 'yard_positions table'],

  [`CREATE TABLE IF NOT EXISTS yard_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key TEXT NOT NULL, item_type TEXT NOT NULL DEFAULT 'item',
    x INTEGER NOT NULL DEFAULT 10, y INTEGER NOT NULL DEFAULT 7,
    prison_id INTEGER NOT NULL DEFAULT 1,
    dropped_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'yard_items table'],

  [`CREATE TABLE IF NOT EXISTS training_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    strength INTEGER DEFAULT 0, defense INTEGER DEFAULT 0, speed INTEGER DEFAULT 0,
    trained_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'training_history table'],

  [`CREATE TABLE IF NOT EXISTS transaction_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    from_id INTEGER,
    to_id INTEGER,
    from_name TEXT,
    to_name TEXT,
    item_key TEXT,
    item_type TEXT,
    quantity INTEGER DEFAULT 1,
    cash_amount INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, 'transaction_logs table'],
];

// ADD COLUMN migrations (safe — silently skip if already exists)
const colMigrations = [
  "ALTER TABLE users ADD COLUMN hospital_reason TEXT DEFAULT NULL",
  "ALTER TABLE users ADD COLUMN jail_reason TEXT DEFAULT NULL",
  "ALTER TABLE users ADD COLUMN stamina_last_regen INTEGER DEFAULT (strftime('%s','now'))",
  "ALTER TABLE users ADD COLUMN cell_size TEXT DEFAULT '8x12'",
  "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL",
  "ALTER TABLE users ADD COLUMN blurb TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN favors INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN job_key TEXT DEFAULT NULL",
  "ALTER TABLE users ADD COLUMN job_prison_id INTEGER DEFAULT NULL",
  "ALTER TABLE users ADD COLUMN last_daily_pay INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN last_active INTEGER DEFAULT (strftime('%s','now'))",
  "ALTER TABLE cell_amenities ADD COLUMN protected INTEGER DEFAULT 0",
  "ALTER TABLE inventory ADD COLUMN item_type TEXT NOT NULL DEFAULT 'item'",
  "ALTER TABLE attacks ADD COLUMN damage_dealt INTEGER DEFAULT 0",
  "ALTER TABLE attacks ADD COLUMN damage_taken INTEGER DEFAULT 0",
];

let pending = migrations.length + colMigrations.length;
let completed = 0;

function done(label, err) {
  if (err && !err.message.includes('duplicate column') && !err.message.includes('already exists')) {
    console.log(`  SKIP  ${label}`);
  } else {
    console.log(`  OK    ${label}`);
  }
  if (++completed >= pending) {
    console.log('\n✅ All migrations complete! Run: node server.js');
    db.close();
  }
}

migrations.forEach(([sql, label]) => db.run(sql, err => done(label, err)));
colMigrations.forEach(sql => {
  const label = sql.replace('ALTER TABLE users ADD COLUMN','users:').replace('ALTER TABLE ','').replace(' ADD COLUMN',' +').split(' DEFAULT')[0];
  db.run(sql, err => done(label, err));
});
