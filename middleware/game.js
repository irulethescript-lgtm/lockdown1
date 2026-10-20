const express = require('express');
const { db, run, get, all, getUser, addEvent } = require('../middleware/db');
const { requireAuth } = require('../middleware/auth');
const { MISSIONS, ITEMS, CELL_AMENITIES, WEAPONS, ARMOR, GEAR, DRUGS, PRISONS, getTitle, levelUpCheck, JOBS } = require('../middleware/gamedata');
const router = express.Router();

function rnd(max) { return Math.floor(Math.random() * max); }

function statBlock(u) {
  return {
    hp: u.hp, max_hp: u.max_hp, energy: u.energy, max_energy: u.max_energy,
    nerve: u.nerve, max_nerve: u.max_nerve, xp: u.xp, xp_needed: u.xp_needed,
    cash: u.cash, bank: u.bank || 0, rep: u.rep, level: u.level,
    strength: u.strength, defense: u.defense, speed: u.speed,
    stamina: u.stamina ?? 100,
    wins: u.wins, losses: u.losses,
    favors: u.favors || 0,
    job_key: u.job_key || null,
    in_hospital: u.in_hospital, hospital_until: u.hospital_until,
    in_jail: u.in_jail, jail_until: u.jail_until,
  };
}

async function saveUser(u) {
  // Always save BASE stats (before cell augments) so bonuses don't permanently stack
  const baseStrength = u._baseStrength  !== undefined ? u._baseStrength  + (u.strength  - (u._baseStrength  + (u._cellAugments?.strength  ||0))) : u.strength;
  const baseDefense  = u._baseDefense   !== undefined ? u._baseDefense   + (u.defense   - (u._baseDefense   + (u._cellAugments?.defense   ||0))) : u.defense;
  const baseSpeed    = u._baseSpeed     !== undefined ? u._baseSpeed     + (u.speed     - (u._baseSpeed     + (u._cellAugments?.speed     ||0))) : u.speed;
  const baseMaxHp    = u._baseMaxHp     !== undefined ? u._baseMaxHp     + (u.max_hp    - (u._baseMaxHp     + (u._cellAugments?.max_hp    ||0))) : u.max_hp;
  const baseMaxEn    = u._baseMaxEnergy !== undefined ? u._baseMaxEnergy + (u.max_energy- (u._baseMaxEnergy + (u._cellAugments?.max_energy ||0))) : u.max_energy;
  const baseMaxNv    = u._baseMaxNerve  !== undefined ? u._baseMaxNerve  + (u.max_nerve - (u._baseMaxNerve  + (u._cellAugments?.max_nerve  ||0))) : u.max_nerve;
  const baseStamina  = u._baseStamina   !== undefined ? u._baseStamina   + (u.stamina   - (u._baseStamina   + (u._cellAugments?.stamina   ||0))) : (u.stamina ?? 100);

  await run(`UPDATE users SET level=?,xp=?,xp_needed=?,hp=?,max_hp=?,energy=?,max_energy=?,
    nerve=?,max_nerve=?,stamina=?,strength=?,defense=?,speed=?,cash=?,bank=?,rep=?,
    wins=?,losses=?,gang_id=?,in_hospital=?,hospital_until=?,hospital_reason=?,
    in_jail=?,jail_until=?,jail_reason=?,cell_size=?,favors=?,blurb=?,job_key=?,job_prison_id=?,last_daily_pay=? WHERE id=?`,
    [u.level,u.xp,u.xp_needed,
     u.hp, baseMaxHp, u.energy, baseMaxEn,
     u.nerve, baseMaxNv, Math.max(0,Math.min(100,baseStamina)),
     baseStrength, baseDefense, baseSpeed,
     u.cash,u.bank||0,u.rep,u.wins,u.losses,u.gang_id||null,
     u.in_hospital,u.hospital_until||0,u.hospital_reason||null,
     u.in_jail,u.jail_until||0,u.jail_reason||null,u.cell_size||'8x12',
     u.favors||0,u.blurb||'',u.job_key||null,u.job_prison_id||null,u.last_daily_pay||0,
     u.id]);
}

async function renderPage(res, view, user, extra = {}) {
  const gang = user.gang_id ? await get('SELECT * FROM gangs WHERE id=?', [user.gang_id]) : null;
  const unreadMail = (await get('SELECT COUNT(*) as c FROM mail WHERE to_id=? AND read=0', [user.id]))?.c || 0;
  const unreadEvents = (await get('SELECT COUNT(*) as c FROM events WHERE user_id=? AND read=0', [user.id]))?.c || 0;
  const title = getTitle(user.rep);
  const xpPct  = Math.floor((user.xp / user.xp_needed) * 100);
  const hpPct  = Math.floor((user.hp / user.max_hp) * 100);
  const energyPct = Math.floor((user.energy / user.max_energy) * 100);
  const nervePct  = Math.floor((user.nerve / user.max_nerve) * 100);
  res.render(view, { user, gang, title, unreadMail, unreadEvents, xpPct, hpPct, energyPct, nervePct, PRISONS, JOBS, ...extra });
}

// ── HOME ──
router.get('/', requireAuth, (req, res) => res.redirect('/prison'));

// ── PRISON ──
router.get('/prison', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prison = PRISONS.find(p => p.id === user.prison_id) || PRISONS[0];
  await renderPage(res, 'prison', user, { prison });
});

// ── ACCOUNT ──
router.get('/account', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const recentAttacks = await all(`SELECT a.*,u.username as attacker_name,u2.username as defender_name
    FROM attacks a JOIN users u ON u.id=a.attacker_id JOIN users u2 ON u2.id=a.defender_id
    WHERE a.attacker_id=? OR a.defender_id=? ORDER BY a.created_at DESC LIMIT 10`, [user.id, user.id]);
  await renderPage(res, 'account', user, { recentAttacks });
});

// ── CELL ──
router.get('/cell', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  // Get placed amenities
  const placedRows = await all('SELECT * FROM cell_amenities WHERE user_id=? AND placed_tile IS NOT NULL', [user.id]);
  const unplacedRows = await all('SELECT * FROM cell_amenities WHERE user_id=? AND placed_tile IS NULL', [user.id]);
  // Build placed map: tile -> amenity
  const placedMap = {};
  let augments = { max_hp: 0, strength: 0, defense: 0, speed: 0, max_energy: 0, max_nerve: 0, stamina: 0 };
  placedRows.forEach(row => {
    const amenity = CELL_AMENITIES[row.item_key];
    if (amenity) {
      placedMap[row.placed_tile] = { ...amenity, key: row.item_key, db_id: row.id };
      Object.entries(amenity.effect).forEach(([stat, val]) => { if (augments[stat] !== undefined) augments[stat] += val; });
    }
  });
  // Cell grid size
  const [cols, rows_count] = (user.cell_size || '8x12').split('x').map(Number);
  const totalTiles = cols * rows_count;
  await renderPage(res, 'cell', user, { placedMap, unplacedRows, augments, totalTiles, cols, CELL_AMENITIES });
});

router.post('/cell/place', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { db_id, tile } = req.body;
  const amenity = await get('SELECT * FROM cell_amenities WHERE id=? AND user_id=?', [db_id, user.id]);
  if (!amenity) return res.json({ error: 'Item not found.' });
  // Check tile not already occupied
  const occupied = await get('SELECT id FROM cell_amenities WHERE user_id=? AND placed_tile=?', [user.id, tile]);
  if (occupied && occupied.id !== parseInt(db_id)) return res.json({ error: 'Tile already occupied.' });
  await run('UPDATE cell_amenities SET placed_tile=? WHERE id=?', [tile, db_id]);
  res.json({ ok: true });
});

router.post('/cell/remove', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { db_id } = req.body;
  await run('UPDATE cell_amenities SET placed_tile=NULL WHERE id=? AND user_id=?', [db_id, user.id]);
  res.json({ ok: true });
});

router.post('/cell/clear', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await run('UPDATE cell_amenities SET placed_tile=NULL WHERE user_id=?', [user.id]);
  res.json({ ok: true });
});

router.get('/cell-raids', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await renderPage(res, 'cell', user, {
    placedMap: {}, unplacedRows: [], augments: { max_hp:0, strength:0, defense:0, speed:0, max_energy:0, max_nerve:0, stamina:0 },
    totalTiles: 96, cols: 8, CELL_AMENITIES,
    raidsView: true
  });
});

// ── WARDEN OFFICE ──
router.get('/warden', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await renderPage(res, 'warden_office', user);
});

// ── WARDEN STEAL WEAPON CRIME ──
router.get('/warden/steal', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await renderPage(res, 'warden_steal', user);
});

router.post('/warden/steal', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (user.nerve < 20) return res.json({ error: 'Need 20 nerve to attempt this.' });
  if (user.in_jail || user.in_hospital) return res.json({ error: 'Can\'t steal while jailed/hospitalized.' });
  user.nerve -= 20;
  const catchChance = Math.max(10, 55 - Math.floor(user.speed / 50) * 5);
  if (Math.random() * 100 < catchChance) {
    // Caught
    user.in_jail = 1;
    user.jail_until = Math.floor(Date.now()/1000) + 180;
    user.jail_reason = 'Caught stealing from the Warden\'s gun case!';
    await saveUser(user);
    return res.json({ caught: true, msg: 'Busted! The guard tackled you. 3 minutes in isolation.' });
  }
  // Success - add a weapon to inventory
  const loot = ['shiv','blade','gun','sock_rock','knuckle_wraps'][Math.floor(Math.random()*5)];
  const cash = 500 + Math.floor(Math.random() * 1500);
  user.cash += cash;
  user.xp += 25;
  user.rep += 2;
  const existing = await get("SELECT id,quantity FROM inventory WHERE user_id=? AND item_key=? AND item_type='weapon'", [user.id, loot]);
  if (existing) await run("UPDATE inventory SET quantity=quantity+1 WHERE id=?", [existing.id]);
  else await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,'weapon',1)", [user.id, loot]);
  const lvlUp = await levelUpCheck(user, run);
  await saveUser(user);
  res.json({ success: true, msg: `Got away clean! Swiped a ${loot.replace(/_/g,' ')} + $${cash.toLocaleString()}.`, loot, levelUp: lvlUp });
});

// ── WARDEN AMENITIES SHOP (per-prison, costs REP, comes protected) ──
router.get('/warden-amenities', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prison = PRISONS.find(p => p.id === user.prison_id) || PRISONS[0];
  const ownedRows = await all('SELECT item_key, COUNT(*) as qty FROM cell_amenities WHERE user_id=? GROUP BY item_key', [user.id]);
  const ownedMap = {};
  ownedRows.forEach(o => ownedMap[o.item_key] = o.qty);
  // Build list of amenities available in this prison's warden shop
  const shopItems = (prison.warden_amenities || []).map(key => {
    const a = CELL_AMENITIES[key];
    if (!a) return null;
    // Add rep_cost if not set (default based on price tier)
    const rep = a.rep_cost || Math.ceil((a.price || 500) / 50);
    return { key, ...a, rep_cost: rep };
  }).filter(Boolean);
  await renderPage(res, 'warden_amenities', user, { shopItems, ownedMap, prison });
});

