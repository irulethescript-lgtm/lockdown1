const express = require('express');
const { db, run, get, all, getUser, addEvent, withTransaction } = require('../middleware/db');
const { requireAuth } = require('../middleware/auth');
const { MISSIONS, ITEMS, CELL_AMENITIES, WEAPONS, ARMOR, GEAR, DRUGS, PRISONS, getTitle, levelUpCheck, JOBS } = require('../middleware/gamedata');
const { progressionAction, getDailyProgress, recordActivity, getMastery, getGymProgress, GYMS } = require('../middleware/progression');
const { COURSES, APPROACHES, STANCES, crimeQuote, recoveryGroup, simulateFight } = require('../middleware/dynamics');
const { ROUTES: TRAVEL_ROUTES, GOODS, TRAVEL_ITEMS, BAGS, wholeNumber, getTravelPage, takeInventory, addInventory, receiveCollectible } = require('../middleware/travel');
const { getItem, canBuyInPrison, CATALOGS } = require('../middleware/item-catalog');
const { RELAX_COST, RELAX_COOLDOWN, happinessMultiplier } = require('../middleware/city-life');
const { describeItem, categoryCounts } = require('../middleware/item-view');
const {shopItems,stockFor,debitStock,overseasCatalog} = require('../middleware/shops');
const {HOMES,homeState}=require('../middleware/homes');
const medical = require('../middleware/medical');
const router = express.Router();
const weapons = require('../middleware/weapons');
const itemActions = require('../middleware/item-actions');
require('./weapon-controls')(router,statBlock);

function rnd(max) { return Math.floor(Math.random() * max); }

function statBlock(u) {
  return {
    hp: u.hp, max_hp: u.max_hp, energy: u.energy, max_energy: u.max_energy,
    nerve: u.nerve, max_nerve: u.max_nerve, xp: u.xp, xp_needed: u.xp_needed,
    cash: u.cash, bank: u.bank || 0, rep: u.rep, level: u.level,
    strength: u.strength, defense: u.defense, speed: u.speed, dexterity: u.dexterity,
    happiness: u.happiness, max_happiness: u.max_happiness, relax_ready_at: u.relax_ready_at,
    criminal: u.criminal,
    medical: {cap:u.medical?.cap,blood_type:u.medical?.blood_type,effectiveness:u.medical?.effectiveness}, cooldowns:u.cooldowns,
    stamina: u.stamina ?? 100, heat: u.heat || 0, perks: u.perks,
    wins: u.wins, losses: u.losses, travel: u.travel,
    tokens: u.favors || 0,
    favors: u.favors || 0,
    job_key: u.job_key || null,
    in_hospital: u.in_hospital, hospital_until: u.hospital_until,
    in_jail: u.in_jail, jail_until: u.jail_until,
  };
}

async function saveUser(u, execute = run) {
  // Always save BASE stats (before cell augments) so bonuses don't permanently stack
  const base = (stat, key) => u[key] === undefined ? u[stat] : u[key] + u[stat] - u._effectiveStats[stat];
  const baseStrength = base('strength', '_baseStrength');
  const baseDefense = base('defense', '_baseDefense');
  const baseSpeed = base('speed', '_baseSpeed');
  const baseDexterity = base('dexterity', '_baseDexterity');
  const baseMaxHp = base('max_hp', '_baseMaxHp');
  const baseMaxEn = base('max_energy', '_baseMaxEnergy');
  const baseMaxNv = base('max_nerve', '_baseMaxNerve');
  const baseStamina  = u._baseStamina   !== undefined ? u._baseStamina   + (u.stamina   - (u._effectiveStamina ?? u._baseStamina)) : (u.stamina ?? 100);

  await execute(`UPDATE users SET level=?,xp=?,xp_needed=?,hp=?,max_hp=?,energy=?,max_energy=?,
    nerve=?,max_nerve=?,stamina=?,strength=?,defense=?,speed=?,dexterity=?,happiness=?,crime_xp=?,cash=?,bank=?,rep=?,
    wins=?,losses=?,gang_id=?,in_hospital=?,hospital_until=?,hospital_reason=?,
    in_jail=?,jail_until=?,jail_reason=?,cell_size=?,favors=?,blurb=?,job_key=?,job_prison_id=?,last_daily_pay=? WHERE id=?`,
    [u.level,u.xp,u.xp_needed,
     u.hp, baseMaxHp, u.energy, baseMaxEn,
     u.nerve, baseMaxNv, Math.max(0,Math.min(100,baseStamina)),
     baseStrength, baseDefense, baseSpeed, baseDexterity, u.happiness, u.crime_xp,
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
router.get('/', requireAuth, (req, res) => res.redirect('/city'));

// ── PLAYER GUIDE ──
router.get('/how-to', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await renderPage(res, 'how-to', user, { pageTitle: 'How To Play & Rules' });
});

// ── PRISON ──
router.get(['/home','/prison'], requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prison = PRISONS.find(p => p.id === user.prison_id) || PRISONS[0];
  const daily = await getDailyProgress(user.id);
  const masteryRows = await all('SELECT * FROM crime_mastery WHERE user_id=? ORDER BY successes DESC, crime_key LIMIT 3', [user.id]);
  const recentEvents = await all('SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT 5', [user.id]);
  const nextPrison = PRISONS.find(p => p.level_req > user.level);
  const activeCourse = await get('SELECT * FROM education WHERE user_id=? AND completed_at IS NULL', [user.id]);
  const crimeNames = Object.values(CRIME_ZONES).flatMap(z => z.crimes);
  const specialties = masteryRows.map(row => ({ ...getMastery(row), name: crimeNames.find(c => c.key === row.crime_key)?.name || row.crime_key }));
  await renderPage(res, 'prison', user, { prison, daily, specialties, recentEvents, nextPrison, activeCourse, COURSES });
});

router.get('/newspaper',requireAuth,async(req,res,next)=>{
 try{await renderPage(res,'newspaper',await getUser(req.session.userId));}catch(err){next(err);}
});

// ── CASINO ──
const casino=require('../middleware/casino');
router.get(['/casino','/points','/awards'],requireAuth,async(req,res,next)=>{
 try{
  const data=await withTransaction(tx=>casino.state(tx,req.session.userId));
  const user=await getUser(req.session.userId);
  await renderPage(res,'casino',user,{casino:data,section:req.path==='/points'?'points':req.path==='/awards'?'awards':'casino'});
 }catch(err){next(err);}
});
router.get('/casino/state',requireAuth,async(req,res,next)=>{
 try{res.json(await withTransaction(tx=>casino.state(tx,req.session.userId)));}catch(err){next(err);}
});
router.post('/casino/action',requireAuth,async(req,res,next)=>{
 try{res.json(await withTransaction(tx=>casino.action(tx,req.session.userId,req.body)));}
 catch(err){if(err instanceof casino.CasinoError)return res.status(400).json({error:err.message});next(err);}
});

// ── CITY MAP ──
const {LOCATIONS,dailyFind}=require('../middleware/city-map');
router.get('/city',requireAuth,async(req,res,next)=>{
 try {
  const user=await getUser(req.session.userId);
  const find=await withTransaction(tx=>dailyFind(tx,user.id));
  const foundItem=find.item_key&&!find.claimed?getItem(find.item_type,find.item_key):null;
  await renderPage(res,'city',user,{locations:LOCATIONS,find,foundItem});
 }catch(err){next(err);}
});
router.post('/city/collect',requireAuth,async(req,res,next)=>{
 try {
  const result=await withTransaction(async tx=>{
   const user=await getUser(req.session.userId,tx);
   if(user.travel?.phase!=='home')return {error:'Return home before collecting items in the city.'};
   if(user.in_hospital||user.in_jail)return {error:'You must leave the hospital or jail before exploring the city.'};
   const find=await dailyFind(tx,user.id);
   if(!find.item_key||find.claimed)return {error:'There is no item to collect today.'};
   const item=getItem(find.item_type,find.item_key);
   if(!item)return {error:'This item is unavailable.'};
   const changed=await tx.run('UPDATE city_daily_finds SET claimed=1 WHERE user_id=? AND day=? AND claimed=0',[user.id,find.day]);
   if(!changed.changes)return {error:'This item has already been collected.'};
   const existing=await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=?',[user.id,find.item_key,find.item_type]);
   if(existing)await tx.run('UPDATE inventory SET quantity=quantity+1 WHERE id=?',[existing.id]);
   else await tx.run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,1)',[user.id,find.item_key,find.item_type]);
   await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'city_find',?)",[user.id,'Found '+item.name+' while exploring the city.']);
   return {msg:'You found '+item.name+'! It is now in your Items.',item:{name:item.name,key:find.item_key,type:find.item_type}};
  });
  res.json(result);
 }catch(err){next(err);}
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
router.get('/cell', requireAuth, async(req,res,next)=>{
  try {
    const state=await withTransaction(tx=>homeState(tx,req.session.userId));
    await renderPage(res,'cell',await getUser(req.session.userId),{...state,HOMES,CELL_AMENITIES,UPGRADES:require('../middleware/homes').UPGRADES,STAFF:require('../middleware/homes').STAFF,allowed:require('../middleware/homes').allowed,vaultLog:await all('SELECT * FROM property_vault_log WHERE owner_id=? AND home_key=? ORDER BY id DESC LIMIT 20',[state.current.owner_id,state.active.key])});
  }catch(err){next(err);}
});
router.post(['/cell/buy-home','/cell/move-in','/cell/manage'],requireAuth,async(req,res,next)=>{
 try{const body={...req.body,action:req.path.endsWith('/manage')?req.body.action:req.path.split('/').pop()};res.json(await withTransaction(tx=>require('../middleware/homes').action(tx,req.session.userId,body)));}
 catch(err){if(err instanceof require('../middleware/homes').PropertyError)return res.json({error:err.message});next(err);}
});
for(const [path,moduleName] of [['stocks','stocks'],['companies','companies']]){
 const system=require('../middleware/'+moduleName);
 router.get('/'+path,requireAuth,async(req,res,next)=>{try{const data=await withTransaction(tx=>system.state(tx,req.session.userId));await renderPage(res,path,await getUser(req.session.userId),{data,pageTitle:path==='stocks'?'Stock Exchange':'Companies'});}catch(err){next(err);}});
 router.post('/'+path+'/action',requireAuth,async(req,res,next)=>{try{res.json(await withTransaction(tx=>system.action(tx,req.session.userId,req.body)));}catch(err){if((system.StockError && err instanceof system.StockError) || err instanceof require('../middleware/homes').PropertyError || (system.CompanyError && err instanceof system.CompanyError))return res.status(400).json({error:err.message});next(err);}});
}
router.post('/cell/buy-furnishing',requireAuth,progressionAction(async(req,tx)=>{
  const item=Object.hasOwn(CELL_AMENITIES,req.body.item_key||'')?CELL_AMENITIES[req.body.item_key]:null;
  if(!item||!Number.isSafeInteger(item.price)||item.price<=0)return {error:'Choose a furnishing for sale.'};
  const user=await getUser(req.session.userId,tx);
  if(user.cash<item.price)return {error:'Not enough cash.'};
  await tx.run('UPDATE users SET cash=cash-? WHERE id=?',[item.price,user.id]);
  await tx.run('INSERT INTO cell_amenities (user_id,item_key,quantity,protected) VALUES (?,?,1,1)',[user.id,req.body.item_key]);
  return {msg:`Bought ${item.name}. Add it to your home from storage.`};
}));
router.post('/cell/place',requireAuth,progressionAction(async(req,tx)=>{
  const id=wholeNumber(req.body.db_id);
  const state=await homeState(tx,req.session.userId);
  const item=state.furnishings.find(f=>f.id===id);
  if(!item||!Object.hasOwn(CELL_AMENITIES,item.item_key))return {error:'Furnishing not found.'};
  if(item.placed_tile!==null)return {error:'This furnishing is already in your home.'};
  const placed=state.furnishings.filter(f=>f.placed_tile!==null);
  if(placed.length>=state.active.capacity)return {error:'Your home is full. Store a furnishing or buy a larger home.'};
  // Numeric placement slots remain internal so existing bonuses and saves stay valid.
  let slot=0;while(placed.some(f=>f.placed_tile===slot))slot++;
  await tx.run('UPDATE cell_amenities SET placed_tile=? WHERE id=? AND user_id=?',[slot,id,req.session.userId]);
  return {ok:true,msg:'Furnishing added to your home.'};
}));
router.post('/cell/remove',requireAuth,progressionAction(async(req,tx)=>{
  await tx.run('UPDATE cell_amenities SET placed_tile=NULL WHERE id=? AND user_id=?',[wholeNumber(req.body.db_id),req.session.userId]);
  return {ok:true,msg:'Furnishing moved into storage.'};
}));
router.post('/cell/clear',requireAuth,progressionAction(async(req,tx)=>{
  await tx.run('UPDATE cell_amenities SET placed_tile=NULL WHERE user_id=?',[req.session.userId]);
  return {ok:true,msg:'All furnishings moved into storage.'};
}));


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
    user.jail_reason = 'Caught stealing from the Broker\'s gun case!';
    await saveUser(user);
    return res.json({ caught: true, msg: 'Busted! The guard tackled you. 3 minutes in jail.' });
  }
  // Success - add a weapon to inventory
  const loot = ['torn_1','torn_2','torn_3','torn_4','torn_5'][Math.floor(Math.random()*5)];
  const cash = 500 + Math.floor(Math.random() * 1500);
  user.cash += cash;
  user.xp += Math.floor(25*(1+(user.itemBonuses?.modifiers.xp||0)));
  user.rep += 2;
  const existing = await get("SELECT id,quantity FROM inventory WHERE user_id=? AND item_key=? AND item_type='weapon'", [user.id, loot]);
  if (existing) await run("UPDATE inventory SET quantity=quantity+1 WHERE id=?", [existing.id]);
  else await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,'weapon',1)", [user.id, loot]);
  const lvlUp = await levelUpCheck(user, run);
  await saveUser(user);
  res.json({ success: true, msg: `Got away clean! Swiped a ${WEAPONS[loot].name} + $${cash.toLocaleString()}.`, loot, levelUp: lvlUp });
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
  if (!(prison.warden_amenities || []).includes(item_key)) return res.json({ error: 'Not available in your city.' });
  const amenity = CELL_AMENITIES[item_key];
  if (!amenity) return res.json({ error: 'Item not found.' });
  const repCost = amenity.rep_cost || Math.ceil((amenity.price || 500) / 50);
  if (user.rep < repCost) return res.json({ error: `Need ${repCost} Rep. You have ${user.rep}.` });
  user.rep -= repCost;
  // Insert as PROTECTED=1 — cannot be raided
  await run('INSERT INTO cell_amenities (user_id, item_key, quantity, protected) VALUES (?,?,1,1)', [user.id, item_key]);
  await saveUser(user);
  // Transaction log
  await run(`INSERT INTO transaction_logs (type,to_id,to_name,item_key,item_type,quantity,cash_amount,note) VALUES (?,?,?,?,?,1,0,?)`,
    ['warden_buy', user.id, user.username, item_key, 'amenity', `Broker purchase: ${amenity.name} for ${repCost} Rep`]).catch(()=>{});
  res.json({ msg: `Purchased ${amenity.name}! Go to My Property to place it.`, user: statBlock(user) });
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



