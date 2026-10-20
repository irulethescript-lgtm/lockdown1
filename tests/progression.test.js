const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const sqlite3 = require('sqlite3');

const root = path.resolve(__dirname, '..');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'lockdown-progression-'));
const databasePath = path.join(temporary, 'test.db');
let server, connection, origin, accountNumber = 0;
const query = (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const run = (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, err => err ? reject(err) : resolve()));

async function start(random = 0.99) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['-e', `Math.random = () => ${random}; require('./server.js');`], {
    cwd: root, env: { ...process.env, DB_PATH: databasePath, PORT: String(port), SESSION_SECRET: 'local-test-session-secret' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', data => output += data);
  server.stderr.on('data', data => output += data);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { if ((await fetch(origin + '/login')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Server did not start: ${output}`);
}
async function stop() {
  if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
async function account() {
  const username = 'progression_' + (++accountNumber);
  const response = await fetch(origin + '/register', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password: 'test-password', confirm: 'test-password' }), redirect: 'manual' });
  assert.equal(response.status, 302);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const row = await query('SELECT id FROM users WHERE username=?', [username]);
  return { id: row.id, cookie, username };
}
async function post(user, url, body = {}) {
  const response = await fetch(origin + url, { method: 'POST', headers: { Cookie: user.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Unexpected status from ${url}`);
  return response.json();
}
// Existing outcome tests exercise the full sequence through the public turn API.
async function playFight(user,body={}) {
 let result=await post(user,'/battles/attack',body);
 for(let i=0;result.battle&&i<25;i++){
  const b=result.battle,t=b.temporary[0],w=b.weapons[0];
  const action=t?'temporary':w?(w.caliber&&w.loaded<=0?(w.reserve?'reload':'fists'):'weapon'):'fists';
  result=await post(user,'/battles/turn',{attack_id:b.attackId,version:b.version,action,weapon_id:w?.id,item_key:t?.key});
 }
 return result;
}
async function stocked(user) {
 await fetch(origin+'/market',{headers:{Cookie:user.cookie}});
 await run("UPDATE rotating_stock SET active=1,quantity=100,restock_at=? WHERE scope='home'",[Math.floor(Date.now()/1000)+3600]);
}
async function stats(user) { return query('SELECT * FROM users WHERE id=?', [user.id]); }
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  await start();
  connection = new sqlite3.Database(databasePath);
  connection.configure('busyTimeout', 5000);
});
after(async () => {
  await stop();
  if (connection) await new Promise(resolve => connection.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
});

test('mastery and gym tiers respect thresholds and caps', async () => {
  // The default DB module is loaded only for these pure helpers and uses the isolated DB.
  process.env.DB_PATH = databasePath;
  const { getMastery, getGymProgress } = require('../middleware/progression');
  assert.equal(getMastery({ successes: 9 }).level, 1);
  assert.equal(getMastery({ successes: 10 }).level, 2);
  const capped = getMastery({ successes: 1000 }, { catch_chance: 20 }, 1000);
  assert.equal(capped.level, 10); assert.equal(capped.rewardBonus, 18); assert.equal(capped.catchChance, 5); assert.equal(capped.progress, 100);
  assert.equal(getGymProgress(99).multiplier, 1);
  assert.equal(getGymProgress(100).multiplier, 1.2);
  assert.equal(getGymProgress(500).multiplier, 1.4);
  assert.equal(getGymProgress(1500).nextGym, null);
  // Close the helper module's otherwise unused connection.
  await new Promise(resolve => require('../middleware/db').db.close(resolve));
});

test('dashboard, gym, crimes, and existing destinations render for a new account', async () => {
  const user = await account();
  for (const url of ['/prison', '/crimes', '/gym', '/education', '/bank', '/market', '/battles', '/jobs', '/gangs', '/inventory', '/account', '/cell', '/equipment', '/events', '/mail', '/prison/infirmary', '/surgeon', '/isolation', '/hitlist', '/warden', '/prison/yard', '/most-wanted', '/transport', '/openmarket', '/send-money', '/inmates', '/logs', '/shoutbox', '/my-gang', '/gang-invites']) {
    const response = await fetch(origin + url, { headers: { Cookie: user.cookie } });
    const html = await response.text();
    assert.equal(response.status, 200, url + ": " + html.replace(/<[^>]*>/g, "").slice(0, 350));
    assert.match(html, /<!DOCTYPE html>/i);
  }
});

test('crime restriction, zero stamina, and isolation block spending and progress', async () => {
  const user = await account();
  assert.match((await post(user, '/crimes/commit', { crime_key: 'warden_heist' })).error, /not available/);
  await run('UPDATE users SET stamina=0 WHERE id=?', [user.id]);
  assert.match((await post(user, '/crimes/commit', { crime_key: 'pickpocket' })).error, /stamina/);
  await run('UPDATE users SET stamina=100,in_jail=1,jail_until=? WHERE id=?', [Math.floor(Date.now() / 1000) + 600, user.id]);
  assert.match((await post(user, '/crimes/commit', { crime_key: 'pickpocket' })).error, /jail/);
  assert.equal((await stats(user)).nerve, 5);
  assert.equal(await query('SELECT * FROM crime_mastery WHERE user_id=?', [user.id]), undefined);
});

test('successful crimes advance mastery and daily goals with the displayed cash bonus', async () => {
  const user = await account();
  await run("INSERT INTO crime_mastery VALUES (?,'pickpocket',9,9)", [user.id]);
  const first = await post(user, '/crimes/commit', { crime_key: 'pickpocket' });
  assert.equal(first.caught, false); assert.equal(first.mastery.level, 2); assert.equal(first.mastery.successes, 10);
  assert.equal(first.user.nerve, 3); assert.equal(first.user.stamina, 97);
  const second = await post(user, '/crimes/commit', { crime_key: 'pickpocket' });
  assert.equal(second.cashGain, Math.floor(first.cashGain * 1.02));
  const progress = await query('SELECT * FROM daily_progress WHERE user_id=? AND day=?', [user.id, today()]);
  assert.equal(progress.crimes, 2);
  assert.equal((await stats(user)).cash, 500 + first.cashGain + second.cashGain);
});

test('parallel crime requests spend the same nerve pool once', async () => {
  const user = await account();
  await run('UPDATE users SET nerve=2 WHERE id=?', [user.id]);
  const results = await Promise.all([post(user, '/crimes/commit', { crime_key: 'pickpocket' }), post(user, '/crimes/commit', { crime_key: 'pickpocket' })]);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal((await stats(user)).nerve, 0);
  assert.equal((await query('SELECT attempts FROM crime_mastery WHERE user_id=?', [user.id])).attempts, 1);
});

test('training rejects invalid amounts and spends exact stamina and energy', async () => {
  const user = await account();
  for (const amount of [0, -1, 1.5, 'abc', null, true, 1000]) assert.ok((await post(user, '/gym/train', { stat: 'strength', energy_amount: amount })).error);
  assert.ok((await post(user, '/gym/train', { stat: 'cash', energy_amount: 1 })).error);
  await run('UPDATE users SET stamina=3 WHERE id=?', [user.id]);
  assert.match((await post(user, '/gym/train', { stat: 'strength', energy_amount: 2 })).error, /stamina/);
  const result = await post(user, '/gym/train', { stat: 'strength', energy_amount: 1 });
  assert.equal(result.gain, 2); assert.equal(result.user.stamina, 1); assert.equal(result.user.energy, 9);
  assert.equal(result.gym.energySpent, 1);
  assert.equal((await query('SELECT training FROM daily_progress WHERE user_id=?', [user.id])).training, 1);
});

test('gym unlocks apply to the following session and history survives updates', async () => {
  const user = await account();
  await run('INSERT INTO gym_progress VALUES (?,99)', [user.id]);
  const unlock = await post(user, '/gym/train', { stat: 'defense', energy_amount: 1 });
  assert.equal(unlock.gain, 2); assert.equal(unlock.unlockedGym, 'Iron Works');
  const result = await post(user, '/gym/train', { stat: 'defense', energy_amount: 5 });
  assert.equal(result.gain, 12); assert.equal(result.gym.energySpent, 105);
  assert.equal(result.historyEntry.defense, result.user.defense);
});

test('parallel training cannot spend energy twice', async () => {
  const user = await account();
  await run('UPDATE users SET energy=1 WHERE id=?', [user.id]);
  const results = await Promise.all([post(user, '/gym/train', { stat: 'speed', energy_amount: 1 }), post(user, '/gym/train', { stat: 'speed', energy_amount: 1 })]);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal((await stats(user)).energy, 0);
});

test('daily reward requires both goals and pays once under concurrent requests', async () => {
  const user = await account();
  assert.match((await post(user, '/daily/claim')).error, /Complete/);
  await run('INSERT INTO daily_progress (user_id,day,crimes,training) VALUES (?,?,3,2)', [user.id, today()]);
  const results = await Promise.all([post(user, '/daily/claim'), post(user, '/daily/claim')]);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal((await stats(user)).cash, 1000); assert.equal((await stats(user)).rep, 3);
  assert.match((await post(user, '/daily/claim')).error, /already claimed/);
});

test('yesterday’s daily progress does not unlock today’s reward', async () => {
  const user = await account();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await run('INSERT INTO daily_progress (user_id,day,crimes,training,claimed) VALUES (?,?,3,2,1)', [user.id, yesterday]);
  assert.match((await post(user, '/daily/claim')).error, /Complete/);
  assert.equal((await stats(user)).cash, 500);
});

test('level-ups persist base stats and never permanently stack cell bonuses', async () => {
  const user = await account();
  await run("INSERT INTO cell_amenities (user_id,item_key,placed_tile) VALUES (?,'three_musketeers',1)", [user.id]);
  await run('UPDATE users SET xp=95 WHERE id=?', [user.id]);
  const result = await post(user, '/gym/train', { stat: 'strength', energy_amount: 1 });
  assert.equal(result.user.level, 2); assert.equal(result.user.strength, 17);
  const row = await stats(user);
  assert.equal(row.level, 2); assert.equal(row.strength, 14); assert.equal(row.xp, 10);
  const response = await fetch(origin + '/api/stats', { headers: { Cookie: user.cookie } });
  assert.equal((await response.json()).strength, 17);
  await post(user, '/gym/train', { stat: 'defense', energy_amount: 1 });
  assert.equal((await stats(user)).strength, 14);
});

test('full pools cannot bank elapsed time; partial pools keep fractional recovery time', async () => {
  const user = await account();
  const now = Math.floor(Date.now() / 1000);
  await run('UPDATE users SET energy_last_regen=?,nerve_last_regen=?,stamina_last_regen=? WHERE id=?', [now - 86400, now - 86400, now - 86400, user.id]);
  await post(user, '/gym/train', { stat: 'strength', energy_amount: 1 });
  const response = await fetch(origin + '/api/stats', { headers: { Cookie: user.cookie } });
  const row = await response.json();
  assert.equal(row.energy, 9); assert.equal(row.stamina, 98);
  await run('UPDATE users SET energy=3,energy_last_regen=? WHERE id=?', [now - 650, user.id]);
  const regenerated = await (await fetch(origin + '/api/stats', { headers: { Cookie: user.cookie } })).json();
  assert.equal(regenerated.energy, 5);
  assert.equal((await stats(user)).energy_last_regen, now - 50);
});

test('an error rolls back spending, rewards, and progress together', async () => {
  const user = await account();
  await run("CREATE TRIGGER reject_mastery BEFORE INSERT ON crime_mastery BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    const response = await fetch(origin + '/crimes/commit', { method: 'POST', headers: { Cookie: user.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ crime_key: 'pickpocket' }) });
    assert.equal(response.status, 500);
    const row = await stats(user);
    assert.equal(row.nerve, 5); assert.equal(row.cash, 500); assert.equal(row.stamina, 100);
    assert.equal(await query('SELECT * FROM daily_progress WHERE user_id=?', [user.id]), undefined);
  } finally { await run('DROP TRIGGER reject_mastery'); }
});

test('caught crimes cost resources, record the attempt, and block more actions', async () => {
  await stop(); await start(0.01);
  const user = await account();
  const result = await post(user, '/crimes/commit', { crime_key: 'pickpocket' });
  assert.equal(result.caught, true); assert.equal(result.user.in_jail, 1);
  assert.equal(result.mastery.attempts, 1); assert.equal(result.mastery.successes, 0); assert.equal(result.user.nerve, 3);
  assert.match((await post(user, '/gym/train', { stat: 'speed', energy_amount: 1 })).error, /jail/);
  assert.match((await post(user, '/crimes/commit', { crime_key: 'pickpocket' })).error, /jail/);
});

test('mastery, gym unlocks, daily claims, and levels persist across restart', async () => {
  const user = await account();
  await run("INSERT INTO crime_mastery VALUES (?,'pickpocket',10,10)", [user.id]);
  await run('INSERT INTO gym_progress VALUES (?,500)', [user.id]);
  await run('INSERT INTO daily_progress (user_id,day,crimes,training,claimed) VALUES (?,?,3,2,1)', [user.id, today()]);
  await run('UPDATE users SET level=2 WHERE id=?', [user.id]);
  await stop(); await start();
  const login = await fetch(origin + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: user.username, password: 'test-password' }), redirect: 'manual' });
  user.cookie = login.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(origin + '/gym', { headers: { Cookie: user.cookie } })).text();
  assert.match(html, /The Foundry/);
  assert.equal((await stats(user)).level, 2);
  assert.equal((await query('SELECT successes FROM crime_mastery WHERE user_id=?', [user.id])).successes, 10);
  assert.match((await post(user, '/daily/claim')).error, /already claimed/);
});

test('bank deposits and daily rewards preserve each other under concurrency', async () => {
  const user = await account();
  await run('INSERT INTO daily_progress (user_id,day,crimes,training) VALUES (?,?,3,2)', [user.id, today()]);
  const results = await Promise.all([post(user, '/bank/deposit', { amount: 200 }), post(user, '/daily/claim')]);
  assert.ok(results.every(result => !result.error));
  const row = await stats(user);
  assert.equal(row.cash, 800); assert.equal(row.bank, 200); assert.equal(row.rep, 3);
  for (const amount of [0, -1, 1.5, true]) assert.ok((await post(user, '/bank/withdraw', { amount })).error);
});

test('stats polling cannot restore resources spent by a parallel crime', async () => {
  const user = await account();
  const requests = [post(user, '/crimes/commit', { crime_key: 'pickpocket' })];
  for (let i = 0; i < 5; i++) requests.push(fetch(origin + '/api/stats', { headers: { Cookie: user.cookie } }));
  await Promise.all(requests);
  assert.equal((await stats(user)).nerve, 3);
  assert.equal((await stats(user)).stamina, 97);
});

test('capped cell stamina bonuses do not drain base stamina on an unrelated action', async () => {
  const user = await account();
  await run("INSERT INTO cell_amenities (user_id,item_key,placed_tile) VALUES (?,'four_leaf_clover',1)", [user.id]);
  await post(user, '/bank/deposit', { amount: 1 });
  assert.equal((await stats(user)).stamina, 100);
});

test('older databases automatically gain the missing stamina recovery column', async () => {
  const user = await account();
  await stop();
  await run('ALTER TABLE users DROP COLUMN stamina_last_regen');
  await start();
  const login = await fetch(origin + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: user.username, password: 'test-password' }), redirect: 'manual' });
  user.cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(origin + '/api/stats', { headers: { Cookie: user.cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stamina, 100);
  assert.ok((await stats(user)).stamina_last_regen > 0);
});

test('live chat uses the logged-in identity and persists messages without crashing', async () => {
  const user = await account();
  const handshake = await fetch(origin + '/socket.io/?EIO=4&transport=polling', { headers: { Cookie: user.cookie } });
  const sid = JSON.parse((await handshake.text()).slice(1)).sid;
  const transport = origin + '/socket.io/?EIO=4&transport=polling&sid=' + encodeURIComponent(sid);
  const send = body => fetch(transport, { method: 'POST', headers: { Cookie: user.cookie, 'Content-Type': 'text/plain' }, body });
  await send('40');
  await (await fetch(transport, { headers: { Cookie: user.cookie } })).text();
  await send('42["auth",{"userId":999999,"username":"Impersonated"}]');
  const online = await (await fetch(transport, { headers: { Cookie: user.cookie } })).text();
  assert.match(online, /online_count/);
  await send('42["shout",{"message":"Synthetic gameplay test"}]');
  const message = await (await fetch(transport, { headers: { Cookie: user.cookie } })).text();
  assert.match(message, /Synthetic gameplay test/); assert.match(message, new RegExp(user.username));
  assert.doesNotMatch(message, /Impersonated/);
  const row = await query('SELECT * FROM shoutbox WHERE user_id=?', [user.id]);
  assert.equal(row.message, 'Synthetic gameplay test'); assert.equal(row.username, user.username);
  await send('1');
});

test('crime approaches trade cash for risk and reject invalid input without spending', async () => {
  const cautious = await account(), balanced = await account(), bold = await account();
  const a = await post(cautious, '/crimes/commit', { crime_key:'pickpocket', approach:'cautious' });
  const b = await post(balanced, '/crimes/commit', { crime_key:'pickpocket', approach:'balanced' });
  const c = await post(bold, '/crimes/commit', { crime_key:'pickpocket', approach:'bold' });
  assert.equal(a.risk, 12); assert.equal(b.risk, 20); assert.equal(c.risk, 32);
  assert.equal(a.cashGain, Math.floor(b.cashGain * 0.75));
  assert.equal(c.cashGain, Math.floor(b.cashGain * 1.5));
  assert.equal(a.user.heat, 3); assert.equal(b.user.heat, 6); assert.equal(c.user.heat, 12);
  const invalid = await account();
  assert.match((await post(invalid, '/crimes/commit', { crime_key:'pickpocket', approach:'__proto__' })).error, /valid/);
  assert.equal((await stats(invalid)).nerve, 5);
});

test('heat cools offline, survives polling, caps at 100 and affects risk with course perks', async () => {
  const user = await account();
  const now = Math.floor(Date.now()/1000);
  await run('INSERT INTO player_dynamics VALUES (?,?,?)', [user.id, 95, now - 600]);
  const read = () => fetch(origin + '/api/stats', { headers:{Cookie:user.cookie} }).then(r=>r.json());
  assert.equal((await read()).heat, 85); assert.equal((await read()).heat, 85);
  await run("INSERT INTO education VALUES (?,'streetcraft',0,1,2)", [user.id]);
  const first = await post(user, '/crimes/commit', { crime_key:'pickpocket', approach:'bold' });
  assert.equal(first.risk, 46); assert.equal(first.user.heat, 97);
  const second = await post(user, '/crimes/commit', { crime_key:'pickpocket', approach:'bold' });
  assert.equal(second.user.heat, 100);
  assert.equal((await query('SELECT heat FROM player_dynamics WHERE user_id=?', [user.id])).heat, 100);
});