router.post('/warden-amenities/buy', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { item_key } = req.body;
  const prison = PRISONS.find(p => p.id === user.prison_id) || PRISONS[0];
  if (!(prison.warden_amenities || []).includes(item_key)) return res.json({ error: 'Not available in your prison.' });
  const amenity = CELL_AMENITIES[item_key];
  if (!amenity) return res.json({ error: 'Item not found.' });
  const repCost = amenity.rep_cost || Math.ceil((amenity.price || 500) / 50);
  if (user.rep < repCost) return res.json({ error: `Need ${repCost} Rep. You have ${user.rep}.` });
  user.rep -= repCost;
  // Insert as protected (gold outline in cell)
  await run('INSERT INTO cell_amenities (user_id, item_key, protected) VALUES (?,?,1)', [user.id, item_key]);
  await saveUser(user);
  res.json({ msg: `Purchased ${amenity.name}! It's protected — no one can raid it. Go to My Cell to place it.`, user: statBlock(user) });
});

// ── WARDEN REP PURCHASE ──
router.post('/warden/buy-rep', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { amount } = req.body;
  const qty = Math.min(parseInt(amount) || 1, 100);
  const cost = qty * 1000; // $1000 per rep point
  if (user.cash < cost) return res.json({ error: `Need $${cost.toLocaleString()}.` });
  user.cash -= cost;
  user.rep += qty;
  await saveUser(user);
  res.json({ msg: `Bought ${qty} Rep for $${cost.toLocaleString()}.`, user: statBlock(user) });
});



// ── GYM ──
router.get('/gym', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  // Get last 15 training history entries
  const history = await all(`SELECT * FROM training_history WHERE user_id=? ORDER BY trained_at ASC LIMIT 15`, [user.id]).catch(()=>[]);
  await renderPage(res, 'gym', user, { history });
});

router.post('/gym/train', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { stat, energy_amount } = req.body;
  const amount = Math.min(parseInt(energy_amount) || 1, user.energy);
  if (amount < 1) return res.json({ error: 'Not enough energy.' });
  if (!['strength','defense','speed'].includes(stat)) return res.json({ error: 'Invalid stat.' });
  const currentStamina = user.stamina ?? 100;
  if (currentStamina < 5) return res.json({ error: 'Too exhausted to train! Your stamina is too low. Rest or use items to recover.' });
  // Each energy point = 2% stamina drain, capped at remaining stamina
  const staminaDrain = Math.min(currentStamina - 1, amount * 2);
  user.energy -= amount;
  user.stamina = Math.max(0, currentStamina - staminaDrain);
  const gain = amount * 2;
  user[stat] += gain;
  user.xp += amount * 15;
  const lvlUp = await levelUpCheck(user, run);
  await saveUser(user);
  await run(`INSERT INTO training_history (user_id, strength, defense, speed) VALUES (?,?,?,?)`,
    [user.id, user.strength, user.defense, user.speed]);
  await run(`DELETE FROM training_history WHERE user_id=? AND id NOT IN (SELECT id FROM training_history WHERE user_id=? ORDER BY trained_at DESC LIMIT 20)`,
    [user.id, user.id]);
  res.json({ msg: `Trained ${stat}! +${gain} ${stat.toUpperCase()} (used ${amount} energy, -${staminaDrain}% stamina)`, user: statBlock(user), levelUp: lvlUp, gain, stat });
});

// ── YARD ──
// ── YARD — moveable player dot + hover zones ──
async function loadYardData(userId) {
  const posRow = await get('SELECT x,y FROM yard_positions WHERE user_id=?', [userId]).catch(()=>null);
  const pos    = posRow ? { x: parseFloat(posRow.x)||50, y: parseFloat(posRow.y)||50 } : { x: 50, y: 75 };
  const others = await all(
    `SELECT u.id,u.username,u.level,p.x as px,p.y as py
     FROM users u JOIN yard_positions p ON p.user_id=u.id
     WHERE u.id!=? AND u.last_active > ?
     ORDER BY u.last_active DESC LIMIT 20`,
    [userId, Math.floor(Date.now()/1000)-300]
  ).catch(()=>[]);
  const onlineCount = (await get(`SELECT COUNT(*) as c FROM users WHERE last_active > ?`,
    [Math.floor(Date.now()/1000)-300]).catch(()=>({c:1})))?.c || 1;
  return { pos, others: others.map(p=>({...p, px:parseFloat(p.px)||50, py:parseFloat(p.py)||50})), onlineCount };
}

router.get('/prison/yard', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const extra = await loadYardData(user.id);
  await renderPage(res, 'yard', user, extra);
});

router.get('/yard', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const extra = await loadYardData(user.id);
  await renderPage(res, 'yard', user, extra);
});

router.post('/yard/move', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  let { px, py } = req.body;
  px = Math.min(96, Math.max(4, parseFloat(px)||50));
  py = Math.min(96, Math.max(4, parseFloat(py)||50));
  await run('INSERT OR REPLACE INTO yard_positions (user_id,x,y) VALUES (?,?,?)', [user.id, px, py]).catch(()=>{});
  await run('UPDATE users SET last_active=? WHERE id=?', [Math.floor(Date.now()/1000), user.id]);
  const others = await all(
    `SELECT u.id,u.username,u.level,p.x as px,p.y as py
     FROM users u JOIN yard_positions p ON p.user_id=u.id
     WHERE u.id!=? AND u.last_active > ?
     ORDER BY u.last_active DESC LIMIT 20`,
    [user.id, Math.floor(Date.now()/1000)-300]
  ).catch(()=>[]);
  res.json({ ok:true, others: others.map(p=>({...p, px:parseFloat(p.px)||50, py:parseFloat(p.py)||50})) });
});

router.post('/yard/action', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { action } = req.body;
  let msg = '';

  if (action === 'search') {
    // Search the yard — find random cash/items
    if (user.energy < 1) return res.json({ error: 'Not enough energy to search.' });
    user.energy--;
    const roll = Math.random();
    if (roll < 0.08) {
      // Lucky — find a weapon
      const loot = ['shiv','blade','sock_rock'][Math.floor(Math.random()*3)];
      const ex = await get("SELECT id,quantity FROM inventory WHERE user_id=? AND item_key=? AND item_type='weapon'", [user.id, loot]);
      if (ex) await run("UPDATE inventory SET quantity=quantity+1 WHERE id=?", [ex.id]);
      else await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'"+loot+"','weapon',1)", [user.id]);
      msg = `You found a ${loot.replace(/_/g,' ')} stashed under a rock! Check your inventory.`;
    } else if (roll < 0.35) {
      const cash = 50 + Math.floor(Math.random() * 400);
      user.cash += cash;
      msg = `Found $${cash} hidden behind the bleachers!`;
    } else if (roll < 0.55) {
      user.xp += 5;
      msg = `Searched the yard... found nothing but gravel. +5 XP for trying.`;
    } else {
      msg = `You searched but found nothing. The guards are watching.`;
    }
  } else if (action === 'gamble') {
    if (user.cash < 50) return res.json({ error: 'Need at least $50 to gamble.' });
    if (user.energy < 1) return res.json({ error: 'Need 1 energy.' });
    user.energy--;
    user.cash -= 50;
    const win = Math.random() > 0.48;
    if (win) {
      const prize = 60 + Math.floor(Math.random() * 150);
      user.cash += prize;
      msg = `Rolled high! Won $${prize} on the dice game.`;
    } else {
      msg = `Craps. Lost your $50 bet. Better luck next time.`;
    }
  } else if (action === 'basketball') {
    if (user.energy < 2) return res.json({ error: 'Need 2 energy.' });
    user.energy -= 2;
    const win = Math.random() > 0.45;
    if (win) {
      const rep = 1 + Math.floor(Math.random() * 3);
      user.rep += rep;
      user.xp  += 20;
      msg = `Balled out! Gained ${rep} Rep and 20 XP.`;
    } else {
      user.xp += 8;
      msg = `Good game but you lost. +8 XP.`;
    }
  } else if (action === 'laps') {
    if (user.energy < 2) return res.json({ error: 'Need 2 energy to run laps.' });
    user.energy -= 2;
    user.speed  = (user.speed||0) + 1;
    user.xp     += 12;
    msg = `Ran laps around the yard. SPD +1, +12 XP.`;
  } else if (action === 'lift') {
    if (user.energy < 2) return res.json({ error: 'Need 2 energy to lift.' });
    user.energy   -= 2;
    user.strength  = (user.strength||0) + 1;
    user.xp        += 12;
    msg = `Quick set at the outdoor weights. STR +1, +12 XP.`;
  } else {
    return res.json({ error: 'Unknown action.' });
  }

  const lvlUp = await levelUpCheck(user, run);
  await saveUser(user);
  res.json({ msg, user: statBlock(user), levelUp: lvlUp });
});