// Rest at home turns cash into a short training advantage. Repeated requests cannot double-spend.
router.post('/cell/relax', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  const now = Math.floor(Date.now() / 1000);
  if (user.in_jail || user.in_hospital) return { error: 'Recover before relaxing at home.' };
  if (user.relax_ready_at > now) return { error: 'Your next home break is not ready yet.' };
  if (user.happiness >= user.max_happiness) return { error: 'Your happiness is already full. Your cash was kept.' };
  if (user.cash < RELAX_COST) return { error: `Need $${RELAX_COST} for a home break.` };
  const restored = Math.min(25, user.max_happiness - user.happiness);
  await tx.run('UPDATE users SET cash=cash-?,happiness=happiness+?,relax_ready_at=? WHERE id=?', [RELAX_COST, restored, now + RELAX_COOLDOWN, user.id]);
  return { msg: `Restored ${restored} happiness for $${RELAX_COST}. Your next break is ready in 30 minutes.`, user: statBlock(await getUser(user.id, tx)) };
}));

// ── GYM ──
router.get('/gym', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  // Get last 15 training history entries
  const history = await all(`SELECT * FROM (SELECT * FROM training_history WHERE user_id=? ORDER BY id DESC LIMIT 20) ORDER BY id ASC`, [user.id]);
  const progress = await get('SELECT energy_spent FROM gym_progress WHERE user_id=?', [user.id]);
  await renderPage(res, 'gym', user, { history, gym: getGymProgress(progress?.energy_spent), GYMS });
});

router.post('/gym/train', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  const { stat, energy_amount } = req.body;
  if (user.in_jail || user.in_hospital) return { error: 'You cannot train while in jail or the hospital.' };
  const amount = typeof energy_amount === 'number' || typeof energy_amount === 'string' ? Number(energy_amount) : NaN;
  if (!Number.isSafeInteger(amount) || amount < 1) return { error: 'Enter a whole number of energy points greater than zero.' };
  if (amount > user.energy) return { error: 'Not enough energy.' };
  if (!['strength','defense','speed','dexterity'].includes(stat)) return ({ error: 'Invalid stat.' });
  const currentStamina = user.stamina ?? 100;
  const staminaDrain = amount * 2;
  if (currentStamina < staminaDrain) return { error: `Need ${staminaDrain}% stamina for this session. Use less energy or wait to recover.` };
  const progress = await tx.get('SELECT energy_spent FROM gym_progress WHERE user_id=?', [user.id]);
  const gym = getGymProgress(progress?.energy_spent);
  const gain = Math.floor(amount * 2 * gym.multiplier * (1 + user.perks.training / 100) * (1+(user.itemBonuses?.modifiers.gymStat && user.itemBonuses.modifiers.gymStat!==stat?0:user.itemBonuses?.modifiers.gym||0)+(stat==='speed'&&user.itemBonuses?.sneakers?.05:0)) * happinessMultiplier(user.happiness) * (user.property?.pool?1.02:1));
  user.energy -= amount;
  user.happiness = Math.max(0, user.happiness - amount);
  user.stamina -= staminaDrain;
  user[stat] += gain;
  user.xp += Math.floor(amount * 15*(1+(user.itemBonuses?.modifiers.xp||0)));
  const lvlUp = await levelUpCheck(user, async () => {});
  await saveUser(user, tx.run);
  const historyEntry = Object.fromEntries(['strength', 'defense', 'speed', 'dexterity'].map(key => [key, user[{ strength:'_baseStrength', defense:'_baseDefense', speed:'_baseSpeed', dexterity:'_baseDexterity' }[key]] + user[key] - user._effectiveStats[key]]));
  await tx.run(`INSERT INTO training_history (user_id, strength, defense, speed, dexterity) VALUES (?,?,?,?,?)`,
    [user.id, historyEntry.strength, historyEntry.defense, historyEntry.speed, historyEntry.dexterity]);
  await tx.run(`DELETE FROM training_history WHERE user_id=? AND id NOT IN (SELECT id FROM training_history WHERE user_id=? ORDER BY trained_at DESC LIMIT 20)`,
    [user.id, user.id]);
  await tx.run(`INSERT INTO gym_progress (user_id,energy_spent) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET energy_spent=energy_spent+excluded.energy_spent`, [user.id, amount]);
  await recordActivity(user.id, 'training', tx);
  const updatedGym = getGymProgress((progress?.energy_spent || 0) + amount);
  return ({ msg: `Trained ${stat}! +${gain} ${stat.toUpperCase()} (used ${amount} energy, ${amount} happiness, -${staminaDrain}% stamina)`, user: statBlock(user), levelUp: lvlUp, gain, stat, historyEntry, gym: updatedGym, unlockedGym: updatedGym.name !== gym.name ? updatedGym.name : null });
}));

