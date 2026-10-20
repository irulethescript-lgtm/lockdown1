const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure db directory exists
const dbDir = path.join(__dirname, '../db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dbDir, 'lockdown.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

// Promisified helpers
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// SQLite has one writer. Queue transactions before taking a worker thread so
// concurrent BEGIN IMMEDIATE calls cannot starve the active writer's queries.
let transactionQueue = Promise.resolve();
function withTransaction(action) {
  const pending = transactionQueue.then(() => executeTransaction(action));
  transactionQueue = pending.catch(() => {});
  return pending;
}

// A dedicated connection keeps concurrent requests out of each other's transactions.
async function executeTransaction(action) {
  const connection = new sqlite3.Database(dbPath);
  connection.configure('busyTimeout', 5000);
  const store = {
    run: (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function(err) {
      if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID });
    })),
    get: (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))),
    all: (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))),
  };
  try {
    await store.run('PRAGMA foreign_keys = ON');
    await store.run('BEGIN IMMEDIATE');
    const result = await action(store);
    await store.run('COMMIT');
    return result;
  } catch (err) {
    await store.run('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await new Promise((resolve, reject) => connection.close(err => err ? reject(err) : resolve()));
  }
}

// Sync-style DB using better-sqlite3 if available, else fallback
let syncDb;
try {
  const Database = require('better-sqlite3');
  syncDb = new Database(dbPath);
  syncDb.pragma('journal_mode = WAL');
  syncDb.pragma('foreign_keys = ON');
} catch(e) {
  // better-sqlite3 not available - use async sqlite3
  syncDb = null;
}

// Sync wrapper - if better-sqlite3 available use it, else throw
function syncRun(sql, params = []) {
  if (syncDb) return syncDb.prepare(sql).run(...params);
  throw new Error('Sync DB not available');
}
function syncGet(sql, params = []) {
  if (syncDb) return syncDb.prepare(sql).get(...params);
  throw new Error('Sync DB not available');
}
function syncAll(sql, params = []) {
  if (syncDb) return syncDb.prepare(sql).all(...params);
  throw new Error('Sync DB not available');
}

