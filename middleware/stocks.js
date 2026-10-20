const {randomInt}=require('node:crypto');
const stockRows=[
 ['ASS','Alcoholics Synonymous',1000000,7,'Six Pack of Alcohol'],['BAG',"Big Al’s Gun Shop",3000000,7,'Ammunition Pack'],['CNC','Crude & Co',7500000,31,80000000],['EWM','Eaglewood Mercenary',1000000,7,'Box of Grenades'],['ELT','Empty Lunchbox Traders',5000000,0,'10% Home Upgrade Discount'],['EVL','Evil Ducks Candy Corp',100000,7,'happy',1000],['FHG','Feathery Hotels Group',2000000,7,'Feathery Hotel Coupon'],['GRN','Grain',500000,31,4000000],['CBD','Herbal Releaf Co.',350000,7,'nerve',50],['HRG','Home Retail Group',10000000,31,'property'],['IIL','I Industries Ltd.',1000000,0,'50% Virus Coding Time Reduction'],['IOU','Insured On Us',3000000,31,12000000],['IST','International School TC',100000,0,'Free Education Courses'],['LAG','Legal Authorities Group',750000,7,'Lawyer Business Card'],['LOS','Lo Squalo Waste Management',7500000,0,'25% Mission Rewards'],['LSC','Lucky Shots Casino',500000,7,'Lottery Voucher'],['MCS','Mc Smoogle Corp',350000,7,'energy',100],['MSG','Messaging Inc.',300000,0,'Free Classified Advertising'],['MUN','Munster Beverage Corp.',5000000,7,'Six Pack of Energy Drink'],['PRN','Performance Ribaldry Network',1000000,7,'Erotic DVD'],['PTS','PointLess',10000000,7,'points',100],['SYM','Symbiotic Ltd.',500000,7,'Drug Pack'],['SYS','Syscore MFG',3000000,0,'Advanced Firewall'],['TCP','TC Media Productions',1000000,0,'Company Sales Boost'],['TMI','TC Music Industries',6000000,31,25000000],['TGP','Tell Group Plc.',2500000,0,'Company Advertising Boost'],['TCT','The Torn City Times',100000,31,1000000],['TSB','Torn & Shanghai Banking',3000000,31,50000000],['TCC','Torn City Clothing',7500000,31,'Clothing Cache'],['THS','Torn City Health Service',150000,7,'Box of Medical Supplies'],['TCI','Torn City Investments',1500000,0,'10% Bank Interest Bonus'],['TCM','Torn City Motors',1000000,0,'10% Racing Skill Boost'],['WSU','West Side University',1000000,0,'10% Education Time Reduction'],['WLT','Wind Lines Travel',9000000,0,'Private Jet Access'],['YAZ','Yazoo',1000000,0,'Free Banner Advertising']
];
const STOCKS=stockRows.map(([symbol,name,shares,days,reward,amount],i)=>({symbol,name,shares,days,reward,amount:amount||1,initial:10000+i*3700}));
class StockError extends Error{}
const ensure=(ok,msg)=>{if(!ok)throw new StockError(msg);};
const whole=(value,min=1)=>{const n=Number(value);ensure(Number.isSafeInteger(n)&&n>=min&&n<=1000000000000,'Invalid whole number.');return n;};
function increments(shares,base,cap=50){return Math.min(cap,Math.floor(Math.log2(shares/base+1)));}
async function hasBenefit(tx,id,symbol,now=Math.floor(Date.now()/1000)){
 const s=STOCKS.find(s=>s.symbol===symbol);if(!s||s.days)return false;
 const b=await tx.get('SELECT * FROM stock_benefits WHERE user_id=? AND symbol=?',[id,symbol]);return !!(b&&b.blocks&&now>=Math.round(b.started_day*86400)+7*86400);
}
async function quotes(tx,now){
 const minute=Math.floor(now/60);
 for(const s of STOCKS){
  await tx.run('INSERT OR IGNORE INTO stock_quotes(symbol,cents,minute,previous) VALUES (?,?,?,?)',[s.symbol,s.initial,minute,s.initial]);
  const q=await tx.get('SELECT * FROM stock_quotes WHERE symbol=?',[s.symbol]);
  if(q.minute<minute){const delta=randomInt(-100,101)/10000;const price=Math.max(1,Math.round(q.cents*(1+delta)));await tx.run('UPDATE stock_quotes SET cents=?,previous=cents,minute=? WHERE symbol=?',[price,minute,s.symbol]);}
 }
 return tx.all('SELECT * FROM stock_quotes');
}
async function updateBenefit(tx,id,s,now){
 const held=(await tx.get('SELECT COALESCE(SUM(shares),0) AS n FROM stock_positions WHERE user_id=? AND symbol=?',[id,s.symbol])).n;
 const blocks=s.days?increments(held,s.shares,s.symbol==='MCS'?10:50):Number(held>=s.shares);
 const old=await tx.get('SELECT * FROM stock_benefits WHERE user_id=? AND symbol=?',[id,s.symbol]);
 const today=s.days?Math.floor(now/86400):now/86400;
 if(!old)await tx.run('INSERT INTO stock_benefits(user_id,symbol,blocks,cycle_blocks,started_day) VALUES (?,?,?,?,?)',[id,s.symbol,blocks,blocks,today]);
 else if(blocks!==old.blocks){
  // Additional blocks wait for the next cycle. Reductions restart the reduced entitlement.
  const reset=blocks<old.blocks||old.blocks===0;
  await tx.run('UPDATE stock_benefits SET blocks=?,cycle_blocks=?,started_day=?,notified=? WHERE user_id=? AND symbol=?',[blocks,reset?blocks:old.cycle_blocks,reset?today:old.started_day,reset?0:old.notified,id,s.symbol]);
 }
}
async function state(tx,id,now=Math.floor(Date.now()/1000)){
 const q=await quotes(tx,now),positions=await tx.all('SELECT * FROM stock_positions WHERE user_id=? ORDER BY id DESC',[id]);
 for(const s of STOCKS){await updateBenefit(tx,id,s,now);const b=await tx.get('SELECT * FROM stock_benefits WHERE user_id=? AND symbol=?',[id,s.symbol]);if(s.days&&b.cycle_blocks&&Math.floor(now/86400)>=b.started_day+s.days&&!b.notified){await tx.run("INSERT INTO events(user_id,type,message) VALUES (?,'stocks',?)",[id,`A dividend from ${s.name} is available at /stocks.`]);await tx.run('UPDATE stock_benefits SET notified=1 WHERE user_id=? AND symbol=?',[id,s.symbol]);}}
 return {stocks:STOCKS.map(s=>({...s,...q.find(q=>q.symbol===s.symbol)})),positions,benefits:await tx.all('SELECT * FROM stock_benefits WHERE user_id=?',[id]),rewards:await tx.all('SELECT * FROM stock_property_rewards WHERE user_id=?',[id]),account:await tx.get('SELECT * FROM stock_accounts WHERE user_id=?',[id]),today:Math.floor(now/86400)};
}
async function action(tx,id,b,now=Math.floor(Date.now()/1000)){
 const u=await require('./db').getUser(id,tx);
 ensure(!u.in_hospital&&!u.in_jail&&u.travel.phase==='home'&&u.hp>0,'Stocks are unavailable while hospitalized, jailed, unconscious or traveling.');
 const {debit}=require('./homes');
 if(b.action==='ticker'){
  ensure(!(await tx.get('SELECT * FROM stock_accounts WHERE user_id=?',[id])),'You already own a Stock Ticker.');
  const paid=await tx.run('UPDATE casino_wallets SET points=points-50 WHERE user_id=? AND points>=50',[id]);ensure(paid.changes,'Buy 50 points at the Points Building first.');
  await tx.run('INSERT INTO stock_accounts(user_id) VALUES (?)',[id]);return {msg:'Stock Ticker purchased.'};
 }
 ensure(await tx.get('SELECT * FROM stock_accounts WHERE user_id=?',[id]),'A Stock Ticker is required.');
 const s=STOCKS.find(s=>s.symbol===b.symbol);ensure(s,'Unknown stock.');await state(tx,id,now);
 if(b.action==='claim'){
  const benefit=await tx.get('SELECT * FROM stock_benefits WHERE user_id=? AND symbol=?',[id,s.symbol]);ensure(s.days&&benefit.cycle_blocks&&Math.floor(now/86400)>=benefit.started_day+s.days,'Dividend is not ready.');
  const count=benefit.cycle_blocks,qty=count*s.amount;
  if(typeof s.reward==='number')await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[count*s.reward,id]);
  else if(['happy','energy','nerve'].includes(s.reward)){if(s.reward==='happy')await tx.run('INSERT INTO stock_resource_bonuses(user_id,happy_until) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET happy_until=excluded.happy_until',[id,(Math.floor(now/900)+1)*900]);const column=s.reward==='happy'?'happiness':s.reward;const cap=s.reward==='energy'?1000:s.reward==='happy'?99999:1000;await tx.run(`UPDATE users SET ${column}=MIN(?,${column}+?) WHERE id=?`,[cap,qty,id]);}
  else if(s.reward==='points')await tx.run('UPDATE casino_wallets SET points=points+? WHERE user_id=?',[qty,id]);
  else if(s.reward==='property'){
   const {HOMES}=require('./homes');for(let n=0;n<count;n++){const h=HOMES[randomInt(1,HOMES.length)];await tx.run('INSERT INTO stock_property_rewards(user_id,home_key) VALUES (?,?)',[id,h.key]);}
  }else{
   const catalogs=require('./item-catalog').CATALOGS;const normalize=s=>s.toLowerCase().replace(/[^a-z]/g,'');let item;
   for(const [type,items] of Object.entries(catalogs))for(const [key,i] of Object.entries(items))if(normalize(i.name)===normalize(s.reward))item={type,key};
   if(s.symbol==='LAG')item={type:'item',key:'torn_368'};
   if(s.symbol==='TCC')item={type:'item',key:['torn_1057','torn_1112','torn_1113','torn_1114','torn_1115','torn_1116','torn_1117'][randomInt(7)]};
   if(s.symbol==='BAG')item={type:'item',key:'stock_ammunition_pack'};
   ensure(item&&require('./item-catalog').getItem(item.type,item.key),'This dividend item is not available in the game catalog.');
   const row=await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_type=? AND item_key=?',[id,item.type,item.key]);if(row)await tx.run('UPDATE inventory SET quantity=quantity+? WHERE id=?',[count,row.id]);else await tx.run('INSERT INTO inventory(user_id,item_type,item_key,quantity) VALUES (?,?,?,?)',[id,item.type,item.key,count]);
  }
  await tx.run('UPDATE stock_benefits SET started_day=?,cycle_blocks=blocks,notified=0 WHERE user_id=? AND symbol=?',[Math.floor(now/86400),id,s.symbol]);return {msg:'Dividend collected.'};
 }
 if(b.action==='redeem-property'){
  const reward=await tx.get('SELECT * FROM stock_property_rewards WHERE id=? AND user_id=?',[whole(b.reward_id),id]);ensure(reward,'Property award not found.');ensure(!(await tx.get('SELECT 1 FROM owned_homes WHERE user_id=? AND home_key=?',[id,reward.home_key])),'You already own this type. Sell it before redeeming this deed.');await tx.run('INSERT INTO owned_homes(user_id,home_key) VALUES (?,?)',[id,reward.home_key]);await tx.run('DELETE FROM stock_property_rewards WHERE id=?',[reward.id]);return {msg:'Property deed redeemed.'};
 }
 const positions=await tx.all('SELECT * FROM stock_positions WHERE user_id=? AND symbol=? ORDER BY id DESC',[id,s.symbol]);
 if(b.action==='merge'){
  ensure(positions.length>1,'Two positions are required.');const shares=positions.reduce((n,p)=>n+p.shares,0),cost=positions.reduce((n,p)=>n+p.cost,0),date=Math.floor(positions.reduce((n,p)=>n+p.bought_at*p.shares,0)/shares);
  await tx.run('DELETE FROM stock_positions WHERE user_id=? AND symbol=?',[id,s.symbol]);await tx.run('INSERT INTO stock_positions(user_id,symbol,shares,cost,bought_at) VALUES (?,?,?,?,?)',[id,s.symbol,shares,cost,date]);return {msg:'Positions merged.'};
 }
 const quote=await tx.get('SELECT * FROM stock_quotes WHERE symbol=?',[s.symbol]);ensure(whole(b.quote)===quote.cents,'Price changed. Refresh and confirm the updated quote.');
 const n=whole(b.shares),gross=Math.ceil(n*quote.cents/100);ensure(Number.isSafeInteger(gross),'Order is too large.');
 if(b.action==='buy'){
  await debit(tx,id,gross);await tx.run('INSERT INTO stock_positions(user_id,symbol,shares,cost,bought_at) VALUES (?,?,?,?,?)',[id,s.symbol,n,gross,now]);
 }else if(b.action==='sell'){
  const eligible=b.position_id?positions.filter(p=>p.id===whole(b.position_id)):positions;
  ensure(eligible.reduce((n,p)=>n+p.shares,0)>=n,'Not enough shares.');let remaining=n,cost=0;
  for(const p of eligible){const take=Math.min(remaining,p.shares);const basis=take===p.shares?p.cost:p.cost*take/p.shares;cost+=basis;if(take===p.shares)await tx.run('DELETE FROM stock_positions WHERE id=?',[p.id]);else await tx.run('UPDATE stock_positions SET shares=shares-?,cost=cost-? WHERE id=?',[take,basis,p.id]);remaining-=take;if(!remaining)break;}
  const proceeds=Math.floor(n*quote.cents/100),fee=Math.ceil(proceeds*.001);
  await tx.run('UPDATE users SET cash=cash+? WHERE id=?',[proceeds-fee,id]);await tx.run('UPDATE stock_accounts SET profit=profit+?,fees=fees+? WHERE user_id=?',[proceeds-cost,fee,id]);
 }else throw new StockError('Unknown stock action.');
 await updateBenefit(tx,id,s,now);return {msg:'Trade completed.'};
}
module.exports={STOCKS,increments,hasBenefit,state,action,StockError};
