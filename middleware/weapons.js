const {randomInt}=require('node:crypto');
const {profileFor,summary}=require('./weapon-profiles');
const nowSeconds=()=>Math.floor(Date.now()/1000);
const ATTACHMENTS={
 none:{name:'None',price:0,accuracy:0,damage:0,stealth:0},
 sight:{name:'Reflex sight',price:25000,accuracy:2,damage:0,stealth:0},
 suppressor:{name:'Suppressor',price:30000,accuracy:0,damage:-1,stealth:1},
 grip:{name:'Stabilizing grip',price:20000,accuracy:1,damage:1,stealth:0}
};
const AMMO={
 standard:{name:'Standard',price:10,damage:1,accuracy:1,pierce:0,burn:false},
 HP:{name:'Hollow point',price:30,damage:1.25,accuracy:1,pierce:0,burn:false},
 TR:{name:'Tracer',price:30,damage:1,accuracy:1.15,pierce:0,burn:false},
 PI:{name:'Piercing',price:40,damage:1,accuracy:1,pierce:.25,burn:false},
 IN:{name:'Incendiary',price:50,damage:1,accuracy:1,pierce:0,burn:true}
};
function roll(bounds,random=randomInt) { return bounds ? random(Math.round(bounds[0]*100),Math.round(bounds[1]*100)+1)/100 : null; }
function itemFor(key){const {getItem}=require('./item-catalog');return getItem('weapon',key)||getItem('item',key);}
function supports(key){const p=profileFor(itemFor(key));return !!p&&p.category!=='temporary';}
async function sync(tx,id){
 // Reconcile old saved stacks only inside a serialized transaction. Rolled units
 // leave ownership during listing, so a transfer never regenerates their stats.
 const stocks=await tx.all("SELECT item_key,SUM(quantity) AS n FROM inventory WHERE user_id=? AND item_type IN ('weapon','item') AND quantity>0 GROUP BY item_key",[id]);
 const units=await tx.all('SELECT * FROM weapon_instances WHERE owner_id=? ORDER BY id',[id]);
 const quantities=new Map(stocks.filter(r=>supports(r.item_key)).map(r=>[r.item_key,r.n]));
 for(const key of new Set([...quantities.keys(),...units.map(u=>u.item_key)])){
  const held=units.filter(u=>u.item_key===key),n=quantities.get(key)||0;
  for(const u of held.slice(n))await tx.run('DELETE FROM weapon_instances WHERE id=?',[u.id]);
  const profile=profileFor(itemFor(key));
  for(let i=held.length;i<n;i++)await tx.run('INSERT INTO weapon_instances(owner_id,item_key,damage,accuracy) VALUES (?,?,?,?)',[id,key,roll(profile.damage),roll(profile.accuracy)]);
 }
 return tx.all('SELECT * FROM weapon_instances WHERE owner_id=? ORDER BY item_key,id',[id]);
}
function describe(unit){
 const item=itemFor(unit.item_key),p=profileFor(item),a=ATTACHMENTS[unit.attachment]||ATTACHMENTS.none;
 return {...unit,name:item?.name||unit.item_key,img:item?.img,profile:p,
  effectiveDamage:unit.damage==null?null:Math.max(0,unit.damage+a.damage),
  effectiveAccuracy:unit.accuracy==null?null:Math.max(0,unit.accuracy+a.accuracy),
  stealth:(p?.stealth||0)+a.stealth,attachmentName:a.name};
}
async function courses(tx,id){return new Set((await tx.all('SELECT course_key FROM education WHERE user_id=? AND completed_at IS NOT NULL',[id])).map(r=>r.course_key));}
async function state(tx,id){
 const units=(await sync(tx,id)).map(describe);
 const loadout=await tx.get('SELECT * FROM combat_loadouts WHERE user_id=?',[id])||{instance_id:null,temporary_key:null,unarmed:'fists'};
 const equipment=await tx.get('SELECT * FROM equipment WHERE user_id=?',[id])||{};
 const selected=units.find(u=>u.id===loadout.instance_id && u.item_key===equipment.weapon) || units.find(u=>u.item_key===equipment.weapon);
 const ammo=await tx.all('SELECT * FROM weapon_ammo WHERE user_id=? AND quantity>0 ORDER BY caliber,kind',[id]);
 const owned=await tx.all('SELECT item_key,item_type,SUM(quantity) quantity FROM inventory WHERE user_id=? AND quantity>0 GROUP BY item_key,item_type',[id]);
 const temporary=owned.map(row=>({...row,item:require('./item-catalog').getItem(row.item_type,row.item_key)})).filter(r=>profileFor(r.item)?.category==='temporary');
 return {units,loadout,selected,ammo,temporary,courses:await courses(tx,id),buffs:await tx.all('SELECT * FROM combat_buffs WHERE user_id=? AND expires_at>?',[id,nowSeconds()])};
}
async function choose(tx,id,unitId){
 const units=await sync(tx,id),u=units.find(r=>r.id===unitId);
 if(!u)return {error:'You do not own that weapon.'};
 const p=profileFor(itemFor(u.item_key));
 if(!p.damage || !p.accuracy)return {error:'This weapon has unknown stats and cannot be used in combat yet.'};
 await tx.run('INSERT OR IGNORE INTO equipment(user_id) VALUES (?)',[id]);
 await tx.run('UPDATE equipment SET weapon=? WHERE user_id=?',[u.item_key,id]);
 await tx.run('INSERT INTO combat_loadouts(user_id,instance_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET instance_id=excluded.instance_id',[id,u.id]);
 return {msg:'Weapon equipped.'};
}
async function pickForListing(tx,id,key,quantity,requested){
 const units=(await sync(tx,id)).filter(u=>u.item_key===key);
 if(requested!==undefined) {
  if(quantity!==1 || !units.some(u=>u.id===requested))return null;
  return units.filter(u=>u.id===requested);
 }
 return units.slice(0,quantity);
}
async function escrow(tx,units,listingId){
 for(const unit of units)await tx.run('UPDATE weapon_instances SET owner_id=NULL,listing_id=? WHERE id=?',[listingId,unit.id]);
}
async function receiveListing(tx,listing,owner){
 if(!supports(listing.item_key))return;
 const units=await tx.all('SELECT * FROM weapon_instances WHERE listing_id=?',[listing.id]);
 if(units.length && units.length!==listing.quantity)throw new Error('Weapon listing quantity mismatch');
 await tx.run('UPDATE weapon_instances SET owner_id=?,listing_id=NULL WHERE listing_id=?',[owner,listing.id]);
 // Legacy listings have no unit records. Generate their rolled units once.
 await sync(tx,owner);
}
async function prepare(tx,user,now=nowSeconds()){
 const s=await state(tx,user.id);
 const weapon=s.selected&&s.selected.damage!=null ? s.selected : null;
 const p=weapon?.profile;
 const available=await tx.all('SELECT * FROM weapon_ammo WHERE user_id=?',[user.id]);
 const ammo=Object.fromEntries(available.map(a=>[a.caliber+'|'+a.kind,a.quantity]));
 const temp=s.temporary.find(t=>t.item_key===s.loadout.temporary_key);
 const tp=temp&&profileFor(temp.item);
 const canNeedle=tp?.kind!=='needle'||s.courses.has('BIO3420');
 return {weapon:weapon?{...weapon,damage:weapon.effectiveDamage,accuracy:weapon.effectiveAccuracy}:null,
  unarmed:s.loadout.unarmed==='kick'&&s.courses.has('martial_kick')?{name:'Kick',damage:30,accuracy:40.71,stealth:0}:{name:'Fists',damage:10,accuracy:50,stealth:0},
  ammo,temporary:temp&&canNeedle&&tp.kind!=='boss'?{...tp,key:temp.item_key,type:temp.item_type}:null,
  buffs:s.buffs.map(b=>({...b,remaining:Math.max(0,b.expires_at-now)})),
  needleBoost:s.courses.has('SPT2480')?1.1:1,profile:p,usedTemporary:false};
}
async function persist(tx,user,combat,now){
 if(combat.weapon)await tx.run('UPDATE weapon_instances SET loaded=?,ammo_type=? WHERE id=? AND owner_id=?',[combat.weapon.loaded,combat.weapon.ammo_type,combat.weapon.id,user.id]);
 for(const [key,quantity]of Object.entries(combat.ammo)){const [caliber,kind]=key.split('|');await tx.run('UPDATE weapon_ammo SET quantity=? WHERE user_id=? AND caliber=? AND kind=?',[quantity,user.id,caliber,kind]);}
 if(combat.usedTemporary){
  const t=combat.temporary;
  const owned=await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type=? AND quantity>0 ORDER BY id LIMIT 1',[user.id,t.key,t.type]);
  if(!owned)throw new Error('Temporary item ownership changed');
  await tx.run('UPDATE inventory SET quantity=quantity-1 WHERE id=?',[owned.id]);
  await tx.run('DELETE FROM inventory WHERE id=? AND quantity=0',[owned.id]);
 }
 await tx.run('DELETE FROM combat_buffs WHERE user_id=?',[user.id]);
 if(!user.in_hospital)for(const b of combat.buffs)if(b.remaining>0)await tx.run('INSERT INTO combat_buffs(user_id,stat,bonus,expires_at) VALUES (?,?,?,?)',[user.id,b.stat,b.bonus,now+b.remaining]);
}
module.exports={itemFor,ATTACHMENTS,AMMO,roll,sync,describe,state,choose,pickForListing,escrow,receiveListing,prepare,persist,supports,summary};