test('course enrollment enforces cash, prerequisites, recovery and one active course under concurrency', async () => {
  const user = await account();
  assert.match((await post(user, '/education/start', {course_key:'conditioning'})).error, /Need/);
  await run('UPDATE users SET cash=10000 WHERE id=?', [user.id]);
  assert.match((await post(user, '/education/start', {course_key:'sports_science'})).error, /prerequisite/);
  const results = await Promise.all(['conditioning','streetcraft'].map(course_key=>post(user, '/education/start', {course_key})));
  assert.equal(results.filter(r=>!r.error).length, 1); assert.equal((await stats(user)).cash, 9000);
  const row = await query('SELECT * FROM education WHERE user_id=?', [user.id]);
  assert.ok(row.finishes_at > row.started_at); assert.equal(row.completed_at, null);
  assert.match((await post(user, '/education/complete', {course_key:row.course_key})).error, /in progress/);
  const jailed = await account();
  await run('UPDATE users SET cash=5000,in_jail=1,jail_until=? WHERE id=?', [Math.floor(Date.now()/1000)+600,jailed.id]);
  assert.match((await post(jailed, '/education/start', {course_key:'streetcraft'})).error, /jail/);
});

test('a course perk is collected once, improves training and unlocks the next course', async () => {
  const user = await account();
  await run('UPDATE users SET cash=10000,xp_needed=100000 WHERE id=?', [user.id]);
  await post(user, '/education/start', {course_key:'conditioning'});
  await run('UPDATE education SET finishes_at=1 WHERE user_id=?', [user.id]);
  const results = await Promise.all([post(user, '/education/complete', {course_key:'conditioning'}),post(user, '/education/complete', {course_key:'conditioning'})]);
  assert.equal(results.filter(r=>!r.error).length,1);
  const train=await post(user, '/gym/train', {stat:'defense',energy_amount:5});
  assert.equal(train.user.perks.training,10); assert.equal(train.gain,11);
  assert.ok(!(await post(user, '/education/start', {course_key:'sports_science'})).error);
  assert.equal((await stats(user)).cash,4000);
});

test('logistics course improves cash without modifying mastery', async () => {
  const plain=await account(), educated=await account();
  await run("INSERT INTO education VALUES (?,'streetcraft',0,1,2)",[educated.id]);
  await run("INSERT INTO education VALUES (?,'logistics',2,3,4)",[educated.id]);
  const a=await post(plain,'/crimes/commit',{crime_key:'pickpocket'});
  const b=await post(educated,'/crimes/commit',{crime_key:'pickpocket'});
  assert.equal(b.cashGain,Math.floor(a.cashGain*1.1)); assert.equal(b.mastery.level,1);
});

test('weapon equipment does not inflate base stats after training or level-up', async () => {
  const user=await account();
  await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,'torn_5','weapon')",[user.id]);
  const equip=await post(user,'/equipment/equip',{action:'equip',slot:'weapon',key:'torn_5'});
  assert.equal(equip.user.strength,10); assert.equal(equip.user.speed,8);
  await post(user,'/gym/train',{stat:'strength',energy_amount:1});
  await post(user,'/bank/deposit',{amount:1});
  assert.equal((await stats(user)).strength,12); assert.equal((await stats(user)).speed,8);
  await run('UPDATE users SET xp=99 WHERE id=?',[user.id]);
  await post(user,'/gym/train',{stat:'defense',energy_amount:1});
  assert.equal((await stats(user)).strength,14);
  const unequip=await post(user,'/equipment/equip',{action:'unequip',slot:'weapon'});
  assert.equal(unequip.user.strength,14); assert.equal(unequip.user.speed,9);
  assert.match((await post(user,'/equipment/equip',{action:'equip',slot:'armor',key:'torn_32'})).error,/own/);
});

test('equipment bonuses vanish when ownership is lost and maximum HP clamps persist', async () => {
  const user=await account();
  await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,'torn_32','armor')",[user.id]);
  await post(user,'/equipment/equip',{action:'equip',slot:'armor',key:'torn_32'});
  await run('UPDATE users SET hp=120 WHERE id=?',[user.id]);
  await post(user,'/inventory/drop',{item_key:'torn_32',item_type:'armor'});
  const read=await (await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
  assert.equal(read.defense,8); assert.equal(read.max_hp,100); assert.equal(read.hp,100);
  assert.equal((await stats(user)).hp,100); assert.equal((await stats(user)).max_hp,100);
});

async function combatPair(attackerValues='strength=500,defense=100,speed=100') {
  const attacker=await account(), defender=await account();
  await run(`UPDATE users SET ${attackerValues},energy=30,xp_needed=100000 WHERE id=?`,[attacker.id]);
  await run('UPDATE users SET cash=1000,xp_needed=100000 WHERE id=?',[defender.id]);
  return {attacker,defender};
}
test('combat endings pay distinct rewards and preserve cash and actual surviving HP', async () => {
  for (const ending of ['mug','leave','hospitalize']) {
    const {attacker,defender}=await combatPair();
    const started=await playFight(attacker,{target_id:defender.id,ending,stance:'aggressive'});
    assert.equal(started.result,'win');assert.equal(started.ending,'pending');assert.equal(started.xpGain,0);assert.equal(started.cashStolen,0);
    assert.equal((await stats(defender)).cash,1000);
    const result=await post(attacker,'/battles/finish',{ending});
    assert.equal(result.result,'win'); assert.equal(result.user.energy,5); assert.equal(result.user.stamina,90);
    assert.equal(result.user.hp,100); // One-hit win; no forced reduction to 30%.
    assert.equal(result.cashStolen,ending==='mug'?150:0);
    assert.equal(result.xpGain,ending==='leave'?37:ending==='mug'?15:25);
    const loser=await stats(defender);
    assert.equal(loser.cash,ending==='mug'?850:1000); assert.equal(loser.hp,20);
    assert.equal(loser.in_hospital,1); assert.equal(loser.losses,1);
    const seconds=loser.hospital_until-Math.floor(Date.now()/1000);
    assert.ok(Math.abs(seconds-(ending==='hospitalize'?3600:1800))<=2);
    const row=await query('SELECT * FROM attacks WHERE attacker_id=?',[attacker.id]);
    assert.equal(row.result,'win'); assert.equal(row.ending,ending); assert.equal(row.stance,'aggressive');
  }
});

test('draws retain HP and never count as wins or losses; failed attacks reward the defending record', async () => {
  const {attacker,defender}=await combatPair('strength=1,defense=1000,speed=100,hp=1000,max_hp=1000');
  await run('UPDATE users SET strength=1,defense=1000,speed=100,hp=1000,max_hp=1000 WHERE id=?',[defender.id]);
  const draw=await playFight(attacker,{target_id:defender.id});
  assert.equal(draw.result,'draw'); assert.equal(draw.user.hp,975); assert.equal(draw.user.wins,0); assert.equal(draw.user.losses,0);
  assert.equal((await stats(defender)).hp,975); assert.equal((await stats(defender)).in_hospital,0);
  const pair=await combatPair('strength=1,defense=1,speed=1');
  await run('UPDATE users SET strength=1000,speed=100 WHERE id=?',[pair.defender.id]);
  const loss=await playFight(pair.attacker,{target_id:pair.defender.id});
  assert.equal(loss.result,'loss'); assert.equal(loss.user.in_hospital,1); assert.equal(loss.user.losses,1);
  assert.equal((await stats(pair.defender)).wins,1);
});

test('combat validates target, stance, stamina and isolation before costs and serializes repeated attacks', async () => {
  const {attacker,defender}=await combatPair();
  for(const target_id of [attacker.id,defender.id+'junk',true,-1]) assert.ok((await playFight(attacker,{target_id})).error);
  assert.ok((await playFight(attacker,{target_id:defender.id,stance:'__proto__'})).error);
  await run('UPDATE users SET stamina=0 WHERE id=?',[attacker.id]);
  assert.match((await playFight(attacker,{target_id:defender.id})).error,/stamina/);
  await run('UPDATE users SET stamina=100 WHERE id=?',[attacker.id]);
  await run('UPDATE users SET in_jail=1,jail_until=? WHERE id=?',[Math.floor(Date.now()/1000)+600,defender.id]);
  assert.match((await playFight(attacker,{target_id:defender.id})).error,/jail/);
  await run('UPDATE users SET in_jail=0 WHERE id=?',[defender.id]);
  const results=await Promise.all([playFight(attacker,{target_id:defender.id}),playFight(attacker,{target_id:defender.id})]);
  assert.equal(results.filter(r=>!r.error).length,1); assert.equal((await stats(attacker)).energy,5);
  assert.equal((await query('SELECT COUNT(*) AS n FROM attacks WHERE attacker_id=?',[attacker.id])).n,1);
});

test('equipment, stance, speed and course perks actually change simulated damage', () => {
  const {simulateFight}=require('../middleware/dynamics');
  const base={username:'Fighter',hp:10000,strength:50,defense:25,speed:25,stamina:100,perks:{}};
  const balanced=simulateFight(base,base,'balanced',()=>0.5);
  const aggressive=simulateFight(base,base,'aggressive',()=>0.5);
  const defensive=simulateFight(base,base,'defensive',()=>0.5);
  assert.ok(aggressive.damageDealt>balanced.damageDealt); assert.ok(aggressive.damageTaken>balanced.damageTaken);
  assert.ok(defensive.damageTaken<balanced.damageTaken);
  const educated=simulateFight({...base,perks:{damage:8,protection:8}},base,'balanced',()=>0.5);
  assert.ok(educated.damageDealt>balanced.damageDealt); assert.ok(educated.damageTaken<balanced.damageTaken);
  const exhausted=simulateFight({...base,stamina:0},base,'balanced',()=>0.5);
  assert.ok(exhausted.damageDealt<balanced.damageDealt);
});

test('boosters stack to their cap atomically, preserve full-pool items and never spend the same item twice', async () => {
  const user=await account();
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'torn_530','item',2)",[user.id]);
  await run('UPDATE users SET energy=1000 WHERE id=?',[user.id]);
  const full=await post(user,'/inventory/use',{item_key:'torn_530',item_type:'item'});
  assert.match(full.error,/already full/); assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[user.id])).quantity,2);
  await run('UPDATE users SET energy=0 WHERE id=?',[user.id]);
  await run("INSERT INTO recovery_cooldowns(user_id,category,ready_at) VALUES (?,'booster',?)",[user.id,Math.floor(Date.now()/1000)+23*3600]);
  const results=await Promise.all([post(user,'/inventory/use',{item_key:'torn_530',item_type:'item'}),post(user,'/inventory/use',{item_key:'torn_530',item_type:'item'})]);
  assert.equal(results.filter(r=>!r.error).length,1);
  assert.equal((await stats(user)).energy,20); assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[user.id])).quantity,1);
  await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,'torn_553','item')",[user.id]);
  await run('UPDATE users SET energy=0 WHERE id=?',[user.id]);
  assert.match((await post(user,'/inventory/use',{item_key:'torn_553'})).error,/cooldown/);
});

test('documented drugs share recovery and medical items reduce hospitalization', async () => {
 const user=await account();
 for(const key of ['torn_196','torn_206']) await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,?,'drug')",[user.id,key]);
 await run('UPDATE users SET energy=0 WHERE id=?',[user.id]);
 const used=await post(user,'/inventory/use',{item_key:'torn_196',item_type:'drug'});
 assert.equal(used.user.energy,0);assert.ok(used.user.nerve>=13&&used.user.nerve<=17);assert.equal(used.category,'drug');
 assert.match((await post(user,'/inventory/use',{item_key:'torn_206',item_type:'drug'})).error,/cooldown/);
 await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,'torn_68','item')",[user.id]);
 await run('UPDATE users SET hp=10,in_hospital=1,hospital_until=? WHERE id=?',[Math.floor(Date.now()/1000)+3600,user.id]);
 const med=await post(user,'/inventory/use',{item_key:'torn_68',item_type:'item'});
 assert.equal(med.user.hp,15);assert.equal(med.user.in_hospital,1);
});

test('new progression and battle history survive restart and legacy attacks migrate', async () => {
  const user=await account();
  await run("INSERT INTO education VALUES (?,'streetcraft',0,1,2)",[user.id]);
  await run("INSERT INTO education VALUES (?,'logistics',2,9999999999,NULL)",[user.id]);
  await run('INSERT INTO player_dynamics VALUES (?,?,?)',[user.id,50,Math.floor(Date.now()/1000)]);
  await run("INSERT INTO recovery_cooldowns VALUES (?,'drug',9999999999)",[user.id]);
  await run('INSERT INTO attacks (attacker_id,defender_id,attacker_won) VALUES (?,?,1)',[user.id,1]);
  await stop();
  await run('ALTER TABLE attacks DROP COLUMN result');
  await run('ALTER TABLE attacks DROP COLUMN ending');
  await run('ALTER TABLE attacks DROP COLUMN stance');
  await start();
  const login=await fetch(origin+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:user.username,password:'test-password'}),redirect:'manual'});
  user.cookie=login.headers.get('set-cookie').split(';')[0];
  const state=await (await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
  assert.equal(state.perks.crimeRisk,3); assert.ok(state.heat>=49);
  assert.equal((await query('SELECT ready_at FROM recovery_cooldowns WHERE user_id=?',[user.id])).ready_at,9999999999);
  assert.match((await post(user,'/education/start',{course_key:'conditioning'})).error,/current course/);
  for(const url of ['/education','/battles','/account','/profile/'+user.username]) {
    const response=await fetch(origin+url,{headers:{Cookie:user.cookie}}); assert.equal(response.status,200,url);
  }
});


test('profile offers Attack only and victory choices authorize and settle once', async () => {
  const {attacker,defender}=await combatPair();
  const html=await (await fetch(origin+'/profile/'+defender.username,{headers:{Cookie:attacker.cookie}})).text();
  assert.ok(html.includes('action="/battles/start"'));assert.ok(!html.includes('mugPlayer('));
  assert.ok((await post(attacker,'/mug',{target_id:defender.id})).error);
  assert.ok((await post(attacker,'/battles/finish',{ending:'mug'})).error);
  assert.equal((await stats(attacker)).energy,30);
  await playFight(attacker,{target_id:defender.id,ending:'mug'});
  assert.ok((await post(defender,'/battles/finish',{ending:'mug'})).error);
  const choices=await Promise.all([post(attacker,'/battles/finish',{ending:'mug'}),post(attacker,'/battles/finish',{ending:'mug'})]);
  assert.equal(choices.filter(r=>!r.error).length,1);assert.equal((await stats(defender)).cash,850);
  assert.equal((await stats(attacker)).energy,5);
});

test('Love Juice reduces attack energy and expired victory defaults to Leave once',async()=>{
 const {attacker,defender}=await combatPair();
 await run('INSERT INTO item_drug_effects(user_id,source_id,expires_at) VALUES(?,870,?)',[attacker.id,Math.floor(Date.now()/1000)+3600]);
 const fight=await playFight(attacker,{target_id:defender.id});assert.equal(fight.user.energy,15);
 const restored=await fetch(origin+'/battles',{headers:{Cookie:attacker.cookie}});assert.equal(restored.status,200);assert.ok((await restored.text()).includes('"expiresAt"'));
 await run('UPDATE battle_victories SET expires_at=0 WHERE attacker_id=?',[attacker.id]);
 const end=await post(attacker,'/battles/finish',{ending:'mug'});assert.equal(end.ending,'leave');assert.equal(end.repGained,3);assert.equal(end.xpGain,37);
 assert.equal((await stats(defender)).cash,1000);assert.ok((await post(attacker,'/battles/finish',{ending:'leave'})).error);
});

test('inventory fallback artwork exists and cannot trigger an image-error reload loop', async () => {
  const response=await fetch(origin+'/amenities/default.png');
  assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});

// Travel uses real persisted timestamps; advancing fixtures avoids waiting through journeys.
async function travelState(user) {
  const response=await fetch(origin+'/yard/state',{headers:{Cookie:user.cookie}});
  assert.equal(response.status,200);
  return response.json();
}
async function arrive(user) {
  await run("UPDATE travel_trips SET arrives_at=0 WHERE user_id=? AND completed_at IS NULL",[user.id]);
  assert.equal((await travelState(user)).travel.phase,'visiting');
}
async function returnHome(user) {
  assert.ok(!(await post(user,'/yard/return')).error);
  await run('UPDATE travel_trips SET return_arrives_at=0 WHERE user_id=? AND completed_at IS NULL',[user.id]);
  return travelState(user);
}
async function relogin(user) {
  const response=await fetch(origin+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:user.username,password:'test-password'}),redirect:'manual'});
  assert.equal(response.status,302);
  user.cookie=response.headers.get('set-cookie').split(';')[0];
}

test('departure validates destination, recovery and fare; concurrent departures charge once and preserve home',async()=>{
  const user=await account();
  for(const destination_id of [0,11,2.5,true,null,'']) assert.ok((await post(user,'/yard/depart',{destination_id})).error);
  await run('UPDATE users SET in_jail=1,jail_until=? WHERE id=?',[Math.floor(Date.now()/1000)+600,user.id]);
  assert.match((await post(user,'/yard/depart',{destination_id:2})).error,/jail/);
  await run('UPDATE users SET in_jail=0,cash=0 WHERE id=?',[user.id]);
  assert.match((await post(user,'/yard/depart',{destination_id:2})).error,/fare/);
  await run("UPDATE users SET cash=1000,bank=800,job_key='janitor',job_prison_id=1 WHERE id=?",[user.id]);
  await run("INSERT INTO cell_amenities (user_id,item_key,placed_tile) VALUES (?,'three_musketeers',1)",[user.id]);
  const results=await Promise.all([post(user,'/yard/depart',{destination_id:2}),post(user,'/yard/depart',{destination_id:3})]);
  assert.equal(results.filter(r=>!r.error).length,1);
  const trip=await query('SELECT * FROM travel_trips WHERE user_id=?',[user.id]);
  const current=await stats(user);
  assert.equal(current.cash,1000-trip.fare);assert.equal(current.prison_id,1);assert.equal(current.bank,800);assert.equal(current.job_key,'janitor');
  assert.equal((await query('SELECT COUNT(*) AS n FROM cell_amenities WHERE user_id=?',[user.id])).n,1);
  assert.equal((await query('SELECT COUNT(*) AS n FROM travel_trips WHERE user_id=?',[user.id])).n,1);
  assert.equal(trip.capacity,6);assert.equal(trip.status,'outbound');
});