// Initialize tables
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    xp_needed INTEGER DEFAULT 100,
    hp INTEGER DEFAULT 100,
    max_hp INTEGER DEFAULT 100,
    energy INTEGER DEFAULT 10,
    max_energy INTEGER DEFAULT 10,
    nerve INTEGER DEFAULT 5,
    max_nerve INTEGER DEFAULT 5,
    stamina INTEGER DEFAULT 100,
    strength INTEGER DEFAULT 10,
    defense INTEGER DEFAULT 8,
    speed INTEGER DEFAULT 8,
    cash INTEGER DEFAULT 500,
    bank INTEGER DEFAULT 0,
    rep INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    gang_id INTEGER DEFAULT NULL,
    prison_id INTEGER DEFAULT 1,
    energy_last_regen INTEGER DEFAULT (strftime('%s','now')),
    nerve_last_regen INTEGER DEFAULT (strftime('%s','now')),
    in_hospital INTEGER DEFAULT 0,
    hospital_until INTEGER DEFAULT 0,
    hospital_reason TEXT DEFAULT NULL,
    in_jail INTEGER DEFAULT 0,
    jail_until INTEGER DEFAULT 0,
    jail_reason TEXT DEFAULT NULL,
    stamina_last_regen INTEGER DEFAULT (strftime('%s','now')),
    cell_size TEXT DEFAULT '8x12'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gangs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    tag TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    leader_id INTEGER NOT NULL,
    bank INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gang_members (
    gang_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL UNIQUE,
    rank TEXT DEFAULT 'Member',
    joined_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY(gang_id, user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attacker_id INTEGER NOT NULL,
    defender_id INTEGER NOT NULL,
    attacker_won INTEGER NOT NULL,
    damage_dealt INTEGER DEFAULT 0,
    damage_taken INTEGER DEFAULT 0,
    cash_stolen INTEGER DEFAULT 0,
    rep_gained INTEGER DEFAULT 0,
    log TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shoutbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    gang_only INTEGER DEFAULT 0,
    gang_id INTEGER DEFAULT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    subject TEXT DEFAULT 'No Subject',
    body TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mission_key TEXT NOT NULL,
    completed_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, mission_key)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'item',
    quantity INTEGER DEFAULT 1,
    UNIQUE(user_id, item_key, item_type)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS hitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id INTEGER NOT NULL,
    poster_id INTEGER NOT NULL,
    reward INTEGER DEFAULT 0,
    reason TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cell_amenities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    placed_tile INTEGER DEFAULT NULL,
    protected INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS avatar_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    slot INTEGER NOT NULL DEFAULT 1,
    name TEXT DEFAULT 'Preset',
    layers TEXT NOT NULL DEFAULT '{}',
    UNIQUE(user_id, slot)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS surgeon_unlocks (
    user_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    PRIMARY KEY(user_id, item_key)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS yard_positions (
    user_id INTEGER PRIMARY KEY,
    x INTEGER DEFAULT 5,
    y INTEGER DEFAULT 5,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS yard_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'item',
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    prison_id INTEGER NOT NULL DEFAULT 1,
    dropped_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS training_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    strength INTEGER DEFAULT 0,
    defense INTEGER DEFAULT 0,
    speed INTEGER DEFAULT 0,
    trained_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
});

// ── Async helpers ────────────────────────────────────────

async function getUser(id, store) {
  if (!store) return withTransaction(tx => getUser(id, tx));
  const { get, all, run } = store;
  const travelModule = require('./travel');
  const travel = await travelModule.settleTravel(id, store);
  const u = await get('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) return null;
  await require('./item-actions').settleBook(store,u);
  u.travel = travelModule.statusSummary(travel);

  // ── Apply placed cell amenity effects ──
  // These are passive bonuses from items placed in the cell
  const { CELL_AMENITIES, WEAPONS, ARMOR, GEAR } = require('./gamedata');
  const placed = await all('SELECT item_key FROM cell_amenities WHERE user_id=? AND placed_tile IS NOT NULL', [id]);
  const aug = { dexterity:0, max_hp:0, max_energy:0, max_nerve:0, strength:0, defense:0, speed:0, stamina:0 };
  placed.forEach(row => {
    const am = CELL_AMENITIES[row.item_key];
    if (am && am.effect) {
      Object.entries(am.effect).forEach(([stat, val]) => {
        if (aug[stat] !== undefined) aug[stat] += val;
      });
    }
  });
  // Only owned equipment grants bonuses, so selling/dropping it cannot leave phantom stats.
  const equipped = await get('SELECT * FROM equipment WHERE user_id=?', [id]);
  const owned = await all('SELECT item_key,item_type FROM inventory WHERE user_id=? AND quantity>0', [id]);
  u.itemBonuses=await require('./item-actions').activeBonuses(store,id,owned);
  const bookModifiers=u.itemBonuses.modifiers;
  const gear = { dexterity:0, max_hp:0, max_energy:0, max_nerve:0, strength:0, defense:0, speed:0, stamina:0 };
  for (const [slot, catalog] of [['weapon', WEAPONS], ['armor', ARMOR], ['gear', GEAR]]) {
    const key = equipped?.[slot];
    if (!owned.some(row => row.item_key === key && row.item_type === slot)) continue;
    const item = Object.hasOwn(catalog, key) ? catalog[key] : null;
    for (const [stat, value] of Object.entries(item?.effect || {})) {
      if (Object.hasOwn(gear, stat)) gear[stat] += value;
    }
  }
  // Skill increases nerve capacity without rewriting the saved base or stacking on reads.
  const { criminalProgress } = require('./city-life');
  u.criminal = criminalProgress(u.crime_xp);
  aug.max_nerve += u.criminal.nerveBonus;
  const furniture = new Set(placed.filter(row => Object.hasOwn(CELL_AMENITIES, row.item_key)).map(row => row.item_key));
  u.property = (await require('./homes').homeState(store,id)).current;
  u.max_happiness = u.property.happy + Math.min(10, furniture.size) * 10;
  u._cellAugments = aug;
  u._equipmentAugments = gear;
  u._augments = Object.fromEntries(Object.keys(aug).map(key => [key, aug[key] + gear[key]]));
  for(const [stat,bonus] of Object.entries(bookModifiers.battle||{}))u._augments[stat]+=(u[stat]+u._augments[stat])*bonus;
  if(bookModifiers.maxEnergy)u._augments.max_energy+=Math.max(0,bookModifiers.maxEnergy-(u.max_energy+u._augments.max_energy));
  const drug=await get('SELECT source_id FROM item_drug_effects WHERE user_id=? AND expires_at>?',[id,Math.floor(Date.now()/1000)]);
  for(const [stat,bonus] of Object.entries(require('./item-uses').rules[drug?.source_id]?.buff||{}))u._augments[stat]+=(u[stat]+u._augments[stat])*bonus;
  const medicalProfile = await get('SELECT opium_until FROM medical_profiles WHERE user_id=?',[id]);
  if(medicalProfile?.opium_until>Math.floor(Date.now()/1000)) u._augments.defense+=Math.floor((u.defense+u._augments.defense)*.3);
  u._combatBaseStats = Object.fromEntries(['strength','defense','speed','dexterity'].map(stat=>[stat,u[stat]+u._augments[stat]]));
  if(u.in_hospital)await run('DELETE FROM combat_buffs WHERE user_id=?',[id]);
  const combatBuffs=await all('SELECT * FROM combat_buffs WHERE user_id=? AND expires_at>?',[id,Math.floor(Date.now()/1000)]);
  for(const buff of combatBuffs)if(Object.hasOwn(u._combatBaseStats,buff.stat))u._augments[buff.stat]+=u._combatBaseStats[buff.stat]*buff.bonus;
  u.combatBuffs=combatBuffs;
  u._effectiveStats = {};
  for (const [stat, baseKey] of Object.entries({ max_hp:'_baseMaxHp', max_energy:'_baseMaxEnergy', max_nerve:'_baseMaxNerve', strength:'_baseStrength', defense:'_baseDefense', speed:'_baseSpeed', dexterity:'_baseDexterity' })) {
    u[baseKey] = u[stat];
    u[stat] = Math.max(stat.startsWith('max_') ? 1 : 0, u[stat] + u._augments[stat]);
    u._effectiveStats[stat] = u[stat];
  }
  u._baseStamina = u.stamina ?? 100;
  const overlife=await get('SELECT until_at FROM item_overlife WHERE user_id=?',[id]);
  const lifeCap=overlife?.until_at>Math.floor(Date.now()/1000)?u.max_hp*3:u.max_hp;
  if (u.hp > lifeCap) await run('UPDATE users SET hp=? WHERE id=?', [lifeCap, id]);
  u.hp = Math.min(u.hp, lifeCap);
  u.energy = Math.min(u.energy, 1000);
  u.nerve = Math.min(u.nerve, 1000);
  const { getPerks, getHeat } = require('./dynamics');
  const courses = await all('SELECT course_key FROM education WHERE user_id=? AND completed_at IS NOT NULL', [id]);
  u.perks = getPerks(courses.map(row => row.course_key));
  if(u.property.shooting)u.perks.damage+=2;
  u.medical = await require('./medical').settings(store,u);
  u.cooldowns = await all('SELECT category,ready_at FROM recovery_cooldowns WHERE user_id=?',[id]);
  u.heat = getHeat(await get('SELECT * FROM player_dynamics WHERE user_id=?', [id]));
  const now=Math.floor(Date.now()/1000);
  await store.run('INSERT OR IGNORE INTO property_health_clock(user_id,last_tick) VALUES (?,?)',[id,now]);
  const clock=await store.get('SELECT last_tick FROM property_health_clock WHERE user_id=?',[id]);
  const ticks=Math.max(0,Math.floor((now-clock.last_tick)/300));
  if(ticks&&u.property.medical){u.hp=Math.min(u.max_hp,u.hp+Math.max(1,Math.floor(u.max_hp*.01))*ticks);await store.run('UPDATE users SET hp=? WHERE id=?',[u.hp,id]);}
  if(ticks)await store.run('UPDATE property_health_clock SET last_tick=? WHERE user_id=?',[clock.last_tick+ticks*300,id]);
  u.stockHappyUntil=(await store.get('SELECT happy_until FROM stock_resource_bonuses WHERE user_id=?',[id]))?.happy_until||0;
  await regenStats(u, store);
  return u;
}

async function regenStats(u, store = { run }) {
  const { run } = store;
  const now = Math.floor(Date.now() / 1000);

  // Comfort recovers offline; full pools cannot bank time for an instant refill.
  const happinessClock = u.happiness_last_regen || now;
  const happinessTicks = Math.max(0, Math.floor((now - happinessClock) / 900));
  const book=u.itemBonuses?.book;
  const bonusTicks=(clock,interval,ticks)=>book?Math.max(0,Math.min(ticks,Math.floor((Math.min(now,book.ends_at)-clock)/interval))-Math.max(0,Math.floor((book.started_at-clock-1)/interval))):0;
  const bookRules=require('./item-uses').BOOKS[book?.effect_id]||{};
  const extraHappy=bonusTicks(happinessClock,900,happinessTicks)*5*((bookRules.happyRegen||1)-1);
  const happyCap=u.itemBonuses?.modifiers.happyOverMax?99999:u.max_happiness;
  u.happiness = u.happiness>happyCap&&u.stockHappyUntil>now?u.happiness:Math.min(happyCap, Math.max(0, u.happiness) + happinessTicks * 5+extraHappy);
  u.happiness_last_regen = u.happiness >= happyCap ? now : happinessClock + happinessTicks * 900;
  await run('UPDATE users SET happiness=?,happiness_last_regen=? WHERE id=?', [u.happiness, u.happiness_last_regen, u.id]);

  // Full pools reset their clock so unused time cannot be banked for instant refills.
  for (const [stat, maximum, interval] of [['energy', 'max_energy', 300], ['nerve', 'max_nerve', 180]]) {
    const clock = `${stat}_last_regen`;
    const ticks = Math.max(0, Math.floor((now - u[clock]) / interval));
    const fraction=await store.get('SELECT fraction FROM item_regen_fractions WHERE user_id=? AND stat=?',[u.id,stat]);
    const rate=stat==='energy'?(bookRules.energyRegen||1):(bookRules.nerveRegen||1);
    const exact=ticks+bonusTicks(u[clock],interval,ticks)*(rate-1)+(fraction?.fraction||0);
    const gain=Math.floor(exact+1e-9);
    const value = u[stat]>u[maximum]?u[stat]:Math.min(u[maximum], u[stat] + gain);
    await run('INSERT INTO item_regen_fractions(user_id,stat,fraction) VALUES(?,?,?) ON CONFLICT(user_id,stat) DO UPDATE SET fraction=excluded.fraction',[u.id,stat,value>=u[maximum]?0:Math.max(0,exact-gain)]);
    const lastRegen = value >= u[maximum] ? now : u[clock] + ticks * interval;
    await run(`UPDATE users SET ${stat}=?, ${clock}=? WHERE id=?`, [value, lastRegen, u.id]);
    u[stat] = value;
    u[clock] = lastRegen;
  }

  if (u.in_hospital && now >= u.hospital_until) {
    await run('UPDATE users SET in_hospital=0, hospital_until=0 WHERE id=?', [u.id]);
    u.in_hospital = 0;
  }
  if (u.in_jail && now >= u.jail_until) {
    await run('UPDATE users SET in_jail=0, jail_until=0 WHERE id=?', [u.id]);
    u.in_jail = 0;
  }

  // Regenerate the base value, then apply cell bonuses once.
  const baseStamina = u._baseStamina ?? u.stamina ?? 100;
  const staminaLastRegen = u.stamina_last_regen || now;
  const staminaTicks = Math.max(0, Math.floor((now - staminaLastRegen) / 300));
  const stamina = Math.min(100, baseStamina + staminaTicks);
  u.stamina_last_regen = stamina >= 100 ? now : staminaLastRegen + staminaTicks * 300;
  await run('UPDATE users SET stamina=?, stamina_last_regen=? WHERE id=?', [stamina, u.stamina_last_regen, u.id]);
  u._baseStamina = stamina;
  u.stamina = Math.min(100, Math.max(0, stamina + (u._cellAugments?.stamina || 0)));
  u._effectiveStamina = u.stamina;

  await run('UPDATE users SET last_active=? WHERE id=?', [now, u.id]);
}

async function addEvent(userId, type, message) {
  await run('INSERT INTO events (user_id, type, message) VALUES (?,?,?)', [userId, type, message]);
}

module.exports = { db, dbPath, run, get, all, getUser, addEvent, withTransaction };

// These tables are added via serialize at startup - append to existing db.serialize block
// Run this as a migration
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS equipment (
    user_id INTEGER PRIMARY KEY,
    weapon TEXT DEFAULT NULL,
    armor TEXT DEFAULT NULL,
    gear TEXT DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS open_market (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    prison_id INTEGER NOT NULL DEFAULT 1,
    item_type TEXT NOT NULL,
    item_key TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    price INTEGER NOT NULL,
    listed_at INTEGER DEFAULT (strftime('%s','now')),
    active INTEGER DEFAULT 1
  )`);

  // ── NEW TABLES ──
  db.run(`CREATE TABLE IF NOT EXISTS attack_cooldowns (
    attacker_id INTEGER NOT NULL,
    defender_id INTEGER NOT NULL,
    last_attack INTEGER NOT NULL,
    PRIMARY KEY(attacker_id, defender_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mug_cooldowns (
    mugger_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    last_mug INTEGER NOT NULL,
    PRIMARY KEY(mugger_id, target_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS spy_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spy_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    result TEXT DEFAULT '{}',
    cost INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cell_combos (
    user_id INTEGER PRIMARY KEY,
    combo TEXT NOT NULL DEFAULT '12345'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS raid_cooldowns (
    raider_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    last_raid INTEGER NOT NULL,
    PRIMARY KEY(raider_id, target_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS raid_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raider_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    combo_tried TEXT NOT NULL,
    correct_positions TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // New user columns via ALTER (safe — ignored if already exist)
  const newCols = [
    "ALTER TABLE users ADD COLUMN dexterity INTEGER NOT NULL DEFAULT 8",
    "ALTER TABLE users ADD COLUMN happiness INTEGER NOT NULL DEFAULT 100",
    "ALTER TABLE users ADD COLUMN happiness_last_regen INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN relax_ready_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN crime_xp INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE training_history ADD COLUMN dexterity INTEGER NOT NULL DEFAULT 8",
    "ALTER TABLE users ADD COLUMN favors INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN blurb TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN job_key TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN job_prison_id INTEGER DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN last_daily_pay INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN last_active INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN stamina_last_regen INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL",
    "ALTER TABLE yard_items ADD COLUMN prison_id INTEGER NOT NULL DEFAULT 1",
  ];
  newCols.forEach(sql => db.run(sql, ()=>{}));
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS gym_progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    energy_spent INTEGER NOT NULL DEFAULT 0
  )`);
});

// Persistent progression. Existing accounts start with zero mastery and fresh daily goals.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS crime_mastery (
    user_id INTEGER NOT NULL REFERENCES users(id),
    crime_key TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, crime_key)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS daily_progress (
    user_id INTEGER NOT NULL REFERENCES users(id),
    day TEXT NOT NULL,
    crimes INTEGER NOT NULL DEFAULT 0,
    training INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, day)
  )`);
});

// Gang and trade pages must also work on a fresh database.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS gang_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, gang_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, invited_by INTEGER NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(gang_id, user_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS gang_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, gang_id INTEGER NOT NULL, user_id INTEGER,
    username TEXT, action TEXT NOT NULL, amount INTEGER DEFAULT 0,
    note TEXT DEFAULT '', created_at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_gang_logs_gang ON gang_logs(gang_id, id)');
  db.run(`CREATE TABLE IF NOT EXISTS transaction_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
    from_id INTEGER, to_id INTEGER, from_name TEXT, to_name TEXT,
    item_key TEXT, item_type TEXT, quantity INTEGER DEFAULT 1,
    cash_amount INTEGER DEFAULT 0, note TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
});

// Additive upgrades preserve existing player accounts and progress.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS player_dynamics (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    heat INTEGER NOT NULL DEFAULT 0,
    heat_updated INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS education (
    user_id INTEGER NOT NULL REFERENCES users(id),
    course_key TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finishes_at INTEGER NOT NULL,
    completed_at INTEGER,
    PRIMARY KEY(user_id, course_key)
  )`);
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS one_active_course ON education(user_id) WHERE completed_at IS NULL');
  db.run(`CREATE TABLE IF NOT EXISTS recovery_cooldowns (
    user_id INTEGER NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    ready_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, category)
  )`);
  for (const sql of [
    "ALTER TABLE attacks ADD COLUMN result TEXT DEFAULT NULL",
    "ALTER TABLE attacks ADD COLUMN ending TEXT DEFAULT 'mug'",
    "ALTER TABLE attacks ADD COLUMN stance TEXT DEFAULT 'balanced'",
  ]) db.run(sql, () => {});
});

// Timed visits, cargo and discoveries are separate from permanent prison transfers.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS travel_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),
    origin_id INTEGER NOT NULL,destination_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'outbound',
    departed_at INTEGER NOT NULL,arrives_at INTEGER NOT NULL,return_departed_at INTEGER,
    return_arrives_at INTEGER,completed_at INTEGER,fare INTEGER NOT NULL,capacity INTEGER NOT NULL
  )`);
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip ON travel_trips(user_id) WHERE completed_at IS NULL');
  db.run(`CREATE TABLE IF NOT EXISTS travel_cargo (
    trip_id INTEGER NOT NULL REFERENCES travel_trips(id),item_key TEXT NOT NULL,
    quantity INTEGER NOT NULL,PRIMARY KEY(trip_id,item_key)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS travel_stock (
    item_key TEXT PRIMARY KEY,quantity INTEGER NOT NULL,restock_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS travel_progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),bag_level INTEGER NOT NULL DEFAULT 0,
    trips_completed INTEGER NOT NULL DEFAULT 0,sales_cash INTEGER NOT NULL DEFAULT 0,
    collection_claimed INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS travel_discoveries (
    user_id INTEGER NOT NULL REFERENCES users(id),item_key TEXT NOT NULL,
    first_found INTEGER NOT NULL,total_brought INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,item_key)
  )`);
});

// Persistent shop inventories and owned homes. Existing saves receive additive tables.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rotating_stock (
    scope TEXT NOT NULL,item_type TEXT NOT NULL,item_key TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity>=0),price INTEGER NOT NULL,
    active INTEGER NOT NULL,restock_at INTEGER NOT NULL,expires_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(scope,item_type,item_key)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS owned_homes (
    user_id INTEGER NOT NULL,home_key TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,home_key)
  )`);
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS one_active_home ON owned_homes(user_id) WHERE active=1');
});