async function useNeedle(tx,user,item,owned,now=nowSeconds()){
 const p=profileFor(item);
 if(p?.kind!=='needle')return null;
 if(user.in_hospital||user.in_jail||user.travel?.phase!=='home')return {error:'Needles can only be used while free and at home.'};
 const learned=await courses(tx,user.id);
 if(!learned.has('BIO3420'))return {error:'Complete BIO3420: Bachelor of Biology before using needles.'};
 const bonus=p.boost*(learned.has('SPT2480')?1.1:1);
 const previous=await tx.get('SELECT * FROM combat_buffs WHERE user_id=? AND stat=?',[user.id,p.stat]);
 await tx.run('INSERT INTO combat_buffs(user_id,stat,bonus,expires_at) VALUES (?,?,?,?) ON CONFLICT(user_id,stat) DO UPDATE SET bonus=excluded.bonus,expires_at=excluded.expires_at',[user.id,p.stat,bonus+(previous?.expires_at>now?previous.bonus:0),now+120]);
 if(p.heal)await tx.run('UPDATE users SET hp=MIN(?,hp+?) WHERE id=?',[user.max_hp,Math.floor(user.max_hp*p.heal),user.id]);
 await tx.run('UPDATE inventory SET quantity=quantity-1 WHERE id=?',[owned.id]);
 await tx.run('DELETE FROM inventory WHERE id=? AND quantity=0',[owned.id]);
 return {msg:'Used '+p.name+': +'+(bonus*100).toFixed(0)+'% '+p.stat+' for 120 seconds.'};
}
module.exports.useNeedle=useNeedle;
