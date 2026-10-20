const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lockdown-weapons-'));
process.env.DB_PATH=path.join(temp,'weapons.db');
const db=require('../middleware/db'),weapons=require('../middleware/weapons');
const {profileFor,profiles,temporary}=require('../middleware/weapon-profiles');
const {CATALOGS}=require('../middleware/item-catalog');
const {simulateFight}=require('../middleware/dynamics');
let serial=0;
const account=async()=> (await db.run('INSERT INTO users(username,password,cash) VALUES (?,?,1000000)',['weapon_'+(++serial),'unused'])).lastID;
before(async()=>{await db.get('SELECT 1');});
after(async()=>{await new Promise(r=>db.db.close(r));fs.rmSync(temp,{recursive:true,force:true});});
const unit=(key)=>({id:1,item_key:key,...weapons.describe({id:1,item_key:key,damage:70,accuracy:60,loaded:5,ammo_type:'standard',attachment:'none'})});
const base=(name,extra={})=>({username:name,hp:1000,max_hp:1000,strength:10,defense:10,speed:10,dexterity:10,stamina:100,...extra});
function combat(extra={}){return {weapon:null,ammo:{},buffs:[],unarmed:{name:'Fists',damage:10,accuracy:50},needleBoost:1,usedTemporary:false,...extra};}