test('travel blocks home mutations and combat targets; transit cannot buy or turn around',async()=>{
  const user=await account(),attacker=await account();
  await run('UPDATE users SET energy=30 WHERE id=?',[attacker.id]);
  await post(user,'/yard/depart',{destination_id:2});
  for(const [url,body] of [['/gym/train',{stat:'strength',energy_amount:1}],['/crimes/commit',{crime_key:'pickpocket'}],['/bank/deposit',{amount:50}],['/transport/move',{prison_id:3}],['/inventory/list',{item_type:'collectible',item_key:'island_stamp',price:10}],['/yard/action',{action:'search'}]]) {
    assert.match((await post(user,url,body)).error,/away/);
  }
  assert.match((await playFight(attacker,{target_id:user.id})).error,/away/);
  assert.match((await post(user,'/yard/buy',{item_key:'island_stamp',quantity:1})).error,/Arrive/);
  assert.match((await post(user,'/yard/return')).error,/after arriving/);
  assert.equal((await stats(user)).cash,380);assert.equal((await stats(user)).energy,10);
  await arrive(user);
  assert.match((await post(user,'/yard/sell',{item_key:'island_stamp',quantity:1})).error,/home/);
});

test('overseas purchases enforce typed catalogs, shared stock and bag space atomically',async()=>{
 const a=await account(),b=await account();
 for(const u of [a,b]){await run('UPDATE users SET cash=1000000000 WHERE id=?',[u.id]);await post(u,'/yard/depart',{destination_id:2});await arrive(u);}
 const offers=(await travelState(a)).travel.offers;
 assert.equal(offers.length,12);
 const good=offers.find(g=>g.group==='flowers'),second=offers.find(g=>g.group==='plushies');
 const buy=(u,g,quantity)=>post(u,'/yard/buy',{item_key:g.key,item_type:g.type,quantity});
 for(const q of [0,-1,1.5,true,null,''])assert.ok((await buy(a,good,q)).error);
 assert.ok((await post(a,'/yard/buy',{item_key:'torn_310',item_type:'item',quantity:1})).error);
 assert.ok((await post(a,'/yard/buy',{item_key:good.key,item_type:'weapon',quantity:1})).error);
 await run("UPDATE rotating_stock SET quantity=5 WHERE scope='country:2' AND item_key=? AND item_type=?",[good.key,good.type]);
 await run("UPDATE rotating_stock SET quantity=10 WHERE scope='country:2' AND item_key=? AND item_type=?",[second.key,second.type]);
 const purchases=await Promise.all([buy(a,good,4),buy(b,good,4)]);
 assert.equal(purchases.filter(r=>!r.error).length,1);
 const winner=purchases[0].error?b:a;
 const fills=await Promise.all([buy(winner,second,2),buy(winner,second,2)]);
 assert.equal(fills.filter(r=>!r.error).length,1);
 assert.equal((await query("SELECT quantity FROM rotating_stock WHERE scope='country:2' AND item_type=? AND item_key=?",[good.type,good.key])).quantity,1);
 assert.equal((await stats(winner)).cash,1000000000-120-4*good.price-2*second.price);
 assert.equal((await query('SELECT COUNT(*) AS n FROM inventory WHERE user_id=?',[winner.id])).n,0);
 const page=await fetch(origin+'/airport',{headers:{Cookie:winner.cookie}});assert.equal(page.status,200);assert.match(await page.text(),/General store/);
});

test('typed cargo delivers once under parallel polling and is equippable and tradeable at home',async()=>{
 const user=await account();await run('UPDATE users SET cash=1000000000 WHERE id=?',[user.id]);
 await post(user,'/yard/depart',{destination_id:3});await arrive(user);
 const good=(await travelState(user)).travel.offers.filter(g=>g.group==='weapons').sort((a,b)=>a.price-b.price)[0];
 await run("UPDATE rotating_stock SET quantity=10 WHERE scope='country:3' AND item_key=? AND item_type=?",[good.key,good.type]);
 assert.ok(!(await post(user,'/yard/buy',{item_key:good.key,item_type:good.type,quantity:2})).error);
 await run('UPDATE users SET cash=0 WHERE id=?',[user.id]);
 assert.ok(!(await post(user,'/yard/return')).error);
 await run('UPDATE travel_trips SET return_arrives_at=0 WHERE user_id=?',[user.id]);
 await Promise.all(Array.from({length:6},()=>travelState(user)));
 assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=? AND item_type=? AND item_key=?',[user.id,good.type,good.key])).quantity,2);
 assert.equal((await query('SELECT trips_completed FROM travel_progress WHERE user_id=?',[user.id])).trips_completed,1);
 assert.equal((await stats(user)).cash,0);
 assert.ok(!(await post(user,'/equipment/equip',{slot:'weapon',key:good.key,action:'equip'})).error);
 assert.ok(!(await post(user,'/inventory/list',{item_type:good.type,item_key:good.key,quantity:1,price:100})).error);
});

test('empty return remains prepaid and the overseas store is not purchasable from home',async()=>{
 const user=await account();
 assert.ok((await post(user,'/yard/buy',{item_key:'buckeye_token',quantity:1})).error);
 await post(user,'/yard/depart',{destination_id:2});await arrive(user);
 await run('UPDATE users SET cash=0 WHERE id=?',[user.id]);
 assert.equal((await returnHome(user)).travel.phase,'home');assert.equal((await stats(user)).cash,0);
});

test('hourly stock stays sold out until deadline; rare offers expire; country catalogs stay fixed',async()=>{
 const {ROUTES}=require('../middleware/travel');const {overseasCatalog,quantityFor}=require('../middleware/shops');
 assert.equal(ROUTES.length,10);
 for(const r of ROUTES){const goods=overseasCatalog(r.id);assert.equal(goods.length,12);assert.equal(new Set(goods.map(g=>g.key)).size,12);assert.equal(goods.filter(g=>g.rare).length,2);}
 assert.ok(quantityFor(100,'cheap')>=400);assert.ok([2,3].includes(quantityFor(400000000,'expensive')));
 const all=ROUTES.flatMap(r=>overseasCatalog(r.id));assert.ok(all.some(i=>i.localPrice<i.price));assert.ok(all.some(i=>i.localPrice>i.price));
 const user=await account();await post(user,'/yard/depart',{destination_id:2});await arrive(user);
 const before=(await travelState(user)).travel.offers;
 const good=before.find(g=>!g.rare),rare=before.find(g=>g.rare);
 await run("UPDATE rotating_stock SET quantity=0 WHERE scope='country:2' AND item_key=?",[good.key]);
 assert.equal((await travelState(user)).travel.offers.find(i=>i.key===good.key).quantity,0);
 await run("UPDATE rotating_stock SET restock_at=0 WHERE scope='country:2' AND item_key=?",[good.key]);
 const fresh=(await travelState(user)).travel.offers;
 assert.ok(fresh.find(i=>i.key===good.key).quantity>0);assert.equal(fresh[0].restock_at%3600,0);
 assert.deepEqual(fresh.map(g=>g.key),before.map(g=>g.key));
 await run("UPDATE rotating_stock SET active=1,quantity=3,expires_at=1 WHERE scope='country:2' AND item_key=?",[rare.key]);
 assert.ok((await post(user,'/yard/buy',{item_key:rare.key,item_type:rare.type,quantity:1})).error);
 assert.equal((await travelState(user)).travel.offers.find(g=>g.key===rare.key).quantity,0);
});

test('bag upgrades require trips and cash, charge once, and persist capacity at departure',async()=>{
  const user=await account();
  assert.match((await post(user,'/yard/upgrade')).error,/Complete 3/);
  await run('INSERT INTO travel_progress (user_id,trips_completed) VALUES (?,3)',[user.id]);
  assert.match((await post(user,'/yard/upgrade')).error,/2500/);
  await run('UPDATE users SET cash=20000 WHERE id=?',[user.id]);
  const upgrades=await Promise.all([post(user,'/yard/upgrade'),post(user,'/yard/upgrade')]);
  assert.equal(upgrades.filter(r=>!r.error).length,1);assert.equal((await stats(user)).cash,17500);
  const departed=await post(user,'/yard/depart',{destination_id:3});assert.equal(departed.travel.trip.capacity,10);
  await run('UPDATE travel_progress SET bag_level=2 WHERE user_id=?',[user.id]);
  assert.equal((await travelState(user)).travel.trip.capacity,10);
});

test('collection reward requires all ten discoveries and pays exactly once without consuming goods',async()=>{
  const user=await account();assert.match((await post(user,'/yard/collection')).error,/all 10/);
  for(const g of require('../middleware/travel').GOODS) await run('INSERT INTO travel_discoveries (user_id,item_key,first_found,total_brought) VALUES (?,?,0,1)',[user.id,g.key]);
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'island_stamp','collectible',1)",[user.id]);
  const results=await Promise.all([post(user,'/yard/collection'),post(user,'/yard/collection')]);
  assert.equal(results.filter(r=>!r.error).length,1);assert.equal((await stats(user)).cash,2000);assert.equal((await stats(user)).rep,5);
  assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[user.id])).quantity,1);
});

test('collectibles trade through the actual market form endpoint, with one buyer and full-quantity cancellation',async()=>{
  const seller=await account(),a=await account(),b=await account();
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'island_stamp','collectible',5)",[seller.id]);
  assert.ok(!(await post(seller,'/openmarket/list',{item_type:'collectible',item_key:'island_stamp',quantity:3,price:100})).error);
  const listing=await query('SELECT * FROM open_market WHERE seller_id=? AND active=1',[seller.id]);
  const html=await (await fetch(origin+'/openmarket?cat=collectible',{headers:{Cookie:a.cookie}})).text();assert.match(html,/London Stamp/);
  const buys=await Promise.all([post(a,'/openmarket/buy',{listing_id:listing.id}),post(b,'/openmarket/buy',{listing_id:listing.id})]);
  assert.equal(buys.filter(r=>!r.error).length,1);assert.equal((await stats(seller)).cash,590);
  const winner=buys[0].error?b:a;
  assert.equal((await query('SELECT total_brought FROM travel_discoveries WHERE user_id=?',[winner.id])).total_brought,3);
  assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[winner.id])).quantity,3);
  assert.ok(!(await post(seller,'/inventory/list',{item_type:'collectible',item_key:'island_stamp',quantity:2,price:50})).error);
  const second=await query('SELECT id FROM open_market WHERE seller_id=? AND active=1',[seller.id]);
  const cancels=await Promise.all([post(seller,'/openmarket/cancel',{listing_id:second.id}),post(seller,'/openmarket/cancel',{listing_id:second.id})]);
  assert.equal(cancels.filter(r=>!r.error).length,1);
  assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[seller.id])).quantity,2);
});

test('trip phases and cargo survive restarts and legacy inventory without a unique constraint',async()=>{
  const user=await account();await run('UPDATE users SET cash=2000 WHERE id=?',[user.id]);
  await post(user,'/yard/depart',{destination_id:2});
  await stop();await start();await relogin(user);
  assert.equal((await travelState(user)).travel.phase,'outbound');
  await arrive(user);
  const savedTrip=await query('SELECT id FROM travel_trips WHERE user_id=? AND completed_at IS NULL',[user.id]);
  await run("INSERT INTO travel_cargo (trip_id,item_key,quantity) VALUES (?,'island_stamp',2)",[savedTrip.id]);
  await stop();await start();await relogin(user);
  assert.equal((await travelState(user)).travel.phase,'visiting');
  await post(user,'/yard/return');
  await stop();
  // Match older installed databases, which allow duplicate inventory rows.
  await run('ALTER TABLE inventory RENAME TO inventory_before_legacy_test');
  await run('CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,item_key TEXT NOT NULL,item_type TEXT NOT NULL,quantity INTEGER DEFAULT 1)');
  await run('INSERT INTO inventory SELECT * FROM inventory_before_legacy_test');
  await run('DROP TABLE inventory_before_legacy_test');
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'island_stamp','collectible',1)",[user.id]);
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'island_stamp','collectible',2)",[user.id]);
  await start();await relogin(user);
  assert.equal((await travelState(user)).travel.phase,'returning');
  await run('UPDATE travel_trips SET return_arrives_at=0 WHERE user_id=?',[user.id]);
  const home=await travelState(user);assert.equal(home.travel.phase,'home');
  assert.equal(home.travel.inventory.find(i=>i.item_key==='island_stamp').quantity,5);
  const sold=await post(user,'/yard/sell',{item_key:'island_stamp',quantity:5});assert.ok(!sold.error);
  assert.equal((await query('SELECT COUNT(*) AS n FROM inventory WHERE user_id=?',[user.id])).n,0);
  assert.equal((await query('SELECT trips_completed FROM travel_progress WHERE user_id=?',[user.id])).trips_completed,1);
});

test('shop rejects retired and incorrectly typed items without charging',async()=>{
 const user=await account();const cash=(await stats(user)).cash;
 for(const body of [{item_key:'knuckle_wraps',item_type:'item'},{item_key:'knuckle_wraps',item_type:'weapon'},{item_key:'torn_2',item_type:'item'}])
  assert.ok((await post(user,'/marketplace/buy',body)).error);
 assert.equal((await stats(user)).cash,cash);
});

test('shop validates typed identity and makes old tiers available without relocation',async()=>{
 const user=await account();await stocked(user);await run('UPDATE users SET cash=100000 WHERE id=?',[user.id]);
 for(const body of [{item_key:'minigun',item_type:'item'},{item_key:'island_stamp',item_type:'collectible'},{item_key:'__proto__',item_type:'weapon'},{item_key:'shiv',item_type:'__proto__'},{item_key:'shiv'}]) assert.ok((await post(user,'/marketplace/buy',body)).error);
 assert.equal((await stats(user)).cash,100000);
 assert.equal((await query('SELECT COUNT(*) AS n FROM inventory WHERE user_id=?',[user.id])).n,0);
 assert.ok(!(await post(user,'/marketplace/buy',{item_key:'torn_2',item_type:'weapon'})).error);
 assert.equal((await stats(user)).cash,99800);
});
test('shop validates quantities and charges exactly once for parallel purchases with limited cash',async()=>{
 const user=await account();await stocked(user);
 for(const quantity of [0,-1,1.5,true,null,'',101,9007199254740992]) assert.ok((await post(user,'/marketplace/buy',{item_key:'torn_310',item_type:'item',quantity})).error);
 await run('UPDATE users SET cash=7500 WHERE id=?',[user.id]);
 const results=await Promise.all([post(user,'/marketplace/buy',{item_key:'torn_68',item_type:'item'}),post(user,'/marketplace/buy',{item_key:'torn_68',item_type:'item'})]);
 assert.equal(results.filter(r=>!r.error).length,1);assert.equal((await stats(user)).cash,0);
 assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[user.id])).quantity,1);
 assert.equal((await query("SELECT COUNT(*) AS n FROM transaction_logs WHERE from_id=? AND type='shop_purchase'",[user.id])).n,1);
});
test('shop bulk purchase preserves bank, base stats and existing stacks in a legacy inventory',async()=>{
 const user=await account();await stocked(user);await run('UPDATE users SET cash=1000,bank=600 WHERE id=?',[user.id]);
 await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'torn_310','item',2)",[user.id]);
 const result=await post(user,'/marketplace/buy',{item_key:'torn_310',item_type:'item',quantity:3});
 assert.ok(!result.error);assert.equal(result.user.cash,925);assert.equal(result.user.bank,600);
 assert.equal((await stats(user)).strength,10);
 assert.equal((await query("SELECT SUM(quantity) AS n FROM inventory WHERE user_id=? AND item_key='torn_310'",[user.id])).n,5);
});


test('city setting provides canonical pages and city travel while preserving legacy saves and URLs',async()=>{
 const user=await account();await stocked(user);
 await run("UPDATE users SET bank=750,job_key='cleaner',job_prison_id=1 WHERE id=?",[user.id]);
 for(const url of ['/city','/airport','/property','/shop?tab=items','/hospital','/jail','/citizens','/broker','/broker-supplies','/relocate','/factions','/my-faction','/faction-invites','/prison','/prison/yard','/cell']) {
  const response=await fetch(origin+url,{headers:{Cookie:user.cookie}});assert.equal(response.status,200,url);
 }
 const city=await (await fetch(origin+'/city',{headers:{Cookie:user.cookie}})).text();
 assert.match(city,/city-map-viewport/);assert.match(city,/Lock down/);
 const home=await(await fetch(origin+'/home',{headers:{Cookie:user.cookie}})).text();assert.match(home,/CITIZEN OVERVIEW/);assert.match(home,/PRISONHALL1.png/);
 const airport=await (await fetch(origin+'/airport',{headers:{Cookie:user.cookie}})).text();
 assert.match(airport,/INTERNATIONAL EXCHANGE/);assert.match(airport,/London/);assert.match(airport,/Tokyo/);assert.match(airport,/Dubai/);assert.match(airport,/Brazil/);
 const bought=await post(user,'/shop/buy',{item_key:'torn_310',item_type:'item'});assert.ok(!bought.error);assert.equal(bought.user.bank,750);
 const trip=await post(user,'/airport/depart',{destination_id:2});assert.ok(!trip.error);assert.equal(trip.travel.phase,'outbound');
 const state=await (await fetch(origin+'/airport/state',{headers:{Cookie:user.cookie}})).json();assert.equal(state.travel.trip.destination_id,2);
 assert.match((await post(user,'/property/clear')).error,/away/);
 const saved=await stats(user);assert.equal(saved.prison_id,1);assert.equal(saved.job_key,'cleaner');assert.equal(saved.bank,750);
});

test('dexterity trains independently, survives saves and appears in history and city pages', async()=>{
 const user=await account();await run('UPDATE users SET xp_needed=100000 WHERE id=?',[user.id]);
 const trained=await post(user,'/gym/train',{stat:'dexterity',energy_amount:5});
 assert.equal(trained.gain,10);assert.equal(trained.user.dexterity,18);assert.equal(trained.user.strength,10);
 assert.equal(trained.user.happiness,95);assert.equal(trained.historyEntry.dexterity,18);
 await post(user,'/bank/deposit',{amount:50});
 assert.equal((await stats(user)).dexterity,18);
 assert.equal((await query('SELECT dexterity FROM training_history WHERE user_id=?',[user.id])).dexterity,18);
 const gym=await(await fetch(origin+'/gym',{headers:{Cookie:user.cookie}})).text();assert.match(gym,/Train dexterity/);
 const home=await(await fetch(origin+'/home',{headers:{Cookie:user.cookie}})).text();assert.match(home,/DEX 18/);
});