// ── CRIMES ──
const CRIME_ZONES = {
  south_dakota: {
    label: 'South Dakota Crimes',
    prison_ids: [1],
    crimes: [
      { key:'pickpocket',    name:'Pickpocket',       desc:'Lift wallets from distracted guards.',          nerve:2,  stamina:3,  cash:[800,2000],   catch_chance:20, xp:5,  rep:1 },
      { key:'steal_food',    name:'Steal Food',       desc:'Swipe extra rations from the kitchen.',         nerve:3,  stamina:4,  cash:[1000,3000],  catch_chance:25, xp:8,  rep:1 },
      { key:'run_errands',   name:'Run Errands',      desc:'Deliver contraband between blocks.',            nerve:4,  stamina:5,  cash:[1500,4000],  catch_chance:30, xp:10, rep:2 },
      { key:'intimidation',  name:'Intimidation',     desc:'Shake down a weaker inmate for cash.',          nerve:6,  stamina:6,  cash:[2000,5000],  catch_chance:35, xp:15, rep:3 },
    ]
  },
  rikers: {
    label: 'Rikers Island Crimes',
    prison_ids: [2],
    crimes: [
      { key:'card_shark',    name:'Card Shark',       desc:'Hustle inmates at the card table.',             nerve:3,  stamina:4,  cash:[1500,4000],  catch_chance:22, xp:10, rep:2 },
      { key:'smuggle_phone', name:'Smuggle Phone',    desc:'Sneak in a contraband cell phone.',             nerve:5,  stamina:5,  cash:[2500,5500],  catch_chance:28, xp:15, rep:3 },
      { key:'bribery',       name:'Bribery',          desc:'Pay off a guard for special privileges.',       nerve:7,  stamina:6,  cash:[3000,6000],  catch_chance:32, xp:20, rep:4 },
      { key:'gang_tax',      name:'Collect Gang Tax', desc:'Demand tribute from unaffiliated inmates.',     nerve:8,  stamina:7,  cash:[4000,7000],  catch_chance:38, xp:25, rep:5 },
    ]
  },
  san_quentin: {
    label: 'San Quentin Crimes',
    prison_ids: [3],
    crimes: [
      { key:'forge_docs',    name:'Forge Documents',  desc:'Fake work release papers for profit.',          nerve:5,  stamina:5,  cash:[3000,6000],  catch_chance:25, xp:20, rep:4 },
      { key:'drug_trade',    name:'Drug Trade',       desc:'Move product through the yard.',                nerve:8,  stamina:7,  cash:[5000,9000],  catch_chance:35, xp:30, rep:6 },
      { key:'extortion',     name:'Extortion',        desc:'Run a protection racket on new inmates.',       nerve:10, stamina:8,  cash:[6000,10000], catch_chance:40, xp:35, rep:7 },
      { key:'heist_kitchen', name:'Kitchen Heist',    desc:'Rob the commissary supply room blind.',         nerve:12, stamina:9,  cash:[7000,12000], catch_chance:45, xp:40, rep:8 },
    ]
  },
  alcatraz: {
    label: 'Alcatraz Crimes',
    prison_ids: [4],
    crimes: [
      { key:'contraband_ring', name:'Contraband Ring', desc:'Manage a full contraband supply chain.',       nerve:8,  stamina:8,  cash:[6000,12000], catch_chance:28, xp:40, rep:8  },
      { key:'guard_bribe2',    name:'Guard Network',   desc:'Bribe multiple guards for a safe corridor.',   nerve:12, stamina:9,  cash:[8000,14000], catch_chance:35, xp:50, rep:10 },
      { key:'bank_intel',      name:'Bank Intel',      desc:'Sell financial intel to outside contacts.',    nerve:14, stamina:10, cash:[10000,16000],catch_chance:40, xp:55, rep:12 },
      { key:'murder_contract', name:'Contract Hit',    desc:'Accept a hit contract from a crime boss.',     nerve:18, stamina:12, cash:[12000,18000],catch_chance:48, xp:65, rep:15 },
    ]
  },
  the_vault: {
    label: 'The Vault Crimes',
    prison_ids: [5],
    crimes: [
      { key:'crypto_fraud',  name:'Crypto Fraud',     desc:'Run crypto scams from a smuggled laptop.',     nerve:10, stamina:10, cash:[8000,15000], catch_chance:25, xp:60, rep:12 },
      { key:'arms_deal',     name:'Arms Deal',        desc:'Broker a weapons deal between gangs.',         nerve:14, stamina:11, cash:[12000,18000], catch_chance:32, xp:70, rep:15 },
      { key:'prison_riot',   name:'Incite Riot',      desc:'Orchestrate chaos to rob the infirmary.',      nerve:18, stamina:13, cash:[15000,20000], catch_chance:42, xp:80, rep:18 },
      { key:'warden_heist',  name:'Warden\'s Safe',   desc:'Crack the warden\'s personal safe.',           nerve:22, stamina:15, cash:[16000,22000], catch_chance:50, xp:100,rep:25 },
    ]
  }
};

router.get('/crimes', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prisonId = user.prison_id || 1;
  // Find zone for this prison
  const zone = Object.values(CRIME_ZONES).find(z => z.prison_ids.includes(prisonId)) || CRIME_ZONES.south_dakota;
  await renderPage(res, 'crimes', user, { zone, CRIME_ZONES });
});

router.post('/crimes/commit', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { crime_key } = req.body;
  const now = Math.floor(Date.now() / 1000);

  // Find the crime across all zones
  let crime = null;
  for (const zone of Object.values(CRIME_ZONES)) {
    crime = zone.crimes.find(c => c.key === crime_key);
    if (crime) break;
  }
  if (!crime) return res.json({ error: 'Unknown crime.' });

  if (user.in_jail && now < user.jail_until) return res.json({ error: 'You are in isolation! Serve your time or bribe out.' });
  if (user.in_hospital && now < user.hospital_until) return res.json({ error: 'You\'re in the infirmary!' });
  if (user.nerve < crime.nerve) return res.json({ error: `Need ${crime.nerve} nerve to attempt this. You have ${user.nerve}.` });
  if ((user.stamina || 100) < crime.stamina) return res.json({ error: `Need ${crime.stamina}% stamina. You have ${user.stamina||100}%.` });

  // Speed reduces catch chance (every 50 speed = -5% catch)
  const speedBonus = Math.floor((user.speed || 0) / 50) * 5;
  const effectiveCatch = Math.max(5, crime.catch_chance - speedBonus);
  const caught = Math.random() * 100 < effectiveCatch;

  user.nerve -= crime.nerve;
  user.stamina = Math.max(0, (user.stamina || 100) - crime.stamina);

  if (caught) {
    // Send to isolation — jail time scales with crime nerve cost
    const jailSeconds = 60 + crime.nerve * 30;
    user.in_jail = 1;
    user.jail_until = now + jailSeconds;
    user.jail_reason = `Caught committing: ${crime.name}`;
    await saveUser(user);
    await addEvent(user.id, 'crime', `Caught! Sent to isolation for ${Math.ceil(jailSeconds/60)} minutes.`);
    return res.json({ caught: true, msg: `BUSTED! You were caught ${crime.name.toLowerCase()}. Sent to isolation for ${Math.ceil(jailSeconds/60)} minute${Math.ceil(jailSeconds/60)!==1?'s':''}.`, jailSeconds, user: statBlock(user) });
  }

  // Success — random cash in range
  const cashGain = Math.floor(Math.random() * (crime.cash[1] - crime.cash[0])) + crime.cash[0];
  user.cash += cashGain;
  user.rep  += crime.rep || 1;
  user.xp   += crime.xp  || 10;
  await saveUser(user);
  const lvlUp = await levelUpCheck(user, run);
  await addEvent(user.id, 'crime', `Committed ${crime.name}. +$${cashGain.toLocaleString()}`);
  res.json({ caught: false, msg: `Success! ${crime.name} netted you $${cashGain.toLocaleString()}.`, cashGain, user: statBlock(user), levelUp: lvlUp });
});

// ── MISSIONS (kept for legacy, redirects to crimes) ──
router.get('/missions', requireAuth, async (req, res) => {
  res.redirect('/crimes');
});


// ── BATTLES ──
router.get('/battles', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const now = Math.floor(Date.now()/1000);
  const targets = await all(
    `SELECT id,username,level,hp,max_hp,strength,defense,speed,rep,gang_id,last_active,in_hospital
     FROM users WHERE id!=? AND prison_id=? ORDER BY last_active DESC LIMIT 40`,
    [user.id, user.prison_id]
  );
  const history = await all(
    `SELECT a.*,u.username as opp_name FROM attacks a
     JOIN users u ON u.id=CASE WHEN a.attacker_id=? THEN a.defender_id ELSE a.attacker_id END
     WHERE a.attacker_id=? OR a.defender_id=? ORDER BY a.created_at DESC LIMIT 15`,
    [user.id, user.id, user.id]
  );
  // Load per-target cooldowns so view can show "wait X min"
  const cds = await all('SELECT defender_id, last_attack FROM attack_cooldowns WHERE attacker_id=?', [user.id]).catch(()=>[]);
  const cdMap = {};
  cds.forEach(c => { cdMap[c.defender_id] = c.last_attack; });
  await renderPage(res, 'battles', user, { targets, history, now, cdMap });
});

