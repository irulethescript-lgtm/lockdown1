const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lockdown-economy-'));
process.env.DB_PATH=path.join(temp,'economy.db');
const db=require('../middleware/db'),homes=require('../middleware/homes'),stocks=require('../middleware/stocks'),companies=require('../middleware/companies');
const now=Math.floor(Date.now()/1000),day=86400;
let serial=0;
const account=async(cash=1e12,level=20)=>(await db.run('INSERT INTO users(username,password,cash,level) VALUES (?,?,?,?)',['economy_'+(++serial),'unused',cash,level])).lastID;
const property=(id,body,time=now)=>db.withTransaction(tx=>homes.action(tx,id,body,time));
const stock=(id,body,time=now)=>db.withTransaction(tx=>stocks.action(tx,id,body,time));
const company=(id,body,time=now)=>db.withTransaction(tx=>companies.action(tx,id,body,time));
before(async()=>{await db.get('SELECT 1');});
after(async()=>{await new Promise(r=>db.db.close(r));fs.rmSync(temp,{recursive:true,force:true});});

test('all standard property values, fully upgraded happiness and staff are correct',()=>{
 assert.equal(homes.HOMES.length,14);assert.equal(stocks.STOCKS.length,35);assert.equal(companies.TYPES.length,39);
 const expected=[100,165,188,275,500,650,725,800,925,1000,1200,1875,2725,4225];
 for(const h of homes.HOMES){const upgrades=Object.fromEntries(Object.entries(homes.UPGRADES).filter(([,tiers])=>homes.allowed(h,tiers.at(-1))).map(([k,t])=>[k,t.length]));assert.equal(homes.summary(h,upgrades).happy,expected[h.tier],h.name);}
 const h=homes.HOMES.at(-1),upgrades=Object.fromEntries(Object.entries(homes.UPGRADES).map(([k,v])=>[k,v.length]));assert.equal(homes.summary(h,upgrades,{maid:5,butler:3,guard:10,doctor:1,pilot:1}).happy,5025);assert.equal(homes.summary(h,upgrades,{maid:5,butler:3,guard:10,doctor:1,pilot:1}).daily,352500);
 assert.equal(homes.summary(h,{}, {},h.price*.5).happy,0);
});
test('concurrent purchases debit once; upgrade tiers cost full price; rollback preserves balances',async()=>{
 const id=await account(100000);const result=await Promise.allSettled([property(id,{action:'buy-home',home_key:'townhouse'}),property(id,{action:'buy-home',home_key:'townhouse'})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.get('SELECT cash FROM users WHERE id=?',[id])).cash,75000);
 await property(id,{action:'upgrade',home_key:'townhouse',upgrade:'interior',level:1});await property(id,{action:'upgrade',home_key:'townhouse',upgrade:'interior',level:2});assert.equal((await db.get('SELECT cash FROM users WHERE id=?',[id])).cash,56250);
 await assert.rejects(property(id,{action:'upgrade',home_key:'townhouse',upgrade:'pool',level:3}));await assert.rejects(property(id,{action:'sell-agent',home_key:'starter'}));
 await db.run("CREATE TRIGGER reject_home BEFORE INSERT ON owned_homes WHEN NEW.home_key='trailer' BEGIN SELECT RAISE(ABORT,'test rollback'); END");await assert.rejects(property(id,{action:'buy-home',home_key:'trailer'}));await db.run('DROP TRIGGER reject_home');assert.equal((await db.get('SELECT cash FROM users WHERE id=?',[id])).cash,56250);
});
test('leases lock upgrades, end at 03:30, transfer debt once and honor extension limits',async()=>{
 const owner=await account(),tenant=await account();await property(owner,{action:'buy-home',home_key:'penthouse'});await property(owner,{action:'list-lease',home_key:'penthouse',price:1000,days:7});const l=await db.get('SELECT * FROM property_leases WHERE owner_id=?',[owner]);
 await assert.rejects(property(owner,{action:'upgrade',home_key:'penthouse',upgrade:'interior',level:1}));await property(tenant,{action:'accept-lease',lease_id:l.id});let accepted=await db.get('SELECT * FROM property_leases WHERE id=?',[l.id]);assert.equal(accepted.ends_at%day,12600);assert.ok(accepted.ends_at-now<=100*day);
 await property(tenant,{action:'move-in',owner_id:owner,home_key:'penthouse'});await property(tenant,{action:'staff',owner_id:owner,home_key:'penthouse',role:'maid',count:1});await assert.rejects(property(tenant,{action:'move-in',home_key:'starter'}));
 await property(owner,{action:'extend-offer',lease_id:l.id,days:7,price:250});await property(tenant,{action:'extend-accept',lease_id:l.id});accepted=await db.get('SELECT * FROM property_leases WHERE id=?',[l.id]);await assert.rejects(property(owner,{action:'extend-offer',lease_id:l.id,days:100,price:1}));
 await db.withTransaction(tx=>homes.homeState(tx,tenant,accepted.ends_at+1));const debt=(await db.get('SELECT amount FROM property_debts WHERE user_id=?',[tenant])).amount;assert.ok(debt>0);await db.withTransaction(tx=>homes.homeState(tx,tenant,accepted.ends_at+1));assert.equal((await db.get('SELECT amount FROM property_debts WHERE user_id=?',[tenant])).amount,debt);assert.equal((await db.get('SELECT home_key FROM property_residence WHERE user_id=?',[tenant])).home_key,'starter');
});
test('vault funds persist when moving, spouse permissions default off and are revocable',async()=>{
 const owner=await account(),spouse=await account();const name=(await db.get('SELECT username FROM users WHERE id=?',[spouse])).username;
 await property(owner,{action:'buy-home',home_key:'palace'});await property(owner,{action:'upgrade',home_key:'palace',upgrade:'vault',level:1});await property(owner,{action:'move-in',home_key:'palace'});await property(owner,{action:'vault',home_key:'palace',amount:1000,direction:'deposit'});
 await property(owner,{action:'partner-invite',username:name});await property(spouse,{action:'partner-accept',sender_id:owner});await property(spouse,{action:'move-in',owner_id:owner,home_key:'palace'});await assert.rejects(property(spouse,{action:'vault',owner_id:owner,home_key:'palace',amount:10,direction:'withdraw'}));
 await property(owner,{action:'share-vault',home_key:'palace',share:1});await property(spouse,{action:'vault',owner_id:owner,home_key:'palace',amount:10,direction:'withdraw'});await property(owner,{action:'share-vault',home_key:'palace',share:0});await assert.rejects(property(spouse,{action:'vault',owner_id:owner,home_key:'palace',amount:10,direction:'withdraw'}));await property(owner,{action:'move-in',home_key:'starter'});assert.equal((await db.get('SELECT vault FROM property_details WHERE owner_id=? AND home_key=?',[owner,'palace'])).vault,990);
 await assert.rejects(property(owner,{action:'sell-agent',home_key:'palace'}));
});
async function ticker(id){await db.run('INSERT INTO casino_wallets(user_id,day,points) VALUES (?,?,50)',[id,'fixture']);await stock(id,{action:'ticker'});}
async function quote(id,symbol,time=now){const s=await db.withTransaction(tx=>stocks.state(tx,id,time));return s.stocks.find(s=>s.symbol===symbol).cents;}
test('stock ticker costs 50 points, fees are separate, and newest positions sell first',async()=>{
 const id=await account();await ticker(id);assert.equal((await db.get('SELECT points FROM casino_wallets WHERE user_id=?',[id])).points,0);
 const cents=await quote(id,'TCT');await stock(id,{action:'buy',symbol:'TCT',shares:100,quote:cents});await stock(id,{action:'buy',symbol:'TCT',shares:50,quote:cents});const newest=await db.get('SELECT MAX(id) AS id FROM stock_positions WHERE user_id=?',[id]);await stock(id,{action:'sell',symbol:'TCT',shares:50,quote:cents});assert.equal(await db.get('SELECT * FROM stock_positions WHERE id=?',[newest.id]),null);assert.ok((await db.get('SELECT fees FROM stock_accounts WHERE user_id=?',[id])).fees>0);
 await assert.rejects(stock(id,{action:'buy',symbol:'TCT',shares:1,quote:cents+1}));await db.run('UPDATE users SET in_jail=1,jail_until=? WHERE id=?',[now+1000,id]);await assert.rejects(stock(id,{action:'buy',symbol:'TCT',shares:1,quote:cents}));
});
test('dividends pause until claimed, new blocks wait, passive blocks need seven full days',async()=>{
 const id=await account();await ticker(id);let q=await quote(id,'EVL');await stock(id,{action:'buy',symbol:'EVL',shares:100000,quote:q});let b=await db.get('SELECT * FROM stock_benefits WHERE user_id=? AND symbol=?',[id,'EVL']);await db.run('UPDATE stock_benefits SET started_day=started_day-7 WHERE user_id=? AND symbol=?',[id,'EVL']);await stock(id,{action:'buy',symbol:'EVL',shares:200000,quote:q});b=await db.get('SELECT * FROM stock_benefits WHERE user_id=? AND symbol=?',[id,'EVL']);assert.equal(b.blocks,2);assert.equal(b.cycle_blocks,1);
 const claims=await Promise.allSettled([stock(id,{action:'claim',symbol:'EVL'}),stock(id,{action:'claim',symbol:'EVL'})]);assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);b=await db.get('SELECT * FROM stock_benefits WHERE user_id=? AND symbol=?',[id,'EVL']);assert.equal(b.cycle_blocks,2);assert.equal((await db.getUser(id)).happiness,1100);
 q=await quote(id,'ELT');await stock(id,{action:'buy',symbol:'ELT',shares:5000000,quote:q});assert.equal(await stocks.hasBenefit(db,id,'ELT',now+7*day-1),false);assert.equal(await stocks.hasBenefit(db,id,'ELT',now+7*day),true);assert.equal(stocks.increments(350000*(2**12-1),350000,10),10);
});
test('company recruitment, training locks, daily payroll, points, upgrades and sellback',async()=>{
 const director=await account(),worker=await account();await company(director,{action:'start',type:'candle_shop',name:'Test Candle Works'});let c=await db.get('SELECT * FROM companies WHERE director_id=?',[director]);await company(worker,{action:'apply',company_id:c.id,message:'Ready to work'});const app=await db.get('SELECT * FROM company_applications WHERE user_id=?',[worker]);await company(director,{action:'application',application_id:app.id,accept:'yes'});await company(director,{action:'employee',user_id:worker,role:'worker',pay:100});await company(director,{action:'vault',amount:100000,direction:'deposit'});await company(director,{action:'order',quantity:100});await assert.rejects(company(director,{action:'train',user_id:worker}));
 await db.withTransaction(tx=>companies.settle(tx,now+day));const report=await db.get('SELECT * FROM company_reports WHERE company_id=?',[c.id]);assert.ok(report);assert.equal(report.expenses,100);const balance=(await db.get('SELECT cash FROM users WHERE id=?',[worker])).cash;await db.withTransaction(tx=>companies.settle(tx,now+day));assert.equal((await db.get('SELECT cash FROM users WHERE id=?',[worker])).cash,balance);assert.ok((await db.get('SELECT points FROM company_points WHERE user_id=?',[worker])).points>=1);
 await company(director,{action:'upgrade',kind:'room'});assert.equal((await db.get('SELECT room FROM companies WHERE id=?',[c.id])).room,1);await assert.rejects(company(director,{action:'sell'}));await company(director,{action:'fire',user_id:worker});c=await db.get('SELECT * FROM companies WHERE id=?',[c.id]);const before=(await db.get('SELECT cash FROM users WHERE id=?',[director])).cash;await company(director,{action:'sell'});assert.equal((await db.get('SELECT cash FROM users WHERE id=?',[director])).cash-before,Math.floor(.75*(500000+c.upgrades_spent)+.05*c.revenue+c.vault));
});
test('company stat formula and authorization reject unauthorized management',async()=>{
 assert.equal(companies.statEfficiency(100,100),45);assert.equal(companies.statEfficiency(0,100),0);
 const id=await account(1000000,2);await assert.rejects(company(id,{action:'start',type:'candle_shop',name:'No access'}));await assert.rejects(company(id,{action:'vault',direction:'withdraw',amount:10}));
});