test('property comfort counts distinct valid furnishings and happiness boosts the displayed training gain',async()=>{
 const user=await account();
 const {CELL_AMENITIES}=require('../middleware/gamedata');const keys=Object.keys(CELL_AMENITIES).slice(0,10);
 // Equalize existing stat/energy bonuses so only happiness is under test.
 for(const key of keys) await run('INSERT INTO cell_amenities (user_id,item_key,placed_tile) VALUES (?,?,1)',[user.id,key]);
 await run('INSERT INTO cell_amenities (user_id,item_key,placed_tile) VALUES (?,?,2)',[user.id,keys[0]]);
 await run("INSERT INTO cell_amenities (user_id,item_key,placed_tile) VALUES (?,'__proto__',3)",[user.id]);
 await run('UPDATE users SET happiness=200,energy=10,xp_needed=100000 WHERE id=?',[user.id]);
 const before=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
 assert.equal(before.max_happiness,200);assert.equal(before.happiness,200);
 const trained=await post(user,'/gym/train',{stat:'dexterity',energy_amount:5});
 assert.equal(trained.gain,12);assert.equal(trained.user.happiness,195);
 assert.equal(trained.user.dexterity,20);
 await run('DELETE FROM cell_amenities WHERE user_id=?',[user.id]);
 const after=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
 assert.equal(after.max_happiness,100);assert.equal(after.happiness,100);assert.equal(after.dexterity,20);
});

test('home breaks charge once under concurrency and respect recovery, funds and full happiness',async()=>{
 const user=await account();await run('UPDATE users SET happiness=10,happiness_last_regen=? WHERE id=?',[Math.floor(Date.now()/1000),user.id]);
 const results=await Promise.all([post(user,'/property/relax'),post(user,'/property/relax')]);
 assert.equal(results.filter(r=>!r.error).length,1);
 let saved=await stats(user);assert.equal(saved.cash,450);assert.equal(saved.happiness,35);assert.ok(saved.relax_ready_at>Math.floor(Date.now()/1000));
 await run('UPDATE users SET relax_ready_at=0,cash=49 WHERE id=?',[user.id]);
 assert.match((await post(user,'/property/relax')).error,/Need \$50/);
 await run('UPDATE users SET happiness=100,cash=100 WHERE id=?',[user.id]);
 assert.match((await post(user,'/property/relax')).error,/already full/);assert.equal((await stats(user)).cash,100);
 await run('UPDATE users SET happiness=10,in_hospital=1,hospital_until=? WHERE id=?',[Math.floor(Date.now()/1000)+600,user.id]);
 assert.match((await post(user,'/property/relax')).error,/Recover/);
 await run('UPDATE users SET in_hospital=0,cash=1000 WHERE id=?',[user.id]);
 await post(user,'/airport/depart',{destination_id:2});
 assert.match((await post(user,'/property/relax')).error,/away/);
});

test('offline happiness keeps fractional ticks and cannot bank recovery at full capacity',async()=>{
 const user=await account(),now=Math.floor(Date.now()/1000);
 await run('UPDATE users SET happiness=20,happiness_last_regen=? WHERE id=?',[now-1900,user.id]);
 const regenerated=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
 assert.equal(regenerated.happiness,30);assert.equal((await stats(user)).happiness_last_regen,now-100);
 await run('UPDATE users SET happiness=100,happiness_last_regen=? WHERE id=?',[now-86400,user.id]);
 await post(user,'/gym/train',{stat:'dexterity',energy_amount:1});
 const current=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(current.happiness,99);
});

test('successful crime experience grows nerve capacity once without stacking base or property bonuses',async()=>{
 const user=await account();await run('UPDATE users SET crime_xp=98,xp_needed=100000 WHERE id=?',[user.id]);
 const success=await post(user,'/crimes/commit',{crime_key:'pickpocket'});
 assert.equal(success.caught,false);assert.equal(success.user.criminal.xp,100);assert.equal(success.user.criminal.nerveBonus,1);
 assert.equal(success.user.max_nerve,6);assert.equal((await stats(user)).max_nerve,5);
 for(let i=0;i<3;i++) assert.equal((await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json()).max_nerve,6);
 await post(user,'/bank/deposit',{amount:10});assert.equal((await stats(user)).max_nerve,5);
 await run('UPDATE users SET crime_xp=999999 WHERE id=?',[user.id]);
 const capped=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(capped.max_nerve,30);assert.equal(capped.criminal.nextAt,null);
});

test('failed crimes and rolled-back actions do not grant criminal experience',async()=>{
 await stop();await start(0.01);
 const user=await account();const failed=await post(user,'/crimes/commit',{crime_key:'pickpocket'});
 assert.equal(failed.caught,true);assert.equal(failed.user.criminal.xp,0);
 await stop();await start();await relogin(user);
 await run('UPDATE users SET in_jail=0,nerve=5 WHERE id=?',[user.id]);
 await run("CREATE TRIGGER reject_city_mastery BEFORE INSERT ON crime_mastery BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
 try {
  const response=await fetch(origin+'/crimes/commit',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:JSON.stringify({crime_key:'pickpocket'})});
  assert.equal(response.status,500);assert.equal((await stats(user)).crime_xp,0);
 } finally {await run('DROP TRIGGER reject_city_mastery');}
});

test('dexterity evades hits and training speed counters evasive defenders',()=>{
 const {simulateFight}=require('../middleware/dynamics');
 const base={username:'A',hp:100000,strength:50,defense:25,speed:25,dexterity:25,stamina:100};
 const normal=simulateFight(base,{...base,username:'B'},'balanced',()=>0.5);
 const evasive=simulateFight(base,{...base,username:'B',dexterity:10000},'balanced',()=>0.5);
 assert.ok(evasive.damageDealt<normal.damageDealt);assert.ok(evasive.log.some(line=>line.includes('evades')));
 const counter=simulateFight({...base,speed:10000},{...base,username:'B',dexterity:10000},'balanced',()=>0.5);
 assert.ok(counter.damageDealt>evasive.damageDealt);
});

test('city life migrations preserve older accounts and do not reapply on restart',async()=>{
 const user=await account();await run('UPDATE users SET cash=1234,bank=567,level=4,strength=42,crime_xp=199,dexterity=55,happiness=65,relax_ready_at=123 WHERE id=?',[user.id]);
 await stop();
 // Remove just the new columns to reproduce a saved game from the previous city update.
 for(const column of ['dexterity','happiness','happiness_last_regen','relax_ready_at','crime_xp'])await run(`ALTER TABLE users DROP COLUMN ${column}`);
 await run('ALTER TABLE training_history DROP COLUMN dexterity');
 await start();await relogin(user);
 const migrated=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
 assert.equal(migrated.cash,1234);assert.equal(migrated.bank,567);assert.equal(migrated.strength,42);assert.equal(migrated.level,4);
 assert.equal(migrated.dexterity,8);assert.equal(migrated.happiness,100);assert.equal(migrated.criminal.xp,0);
 await run('UPDATE users SET dexterity=55,happiness=65,crime_xp=199 WHERE id=?',[user.id]);
 await stop();await start();await relogin(user);
 const restarted=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
 assert.equal(restarted.dexterity,55);assert.equal(restarted.happiness,65);assert.equal(restarted.criminal.xp,199);
 assert.equal(restarted.cash,1234);assert.equal(restarted.bank,567);
});

test('permanent relocation is disabled without changing money, job, home or listings',async()=>{
 const user=await account();await run("UPDATE users SET level=20,cash=5000,bank=700,job_key='cleaner',job_prison_id=1 WHERE id=?",[user.id]);
 const before=await stats(user);
 for(const url of ['/relocate/move','/transport/move'])assert.match((await post(user,url,{prison_id:2})).error,/closed/);
 const after=await stats(user);for(const key of ['cash','bank','job_key','prison_id'])assert.equal(after[key],before[key]);
 const response=await fetch(origin+'/relocate',{headers:{Cookie:user.cookie},redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/airport');
});

test('homes buy once, require ownership to move in and keep furnishings and city intact',async()=>{
 const user=await account(),other=await account();await run('UPDATE users SET cash=100000 WHERE id=?',[user.id]);
 const attempts=await Promise.all([post(user,'/property/buy-home',{home_key:'townhouse'}),post(user,'/property/buy-home',{home_key:'townhouse'})]);
 assert.equal(attempts.filter(r=>!r.error).length,1);assert.equal((await stats(user)).cash,75000);
 assert.ok((await post(other,'/property/move-in',{home_key:'townhouse'})).error);
 assert.ok(!(await post(user,'/property/move-in',{home_key:'townhouse'})).error);
 assert.equal((await query('SELECT home_key FROM owned_homes WHERE user_id=? AND active=1',[user.id])).home_key,'townhouse');
 const {CELL_AMENITIES}=require('../middleware/gamedata');const [key,item]=Object.entries(CELL_AMENITIES).find(([,i])=>Number.isSafeInteger(i.price)&&i.price>0&&i.price<1000);
 assert.ok(!(await post(user,'/property/buy-furnishing',{item_key:key})).error);
 assert.equal((await stats(user)).cash,75000-item.price);
 const furnishing=await query('SELECT id FROM cell_amenities WHERE user_id=?',[user.id]);
 assert.ok((await post(other,'/property/place',{db_id:furnishing.id})).error);
 assert.ok(!(await post(user,'/property/place',{db_id:furnishing.id})).error);
 assert.ok((await post(user,'/property/place',{db_id:furnishing.id})).error);
 assert.ok(!(await post(user,'/property/move-in',{home_key:'starter'})).error);
 assert.notEqual((await query('SELECT placed_tile FROM cell_amenities WHERE id=?',[furnishing.id])).placed_tile,null);
 assert.equal((await stats(user)).prison_id,1);
 const response=await fetch(origin+'/property',{headers:{Cookie:user.cookie}});const html=await response.text();assert.equal(response.status,200);assert.match(html,/YOU LIVE HERE/);assert.doesNotMatch(html,/id="cellArea"/);
});

test('only imported avatars remain and retired presets cannot restore old artwork', async () => {
 const user=await account();
 const {AVATAR_PARTS,DEFAULT_AVATAR,avatarImages}=require('../middleware/avatardata');
 assert.deepEqual(JSON.parse((await stats(user)).avatar),DEFAULT_AVATAR);
 assert.deepEqual(avatarImages({head:'head-001',hats:'hat-cap-black'}),[]);
 assert.ok(Object.values(AVATAR_PARTS).flat().every(p=>!p.img||p.img.startsWith('/avatars/imported/')));
 const result=await post(user,'/surgeon/save',{layers:{head:'head-001',nose:'nose-small-medium'}});
 assert.ok(!result.error);
 assert.deepEqual(JSON.parse((await stats(user)).avatar),DEFAULT_AVATAR);
 await post(user,'/surgeon/preset/save',{slot:1,layers:{head:'head-001'}});
 assert.deepEqual(JSON.parse((await query('SELECT layers FROM avatar_presets WHERE user_id=?',[user.id])).layers),DEFAULT_AVATAR);
 const response=await fetch(origin+'/surgeon/starter',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:JSON.stringify({id:'runner'})});
 assert.equal(response.status,400);
 const html=await (await fetch(origin+'/surgeon',{headers:{Cookie:user.cookie}})).text();
 assert.doesNotMatch(html,/data-starter=|6 FREE CHARACTERS|head-001/);
});

test('city catalog purchases flow into consumable use and equipped combat stats', async () => {
  const user = await account();await stocked(user);
  await run('UPDATE users SET cash=20000, hp=1 WHERE id=?', [user.id]);
  assert.ok(!(await post(user, '/shop/buy', { item_key: 'torn_68', item_type: 'item' })).error);
  const used = await post(user, '/inventory/use', { item_key: 'torn_68', item_type: 'item' });
  assert.ok(!used.error);
  assert.ok((await query('SELECT hp FROM users WHERE id=?', [user.id])).hp > 1);
  assert.ok(!(await post(user, '/shop/buy', { item_key: 'torn_2', item_type: 'weapon' })).error);
  assert.ok((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_2'", [user.id])).quantity === 1);
  const equipped = await post(user, '/equipment/equip', { action: 'equip', slot: 'weapon', key: 'torn_2' });
  assert.ok(!equipped.error);
  assert.equal((await query('SELECT weapon FROM equipment WHERE user_id=?', [user.id])).weapon, 'torn_2');
});

test('unified inventory shows owned equipment, typed stacks, collectibles and unplaced furniture', async () => {
  const user = await account(), other = await account();
  for (const [key, type, quantity] of [
    ['torn_1','weapon',2], ['shiv','item',1], ['torn_68','item',3],
    ['torn_530','item',4], ['torn_180','item',2], ['buckeye_token','collectible',5],
  ]) await run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,?)', [user.id,key,type,quantity]);
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'minigun','weapon',9)", [other.id]);
  await run("INSERT INTO cell_amenities (user_id,item_key) VALUES (?,'jump_street')", [user.id]);
  await run("INSERT INTO cell_amenities (user_id,item_key,placed_tile) VALUES (?,'bag_of_coal',0)", [user.id]);
  await run("INSERT INTO equipment (user_id,weapon) VALUES (?,'torn_1')", [user.id]);
  await run("INSERT INTO recovery_cooldowns (user_id,category,ready_at) VALUES (?,'medical',?)", [user.id,Math.floor(Date.now()/1000)+240]);
  const response = await fetch(origin + '/inventory', { headers: { Cookie:user.cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-category="melee"/);
  assert.match(html, /data-category="medical"/);
  assert.match(html, /data-category="energy_drinks"/);
  assert.match(html, /data-category="alcohol"/);
  for (const [key,type] of [['torn_1','weapon'],['buckeye_token','collectible'],['jump_street','amenity']]) {
    assert.ok(html.includes('data-key="' + key + '" data-type="' + type + '"'));
  }
  assert.ok(!html.includes('data-key="minigun"'));
  assert.ok(!html.includes('data-key="bag_of_coal"'));
  assert.match(html, /Equipped loadout/);
  assert.match(html, /data-action="unequip"/);
  assert.match(html, /id="item-sell-quantity"/);
  // Listing from the unified page keeps typed identity and stack quantity intact.
  const listed = await post(user, '/inventory/list', {item_key:'torn_1',item_type:'weapon',quantity:1,price:100});
  assert.ok(!listed.error);
  assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1' AND item_type='weapon'", [user.id])).quantity,1);
  assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='shiv' AND item_type='item'", [user.id])).quantity,1);
});

test('market only shows active stock, preserves sold-out rows and rejects hidden purchases',async()=>{
 const user=await account();
 await fetch(origin+'/market',{headers:{Cookie:user.cookie}});
 const now=Math.floor(Date.now()/1000);
 await run("UPDATE rotating_stock SET active=0 WHERE scope='home' AND item_key='torn_1'");
 await run("UPDATE rotating_stock SET active=1,quantity=0 WHERE scope='home' AND item_key='torn_2'");
 for(const url of ['/market','/shop']){
  const response=await fetch(origin+url,{headers:{Cookie:user.cookie}});const html=await response.text();assert.equal(response.status,200);
  assert.ok(!html.includes('data-key="torn_1"'));assert.ok(html.includes('data-key="torn_2"'));assert.match(html,/Sold out/);assert.doesNotMatch(html,/Relocate|Torn/);
 }
 assert.ok((await post(user,'/marketplace/buy',{item_key:'torn_1',item_type:'weapon'})).error);
 assert.ok((await post(user,'/marketplace/buy',{item_key:'torn_2',item_type:'weapon'})).error);
 const a=await account(),b=await account();
 await run("UPDATE rotating_stock SET active=1,quantity=1,restock_at=? WHERE scope='home' AND item_key='torn_310' AND item_type='item'",[now+3600]);
 const results=await Promise.all([post(a,'/marketplace/buy',{item_key:'torn_310',item_type:'item'}),post(b,'/marketplace/buy',{item_key:'torn_310',item_type:'item'})]);
 assert.equal(results.filter(r=>!r.error).length,1);
 assert.equal((await stats(a)).cash+(await stats(b)).cash,975);
 assert.equal((await query("SELECT quantity FROM rotating_stock WHERE scope='home' AND item_key='torn_310' AND item_type='item'")).quantity,0);
});

test('full Torn Stats catalog preserves metadata, saved types and verified local images', () => {
  const { readFileSync } = require('node:fs');
  const { createHash } = require('node:crypto');
  const source = require('../data/tornstats-items.json');
  const legacy = require('../data/torn-legacy-types.json').types;
  const { categoryFor } = require('../middleware/torn-catalog');
  const images = require('../data/torn-item-images.json');
  const { CATALOGS } = require('../middleware/item-catalog');
  const imported = Object.entries(CATALOGS).flatMap(([type,catalog]) => Object.entries(catalog)
    .filter(([,item]) => item.source_id).map(([key,item]) => ({type,key,...item})));
  assert.equal(source.items.length,1509);
  assert.equal(imported.length,source.items.length);
  assert.equal(Math.max(...source.items.map(item => item.id)),1556);
  const byId = new Map(imported.map(item => [item.source_id,item]));
  assert.equal(byId.size,1509);
  for (const record of source.items) {
    const {id} = record;
    const item = byId.get(id);
    assert.equal(item.key,'torn_'+id);
    assert.equal(item.name,record.name.replace(/torn/gi,'Lock down'));
    assert.equal(item.source_description,record.description.replace(/torn/gi,'Lock down'));
    assert.equal(item.source_market_value,record.market_value);
    assert.equal(item.source_buy,record.buy);
    assert.equal(item.source_sell,record.sell);
    assert.equal(item.source_circulation,record.circulation);
    assert.equal(item.category,categoryFor(record.type));
    if (legacy[id]) assert.equal(item.type,legacy[id], 'saved storage type '+id);
    assert.equal(item.for_sale,record.type!=='Unused');
    const bytes = readFileSync(path.join(root,'public',item.img));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),images.images[id]);
    assert.ok(Number.isSafeInteger(item.price) && item.price>0);
  }
  assert.equal(CATALOGS.weapon.baseball_bat,undefined);
  assert.equal(CATALOGS.weapon.torn_2.name,'Baseball Bat');
  assert.equal(CATALOGS.weapon.torn_1.price,75); // positive published buy price
  assert.equal(CATALOGS.item.torn_35.price,862); // buy=0 uses market value
  assert.equal(CATALOGS.item.torn_1556.price,70000000); // no buy/market uses sell
  assert.equal(CATALOGS.item.torn_744.price,250); // no published positive price
  assert.equal(CATALOGS.weapon.torn_14.name,'Ruger 57'); // updated source name
  assert.deepEqual(images.unavailableSourceImages,[1218,1229]);
  assert.throws(() => categoryFor('New unrecognized category'), /Unknown source/);
});

test('imported items purchase, equip, recover, trade and survive restart without altering legacy items', async () => {
  const user = await account();
  await run('UPDATE users SET cash=100000000, hp=10, energy=0 WHERE id=?',[user.id]);
  await fetch(origin+'/market',{headers:{Cookie:user.cookie}});
  await run("UPDATE rotating_stock SET active=1,quantity=10 WHERE scope='home' AND item_key IN ('torn_1','torn_32','torn_66','torn_206','torn_77','torn_744','torn_1556')");
  for (const [key,type] of [['torn_1','weapon'],['torn_32','armor'],['torn_66','item'],['torn_206','drug'],['torn_77','item'],['torn_744','item']]) {
    assert.ok(!(await post(user,'/marketplace/buy',{item_key:key,item_type:type})).error,key);
  }
  assert.ok(!(await post(user,'/equipment/equip',{action:'equip',slot:'weapon',key:'torn_1'})).error);
  const equipped = await stats(user);
  assert.equal(equipped.strength,10); // equipment doesn't overwrite base stats
  const used = await post(user,'/inventory/use',{item_key:'torn_66',item_type:'item'});
  assert.ok(!used.error);
  assert.equal(used.user.hp,25);
  assert.equal(used.category,'medical');
  const drug = await post(user,'/inventory/use',{item_key:'torn_206',item_type:'drug'});
  assert.ok(!drug.error);
  assert.equal(drug.category,'drug');
  assert.ok((await post(user,'/inventory/use',{item_key:'torn_77',item_type:'item'})).error);
  assert.ok(!(await post(user,'/inventory/list',{item_key:'torn_77',item_type:'item',quantity:1,price:25000})).error);
  assert.ok((await post(user,'/inventory/list',{item_key:'torn_744',item_type:'item',quantity:1,price:5000})).error);
  for (const key of ['torn_168','torn_208','torn_589','torn_590','torn_591','torn_592']) {
    assert.ok((await post(user,'/marketplace/buy',{item_key:key,item_type:'item'})).error);
  }
  const cashBefore = (await stats(user)).cash;
  const newItem = await post(user,'/marketplace/buy',{item_key:'torn_1556',item_type:'item'});
  assert.ok(!newItem.error);
  assert.equal(newItem.user.cash,cashBefore-70000000);
  const rejected = await post(user,'/marketplace/buy',{item_key:'torn_1556',item_type:'item'});
  assert.ok(rejected.error);
  assert.equal((await stats(user)).cash,cashBefore-70000000);
  await stop(); await start();
  assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1556'",[user.id])).quantity,1);
  assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1'",[user.id])).quantity,1);
  assert.equal((await query('SELECT weapon FROM equipment WHERE user_id=?',[user.id])).weapon,'torn_1');
  const login = await fetch(origin+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:user.username,password:'test-password'}),redirect:'manual'});
  assert.equal(login.status,302);
  user.cookie=login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(origin+'/inventory',{headers:{Cookie:user.cookie}});
  assert.equal(response.status,200);
  assert.match(await response.text(),/images\/torn-items\/1.png/);
});