// Persist successful and unsuccessful city rolls for each UTC date.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS city_daily_finds (
    user_id INTEGER NOT NULL,day TEXT NOT NULL,item_type TEXT,item_key TEXT,
    x INTEGER NOT NULL,y INTEGER NOT NULL,claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,day)
  )`);
});

// Casino balances, server-owned rounds and escrow survive restarts.
db.serialize(() => {
 for (const sql of [
  "CREATE TABLE IF NOT EXISTS casino_wallets (user_id INTEGER PRIMARY KEY, day TEXT NOT NULL,tokens INTEGER NOT NULL DEFAULT 75 CHECK(tokens>=0 AND tokens<=75), points INTEGER NOT NULL DEFAULT 0 CHECK(points>=0),points_refill_day TEXT,job_refill_day TEXT)",
  "CREATE TABLE IF NOT EXISTS casino_rounds (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,game TEXT NOT NULL,state TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS one_live_casino_round ON casino_rounds(user_id,game) WHERE active=1",
  "CREATE TABLE IF NOT EXISTS casino_stats (user_id INTEGER NOT NULL,stat TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,stat))",
  "CREATE TABLE IF NOT EXISTS casino_awards (user_id INTEGER NOT NULL,award TEXT NOT NULL,earned_at INTEGER NOT NULL,PRIMARY KEY(user_id,award))",
  "CREATE TABLE IF NOT EXISTS casino_requests (user_id INTEGER NOT NULL,request_id TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,request_id))",
  "CREATE TABLE IF NOT EXISTS casino_tables (id INTEGER PRIMARY KEY AUTOINCREMENT,game TEXT NOT NULL,host_id INTEGER NOT NULL,guest_id INTEGER,stake INTEGER NOT NULL,status TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS casino_lotteries (day TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'open',pot INTEGER NOT NULL DEFAULT 0,winner_id INTEGER,prize INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS casino_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT NOT NULL,user_id INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS casino_sports (id TEXT PRIMARY KEY,title TEXT NOT NULL,starts_at INTEGER NOT NULL,options TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',winner TEXT)",
  "CREATE TABLE IF NOT EXISTS casino_sports_bets (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,user_id INTEGER NOT NULL,selection TEXT NOT NULL,stake INTEGER NOT NULL,odds INTEGER NOT NULL,settled INTEGER NOT NULL DEFAULT 0)"
 ]) db.run(sql);
});

// Medical state is additive, leaving existing player records intact.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS medical_profiles (
    user_id INTEGER PRIMARY KEY, blood_type TEXT NOT NULL,
    accepts_revives INTEGER NOT NULL DEFAULT 1, revive_skill REAL NOT NULL DEFAULT 1,
    revive_unlocked INTEGER NOT NULL DEFAULT 0, radiation_until INTEGER NOT NULL DEFAULT 0,
    opium_until INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS faction_medical (
    gang_id INTEGER PRIMARY KEY, capacity INTEGER NOT NULL DEFAULT 0,
    effectiveness INTEGER NOT NULL DEFAULT 0, reviver INTEGER NOT NULL DEFAULT 0
  )`);
});

