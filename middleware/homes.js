const {HOMES,UPGRADES,STAFF,allowed,summary}=require('./property-catalog');
const day=86400, nowSeconds=()=>Math.floor(Date.now()/1000);
class PropertyError extends Error{}
const ensure=(ok,message)=>{if(!ok)throw new PropertyError(message);};
function integer(value,min=0,max=Number.MAX_SAFE_INTEGER){const n=Number(value);ensure(Number.isSafeInteger(n)&&n>=min&&n<=max,'Enter a valid whole number.');return n;}
async function companyPerk(tx,id,type,stars){return !!(await tx.get('SELECT c.id FROM companies c LEFT JOIN company_employees e ON e.company_id=c.id WHERE (c.director_id=? OR e.user_id=?) AND c.type=? AND c.stars>=?',[id,id,type,stars]));}
async function details(tx,owner,key,now){
 await tx.run('INSERT OR IGNORE INTO property_details (owner_id,home_key,last_day) VALUES (?,?,?)',[owner,key,Math.floor(now/day)]);
 const row=await tx.get('SELECT * FROM property_details WHERE owner_id=? AND home_key=?',[owner,key]);
 row.upgrades=JSON.parse(row.upgrades);row.staff=JSON.parse(row.staff);
 return row;
}
async function settle(tx,owner,key,now=nowSeconds()){
 const row=await details(tx,owner,key,now),home=HOMES.find(h=>h.key===key);
 const lease=await tx.get("SELECT * FROM property_leases WHERE owner_id=? AND home_key=? AND status='active'",[owner,key]);
 const until=lease?Math.min(now,lease.ends_at):now;
 const elapsed=Math.max(0,Math.floor(until/day)-row.last_day);
 if(elapsed){const payer=lease?.tenant_id||owner;
  const occupants=await tx.all('SELECT user_id FROM property_residence WHERE owner_id=? AND home_key=?',[owner,key]);
  let waived=false;for(const o of occupants)if(await companyPerk(tx,o.user_id,'lingerie_store',7))waived=true;
  row.debt+=waived?0:elapsed*summary(home,row.upgrades,row.staff).daily;row.last_day=Math.floor(until/day);await tx.run('UPDATE property_details SET debt=?,last_day=? WHERE owner_id=? AND home_key=?',[row.debt,row.last_day,owner,key]);}
 if(lease&&now>=lease.ends_at){
  await tx.run('INSERT INTO property_debts (user_id,amount) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET amount=amount+excluded.amount',[lease.tenant_id,row.debt]);
  await tx.run("UPDATE property_leases SET status='expired' WHERE id=?",[lease.id]);
  await tx.run('DELETE FROM property_residence WHERE owner_id=? AND home_key=?',[owner,key]);
  await tx.run("UPDATE property_details SET debt=0,staff='{}',last_day=? WHERE owner_id=? AND home_key=?",[Math.floor(now/day),owner,key]);
  row.debt=0;row.staff={};row.last_day=Math.floor(now/day);
  await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'property',?)",[lease.tenant_id,'Your lease expired. Any unpaid upkeep has been transferred to the loan shark.']);
 }
 return {...row,home,...summary(home,row.upgrades,row.staff,row.debt)};
}
async function homeState(tx,userId,now=nowSeconds()) {
 await tx.run("INSERT OR IGNORE INTO owned_homes (user_id,home_key,active) SELECT ?,'starter',CASE WHEN EXISTS(SELECT 1 FROM owned_homes WHERE user_id=? AND active=1) THEN 0 ELSE 1 END",[userId,userId]);
 const owned=await tx.all('SELECT * FROM owned_homes WHERE user_id=?',[userId]);
 const properties=[];
 for(const o of owned)properties.push(await settle(tx,userId,o.home_key,now));
 const leases=await tx.all("SELECT * FROM property_leases WHERE tenant_id=? AND status='active'",[userId]);
 for(const l of leases)await settle(tx,l.owner_id,l.home_key,now);
 let residence=await tx.get('SELECT * FROM property_residence WHERE user_id=?',[userId]);
 if(residence){await settle(tx,residence.owner_id,residence.home_key,now);residence=await tx.get('SELECT * FROM property_residence WHERE user_id=?',[userId]);}
 if(!residence){const key=owned.find(o=>o.active)?.home_key||'starter';residence={owner_id:userId,home_key:key};await tx.run('INSERT INTO property_residence (user_id,owner_id,home_key) VALUES (?,?,?)',[userId,userId,key]);}
 const current=await settle(tx,residence.owner_id,residence.home_key,now);
 const active=current.home;
 const furnishings=await tx.all('SELECT * FROM cell_amenities WHERE user_id=? ORDER BY id',[userId]);
 const partner=await tx.get('SELECT p.*,u.username FROM property_partners p JOIN users u ON u.id=p.spouse_id WHERE p.user_id=?',[userId]);
 const invitations=await tx.all('SELECT i.*,u.username FROM property_partner_invites i JOIN users u ON u.id=i.sender_id WHERE recipient_id=?',[userId]);
 const sharedHomes=partner?await tx.all("SELECT user_id AS owner_id,home_key FROM owned_homes WHERE user_id=? UNION SELECT owner_id,home_key FROM property_leases WHERE tenant_id=? AND status='active'",[partner.spouse_id,partner.spouse_id]):[];
 return {owned,active,furnishings,properties,current,partner,invitations,sharedHomes,leases:await tx.all("SELECT l.*,u.username AS landlord FROM property_leases l JOIN users u ON u.id=l.owner_id WHERE l.tenant_id=? AND l.status='active'",[userId]),offers:await tx.all("SELECT l.*,u.username AS landlord FROM property_leases l JOIN users u ON u.id=l.owner_id WHERE l.status='offered' ORDER BY l.id DESC"),sales:await tx.all('SELECT p.*,u.username AS seller FROM property_details p JOIN users u ON u.id=p.owner_id WHERE p.sale_price>0'),landlordLeases:await tx.all("SELECT * FROM property_leases WHERE owner_id=? AND status='active'",[userId]),loan:(await tx.get('SELECT amount FROM property_debts WHERE user_id=?',[userId]))?.amount||0};
}
async function debit(tx,id,amount){ensure(Number.isSafeInteger(amount)&&amount>=0,'Invalid amount.');const r=await tx.run('UPDATE users SET cash=cash-? WHERE id=? AND cash>=?',[amount,id,amount]);ensure(r.changes,'Not enough cash.');}
async function vacant(tx,owner,key){return !(await tx.get('SELECT user_id FROM property_residence WHERE owner_id=? AND home_key=?',[owner,key]));}
async function unlocked(tx,owner,key){return !(await tx.get("SELECT id FROM property_leases WHERE owner_id=? AND home_key=? AND status IN ('active','offered')",[owner,key]));}
async function action(tx,id,b,now=nowSeconds()){
 const state=await homeState(tx,id,now),key=b.home_key,home=HOMES.find(h=>h.key===key),a=b.action;
 if(a==='partner-invite'){ensure(!state.partner,'You already have a spouse.');const target=await tx.get('SELECT id FROM users WHERE username=?',[String(b.username||'').trim()]);ensure(target&&target.id!==id,'Choose another citizen.');ensure(!(await tx.get('SELECT 1 FROM property_partners WHERE user_id=?',[target.id])),'This citizen already has a spouse.');await tx.run('INSERT OR REPLACE INTO property_partner_invites(sender_id,recipient_id) VALUES (?,?)',[id,target.id]);return {msg:'Spouse invitation sent. They can accept from Properties.'};}
 if(a==='partner-accept'){const sender=integer(b.sender_id,1);ensure(!state.partner&&await tx.get('SELECT 1 FROM property_partner_invites WHERE sender_id=? AND recipient_id=?',[sender,id]),'Invitation unavailable.');ensure(!(await tx.get('SELECT 1 FROM property_partners WHERE user_id=?',[sender])),'This citizen already has a spouse.');await tx.run('INSERT INTO property_partners(user_id,spouse_id) VALUES (?,?),(?,?)',[id,sender,sender,id]);await tx.run('DELETE FROM property_partner_invites WHERE sender_id IN (?,?) OR recipient_id IN (?,?)',[id,sender,id,sender]);return {msg:'You are now spouses. Vault access remains disabled until granted.'};}
 if(a==='buy-home'){
  ensure(home&&home.price,'Choose a property for sale.');ensure(!state.owned.some(o=>o.home_key===key),'You already own this property.');
  const law=await tx.get("SELECT 1 FROM education WHERE user_id=? AND course_key='LAW2910' AND completed_at IS NOT NULL",[id]);
  await debit(tx,id,Math.ceil(home.price*(law?.95:1)));await tx.run('INSERT INTO owned_homes (user_id,home_key) VALUES (?,?)',[id,key]);return {msg:`Purchased ${home.name}. Move in to use its facilities.`};
 }
 if(a==='pay-loan'){await debit(tx,id,state.loan);await tx.run('UPDATE property_debts SET amount=0 WHERE user_id=?',[id]);return {msg:'Loan shark debt cleared.'};}
 if(a==='accept-lease'){
  const lease=await tx.get("SELECT * FROM property_leases WHERE id=? AND status='offered'",[integer(b.lease_id,1)]);
  ensure(lease&&lease.owner_id!==id,'Lease unavailable.');ensure(await vacant(tx,lease.owner_id,lease.home_key),'Property is occupied.');
  await debit(tx,id,lease.price);await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[lease.price,lease.owner_id]);
  const ends=Math.floor(now/day)*day+lease.days*day+12600-(now%day<12600?day:0);
  const before=await settle(tx,lease.owner_id,lease.home_key,now);
  await debit(tx,lease.owner_id,before.debt);
  await tx.run('UPDATE property_details SET debt=0 WHERE owner_id=? AND home_key=?',[lease.owner_id,lease.home_key]);
  await tx.run("UPDATE property_leases SET tenant_id=?,started_at=?,ends_at=?,status='active' WHERE id=?",[id,now,ends,lease.id]);
  await tx.run('UPDATE property_details SET last_day=? WHERE owner_id=? AND home_key=?',[Math.floor(now/day),lease.owner_id,lease.home_key]);return {msg:'Lease paid upfront. You can now move in.'};
 }
 if(a==='cancel-offer'){const r=await tx.run("DELETE FROM property_leases WHERE id=? AND owner_id=? AND status='offered'",[integer(b.lease_id,1),id]);ensure(r.changes,'Only an unaccepted offer can be cancelled.');return {msg:'Rental offer removed.'};}
 if(a==='extend-offer'||a==='extend-accept'){
  const l=await tx.get("SELECT * FROM property_leases WHERE id=? AND status='active'",[integer(b.lease_id,1)]);ensure(l&&l.ends_at>now,'Active lease not found.');
  if(a==='extend-offer'){ensure(l.owner_id===id,'Only the landlord may offer an extension.');const days=integer(b.days,1,100),price=integer(b.price);ensure(l.ends_at+days*day-now<=100*day,'Remaining occupancy cannot exceed 100 days.');await tx.run('UPDATE property_leases SET extension_days=?,extension_price=? WHERE id=?',[days,price,l.id]);await tx.run("INSERT INTO events(user_id,type,message) VALUES (?,'property',?)",[l.tenant_id,`Your landlord offered a ${days} day extension for $${price}. Visit /property to accept.`]);}
  else{ensure(l.tenant_id===id&&l.extension_days>0,'No extension available.');ensure(l.ends_at+l.extension_days*day-now<=100*day,'Extension exceeds 100 days.');await debit(tx,id,l.extension_price);await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[l.extension_price,l.owner_id]);await tx.run('UPDATE property_leases SET ends_at=ends_at+extension_days*86400,extension_days=0,extension_price=0 WHERE id=?',[l.id]);}
  return {msg:'Lease extension saved.'};
 }
 const owner=b.owner_id?integer(b.owner_id,1):id;
 ensure(home,'Choose a property.');ensure(await tx.get('SELECT 1 FROM owned_homes WHERE user_id=? AND home_key=?',[owner,key]),'Property not found.');
 const p=await settle(tx,owner,key,now),own=owner===id;
 const lease=await tx.get("SELECT * FROM property_leases WHERE owner_id=? AND home_key=? AND tenant_id=? AND status='active'",[owner,key,id]);
 if(a==='buy-sale'){
  ensure(!own&&p.sale_price>0,'Property is not for sale.');ensure(await vacant(tx,owner,key)&&await unlocked(tx,owner,key),'Property is occupied or leased.');ensure(!state.owned.some(o=>o.home_key===key),'You already own this property type.');await debit(tx,id,p.sale_price);await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[p.sale_price,owner]);await tx.run('UPDATE owned_homes SET user_id=? WHERE user_id=? AND home_key=?',[id,owner,key]);await tx.run('UPDATE property_details SET owner_id=?,sale_price=0 WHERE owner_id=? AND home_key=?',[id,owner,key]);return {msg:'Property purchased from the market.'};
 }
 const spouse=state.partner?.spouse_id===owner;
 const spouseLease=state.partner?await tx.get("SELECT * FROM property_leases WHERE owner_id=? AND home_key=? AND tenant_id=? AND status='active'",[owner,key,state.partner.spouse_id]):null;
 ensure(own||lease||spouse||spouseLease,'You do not have access to this property.');
 if(a==='share-vault'){ensure(own,'Only the owner can grant vault access.');await tx.run('UPDATE property_details SET share_vault=? WHERE owner_id=? AND home_key=?',[Number(b.share)===1?1:0,id,key]);return {msg:'Spouse vault permission updated.'};}
 if(a==='move-in'){
  ensure((lease||spouseLease||await unlocked(tx,owner,key))&&!p.sale_price,'This property is listed or leased.');const currentLease=await tx.get("SELECT 1 FROM property_leases WHERE owner_id=? AND home_key=? AND tenant_id=? AND status='active'",[state.current.owner_id,state.current.home_key,id]);
  if(state.current.owner_id===id||currentLease)ensure(!Object.values(state.current.staff).some(Boolean)&&state.current.debt===0,'Fire all staff and clear upkeep before moving.');
  ensure(state.furnishings.filter(f=>f.placed_tile!==null).length<=home.capacity,'Store furnishings before moving to a smaller home.');
  await tx.run('UPDATE owned_homes SET active=0 WHERE user_id=?',[id]);if(own)await tx.run('UPDATE owned_homes SET active=1 WHERE user_id=? AND home_key=?',[id,key]);
  await tx.run('UPDATE property_residence SET owner_id=?,home_key=? WHERE user_id=?',[owner,key,id]);return {msg:`You now live in ${home.name}.`};
 }
 if(a==='pay-upkeep'){await debit(tx,id,p.debt);await tx.run('UPDATE property_details SET debt=0 WHERE owner_id=? AND home_key=?',[owner,key]);return {msg:'Upkeep paid.'};}
 if(a==='staff'){
  ensure(own||lease,'Spouses cannot hire or dismiss staff.');
  ensure(state.current.owner_id===owner&&state.current.home_key===key,'Move in before hiring staff.');const role=b.role,count=integer(b.count,0,10),s=STAFF[role];ensure(s&&home.tier>=s.min&&(count===0||s.tiers.some(t=>t[0]===count)),'Staff unavailable.');p.staff[role]=count;await tx.run('UPDATE property_details SET staff=? WHERE owner_id=? AND home_key=?',[JSON.stringify(p.staff),owner,key]);return {msg:'Staff updated. Fees accrue daily at midnight UTC.'};
 }
 if(a==='vault'){
  ensure((own||(spouse&&p.share_vault))&&await unlocked(tx,owner,key),'Vault access is restricted. Rental vaults cannot be used.');ensure(state.current.owner_id===owner&&state.current.home_key===key,'Move in to access this vault.');const amount=integer(b.amount,1);ensure(p.vaultCapacity,'Install a vault first.');ensure(['deposit','withdraw'].includes(b.direction),'Choose deposit or withdrawal.');
  if(b.direction==='deposit'){ensure(p.vault+amount<=p.vaultCapacity,'Vault capacity exceeded.');await debit(tx,id,amount);p.vault+=amount;}else{ensure(p.vault>=amount,'Not enough in the vault.');p.vault-=amount;await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[amount,id]);}
  await tx.run('UPDATE property_details SET vault=? WHERE owner_id=? AND home_key=?',[p.vault,owner,key]);await tx.run('INSERT INTO property_vault_log(owner_id,home_key,user_id,amount,created_at) VALUES (?,?,?,?,?)',[owner,key,id,b.direction==='deposit'?amount:-amount,now]);return {msg:'Vault transaction complete.'};
 }
 ensure(own,'Only the owner may do this.');ensure(await unlocked(tx,owner,key),'Lease terms and upgrades are locked.');
 if(a==='upgrade'){
  ensure(!p.sale_price,'Remove the sale listing first.');const type=b.upgrade,level=integer(b.level,1,4),u=UPGRADES[type]?.[level-1];ensure(u&&allowed(home,u)&&level>(p.upgrades[type]||0),'Upgrade unavailable or already installed.');
  let discount=await require('./stocks').hasBenefit(tx,id,'ELT',now)? .9:1;
  if(await companyPerk(tx,id,'property_broker',10))discount*=.9;
  await debit(tx,id,Math.ceil((type==='interior'?u.cost*home.price:u.cost)*discount));p.upgrades[type]=level;await tx.run('UPDATE property_details SET upgrades=? WHERE owner_id=? AND home_key=?',[JSON.stringify(p.upgrades),owner,key]);return {msg:`Installed ${u.name}.`};
 }
 ensure(home.price>0,'Your default Shack cannot be sold or leased.');ensure(await vacant(tx,owner,key),'Move out before listing or selling.');ensure(!Object.values(p.staff).some(Boolean)&&p.vault===0,'Fire staff and empty the vault first.');
 if(a==='sell-agent'){const value=Math.floor(home.price*.75)-p.debt;ensure(value>=0,'Clear excess upkeep first.');await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[value,id]);await tx.run('DELETE FROM property_details WHERE owner_id=? AND home_key=?',[id,key]);await tx.run('DELETE FROM owned_homes WHERE user_id=? AND home_key=?',[id,key]);return {msg:`Sold for $${value.toLocaleString()} after upkeep.`};}
 ensure(p.debt===0,'Clear upkeep before listing.');
 if(a==='list-sale'){await tx.run('UPDATE property_details SET sale_price=? WHERE owner_id=? AND home_key=?',[integer(b.price),id,key]);return {msg:'Sale listing updated.'};}
 if(a==='list-lease'){ensure(!p.sale_price,'Remove the sale listing first.');await tx.run('INSERT INTO property_leases(owner_id,home_key,price,days) VALUES (?,?,?,?)',[id,key,integer(b.price),integer(b.days,1,100)]);return {msg:'Lease offered on the market.'};}
 throw new PropertyError('Unknown property action.');
}
module.exports={HOMES,UPGRADES,STAFF,allowed,summary,homeState,action,PropertyError,integer,debit};