test('home stock rotation retains some items and hides others without rerolling on reads',async()=>{
 const {stockFor,shopItems}=require('../middleware/shops');
 const all=(sql,params)=>new Promise((resolve,reject)=>connection.all(sql,params,(e,rows)=>e?reject(e):resolve(rows)));
 const store={run,all};const items=shopItems().filter(i=>i.source_id).slice(0,100);
 await run("DELETE FROM rotating_stock WHERE scope='home'");
 const first=await stockFor(store,'home',items,3600);
 const second=await stockFor(store,'home',items,7200);
 assert.ok(first.some(i=>i.available&&second.find(j=>j.key===i.key).available));
 assert.ok(first.some(i=>i.available&&!second.find(j=>j.key===i.key).available));
 assert.ok(second.some(i=>i.available&&!first.find(j=>j.key===i.key).available));
 const again=await stockFor(store,'home',items,7201);
 assert.deepEqual(again.map(i=>[i.key,i.quantity,i.active]),second.map(i=>[i.key,i.quantity,i.active]));
});

test('failed cargo and property writes roll back charges and stock',async()=>{
 const user=await account();await run('UPDATE users SET cash=10000000 WHERE id=?',[user.id]);
 await post(user,'/yard/depart',{destination_id:2});await arrive(user);
 const good=(await travelState(user)).travel.offers.find(g=>g.group==='flowers');
 const before=await stats(user);
 await run("CREATE TRIGGER fail_cargo BEFORE INSERT ON travel_cargo BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 try{
  const r=await fetch(origin+'/yard/buy',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:JSON.stringify({item_key:good.key,item_type:good.type,quantity:1})});
  assert.equal(r.status,500);assert.equal((await stats(user)).cash,before.cash);
  assert.equal((await travelState(user)).travel.offers.find(i=>i.key===good.key).quantity,good.quantity);
 }finally{await run('DROP TRIGGER fail_cargo');}
 await returnHome(user);
 await run("CREATE TRIGGER fail_home BEFORE INSERT ON owned_homes WHEN NEW.home_key='villa' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 try{
  const r=await fetch(origin+'/property/buy-home',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:JSON.stringify({home_key:'villa'})});
  assert.equal(r.status,500);assert.equal((await stats(user)).cash,before.cash);
  assert.equal(await query("SELECT * FROM owned_homes WHERE user_id=? AND home_key='villa'",[user.id]),undefined);
 }finally{await run('DROP TRIGGER fail_home');}
});

test('retired raids reject stale requests without changing players or furnishings', async () => {
  const actor=await account(), target=await account();
  const beforeActor=await stats(actor), beforeTarget=await stats(target);
  for(const [method,url] of [['GET','/raid/'+target.username],['POST','/raid/attempt'],['POST','/cell/change-combo'],['POST','/property/change-combo'],['GET','/cell-raids']]){
    const response=await fetch(origin+url,{method,headers:{Cookie:actor.cookie,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({target_id:target.id,combo:'1234',new_combo:'5678'})}:{})});
    assert.equal(response.status,410,url);
  }
  assert.deepEqual(await stats(actor),beforeActor);
  assert.deepEqual(await stats(target),beforeTarget);
  assert.equal((await query('SELECT COUNT(*) AS count FROM raid_attempts WHERE raider_id=?',[actor.id])).count,0);
});

test('Tokens preserve existing balances and concurrent daily claims award once', async () => {
  const user=await account();
  await run('UPDATE users SET favors=17 WHERE id=?',[user.id]);
  const results=await Promise.all([post(user,'/tokens/vote'),post(user,'/tokens/vote'),post(user,'/favors/vote')]);
  assert.equal(results.filter(r=>!r.error).length,1);
  assert.equal((await stats(user)).favors,18);
  assert.equal((await query("SELECT COUNT(*) AS count FROM events WHERE user_id=? AND type='vote'",[user.id])).count,1);
  const html=await (await fetch(origin+'/surgeon',{headers:{Cookie:user.cookie}})).text();
  assert.match(html,/Tokens:/);
  assert.doesNotMatch(html,/Favors:|Vote for Favor/);
});

test('imported nose layers save and render while thumbnails stay in the picker', async () => {
  const user=await account();
  const imported=require('../middleware/imported-avatar-parts.json').nose;
  const {readFileSync}=require('node:fs');
  assert.equal(new Set(imported.map(p=>p.key)).size,imported.length);
  for(const part of imported){
    const bytes=readFileSync(path.join(root,'public',part.img));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(bytes.readUInt32BE(16),242);
    assert.equal(bytes.readUInt32BE(20),298);
    if(part.thumb) assert.ok(readFileSync(path.join(root,'public',part.thumb)).length);
  }
  const part=imported.find(p=>p.thumb);
  const result=await post(user,'/surgeon/save',{layers:{nose:part.key}});
  assert.ok(!result.error);
  assert.equal(JSON.parse((await stats(user)).avatar).nose,part.key);
  const html=await (await fetch(origin+'/profile/'+user.username,{headers:{Cookie:user.cookie}})).text();
  assert.ok(html.includes('src="'+part.img+'"'));
  assert.ok(!html.includes('src="'+part.thumb+'"'));
});

test('all imported categories are free and ten preset slots retain new layers', async () => {
 const {AVATAR_PARTS}=require('../middleware/avatardata');
 const {existsSync}=require('node:fs');
 const user=await account(), layers={};
 for(const [cat,parts] of Object.entries(AVATAR_PARTS)){
  for(const p of parts){
   assert.equal(p.free,true);assert.equal(p.rep_cost,0);
   if(p.img)assert.ok(existsSync(path.join(root,'public',p.img)),p.img);
   if(p.thumb)assert.ok(existsSync(path.join(root,'public',p.thumb)),p.thumb);
  }
  layers[cat]=parts.find(p=>p.img)?.key||'none';
 }
 const before=await stats(user);
 assert.ok(!(await post(user,'/surgeon/save',{layers})).error);
 assert.ok(!(await post(user,'/surgeon/preset/save',{slot:10,layers})).error);
 assert.deepEqual(JSON.parse((await query('SELECT layers FROM avatar_presets WHERE user_id=? AND slot=10',[user.id])).layers),layers);
 assert.ok((await post(user,'/surgeon/preset/save',{slot:11,layers})).error);
 const after=await stats(user);assert.equal(after.rep,before.rep);assert.equal(after.cash,before.cash);assert.equal(after.favors,before.favors);
 const html=await (await fetch(origin+'/surgeon',{headers:{Cookie:user.cookie}})).text();
 assert.match(html,/All avatar parts are free/);assert.doesNotMatch(html,/shopOverlay|Rep to unlock/);
});

test('city daily rolls persist both outcomes and roll again only on a new UTC day',async()=>{
 const {dailyFind}=require('../middleware/city-map');
 const user=await account(), store={get:query,run};
 const midnight=Date.parse('2026-10-19T00:00:00Z');
 let calls=0;const noSpawn=n=>{calls++;return n-1;};
 const empty=await dailyFind(store,user.id,midnight,noSpawn);
 assert.equal(empty.item_key,null);const savedCalls=calls;
 assert.deepEqual(await dailyFind(store,user.id,midnight+86399999,()=>{throw Error('rerolled');}),empty);
 assert.equal(calls,savedCalls);
 const spawned=await dailyFind(store,user.id,midnight+86400000,()=>0);
 assert.ok(spawned.item_key);assert.notEqual(spawned.day,empty.day);
 assert.deepEqual(await dailyFind(store,user.id,midnight+86400001,()=>{throw Error('rerolled');}),spawned);
});

test('city finds collect exactly once under competing requests and ignore client item keys',async()=>{
 const user=await account();const day=new Date().toISOString().slice(0,10);
 await run("INSERT INTO city_daily_finds (user_id,day,item_type,item_key,x,y) VALUES (?,?,'weapon','torn_1',40,50)",[user.id,day]);
 const result=await Promise.all(Array.from({length:4},()=>post(user,'/city/collect',{item_key:'torn_337',quantity:999})));
 assert.equal(result.filter(r=>!r.error).length,1);
 assert.equal((await query("SELECT SUM(quantity) AS n FROM inventory WHERE user_id=? AND item_type='weapon' AND item_key='torn_1'",[user.id])).n,1);
 assert.equal((await query("SELECT COUNT(*) AS n FROM events WHERE user_id=? AND type='city_find'",[user.id])).n,1);
 const page=await(await fetch(origin+'/city',{headers:{Cookie:user.cookie}})).text();
 assert.match(page,/collected today/);assert.doesNotMatch(page,/id="city-find"/);
 const other=await account();await run('INSERT INTO city_daily_finds (user_id,day,x,y) VALUES (?,?,10,20)',[other.id,day]);
 assert.ok((await post(other,'/city/collect')).error);
});

test('city find delivery rolls back on inventory failure and cannot collect while away',async()=>{
 const user=await account(),day=new Date().toISOString().slice(0,10);
 await run("INSERT INTO city_daily_finds (user_id,day,item_type,item_key,x,y) VALUES (?,?,'item','torn_310',40,50)",[user.id,day]);
 await run("CREATE TRIGGER fail_city_find BEFORE INSERT ON inventory WHEN NEW.user_id="+user.id+" BEGIN SELECT RAISE(ABORT,'test delivery failure'); END");
 try{
  const response=await fetch(origin+'/city/collect',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,500);
  assert.equal((await query('SELECT claimed FROM city_daily_finds WHERE user_id=? AND day=?',[user.id,day])).claimed,0);
 }finally{await run('DROP TRIGGER fail_city_find');}
 await post(user,'/airport/depart',{destination_id:2});
 assert.ok((await post(user,'/city/collect')).error);
 assert.equal((await query('SELECT claimed FROM city_daily_finds WHERE user_id=? AND day=?',[user.id,day])).claimed,0);
});

// Casino integration requests use an idempotency ID, like the browser.
async function casinoPlay(user,body,expected=200){
 const {randomUUID}=require('node:crypto');
 const response=await fetch(origin+'/casino/action',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:JSON.stringify({request_id:randomUUID(),...body})});
 const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));return json;
}
async function casinoState(user){return (await fetch(origin+'/casino/state',{headers:{Cookie:user.cookie}})).json();}

test('casino daily allowance is separate, resets once, gates levels and rejects malformed bets',async()=>{
 const user=await account();await run('UPDATE users SET favors=9,cash=5000 WHERE id=?',[user.id]);
 const initial=await casinoState(user);assert.equal(initial.wallet.tokens,75);assert.equal((await stats(user)).favors,9);
 await casinoPlay(user,{game:'slots',bet:100},400);
 await run('UPDATE users SET level=8 WHERE id=?',[user.id]);
 for(const bet of [-1,0,1.5,'100',1000001,NaN])await casinoPlay(user,{game:'slots',bet},400);
 assert.equal((await casinoState(user)).wallet.tokens,75);assert.equal((await stats(user)).cash,5000);
 await run("UPDATE casino_wallets SET tokens=0,day='2000-01-01' WHERE user_id=?",[user.id]);
 assert.equal((await casinoState(user)).wallet.tokens,75);
 await run('UPDATE casino_wallets SET tokens=12 WHERE user_id=?',[user.id]);
 assert.equal((await casinoState(user)).wallet.tokens,12);
 await run('UPDATE users SET cash=0 WHERE id=?',[user.id]);await casinoPlay(user,{game:'slots',bet:100},400);
 assert.equal((await casinoState(user)).wallet.tokens,12);
});

test('casino requests are replay-safe, wheel once per day and failed wagers roll back',async()=>{
 const user=await account();await run('UPDATE users SET level=8,cash=10000 WHERE id=?',[user.id]);
 const body={game:'slots',bet:100,request_id:'replayed-slot-001'};
 const results=await Promise.all([casinoPlay(user,body),casinoPlay(user,body)]);assert.deepEqual(results[0],results[1]);
 assert.equal((await casinoState(user)).wallet.tokens,74);
 assert.equal((await query("SELECT COUNT(*) AS n FROM transaction_logs WHERE to_id=? AND note='slots wager'",[user.id])).n,1);
 await casinoPlay(user,{...body,bet:200},400);
 await casinoPlay(user,{game:'wheel'});const before=await stats(user);
 await casinoPlay(user,{game:'wheel'},400);assert.equal((await stats(user)).cash,before.cash);
 assert.equal((await casinoState(user)).wallet.tokens,73);
 await run("CREATE TRIGGER fail_casino_log BEFORE INSERT ON transaction_logs WHEN NEW.to_id="+user.id+" BEGIN SELECT RAISE(ABORT,'test wager rollback'); END");
 try{
  const response=await fetch(origin+'/casino/action',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:JSON.stringify({game:'slots',bet:100,request_id:'rollback-casino-001'})});assert.equal(response.status,500);
 }finally{await run('DROP TRIGGER fail_casino_log');}
 assert.equal((await stats(user)).cash,before.cash);assert.equal((await casinoState(user)).wallet.tokens,73);
});

test('casino refill spends points, passes and job special once without wasting a full balance',async()=>{
 const user=await account();await run('UPDATE users SET level=8,cash=2000000 WHERE id=?',[user.id]);await casinoState(user);
 await casinoPlay(user,{game:'points',quantity:30});
 assert.equal((await casinoState(user)).wallet.points,30);assert.equal((await stats(user)).cash,500000);
 await casinoPlay(user,{game:'refill',method:'points'},400);assert.equal((await casinoState(user)).wallet.points,30);
 await run('UPDATE casino_wallets SET tokens=0 WHERE user_id=?',[user.id]);
 await Promise.all([casinoPlay(user,{game:'refill',method:'points'}),casinoPlay(user,{game:'refill',method:'points'},400)]);
 assert.equal((await casinoState(user)).wallet.points,0);assert.equal((await casinoState(user)).wallet.tokens,75);
 await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'torn_428','item',1)",[user.id]);
 await casinoPlay(user,{game:'refill',method:'pass'},400);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_428'",[user.id])).quantity,1);
 await run('UPDATE casino_wallets SET tokens=0 WHERE user_id=?',[user.id]);await casinoPlay(user,{game:'refill',method:'pass'});
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_428'",[user.id])).quantity,0);
 await run('UPDATE casino_wallets SET tokens=0 WHERE user_id=?',[user.id]);await casinoPlay(user,{game:'refill',method:'job'},400);
 await run("UPDATE users SET job_key='gaming_consultant',job_prison_id=prison_id WHERE id=?",[user.id]);
 await casinoPlay(user,{game:'refill',method:'job'});await run('UPDATE casino_wallets SET tokens=0 WHERE user_id=?',[user.id]);
 await casinoPlay(user,{game:'refill',method:'job'},400);
});