test('resident facilities grant damage, pool and medical bonuses without stacking',async()=>{
 const id=await account();await property(id,{action:'buy-home',home_key:'island'});await property(id,{action:'move-in',home_key:'island'});
 for(const upgrade of ['pool','shooting','medical','airstrip'])await property(id,{action:'upgrade',home_key:'island',upgrade,level:1});
 await property(id,{action:'staff',home_key:'island',role:'doctor',count:1});await property(id,{action:'staff',home_key:'island',role:'pilot',count:1});
 let u=await db.getUser(id);assert.equal(u.perks.damage,2);assert.equal(u.property.pool,true);assert.equal(u.property.airstrip,true);
 await db.run('UPDATE users SET hp=50 WHERE id=?',[id]);await db.run('UPDATE property_health_clock SET last_tick=? WHERE user_id=?',[now-300,id]);u=await db.getUser(id);assert.equal(u.hp,51);assert.equal((await db.getUser(id)).hp,51);
 await property(id,{action:'staff',home_key:'island',role:'pilot',count:0});assert.equal((await db.getUser(id)).property.airstrip,false);
});
test('energy dividends retain above-cap energy and obey the 1,000 energy ceiling',async()=>{
 const id=await account();await ticker(id);const q=await quote(id,'MCS');await stock(id,{action:'buy',symbol:'MCS',shares:350000*(2**10-1),quote:q});await db.run("UPDATE stock_benefits SET started_day=started_day-7 WHERE user_id=? AND symbol='MCS'",[id]);await stock(id,{action:'claim',symbol:'MCS'});assert.equal((await db.getUser(id)).energy,1000);assert.equal((await db.getUser(id)).energy,1000);await assert.rejects(stock(id,{action:'claim',symbol:'MCS'}));
});
test('company special enforces recruit wait, daily cap and retained points',async()=>{
 const director=await account(),worker=await account();await company(director,{action:'start',type:'pub',name:'Special Test Pub'});const c=await db.get('SELECT * FROM companies WHERE director_id=?',[director]);await company(worker,{action:'apply',company_id:c.id,message:'Application'});const app=await db.get('SELECT * FROM company_applications WHERE user_id=?',[worker]);await company(director,{action:'application',application_id:app.id,accept:'yes'});await db.run('UPDATE companies SET stars=3 WHERE id=?',[c.id]);await db.run("INSERT INTO company_points(user_id,type,points) VALUES (?,'pub',200)",[worker]);await assert.rejects(company(worker,{action:'special',points:100}));await db.run('UPDATE company_employees SET joined_at=? WHERE user_id=?',[now-259201,worker]);await company(worker,{action:'special',points:100});await assert.rejects(company(worker,{action:'special',points:1}));await company(worker,{action:'leave'});assert.equal((await db.get("SELECT points FROM company_points WHERE user_id=? AND type='pub'",[worker])).points,100);
});
test('expired rentals remove spouse occupancy and do not expose rented vaults',async()=>{
 const owner=await account(),tenant=await account(),spouse=await account();await property(owner,{action:'buy-home',home_key:'palace'});await property(owner,{action:'upgrade',home_key:'palace',upgrade:'vault',level:1});await property(owner,{action:'list-lease',home_key:'palace',days:1,price:1000});const l=await db.get('SELECT * FROM property_leases WHERE owner_id=?',[owner]);await property(tenant,{action:'accept-lease',lease_id:l.id});await property(tenant,{action:'move-in',owner_id:owner,home_key:'palace'});await assert.rejects(property(tenant,{action:'vault',owner_id:owner,home_key:'palace',amount:1,direction:'deposit'}));const name=(await db.get('SELECT username FROM users WHERE id=?',[spouse])).username;await property(tenant,{action:'partner-invite',username:name});await property(spouse,{action:'partner-accept',sender_id:tenant});await property(spouse,{action:'move-in',owner_id:owner,home_key:'palace'});const accepted=await db.get('SELECT * FROM property_leases WHERE id=?',[l.id]);const state=await db.withTransaction(tx=>homes.homeState(tx,spouse,accepted.ends_at+1));assert.equal(state.active.key,'starter');
});