router.post('/battles/attack', requireAuth, async (req, res) => {
  const attacker = await getUser(req.session.userId);
  const { target_id } = req.body;
  const tid = parseInt(target_id);
  if (attacker.energy < 5) return res.json({ error: 'Need 5 energy to fight.' });
  if (attacker.in_hospital || attacker.in_jail) return res.json({ error: "You can't fight from here." });

  // 10-minute per-target cooldown
  const now = Math.floor(Date.now()/1000);
  const cd  = await get('SELECT last_attack FROM attack_cooldowns WHERE attacker_id=? AND defender_id=?', [attacker.id, tid]).catch(()=>null);
  if (cd && now - cd.last_attack < 600) {
    const wait = Math.ceil((600 - (now - cd.last_attack)) / 60);
    return res.json({ error: `Wait ${wait} more minute${wait!==1?'s':''} before attacking this person again.` });
  }

  const defender = await getUser(tid);
  if (!defender || defender.id === attacker.id) return res.json({ error: 'Invalid target.' });
  if (defender.in_hospital) return res.json({ error: 'Target is in hospital.' });
  if (defender.prison_id !== attacker.prison_id) return res.json({ error: 'Target is in a different prison.' });

  attacker.energy -= 5;
  await run('INSERT OR REPLACE INTO attack_cooldowns VALUES (?,?,?)', [attacker.id, tid, now]);

  // Stamina multiplier (stamina as % of 100 affects effectiveness)
  const aSta = Math.max(0.5, (attacker.stamina || 100) / 100);
  const dSta = Math.max(0.5, (defender.stamina  || 100) / 100);

  // Base combat stats with stamina weighting
  const aBaseStr = attacker.strength * aSta;
  const dBaseDef = defender.defense  * dSta;
  const dBaseStr = defender.strength * dSta;
  const aBaseDef = attacker.defense  * aSta;

  // Speed determines who attacks first
  const aFirst = attacker.speed >= defender.speed;
  let aHp = attacker.hp, dHp = defender.hp;
  const log = [];
  let aDmgTotal = 0, dDmgTotal = 0;
  let aStamLost = 0, dStamLost = 0;
  let round = 1;

  function doHit(aStr, aDef, aName, dName) {
    // STR randomized 90-110%, DEF 80-105%
    const strMult = 0.90 + Math.random() * 0.20;
    const defMult = 0.80 + Math.random() * 0.25;
    const dmg = Math.max(1, Math.floor(aStr * strMult - aDef * defMult));
    return { dmg, strMult, defMult };
  }

  while (aHp > 0 && dHp > 0 && round <= 15) {
    if (aFirst) {
      const h = doHit(aBaseStr, dBaseDef, attacker.username, defender.username);
      dHp -= h.dmg; aDmgTotal += h.dmg;
      aStamLost += 2;
      log.push(`R${round}: ${attacker.username} hits ${defender.username} for ${h.dmg} damage.`);
      if (dHp <= 0) break;
      const h2 = doHit(dBaseStr, aBaseDef, defender.username, attacker.username);
      aHp -= h2.dmg; dDmgTotal += h2.dmg;
      dStamLost += 2;
      log.push(`R${round}: ${defender.username} hits back for ${h2.dmg} damage.`);
    } else {
      const h = doHit(dBaseStr, aBaseDef, defender.username, attacker.username);
      aHp -= h.dmg; dDmgTotal += h.dmg;
      dStamLost += 2;
      log.push(`R${round}: ${defender.username} strikes first for ${h.dmg} damage.`);
      if (aHp <= 0) break;
      const h2 = doHit(aBaseStr, dBaseDef, attacker.username, defender.username);
      dHp -= h2.dmg; aDmgTotal += h2.dmg;
      aStamLost += 2;
      log.push(`R${round}: ${attacker.username} returns ${h2.dmg} damage.`);
    }
    round++;
  }

  const won = dHp <= 0;

  // Post-battle HP restore for both, stamina partial restore
  attacker.hp = Math.max(1, Math.min(attacker.max_hp, Math.floor(attacker.max_hp * 0.3)));
  defender.hp = Math.max(1, Math.min(defender.max_hp, Math.floor(defender.max_hp * 0.3)));

  // Stamina: winner +20%, loser +10%
  const aTotalStam = attacker.stamina || 100;
  const dTotalStam = defender.stamina || 100;
  attacker.stamina = Math.min(100, aTotalStam - aStamLost + (won ? 20 : 10));
  defender.stamina = Math.min(100, dTotalStam - dStamLost + (won ? 10 : 20));

  let cashStolen = 0, repGained = 0;
  if (won) {
    cashStolen = Math.min(defender.cash, Math.max(50, Math.floor(defender.cash * 0.12) + rnd(100)));
    // XP accounts for level difference
    const lvlDiff = defender.level - attacker.level;
    const xpGain  = Math.max(15, 20 + defender.level * 5 + lvlDiff * 10);
    repGained = 3 + Math.floor(defender.level / 3);
    attacker.wins++; attacker.cash += cashStolen; attacker.rep += repGained; attacker.xp += xpGain;
    const hospTime = 60 + defender.level * 20;
    await run('UPDATE users SET hp=?,stamina=?,in_hospital=1,hospital_until=?,hospital_reason=?,cash=MAX(0,cash-?),losses=losses+1 WHERE id=?',
      [defender.hp, defender.stamina, now + hospTime, `Beaten down by ${attacker.username}`, cashStolen, defender.id]);
    await addEvent(defender.id, 'attacked', `${attacker.username} defeated you in battle! Lost $${cashStolen}. You're in hospital.`);
    log.push(`--- ${attacker.username} wins! Stole $${cashStolen}. ${defender.username} sent to hospital. ---`);
  } else {
    attacker.losses++;
    attacker.xp += 5;
    // If attacker is also the loser, hospital time up to 3x longer
    const hospTime = 180 + rnd(360); // up to 3x longer for attacking loser
    attacker.in_hospital = 1;
    attacker.hospital_until = now + hospTime;
    attacker.hospital_reason = `Lost a fight against ${defender.username}`;
    await run('UPDATE users SET hp=?,stamina=? WHERE id=?', [defender.hp, defender.stamina, defender.id]);
    await addEvent(defender.id, 'attacked', `${attacker.username} attacked you but lost the fight!`);
    log.push(`--- ${defender.username} wins! ${attacker.username} sent to hospital. ---`);
  }

  const lvlUp = await levelUpCheck(attacker, run);
  await saveUser(attacker);
  await run('INSERT INTO attacks (attacker_id,defender_id,attacker_won,damage_dealt,damage_taken,cash_stolen,rep_gained,log) VALUES (?,?,?,?,?,?,?,?)',
    [attacker.id, tid, won?1:0, aDmgTotal, dDmgTotal, cashStolen, repGained, log.join('\n')]);
  res.json({ won, log, cashStolen, repGained, user: statBlock(attacker), levelUp: lvlUp,
    msg: won ? `Victory! +$${cashStolen}, +${repGained} Rep` : `Defeat. You're in hospital.` });
});

// ── INFIRMARY ──
router.get('/prison/infirmary', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const now = Math.floor(Date.now() / 1000);
  // Get all players currently in hospital
  const icuList = await all(`SELECT id,username,level,in_hospital,hospital_until,hospital_reason,gang_id FROM users WHERE in_hospital=1 ORDER BY hospital_until ASC`);
  const hospitalUntil = user.hospital_until || 0;
  const timeLeft = Math.max(0, hospitalUntil - now);
  // Bribe cost = $500 base + $100 per minute remaining
  const bribeCost = user.in_hospital ? Math.max(500, Math.ceil(timeLeft / 60) * 1000) : 0;
  await renderPage(res, 'infirmary', user, { icuList, timeLeft, bribeCost, now });
});

router.post('/infirmary/heal', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const cost = Math.ceil((user.max_hp - user.hp) * 2);
  if (cost <= 0) return res.json({ error: 'Already full HP.' });
  if (user.cash < cost) return res.json({ error: `Need $${cost} to heal.` });
  user.cash -= cost; user.hp = user.max_hp;
  await saveUser(user);
  res.json({ msg: `Healed to full for $${cost}.`, user: statBlock(user) });
});

router.post('/infirmary/bribe', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user.in_hospital) return res.json({ error: 'You are not in hospital.' });
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = Math.max(0, (user.hospital_until || 0) - now);
  const bribeCost = Math.max(500, Math.ceil(timeLeft / 60) * 1000);
  if (user.cash < bribeCost) return res.json({ error: `Need $${bribeCost.toLocaleString()} to bribe your way out.` });
  user.cash -= bribeCost;
  user.in_hospital = 0;
  user.hospital_until = 0;
  user.hp = Math.max(user.hp, Math.ceil(user.max_hp * 0.3)); // restore to at least 30%
  await saveUser(user);
  res.json({ msg: `Bribed your way out for $${bribeCost.toLocaleString()}! You stumble back to your cell.`, user: statBlock(user) });
});


// ── MARKETPLACE ──
// Market hall landing page
router.get('/market', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await renderPage(res, 'market_hall', user, {});
});

router.get('/prison/marketplace', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prisonId = user.prison_id || 1;
  const prison = PRISONS.find(p => p.id === prisonId) || PRISONS[0];
  const maxTier = Math.max(...prison.item_tiers);
  const filterByTier = (obj, tiers) => Object.entries(obj).filter(([k,v]) => tiers.includes(v.tier||1));
  const weaponItems = filterByTier(WEAPONS, prison.weapon_tiers);
  const armorItems  = filterByTier(ARMOR,   prison.armor_tiers);
  const gearItems   = filterByTier(GEAR,    prison.gear_tiers);
  const basicItems  = Object.entries(ITEMS);
  const drugItems   = Object.entries(DRUGS).filter(([k,v]) => (v.tier||1) <= maxTier);
  const activeTab   = req.query.tab || 'weapons';
  await renderPage(res, 'marketplace', user, { weaponItems, armorItems, gearItems, basicItems, drugItems, prison, maxTier, activeTab });
});

router.post('/marketplace/buy', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { item_key, item_type } = req.body;
  const allCatalog = { ...ITEMS, ...WEAPONS, ...ARMOR, ...GEAR, ...DRUGS };
  const item = allCatalog[item_key];
  if (!item) return res.json({ error: 'Item not found.' });
  if (user.cash < item.price) return res.json({ error: `Need $${item.price.toLocaleString()} to buy this.` });
  user.cash -= item.price;

  // ALL items go straight to inventory — nothing is consumed on purchase
  const type = item_type || (WEAPONS[item_key]?'weapon':ARMOR[item_key]?'armor':GEAR[item_key]?'gear':DRUGS[item_key]?'drug':'item');
  const existing = await get("SELECT id,quantity FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, item_key, type]);
  if (existing) {
    await run("UPDATE inventory SET quantity=quantity+1 WHERE id=?", [existing.id]);
  } else {
    await run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,1)', [user.id, item_key, type]);
  }
  await saveUser(user);
  res.json({ msg: `Bought ${item.name}! Check your Inventory to use it.`, user: statBlock(user) });
});

// ── BANK ──
router.get('/bank', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await renderPage(res, 'bank', user);
});
router.post('/bank/deposit', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const amount = parseInt(req.body.amount)||0;
  if (amount <= 0 || amount > user.cash) return res.json({ error: 'Invalid amount.' });
  user.cash -= amount; user.bank = (user.bank||0) + amount;
  await saveUser(user); res.json({ msg: `Deposited $${amount}.`, user: statBlock(user) });
});
router.post('/bank/withdraw', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const amount = parseInt(req.body.amount)||0;
  if (amount <= 0 || amount > (user.bank||0)) return res.json({ error: 'Invalid amount.' });
  user.cash += amount; user.bank -= amount;
  await saveUser(user); res.json({ msg: `Withdrew $${amount}.`, user: statBlock(user) });
});

// ── SHOUTBOX ──
router.get('/shoutbox', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const messages = await all(`SELECT s.*,u.level FROM shoutbox s JOIN users u ON u.id=s.user_id WHERE s.gang_only=0 ORDER BY s.created_at DESC LIMIT 50`);
  await renderPage(res, 'shoutbox', user, { messages: messages.reverse() });
});

// ── INMATES ──
router.get('/inmates', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const inmates = await all('SELECT id,username,level,rep,wins,losses,gang_id,last_active,in_hospital FROM users ORDER BY rep DESC LIMIT 50');
  await renderPage(res, 'inmates', user, { inmates });
});

// ── PROFILE ──
router.get('/profile/:username', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const profile = await get('SELECT * FROM users WHERE username=?', [req.params.username]);
  if (!profile) return res.redirect('/inmates');
  const gang = profile.gang_id ? await get('SELECT * FROM gangs WHERE id=?', [profile.gang_id]) : null;
  const recentFights = await all(`SELECT a.*,u.username as opp_name FROM attacks a JOIN users u ON u.id=CASE WHEN a.attacker_id=? THEN a.defender_id ELSE a.attacker_id END WHERE a.attacker_id=? OR a.defender_id=? ORDER BY a.created_at DESC LIMIT 8`, [profile.id,profile.id,profile.id]);
  await renderPage(res, 'profile', user, { profile, profileGang: gang, recentFights, profileTitle: getTitle(profile.rep), PRISONS });
});

router.post('/profile/update-blurb', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const blurb = (req.body.blurb||'').slice(0,100);
  await run('UPDATE users SET blurb=? WHERE id=?', [blurb, user.id]);
  res.json({ msg: 'Blurb saved.' });
});

