const { randomInt } = require('crypto');
const BLOOD = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const RULES = {
  68: { minutes:20, life:5, cooldown:10 },
  67: { minutes:40, life:10, cooldown:15 },
  66: { minutes:70, life:15, cooldown:20 },
  731: { withdraw:true, cooldown:60 },
  361: { radiation:true, minutes:180, cooldown:180 },
  200: { opium:true, cooldown:120 },
};
for(let i=732;i<=739;i++) RULES[i]={ minutes:120, life:30, cooldown:30, blood:BLOOD[i-732] };
function rule(item) { return RULES[item?.source_id] || null; }
function compatible(donor, recipient) {
  const group=s=>s.replace(/[+-]/g,'');
  return !(donor.endsWith('+') && recipient.endsWith('-')) && (group(donor)==='O' || group(recipient)==='AB' || group(donor)===group(recipient));
}
async function profile(tx,id) {
  await tx.run('INSERT OR IGNORE INTO medical_profiles (user_id,blood_type) VALUES (?,?)',[id,BLOOD[randomInt(8)]]);
  return tx.get('SELECT * FROM medical_profiles WHERE user_id=?',[id]);
}
async function settings(tx,user) {
  const p=await profile(tx,user.id);
  const faction=user.gang_id ? await tx.get('SELECT * FROM faction_medical WHERE gang_id=?',[user.gang_id]) : null;
  return {...p, cap:21600+(faction?.capacity||0)*3600, effectiveness:Math.min(50,(user.perks?.medical||0)+(faction?.effectiveness||0)*10), reviveCost:Math.max(25,75-(faction?.reviver||0)*5), faction:faction||{capacity:0,effectiveness:0,reviver:0}};
}
function allowedAt(group,readyAt,cap=21600) { return group==='medical' ? Math.max(0,readyAt-cap+1) : readyAt; }
async function use(tx,user,item,now) {
  const r=rule(item);
  if(!r)return null;
  const s=await settings(tx,user);
  const category=r.opium?'drug':'medical';
  const timer=await tx.get('SELECT ready_at FROM recovery_cooldowns WHERE user_id=? AND category=?',[user.id,category]);
  const remaining=Math.max(0,(timer?.ready_at||0)-now);
  if(r.opium ? remaining>0 : remaining>=s.cap) return {error:`${r.opium?'Drug':'Medical'} cooldown: wait ${Math.ceil((r.opium?remaining:remaining-s.cap+1)/60)} minutes.`};
  const irradiated=s.radiation_until>now;
  if(r.opium && irradiated)return {error:'Drugs cannot be used while suffering radiation poisoning.'};
  const boost=1+s.effectiveness/100;
  if(r.withdraw) {
    if(!user.perks?.intravenous)return {error:'Complete Intravenous Therapy before filling blood bags.'};
    if(user.in_hospital || user.in_jail || irradiated)return {error:'Blood cannot be withdrawn in hospital, jail or during radiation poisoning.'};
    const loss=Math.ceil(user.max_hp*.3);
    if(user.hp<=loss)return {error:'You need more than 30% life to fill a blood bag.'};
    user.hp-=loss;
    const key='torn_'+(732+BLOOD.indexOf(s.blood_type));
    const bag=await tx.get("SELECT id FROM inventory WHERE user_id=? AND item_key=? AND item_type='item' ORDER BY id LIMIT 1",[user.id,key]);
    if(bag)await tx.run('UPDATE inventory SET quantity=quantity+1 WHERE id=?',[bag.id]);
    else await tx.run("INSERT INTO inventory (user_id,item_key,item_type,quantity) VALUES (?,?,'item',1)",[user.id,key]);
  } else if(r.radiation) {
    if(!irradiated || !user.in_hospital)return {error:'Neumune treats hospitalization caused by radiation poisoning only.'};
    await tx.run('UPDATE medical_profiles SET radiation_until=MAX(?,radiation_until-43200) WHERE user_id=?',[now,user.id]);
    user.hospital_until=Math.max(now,user.hospital_until-Math.floor(r.minutes*60*boost));
  } else if(r.blood && !user.perks?.intravenous) {
    return {error:'Complete Intravenous Therapy before using blood bags.'};
  } else if(r.blood && !compatible(r.blood,s.blood_type)) {
    return {error:`Type ${r.blood} blood is incompatible with your ${s.blood_type} blood. Item kept.`};
  } else {
    if(user.hp>=user.max_hp && (!user.in_hospital || irradiated) && !r.opium)return {error:'Your resources are already full. Item kept.'};
    if(r.opium) {
      user.hp=Math.max(user.hp,Math.ceil(user.max_hp*.5*boost));
      user.hp=Math.min(user.max_hp,user.hp);
      user.hospital_until=0;user.in_hospital=0;user.hospital_reason=null;
    } else {
      user.hp=Math.min(user.max_hp,user.hp+Math.ceil(user.max_hp*r.life/100*boost));
      if(user.in_hospital && !irradiated)user.hospital_until=Math.max(now,user.hospital_until-Math.floor(r.minutes*60*boost));
    }
  }
  if(user.in_hospital && user.hospital_until<=now){user.in_hospital=0;user.hospital_until=0;user.hospital_reason=null;}
  const duration=await require('./item-actions').cooldownDuration(tx,user.id,category,r.opium?randomInt(120,181)*60:r.cooldown*60,now);
  const readyAt=(r.opium?now:Math.max(now,timer?.ready_at||0))+duration;
  await tx.run(`INSERT INTO recovery_cooldowns VALUES (?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET ready_at=excluded.ready_at`,[user.id,category,readyAt]);
  if(r.opium)await tx.run('UPDATE medical_profiles SET opium_until=? WHERE user_id=?',[readyAt,user.id]);
  return {category,readyAt,availableAt:allowedAt(category,readyAt,s.cap),msg:`Used ${item.name}. ${r.withdraw?'Filled a '+s.blood_type+' blood bag. ':''}${category==='medical'?'Medical':'Drug'} cooldown: ${Math.ceil((readyAt-now)/60)} minutes.`};
}
module.exports={BLOOD,RULES,rule,compatible,profile,settings,allowedAt,use};