// Property contracts and finances are additive to legacy ownership saves.
db.serialize(()=>{
 for(const sql of [
  "CREATE TABLE IF NOT EXISTS property_details(owner_id INTEGER NOT NULL,home_key TEXT NOT NULL,upgrades TEXT NOT NULL DEFAULT '{}',staff TEXT NOT NULL DEFAULT '{}',debt INTEGER NOT NULL DEFAULT 0,last_day INTEGER NOT NULL,vault INTEGER NOT NULL DEFAULT 0,sale_price INTEGER NOT NULL DEFAULT 0,share_vault INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,home_key))",
  'CREATE TABLE IF NOT EXISTS property_residence(user_id INTEGER PRIMARY KEY,owner_id INTEGER NOT NULL,home_key TEXT NOT NULL)',
  "CREATE TABLE IF NOT EXISTS property_leases(id INTEGER PRIMARY KEY,owner_id INTEGER NOT NULL,home_key TEXT NOT NULL,tenant_id INTEGER,price INTEGER NOT NULL,days INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'offered',started_at INTEGER,ends_at INTEGER,extension_days INTEGER NOT NULL DEFAULT 0,extension_price INTEGER NOT NULL DEFAULT 0)",
  "CREATE UNIQUE INDEX IF NOT EXISTS property_one_lease ON property_leases(owner_id,home_key) WHERE status IN ('offered','active')",
  'CREATE TABLE IF NOT EXISTS property_debts(user_id INTEGER PRIMARY KEY,amount INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS property_vault_log(id INTEGER PRIMARY KEY,owner_id INTEGER,home_key TEXT,user_id INTEGER,amount INTEGER,created_at INTEGER)'
 ])db.run(sql);
});
db.serialize(()=>{for(const sql of [
 'CREATE TABLE IF NOT EXISTS stock_quotes(symbol TEXT PRIMARY KEY,cents INTEGER NOT NULL,minute INTEGER NOT NULL,previous INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS stock_accounts(user_id INTEGER PRIMARY KEY,profit REAL NOT NULL DEFAULT 0,fees INTEGER NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS stock_positions(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,symbol TEXT NOT NULL,shares INTEGER NOT NULL,cost REAL NOT NULL,bought_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS stock_benefits(user_id INTEGER NOT NULL,symbol TEXT NOT NULL,blocks INTEGER NOT NULL,cycle_blocks INTEGER NOT NULL,started_day INTEGER NOT NULL,notified INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,symbol))',
 'CREATE TABLE IF NOT EXISTS stock_property_rewards(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,home_key TEXT NOT NULL)'
])db.run(sql);});
db.serialize(()=>{for(const sql of [
 "CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY,type TEXT NOT NULL,name TEXT NOT NULL,director_id INTEGER NOT NULL UNIQUE,stars INTEGER NOT NULL DEFAULT 1,vault INTEGER NOT NULL DEFAULT 0,inventory INTEGER NOT NULL DEFAULT 0,price INTEGER NOT NULL,advertising INTEGER NOT NULL DEFAULT 0,applications_open INTEGER NOT NULL DEFAULT 1,size INTEGER NOT NULL DEFAULT 0,room INTEGER NOT NULL DEFAULT 0,warehouse INTEGER NOT NULL DEFAULT 0,upgrades_spent INTEGER NOT NULL DEFAULT 0,revenue INTEGER NOT NULL DEFAULT 0,week_income INTEGER NOT NULL DEFAULT 0,trains INTEGER NOT NULL DEFAULT 0,last_close INTEGER NOT NULL)",
 "CREATE TABLE IF NOT EXISTS company_employees(user_id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,role TEXT NOT NULL DEFAULT 'unassigned',pay INTEGER NOT NULL DEFAULT 0,joined_at INTEGER NOT NULL)",
 'CREATE TABLE IF NOT EXISTS company_profiles(user_id INTEGER PRIMARY KEY,manual INTEGER NOT NULL DEFAULT 100,intelligence INTEGER NOT NULL DEFAULT 50,endurance INTEGER NOT NULL DEFAULT 100,addiction INTEGER NOT NULL DEFAULT 0,last_action INTEGER NOT NULL)',
 "CREATE TABLE IF NOT EXISTS company_applications(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,company_id INTEGER NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,company_id))",
 'CREATE TABLE IF NOT EXISTS company_points(user_id INTEGER NOT NULL,type TEXT NOT NULL,points INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,type))',
 'CREATE TABLE IF NOT EXISTS company_reports(company_id INTEGER NOT NULL,day INTEGER NOT NULL,income INTEGER NOT NULL,expenses INTEGER NOT NULL,customers INTEGER NOT NULL,efficiency REAL NOT NULL,environment REAL NOT NULL,funded INTEGER NOT NULL,PRIMARY KEY(company_id,day))'
])db.run(sql);});

