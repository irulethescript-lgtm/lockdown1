const {integer,debit}=require('./homes');
const types=[['Adult Novelties',1750000,4],['Amusement Park',100000000,8],['Candle Shop',500000,4],['Car Dealership',6000000,4],['Clothing Store',1000000,5],['Cruise Line',300000000,6],['Cyber Cafe',3000000,4],['Detective Agency',12000000,4],['Farm',5250000,5],['Firework Stand',500000,4],['Fitness Center',17000000,8],['Flower Shop',500000,4],['Furniture Store',2500000,4],['Game Shop',1250000,4],['Gas Station',25000000,4],['Gents Strip Club',5000000,4],['Grocery Store',2000000,5],['Gun Shop',2500000,4],['Hair Salon',750000,4],['Ladies Strip Club',5000000,4],['Law Firm',4000000,4],['Lingerie Store',1750000,4],['Logistics Management',1800000000,6],['Meat Warehouse',4000000,5],['Mechanic Shop',3000000,4],['Mining Corporation',4500000000,8],['Music Store',1500000,4],['Nightclub',7500000,5],['Oil Rig',10500000000,12],['Private Security Firm',950000000,6],['Property Broker',750000,4],['Pub',1250000,4],['Restaurant',1000000,4],['Software Corporation',6000000,5],['Sweet Shop',1000000,4],['Television Network',8000000000,8],['Theater',50000000,6],['Toy Shop',2000000,5],['Zoo',300000000,6]];
const TYPES=types.map(([name,cost,size],i)=>({key:name.toLowerCase().replaceAll(' ','_'),name,cost,size,rrp:Math.max(100,Math.floor(cost/10000)),wholesale:Math.max(50,Math.floor(cost/20000))}));
const ROLES={worker:{name:'Worker',primary:'manual',secondary:'intelligence',required:100},cleaner:{name:'Cleaner',primary:'manual',secondary:'endurance',required:50},manager:{name:'Manager',primary:'intelligence',secondary:'endurance',required:200},marketer:{name:'Marketer',primary:'intelligence',secondary:'manual',required:100},secretary:{name:'Secretary',primary:'intelligence',secondary:'endurance',required:100},trainer:{name:'Trainer',primary:'endurance',secondary:'manual',required:150},unassigned:{name:'Unassigned',primary:'manual',secondary:'intelligence',required:100}};
class CompanyError extends Error{}
const ensure=(ok,msg)=>{if(!ok)throw new CompanyError(msg);};
const closingDay=now=>Math.floor((now-18*3600)/86400);
function statEfficiency(stat,required){if(stat<=0)return 0;return Math.floor(Math.min(45,45/required*stat)+Math.max(0,5*Math.log2(stat/required)));}
function effectiveness(e,now){const r=ROLES[e.role]||ROLES.worker;return Math.max(0,statEfficiency(e[r.primary],r.required)+statEfficiency(e[r.secondary],r.required/2)+Math.min(10,Math.floor((now-e.joined_at)/86400))-Math.max(0,Math.floor((now-e.last_action)/86400)-1)*5-e.addiction);}
async function profile(tx,id,now){await tx.run('INSERT OR IGNORE INTO company_profiles(user_id,last_action) VALUES (?,?)',[id,now]);return tx.get('SELECT * FROM company_profiles WHERE user_id=?',[id]);}
async function settle(tx,now=Math.floor(Date.now()/1000)){
 const day=closingDay(now);
 const companies=await tx.all('SELECT * FROM companies WHERE last_close<?',[day]);
 for(const c of companies){
  const t=TYPES.find(t=>t.key===c.type);
  const courses=(await tx.all('SELECT course_key FROM education WHERE user_id=? AND completed_at IS NOT NULL',[c.director_id])).map(c=>c.course_key);
  const productivity=1+['BUS2200','BUS2500','BUS2800','BUS2100','BUS2120'].filter(k=>courses.includes(k)).length*.02+(courses.includes('MTH2280')?.01:0);
  const educationEffect=(courses.includes('BUS2300')?5:0)+(courses.includes('BUS2600')?7:0);
  const pricing=1+(courses.includes('BUS2700')?.1:0)+(courses.includes('BUS2900')?.05:0);
  const employees=await tx.all('SELECT e.*,p.manual,p.intelligence,p.endurance,p.addiction,p.last_action FROM company_employees e JOIN company_profiles p ON p.user_id=e.user_id WHERE e.company_id=?',[c.id]);
  // Reports are replayed chronologically, with a bounded batch for long offline periods.
  for(let d=c.last_close+1;d<=Math.min(day,c.last_close+365);d++){
   const at=d*86400+18*3600;
   const eligible=employees.filter(e=>e.joined_at<=at),scores=eligible.map(e=>({...e,score:effectiveness(e,at)+educationEffect}));
   const efficiency=Math.min(100,scores.reduce((n,e)=>n+e.score,0)/Math.max(1,eligible.length));
   const environment=Math.max(0,Math.min(100,70+c.room*8-eligible.length*2+scores.filter(e=>e.role==='cleaner'||e.role==='manager').reduce((n,e)=>n+e.score/5,0)));
   const rivals=await tx.all('SELECT advertising FROM companies WHERE type=? AND advertising>0 ORDER BY advertising DESC',[c.type]);
   const rank=rivals.filter(r=>r.advertising>c.advertising).length;
   let advertising=c.advertising>0?.4*(rivals.length-rank)/Math.max(1,rivals.length):0;
   advertising*=1+['BUS2400','LAW2100'].filter(k=>courses.includes(k)).length*.1;
   advertising*=1+scores.filter(e=>e.role==='marketer').reduce((n,e)=>n+e.score,0)/1000;
   if(await require('./stocks').hasBenefit(tx,c.director_id,'TGP',at))advertising*=1.1;
   const salesBoost=await require('./stocks').hasBenefit(tx,c.director_id,'TCP',at)?1.1:1;
   const pay=eligible.reduce((n,e)=>n+e.pay,0),expenses=pay+c.advertising;
   const funded=c.vault>=expenses;
   const demand=Math.floor(eligible.filter(e=>e.role!=='unassigned').length*100*(efficiency/100)*(.67+environment/300)*(1+(funded?advertising:0))*Math.min(2,t.rrp*pricing/Math.max(1,c.price))*salesBoost*productivity);
   const sold=Math.min(c.inventory,Math.max(0,demand)),income=sold*c.price;
   c.inventory-=sold;c.vault+=income-(funded?expenses:0);c.revenue+=income;c.week_income+=income;
   if(funded)for(const e of eligible)await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[e.pay,e.user_id]);
   for(const e of eligible){const r=ROLES[e.role];if(courses.includes('BUS2110'))await tx.run('UPDATE company_profiles SET manual=manual+1,intelligence=intelligence+1,endurance=endurance+1 WHERE user_id=?',[e.user_id]);await tx.run(`UPDATE company_profiles SET ${r.primary}=${r.primary}+2,${r.secondary}=${r.secondary}+1 WHERE user_id=?`,[e.user_id]);await tx.run('INSERT INTO company_points(user_id,type,points) VALUES (?,?,?) ON CONFLICT(user_id,type) DO UPDATE SET points=points+excluded.points',[e.user_id,c.type,c.stars]);}
   const stat=[0,5,10,20,35,50][Math.min(5,c.stars)];await tx.run('UPDATE company_profiles SET manual=manual+?,intelligence=intelligence+?,endurance=endurance+? WHERE user_id=?',[stat,stat,stat,c.director_id]);await tx.run('INSERT INTO company_points(user_id,type,points) VALUES (?,?,?) ON CONFLICT(user_id,type) DO UPDATE SET points=points+excluded.points',[c.director_id,c.type,c.stars]);
   c.trains=Math.min(20,c.trains+c.stars+Math.round(scores.filter(e=>e.role==='trainer').reduce((n,e)=>n+e.score,0)/100));
   await tx.run('INSERT INTO company_reports(company_id,day,income,expenses,customers,efficiency,environment,funded) VALUES (?,?,?,?,?,?,?,?)',[c.id,d,income,funded?expenses:0,sold,efficiency,environment,Number(funded)]);
   // Lockdown ranking uses revenue thresholds because Torn does not publish its ranking formula.
   if(new Date(at*1000).getUTCDay()===0){const target=Math.max(1,Math.min(10,1+Math.floor(Math.log2(1+c.week_income/Math.max(1,t.cost*.01)))));c.stars=Math.max(1,Math.min(target,c.stars+1));c.week_income=0;}
   await tx.run('UPDATE companies SET inventory=?,vault=?,revenue=?,week_income=?,stars=?,trains=?,last_close=? WHERE id=?',[c.inventory,c.vault,c.revenue,c.week_income,c.stars,c.trains,d,c.id]);
  }
 }
 await tx.run("UPDATE company_applications SET status='expired' WHERE status='pending' AND created_at<=?",[now-259200]);
}
async function state(tx,id,now=Math.floor(Date.now()/1000)){
 await profile(tx,id,now);await settle(tx,now);
 const companies=await tx.all('SELECT c.*,u.username AS director FROM companies c JOIN users u ON u.id=c.director_id');
 const employee=await tx.get('SELECT * FROM company_employees WHERE user_id=?',[id]);
 const company=companies.find(c=>c.director_id===id||c.id===employee?.company_id);
 if(company){const best=Math.max(1,...companies.filter(c=>c.type===company.type).map(c=>c.week_income));company.popularity=Math.min(100,Math.round(company.week_income/best*100));}
 const staff=company?await tx.all('SELECT e.*,u.username,p.manual,p.intelligence,p.endurance,p.addiction,p.last_action FROM company_employees e JOIN users u ON u.id=e.user_id JOIN company_profiles p ON p.user_id=e.user_id WHERE e.company_id=?',[company.id]):[];
 return {types:TYPES,roles:ROLES,companies,company,employee,staff:staff.map(e=>({...e,effectiveness:effectiveness(e,now)})),applications:await tx.all('SELECT a.*,u.username FROM company_applications a JOIN users u ON u.id=a.user_id WHERE a.user_id=? OR a.company_id=?',[id,company?.director_id===id?company.id:0]),reports:company?await tx.all('SELECT * FROM company_reports WHERE company_id=? ORDER BY day DESC LIMIT 7',[company.id]):[],profile:await profile(tx,id,now),points:await tx.all('SELECT * FROM company_points WHERE user_id=?',[id])};
}
async function action(tx,id,b,now=Math.floor(Date.now()/1000)){
 const u=await tx.get('SELECT * FROM users WHERE id=?',[id]),s=await state(tx,id,now);
 await tx.run('UPDATE company_profiles SET last_action=? WHERE user_id=?',[now,id]);
 if(b.action==='start'){
  ensure(u.level>=10,'Reach level 10 to direct a company.');ensure(!s.company,'Leave your current company first.');const t=TYPES.find(t=>t.key===b.type);ensure(t,'Unknown company type.');const name=String(b.name||'').trim();ensure(name.length>=3&&name.length<=60,'Company names must contain 3–60 characters.');await debit(tx,id,t.cost);await tx.run('UPDATE users SET job_key=NULL,job_prison_id=NULL WHERE id=?',[id]);await tx.run('INSERT INTO companies(type,name,director_id,last_close,price) VALUES (?,?,?,?,?)',[t.key,name,id,closingDay(now),t.rrp]);return {msg:'Company founded. Fund your vault and hire employees.'};
 }
 if(b.action==='apply'){
  ensure(u.level>=3&&!s.company,'Reach level 3 and leave your current company before applying.');const company=await tx.get('SELECT * FROM companies WHERE id=?',[integer(b.company_id,1)]);ensure(company?.applications_open,'Applications are closed.');
  const old=await tx.get('SELECT * FROM company_applications WHERE user_id=? AND company_id=?',[id,company.id]);ensure(!old||old.status!=='declined'||now>=old.updated_at+259200,'Wait 72 hours after a rejection.');
  ensure(old?.status==='pending'||(await tx.get("SELECT COUNT(*) AS n FROM company_applications WHERE user_id=? AND status='pending'",[id])).n<10,'You can have 10 pending applications.');const message=String(b.message||'').trim().slice(0,1000);await tx.run("INSERT INTO company_applications(user_id,company_id,message,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,company_id) DO UPDATE SET message=excluded.message,created_at=excluded.created_at,updated_at=excluded.updated_at,status='pending'",[id,company.id,message,now,now]);return {msg:'Application saved.'};
 }
 if(b.action==='special'){
  ensure(s.company,'Join a company first.');ensure(s.company.stars>=3,'Extra Shift unlocks at 3 stars.');ensure(!s.employee||now>=s.employee.joined_at+259200,'Recruits must wait 72 hours.');const points=integer(b.points,1,100),today=Math.floor(now/86400);
  await tx.run('INSERT OR IGNORE INTO company_special_days(user_id,day) VALUES (?,?)',[id,today]);const spent=await tx.get('SELECT spent FROM company_special_days WHERE user_id=? AND day=?',[id,today]);ensure(spent.spent+points<=100,'Only 100 job points can be spent on energy each UTC day.');ensure(u.energy+points<=1000,'Energy cannot exceed 1,000.');const paid=await tx.run('UPDATE company_points SET points=points-? WHERE user_id=? AND type=? AND points>=?',[points,id,s.company.type,points]);ensure(paid.changes,'Not enough job points.');await tx.run('UPDATE company_special_days SET spent=spent+? WHERE user_id=? AND day=?',[points,id,today]);await tx.run('UPDATE users SET energy=energy+? WHERE id=?',[points,id]);return {msg:`Extra Shift: gained ${points} energy.`};
 }
 if(b.action==='withdraw'){await tx.run("DELETE FROM company_applications WHERE id=? AND user_id=? AND status='pending'",[integer(b.application_id,1),id]);return {msg:'Application withdrawn.'};}
 if(b.action==='leave'){ensure(s.employee,'You are not employed.');await tx.run('DELETE FROM company_employees WHERE user_id=?',[id]);return {msg:'You left the company. Job points are retained.'};}
 const c=s.company;ensure(c?.director_id===id,'Only the director may manage this company.');const type=TYPES.find(t=>t.key===c.type);
 if(b.action==='vault'){
  const amount=integer(b.amount,1);ensure(['deposit','withdraw'].includes(b.direction),'Choose a vault action.');if(b.direction==='deposit'){await debit(tx,id,amount);await tx.run('UPDATE companies SET vault=vault+? WHERE id=?',[amount,c.id]);}else{ensure(c.vault>=amount,'Insufficient company funds.');await tx.run('UPDATE companies SET vault=vault-? WHERE id=?',[amount,c.id]);await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[amount,id]);}return {msg:'Company vault updated.'};
 }
 if(b.action==='settings'){
  const price=integer(b.price,1,100000000),advertising=integer(b.advertising,0,1000000000),open=Number(b.open)===1?1:0;
  await tx.run('UPDATE companies SET price=?,advertising=?,applications_open=? WHERE id=?',[price,advertising,open,c.id]);if(open&&!c.applications_open)await tx.run("DELETE FROM company_applications WHERE company_id=? AND status='declined'",[c.id]);return {msg:'Company settings saved.'};
 }
 if(b.action==='application'){
  const app=await tx.get("SELECT * FROM company_applications WHERE id=? AND company_id=? AND status='pending'",[integer(b.application_id,1),c.id]);ensure(app,'Application is no longer available.');
  if(b.accept==='yes'){
   ensure(s.staff.length<Math.floor(type.size*(1+c.size*.25)),'Upgrade your company size first.');ensure(!(await tx.get('SELECT 1 FROM company_employees WHERE user_id=?',[app.user_id]))&&!(await tx.get('SELECT 1 FROM companies WHERE director_id=?',[app.user_id])),'Applicant is no longer available.');
   await tx.run('INSERT INTO company_employees(user_id,company_id,joined_at) VALUES (?,?,?)',[app.user_id,c.id,now]);await tx.run('DELETE FROM company_applications WHERE user_id=?',[app.user_id]);await tx.run('UPDATE users SET job_key=NULL,job_prison_id=NULL WHERE id=?',[app.user_id]);
  }else await tx.run("UPDATE company_applications SET status='declined',updated_at=? WHERE id=?",[now,app.id]);return {msg:'Application processed.'};
 }
 if(['employee','train','fire','transfer'].includes(b.action)){
  const e=s.staff.find(e=>e.user_id===integer(b.user_id,1));ensure(e,'Employee not found.');
  if(b.action==='employee'){ensure(Object.hasOwn(ROLES,b.role),'Choose a valid position.');await tx.run('UPDATE company_employees SET role=?,pay=? WHERE user_id=?',[b.role,integer(b.pay,0,25000000),e.user_id]);}
  if(b.action==='fire')await tx.run('DELETE FROM company_employees WHERE user_id=?',[e.user_id]);
  if(b.action==='train'){ensure(now>=e.joined_at+259200,'Recruits must wait 72 hours for training.');ensure(c.trains>0&&e.role!=='unassigned','No training available.');const r=ROLES[e.role];if(courses.includes('BUS2110'))await tx.run('UPDATE company_profiles SET manual=manual+1,intelligence=intelligence+1,endurance=endurance+1 WHERE user_id=?',[e.user_id]);await tx.run(`UPDATE company_profiles SET ${r.primary}=${r.primary}+50,${r.secondary}=${r.secondary}+25 WHERE user_id=?`,[e.user_id]);await tx.run('UPDATE companies SET trains=trains-1 WHERE id=?',[c.id]);}
  if(b.action==='transfer'){ensure(e.role==='unassigned'&&e.pay===0,'Recipient must have an Unassigned position and zero pay.');const target=await tx.get('SELECT level FROM users WHERE id=?',[e.user_id]);ensure(target.level>=10,'Recipient must reach level 10.');await tx.run('DELETE FROM company_employees WHERE user_id=?',[e.user_id]);await tx.run('UPDATE companies SET director_id=? WHERE id=?',[e.user_id,c.id]);}
  return {msg:'Employee updated.'};
 }
 if(b.action==='order'){
  const quantity=integer(b.quantity,1,1000000),capacity=1000*(1+c.warehouse);
  ensure(c.inventory+quantity<=capacity,'Warehouse capacity exceeded.');const cost=quantity*type.wholesale;ensure(c.vault>=cost,'Fund the company vault first.');await tx.run('UPDATE companies SET inventory=inventory+?,vault=vault-? WHERE id=?',[quantity,cost,c.id]);return {msg:'Stock delivered to the warehouse.'};
 }
 if(b.action==='upgrade'){
  const kind=b.kind;ensure(['size','room','warehouse'].includes(kind),'Unknown upgrade.');const level=c[kind]+1;ensure(level<=6,'Already fully upgraded.');if(kind!=='warehouse'&&level>=5)ensure(await tx.get("SELECT 1 FROM education WHERE user_id=? AND course_key='BUS3130' AND completed_at IS NOT NULL",[id]),'Complete BUS3130 first.');
  const cost=Math.ceil(type.cost*level*({size:.1,room:.025,warehouse:.05}[kind]));ensure(c.vault>=cost,'Not enough in the company vault.');await tx.run(`UPDATE companies SET ${kind}=?,vault=vault-?,upgrades_spent=upgrades_spent+? WHERE id=?`,[level,cost,cost,c.id]);return {msg:'Company upgraded.'};
 }
 if(b.action==='sell'){
  ensure(s.staff.length===0,'Dismiss employees before closing the company.');const refund=Math.floor(.75*(type.cost+c.upgrades_spent)+.05*c.revenue+c.vault);await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[refund,id]);await tx.run('DELETE FROM company_applications WHERE company_id=?',[c.id]);await tx.run('DELETE FROM company_reports WHERE company_id=?',[c.id]);await tx.run('DELETE FROM companies WHERE id=?',[c.id]);return {msg:`Company sold for $${refund.toLocaleString()}.`};
 }
 throw new CompanyError('Unknown company action.');
}
module.exports={TYPES,ROLES,statEfficiency,effectiveness,closingDay,state,action,settle,CompanyError};