// ── GANGS ──
router.get('/gangs', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const gangs = await all(`SELECT g.*,COUNT(gm.user_id) as member_count,u.username as leader_name FROM gangs g JOIN users u ON u.id=g.leader_id LEFT JOIN gang_members gm ON gm.gang_id=g.id GROUP BY g.id ORDER BY g.bank DESC`);
  await renderPage(res, 'gangs', user, { gangs });
});
router.get('/my-gang', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user.gang_id) return renderPage(res, 'gang_create', user);
  const gang = await get('SELECT * FROM gangs WHERE id=?', [user.gang_id]);
  const members = await all(`SELECT u.username,u.level,u.rep,u.wins,gm.rank FROM gang_members gm JOIN users u ON u.id=gm.user_id WHERE gm.gang_id=? ORDER BY u.rep DESC`, [user.gang_id]);
  await renderPage(res, 'my_gang', user, { gang, members });
});
router.post('/gang/create', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (user.gang_id) return res.json({ error: 'Already in a gang.' });
  const { name, tag, description } = req.body;
  if (!name||!tag) return res.json({ error: 'Name and tag required.' });
  if (user.cash < 500) return res.json({ error: 'Need $500.' });
  try {
    const result = await run('INSERT INTO gangs (name,tag,description,leader_id) VALUES (?,?,?,?)', [name.trim(), tag.trim().toUpperCase(), description||'', user.id]);
    await run('INSERT INTO gang_members (gang_id,user_id,rank) VALUES (?,?,?)', [result.lastID, user.id, 'Leader']);
    user.cash -= 500; user.gang_id = result.lastID;
    await saveUser(user);
    res.json({ msg: `Gang "${name}" created!`, redirect: '/my-gang' });
  } catch(e) { res.json({ error: 'Name or tag already taken.' }); }
});
router.post('/gang/invite', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user.gang_id) return res.json({ error: 'Not in a gang.' });
  const gang = await get('SELECT * FROM gangs WHERE id=?', [user.gang_id]);
  if (gang.leader_id !== user.id) return res.json({ error: 'Only leader can invite.' });
  const target = await get('SELECT * FROM users WHERE username=?', [req.body.username]);
  if (!target) return res.json({ error: 'User not found.' });
  if (target.gang_id) return res.json({ error: 'Already in a gang.' });
  await addEvent(target.id, 'gang_invite', `${user.username} invited you to join ${gang.name} [${gang.tag}]. Go to /gang-invites to accept.`);
  res.json({ msg: `Invite sent to ${target.username}.` });
});
router.get('/gang-invites', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const invites = await all("SELECT * FROM events WHERE user_id=? AND type='gang_invite' AND read=0", [user.id]);
  await renderPage(res, 'gang_invites', user, { invites });
});
router.post('/gang/join', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (user.gang_id) return res.json({ error: 'Already in a gang.' });
  const { event_id } = req.body;
  const evt = await get("SELECT * FROM events WHERE id=? AND user_id=? AND type='gang_invite'", [event_id, user.id]);
  if (!evt) return res.json({ error: 'Invite not found.' });
  const match = evt.message.match(/join (.+?) \[/);
  if (!match) return res.json({ error: 'Could not parse invite.' });
  const gang = await get('SELECT * FROM gangs WHERE name=?', [match[1]]);
  if (!gang) return res.json({ error: 'Gang no longer exists.' });
  await run('INSERT INTO gang_members (gang_id,user_id) VALUES (?,?)', [gang.id, user.id]);
  await run('UPDATE users SET gang_id=? WHERE id=?', [gang.id, user.id]);
  await run('UPDATE events SET read=1 WHERE id=?', [event_id]);
  res.json({ msg: `Joined ${gang.name}!`, redirect: '/my-gang' });
});
router.post('/gang/leave', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user.gang_id) return res.json({ error: 'Not in a gang.' });
  const gang = await get('SELECT * FROM gangs WHERE id=?', [user.gang_id]);
  if (gang.leader_id === user.id) return res.json({ error: 'Leader cannot leave.' });
  await run('DELETE FROM gang_members WHERE user_id=?', [user.id]);
  await run('UPDATE users SET gang_id=NULL WHERE id=?', [user.id]);
  res.json({ msg: 'Left the gang.', redirect: '/gangs' });
});

// ── MAIL ──
router.get('/mail', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const inbox = await all(`SELECT m.*,u.username as from_name FROM mail m JOIN users u ON u.id=m.from_id WHERE m.to_id=? ORDER BY m.created_at DESC LIMIT 20`, [user.id]);
  await run('UPDATE mail SET read=1 WHERE to_id=?', [user.id]);
  await renderPage(res, 'mail', user, { inbox });
});
router.post('/mail/send', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { to, subject, body } = req.body;
  if (!to||!body) return res.json({ error: 'Fill in all fields.' });
  const target = await get('SELECT id FROM users WHERE username=?', [to]);
  if (!target) return res.json({ error: 'User not found.' });
  await run('INSERT INTO mail (from_id,to_id,subject,body) VALUES (?,?,?,?)', [user.id, target.id, subject||'No Subject', body]);
  await addEvent(target.id, 'mail', `New mail from ${user.username}: "${subject||'No Subject'}"`);
  res.json({ msg: `Mail sent to ${to}.` });
});

// ── EVENTS ──
router.get('/events', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const events = await all('SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 30', [user.id]);
  await run('UPDATE events SET read=1 WHERE user_id=?', [user.id]);
  await renderPage(res, 'events', user, { events });
});

// ── MOST WANTED ──
router.get('/most-wanted', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const wanted = await all('SELECT id,username,level,rep,wins,losses FROM users ORDER BY rep DESC LIMIT 20');
  await renderPage(res, 'most_wanted', user, { wanted });
});

// ── HITLIST ──
router.get('/hitlist', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const hits = await all(`SELECT h.*,u.username as target_name,u2.username as poster_name FROM hitlist h JOIN users u ON u.id=h.target_id JOIN users u2 ON u2.id=h.poster_id WHERE h.active=1 ORDER BY h.reward DESC`);
  await renderPage(res, 'hitlist', user, { hits });
});
router.post('/hitlist/add', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { target_name, reward, reason } = req.body;
  const r = parseInt(reward)||0;
  if (r < 100) return res.json({ error: 'Min $100.' });
  if (user.cash < r) return res.json({ error: 'Not enough cash.' });
  const target = await get('SELECT id FROM users WHERE username=?', [target_name]);
  if (!target) return res.json({ error: 'User not found.' });
  user.cash -= r;
  await run('UPDATE users SET cash=? WHERE id=?', [user.cash, user.id]);
  await run('INSERT INTO hitlist (target_id,poster_id,reward,reason) VALUES (?,?,?,?)', [target.id, user.id, r, reason||'']);
  await addEvent(target.id, 'hitlist', `You have a $${r} bounty on your head!`);
  res.json({ msg: `Placed $${r} bounty on ${target_name}.` });
});

// ── ISOLATION ──
router.get('/isolation', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const jailed = await all('SELECT id,username,level,jail_until,jail_reason FROM users WHERE in_jail=1 ORDER BY jail_until ASC');
  const now = Math.floor(Date.now()/1000);
  const timeLeft = Math.max(0, (user.jail_until||0) - now);
  const bribeCost = Math.max(200, Math.ceil(timeLeft/60) * 500);
  await renderPage(res, 'isolation', user, { jailed, now, timeLeft, bribeCost });
});

router.post('/isolation/bribe', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user.in_jail) return res.json({ error: 'You are not in isolation.' });
  const now = Math.floor(Date.now()/1000);
  const timeLeft = Math.max(0, (user.jail_until||0) - now);
  const bribeCost = Math.max(200, Math.ceil(timeLeft/60) * 500);
  if (user.cash < bribeCost) return res.json({ error: `Need $${bribeCost.toLocaleString()} to bribe out.` });
  user.cash -= bribeCost;
  user.in_jail = 0;
  user.jail_until = 0;
  user.jail_reason = null;
  await saveUser(user);
  res.json({ msg: `Bribed your way out for $${bribeCost.toLocaleString()}!`, user: statBlock(user) });
});


// ── API STATS ──
router.get('/api/stats', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  res.json(statBlock(user));
});

module.exports = router;

// ── EQUIPMENT ──

router.get('/equipment', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const equipped = await get('SELECT * FROM equipment WHERE user_id=?', [user.id]) || { weapon:null, armor:null, gear:null };
  const invWeapons  = await all("SELECT * FROM inventory WHERE user_id=? AND item_type='weapon'",  [user.id]);
  const invArmor    = await all("SELECT * FROM inventory WHERE user_id=? AND item_type='armor'",   [user.id]);
  const invGear     = await all("SELECT * FROM inventory WHERE user_id=? AND item_type='gear'",    [user.id]);
  await renderPage(res, 'equipment', user, { equipped, invWeapons, invArmor, invGear, WEAPONS, ARMOR, GEAR });
});

router.post('/equipment/equip', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { action, slot, key } = req.body;
  if (!['weapon','armor','gear'].includes(slot)) return res.json({ error: 'Invalid slot.' });
  const equipped = await get('SELECT * FROM equipment WHERE user_id=?', [user.id]);
  if (action === 'unequip') {
    await run(`UPDATE equipment SET ${slot}=NULL WHERE user_id=?`, [user.id]);
    return res.json({ msg: 'Unequipped.' });
  }
  // Check user owns the item
  const owned = await get("SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, key, slot]);
  if (!owned) return res.json({ error: "You don't own that item." });
  if (!equipped) {
    await run('INSERT INTO equipment (user_id, weapon, armor, gear) VALUES (?,?,?,?)',
      [user.id, slot==='weapon'?key:null, slot==='armor'?key:null, slot==='gear'?key:null]);
  } else {
    await run(`UPDATE equipment SET ${slot}=? WHERE user_id=?`, [key, user.id]);
  }
  res.json({ msg: 'Equipped!' });
});

// ── INVENTORY ──
router.get('/inventory', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const invItems = await all("SELECT * FROM inventory WHERE user_id=? AND (item_type='item' OR item_type='drug')", [user.id]);
  const allItems = { ...ITEMS, ...DRUGS };
  await renderPage(res, 'inventory', user, { invItems, allItems });
});