db.serialize(()=>{
 db.run('ALTER TABLE property_details ADD COLUMN share_vault INTEGER NOT NULL DEFAULT 0',()=>{});
 db.run('CREATE TABLE IF NOT EXISTS property_partners(user_id INTEGER PRIMARY KEY,spouse_id INTEGER NOT NULL UNIQUE)');
 db.run('CREATE TABLE IF NOT EXISTS property_partner_invites(sender_id INTEGER PRIMARY KEY,recipient_id INTEGER NOT NULL)');
 db.run('CREATE TABLE IF NOT EXISTS property_health_clock(user_id INTEGER PRIMARY KEY,last_tick INTEGER NOT NULL)');
});

db.run('CREATE TABLE IF NOT EXISTS company_special_days(user_id INTEGER NOT NULL,day INTEGER NOT NULL,spent INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,day))');

db.serialize(()=>{db.run('CREATE TABLE IF NOT EXISTS stock_resource_bonuses(user_id INTEGER PRIMARY KEY,happy_until INTEGER NOT NULL)');db.run('CREATE TABLE IF NOT EXISTS property_trip_perks(trip_id INTEGER PRIMARY KEY,duration INTEGER NOT NULL)');});

// Each owned weapon keeps its own generated stats, magazine and attachment.
db.serialize(()=>{for(const sql of [
 'CREATE TABLE IF NOT EXISTS weapon_instances(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER,listing_id INTEGER,item_key TEXT NOT NULL,damage REAL,accuracy REAL,loaded INTEGER NOT NULL DEFAULT 0,ammo_type TEXT NOT NULL DEFAULT "standard",attachment TEXT NOT NULL DEFAULT "none")',
 'CREATE INDEX IF NOT EXISTS weapon_owner_key ON weapon_instances(owner_id,item_key)',
 'CREATE INDEX IF NOT EXISTS weapon_listing ON weapon_instances(listing_id)',
 'CREATE TABLE IF NOT EXISTS combat_loadouts(user_id INTEGER PRIMARY KEY,instance_id INTEGER,temporary_key TEXT,unarmed TEXT NOT NULL DEFAULT "fists")',
 'CREATE TABLE IF NOT EXISTS weapon_ammo(user_id INTEGER,caliber TEXT,kind TEXT,quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),PRIMARY KEY(user_id,caliber,kind))',
 'CREATE TABLE IF NOT EXISTS combat_buffs(user_id INTEGER,stat TEXT,bonus REAL,expires_at INTEGER,PRIMARY KEY(user_id,stat))'
])db.run(sql);});