// ── YARD / PRISON VISITS ──
router.get(['/prison/yard','/yard','/travel'], requireAuth, async (req,res,next) => {
  try {
    const data=await withTransaction(async tx=>{
      const travel=await getTravelPage(req.session.userId,tx);
      const user=await getUser(req.session.userId,tx);
      return {user,travel};
    });
    await renderPage(res,'yard',data.user,{travel:data.travel,TRAVEL_ROUTES,GOODS,getItem});
  } catch(err) {next(err);}
});
router.get('/yard/state',requireAuth,async (req,res,next)=>{
  try {
    const data=await withTransaction(async tx=>{
      const travel=await getTravelPage(req.session.userId,tx);
      return {travel,user:statBlock(await getUser(req.session.userId,tx))};
    });
    res.json(data);
  } catch(err) {next(err);}
});
router.post('/yard/depart',requireAuth,progressionAction(async(req,tx)=>{
  const user=await getUser(req.session.userId,tx);
  const travel=await getTravelPage(user.id,tx);
  if(travel.phase!=='home') return {error:'Finish your current trip first.'};
  if(user.in_hospital || user.in_jail) return {error:'You cannot travel from jail or the hospital.'};
  const destination=TRAVEL_ROUTES.find(r=>r.id===wholeNumber(req.body.destination_id));
  if(!destination) return {error:'Choose a valid country.'};
  const jet=user.property?.airstrip||await require('../middleware/stocks').hasBenefit(tx,user.id,'WLT');
  const fare=jet?0:destination.fare;
  const ticket=!!user.itemBonuses?.ticket;
  const minutes=destination.minutes*Math.min(jet?.7:1,ticket?.3:1)*(user.itemBonuses?.modifiers.travel||1);
  const capacity=Math.max(ticket||user.property?.airstrip?15:0,travel.bag.capacity)+(user.itemBonuses?.suitcase||0)+(user.itemBonuses?.modifiers.capacity||0);
  if(user.cash<fare) return {error:`Need $${destination.fare} for the round-trip fare.`};
  const now=Math.floor(Date.now()/1000);
  await tx.run('UPDATE users SET cash=cash-? WHERE id=?',[fare,user.id]);
  const tripInsert=await tx.run(`INSERT INTO travel_trips (user_id,origin_id,destination_id,departed_at,arrives_at,fare,capacity) VALUES (?,?,?,?,?,?,?)`,
    [user.id,user.prison_id,destination.id,now,now+Math.ceil(minutes*60),fare,capacity]);
  if(ticket)await tx.run('DELETE FROM item_travel_tickets WHERE user_id=?',[user.id]);
  await tx.run('INSERT INTO property_trip_perks(trip_id,duration) VALUES (?,?)',[tripInsert.lastID,Math.ceil(minutes*60)]);
  const msg=`Departed for ${destination.name}. Arrival in ${minutes} minutes; return fare included.`;
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'travel',?)",[user.id,msg]);
  return {msg,travel:await getTravelPage(user.id,tx),user:statBlock(await getUser(user.id,tx))};
}));
router.post('/yard/buy',requireAuth,progressionAction(async(req,tx)=>{
  const user=await getUser(req.session.userId,tx);
  const travel=await getTravelPage(user.id,tx);
  if(travel.phase!=='visiting')return {error:'Arrive abroad before buying cargo.'};
  const good=travel.offers.find(g=>g.key===req.body.item_key && g.type===req.body.item_type);
  const quantity=wholeNumber(req.body.quantity);
  if(!good || !Number.isSafeInteger(quantity) || quantity<1)return {error:'Choose a local item and a positive whole quantity.'};
  const used=travel.cargo.reduce((sum,row)=>sum+row.quantity,0);
  if(quantity>travel.trip.capacity-used)return {error:'Not enough cargo space. Each item uses one slot.'};
  if(!good.available || good.quantity<quantity)return {error:'Not enough stock, or this limited offer has ended. Check the next hourly restock.'};
  const cost=good.price*quantity;
  if(!Number.isSafeInteger(cost)||user.cash<cost)return {error:'Not enough cash for this cargo.'};
  if(!await debitStock(tx,'country:'+travel.trip.destination_id,good.type,good.key,quantity))return {error:'Stock changed. Refresh the shop.'};
  await tx.run('UPDATE users SET cash=cash-? WHERE id=?',[cost,user.id]);
  await tx.run(`INSERT INTO travel_cargo (trip_id,item_key,quantity) VALUES (?,?,?)
    ON CONFLICT(trip_id,item_key) DO UPDATE SET quantity=quantity+excluded.quantity`,[travel.trip.id,good.type+':'+good.key,quantity]);
  await tx.run("INSERT INTO transaction_logs (type,from_id,item_key,item_type,quantity,cash_amount,note) VALUES ('overseas_purchase',?,?,?,?,?,?)",[user.id,good.key,good.type,quantity,cost,'Country '+travel.trip.destination_id]);
  return {msg:`Packed ${quantity} × ${good.name} for $${cost.toLocaleString()}. Delivered to your inventory when you return home.`,travel:await getTravelPage(user.id,tx),user:statBlock(await getUser(user.id,tx))};
}));
router.post('/yard/return',requireAuth,progressionAction(async(req,tx)=>{
  const travel=await getTravelPage(req.session.userId,tx);
  if(travel.phase!=='visiting') return {error:'You can start the return trip after arriving.'};
  const destination=TRAVEL_ROUTES.find(r=>r.id===travel.trip.destination_id);
  const now=Math.floor(Date.now()/1000);
  const duration=(await tx.get('SELECT duration FROM property_trip_perks WHERE trip_id=?',[travel.trip.id]))?.duration||destination.minutes*60;
  await tx.run("UPDATE travel_trips SET status='returning',return_departed_at=?,return_arrives_at=? WHERE id=?",[now,now+duration,travel.trip.id]);
  return {msg:`Heading home. Your ${duration/60}-minute return trip is already paid.`,travel:await getTravelPage(req.session.userId,tx),user:statBlock(await getUser(req.session.userId,tx))};
}));
router.post('/yard/sell',requireAuth,progressionAction(async(req,tx)=>{
  const travel=await getTravelPage(req.session.userId,tx);
  if(travel.phase!=='home') return {error:'Bring your cargo home before selling.'};
  const good=GOODS.find(g=>g.key===req.body.item_key);
  const quantity=wholeNumber(req.body.quantity);
  if(!good || !Number.isSafeInteger(quantity) || quantity<1 || quantity>1000000) return {error:'Choose a collectible and a positive whole quantity.'};
  if(!await takeInventory(tx,req.session.userId,good.key,quantity)) return {error:'You do not own enough of that collectible.'};
  const total=quantity*good.sell;
  await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[total,req.session.userId]);
  await tx.run('INSERT INTO travel_progress (user_id,sales_cash) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET sales_cash=sales_cash+excluded.sales_cash',[req.session.userId,total]);
  await tx.run("INSERT INTO transaction_logs (type,from_id,item_key,item_type,quantity,cash_amount,note) VALUES ('collector_sale',?,?,'collectible',?,?,?)",[req.session.userId,good.key,quantity,total,`Travel collector: ${good.name}`]);
  return {msg:`Sold ${quantity} × ${good.name} for $${total}. Your discovery stays in the collection book.`,travel:await getTravelPage(req.session.userId,tx),user:statBlock(await getUser(req.session.userId,tx))};
}));
router.post('/yard/upgrade',requireAuth,progressionAction(async(req,tx)=>{
  const user=await getUser(req.session.userId,tx),travel=await getTravelPage(user.id,tx);
  if(travel.phase!=='home') return {error:'Upgrade your bag at home.'};
  const bag=travel.nextBag;
  if(!bag) return {error:'You already have the largest cargo bag.'};
  if(travel.progress.trips_completed<bag.trips) return {error:`Complete ${bag.trips} round trips to unlock this bag.`};
  if(user.cash<bag.cost) return {error:`Need $${bag.cost} for the bag upgrade.`};
  await tx.run('UPDATE users SET cash=cash-? WHERE id=?',[bag.cost,user.id]);
  await tx.run('INSERT INTO travel_progress (user_id,bag_level) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET bag_level=excluded.bag_level',[user.id,bag.level]);
  return {msg:`Upgraded to ${bag.name}: ${bag.capacity} cargo slots.`,travel:await getTravelPage(user.id,tx),user:statBlock(await getUser(user.id,tx))};
}));
router.post('/yard/collection',requireAuth,progressionAction(async(req,tx)=>{
  const travel=await getTravelPage(req.session.userId,tx);
  if(travel.phase!=='home') return {error:'Return home to collect this reward.'};
  if(travel.progress.collection_claimed) return {error:'You have already collected this reward.'};
  if(!GOODS.every(g=>travel.discoveries.some(d=>d.item_key===g.key))) return {error:'Discover all 10 unique collectibles first.'};
  await tx.run('INSERT INTO travel_progress (user_id,collection_claimed) VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET collection_claimed=1',[req.session.userId]);
  await tx.run('UPDATE users SET cash=cash+1500,rep=rep+5 WHERE id=?',[req.session.userId]);
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'travel','Collection complete! Earned $1,500 and 5 reputation.')",[req.session.userId]);
  return {msg:'Collection complete! +$1,500 and +5 reputation. You keep your items.',travel:await getTravelPage(req.session.userId,tx),user:statBlock(await getUser(req.session.userId,tx))};
}));
// Retired movement endpoints cannot award old yard loot alongside the new travel loop.
router.post(['/yard/action','/yard/move','/yard/pickup','/yard/drop'],requireAuth,(req,res)=>res.json({error:'Visit the Airport at /airport to plan your next trip.'}));

// ── CRIMES ──
const CRIME_ZONES = {
  south_dakota: {
    label: 'Lockdown City Crimes',
    prison_ids: [1],
    crimes: [
      { key:'pickpocket',    name:'Pickpocket',       desc:'Lift wallets from distracted commuters.',          nerve:2,  stamina:3,  cash:[80,200],   catch_chance:20, xp:5,  rep:1 },
      { key:'steal_food',    name:'Steal Food',       desc:'Swipe stock from a restaurant delivery.',         nerve:3,  stamina:4,  cash:[100,300],  catch_chance:25, xp:8,  rep:1 },
      { key:'run_errands',   name:'Run Errands',      desc:'Deliver illicit packages between neighborhoods.',            nerve:4,  stamina:5,  cash:[150,400],  catch_chance:30, xp:10, rep:2 },
      { key:'intimidation',  name:'Intimidation',     desc:'Shake down a rival dealer for cash.',          nerve:6,  stamina:6,  cash:[200,500],  catch_chance:35, xp:15, rep:3 },
    ]
  },
  rikers: {
    label: 'London Crimes',
    prison_ids: [2],
    crimes: [
      { key:'card_shark',    name:'Card Shark',       desc:'Hustle gamblers at the card table.',             nerve:3,  stamina:4,  cash:[150,400],  catch_chance:22, xp:10, rep:2 },
      { key:'smuggle_phone', name:'Smuggle Phone',    desc:'Fence stolen phones through underground contacts.',             nerve:5,  stamina:5,  cash:[250,550],  catch_chance:28, xp:15, rep:3 },
      { key:'bribery',       name:'Bribery',          desc:'Pay off a police officer for inside information.',       nerve:7,  stamina:6,  cash:[300,600],  catch_chance:32, xp:20, rep:4 },
      { key:'gang_tax',      name:'Collect Gang Tax', desc:'Demand tribute from independent dealers.',     nerve:8,  stamina:7,  cash:[400,700],  catch_chance:38, xp:25, rep:5 },
    ]
  },
  san_quentin: {
    label: "Tokyo Crimes",
    prison_ids: [3],
    crimes: [
      { key:'forge_docs',    name:'Forge Documents',  desc:'Forge business documents for profit.',          nerve:5,  stamina:5,  cash:[300,600],  catch_chance:25, xp:20, rep:4 },
      { key:'drug_trade',    name:'Drug Trade',       desc:'Move product through backstreet contacts.',                nerve:8,  stamina:7,  cash:[500,900],  catch_chance:35, xp:30, rep:6 },
      { key:'extortion',     name:'Extortion',        desc:'Run a protection racket on local businesses.',       nerve:10, stamina:8,  cash:[600,1000], catch_chance:40, xp:35, rep:7 },
      { key:'heist_kitchen', name:'Kitchen Heist',    desc:'Rob a restaurant supplier during a delivery.',         nerve:12, stamina:9,  cash:[700,1200], catch_chance:45, xp:40, rep:8 },
    ]
  },
  alcatraz: {
    label: 'Dubai Crimes',
    prison_ids: [4],
    crimes: [
      { key:'contraband_ring', name:'Contraband Ring', desc:'Manage a full contraband supply chain.',       nerve:8,  stamina:8,  cash:[600,1200], catch_chance:28, xp:40, rep:8  },
      { key:'guard_bribe2',    name:'Corrupt Network',   desc:'Bribe a network of officers for a safe corridor.',   nerve:12, stamina:9,  cash:[800,1400], catch_chance:35, xp:50, rep:10 },
      { key:'bank_intel',      name:'Bank Intel',      desc:'Sell financial intel to outside contacts.',    nerve:14, stamina:10, cash:[1000,1600],catch_chance:40, xp:55, rep:12 },
      { key:'murder_contract', name:'Contract Hit',    desc:'Accept a hit contract from a crime boss.',     nerve:18, stamina:12, cash:[1200,1800],catch_chance:48, xp:65, rep:15 },
    ]
  },
  the_vault: {
    label: 'Cape Town Crimes',
    prison_ids: [5],
    crimes: [
      { key:'crypto_fraud',  name:'Crypto Fraud',     desc:'Run crypto scams from a hidden laptop.',     nerve:10, stamina:10, cash:[800,1500], catch_chance:25, xp:60, rep:12 },
      { key:'arms_deal',     name:'Arms Deal',        desc:'Broker a weapons deal between gangs.',         nerve:14, stamina:11, cash:[1200,1800], catch_chance:32, xp:70, rep:15 },
      { key:'prison_riot',   name:'Incite Riot',      desc:'Stage a distraction to rob a cash depot.',      nerve:18, stamina:13, cash:[1500,2000], catch_chance:42, xp:80, rep:18 },
      { key:'warden_heist',  name:'Broker\'s Safe',   desc:'Crack the broker\'s private safe.',           nerve:22, stamina:15, cash:[1600,2200], catch_chance:50, xp:100,rep:25 },
    ]
  }
};

router.get('/crimes', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const zone = Object.values(CRIME_ZONES).find(z => z.prison_ids.includes(user.prison_id || 1)) || CRIME_ZONES.south_dakota;
  const rows = await all('SELECT * FROM crime_mastery WHERE user_id=?', [user.id]);
  const mastery = Object.fromEntries(zone.crimes.map(crime => [crime.key, getMastery(rows.find(r => r.crime_key === crime.key), crime, user.speed)]));
  await renderPage(res, 'crimes', user, { zone, CRIME_ZONES, mastery, APPROACHES });
});