test('blackjack hides dealer and deck, pays naturals, doubles, Charlie and insurance with awards',async()=>{
 const user=await account();await run('UPDATE users SET level=8,cash=10000 WHERE id=?',[user.id]);
 const c=rank=>({rank,suit:0});
 async function hand(player,dealer,deck,bet=100){
  await run("DELETE FROM casino_rounds WHERE user_id=? AND game='blackjack'",[user.id]);
  await run("INSERT INTO casino_rounds (user_id,game,state,created_at) VALUES (?,'blackjack',?,0)",[user.id,JSON.stringify({player:player.map(c),dealer:dealer.map(c),deck:deck.map(c),bet,insurance:0,acted:false})]);
 }
 await hand([14,10],[9,8],[]);
 let view=await casinoState(user);assert.equal(view.rounds[0].dealer.length,1);assert.equal(view.rounds[0].deck,undefined);
 const nat=await casinoPlay(user,{game:'blackjack',move:'stand'});assert.equal(nat.payout,250);
 await hand([5,6],[10,7],[10]);
 const doubled=await casinoPlay(user,{game:'blackjack',move:'double'});assert.equal(doubled.payout,400);assert.equal(doubled.round.bet,200);
 await hand([2,3,4,5],[10,9],[2]);const charlie=await casinoPlay(user,{game:'blackjack',move:'hit'});assert.equal(charlie.payout,200);
 await hand([10,9],[14,10],[]);await casinoPlay(user,{game:'blackjack',move:'insurance'});
 view=await casinoState(user);
 for(const key of ['blackjack_natural','blackjack_double','blackjack_charlie','blackjack_insurance'])assert.ok(view.awards.some(a=>a.award===key),key);
 assert.equal(view.rounds.length,0);
 await casinoPlay(user,{game:'blackjack',move:'stand'},400);
});

test('poker escrow protects hidden hands, draws once and pays a pot only once',async()=>{
 const host=await account(),guest=await account(),observer=await account();
 for(const u of [host,guest,observer])await run('UPDATE users SET level=8,cash=10000 WHERE id=?',[u.id]);
 await casinoPlay(host,{game:'poker',move:'create',bet:1000});
 let table=(await casinoState(host)).tables.find(t=>t.host_id===host.id);
 await casinoPlay(host,{game:'poker',move:'join',table_id:table.id},400);
 await casinoPlay(guest,{game:'poker',move:'join',table_id:table.id});
 assert.equal((await stats(host)).cash,9000);assert.equal((await stats(guest)).cash,9000);
 assert.equal((await casinoState(host)).wallet.tokens,75);assert.equal((await casinoState(guest)).wallet.tokens,75);
 table=(await casinoState(host)).tables.find(t=>t.id===table.id);
 assert.equal(table.hand.length,5);assert.equal(table.opponentHand,undefined);
 assert.equal((await casinoState(observer)).tables.some(t=>t.id===table.id),false);
 const c=(rank,suit)=>({rank,suit});
 await run('UPDATE casino_tables SET state=? WHERE id=?',[JSON.stringify({deck:[],host:[10,11,12,13,14].map(r=>c(r,0)),guest:[2,3,4,5,7].map((r,i)=>c(r,i%4)),hostDone:false,guestDone:false}),table.id]);
 await casinoPlay(observer,{game:'poker',move:'draw',table_id:table.id,hold:[]},400);
 await casinoPlay(host,{game:'poker',move:'draw',table_id:table.id,hold:[0,1,2,3,4]});
 await casinoPlay(host,{game:'poker',move:'draw',table_id:table.id,hold:[]},400);
 await casinoPlay(guest,{game:'poker',move:'draw',table_id:table.id,hold:[0,1,2,3,4]});
 table=(await casinoState(host)).tables.find(t=>t.id===table.id);
 assert.equal(table.status,'finished');assert.equal(table.winner,host.id);assert.equal(table.payout,1900);assert.equal(table.opponentHand.length,5);
 assert.equal((await stats(host)).cash,10900);assert.equal((await stats(guest)).cash,9000);
 assert.equal((await query("SELECT value FROM casino_stats WHERE user_id=? AND stat='poker_score'",[host.id])).value,900);
 await casinoPlay(guest,{game:'poker',move:'join',table_id:table.id},400);assert.equal((await stats(host)).cash,10900);
});

test('Russian Roulette competing joins cannot duplicate escrow or payout and table cancellation refunds cash',async()=>{
 const host=await account(),a=await account(),b=await account();
 for(const u of [host,a,b])await run('UPDATE users SET level=8,cash=10000 WHERE id=?',[u.id]);
 await casinoPlay(host,{game:'roulette',move:'create',bet:1000});
 const t=(await casinoState(host)).tables.find(t=>t.host_id===host.id);
 const join=async u=>{
  const response=await fetch(origin+'/casino/action',{method:'POST',headers:{Cookie:u.cookie,'Content-Type':'application/json'},body:JSON.stringify({game:'roulette',move:'join',table_id:t.id,request_id:require('node:crypto').randomUUID()})});
  return {u,status:response.status,result:await response.json()};
 };
 const results=await Promise.all([join(a),join(b)]);assert.equal(results.filter(r=>r.status===200).length,1);
 const guest=results.find(r=>r.status===200).u,loser=results.find(r=>r.status===400).u;
 assert.equal((await stats(loser)).cash,10000);
 assert.equal((await stats(host)).cash+(await stats(guest)).cash,19900);
 assert.equal((await casinoState(host)).wallet.tokens,74);assert.equal((await casinoState(guest)).wallet.tokens,74);
 await casinoPlay(host,{game:'poker',move:'create',bet:500});
 const waiting=(await casinoState(host)).tables.find(t=>t.status==='waiting'&&t.host_id===host.id);
 const before=(await stats(host)).cash;await casinoPlay(host,{game:'poker',move:'cancel',table_id:waiting.id});
 assert.equal((await stats(host)).cash,before+500);
});

test('expired poker resolves drawn player once, and lottery settlement persists once across visits',async()=>{
 const host=await account(),guest=await account();
 for(const u of [host,guest])await run('UPDATE users SET level=8,cash=10000 WHERE id=?',[u.id]);
 await casinoPlay(host,{game:'poker',move:'create',bet:1000});
 const t=(await casinoState(host)).tables.find(t=>t.host_id===host.id);
 await casinoPlay(guest,{game:'poker',move:'join',table_id:t.id});
 await casinoPlay(host,{game:'poker',move:'draw',table_id:t.id,hold:[0,1,2,3,4]});
 await run('UPDATE casino_tables SET expires_at=0 WHERE id=?',[t.id]);
 await casinoState(guest);assert.equal((await stats(host)).cash,10900);await casinoState(host);assert.equal((await stats(host)).cash,10900);
 await casinoPlay(host,{game:'lottery'});
 const day=new Date().toISOString().slice(0,10);
 await run("UPDATE casino_tickets SET day='2000-01-01' WHERE day=? AND user_id=?",[day,host.id]);
 await run("UPDATE casino_lotteries SET day='2000-01-01' WHERE day=?",[day]);
 const before=(await stats(host)).cash;await casinoState(guest);
 assert.equal((await stats(host)).cash,before+900);await casinoState(host);assert.equal((await stats(host)).cash,before+900);
 assert.equal((await query("SELECT winner_id FROM casino_lotteries WHERE day='2000-01-01'")).winner_id,host.id);
 assert.ok((await casinoState(host)).awards.some(a=>a.award==='lottery_win'));
});

test('High-Low cashout is paid once',async()=>{
 const user=await account();await run('UPDATE users SET level=8,cash=10000 WHERE id=?',[user.id]);
 await casinoPlay(user,{game:'highlow',move:'start',bet:100});
 let state=await casinoState(user);assert.ok(state.rounds.some(r=>r.game==='highlow'));
 await casinoPlay(user,{game:'highlow',move:'cashout'});assert.equal((await stats(user)).cash,10000);
 await casinoPlay(user,{game:'highlow',move:'cashout'},400);assert.equal((await stats(user)).cash,10000);
});

test('Bookie accepts only trusted open fixtures and settles verified results exactly once via operator import',async()=>{
 const user=await account();await run('UPDATE users SET level=8,cash=10000 WHERE id=?',[user.id]);await casinoState(user);
 await casinoPlay(user,{game:'bookie',event_id:'forged',selection:'a',bet:100},400);
 const event={id:'sports-test',title:'Synthetic fixture for integration test',starts_at:Math.floor(Date.now()/1000)+60,options:[{id:'a',label:'Home',odds:1800},{id:'b',label:'Away',odds:2200}]};
 await run('INSERT INTO casino_sports (id,title,starts_at,options) VALUES (?,?,?,?)',[event.id,event.title,event.starts_at,JSON.stringify(event.options)]);
 await casinoPlay(user,{game:'bookie',event_id:event.id,selection:'a',bet:1000});
 assert.equal((await stats(user)).cash,9000);assert.equal((await casinoState(user)).wallet.tokens,74);
 // Set kickoff in the past and run the operator command with synthetic verified data.
 event.starts_at=Math.floor(Date.now()/1000)-60;event.winner='a';
 await run('UPDATE casino_sports SET starts_at=? WHERE id=?',[event.starts_at,event.id]);
 const {writeFileSync}=require('node:fs');const file=path.join(temporary,'sports.json');writeFileSync(file,JSON.stringify([event]));
 async function importResult(){
  const p=spawn(process.execPath,['scripts/casino-sports.js',file],{cwd:root,env:{...process.env,DB_PATH:databasePath},stdio:['ignore','pipe','pipe']});
  let logs='';p.stderr.on('data',d=>logs+=d);const [code]=await once(p,'exit');assert.equal(code,0,logs);
 }
 await importResult();assert.equal((await stats(user)).cash,10800);await importResult();assert.equal((await stats(user)).cash,10800);
 await casinoPlay(user,{game:'bookie',event_id:event.id,selection:'a',bet:1000},400);
 assert.equal((await query('SELECT settled FROM casino_sports_bets WHERE user_id=?',[user.id])).settled,1);
});

test('medical healing stacks cooldown, removes hospital time and respects the threshold atomically',async()=>{
  const u=await account(), now=Math.floor(Date.now()/1000);
  await run('UPDATE users SET hp=10,max_hp=1000,in_hospital=1,hospital_until=? WHERE id=?',[now+18000,u.id]);
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'torn_68','item',5)",[u.id]);
  const first=await post(u,'/inventory/use',{item_key:'torn_68',item_type:'item'});
  assert.equal(first.user.hp,60);assert.ok(Math.abs(first.user.hospital_until-(now+16800))<=2);
  const second=await post(u,'/inventory/use',{item_key:'torn_68',item_type:'item'});
  assert.equal(second.user.hp,110);assert.equal(second.readyAt-first.readyAt,600);
  await run("UPDATE recovery_cooldowns SET ready_at=? WHERE user_id=? AND category='medical'",[Math.floor(Date.now()/1000)+21599,u.id]);
  const results=await Promise.all([post(u,'/inventory/use',{item_key:'torn_68'}),post(u,'/inventory/use',{item_key:'torn_68'})]);
  assert.equal(results.filter(r=>!r.error).length,1);assert.match(results.find(r=>r.error).error,/cooldown/);
  assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[u.id])).quantity,2);
  assert.equal((await fetch(origin+'/hospital',{headers:{Cookie:u.cookie}})).status,200);
  assert.equal((await fetch(origin+'/inventory',{headers:{Cookie:u.cookie}})).status,200);
});

test('trained blood withdrawal creates typed blood, requires enough life and rejects incompatible transfusion',async()=>{
  const u=await account();
  await fetch(origin+'/hospital',{headers:{Cookie:u.cookie}});
  await run("UPDATE medical_profiles SET blood_type='A+' WHERE user_id=?",[u.id]);
  await run('UPDATE users SET max_hp=1000,hp=1000 WHERE id=?',[u.id]);
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'torn_731','item',2)",[u.id]);
  assert.match((await post(u,'/inventory/use',{item_key:'torn_731'})).error,/Intravenous/);
  await run("INSERT INTO education VALUES (?,'intravenous',0,1,2)",[u.id]);
  const fill=await post(u,'/inventory/use',{item_key:'torn_731'});
  assert.equal(fill.user.hp,700);assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_732'",[u.id])).quantity,1);
  const heal=await post(u,'/inventory/use',{item_key:'torn_732'});
  assert.equal(heal.user.hp,1000);assert.equal(heal.readyAt-fill.readyAt,1800);
  await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,'torn_734','item')",[u.id]);
  assert.match((await post(u,'/inventory/use',{item_key:'torn_734'})).error,/incompatible/);
  await run('UPDATE users SET hp=300 WHERE id=?',[u.id]);
  assert.match((await post(u,'/inventory/use',{item_key:'torn_731'})).error,/more than 30%/);
});

test('Opium uses a separate drug timer, clears hospital and grants a temporary defense bonus without saving it',async()=>{
  const u=await account(), now=Math.floor(Date.now()/1000);
  await run('UPDATE users SET hp=10,in_hospital=1,hospital_until=?,defense=100 WHERE id=?',[now+10000,u.id]);
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'torn_200','drug',2)",[u.id]);
  const used=await post(u,'/inventory/use',{item_key:'torn_200',item_type:'drug'});
  assert.equal(used.user.hp,50);assert.equal(used.user.in_hospital,0);assert.equal(used.category,'drug');
  assert.ok(used.readyAt>=now+7200 && used.readyAt<=now+10803);
  assert.match((await post(u,'/inventory/use',{item_key:'torn_200'})).error,/cooldown/);
  const state=await (await fetch(origin+'/api/stats',{headers:{Cookie:u.cookie}})).json();
  assert.equal(state.defense,130);assert.equal((await stats(u)).defense,100);
  await run('UPDATE users SET hp=40 WHERE id=?',[u.id]);
  assert.ok(!(await post(u,'/infirmary/heal')).error);assert.equal((await stats(u)).defense,100);
  await run('UPDATE medical_profiles SET opium_until=0 WHERE user_id=?',[u.id]);
  assert.equal((await (await fetch(origin+'/api/stats',{headers:{Cookie:u.cookie}})).json()).defense,100);
});

test('radiation blocks ordinary hospital relief and drugs while Neumune reduces radiation and its hospital time',async()=>{
  const u=await account(), now=Math.floor(Date.now()/1000);
  await fetch(origin+'/hospital',{headers:{Cookie:u.cookie}});
  await run('UPDATE medical_profiles SET radiation_until=? WHERE user_id=?',[now+86400,u.id]);
  await run('UPDATE users SET hp=10,in_hospital=1,hospital_until=? WHERE id=?',[now+20000,u.id]);
  for(const [key,type] of [['torn_66','item'],['torn_200','drug'],['torn_361','item']])await run('INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,?,2)',[u.id,key,type]);
  const normal=await post(u,'/inventory/use',{item_key:'torn_66'});assert.equal(normal.user.hospital_until,now+20000);assert.equal(normal.user.hp,25);
  assert.match((await post(u,'/inventory/use',{item_key:'torn_200'})).error,/radiation/);
  assert.match((await post(u,'/infirmary/bribe')).error,/Radiation/);
  const treated=await post(u,'/inventory/use',{item_key:'torn_361'});
  assert.ok(Math.abs(treated.user.hospital_until-(now+9200))<=2);
  assert.equal((await query('SELECT radiation_until FROM medical_profiles WHERE user_id=?',[u.id])).radiation_until,now+43200);
});

test('revives enforce medical qualification, consent and energy then settle once for concurrent attempts',async()=>{
  const reviver=await account(), patient=await account(), now=Math.floor(Date.now()/1000);
  await run('UPDATE users SET in_hospital=1,hospital_until=?,hp=1 WHERE id=?',[now+9999,patient.id]);
  assert.match((await post(reviver,'/infirmary/revive',{target_id:patient.id})).error,/Brain Surgeon/);
  assert.match((await post(reviver,'/jobs/take',{job_key:'brain_surgeon'})).error,/DEF|Brain Surgery/);
  await run('UPDATE users SET defense=100,energy=100,max_energy=100 WHERE id=?',[reviver.id]);
  await run("INSERT INTO education VALUES (?,'brain_surgery',0,1,2)",[reviver.id]);
  assert.ok(!(await post(reviver,'/jobs/take',{job_key:'brain_surgeon'})).error);
  await post(patient,'/infirmary/preferences',{accepts_revives:false});
  assert.match((await post(reviver,'/infirmary/revive',{target_id:patient.id})).error,/not accepting/);
  assert.equal((await stats(reviver)).energy,100);
  await post(patient,'/infirmary/preferences',{accepts_revives:true});
  // Child server has Math.random=.99: a novice fails, skill 100 succeeds.
  const failed=await post(reviver,'/infirmary/revive',{target_id:patient.id});
  assert.equal(failed.success,false);assert.equal((await stats(reviver)).energy,25);assert.equal((await stats(patient)).in_hospital,1);
  await run('UPDATE users SET energy=100 WHERE id=?',[reviver.id]);
  await run('UPDATE medical_profiles SET revive_skill=100 WHERE user_id=?',[reviver.id]);
  const results=await Promise.all([post(reviver,'/infirmary/revive',{target_id:patient.id}),post(reviver,'/infirmary/revive',{target_id:patient.id})]);
  assert.equal(results.filter(r=>r.success).length,1);assert.equal((await stats(reviver)).energy,25);
  assert.equal((await stats(patient)).hp,100);assert.equal((await stats(patient)).in_hospital,0);
});

test('faction medical upgrades authorize leaders, debit the bank and extend effectiveness and cooldown limits',async()=>{
  const leader=await account(), member=await account();
  await run('INSERT INTO gangs (name,tag,leader_id,bank) VALUES (?,?,?,2000000)',['Medics'+leader.id,'M'+leader.id,leader.id]);
  const gang=await query('SELECT * FROM gangs WHERE leader_id=?',[leader.id]);
  for(const u of [leader,member])await run('UPDATE users SET gang_id=? WHERE id=?',[gang.id,u.id]);
  assert.match((await post(member,'/infirmary/faction-upgrade',{upgrade:'capacity'})).error,/leader/);
  for(const key of ['capacity','effectiveness','reviver'])assert.ok(!(await post(leader,'/infirmary/faction-upgrade',{upgrade:key})).error);
  assert.equal((await query('SELECT bank FROM gangs WHERE id=?',[gang.id])).bank,1250000);
  await run("INSERT INTO education VALUES (?,'medical_training',0,1,2)",[member.id]);
  await run('UPDATE users SET max_hp=1000,hp=10 WHERE id=?',[member.id]);
  await run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,'torn_68','item',2)",[member.id]);
  await run("INSERT INTO recovery_cooldowns VALUES (?,'medical',?)",[member.id,Math.floor(Date.now()/1000)+22000]);
  const heal=await post(member,'/inventory/use',{item_key:'torn_68'});
  assert.equal(heal.user.hp,75); // 5% of 1000, with 20% education +10% faction
  assert.match((await post(leader,'/infirmary/faction-upgrade',{upgrade:'__proto__'})).error,/Invalid/);
});