test('all supplied ranges map to catalog names, including aliases, exact values and narrow ranges',()=>{
 assert.equal(profiles.size,151);
 const catalog=Object.values(CATALOGS).flatMap(Object.values);
 for(const p of profiles.values())assert.ok(catalog.some(item=>profileFor(item)===p),p.name);
 assert.deepEqual(profileFor(CATALOGS.weapon.torn_108).damage,[65,70]);
 assert.equal(profileFor(CATALOGS.weapon.torn_243).name,'Taurus');
 assert.equal(profileFor(CATALOGS.weapon.torn_395).name,'Metal Nunchakus');
 assert.equal(weapons.roll([1,5.3],()=>530),5.3);
 assert.equal(weapons.roll([18,18]),18);
 assert.equal(weapons.roll(null),null);
 for(const p of profiles.values())if(p.damage)for(let i=0;i<20;i++){
  const d=weapons.roll(p.damage),a=weapons.roll(p.accuracy);
  assert.ok(d>=p.damage[0]&&d<=p.damage[1]);assert.ok(a>=p.accuracy[0]&&a<=p.accuracy[1]);
 }
 assert.equal(temporary.bolas.stat,'skip');
 assert.equal(temporary.serotonin.boost,3);
});
test('legacy stacks generate stable individual rolls, including weapons saved as item types',async()=>{
 const id=await account();
 await db.run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_1','weapon',2)",[id]);
 await db.run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_387','item',1)",[id]);
 const first=await db.withTransaction(tx=>weapons.sync(tx,id));
 assert.equal(first.length,3);assert.notEqual(first[0].id,first[1].id);
 assert.deepEqual(await db.withTransaction(tx=>weapons.sync(tx,id)),first);
 await db.withTransaction(async tx=>{await tx.run("DELETE FROM inventory WHERE user_id=? AND item_key='torn_1'",[id]);await weapons.sync(tx,id);});
 assert.equal((await db.all('SELECT * FROM weapon_instances WHERE owner_id=?',[id])).length,1);
});
test('weapon rolls and modifications move to escrow, buyer, and cancellation without rerolling',async()=>{
 const seller=await account(),buyer=await account();
 await db.run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_14','weapon',1)",[seller]);
 const units=await db.withTransaction(tx=>weapons.sync(tx,seller));
 await db.run("UPDATE weapon_instances SET loaded=12,attachment='sight' WHERE id=?",[units[0].id]);
 const original=await db.get('SELECT * FROM weapon_instances WHERE id=?',[units[0].id]);
 await db.withTransaction(async tx=>{
  await tx.run('DELETE FROM inventory WHERE user_id=?',[seller]);
  await weapons.escrow(tx,[original],123);
  assert.equal((await weapons.sync(tx,seller)).length,0);
  await tx.run("INSERT INTO inventory(user_id,item_key,item_type,quantity) VALUES (?,'torn_14','weapon',1)",[buyer]);
  await weapons.receiveListing(tx,{id:123,item_type:'weapon',item_key:'torn_14',quantity:1},buyer);
 });
 const received=await db.get('SELECT * FROM weapon_instances WHERE id=?',[original.id]);
 assert.deepEqual(received,{...original,owner_id:buyer,listing_id:null});
 await assert.rejects(db.withTransaction(async tx=>{await tx.run('DELETE FROM inventory WHERE user_id=?',[buyer]);await weapons.sync(tx,buyer);throw Error('rollback');}),/rollback/);
 assert.deepEqual(await db.get('SELECT * FROM weapon_instances WHERE id=?',[original.id]),received);
});
test('accuracy and damage affect combat independently; generated values do not rewrite stats',()=>{
 const fight=(damage,accuracy)=>simulateFight(base('A',{strength:20,combat:combat({unarmed:{name:'Test',damage,accuracy}})}),base('B'), 'balanced',()=>.5);
 assert.ok(fight(40,50).damageDealt>fight(10,50).damageDealt);
 assert.equal(fight(10,1).damageDealt,0);
 assert.ok(fight(10,100).damageDealt>0);
});
test('magazines spend rate-of-fire rounds, reload from reserve and then fall back to fists',()=>{
 const w=unit('torn_14');w.profile=profileFor(CATALOGS.weapon.torn_14);w.loaded=1;
 const c=combat({weapon:w,ammo:{'5.7mm|standard':2}});
 const fight=simulateFight(base('A',{hp:10000,max_hp:10000,strength:1,combat:c}),base('B',{hp:10000,max_hp:10000,strength:1}),'balanced',()=>.5);
 assert.equal(c.weapon.loaded,0);assert.equal(c.ammo['5.7mm|standard'],0);
 assert.ok(fight.log.some(l=>l.includes('reloads')));
 assert.ok(fight.log.some(l=>l.includes('switches to Fists')));
});
test('ensnare skips exactly three opposing turns and temporary items activate only once',()=>{
 const c=combat({temporary:{...temporary.bolas}});
 const result=simulateFight(base('A',{hp:10000,max_hp:10000,strength:1,combat:c}),base('B',{hp:10000,max_hp:10000,strength:1}),'balanced',()=>.1);
 assert.equal(result.log.filter(l=>l.includes('uses Bolas')).length,1);
 assert.equal(result.log.filter(l=>l.includes('Ensnared and misses')).length,3);
 assert.equal(c.usedTemporary,true);
});
test('debuffs expire on the simulated clock, needles stack and serotonin restores life',()=>{
 const plain=simulateFight(base('A'),base('B'),'balanced',()=>.5);
 const debuff=simulateFight(base('A',{combat:combat({temporary:{...temporary.pepperspray}})}),base('B'),'balanced',()=>.8);
 assert.ok(debuff.log.some(l=>l.includes('suffers Pepper Spray')));
 assert.ok(debuff.log.some(l=>l.startsWith('R5:')&&l.includes('misses')));
 const c=combat({temporary:{...temporary.serotonin},needleBoost:1.1,buffs:[{stat:'defense',bonus:3,remaining:60}]});
 const healed=simulateFight(base('A',{hp:10,strength:1,defense:10000,combat:c}),base('B',{strength:1}),'balanced',()=>.5);
 assert.ok(healed.aHp>10);assert.ok(Math.abs(c.buffs[0].bonus-6.3)<1e-9);
 assert.equal(c.buffs[0].remaining,0);assert.equal(plain.seconds,150);
});
test('burning and festive effects work without turning decorations into damage',()=>{
 const fire=simulateFight(base('A',{combat:combat({temporary:{...temporary.molotovcocktail}})}),base('B'),'balanced',()=>.1);
 assert.ok(fire.log.some(l=>l.includes('burning damage')));
 const party=simulateFight(base('A',{combat:combat({temporary:{...temporary.partypopper}})}),base('B'),'balanced',()=>.5);
 assert.ok(party.log.some(l=>l.includes('[festive]')));
 assert.ok(!party.log.some(l=>/Party Popper hits/.test(l)));
});