router.post('/crimes/commit', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  const zone = Object.values(CRIME_ZONES).find(z => z.prison_ids.includes(user.prison_id || 1));
  const crime = zone?.crimes.find(c => c.key === req.body.crime_key);
  if (!crime) return { error: 'This crime is not available in your city.' };
  if (user.in_jail) return { error: 'You are in jail! Serve your time or bribe out.' };
  if (user.in_hospital) return { error: "You're in the hospital!" };
  if (user.nerve < crime.nerve) return { error: `Need ${crime.nerve} nerve to attempt this. You have ${user.nerve}.` };
  if ((user.stamina ?? 100) < crime.stamina) return { error: `Need ${crime.stamina}% stamina. You have ${user.stamina ?? 100}%.` };

  const row = await tx.get('SELECT * FROM crime_mastery WHERE user_id=? AND crime_key=?', [user.id, crime.key]);
  const approach = APPROACHES.find(a => a.key === (req.body.approach ?? 'balanced'));
  if (!approach) return { error: 'Choose a valid crime approach.' };
  const skill = getMastery(row, crime, user.speed);
  const quote = crimeQuote(crime, skill, user, approach);
  const caught = Math.random() * 100 < quote.risk;
  user.nerve -= crime.nerve;
  user.stamina = Math.max(0, (user.stamina ?? 100) - crime.stamina);
  let cashGain = 0;
  let msg;
  let jailSeconds = 0;
  if (caught) {
    jailSeconds = Math.ceil((60 + crime.nerve * 30)*(user.itemBonuses?.modifiers.jail||1));
    user.in_jail = 1;
    user.jail_until = Math.floor(Date.now() / 1000) + jailSeconds;
    user.jail_reason = `Caught committing: ${crime.name}`;
    msg = `Busted! ${crime.name} landed you in jail for ${Math.ceil(jailSeconds / 60)} minutes.`;
  } else {
    const baseCash = Math.floor(Math.random() * (crime.cash[1] - crime.cash[0] + 1)) + crime.cash[0];
    cashGain = Math.floor(baseCash * quote.multiplier);
    user.cash += cashGain;
    user.crime_xp += crime.nerve*(1+(user.itemBonuses?.modifiers.crimeXp||0))*(user.itemBonuses?.crimeTools[crime.key]?1.05:1);
    user.rep += crime.rep;
    user.xp += Math.floor(crime.xp*(1+(user.itemBonuses?.modifiers.xp||0)));
    msg = `Success! ${crime.name} earned you $${cashGain.toLocaleString()}, ${crime.xp} XP and ${crime.rep} reputation and ${crime.nerve} criminal experience.`;
  }
  user.heat = Math.min(100, user.heat + approach.heat + (caught ? 10 : 0));
  await tx.run(`INSERT INTO player_dynamics (user_id,heat,heat_updated) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET heat=excluded.heat,heat_updated=excluded.heat_updated`, [user.id, user.heat, Math.floor(Date.now() / 1000)]);
  msg += ` ${approach.name} approach · Heat ${user.heat}/100.`;
  // Mutate the player once, stripping passive bonuses through saveUser.
  const levelUp = await levelUpCheck(user, async () => {});
  await saveUser(user, tx.run);
  await tx.run(`INSERT INTO crime_mastery (user_id, crime_key, attempts, successes) VALUES (?,?,1,?)
    ON CONFLICT(user_id, crime_key) DO UPDATE SET attempts=attempts+1, successes=successes+excluded.successes`, [user.id, crime.key, caught ? 0 : 1]);
  await recordActivity(user.id, 'crimes', tx);
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'crime',?)", [user.id, msg]);
  const mastery = getMastery({ attempts: (row?.attempts || 0) + 1, successes: (row?.successes || 0) + (caught ? 0 : 1) }, crime, user.speed);
  return { caught, msg, cashGain, jailSeconds, mastery, risk: quote.risk, user: statBlock(await getUser(user.id, tx)), levelUp };
}));

router.post('/daily/claim', requireAuth, progressionAction(async (req, tx) => {
  const daily = await getDailyProgress(req.session.userId, tx);
  if (daily.claimed) return { error: 'You already claimed today’s reward.' };
  if (!daily.complete) return { error: 'Complete both daily objectives first.' };
  await tx.run('UPDATE daily_progress SET claimed=1 WHERE user_id=? AND day=?', [req.session.userId, daily.day]);
  await tx.run('UPDATE users SET cash=cash+500, rep=rep+3 WHERE id=?', [req.session.userId]);
  const msg = 'Daily objectives complete! You received $500 and 3 reputation.';
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'daily',?)", [req.session.userId, msg]);
  return { msg, user: statBlock(await getUser(req.session.userId, tx)) };
}));

// ── EDUCATION ──
router.get('/education', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const courses = await all('SELECT * FROM education WHERE user_id=?', [user.id]);
  await renderPage(res, 'education', user, { COURSES, courses, now: Math.floor(Date.now() / 1000) });
});
router.post('/education/start', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  let course = COURSES.find(c => c.key === req.body.course_key);
  if (!course) return { error: 'Unknown course.' };
  if (user.in_jail || user.in_hospital) return { error: 'You cannot enroll while in jail or the hospital.' };
  const courses = await tx.all('SELECT * FROM education WHERE user_id=?', [user.id]);
  if (courses.some(c => c.course_key === course.key)) return { error: 'You have already enrolled in this course.' };
  if (courses.some(c => c.completed_at === null)) return { error: 'Finish your current course first.' };
  if (course.requires && !courses.some(c => c.course_key === course.requires && c.completed_at !== null)) return { error: 'Complete the prerequisite course first.' };
  const stockPerk=require('../middleware/stocks').hasBenefit;
  course={...course,cost:await stockPerk(tx,user.id,'IST')?0:course.cost,duration:Math.ceil(course.duration*(await stockPerk(tx,user.id,'WSU')?.9:1))};
  if (user.cash < course.cost) return { error: `Need $${course.cost.toLocaleString()} to enroll.` };
  const now = Math.floor(Date.now() / 1000);
  await tx.run('UPDATE users SET cash=cash-? WHERE id=?', [course.cost, user.id]);
  await tx.run('INSERT INTO education (user_id,course_key,started_at,finishes_at) VALUES (?,?,?,?)', [user.id, course.key, now, now + course.duration]);
  const msg = `Enrolled in ${course.name}. Study continues while you are offline.`;
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'education',?)", [user.id, msg]);
  return { msg, user: statBlock(await getUser(user.id, tx)) };
}));
router.post('/education/complete', requireAuth, progressionAction(async (req, tx) => {
  const course = COURSES.find(c => c.key === req.body.course_key);
  if (!course) return { error: 'Unknown course.' };
  const row = await tx.get('SELECT * FROM education WHERE user_id=? AND course_key=?', [req.session.userId, course.key]);
  if (!row || row.completed_at !== null) return { error: 'No unfinished course to complete.' };
  const now = Math.floor(Date.now() / 1000);
  if (row.finishes_at > now) return { error: 'Your course is still in progress.' };
  await tx.run('UPDATE education SET completed_at=? WHERE user_id=? AND course_key=?', [now, req.session.userId, course.key]);
  const msg = `${course.name} complete! ${course.desc}`;
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'education',?)", [req.session.userId, msg]);
  return { msg, user: statBlock(await getUser(req.session.userId, tx)) };
}));

// ── MISSIONS (kept for legacy, redirects to crimes) ──
router.get('/missions', requireAuth, async (req, res) => {
  res.redirect('/crimes');
});


// Victory rewards are selected after combat and can only settle once.
async function finishVictory(tx,id,ending) {
  const pending=await tx.get('SELECT * FROM battle_victories WHERE attacker_id=?',[id]);
  if(!pending)return {error:'No victory is awaiting an outcome.'};
  if(!['leave','mug','hospitalize'].includes(ending))return {error:'Choose Leave, Mug or Hospitalize.'};
  const attacker=await getUser(id,tx),defender=await getUser(pending.defender_id,tx);
  const now=Math.floor(Date.now()/1000);
  if(pending.expires_at<=now)ending='leave';
  const xpGain=Math.floor(pending.base_xp*(ending==='leave'?1.5:ending==='mug'?.6:1)*(1+(attacker.itemBonuses?.modifiers.xp||0)));
  const repGained=ending==='leave'?3+Math.floor(defender.level/3):ending==='hospitalize'?2:1;
  const cashStolen=ending==='mug'?Math.max(0,Math.floor(defender.cash*(5+Math.floor(Math.random()*11))/100)):0;
  attacker.cash+=cashStolen;defender.cash-=cashStolen;attacker.rep+=repGained;attacker.xp+=xpGain;
  const seconds=ending==='hospitalize'?3600:(20+Math.floor(Math.random()*11))*60;
  defender.in_hospital=1;defender.hospital_until=now+Math.ceil(seconds*(defender.itemBonuses?.modifiers.hospital||1));
  defender.hospital_reason=`Defeated by ${attacker.username} (${ending})`;
  const msg=(ending==='leave'?'Left on the street. Maximum experience and respect.':ending==='mug'?`Mugged $${cashStolen.toLocaleString()}.`:'Opponent hospitalized for an extended recovery.')+` +${xpGain} XP, +${repGained} respect.`;
  const levelUp=await levelUpCheck(attacker,async()=>{});
  await saveUser(attacker,tx.run);await saveUser(defender,tx.run);
  await tx.run("UPDATE attacks SET ending=?,cash_stolen=?,rep_gained=?,log=log||char(10)||? WHERE id=?",[ending,cashStolen,repGained,msg,pending.attack_id]);
  await tx.run('DELETE FROM battle_victories WHERE attack_id=?',[pending.attack_id]);
  await tx.run("INSERT INTO events(user_id,type,message) VALUES(?,'battle',?)",[attacker.id,msg]);
  await tx.run("INSERT INTO events(user_id,type,message) VALUES(?,'attacked',?)",[defender.id,attacker.username+' chose '+ending+' after defeating you.']);
  return {result:'win',won:true,ending,cashStolen,xpGain,repGained,msg,levelUp,user:statBlock(await getUser(id,tx))};
}
async function expireVictories(tx,id) {
  const rows=await tx.all('SELECT attacker_id FROM battle_victories WHERE (attacker_id=? OR defender_id=?) AND expires_at<=?',[id,id,Math.floor(Date.now()/1000)]);
  for(const row of rows)await finishVictory(tx,row.attacker_id,'leave');
}
router.post('/battles/finish',requireAuth,progressionAction(async(req,tx)=>finishVictory(tx,req.session.userId,req.body.ending)));
router.post('/mug',requireAuth,(req,res)=>res.json({error:'Start an attack first. Mug is available only after you win.'}));