router.post('/inventory/use', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { item_key } = req.body;
  const owned = await get("SELECT * FROM inventory WHERE user_id=? AND item_key=?", [user.id, item_key]);
  if (!owned) return res.json({ error: "You don't own that." });
  const item = { ...ITEMS, ...DRUGS }[item_key];
  if (!item) return res.json({ error: 'Unknown item.' });
  if (!item.consumable) return res.json({ error: 'This item cannot be used directly.' });
  const e = item.effect;
  if (e.hp)       user.hp       = Math.min(user.max_hp, user.hp + (e.hp > 9000 ? user.max_hp : e.hp));
  if (e.energy)   user.energy   = Math.min(user.max_energy, user.energy + e.energy);
  if (e.nerve)    user.nerve    = Math.min(user.max_nerve, user.nerve + (e.nerve > 9000 ? user.max_nerve : e.nerve));
  if (item.permanent) {
    if (e.strength) user.strength += e.strength;
    if (e.speed)    user.speed    += e.speed;
    if (e.defense)  user.defense  += e.defense;
  }
  if (owned.quantity <= 1) {
    await run("DELETE FROM inventory WHERE user_id=? AND item_key=?", [user.id, item_key]);
  } else {
    await run("UPDATE inventory SET quantity=quantity-1 WHERE user_id=? AND item_key=?", [user.id, item_key]);
  }
  await saveUser(user);
  res.json({ msg: `Used ${item.name}!`, user: statBlock(user) });
});

router.post('/inventory/drop', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { item_key, item_type } = req.body;
  await run("DELETE FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, item_key, item_type]);
  res.json({ ok: true });
});

router.post('/inventory/list', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { item_key, item_type, price, quantity } = req.body;
  if (!item_key || !item_type || price < 1) return res.json({ error: 'Invalid listing.' });
  const qty = Math.max(1, parseInt(quantity)||1);
  const owned = await get("SELECT * FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, item_key, item_type]);
  if (!owned || owned.quantity < qty) return res.json({ error: "You don't have enough of that item." });
  // Deduct from inventory
  if (owned.quantity <= qty) {
    await run("DELETE FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, item_key, item_type]);
  } else {
    await run("UPDATE inventory SET quantity=quantity-? WHERE user_id=? AND item_key=? AND item_type=?", [qty, user.id, item_key, item_type]);
  }
  await run('INSERT INTO open_market (seller_id, prison_id, item_type, item_key, quantity, price) VALUES (?,?,?,?,?,?)',
    [user.id, user.prison_id||1, item_type, item_key, qty, price]);
  res.json({ msg: `Listed ${qty}x ${item_key} for $${price} on the Open Market.` });
});

// ── OPEN MARKET ──
router.get('/openmarket', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prisonId = user.prison_id || 1;
  const prison = PRISONS.find(p => p.id === prisonId) || PRISONS[0];
  const selCat = req.query.cat || null;
  const rows = await all(`SELECT om.*, u.username as seller_name FROM open_market om JOIN users u ON u.id=om.seller_id WHERE om.active=1 AND om.prison_id=? ORDER BY om.listed_at DESC`, [prisonId]);

  const allItemData = { ...ITEMS, ...DRUGS, ...WEAPONS, ...ARMOR, ...GEAR };
  const listings = rows.map(r => {
    const item = allItemData[r.item_key] || CELL_AMENITIES[r.item_key];
    return { ...r, img: item?.img||null, display_name: item?.name||r.item_key, desc: item?.desc||'' };
  });

  // Build user's sellable inventory for selected category
  const invRows = await all("SELECT * FROM inventory WHERE user_id=?", [user.id]);
  const inventory = invRows.map(r => {
    const item = allItemData[r.item_key];
    return { item_key: r.item_key, item_type: r.item_type, display_name: item?.name||r.item_key, quantity: r.quantity };
  });
  const ownedAmens = await all("SELECT item_key, COUNT(*) as qty FROM cell_amenities WHERE user_id=? AND placed_tile IS NULL GROUP BY item_key", [user.id]);
  ownedAmens.forEach(a => {
    const item = CELL_AMENITIES[a.item_key];
    if (item) inventory.push({ item_key: a.item_key, item_type:'amenity', display_name: item.name, quantity: a.qty });
  });

  await renderPage(res, 'openmarket', user, { listings, prison, inventory, selCat });
});

router.post('/openmarket/buy', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { listing_id } = req.body;
  const listing = await get('SELECT * FROM open_market WHERE id=? AND active=1', [listing_id]);
  if (!listing) return res.json({ error: 'Listing not found or already sold.' });
  if (listing.seller_id === user.id) return res.json({ error: "Can't buy your own listing." });
  if ((listing.prison_id) !== (user.prison_id||1)) return res.json({ error: 'Wrong prison.' });
  if (user.cash < listing.price) return res.json({ error: `Need $${listing.price}.` });
  user.cash -= listing.price;
  const fee = Math.floor(listing.price * 0.1);
  const sellerGets = listing.price - fee;
  await run('UPDATE users SET cash=cash+? WHERE id=?', [sellerGets, listing.seller_id]);
  await run('UPDATE open_market SET active=0 WHERE id=?', [listing_id]);
  // Add to buyer's inventory
  if (listing.item_type === 'amenity') {
    await run('INSERT INTO cell_amenities (user_id, item_key) VALUES (?,?)', [user.id, listing.item_key]);
  } else {
    const existing = await get("SELECT id,quantity FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, listing.item_key, listing.item_type]);
    if (existing) {
      await run("UPDATE inventory SET quantity=quantity+? WHERE id=?", [listing.quantity, existing.id]);
    } else {
      await run("INSERT INTO inventory (user_id, item_key, item_type, quantity) VALUES (?,?,?,?)", [user.id, listing.item_key, listing.item_type, listing.quantity]);
    }
  }
  await saveUser(user);
  await addEvent(listing.seller_id, 'market', `Your listing sold for $${sellerGets} (after 10% fee).`);
  res.json({ msg: `Bought for $${listing.price}!`, user: statBlock(user) });
});

router.post('/openmarket/cancel', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { listing_id } = req.body;
  const listing = await get('SELECT * FROM open_market WHERE id=? AND seller_id=? AND active=1', [listing_id, user.id]);
  if (!listing) return res.json({ error: 'Listing not found.' });
  await run('UPDATE open_market SET active=0 WHERE id=?', [listing_id]);
  // Return item to inventory
  if (listing.item_type === 'amenity') {
    await run('INSERT INTO cell_amenities (user_id, item_key) VALUES (?,?)', [user.id, listing.item_key]);
  } else {
    const existing = await get("SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, listing.item_key, listing.item_type]);
    if (existing) {
      await run("UPDATE inventory SET quantity=quantity+? WHERE id=?", [listing.quantity, existing.id]);
    } else {
      await run("INSERT INTO inventory (user_id, item_key, item_type, quantity) VALUES (?,?,?,?)", [user.id, listing.item_key, listing.item_type, listing.quantity]);
    }
  }
  res.json({ ok: true, msg: 'Listing cancelled, item returned.' });
});

// ═══════════════════════════════════════════════════════════
// ── JOBS ──
// ═══════════════════════════════════════════════════════════
router.get('/jobs', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prisonJobs = JOBS[user.prison_id] || [];
  await renderPage(res, 'jobs', user, { prisonJobs });
});

router.post('/jobs/take', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { job_key } = req.body;
  const prisonJobs = JOBS[user.prison_id] || [];
  const job = prisonJobs.find(j => j.key === job_key);
  if (!job) return res.json({ error: 'Invalid job.' });
  if (user.defense < job.req_def) return res.json({ error: `Need ${job.req_def} DEF for this job.` });
  await run('UPDATE users SET job_key=?, job_prison_id=? WHERE id=?', [job.key, user.prison_id, user.id]);
  res.json({ msg: `You're now working as: ${job.name}. You'll earn $${job.base_pay}/day.` });
});

router.post('/jobs/quit', requireAuth, async (req, res) => {
  await run('UPDATE users SET job_key=NULL, job_prison_id=NULL WHERE id=?', [req.session.userId]);
  res.json({ msg: 'You quit your job.' });
});

router.post('/jobs/collect', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user.job_key || user.job_prison_id !== user.prison_id) return res.json({ error: 'No active job at this prison.' });
  const now = Math.floor(Date.now()/1000);
  const lastPay = user.last_daily_pay || 0;
  const elapsed = now - lastPay;
  if (elapsed < 3600) {
    const wait = Math.ceil((3600 - elapsed) / 60);
    return res.json({ error: `Next pay available in ${wait} minute${wait!==1?'s':''}.` });
  }
  const prisonJobs = JOBS[user.prison_id] || [];
  const job = prisonJobs.find(j => j.key === user.job_key);
  if (!job) return res.json({ error: 'Job no longer available.' });
  // Pay scales with stats
  const bonus = Math.floor((user.defense + user.strength) / 20) * 10;
  const pay = job.base_pay + bonus;
  const xpGain = job.xp_per_day;
  user.cash += pay;
  user.xp   += xpGain;
  await run('UPDATE users SET last_daily_pay=? WHERE id=?', [now, user.id]);
  const lvlUp = await levelUpCheck(user, run);
  await saveUser(user);
  res.json({ msg: `Collected pay: +$${pay} (+$${bonus} stat bonus), +${xpGain} XP.`, user: statBlock(user), levelUp: lvlUp });
});