test('failed blood inventory writes roll back withdrawal and boosters are blocked in hospital',async()=>{
  const u=await account();
  await run("INSERT INTO education VALUES (?,'intravenous',0,1,2)",[u.id]);
  await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,'torn_731','item')",[u.id]);
  await run(`CREATE TRIGGER reject_blood BEFORE INSERT ON inventory WHEN NEW.user_id=${u.id} AND NEW.item_key BETWEEN 'torn_732' AND 'torn_739' BEGIN SELECT RAISE(ABORT,'test blood failure'); END`);
  const response=await fetch(origin+'/inventory/use',{method:'POST',headers:{Cookie:u.cookie,'Content-Type':'application/json'},body:JSON.stringify({item_key:'torn_731'})});
  assert.equal(response.status,500);
  assert.equal((await stats(u)).hp,100);assert.equal((await query('SELECT quantity FROM inventory WHERE user_id=?',[u.id])).quantity,1);
  assert.equal(await query('SELECT * FROM recovery_cooldowns WHERE user_id=?',[u.id]),undefined);
  await run('DROP TRIGGER reject_blood');
  await run('UPDATE users SET in_hospital=1,hospital_until=?,energy=0 WHERE id=?',[Math.floor(Date.now()/1000)+1000,u.id]);
  await run("INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,'torn_530','item')",[u.id]);
  assert.match((await post(u,'/inventory/use',{item_key:'torn_530'})).error,/Boosters/);
  assert.match((await post(u,'/gang/deposit',{amount:1})).error,/hospital/);
});

test('map signs render destination names and every destination resolves',async()=>{
 const user=await account();
 const {LOCATIONS}=require('../middleware/city-map');
 const html=await(await fetch(origin+'/city',{headers:{Cookie:user.cookie}})).text();
 for(const location of LOCATIONS){
  assert.ok(html.includes('href="'+location.href.replaceAll('&','&amp;')+'"'));
  assert.equal((await fetch(origin+location.href,{headers:{Cookie:user.cookie}})).status,200,location.name);
 }
 assert.equal((html.match(/class="city-map-label /g)||[]).length,13);
});

test('retired items stay hidden and stale use, equip and sale requests cannot revive them',async()=>{
 const user=await account();
 for(const [key,type] of [['energy_drink','item'],['blade','weapon']])
  await run('INSERT INTO inventory (user_id,item_key,item_type) VALUES (?,?,?)',[user.id,key,type]);
 await run("INSERT INTO equipment (user_id,weapon) VALUES (?,'blade')",[user.id]);
 const before=await stats(user);
 for(const [url,body] of [
  ['/inventory/use',{item_key:'energy_drink',item_type:'item'}],
  ['/equipment/equip',{action:'equip',slot:'weapon',key:'blade'}],
  ['/inventory/list',{item_key:'blade',item_type:'weapon',quantity:1,price:100}],
 ])assert.ok((await post(user,url,body)).error);
 const html=await(await fetch(origin+'/inventory',{headers:{Cookie:user.cookie}})).text();
 assert.doesNotMatch(html,/data-key="(?:energy_drink|blade)"/);
 const effective=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
 assert.equal(effective.strength,before.strength);
 assert.equal((await stats(user)).cash,before.cash);
 const {CATALOGS}=require('../middleware/item-catalog');
 for(const type of ['item','weapon','armor','gear','drug'])
  for(const item of Object.values(CATALOGS[type]))assert.ok(item.source_id>0);
});

test('retired travel cargo cannot trap a returning player or duplicate valid delivery',async()=>{
 const user=await account();
 await post(user,'/yard/depart',{destination_id:2});await arrive(user);
 const trip=(await travelState(user)).travel.trip;
 for(const key of ['item:energy_drink','item:torn_310'])
  await run('INSERT INTO travel_cargo (trip_id,item_key,quantity) VALUES (?,?,2)',[trip.id,key]);
 await post(user,'/yard/return');
 await run('UPDATE travel_trips SET return_arrives_at=0 WHERE user_id=?',[user.id]);
 assert.equal((await travelState(user)).travel.phase,'home');
 await travelState(user);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_310'",[user.id])).quantity,2);
 assert.equal(await query("SELECT id FROM inventory WHERE user_id=? AND item_key='energy_drink'",[user.id]),undefined);
});

test('armory rolls exact owned units once; unauthorized and unknown weapon equips are rejected',async()=>{
 const user=await account(),other=await account();
 await run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_108','weapon',2)",[user.id]);
 assert.equal((await fetch(origin+'/equipment',{headers:{Cookie:user.cookie}})).status,200);
 const a=await query('SELECT * FROM weapon_instances WHERE owner_id=? ORDER BY id LIMIT 1',[user.id]);
 const b=await query('SELECT * FROM weapon_instances WHERE owner_id=? ORDER BY id DESC LIMIT 1',[user.id]);
 assert.notEqual(a.id,b.id);assert.ok(a.damage>=65&&a.damage<=70);assert.ok(a.accuracy>=43&&a.accuracy<=48);
 await fetch(origin+'/equipment',{headers:{Cookie:user.cookie}});
 assert.deepEqual(await query('SELECT * FROM weapon_instances WHERE id=?',[a.id]),a);
 assert.ok((await post(other,'/equipment/weapon',{instance_id:a.id})).error);
 assert.ok(!(await post(user,'/equipment/weapon',{instance_id:b.id})).error);
 assert.equal((await query('SELECT instance_id FROM combat_loadouts WHERE user_id=?',[user.id])).instance_id,b.id);
 await run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_1153','weapon',1)",[user.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:user.cookie}});
 const unknown=await query("SELECT * FROM weapon_instances WHERE owner_id=? AND item_key='torn_1153'",[user.id]);
 assert.equal(unknown.damage,null);assert.match((await post(user,'/equipment/weapon',{instance_id:unknown.id})).error,/unknown stats/);
 assert.equal((await query('SELECT instance_id FROM combat_loadouts WHERE user_id=?',[user.id])).instance_id,b.id);
});

test('ammo and attachments validate ownership, serialize funds and conserve switched magazines',async()=>{
 const user=await account(),other=await account();
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES (?,'torn_14','weapon')",[user.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:user.cookie}});
 const unit=await query('SELECT * FROM weapon_instances WHERE owner_id=?',[user.id]);
 await run('UPDATE users SET cash=10 WHERE id=?',[user.id]);
 const buys=await Promise.all(Array.from({length:2},()=>post(user,'/equipment/ammo',{instance_id:unit.id,kind:'standard',quantity:1})));
 assert.equal(buys.filter(r=>!r.error).length,1);assert.equal((await stats(user)).cash,0);
 assert.ok((await post(other,'/equipment/reload',{instance_id:unit.id,kind:'standard'})).error);
 assert.ok((await post(user,'/equipment/ammo',{instance_id:unit.id,kind:'__proto__',quantity:1})).error);
 for(const quantity of [true,'',0,-1,1.5,100001])assert.ok((await post(user,'/equipment/ammo',{instance_id:unit.id,kind:'standard',quantity})).error);
 assert.ok(!(await post(user,'/equipment/reload',{instance_id:unit.id,kind:'standard'})).error);
 assert.equal((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded,1);
 await run('UPDATE users SET cash=10000 WHERE id=?',[user.id]);
 await post(user,'/equipment/ammo',{instance_id:unit.id,kind:'HP',quantity:25});
 await post(user,'/equipment/reload',{instance_id:unit.id,kind:'HP'});
 assert.equal((await query('SELECT quantity FROM weapon_ammo WHERE user_id=? AND kind=?',[user.id,'standard'])).quantity,1);
 assert.equal((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded,20);
 assert.equal((await query('SELECT quantity FROM weapon_ammo WHERE user_id=? AND kind=?',[user.id,'HP'])).quantity,5);
 const before=await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id]);
 assert.ok((await post(user,'/equipment/reload',{instance_id:unit.id,kind:'HP'})).error);
 assert.deepEqual(await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id]),before);
 await run('UPDATE users SET cash=25000 WHERE id=?',[user.id]);
 const mods=await Promise.all(Array.from({length:2},()=>post(user,'/equipment/attachment',{instance_id:unit.id,attachment:'sight'})));
 assert.equal(mods.filter(r=>!r.error).length,1);assert.equal((await stats(user)).cash,0);
 assert.equal((await query('SELECT attachment FROM weapon_instances WHERE id=?',[unit.id])).attachment,'sight');
});

test('exact weapon listings preserve stats, ammo and attachments through buy and cancel',async()=>{
 const seller=await account(),buyer=await account();
 await run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_14','weapon',2)",[seller.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:seller.cookie}});
 const unit=await query('SELECT * FROM weapon_instances WHERE owner_id=? ORDER BY id DESC LIMIT 1',[seller.id]);
 await run("UPDATE weapon_instances SET loaded=8,attachment='sight' WHERE id=?",[unit.id]);
 const initial=await query('SELECT * FROM weapon_instances WHERE id=?',[unit.id]);
 const list=async()=>post(seller,'/inventory/list',{item_key:'torn_14',item_type:'weapon',instance_id:unit.id,quantity:1,price:100});
 assert.ok(!(await list()).error);
 let listing=await query('SELECT * FROM open_market WHERE seller_id=? AND active=1',[seller.id]);
 assert.equal((await query('SELECT listing_id FROM weapon_instances WHERE id=?',[unit.id])).listing_id,listing.id);
 assert.ok(!(await post(seller,'/openmarket/cancel',{listing_id:listing.id})).error);
 assert.deepEqual(await query('SELECT * FROM weapon_instances WHERE id=?',[unit.id]),initial);
 assert.ok(!(await list()).error);listing=await query('SELECT * FROM open_market WHERE seller_id=? AND active=1',[seller.id]);
 const results=await Promise.all(Array.from({length:2},()=>post(buyer,'/openmarket/buy',{listing_id:listing.id})));
 assert.equal(results.filter(r=>!r.error).length,1);
 assert.deepEqual(await query('SELECT * FROM weapon_instances WHERE id=?',[unit.id]),{...initial,owner_id:buyer.id});
 assert.equal((await stats(buyer)).cash,400);assert.equal((await stats(seller)).cash,590);
});

test('legacy item-storage weapons work in the armory and temporaries cannot become permanent weapons',async()=>{
 const user=await account();
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES (?,'torn_387','item')",[user.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES (?,'torn_616','weapon')",[user.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:user.cookie}});
 const unit=await query('SELECT * FROM weapon_instances WHERE owner_id=?',[user.id]);
 assert.equal(unit.item_key,'torn_387');
 assert.ok(!(await post(user,'/equipment/weapon',{instance_id:unit.id})).error);
 assert.match((await post(user,'/equipment/equip',{slot:'weapon',key:'torn_616',action:'equip'})).error,/temporary/);
 assert.ok(!(await post(user,'/equipment/loadout',{unarmed:'fists',temporary_key:'torn_616'})).error);
 assert.equal((await query("SELECT COUNT(*) n FROM weapon_instances WHERE owner_id=? AND item_key='torn_616'",[user.id])).n,0);
});

test('needles require education, add temporary stats, expire and clear on hospitalization without base inflation',async()=>{
 const user=await account();
 await run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_463','item',3)",[user.id]);
 assert.match((await post(user,'/inventory/use',{item_key:'torn_463',item_type:'item'})).error,/BIO3420/);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=?",[user.id])).quantity,3);
 await run("INSERT INTO education(user_id,course_key,started_at,finishes_at,completed_at) VALUES (?,'BIO3420',0,0,1)",[user.id]);
 const used=await post(user,'/inventory/use',{item_key:'torn_463',item_type:'item'});
 assert.ok(!used.error);assert.equal(used.user.strength,60);
 assert.equal((await stats(user)).strength,10);
 await post(user,'/bank/deposit',{amount:1});assert.equal((await stats(user)).strength,10);
 await run("INSERT INTO education(user_id,course_key,started_at,finishes_at,completed_at) VALUES (?,'SPT2480',0,0,1)",[user.id]);
 const again=await post(user,'/inventory/use',{item_key:'torn_463',item_type:'item'});
 assert.equal(again.user.strength,115);
 await run('UPDATE combat_buffs SET expires_at=0 WHERE user_id=?',[user.id]);
 assert.equal((await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json()).strength,10);
 await post(user,'/inventory/use',{item_key:'torn_463',item_type:'item'});
 await run('UPDATE users SET in_hospital=1,hospital_until=? WHERE id=?',[Math.floor(Date.now()/1000)+600,user.id]);
 assert.equal((await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json()).strength,10);
 assert.equal((await query('SELECT COUNT(*) n FROM combat_buffs WHERE user_id=?',[user.id])).n,0);
});

test('weapon attacks persist spent ammunition and exactly one opening item with battle rewards',async()=>{
 const {attacker,defender}=await combatPair('strength=100,defense=100,speed=1000,dexterity=1000');
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES (?,'torn_108','weapon')",[attacker.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_1178','item',2)",[attacker.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:attacker.cookie}});
 const unit=await query('SELECT * FROM weapon_instances WHERE owner_id=?',[attacker.id]);
 await post(attacker,'/equipment/weapon',{instance_id:unit.id});
 await run('UPDATE users SET cash=10000 WHERE id=?',[attacker.id]);
 await post(attacker,'/equipment/ammo',{instance_id:unit.id,kind:'standard',quantity:100});
 await post(attacker,'/equipment/reload',{instance_id:unit.id,kind:'standard'});
 await post(attacker,'/equipment/loadout',{unarmed:'fists',temporary_key:'torn_1178'});
 const attack=await playFight(attacker,{target_id:defender.id,ending:'leave'});
 assert.ok(!attack.error);assert.equal(attack.result,'win');
 assert.ok(attack.log.some(l=>l.includes('[festive]')));
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1178'",[attacker.id])).quantity,1);
 assert.ok((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded<30);
 assert.equal((await query('SELECT quantity FROM weapon_ammo WHERE user_id=?',[attacker.id])).quantity,70);
 await playFight(attacker,{target_id:defender.id,ending:'leave'});
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1178'",[attacker.id])).quantity,1);
});

test('battle storage failure rolls back ammo, temporary item, cooldown and player changes together',async()=>{
 const {attacker,defender}=await combatPair('strength=100,defense=100,speed=1000,dexterity=1000');
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES (?,'torn_14','weapon')",[attacker.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_1178','item',2)",[attacker.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:attacker.cookie}});
 const unit=await query('SELECT * FROM weapon_instances WHERE owner_id=?',[attacker.id]);
 await post(attacker,'/equipment/weapon',{instance_id:unit.id});
 await run("UPDATE weapon_instances SET loaded=20 WHERE id=?",[unit.id]);
 await post(attacker,'/equipment/loadout',{unarmed:'fists',temporary_key:'torn_1178'});
 const before=await stats(attacker);
 await run("CREATE TRIGGER reject_weapon_battle BEFORE INSERT ON attacks BEGIN SELECT RAISE(ABORT,'test battle failure'); END");
 try {
  const response=await fetch(origin+'/battles/attack',{method:'POST',headers:{Cookie:attacker.cookie,'Content-Type':'application/json'},body:JSON.stringify({target_id:defender.id,ending:'leave'})});
  assert.equal(response.status,500);
 }finally{await run('DROP TRIGGER reject_weapon_battle');}
 const after=await stats(attacker);
 for(const key of ['cash','energy','stamina','hp','wins','xp'])assert.equal(after[key],before[key],key);
 assert.equal((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded,20);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1178'",[attacker.id])).quantity,2);
 assert.equal(await query('SELECT * FROM attack_cooldowns WHERE attacker_id=?',[attacker.id]),undefined);
});

test('kick and opening needles require education and cannot consume unowned or boss items',async()=>{
 const user=await account();
 assert.match((await post(user,'/equipment/loadout',{unarmed:'kick',temporary_key:''})).error,/Kick Training/);
 assert.ok((await post(user,'/equipment/loadout',{unarmed:'fists',temporary_key:'torn_463'})).error);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES (?,'torn_463','item')",[user.id]);
 assert.match((await post(user,'/equipment/loadout',{unarmed:'fists',temporary_key:'torn_463'})).error,/BIO3420/);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES (?,'torn_1175','item')",[user.id]);
 assert.match((await post(user,'/equipment/loadout',{unarmed:'fists',temporary_key:'torn_1175'})).error,/no interdimensional/);
 for(const key of ['martial_kick','BIO3420'])await run("INSERT INTO education(user_id,course_key,started_at,finishes_at,completed_at) VALUES (?,?,0,0,1)",[user.id,key]);
 assert.ok(!(await post(user,'/equipment/loadout',{unarmed:'kick',temporary_key:'torn_463'})).error);
 const loadout=await query('SELECT * FROM combat_loadouts WHERE user_id=?',[user.id]);
 assert.equal(loadout.unarmed,'kick');assert.equal(loadout.temporary_key,'torn_463');
});

test('item purposes distinguish forgery ingredients, genuine collectibles and supported activation',async()=>{
 const {CATALOGS}=require('../middleware/item-catalog');
 assert.match(CATALOGS.item.torn_1321.desc,/forgery/i);
 assert.equal(CATALOGS.item.torn_1321.usage.mode,'context');
 assert.match(CATALOGS.item.torn_471.desc,/collectible/i);
 assert.equal(CATALOGS.item.torn_471.usage.mode,'collection');
 for(const catalog of Object.values(CATALOGS))for(const item of Object.values(catalog))assert.doesNotMatch(item.desc||'',/no direct use effect/);
 const user=await account();
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_1321','item')",[user.id]);
 assert.match((await post(user,'/inventory/use',{item_key:'torn_1321'})).error,/cannot be used/);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1321'",[user.id])).quantity,1);
 const html=await(await fetch(origin+'/market',{headers:{Cookie:user.cookie}})).text();
 assert.match(html,/Used during the production of forgery projects/);assert.doesNotMatch(html,/no direct use effect/);
});