// ── BATTLES ──
router.get('/battles', requireAuth, async (req, res) => {
  await withTransaction(async tx=>{await expireSessions(tx,req.session.userId);await expireVictories(tx,req.session.userId);});
  const user = await getUser(req.session.userId);
  const pending=await get('SELECT v.*,a.log,u.username,u.max_hp FROM battle_victories v JOIN attacks a ON a.id=v.attack_id JOIN users u ON u.id=v.defender_id WHERE v.attacker_id=?',[user.id]);
  const now = Math.floor(Date.now()/1000);
  const targets = await all(
    `SELECT id,username,level,hp,max_hp,strength,defense,speed,dexterity,rep,gang_id,last_active,in_hospital,in_jail,hospital_until,jail_until
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
  const activeDrug=await get('SELECT source_id FROM item_drug_effects WHERE user_id=? AND expires_at>?',[user.id,now]);
  const active=await get('SELECT * FROM battle_sessions WHERE attacker_id=?',[user.id]);
  const battle=active?battleView(active,JSON.parse(active.state)):null;
  await renderPage(res, 'battles', user, { battle, targets, history, now, cdMap, STANCES, pending, energyCost:activeDrug?.source_id===870?15:25 });
});

// Interactive fights persist every turn. A version token rejects repeated clicks.
function battleView(row,state) {
  const a=state.engine?.fighters[0].user||state.attacker,d=state.engine?.fighters[1].user||state.defender;
  return {attackId:row.attack_id,version:row.version,expiresAt:row.expires_at,round:state.engine?.round||0,
    target:{id:d.id,username:d.username,hp:d.hp,max_hp:d.max_hp},hp:a.hp,max_hp:a.max_hp,log:state.log,
    weapons:state.units.map(w=>({id:w.id,name:w.name,img:w.img,category:w.profile.category,damage:w.damage,accuracy:w.accuracy,loaded:w.loaded,clip:w.profile.clip,caliber:w.profile.caliber,reserve:state.attacker.combat.ammo[w.profile.caliber+'|'+w.ammo_type]||0})),
    temporary:state.attacker.combat.usedTemporary?[]:state.temporary.map(t=>({key:t.key,name:t.name,img:t.img})),kick:state.kick};
}
async function endSession(tx,row,state,result) {
  const a=await getUser(row.attacker_id,tx),d=await getUser(row.defender_id,tx),now=Math.floor(Date.now()/1000);
  const fighters=state.engine?.fighters;
  a.hp=Math.max(1,fighters?.[0].user.hp??state.attacker.hp);d.hp=Math.max(1,fighters?.[1].user.hp??state.defender.hp);
  if(result==='win'){a.wins++;d.losses++;d.hp=Math.max(1,Math.floor(d.max_hp*.2));d.in_hospital=1;d.hospital_until=now+300;d.hospital_reason='Defeated; winner choosing outcome';}
  if(result==='loss'){a.losses++;d.wins++;a.hp=Math.max(1,Math.floor(a.max_hp*.2));a.in_hospital=1;a.hospital_until=now+180;a.hospital_reason='Lost a fight against '+d.username;}
  const msg=result==='win'?'YOU WON! Choose Leave, Mug or Hospitalize.':result==='loss'?'You lost and were hospitalized.':'Stalemate. No victory rewards were awarded.';
  state.log.push(msg);
  await saveUser(a,tx.run);await saveUser(d,tx.run);
  if(result==='win'||result==='loss')await tx.run('DELETE FROM combat_buffs WHERE user_id=?',[result==='win'?d.id:a.id]);
  await tx.run('UPDATE attacks SET result=?,attacker_won=?,ending=?,damage_dealt=?,damage_taken=?,log=? WHERE id=?',[result,Number(result==='win'),result==='win'?'pending':'none',state.damageDealt,state.damageTaken,state.log.join('\n'),row.attack_id]);
  if(result==='win')await tx.run('INSERT INTO battle_victories(attack_id,attacker_id,defender_id,base_xp,expires_at) VALUES(?,?,?,?,?)',[row.attack_id,a.id,d.id,Math.max(15,20+d.level*5+(d.level-a.level)*10),now+300]);
  await tx.run('DELETE FROM battle_sessions WHERE attack_id=?',[row.attack_id]);
  for(const [id,message] of [[a.id,msg],[d.id,a.username+' attacked you: '+result+'.']])await tx.run("INSERT INTO events(user_id,type,message) VALUES(?,'battle',?)",[id,message]);
  return {result,won:result==='win',ending:result==='win'?'pending':'none',expiresAt:now+300,target:{id:d.id,username:d.username,hp:result==='win'?0:d.hp,max_hp:d.max_hp},log:state.log,msg,user:statBlock(await getUser(a.id,tx)),cashStolen:0,xpGain:0,repGained:0};
}
async function expireSessions(tx,id) {
  const rows=await tx.all('SELECT * FROM battle_sessions WHERE (attacker_id=? OR defender_id=?) AND expires_at<=?',[id,id,Math.floor(Date.now()/1000)]);
  for(const row of rows)await endSession(tx,row,JSON.parse(row.state),'draw');
}
async function startBattle(req,tx) {
  const id=req.session.userId;await expireSessions(tx,id);await expireVictories(tx,id);
  const existing=await tx.get('SELECT * FROM battle_sessions WHERE attacker_id=?',[id]);
  if(existing)return {error:'A fight is already active. Resume it on the attacking page.'};
  const attacker=await getUser(id,tx),tid=typeof req.body.target_id==='number'||typeof req.body.target_id==='string'?Number(req.body.target_id):NaN;
  if(!Number.isSafeInteger(tid)||tid<=0||tid===id)return {error:'Invalid target.'};
  const stance=req.body.stance??'balanced';if(!Object.hasOwn(STANCES,stance))return {error:'Choose a valid stance.'};
  await expireSessions(tx,tid);await expireVictories(tx,tid);
  for(const table of ['battle_sessions','battle_victories'])if(await tx.get(`SELECT attack_id FROM ${table} WHERE attacker_id IN (?,?) OR defender_id IN (?,?)`,[id,tid,id,tid]))return {error:'A player is already in a fight or awaiting its outcome.'};
  const now=Math.floor(Date.now()/1000),drug=await tx.get('SELECT source_id FROM item_drug_effects WHERE user_id=? AND expires_at>?',[id,now]),energyCost=drug?.source_id===870?15:25;
  if(attacker.energy<energyCost)return {error:`Need ${energyCost} energy to fight.`};
  if(attacker.stamina<10)return {error:'Need at least 10% stamina to fight.'};
  if(attacker.in_hospital||attacker.in_jail)return {error:"You can't fight from here."};
  const defender=await getUser(tid,tx);if(!defender)return {error:'Invalid target.'};
  if(defender.travel.phase!=='home')return {error:'Target is away on a city trip.'};
  if(defender.in_hospital||defender.in_jail)return {error:'Target is recovering in hospital or jail.'};
  if(defender.prison_id!==attacker.prison_id)return {error:'Target is in a different city.'};
  const cd=await tx.get('SELECT last_attack FROM attack_cooldowns WHERE attacker_id=? AND defender_id=?',[id,tid]);
  if(cd&&now-cd.last_attack<600)return {error:'Wait before attacking this person again.'};
  attacker.combat=await weapons.prepare(tx,attacker,now);defender.combat=await weapons.prepare(tx,defender,now);
  const supplies=await weapons.state(tx,id),profiles=require('../middleware/weapon-profiles');
  const units=supplies.units.filter(w=>w.damage!=null&&w.accuracy!=null).map(w=>({...w,damage:w.effectiveDamage,accuracy:w.effectiveAccuracy}));
  const temporary=supplies.temporary.filter(t=>{const p=profiles.profileFor(t.item);return p.kind!=='boss'&&(p.kind!=='needle'||supplies.courses.has('BIO3420'));}).map(t=>({...profiles.profileFor(t.item),key:t.item_key,type:t.item_type,img:t.item.img}));
  const state={attacker,defender,units,temporary,kick:supplies.courses.has('martial_kick'),stance,log:['Fight started. Choose a weapon or action.'],damageDealt:0,damageTaken:0};
  attacker.energy-=energyCost;attacker.stamina=Math.max(0,attacker.stamina-10);defender.stamina=Math.max(0,defender.stamina-5);
  await saveUser(attacker,tx.run);await saveUser(defender,tx.run);
  await tx.run('INSERT OR REPLACE INTO attack_cooldowns(attacker_id,defender_id,last_attack) VALUES(?,?,?)',[id,tid,now]);
  const attack=await tx.run("INSERT INTO attacks(attacker_id,defender_id,attacker_won,result,ending,stance,log) VALUES(?,?,0,'ongoing','none',?,?)",[id,tid,stance,state.log.join('\n')]);
  const row={attack_id:attack.lastID,attacker_id:id,defender_id:tid,started_at:now,expires_at:now+300,version:0};
  await tx.run('INSERT INTO battle_sessions(attack_id,attacker_id,defender_id,started_at,expires_at,state) VALUES(?,?,?,?,?,?)',[row.attack_id,id,tid,now,now+300,JSON.stringify(state)]);
  return {result:'ongoing',battle:battleView(row,state),user:statBlock(await getUser(id,tx)),msg:`Fight started. ${energyCost} Energy spent.`};
}
router.post('/battles/attack',requireAuth,progressionAction(startBattle));
router.post('/battles/start',requireAuth,async(req,res,next)=>{
  try{const result=await withTransaction(tx=>startBattle(req,tx));if(result.error)return res.status(400).send(result.error+' <a href="/battles">Back to attacking</a>');res.redirect('/battles');}catch(e){next(e);}
});
router.get('/battles/state',requireAuth,async(req,res,next)=>{
  try{res.json(await withTransaction(async tx=>{
    await expireSessions(tx,req.session.userId);await expireVictories(tx,req.session.userId);
    const row=await tx.get('SELECT * FROM battle_sessions WHERE attacker_id=?',[req.session.userId]);
    const pending=await tx.get('SELECT * FROM battle_victories WHERE attacker_id=?',[req.session.userId]);
    return {battle:row?battleView(row,JSON.parse(row.state)):null,pending:!!pending,user:statBlock(await getUser(req.session.userId,tx))};
  }));}catch(e){next(e);}
});
router.post('/battles/turn',requireAuth,progressionAction(async(req,tx)=>{
  const row=await tx.get('SELECT * FROM battle_sessions WHERE attacker_id=?',[req.session.userId]);if(!row)return {error:'No active fight. Refresh the page.'};
  const state=JSON.parse(row.state),now=Math.floor(Date.now()/1000);
  if(now>=row.expires_at)return endSession(tx,row,state,'draw');
  if(req.body.attack_id!==row.attack_id||req.body.version!==row.version)return {error:'This turn was already played. Refresh to load the current fight.'};
  const action=req.body.action;if(!['weapon','fists','kick','temporary','reload'].includes(action))return {error:'Choose a combat action.'};
  const a=state.engine?.fighters[0].user||state.attacker,d=state.engine?.fighters[1].user||state.defender;
  if(state.engine){a.combat=state.engine.fighters[0].combat;d.combat=state.engine.fighters[1].combat;}
  state.attacker=a;state.defender=d;
  const c=a.combat;
  if(action==='weapon'||action==='reload'){
    const unit=state.units.find(w=>w.id===req.body.weapon_id);if(!unit)return {error:'Choose an owned weapon.'};
    if(action==='reload'&&(!unit.profile.caliber||unit.loaded>=unit.profile.clip||!(c.ammo[unit.profile.caliber+'|'+unit.ammo_type]>0)))return {error:'No reload is available for that weapon.'};
    if(action==='weapon'&&unit.profile.caliber&&unit.loaded<=0)return {error:'Magazine empty. Reload or choose another action.'};
    c.weapon=unit;
  }else if(action==='temporary'){
    const t=state.temporary.find(t=>t.key===req.body.item_key);if(!t||c.usedTemporary)return {error:'Temporary item unavailable. One temporary item per fight.'};c.temporary=t;
  }else{
    if(action==='kick'&&!state.kick)return {error:'Complete Kick Training first.'};
    c.weapon=null;c.unarmed=action==='kick'?{name:'Kick',damage:30,accuracy:40.71}:{name:'Fists',damage:10,accuracy:50};
  }
  const oldATemp=c.usedTemporary,oldDTemp=d.combat.usedTemporary;
  const fight=simulateFight(a,d,state.stance,Math.random,{manual:true,action,elapsed:now-row.started_at,state:state.engine});
  a.hp=fight.aHp;d.hp=fight.dHp;state.engine=fight.state;state.log.push(...fight.log.slice(1));state.damageDealt+=fight.damageDealt;state.damageTaken+=fight.damageTaken;
  // Restore aliases after JSON loading and persist only the new turn's consumption.
  if(c.weapon){const index=state.units.findIndex(w=>w.id===c.weapon.id);state.units[index]=c.weapon;}
  for(const [u,already] of [[a,oldATemp],[d,oldDTemp]]){
    const copy={...u.combat,usedTemporary:u.combat.usedTemporary&&!already,buffs:u.combat.buffs.map(b=>({...b,remaining:Math.max(0,b.remaining-(now-row.started_at))}))};
    await weapons.persist(tx,u,copy,now);
    await tx.run('UPDATE users SET hp=? WHERE id=?',[Math.max(1,u.hp),u.id]);
  }
  if(fight.result!=='ongoing')return endSession(tx,row,state,fight.result);
  row.version++;
  await tx.run('UPDATE battle_sessions SET state=?,version=? WHERE attack_id=?',[JSON.stringify(state),row.version,row.attack_id]);
  await tx.run('UPDATE attacks SET log=?,damage_dealt=?,damage_taken=? WHERE id=?',[state.log.join('\n'),state.damageDealt,state.damageTaken,row.attack_id]);
  return {result:'ongoing',battle:battleView(row,state),user:statBlock(await getUser(a.id,tx)),msg:'Choose your next action.'};
}));

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
  const medicalState=await medical.settings({get,run},user);
  const cooldowns=await all('SELECT * FROM recovery_cooldowns WHERE user_id=?',[user.id]);
  const supplies=(await all("SELECT * FROM inventory WHERE user_id=? AND item_type IN ('item','drug') AND quantity>0",[user.id]))
    .map(row=>describeItem(row,cooldowns)).filter(row=>medical.rule(getItem(row.item_type,row.item_key)));
  for(const patient of icuList) {
    const p=await medical.profile({get,run},patient.id);
    patient.accepts_revives=p.accepts_revives;
  }
  const factionLeader=user.gang_id?await get('SELECT id FROM gangs WHERE id=? AND leader_id=?',[user.gang_id,user.id]):null;
  await renderPage(res, 'infirmary', user, { icuList, timeLeft, bribeCost, now, medicalState, cooldowns, supplies, factionLeader });
});

router.post('/infirmary/heal', requireAuth, progressionAction(async(req,tx)=>{
  const user=await getUser(req.session.userId,tx);
  if(user.in_hospital || user.in_jail || user.travel?.phase!=='home')return {error:'Use medical items while hospitalized; paid treatment is available at home after release.'};
  const cost=Math.ceil((user.max_hp-user.hp)*2);
  if(cost<=0)return {error:'Already full HP.'};
  if(user.cash<cost)return {error:`Need $${cost} to heal.`};
  user.cash-=cost;user.hp=user.max_hp;await saveUser(user,tx.run);
  return {msg:`Healed to full for $${cost}.`,user:statBlock(user)};
}));
router.post('/infirmary/bribe',requireAuth,progressionAction(async(req,tx)=>{
  const user=await getUser(req.session.userId,tx);
  if(!user.in_hospital)return {error:'You are not in hospital.'};
  const state=await medical.settings(tx,user);
  if(state.radiation_until>Date.now()/1000)return {error:'Radiation poisoning requires Neumune treatment.'};
  const cost=Math.max(500,Math.ceil((user.hospital_until-Math.floor(Date.now()/1000))/60)*1000);
  if(user.cash<cost)return {error:`Need $${cost} for priority care.`};
  user.cash-=cost;user.in_hospital=0;user.hospital_until=0;user.hospital_reason=null;
  user.hp=Math.max(user.hp,Math.ceil(user.max_hp*.3));await saveUser(user,tx.run);
  return {msg:`Priority care completed for $${cost}.`,user:statBlock(user)};
}));
router.post('/infirmary/preferences',requireAuth,progressionAction(async(req,tx)=>{
  if(typeof req.body.accepts_revives!=='boolean')return {error:'Choose whether to accept revives.'};
  await medical.profile(tx,req.session.userId);
  await tx.run('UPDATE medical_profiles SET accepts_revives=? WHERE user_id=?',[Number(req.body.accepts_revives),req.session.userId]);
  return {msg:'Revive preference saved.'};
}));
router.post('/infirmary/revive',requireAuth,progressionAction(async(req,tx)=>{
  const user=await getUser(req.session.userId,tx), targetId=wholeNumber(req.body.target_id);
  if(!Number.isSafeInteger(targetId) || targetId===user.id)return {error:'Choose another patient.'};
  const state=await medical.settings(tx,user);
  if(!state.revive_unlocked)return {error:'Qualify and work as a Brain Surgeon to unlock reviving.'};
  if(user.in_hospital || user.in_jail || user.travel?.phase!=='home')return {error:'You must be at home and out of hospital and jail to revive.'};
  const target=await getUser(targetId,tx);
  if(!target || target.prison_id!==user.prison_id || target.travel?.phase!=='home' || !target.in_hospital)return {error:'That patient is unavailable.'};
  const patient=await medical.settings(tx,target);
  if(!patient.accepts_revives)return {error:'That patient is not accepting revives.'};
  if(patient.radiation_until>Date.now()/1000)return {error:'Radiation poisoning requires Neumune treatment.'};
  if(user.energy<state.reviveCost)return {error:`Need ${state.reviveCost} energy.`};
  user.energy-=state.reviveCost;
  const chance=Math.min(100,50+state.revive_skill/2), success=Math.random()*100<chance;
  if(success){
    target.in_hospital=0;target.hospital_until=0;target.hospital_reason=null;
    target.hp=Math.max(1,Math.ceil(target.max_hp*state.revive_skill/100));
    await saveUser(target,tx.run);
    await tx.run('UPDATE medical_profiles SET revive_skill=MIN(100,revive_skill+1) WHERE user_id=?',[user.id]);
    await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'medical',?)",[target.id,`${user.username} revived you.`]);
  }
  await saveUser(user,tx.run);
  return {success,chance,msg:success?'Revive successful. Your skill increased.':'Revive failed. Energy was spent.',user:statBlock(user)};
}));
router.post('/infirmary/faction-upgrade',requireAuth,progressionAction(async(req,tx)=>{
  const user=await getUser(req.session.userId,tx), key=req.body.upgrade;
  if(!['capacity','effectiveness','reviver'].includes(key))return {error:'Invalid medical upgrade.'};
  const gang=await tx.get('SELECT * FROM gangs WHERE id=? AND leader_id=?',[user.gang_id,user.id]);
  if(!gang)return {error:'Only your faction leader can buy upgrades.'};
  if(user.in_hospital || user.in_jail)return {error:'Leave hospital or jail before managing faction funds.'};
  await tx.run('INSERT OR IGNORE INTO faction_medical (gang_id) VALUES (?)',[gang.id]);
  const row=await tx.get('SELECT * FROM faction_medical WHERE gang_id=?',[gang.id]);
  const cap=key==='reviver'?10:3, cost=(row[key]+1)*250000;
  if(row[key]>=cap)return {error:'This upgrade is already at its maximum.'};
  if(gang.bank<cost)return {error:`Your faction bank needs $${cost.toLocaleString()}.`};
  await tx.run('UPDATE gangs SET bank=bank-? WHERE id=?',[cost,gang.id]);
  await tx.run(`UPDATE faction_medical SET ${key}=${key}+1 WHERE gang_id=?`,[gang.id]);
  return {msg:'Faction medical upgrade purchased.'};
}));

// ── MARKETPLACE ──
router.get(['/market', '/prison/marketplace'], requireAuth, async (req, res, next) => {
  try {
    const stock = await withTransaction(tx => stockFor(tx,'home',shopItems()));
    const user = await getUser(req.session.userId);
    const rows = stock.filter(s=>s.available).map(s=>({
      ...describeItem({item_type:s.type,item_key:s.key,quantity:1}),
      stock:s.quantity,available:s.quantity>0,restockAt:s.restock_at,tier:1,
    }));
    await renderPage(res,'marketplace',user,{rows,categories:categoryCounts(rows),restockAt:stock[0]?.restock_at});
  } catch(err) {next(err);}
});

router.post('/marketplace/buy', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  const { item_key, item_type } = req.body;
  const item = getItem(item_type, item_key);
  if (!item || !['item','weapon','armor','gear','drug'].includes(item_type)) return { error: 'Choose a valid shop item and category.' };
  if (!canBuyInPrison(item_type, item_key, user.prison_id)) return { error: 'This item is unavailable in the shop. Check player listings for tradeable items.' };
  const quantity = wholeNumber(req.body.quantity === undefined ? 1 : req.body.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) return { error: 'Choose a whole quantity between 1 and 100.' };
  const stock = (await stockFor(tx,'home',[{...item,type:item_type,key:item_key}]))[0];
  if(!stock.available || stock.quantity<quantity) return {error:'This item has sold out or rotated out. Check the market after the next hourly refresh.'};
  const cost = stock.price * quantity;
  if (!Number.isSafeInteger(cost) || cost < 1) return { error: 'This item is not for sale here.' };
  if (user.cash < cost) return { error: `Need $${cost.toLocaleString()} to buy this.` };
  if(!await debitStock(tx,'home',item_type,item_key,quantity)) return {error:'Stock changed. Refresh the market.'};
  await tx.run('UPDATE users SET cash=cash-? WHERE id=?', [cost, user.id]);
  const owned = await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=? ORDER BY id LIMIT 1', [user.id, item_key, item_type]);
  if (owned) await tx.run('UPDATE inventory SET quantity=quantity+? WHERE id=?', [quantity, owned.id]);
  else await tx.run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,?)', [user.id, item_key, item_type, quantity]);
  if(weapons.supports(item_key))await weapons.sync(tx,user.id);
  await tx.run("INSERT INTO transaction_logs (type,from_id,item_key,item_type,quantity,cash_amount,note) VALUES ('shop_purchase',?,?,?,?,?,?)", [user.id,item_key,item_type,quantity,cost,'Prison marketplace purchase']);
  return { stock:stock.quantity-quantity, msg: `Bought ${quantity} × ${item.name} for $${cost.toLocaleString()}.`, user: statBlock(await getUser(user.id, tx)) };
}));

// ── BANK ──
router.get('/bank', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  await renderPage(res, 'bank', user);
});
router.post('/bank/deposit', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  const amount = typeof req.body.amount === 'number' || typeof req.body.amount === 'string' ? Number(req.body.amount) : NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > user.cash) return ({ error: 'Invalid amount.' });
  user.cash -= amount; user.bank = (user.bank||0) + amount;
  await saveUser(user, tx.run); return ({ msg: `Deposited $${amount}.`, user: statBlock(user) });
}));
router.post('/bank/withdraw', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  const amount = typeof req.body.amount === 'number' || typeof req.body.amount === 'string' ? Number(req.body.amount) : NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > (user.bank||0)) return ({ error: 'Invalid amount.' });
  user.cash += amount; user.bank -= amount;
  await saveUser(user, tx.run); return ({ msg: `Withdrew $${amount}.`, user: statBlock(user) });
}));

// ── SHOUTBOX ──
router.get('/shoutbox', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const messages = await all(`SELECT s.*,u.level FROM shoutbox s JOIN users u ON u.id=s.user_id WHERE s.gang_only=0 ORDER BY s.created_at DESC LIMIT 50`);
  await renderPage(res, 'shoutbox', user, { messages: messages.reverse() });
});

// ── INMATES ──
// ── TRANSACTION LOGS ──
router.get('/logs', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const type   = req.query.type || '';
  const page   = Math.max(1, parseInt(req.query.page)||1);
  const limit  = 50;
  const offset = (page - 1) * limit;
  let whereSQL = '';
  const params = [];
  if (type) { whereSQL = 'WHERE type=?'; params.push(type); }
  const logs  = await all(`SELECT * FROM transaction_logs ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  const total = (await get(`SELECT COUNT(*) as c FROM transaction_logs ${whereSQL}`, params))?.c || 0;
  await renderPage(res, 'logs', user, { logs, total, page, limit, type });
});

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
  if (!user.in_jail) return res.json({ error: 'You are not in jail.' });
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
  for(const slot of ['weapon','armor','gear'])if(!getItem(slot,equipped[slot]))equipped[slot]=null;
  const arsenal=await withTransaction(tx=>weapons.state(tx,user.id));
  await renderPage(res, 'equipment', user, { arsenal, attachments:weapons.ATTACHMENTS, ammoKinds:weapons.AMMO, equipped, invWeapons:invWeapons.filter(r=>getItem('weapon',r.item_key)), invArmor:invArmor.filter(r=>getItem('armor',r.item_key)), invGear:invGear.filter(r=>getItem('gear',r.item_key)), WEAPONS, ARMOR, GEAR });
});