// ═══════════════════════════════════════════════════════════
// ── MUGGING ──
// ═══════════════════════════════════════════════════════════
router.post('/mug', requireAuth, async (req, res) => {
  const mugger = await getUser(req.session.userId);
  const { target_id } = req.body;
  const tid = parseInt(target_id);
  if (!tid || tid === mugger.id) return res.json({ error: 'Invalid target.' });

  // Cooldown check (10 min)
  const cd = await get('SELECT last_mug FROM mug_cooldowns WHERE mugger_id=? AND target_id=?', [mugger.id, tid]).catch(()=>null);
  const now = Math.floor(Date.now()/1000);
  if (cd && now - cd.last_mug < 600) {
    const wait = Math.ceil((600 - (now - cd.last_mug)) / 60);
    return res.json({ error: `Must wait ${wait} more minute${wait!==1?'s':''} before mugging this person again.` });
  }

  if (mugger.nerve < 10) return res.json({ error: 'Need 10 Nerve to mug.' });
  if (mugger.in_hospital || mugger.in_jail) return res.json({ error: "You can't mug from here." });

  const target = await getUser(tid);
  if (!target) return res.json({ error: 'Target not found.' });
  if (target.prison_id !== mugger.prison_id) return res.json({ error: 'Target is in a different prison.' });
  if (target.in_hospital) return res.json({ error: 'Target is in hospital.' });

  mugger.nerve -= 10;
  await run('INSERT OR REPLACE INTO mug_cooldowns VALUES (?,?,?)', [mugger.id, tid, now]);

  // Speed comparison determines success
  const speedRatio = mugger.speed / Math.max(1, target.speed);
  let catchChance;
  if (speedRatio >= 2)      catchChance = 90;
  else if (speedRatio >= 1) catchChance = 60 + Math.floor((speedRatio - 1) * 30);
  else                      catchChance = Math.max(15, 40 + Math.floor(speedRatio * 20));

  const roll = rnd(100);
  const miraculous = roll < 8 && speedRatio < 1; // miraculously mug even if slower

  if (roll < catchChance || miraculous) {
    // SUCCESS
    const cashSteal = Math.min(target.cash, Math.max(50, Math.floor(target.cash * (0.05 + Math.random() * 0.12))));
    let stolen = [];
    // Maybe steal an item
    if (Math.random() < 0.35) {
      const items = await all("SELECT * FROM inventory WHERE user_id=? AND item_type IN ('item','drug') LIMIT 10", [tid]);
      if (items.length) {
        const pick = items[Math.floor(Math.random() * items.length)];
        if (pick.quantity > 1) await run('UPDATE inventory SET quantity=quantity-1 WHERE id=?', [pick.id]);
        else await run('DELETE FROM inventory WHERE id=?', [pick.id]);
        const existing = await get('SELECT id,quantity FROM inventory WHERE user_id=? AND item_key=? AND item_type=?', [mugger.id, pick.item_key, pick.item_type]);
        if (existing) await run('UPDATE inventory SET quantity=quantity+1 WHERE id=?', [existing.id]);
        else await run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,1)', [mugger.id, pick.item_key, pick.item_type]);
        stolen.push(pick.item_key.replace(/_/g,' '));
      }
    }
    await run('UPDATE users SET cash=MAX(0,cash-?) WHERE id=?', [cashSteal, tid]);
    mugger.cash += cashSteal;
    if (!miraculous) { mugger.xp += 10 + Math.floor(target.level * 2); }
    await addEvent(tid, 'mugged', `${mugger.username} mugged you! Lost $${cashSteal}${stolen.length?` and ${stolen.join(', ')}`:''}.`);
    const lvlUp = await levelUpCheck(mugger, run);
    await saveUser(mugger);
    let msg = `${miraculous?'Miraculously mugged':'Mugged'} ${target.username}! Stole $${cashSteal}`;
    if (stolen.length) msg += ` and ${stolen.join(', ')}`;
    msg += miraculous ? '. (No XP — lucky snatch!)' : '. +' + (10 + Math.floor(target.level*2)) + ' XP.';
    return res.json({ success: true, msg, user: statBlock(mugger), levelUp: lvlUp });
  }

  // FAILED — possible ambush
  const ambush = Math.random() < 0.18;
  if (ambush) {
    const dmg = Math.max(5, Math.floor(target.strength * 0.3));
    mugger.hp = Math.max(1, mugger.hp - dmg);
    if (mugger.hp <= 1) {
      mugger.in_hospital = 1;
      mugger.hospital_until = now + 180;
      mugger.hospital_reason = `Ambushed by ${target.username} during a mug attempt`;
    }
  }
  await saveUser(mugger);
  return res.json({ success: false, msg: `${target.username} escaped you!${ambush ? ` They ambushed you! Lost ${Math.max(5,Math.floor(target.strength*0.3))} HP.` : ''}`, user: statBlock(mugger) });
});

// ═══════════════════════════════════════════════════════════
// ── SPYING ──
// ═══════════════════════════════════════════════════════════
router.get('/spy/:username', requireAuth, async (req, res) => {
  const user   = await getUser(req.session.userId);
  const target = await get('SELECT * FROM users WHERE username=? COLLATE NOCASE', [req.params.username]);
  if (!target) return res.redirect('/inmates');
  const spyCost = 450 * target.level;
  const recent  = await all('SELECT * FROM spy_logs WHERE spy_id=? AND target_id=? ORDER BY created_at DESC LIMIT 1', [user.id, target.id]).catch(()=>[]);
  await renderPage(res, 'spy', user, { target, spyCost, lastResult: recent[0] || null });
});

router.post('/spy', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { target_id } = req.body;
  const tid  = parseInt(target_id);
  const target = await getUser(tid);
  if (!target || target.id === user.id) return res.json({ error: 'Invalid target.' });
  if (target.prison_id !== user.prison_id) return res.json({ error: 'Can only spy on inmates in your prison.' });
  const spyCost = 450 * target.level;
  if (user.cash < spyCost) return res.json({ error: `Need $${spyCost.toLocaleString()} to spy on this inmate.` });

  user.cash -= spyCost;

  // Each field has independent random success chance
  const hit = () => Math.random() > 0.35;
  const items = await all("SELECT item_key,item_type,quantity FROM inventory WHERE user_id=? AND item_type='item'", [tid]);
  const drugs = await all("SELECT item_key,quantity FROM inventory WHERE user_id=? AND item_type='drug'", [tid]);
  const cell  = await all('SELECT item_key,placed_tile FROM cell_amenities WHERE user_id=? AND placed_tile IS NOT NULL', [tid]);

  const result = {
    bank:     hit() ? target.bank    : null,
    favors:   hit() ? (target.favors||0) : null,
    xp_pct:  hit() ? Math.floor((target.xp / Math.max(1,target.xp_needed))*100) : null,
    speed:    hit() ? target.speed   : null,
    strength: hit() ? target.strength: null,
    defense:  hit() ? target.defense : null,
    stamina:  hit() ? target.stamina  : null,
    items:    hit() ? items           : null,
    drugs:    hit() ? drugs           : null,
    cell:     hit() ? cell.map(c=>c.item_key) : null,
  };

  await run('INSERT INTO spy_logs (spy_id,target_id,result,cost) VALUES (?,?,?,?)',
    [user.id, tid, JSON.stringify(result), spyCost]).catch(()=>{});
  await saveUser(user);
  res.json({ result, msg: `Spy report on ${target.username} complete. Cost: $${spyCost.toLocaleString()}.`, user: statBlock(user) });
});

// ═══════════════════════════════════════════════════════════
// ── CELL RAIDING ──
// ═══════════════════════════════════════════════════════════
router.get('/raid/:username', requireAuth, async (req, res) => {
  const user   = await getUser(req.session.userId);
  const target = await get('SELECT id,username,prison_id FROM users WHERE username=? COLLATE NOCASE', [req.params.username]);
  if (!target) return res.redirect('/inmates');
  if (target.prison_id !== user.prison_id) return res.redirect('/inmates');
  const now = Math.floor(Date.now()/1000);
  const cd  = await get('SELECT last_raid FROM raid_cooldowns WHERE raider_id=? AND target_id=?', [user.id, target.id]).catch(()=>null);
  const cdLeft = cd ? Math.max(0, 1800 - (now - cd.last_raid)) : 0;
  // Previous attempts this session (cleared when target changes combo)
  const prevAttempts = await all('SELECT combo_tried,correct_positions FROM raid_attempts WHERE raider_id=? AND target_id=? ORDER BY created_at DESC LIMIT 8', [user.id, target.id]).catch(()=>[]);
  // Get combo length (may have been extended by target)
  const comboRow = await get('SELECT combo FROM cell_combos WHERE user_id=?', [target.id]).catch(()=>null);
  const combo = comboRow?.combo || '12345';
  await renderPage(res, 'raid', user, { target, cdLeft, prevAttempts, comboLength: combo.length });
});

router.post('/raid/attempt', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { target_id, combo_try } = req.body;
  const tid = parseInt(target_id);
  if (user.nerve < 10) return res.json({ error: 'Need 10 Nerve to raid.' });
  if (user.in_hospital || user.in_jail) return res.json({ error: "You can't raid from here." });
  const now = Math.floor(Date.now()/1000);
  const cd  = await get('SELECT last_raid FROM raid_cooldowns WHERE raider_id=? AND target_id=?', [user.id, tid]).catch(()=>null);
  if (cd && now - cd.last_raid < 1800) {
    const wait = Math.ceil((1800 - (now - cd.last_raid)) / 60);
    return res.json({ error: `Wait ${wait} more minute${wait!==1?'s':''} before raiding again.` });
  }

  const target = await getUser(tid);
  if (!target || target.prison_id !== user.prison_id) return res.json({ error: 'Invalid target.' });

  const comboRow = await get('SELECT combo FROM cell_combos WHERE user_id=?', [tid]).catch(()=>null);
  const realCombo = comboRow?.combo || '12345';
  const tryStr = String(combo_try).slice(0, realCombo.length);

  // Mark correct digits (green = right digit right position)
  const correctPos = [];
  for (let i = 0; i < realCombo.length; i++) {
    correctPos.push(tryStr[i] === realCombo[i] ? 'correct' : (realCombo.includes(tryStr[i]) ? 'present' : 'wrong'));
  }

  user.nerve -= 10;
  await run('INSERT OR REPLACE INTO raid_cooldowns VALUES (?,?,?)', [user.id, tid, now]);
  await run('INSERT INTO raid_attempts (raider_id,target_id,combo_tried,correct_positions) VALUES (?,?,?,?)',
    [user.id, tid, tryStr, JSON.stringify(correctPos)]).catch(()=>{});

  if (tryStr === realCombo) {
    // SUCCESS — loot the cell
    user.xp += 30 + target.level * 5;
    let loot = [];
    // Steal cash from bank (10-25%)
    const bankSteal = Math.floor(target.bank * (0.1 + Math.random() * 0.15));
    if (bankSteal > 0) {
      await run('UPDATE users SET bank=MAX(0,bank-?) WHERE id=?', [bankSteal, tid]);
      user.cash += bankSteal;
      loot.push(`$${bankSteal} from bank`);
    }
    // Steal unprotected cell items (5-7% chance per item)
    const placed = await all('SELECT * FROM cell_amenities WHERE user_id=? AND placed_tile IS NOT NULL AND protected=0', [tid]);
    for (const item of placed) {
      if (Math.random() < 0.06) {
        await run('DELETE FROM cell_amenities WHERE id=?', [item.id]);
        const ex = await get('SELECT id,quantity FROM cell_amenities WHERE user_id=? AND item_key=?', [user.id, item.item_key]);
        if (ex) await run('UPDATE cell_amenities SET quantity=quantity+1 WHERE id=?', [ex.id]);
        else await run('INSERT INTO cell_amenities (user_id,item_key,quantity,protected) VALUES (?,?,1,0)', [user.id, item.item_key]);
        loot.push(item.item_key.replace(/_/g,' '));
      }
    }
    // Warden resets combo after successful raid
    const newCombo = Array.from({length: realCombo.length}, () => rnd(10)).join('');
    await run('INSERT OR REPLACE INTO cell_combos VALUES (?,?)', [tid, newCombo]);
    await run('DELETE FROM raid_attempts WHERE raider_id=? AND target_id=?', [user.id, tid]);

    await addEvent(tid, 'raided', `${user.username} cracked your cell combination and raided your cell! Lost: ${loot.join(', ') || 'nothing valuable'}.`);
    const lvlUp = await levelUpCheck(user, run);
    await saveUser(user);
    return res.json({ success: true, cracked: true, loot, msg: `Cell cracked! Looted: ${loot.join(', ') || 'nothing valuable'}.`, correctPos, user: statBlock(user), levelUp: lvlUp });
  }

  // WRONG COMBO — maybe caught
  const caughtChance = 35;
  const escaped = Math.random() * 100 > caughtChance;
  await saveUser(user);
  if (!escaped) {
    const isoTime = 180 + rnd(180);
    await run('UPDATE users SET in_jail=1, jail_until=?, jail_reason=? WHERE id=?',
      [now + isoTime, `Caught raiding ${target.username}'s cell`, user.id]);
    return res.json({ success: false, cracked: false, caught: true, correctPos, msg: `Wrong combo — you were caught! Isolation for ${Math.ceil(isoTime/60)} minutes.`, user: statBlock(user) });
  }
  return res.json({ success: false, cracked: false, caught: false, correctPos, msg: 'Wrong combo — but you slipped away.', user: statBlock(user) });
});