// Additive item-use state; old saves and inventory identities are preserved.
db.serialize(()=>{
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS item_books(user_id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL,effect_id INTEGER NOT NULL,started_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,completed_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS item_books_read(user_id INTEGER,source_id INTEGER,PRIMARY KEY(user_id,source_id))',
  'CREATE TABLE IF NOT EXISTS item_drug_effects(user_id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL,expires_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS item_donator(user_id INTEGER PRIMARY KEY,until_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS item_outfits(user_id INTEGER,item_key TEXT,PRIMARY KEY(user_id,item_key))',
  'CREATE TABLE IF NOT EXISTS item_piggy_banks(user_id INTEGER PRIMARY KEY,amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0))',
  'CREATE TABLE IF NOT EXISTS item_travel_tickets(user_id INTEGER PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS item_overlife(user_id INTEGER PRIMARY KEY,until_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS item_regen_fractions(user_id INTEGER,stat TEXT,fraction REAL NOT NULL DEFAULT 0,PRIMARY KEY(user_id,stat))'
 ])db.run(sql);
});

db.serialize(()=>{
db.run('CREATE TABLE IF NOT EXISTS battle_victories(attack_id INTEGER PRIMARY KEY,attacker_id INTEGER NOT NULL UNIQUE,defender_id INTEGER NOT NULL UNIQUE,base_xp INTEGER NOT NULL,expires_at INTEGER NOT NULL)');

db.run('CREATE TABLE IF NOT EXISTS battle_sessions(attack_id INTEGER PRIMARY KEY,attacker_id INTEGER NOT NULL UNIQUE,defender_id INTEGER NOT NULL UNIQUE,started_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL)');

});