router.post('/equipment/equip', requireAuth, progressionAction(async (req, tx) => {
  const { action, slot, key } = req.body;
  const catalog = { weapon: WEAPONS, armor: ARMOR, gear: GEAR };
  if (!['weapon','armor','gear'].includes(slot) || !['equip','unequip'].includes(action)) return { error: 'Invalid equipment action.' };
  if (action === 'equip') {
    if(slot==='weapon'&&catalog.weapon[key]?.weaponProfile?.category==='temporary')return {error:'Prepare temporary weapons as opening items instead.'};
    if (!Object.hasOwn(catalog[slot], key)) return { error: 'Unknown equipment.' };
    const owned = await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=? AND quantity>0', [req.session.userId, key, slot]);
    if (!owned) return { error: "You don't own that item." };
  }
  if(slot==='weapon') {
    const units=await weapons.sync(tx,req.session.userId);
    const unit=action==='equip'?units.find(u=>u.item_key===key):null;
    if(unit && (unit.damage==null||unit.accuracy==null))return {error:'This weapon has unknown stats and cannot be equipped yet.'};
    await tx.run('INSERT INTO combat_loadouts(user_id,instance_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET instance_id=excluded.instance_id',[req.session.userId,unit?.id||null]);
  }
  await tx.run('INSERT OR IGNORE INTO equipment (user_id) VALUES (?)', [req.session.userId]);
  await tx.run(`UPDATE equipment SET ${slot}=? WHERE user_id=?`, [action === 'unequip' ? null : key, req.session.userId]);
  return { msg: action === 'unequip' ? 'Unequipped.' : 'Equipped! Bonuses apply to your stats and combat.', user: statBlock(await getUser(req.session.userId, tx)) };
}));