router.post('/cell/change-combo', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { new_combo } = req.body;
  if (!new_combo || !/^[a-zA-Z0-9]{4,8}$/.test(new_combo))
    return res.json({ error: 'Combo must be 4-8 alphanumeric characters.' });
  const cost = 500;
  if (user.cash < cost) return res.json({ error: `Costs $${cost} to change your combo.` });
  user.cash -= cost;
  await saveUser(user);
  await run('INSERT OR REPLACE INTO cell_combos VALUES (?,?)', [user.id, new_combo]);
  await run('DELETE FROM raid_attempts WHERE target_id=?', [user.id]);
  res.json({ msg: `Combo changed to: ${new_combo}. Previous raid attempts erased.`, user: statBlock(user) });
});

// ═══════════════════════════════════════════════════════════
// ── SEND MONEY ──
// ═══════════════════════════════════════════════════════════
router.get('/send-money', requireAuth, async (req, res) => {
  const user    = await getUser(req.session.userId);
  const inmates = await all('SELECT id,username,level,prison_id FROM users WHERE id!=? ORDER BY username ASC', [user.id]);
  await renderPage(res, 'send_money', user, { inmates, PRISONS });
});

router.post('/send-money', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { target_id, amount } = req.body;
  const amt = parseInt(amount);
  if (!amt || amt < 1) return res.json({ error: 'Invalid amount.' });
  if (user.cash < amt)  return res.json({ error: 'Not enough cash on hand.' });
  const target = await get('SELECT id,username,prison_id FROM users WHERE id=?', [parseInt(target_id)]);
  if (!target || target.id === user.id) return res.json({ error: 'Invalid recipient.' });
  const samePrison = target.prison_id === user.prison_id;
  const fee = samePrison ? Math.ceil(amt * 0.10) : Math.ceil(amt * 0.20);
  const total = amt + fee;
  if (user.cash < total) return res.json({ error: `Need $${total.toLocaleString()} total ($${amt} + $${fee} fee).` });
  user.cash -= total;
  await run('UPDATE users SET cash=cash+? WHERE id=?', [amt, target.id]);
  await addEvent(target.id, 'money', `${user.username} sent you $${amt.toLocaleString()}.`);
  await saveUser(user);
  res.json({ msg: `Sent $${amt.toLocaleString()} to ${target.username}. Fee: $${fee} (${samePrison?'10%':'20%'}).`, user: statBlock(user) });
});

// ═══════════════════════════════════════════════════════════
// ── FAVORS ──
// ═══════════════════════════════════════════════════════════
router.post('/favors/vote', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const now  = Math.floor(Date.now()/1000);
  const lastVote = user.last_daily_pay || 0; // reuse field for simplicity — we'll use a new one
  // Use a dedicated tracking: check events for today's vote
  const todayVote = await get("SELECT id FROM events WHERE user_id=? AND type='vote' AND created_at > ?",
    [user.id, now - 86400]).catch(()=>null);
  if (todayVote) return res.json({ error: 'Already claimed your daily vote favor. Come back tomorrow!' });
  user.favors = (user.favors || 0) + 1;
  await run('UPDATE users SET favors=? WHERE id=?', [user.favors, user.id]);
  await run("INSERT INTO events (user_id,type,message) VALUES (?,'vote','Earned 1 favor from voting.')", [user.id]);
  res.json({ msg: '+1 Favor earned! Thanks for voting.', favors: user.favors });
});

// ── PRISON TRANSPORT ──
router.get('/transport', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const WEAPONS_LIST = Object.entries(WEAPONS).map(([k,v])=>({key:k,...v}));
  await renderPage(res, 'transport', user, { PRISONS, WEAPONS_LIST });
});

router.post('/transport/move', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { prison_id } = req.body;
  const prison = PRISONS.find(p => p.id === parseInt(prison_id));
  if (!prison) return res.json({ error: 'Invalid prison.' });
  if (user.level < prison.level_req) return res.json({ error: `Requires Level ${prison.level_req}.` });
  if ((user.prison_id||1) === prison.id) return res.json({ error: "You're already at this prison." });
  const TRANSFER_COSTS = { 1:0, 2:2000, 3:5000, 4:12000, 5:35000 };
  const cost = TRANSFER_COSTS[prison.id] || 0;
  if (user.cash < cost) return res.json({ error: `Need $${cost.toLocaleString()} to transfer.` });
  user.cash -= cost;

  // ── ON TRANSFER: lose job, remove market listings, clear cell, bank transfer, reset combo ──
  // 1. Lose job
  await run('UPDATE users SET job_key=NULL, job_prison_id=NULL WHERE id=?', [user.id]);
  // 2. Remove open market listings → return to inventory
  const myListings = await all("SELECT * FROM open_market WHERE seller_id=? AND active=1", [user.id]);
  for (const listing of myListings) {
    await run("UPDATE open_market SET active=0 WHERE id=?", [listing.id]);
    const existing = await get("SELECT id,quantity FROM inventory WHERE user_id=? AND item_key=? AND item_type=?", [user.id, listing.item_key, listing.item_type]);
    if (existing) await run("UPDATE inventory SET quantity=quantity+? WHERE id=?", [listing.quantity, existing.id]);
    else await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,?)", [user.id, listing.item_key, listing.item_type, listing.quantity]);
  }
  // 3. Unplace cell amenities (keep in possession, just unplace)
  await run('UPDATE cell_amenities SET placed_tile=NULL WHERE user_id=?', [user.id]);
  // 4. Bank: if no existing account at new prison, cash out (simple: just keep bank balance — player must re-open)
  if (user.bank > 0) {
    user.cash += user.bank;
    user.bank = 0;
    await run('UPDATE users SET bank=0 WHERE id=?', [user.id]);
  }
  // 5. Reset cell combo
  const newCombo = Array.from({length:5}, ()=>rnd(10)).join('');
  await run('INSERT OR REPLACE INTO cell_combos VALUES (?,?)', [user.id, newCombo]);
  await run('DELETE FROM raid_attempts WHERE target_id=?', [user.id]);
  // 6. Resize cell to new prison max
  await run('UPDATE users SET prison_id=?, cell_size=? WHERE id=?', [prison.id, prison.max_cell, user.id]);

  await saveUser(user);

  const notes = [
    `Transferred to ${prison.name}.`,
    cost > 0 ? `Transfer cost: $${cost.toLocaleString()}.` : null,
    myListings.length ? `${myListings.length} market listing${myListings.length!==1?'s':''} returned to inventory.` : null,
    'Cell amenities unloaded — re-arrange your cell.',
    user.bank > 0 ? `Bank balance ($${user.bank.toLocaleString()}) transferred to cash.` : null,
    `New cell combo set. New max cell: ${prison.max_cell}.`,
  ].filter(Boolean);

  await addEvent(user.id, 'transport', notes.join(' '));
  res.json({ msg: notes.join(' '), redirect: '/prison' });
});



// ── SURGEON ──
const { AVATAR_CATEGORIES, AVATAR_PARTS, DEFAULT_AVATAR } = require('../middleware/avatardata');

router.get('/surgeon', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const presets = await all('SELECT * FROM avatar_presets WHERE user_id=? ORDER BY slot', [user.id]);
  const presetsData = presets.map(p => ({ ...p, layers: JSON.parse(p.layers || '{}') }));
  const unlockRows = await all('SELECT item_key FROM surgeon_unlocks WHERE user_id=?', [user.id]);
  const unlocked = unlockRows.map(r => r.item_key);
  let currentAvatar = DEFAULT_AVATAR;
  if (user.avatar) {
    try { currentAvatar = { ...DEFAULT_AVATAR, ...JSON.parse(user.avatar) }; } catch(e) {}
  }
  await renderPage(res, 'surgeon', user, {
    AVATAR_CATEGORIES, AVATAR_PARTS, DEFAULT_AVATAR,
    presets, presetsData, unlocked, currentAvatar
  });
});

router.post('/surgeon/save', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { layers } = req.body;
  if (!layers || typeof layers !== 'object') return res.json({ error: 'Invalid data.' });
  // Only save keys that exist in categories
  const validKeys = Object.keys(DEFAULT_AVATAR);
  const clean = {};
  validKeys.forEach(k => { if (layers[k]) clean[k] = layers[k]; });
  await run('UPDATE users SET avatar=? WHERE id=?', [JSON.stringify(clean), user.id]);
  res.json({ ok: true, msg: 'Avatar saved!' });
});

router.post('/surgeon/preset/save', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { slot, layers } = req.body;
  if (!slot || slot < 1 || slot > 5) return res.json({ error: 'Invalid slot.' });
  await run('INSERT OR REPLACE INTO avatar_presets (user_id, slot, layers) VALUES (?,?,?)',
    [user.id, slot, JSON.stringify(layers)]);
  res.json({ ok: true });
});

router.post('/surgeon/buy', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { item_key } = req.body;
  // Find part in any category
  let part = null;
  for (const cat of Object.keys(AVATAR_PARTS)) {
    part = AVATAR_PARTS[cat].find(p => p.key === item_key);
    if (part) break;
  }
  if (!part) return res.json({ error: 'Part not found.' });
  if (part.free) return res.json({ error: 'This part is already free.' });
  const alreadyOwned = await get('SELECT 1 FROM surgeon_unlocks WHERE user_id=? AND item_key=?', [user.id, item_key]);
  if (alreadyOwned) return res.json({ error: 'Already unlocked.' });
  if (user.rep < part.rep_cost) return res.json({ error: `Need ${part.rep_cost} Rep. You have ${user.rep}.` });
  user.rep -= part.rep_cost;
  await run('UPDATE users SET rep=? WHERE id=?', [user.rep, user.id]);
  await run('INSERT INTO surgeon_unlocks (user_id, item_key) VALUES (?,?)', [user.id, item_key]);
  res.json({ ok: true, msg: `Unlocked ${part.name}!`, rep: user.rep });
});