test('source candy, drinks, alcohol and drugs change the stated resources, including overflow',async()=>{
 const user=await account();const now=Math.floor(Date.now()/1000);
 await run('UPDATE users SET happiness=50,happiness_last_regen=?,energy=0,nerve=0 WHERE id=?',[now,user.id]);
 for(const [key,type] of [['torn_35','item'],['torn_530','item'],['torn_180','item'],['torn_206','drug']])await run('INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,?,?)',[user.id,key,type]);
 let r=await post(user,'/inventory/use',{item_key:'torn_35'});assert.equal(r.user.happiness,75);assert.equal(r.user.energy,0);
 r=await post(user,'/inventory/use',{item_key:'torn_530'});assert.equal(r.user.energy,20);
 r=await post(user,'/inventory/use',{item_key:'torn_180'});assert.equal(r.user.nerve,1);
 assert.ok((await query("SELECT ready_at FROM recovery_cooldowns WHERE user_id=? AND category='booster'",[user.id])).ready_at>=now+3.5*3600);
 r=await post(user,'/inventory/use',{item_key:'torn_206',item_type:'drug'});assert.equal(r.user.energy,270);assert.equal(r.user.happiness,150);
 const again=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(again.happiness,150);assert.equal(again.energy,270);
});

test('stat boosters operate on saved base stats, not temporary multipliers, and stay stable across reads',async()=>{
 const user=await account();await run('UPDATE users SET strength=100000,xp_needed=1000000 WHERE id=?',[user.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_331','item')",[user.id]);
 await run("INSERT INTO combat_buffs(user_id,stat,bonus,expires_at) VALUES(?,'strength',5,?)",[user.id,Math.floor(Date.now()/1000)+120]);
 const used=await post(user,'/inventory/use',{item_key:'torn_331'});assert.ok(!used.error);assert.equal((await stats(user)).strength,101000);
 await post(user,'/bank/deposit',{amount:1});assert.equal((await stats(user)).strength,101000);
 assert.equal((await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json()).strength,606000);
});

test('pack openings grant exact quantities once, roll back failed writes and reject stale reuse',async()=>{
 const user=await account();await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_370','item')",[user.id]);
 const results=await Promise.all([post(user,'/inventory/use',{item_key:'torn_370'}),post(user,'/inventory/use',{item_key:'torn_370'})]);
 assert.equal(results.filter(r=>!r.error).length,1);
 assert.equal((await query('SELECT SUM(quantity) n FROM inventory WHERE user_id=?',[user.id])).n,10);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_365','item')",[user.id]);
 await run(`CREATE TRIGGER reject_pack BEFORE INSERT ON inventory WHEN NEW.user_id=${user.id} AND NEW.item_key<>'torn_365' BEGIN SELECT RAISE(ABORT,'pack write rejected'); END`);
 const failed=await fetch(origin+'/inventory/use',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json'},body:JSON.stringify({item_key:'torn_365'})});
 assert.equal(failed.status,500);await run('DROP TRIGGER reject_pack');
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_365'",[user.id])).quantity,1);
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_365'})).error);
 assert.equal((await query("SELECT SUM(quantity) n FROM inventory WHERE user_id=? AND item_key IN ('torn_66','torn_731','torn_67','torn_68')",[user.id])).n>0,true);
});

test('books limit concurrent reading, apply temporary stats and award capped permanent gains exactly once',async()=>{
 const user=await account();await run('UPDATE users SET strength=300000000 WHERE id=?',[user.id]);
 for(const key of ['torn_744','torn_752'])await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,?,'item')",[user.id,key]);
 const started=await post(user,'/inventory/use',{item_key:'torn_744'});assert.ok(!started.error);
 assert.match((await post(user,'/inventory/use',{item_key:'torn_752'})).error,/current book/);
 assert.equal((await stats(user)).strength,300000000);
 await run('UPDATE item_books SET ends_at=? WHERE user_id=?',[Math.floor(Date.now()/1000)-1,user.id]);
 await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}});assert.equal((await stats(user)).strength,310000000);
 await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}});assert.equal((await stats(user)).strength,310000000);
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_752'})).error);
 let current=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(current.strength,387500000);
 await post(user,'/bank/deposit',{amount:1});assert.equal((await stats(user)).strength,310000000);
 await run('UPDATE item_books SET ends_at=? WHERE user_id=?',[Math.floor(Date.now()/1000)-1,user.id]);
 current=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(current.strength,310000000);
});

test('owned passive enhancers and activated business tickets change only the applicable gym or trip',async()=>{
 const user=await account();await run('UPDATE users SET speed=1000,cash=100000,xp_needed=1000000,energy=100 WHERE id=?',[user.id]);
 for(const key of ['torn_386','torn_419','torn_420','torn_421','torn_396'])await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,?,'item')",[user.id,key]);
 const trained=await post(user,'/gym/train',{stat:'speed',energy_amount:20});assert.equal(trained.gain,42);
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_396'})).error);
 const departed=await post(user,'/airport/depart',{destination_id:2});assert.ok(!departed.error);assert.equal(departed.travel.trip.capacity,18);
 assert.equal(departed.travel.trip.arrives_at-departed.travel.trip.departed_at,54);
 assert.equal(await query('SELECT * FROM item_travel_tickets WHERE user_id=?',[user.id]),undefined);
});

test('piggy deposits conserve cash and funded banks cannot be sold or dropped; breaking returns savings once',async()=>{
 const user=await account();await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_820','item')",[user.id]);
 const deposited=await post(user,'/inventory/use',{item_key:'torn_820',action:'deposit',amount:200});assert.equal(deposited.user.cash,300);
 assert.match((await post(user,'/inventory/list',{item_key:'torn_820',item_type:'item',price:1})).error,/funded/);
 assert.match((await post(user,'/inventory/drop',{item_key:'torn_820',item_type:'item'})).error,/funded/);
 assert.ok((await post(user,'/inventory/use',{item_key:'torn_820',action:'deposit',amount:999})).error);
 const broken=await post(user,'/inventory/use',{item_key:'torn_820',action:'break'});assert.equal(broken.user.cash,500);
 assert.ok((await post(user,'/inventory/use',{item_key:'torn_820',action:'break'})).error);
 assert.equal((await stats(user)).cash,500);
});

test('donator packs, casino passes and lottery vouchers credit their separate wallets once',async()=>{
 const user=await account();
 for(const key of ['torn_283','torn_428','torn_369'])await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,?,'item')",[user.id,key]);
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_283'})).error);
 assert.equal((await query('SELECT points FROM casino_wallets WHERE user_id=?',[user.id])).points,60);
 assert.ok((await query('SELECT until_at FROM item_donator WHERE user_id=?',[user.id])).until_at>Math.floor(Date.now()/1000)+30*86400);
 assert.match((await post(user,'/inventory/use',{item_key:'torn_428'})).error,/wallet holds 75/);
 await run('UPDATE casino_wallets SET tokens=25 WHERE user_id=?',[user.id]);
 const before=25;
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_428'})).error);
 assert.equal((await query('SELECT tokens FROM casino_wallets WHERE user_id=?',[user.id])).tokens,before+50);
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_369'})).error);
 assert.equal((await query('SELECT COUNT(*) n FROM casino_tickets WHERE user_id=?',[user.id])).n,100);
});

test('targeted items validate player IDs and cosmetics never grant or consume stats',async()=>{
 const user=await account(),target=await account();
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_865','item')",[user.id]);
 const invalid=await post(user,'/inventory/use',{item_key:'torn_865',target_id:user.id});assert.ok(invalid.error);
 const result=await post(user,'/inventory/use',{item_key:'torn_865',target_id:target.id});assert.equal(result.user.happiness,125);assert.equal((await stats(target)).happiness,75);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_46','item')",[user.id]);
 const before=await stats(user);assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_46'})).error);
 assert.equal((await stats(user)).strength,before.strength);assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_46'",[user.id])).quantity,1);
 assert.ok(await query('SELECT * FROM item_outfits WHERE user_id=?',[user.id]));
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_46'})).error);assert.equal(await query('SELECT * FROM item_outfits WHERE user_id=?',[user.id]),undefined);
});

test('book cooldown and consumable modifiers affect actual payouts and timers without rewriting base limits',async()=>{
 const user=await account(),now=Math.floor(Date.now()/1000);
 await run('INSERT INTO item_books(user_id,source_id,effect_id,started_at,ends_at) VALUES(?,779,779,?,?)',[user.id,now-10,now+1000]);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_530','item')",[user.id]);
 const drink=await post(user,'/inventory/use',{item_key:'torn_530'});assert.equal(drink.user.energy,30);
 assert.ok(drink.readyAt>=now+3600&&drink.readyAt<=now+3605);
 await run('UPDATE item_books SET source_id=783,effect_id=783 WHERE user_id=?',[user.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_35','item')",[user.id]);
 const candy=await post(user,'/inventory/use',{item_key:'torn_35'});assert.equal(candy.user.happiness,150);
 await run('UPDATE item_books SET source_id=784,effect_id=784 WHERE user_id=?',[user.id]);
 let state=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(state.max_energy,250);
 await post(user,'/bank/deposit',{amount:1});assert.equal((await stats(user)).max_energy,10);
 await run('UPDATE item_books SET ends_at=? WHERE user_id=?',[now-1,user.id]);
 state=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(state.max_energy,10);
});

test('regeneration books retain fractional energy gains and stop boosting ticks after their expiry',async()=>{
 const user=await account(),now=Math.floor(Date.now()/1000);
 await run('INSERT INTO item_books(user_id,source_id,effect_id,started_at,ends_at) VALUES(?,774,774,?,?)',[user.id,now-3600,now+3600]);
 await run('UPDATE users SET energy=0,energy_last_regen=? WHERE id=?',[now-300,user.id]);
 let state=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(state.energy,1);
 for(let i=0;i<4;i++){
  await run('UPDATE users SET energy_last_regen=energy_last_regen-300 WHERE id=?',[user.id]);
  state=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();
 }
 assert.equal(state.energy,6);
 await run('UPDATE item_books SET ends_at=? WHERE user_id=?',[now-301,user.id]);
 await run('UPDATE users SET energy_last_regen=? WHERE id=?',[now-300,user.id]);
 state=await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json();assert.equal(state.energy,7);
});

test('blue eggs, education reducers and fruitcake combinations enforce preconditions without losing materials',async()=>{
 const user=await account(),now=Math.floor(Date.now()/1000);
 for(const key of ['torn_472','torn_561','torn_560','torn_793'])await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,?,'item')",[user.id,key]);
 const blue=await post(user,'/inventory/use',{item_key:'torn_472'});assert.equal(blue.user.hp,300);
 assert.equal((await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json()).hp,300);
 await run('UPDATE item_overlife SET until_at=? WHERE user_id=?',[now-1,user.id]);
 assert.equal((await(await fetch(origin+'/api/stats',{headers:{Cookie:user.cookie}})).json()).hp,100);
 assert.ok((await post(user,'/inventory/use',{item_key:'torn_561'})).error);
 await run("INSERT INTO education(user_id,course_key,started_at,finishes_at) VALUES(?,'BIO3420',?,?)",[user.id,now,now+86400]);
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_561'})).error);
 assert.equal((await query('SELECT finishes_at FROM education WHERE user_id=?',[user.id])).finishes_at,now+64800);
 assert.ok((await post(user,'/inventory/use',{item_key:'torn_560'})).error);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_560'",[user.id])).quantity,1);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_794','item')",[user.id]);
 assert.ok(!(await post(user,'/inventory/use',{item_key:'torn_793'})).error);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_795'",[user.id])).quantity,1);
 assert.equal((await query("SELECT COUNT(*) n FROM inventory WHERE user_id=? AND item_key IN ('torn_560','torn_793','torn_794')",[user.id])).n,0);
});

test('interactive fights charge on start, wait for clicks and reject unauthorized, invalid and duplicate turns',async()=>{
 const {attacker,defender}=await combatPair('strength=1,defense=10000,speed=1000,dexterity=1000,hp=10000,max_hp=10000');
 await run('UPDATE users SET strength=1,defense=10000,hp=10000,max_hp=10000 WHERE id=?',[defender.id]);
 const start=await post(attacker,'/battles/attack',{target_id:defender.id});
 assert.equal(start.result,'ongoing');assert.equal(start.user.energy,5);assert.equal(start.battle.round,0);assert.equal(start.battle.hp,10000);assert.equal(start.battle.target.hp,10000);
 assert.ok((await post(attacker,'/battles/finish',{ending:'mug'})).error);
 assert.ok((await post(attacker,'/battles/attack',{target_id:defender.id})).error);assert.equal((await stats(attacker)).energy,5);
 const b=start.battle,turn={attack_id:b.attackId,version:b.version,action:'fists'};
 assert.ok((await post(defender,'/battles/turn',turn)).error);
 assert.ok((await post(attacker,'/battles/turn',{...turn,action:'weapon',weapon_id:99999999})).error);
 assert.ok((await post(attacker,'/battles/turn',{...turn,version:42})).error);
 assert.match((await post(attacker,'/bank/deposit',{amount:10})).error,/fight/);
 assert.match((await post(defender,'/equipment/loadout',{unarmed:'fists',temporary_key:''})).error,/fight/);
 const results=await Promise.all([post(attacker,'/battles/turn',turn),post(attacker,'/battles/turn',turn)]);
 assert.equal(results.filter(r=>!r.error).length,1);const next=results.find(r=>!r.error);assert.equal(next.battle.round,1);assert.equal(next.battle.version,1);assert.ok(next.battle.hp<=10000);assert.equal(next.battle.target.hp,9999);
 assert.equal((await stats(attacker)).energy,5);assert.equal((await stats(defender)).cash,1000);
 await run('UPDATE battle_sessions SET expires_at=0 WHERE attacker_id=?',[attacker.id]);
 const expired=await post(attacker,'/battles/turn',{...turn,version:1});assert.equal(expired.result,'draw');assert.equal(expired.user.hp,next.battle.hp);assert.equal(expired.xpGain,0);
 assert.equal(await query('SELECT * FROM battle_sessions WHERE attacker_id=?',[attacker.id]),undefined);
});

test('manual weapon selection, empty magazines, reload turns and temporary use persist independently',async()=>{
 const {attacker,defender}=await combatPair('strength=1,defense=10000,speed=1000,dexterity=1000,hp=10000,max_hp=10000');
 await run('UPDATE users SET strength=1,defense=10000,hp=10000,max_hp=10000 WHERE id=?',[defender.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_14','weapon')",[attacker.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES(?,'torn_1178','item',2)",[attacker.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:attacker.cookie}});
 const unit=await query('SELECT * FROM weapon_instances WHERE owner_id=?',[attacker.id]);
 await run("INSERT INTO weapon_ammo(user_id,caliber,kind,quantity) VALUES(?,'5.7mm','standard',25)",[attacker.id]);
 await post(attacker,'/equipment/loadout',{unarmed:'fists',temporary_key:'torn_1178'});
 let response=await post(attacker,'/battles/attack',{target_id:defender.id});
 const click=async(action,extra={})=>{const b=response.battle;return post(attacker,'/battles/turn',{attack_id:b.attackId,version:b.version,action,...extra});};
 assert.equal((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded,0);
 assert.ok((await click('weapon',{weapon_id:unit.id})).error);
 response=await click('fists');assert.equal(response.battle.round,1);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1178'",[attacker.id])).quantity,2);
 response=await click('reload',{weapon_id:unit.id});assert.equal(response.battle.round,2);assert.equal(response.battle.target.hp,9999);
 assert.equal((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded,20);assert.equal((await query('SELECT quantity FROM weapon_ammo WHERE user_id=?',[attacker.id])).quantity,5);
 assert.ok((await click('reload',{weapon_id:unit.id})).error);
 response=await click('weapon',{weapon_id:unit.id});assert.equal(response.battle.round,3);assert.ok((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded<20);
 response=await click('temporary',{item_key:'torn_1178'});assert.equal(response.battle.round,4);assert.ok(response.battle.log.some(l=>l.includes('[festive]')));assert.equal(response.battle.temporary.length,0);
 assert.equal((await query("SELECT quantity FROM inventory WHERE user_id=? AND item_key='torn_1178'",[attacker.id])).quantity,1);
 assert.ok((await click('temporary',{item_key:'torn_1178'})).error);
 const before=response.battle;await stop();await start();await relogin(attacker);
 const resumed=await (await fetch(origin+'/battles/state',{headers:{Cookie:attacker.cookie}})).json();assert.equal(resumed.battle.version,before.version);assert.equal(resumed.battle.round,4);
 assert.ok((await post(attacker,'/battles/turn',{attack_id:before.attackId,version:0,action:'fists'})).error);
 await run('UPDATE battle_sessions SET expires_at=0 WHERE attacker_id=?',[attacker.id]);await fetch(origin+'/battles',{headers:{Cookie:attacker.cookie}});
});

test('profile Attack starts immediately and turn storage failure rolls back ammunition and HP',async()=>{
 const {attacker,defender}=await combatPair('strength=1,defense=10000,speed=1000,dexterity=1000,hp=10000,max_hp=10000');
 await run('UPDATE users SET strength=1,defense=10000,hp=10000,max_hp=10000 WHERE id=?',[defender.id]);
 await run("INSERT INTO inventory(user_id,item_key,item_type) VALUES(?,'torn_14','weapon')",[attacker.id]);
 await fetch(origin+'/equipment',{headers:{Cookie:attacker.cookie}});const unit=await query('SELECT * FROM weapon_instances WHERE owner_id=?',[attacker.id]);await run('UPDATE weapon_instances SET loaded=20 WHERE id=?',[unit.id]);
 const start=await fetch(origin+'/battles/start',{method:'POST',headers:{Cookie:attacker.cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({target_id:String(defender.id)}),redirect:'manual'});
 assert.equal(start.status,302);assert.equal(start.headers.get('location'),'/battles');assert.equal((await stats(attacker)).energy,5);
 const current=await (await fetch(origin+'/battles/state',{headers:{Cookie:attacker.cookie}})).json();const b=current.battle;
 await run("CREATE TRIGGER reject_turn BEFORE UPDATE ON battle_sessions BEGIN SELECT RAISE(ABORT,'turn storage failure'); END");
 try{
  const response=await fetch(origin+'/battles/turn',{method:'POST',headers:{Cookie:attacker.cookie,'Content-Type':'application/json'},body:JSON.stringify({attack_id:b.attackId,version:b.version,action:'weapon',weapon_id:unit.id})});assert.equal(response.status,500);
 }finally{await run('DROP TRIGGER reject_turn');}
 assert.equal((await stats(attacker)).hp,10000);assert.equal((await stats(defender)).hp,10000);assert.equal((await query('SELECT loaded FROM weapon_instances WHERE id=?',[unit.id])).loaded,20);assert.equal((await query('SELECT version FROM battle_sessions WHERE attacker_id=?',[attacker.id])).version,0);
 await run('UPDATE battle_sessions SET expires_at=0 WHERE attacker_id=?',[attacker.id]);await fetch(origin+'/battles',{headers:{Cookie:attacker.cookie}});
});