// ── INVENTORY ──
router.get('/inventory', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const owned = await all('SELECT * FROM inventory WHERE user_id=? AND quantity>0', [user.id]);
  const furnishings = await all(
    'SELECT item_key, COUNT(*) AS quantity FROM cell_amenities WHERE user_id=? AND placed_tile IS NULL GROUP BY item_key',
    [user.id]
  );
  const equipped = await get('SELECT * FROM equipment WHERE user_id=?', [user.id]) || {};
  const cooldowns = await all('SELECT * FROM recovery_cooldowns WHERE user_id=?', [user.id]);
  const rows = [...owned, ...furnishings.map(row => ({ ...row, item_type: 'amenity' }))]
    .filter(row => getItem(row.item_type,row.item_key))
    .map(row => describeItem(row, cooldowns, equipped));
  const medicalState=await medical.settings({get,run},user);
  const outfit=await all('SELECT item_key FROM item_outfits WHERE user_id=?',[user.id]);
  rows.forEach(row=>row.worn=outfit.some(w=>w.item_key===row.item_key));
  rows.forEach(row=>{if(row.group?.key==='medical')row.availableAt=medical.allowedAt('medical',row.readyAt,medicalState.cap);});
  const loadout = ['weapon', 'armor', 'gear'].map(slot => ({
    slot, item: rows.find(row => row.item_type === slot && row.equipped) || null,
  }));
  await renderPage(res, 'inventory', user, { rows, loadout, categories: categoryCounts(rows), cooldowns, medicalState, itemState:{book:user.itemBonuses?.book,donator:await get('SELECT until_at FROM item_donator WHERE user_id=?',[user.id]),piggy:await get('SELECT amount FROM item_piggy_banks WHERE user_id=?',[user.id])} });
});

router.post('/inventory/use', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId, tx);
  const { item_key } = req.body;
  const requestedType = req.body.item_type;
  if (typeof item_key !== 'string' || (requestedType !== undefined && !['item', 'drug'].includes(requestedType))) return { error: 'Invalid item.' };
  const owned = requestedType
    ? await tx.get('SELECT * FROM inventory WHERE user_id=? AND item_key=? AND item_type=? AND quantity>0', [user.id, item_key, requestedType])
    : await tx.get("SELECT * FROM inventory WHERE user_id=? AND item_key=? AND item_type IN ('item','drug') AND quantity>0 ORDER BY item_type LIMIT 1", [user.id, item_key]);
  if (!owned) return { error: "You don't own that." };
  const catalog = owned.item_type === 'drug' ? DRUGS : ITEMS;
  const item = Object.hasOwn(catalog, item_key) ? catalog[item_key] : null;
  const used=await itemActions.use(tx,user,item,owned,req.body,saveUser);
  if(used)return {...used,user:statBlock(await getUser(user.id,tx))};
  const needle=await weapons.useNeedle(tx,user,item,owned);
  if(needle)return {...needle,user:statBlock(await getUser(user.id,tx))};
  if (!item || (!item.consumable && !item.permanent)) return { error: 'This item cannot be used directly.' };
  const group = recoveryGroup(item, owned.item_type);
  const now = Math.floor(Date.now() / 1000);
  if(user.travel?.phase!=='home')return {error:'Return home before using supplies.'};
  if(group.key==='booster' && (user.in_hospital || user.in_jail))return {error:'Boosters cannot be used in hospital or jail.'};
  const medState=await medical.settings(tx,user);
  if(group.key==='drug' && medState.radiation_until>now)return {error:'Drugs cannot be used while suffering radiation poisoning.'};
  const special=await medical.use(tx,user,item,now);
  if(special) {
    if(special.error)return special;
    await tx.run('UPDATE inventory SET quantity=quantity-1 WHERE id=? AND quantity>0',[owned.id]);
    await tx.run('DELETE FROM inventory WHERE id=? AND quantity=0',[owned.id]);
    await saveUser(user,tx.run);
    return {...special,user:statBlock(user)};
  }
  const cooldown = await tx.get('SELECT ready_at FROM recovery_cooldowns WHERE user_id=? AND category=?', [user.id, group.key]);
  if (medical.allowedAt(group.key,cooldown?.ready_at||0,medState.cap) > now) return { error: `${group.label} cooldown: wait ${Math.ceil((medical.allowedAt(group.key,cooldown.ready_at,medState.cap) - now) / 60)} minutes.`, readyAt: cooldown.ready_at };
  const e = item.effect;
  const before = JSON.stringify([user.hp, user.energy, user.nerve, user.stamina, user.strength, user.defense, user.speed]);
  for (const [stat, max] of [['hp', 'max_hp'], ['energy', 'max_energy'], ['nerve', 'max_nerve']]) {
    if (e[stat]) user[stat] = Math.min(user[max], user[stat] + e[stat]);
  }
  if (e.stamina) user.stamina = Math.min(100, user.stamina + e.stamina);
  if (item.permanent) for (const stat of ['strength', 'defense', 'speed']) if (e[stat]) user[stat] += e[stat];
  // A temporary speed bonus is not implemented; cocaine explicitly restores energy only.
  if (before === JSON.stringify([user.hp, user.energy, user.nerve, user.stamina, user.strength, user.defense, user.speed])) return { error: 'Your resources are already full. Item kept.' };
  await tx.run('UPDATE inventory SET quantity=quantity-1 WHERE id=?', [owned.id]);
  await tx.run('DELETE FROM inventory WHERE id=? AND quantity=0', [owned.id]);
  await tx.run(`INSERT INTO recovery_cooldowns (user_id,category,ready_at) VALUES (?,?,?)
    ON CONFLICT(user_id,category) DO UPDATE SET ready_at=excluded.ready_at`, [user.id, group.key, (group.key==='medical'?Math.max(now,cooldown?.ready_at||0):now) + group.duration]);
  await saveUser(user, tx.run);
  return { msg: `Used ${item.name}! ${group.label} recovery: ${group.duration / 60} minutes.`, user: statBlock(user), category: group.key, readyAt: (group.key==='medical'?Math.max(now,cooldown?.ready_at||0):now) + group.duration };
}));

router.post('/inventory/drop', requireAuth, progressionAction(async (req,tx) => {
  const user=await getUser(req.session.userId,tx);
  const {item_key,item_type}=req.body;
  if(await itemActions.fundedPiggy(tx,user.id,item_key))return {error:'Break your funded piggy bank before discarding it.'};
  await tx.run('DELETE FROM inventory WHERE user_id=? AND item_key=? AND item_type=?',[user.id,item_key,item_type]);
  if(weapons.supports(item_key))await weapons.sync(tx,user.id);
  return {ok:true};
}));

router.post(['/inventory/list','/openmarket/list'], requireAuth, progressionAction(async (req,tx) => {
  const user=await getUser(req.session.userId,tx);
  const {item_key,item_type}=req.body;
  const price=wholeNumber(req.body.price),qty=wholeNumber(req.body.quantity ?? 1);
  if(await itemActions.fundedPiggy(tx,user.id,item_key))return {error:'Break your funded piggy bank before selling it.'};
  if (!getItem(item_type, item_key) || getItem(item_type, item_key).tradeable === false) return { error: 'This item cannot be traded.' };
  if(!['item','drug','weapon','armor','gear','collectible','amenity'].includes(item_type) || typeof item_key!=='string' || !Number.isSafeInteger(price) || price<1 || price>1000000000 || !Number.isSafeInteger(qty) || qty<1 || qty>1000000) return {error:'Enter a valid item, whole quantity and total asking price.'};
  let weaponUnits=[];
  if(weapons.supports(item_key)){
    const owned=await tx.get("SELECT SUM(quantity) n FROM inventory WHERE user_id=? AND item_key=? AND item_type=?",[user.id,item_key,item_type]);
    if(!owned||owned.n<qty)return {error:'You do not own enough weapons.'};
    weaponUnits=await weapons.pickForListing(tx,user.id,item_key,qty,req.body.instance_id===undefined?undefined:wholeNumber(req.body.instance_id));
    if(!weaponUnits||weaponUnits.length!==qty)return {error:'Choose an owned weapon instance.'};
  }
  if(item_type==='collectible') {
    if(!Object.hasOwn(TRAVEL_ITEMS,item_key) || !await takeInventory(tx,user.id,item_key,qty)) return {error:'You do not own enough of that collectible.'};
  } else if(item_type==='amenity') {
    const rows=await tx.all('SELECT id FROM cell_amenities WHERE user_id=? AND item_key=? AND placed_tile IS NULL ORDER BY id LIMIT ?',[user.id,item_key,qty]);
    if(rows.length<qty) return {error:'Not enough unplaced amenities.'};
    for(const row of rows) await tx.run('DELETE FROM cell_amenities WHERE id=?',[row.id]);
  } else {
    const row=await tx.get('SELECT * FROM inventory WHERE user_id=? AND item_key=? AND item_type=?',[user.id,item_key,item_type]);
    if(!row || row.quantity<qty) return {error:'You do not own enough of that item.'};
    if(row.quantity===qty) await tx.run('DELETE FROM inventory WHERE id=?',[row.id]);
    else await tx.run('UPDATE inventory SET quantity=quantity-? WHERE id=?',[qty,row.id]);
  }
  const listing=await tx.run('INSERT INTO open_market (seller_id,prison_id,item_type,item_key,quantity,price) VALUES (?,?,?,?,?,?)',[user.id,user.prison_id,item_type,item_key,qty,price]);
  await weapons.escrow(tx,weaponUnits,listing.lastID);
  return {msg:`Listed ${qty} × ${TRAVEL_ITEMS[item_key]?.name || item_key} for $${price.toLocaleString()} total. The market takes a 10% sale fee.`};
}));

// ── OPEN MARKET ──
router.get('/openmarket', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prisonId = user.prison_id || 1;
  const prison = PRISONS.find(p => p.id === prisonId) || PRISONS[0];
  const selCat = req.query.cat || null;
  const rows = await all(`SELECT om.*, u.username as seller_name FROM open_market om JOIN users u ON u.id=om.seller_id WHERE om.active=1 AND om.prison_id=? ORDER BY om.listed_at DESC`, [prisonId]);

  const listings = rows.filter(r => getItem(r.item_type,r.item_key)).map(r => {
    const item = getItem(r.item_type,r.item_key);
    return { ...r, img: item?.img||null, display_name: item?.name||r.item_key, desc: item?.desc||'' };
  });

  // Build user's sellable inventory for selected category
  const listedUnits=await all('SELECT w.* FROM weapon_instances w JOIN open_market m ON m.id=w.listing_id WHERE m.active=1 AND m.prison_id=?',[prisonId]);
  for(const listing of listings)listing.weaponUnits=listedUnits.filter(w=>w.listing_id===listing.id).map(weapons.describe);
  const invRows = await all("SELECT * FROM inventory WHERE user_id=?", [user.id]);
  const inventory = invRows.filter(r => getItem(r.item_type,r.item_key)).map(r => {
    const item = getItem(r.item_type,r.item_key);
    return { item_key: r.item_key, item_type: r.item_type, display_name: item?.name||r.item_key, quantity: r.quantity };
  });
  const ownedAmens = await all("SELECT item_key, COUNT(*) as qty FROM cell_amenities WHERE user_id=? AND placed_tile IS NULL GROUP BY item_key", [user.id]);
  ownedAmens.forEach(a => {
    const item = CELL_AMENITIES[a.item_key];
    if (item) inventory.push({ item_key: a.item_key, item_type:'amenity', display_name: item.name, quantity: a.qty });
  });

  await renderPage(res, 'openmarket', user, { listings, prison, inventory, selCat });
});

router.post('/openmarket/buy', requireAuth, progressionAction(async (req,tx) => {
  const user=await getUser(req.session.userId,tx);
  const id=wholeNumber(req.body.listing_id);
  if(!Number.isSafeInteger(id)||id<1) return {error:'Invalid listing.'};
  const listing=await tx.get('SELECT * FROM open_market WHERE id=? AND active=1',[id]);
  if(!listing) return {error:'Listing not found or already sold.'};
  if(!getItem(listing.item_type,listing.item_key))return {error:'This item has been removed from the catalog.'};
  if(listing.seller_id===user.id) return {error:'You cannot buy your own listing.'};
  if(listing.prison_id!==user.prison_id) return {error:'Wrong city.'};
  if(user.cash<listing.price) return {error:`Need $${listing.price}.`};
  const sellerGets=listing.price-Math.floor(listing.price*0.1);
  await tx.run('UPDATE users SET cash=cash-? WHERE id=?',[listing.price,user.id]);
  await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[sellerGets,listing.seller_id]);
  await tx.run('UPDATE open_market SET active=0 WHERE id=?',[id]);
  if(listing.item_type==='collectible') await receiveCollectible(tx,user.id,listing.item_key,listing.quantity);
  else if(listing.item_type==='amenity') {
    for(let i=0;i<listing.quantity;i++) await tx.run('INSERT INTO cell_amenities (user_id,item_key) VALUES (?,?)',[user.id,listing.item_key]);
  } else {
    const owned=await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=?',[user.id,listing.item_key,listing.item_type]);
    if(owned) await tx.run('UPDATE inventory SET quantity=quantity+? WHERE id=?',[listing.quantity,owned.id]);
    else await tx.run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,?)',[user.id,listing.item_key,listing.item_type,listing.quantity]);
  }
  await weapons.receiveListing(tx,listing,user.id);
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'market',?)",[listing.seller_id,`Your listing sold for $${sellerGets} (after 10% fee).`]);
  await tx.run(`INSERT INTO transaction_logs (type,from_id,from_name,to_id,item_key,item_type,quantity,cash_amount,note) VALUES ('market_sale',?,?,?,?,?,?,?,?)`,[user.id,user.username,listing.seller_id,listing.item_key,listing.item_type,listing.quantity,listing.price,'Open Market sale']);
  return {msg:`Bought ${listing.quantity} × ${TRAVEL_ITEMS[listing.item_key]?.name || listing.item_key} for $${listing.price}.`,user:statBlock(await getUser(user.id,tx))};
}));
router.post('/openmarket/cancel', requireAuth, progressionAction(async (req,tx) => {
  const id=wholeNumber(req.body.listing_id);
  if(!Number.isSafeInteger(id)||id<1) return {error:'Invalid listing.'};
  const listing=await tx.get('SELECT * FROM open_market WHERE id=? AND seller_id=? AND active=1',[id,req.session.userId]);
  if(!listing) return {error:'Listing not found.'};
  await tx.run('UPDATE open_market SET active=0 WHERE id=?',[id]);
  if(listing.item_type==='collectible') await addInventory(tx,req.session.userId,listing.item_key,listing.quantity);
  else if(listing.item_type==='amenity') {
    for(let i=0;i<listing.quantity;i++) await tx.run('INSERT INTO cell_amenities (user_id,item_key) VALUES (?,?)',[req.session.userId,listing.item_key]);
  } else {
    const owned=await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=?',[req.session.userId,listing.item_key,listing.item_type]);
    if(owned) await tx.run('UPDATE inventory SET quantity=quantity+? WHERE id=?',[listing.quantity,owned.id]);
    else await tx.run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,?)',[req.session.userId,listing.item_key,listing.item_type,listing.quantity]);
  }
  await weapons.receiveListing(tx,listing,req.session.userId);
  return {msg:'Listing cancelled. All items returned.'};
}));

// ── JOBS ──
// ═══════════════════════════════════════════════════════════
router.get('/jobs', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const prisonJobs = JOBS[user.prison_id] || [];
  const now = Math.floor(Date.now()/1000);
  const nextPay = user.last_daily_pay ? Math.max(0, (user.last_daily_pay + 86400) - now) : 0;
  await renderPage(res, 'jobs', user, { prisonJobs, nextPay });
});

router.post('/jobs/take', requireAuth, progressionAction(async (req, tx) => {
  const user = await getUser(req.session.userId,tx);
  if(await tx.get('SELECT 1 FROM company_employees WHERE user_id=?',[user.id])||await tx.get('SELECT 1 FROM companies WHERE director_id=?',[user.id]))return {error:'Leave your company before taking a city job.'};
  const { job_key } = req.body;
  const prisonJobs = JOBS[user.prison_id] || [];
  const job = prisonJobs.find(j => j.key === job_key);
  if (!job) return { error: 'Invalid job.' };
  if (user.defense < job.req_def) return { error: `Need ${job.req_def} DEF for this job.` };
  if(job.key==='brain_surgeon' && !user.perks?.brainSurgery)return {error:'Complete Brain Surgery education first.'};
  if(job.key==='brain_surgeon'){await medical.profile(tx,user.id);await tx.run('UPDATE medical_profiles SET revive_unlocked=1 WHERE user_id=?',[user.id]);}
  await tx.run('UPDATE users SET job_key=?, job_prison_id=?, last_daily_pay=? WHERE id=?',
    [job.key, user.prison_id, Math.floor(Date.now()/1000), user.id]);
  return { msg: `You're now working as: ${job.name}. Pay of $${job.base_pay}+ deposited automatically every 24 hours.` };
}));

router.post('/jobs/quit', requireAuth, async (req, res) => {
  await run('UPDATE users SET job_key=NULL, job_prison_id=NULL WHERE id=?', [req.session.userId]);
  res.json({ msg: 'You quit your job.' });
});

// ═══════════════════════════════════════════════════════════
// ── MUGGING ──
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
  const tid    = parseInt(target_id);
  const target = await getUser(tid);
  if (!target || target.id === user.id) return res.json({ error: 'Invalid target.' });
  if (target.prison_id !== user.prison_id) return res.json({ error: 'Can only spy on citizens in your city.' });
  const spyCost = 450 * target.level;
  if (user.cash < spyCost) return res.json({ error: `Need $${spyCost.toLocaleString()} to spy on this inmate.` });

  user.cash -= spyCost;

  // Fetch everything — each section has independent 65% success chance
  const hit = () => Math.random() > 0.35;
  const allItems = (await all("SELECT item_key,item_type,quantity FROM inventory WHERE user_id=?", [tid])).filter(r=>getItem(r.item_type,r.item_key));
  const cellAmens  = await all('SELECT item_key FROM cell_amenities WHERE user_id=? AND placed_tile IS NOT NULL', [tid]);
  const unplaced   = await all('SELECT item_key FROM cell_amenities WHERE user_id=? AND placed_tile IS NULL', [tid]);

  const result = {
    bank:       hit() ? target.bank     : null,
    favors:     hit() ? (target.favors||0) : null,
    xp_pct:    hit() ? Math.floor((target.xp / Math.max(1,target.xp_needed))*100) : null,
    speed:      hit() ? target.speed    : null,
    strength:   hit() ? target.strength : null,
    defense:    hit() ? target.defense  : null,
    dexterity:  hit() ? target.dexterity : null,
    stamina:    hit() ? target.stamina  : null,
    // Items split by type
    items:      hit() ? allItems.filter(i=>i.item_type==='item')   : null,
    weapons:    hit() ? allItems.filter(i=>i.item_type==='weapon') : null,
    armor:      hit() ? allItems.filter(i=>i.item_type==='armor')  : null,
    drugs:      hit() ? allItems.filter(i=>i.item_type==='drug')   : null,
    // Cell contents (placed + unplaced, no protected flag shown)
    cell_placed:   hit() ? cellAmens.map(c=>c.item_key) : null,
    cell_unplaced: hit() ? unplaced.map(c=>c.item_key)  : null,
  };

  // Log the spy action
  await run('INSERT INTO spy_logs (spy_id,target_id,result,cost) VALUES (?,?,?,?)',
    [user.id, tid, JSON.stringify(result), spyCost]).catch(()=>{});
  await run(`INSERT INTO transaction_logs (type,from_id,from_name,to_id,to_name,cash_amount,note) VALUES (?,?,?,?,?,?,?)`,
    ['spy', user.id, user.username, tid, target.username, spyCost, `Spy report on ${target.username}`]).catch(()=>{});
  await saveUser(user);
  res.json({ result, target: { username: target.username, level: target.level }, msg: `Spy report on ${target.username} complete. Cost: $${spyCost.toLocaleString()}.`, user: statBlock(user) });
});

// ═══════════════════════════════════════════════════════════
// Retired features reject stale clients without changing saved state.
router.all(['/raid/:username', '/raid/attempt', '/cell/change-combo', '/property/change-combo', '/cell-raids'], requireAuth, (req,res) =>
  res.status(410).json({error:'Raids and home combinations have been removed.'}));

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
router.post(['/tokens/vote', '/favors/vote'], requireAuth, async (req, res) => {
  try {
    const result = await withTransaction(async tx => {
      const id = req.session.userId;
      const now = Math.floor(Date.now()/1000);
      const claimed = await tx.get("SELECT id FROM events WHERE user_id=? AND type='vote' AND created_at > ?", [id, now - 86400]);
      if (claimed) return {error:'Already claimed your daily Token. Come back tomorrow!'};
      await tx.run('UPDATE users SET favors=COALESCE(favors,0)+1 WHERE id=?',[id]);
      await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'vote','Earned 1 Token from voting.')",[id]);
      const user = await tx.get('SELECT favors FROM users WHERE id=?',[id]);
      return {msg:'+1 Token earned! Thanks for voting.', tokens:user.favors, favors:user.favors};
    });
    res.json(result);
  } catch (err) { res.status(500).json({error:'Unable to claim Token. Please try again.'}); }
});

// ── PRISON TRANSPORT ──
router.get('/transport', requireAuth, (req,res)=>res.redirect('/airport'));
router.post('/transport/move', requireAuth, (req,res)=>res.json({error:'Permanent relocation is closed. Use the Airport to travel.'}));

// ── SURGEON ──
const { AVATAR_CATEGORIES, AVATAR_PARTS, DEFAULT_AVATAR, STARTER_AVATARS, cleanAvatar } = require('../middleware/avatardata');

router.get('/surgeon', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const presets = await all('SELECT * FROM avatar_presets WHERE user_id=? ORDER BY slot', [user.id]);
  const presetsData = presets.map(p => ({ ...p, layers: cleanAvatar(p.layers) }));
  const unlockRows = await all('SELECT item_key FROM surgeon_unlocks WHERE user_id=?', [user.id]);
  const unlocked = unlockRows.map(r => r.item_key);
  const currentAvatar = cleanAvatar(user.avatar);
  await renderPage(res, 'surgeon', user, {
    AVATAR_CATEGORIES, AVATAR_PARTS, DEFAULT_AVATAR, STARTER_AVATARS,
    presets, presetsData, unlocked, currentAvatar
  });
});

router.post('/surgeon/starter', requireAuth, async (req, res, next) => {
  try {
    const preset = STARTER_AVATARS.find(p => p.id === req.body.id);
    if (!preset) return res.status(400).json({ error: 'Choose a starter character.' });
    await run('UPDATE users SET avatar=? WHERE id=?', [JSON.stringify(preset.layers), req.session.userId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/surgeon/save', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { layers } = req.body;
  if (!layers || typeof layers !== 'object') return res.json({ error: 'Invalid data.' });
  const clean = cleanAvatar(layers);
  await run('UPDATE users SET avatar=? WHERE id=?', [JSON.stringify(clean), user.id]);
  res.json({ ok: true, msg: 'Avatar saved!' });
});

router.post('/surgeon/preset/save', requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { slot, layers } = req.body;
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) return res.json({ error: 'Invalid slot.' });
  await run('INSERT OR REPLACE INTO avatar_presets (user_id, slot, layers) VALUES (?,?,?)',
    [user.id, slot, JSON.stringify(cleanAvatar(layers))]);
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
