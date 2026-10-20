const {randomInt}=require('node:crypto');
const {records,ruleFor,BOOKS,STATS,DAY}=require('./item-uses');
const nowSeconds=()=>Math.floor(Date.now()/1000);
const draw=value=>Array.isArray(value)?randomInt(value[0],value[1]+1):value;
const MAX_CASH=9000000000000;
async function add(tx,id,key,quantity){
 const {CATALOGS}=require('./item-catalog');
 const type=Object.keys(CATALOGS).find(type=>Object.hasOwn(CATALOGS[type],key));
 if(!type)throw new Error('Unknown reward item: '+key);
 const owned=await tx.get('SELECT id FROM inventory WHERE user_id=? AND item_type=? AND item_key=? ORDER BY id',[id,type,key]);
 if(owned)await tx.run('UPDATE inventory SET quantity=quantity+? WHERE id=?',[quantity,owned.id]);
 else await tx.run('INSERT INTO inventory(user_id,item_type,item_key,quantity) VALUES(?,?,?,?)',[id,type,key,quantity]);
}
async function consume(tx,owned){
 const result=await tx.run('UPDATE inventory SET quantity=quantity-1 WHERE id=? AND quantity>0',[owned.id]);
 if(!result.changes)throw new Error('Item already consumed.');
 await tx.run('DELETE FROM inventory WHERE id=? AND quantity=0',[owned.id]);
}
async function keepHappy(tx,id,now){
 const until=(Math.floor(now/900)+1)*900;
 await tx.run('INSERT INTO stock_resource_bonuses(user_id,happy_until) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET happy_until=MAX(happy_until,excluded.happy_until)',[id,until]);
}
async function bookState(tx,id,now=nowSeconds()){
 const book=await tx.get('SELECT * FROM item_books WHERE user_id=?',[id]);
 return {book,modifiers:book&&book.ends_at>now?BOOKS[book.effect_id]||{}:{}};
}
async function settleBook(tx,u,now=nowSeconds()){
 const {book}=await bookState(tx,u.id,now);
 if(!book||book.ends_at>now||book.completed_at)return;
 const done=await tx.run('UPDATE item_books SET completed_at=? WHERE user_id=? AND completed_at IS NULL',[now,u.id]);
 if(!done.changes)return;
 const effect=BOOKS[book.effect_id]?.complete;
 if(effect?.stats)for(const stat of effect.stats){const gain=Math.min(effect.limit,u[stat]*effect.percent/100);u[stat]+=gain;await tx.run(`UPDATE users SET ${stat}=? WHERE id=?`,[u[stat],u.id]);}
 if(effect?.work){
  await workingProfile(tx,u.id,now);
  for(const stat of ['manual','intelligence','endurance'])await tx.run(`UPDATE company_profiles SET ${stat}=${stat}+MIN(?,${stat}*?/100) WHERE user_id=?`,[effect.limit,effect.work,u.id]);
 }
 await tx.run("INSERT INTO events(user_id,type,message) VALUES(?,'item',?)",[u.id,'Finished reading '+records.get(book.source_id).name.replace(/torn/gi,'Lock down')+'.']);
}
async function workingProfile(tx,id,now){await tx.run('INSERT OR IGNORE INTO company_profiles(user_id,last_action) VALUES(?,?)',[id,now]);}
function scaledStat(u,stat,percent){
 const key={strength:'_baseStrength',defense:'_baseDefense',speed:'_baseSpeed',dexterity:'_baseDexterity'}[stat];
 const gain=Math.max(0,u[key]??u[stat])*percent/100;u[stat]+=gain;return gain;
}
async function activeBonuses(tx,id,owned,now=nowSeconds()){
 const state=await bookState(tx,id,now),keys=new Set(owned.map(row=>row.item_key));
 const suitcase=keys.has('torn_421')?3:keys.has('torn_420')?2:keys.has('torn_419')?1:0;
 return {...state,modifiers:{...state.modifiers},suitcase,sneakers:keys.has('torn_386'),crimeTools:{pickpocket:keys.has('torn_567'),forge_docs:keys.has('torn_1346')},ticket:await tx.get('SELECT * FROM item_travel_tickets WHERE user_id=?',[id])};
}
async function cooldownDuration(tx,id,group,seconds,now){
 const {modifiers}=await bookState(tx,id,now);
 return Math.ceil(seconds*(modifiers.consumableCooldown||1)*(group==='medical'?(modifiers.medicalCooldown||1):1));
}
function allowedAt(group,ready,cap=86400){return group==='booster'?Math.max(0,ready-cap+1):ready;}
async function use(tx,user,item,owned,body={},saveUser,now=nowSeconds()){
 const r=ruleFor(item),outfit=['Clothing','Jewelry'].includes(item?.source_type);
 if(!r&&!outfit)return null;
 if(user.travel?.phase!=='home')return {error:'Return home before using items.'};
 if(outfit){
  if(user.in_hospital||user.in_jail)return {error:'Leave hospital or jail before changing your outfit.'};
  const worn=await tx.get('SELECT item_key FROM item_outfits WHERE user_id=? AND item_key=?',[user.id,owned.item_key]);
  if(worn)await tx.run('DELETE FROM item_outfits WHERE user_id=? AND item_key=?',[user.id,owned.item_key]);
  else await tx.run('INSERT INTO item_outfits(user_id,item_key) VALUES(?,?)',[user.id,owned.item_key]);
  return {msg:(worn?'Removed ':'Wearing ')+item.name+'. Cosmetic clothing does not add combat stats.'};
 }
 if(user.in_hospital||user.in_jail){
  if(!(user.in_jail&&!user.in_hospital&&['jail','escapeCake'].includes(r.kind)))return {error:r.group==='booster'?'Boosters cannot be used in hospital or jail.':'Leave hospital or jail before using this item.'};
 }
 if(r.kind==='drug'&&(user.medical?.radiation_until||0)>now)return {error:'Drugs cannot be used while suffering radiation poisoning.'};
 const timer=r.group?await tx.get('SELECT ready_at FROM recovery_cooldowns WHERE user_id=? AND category=?',[user.id,r.group]):null;
 if(r.group&&allowedAt(r.group,timer?.ready_at||0)>now)return {error:r.group+' cooldown: wait before using another item.'};
 const duration=r.group?await cooldownDuration(tx,user.id,r.group,r.duration,now):0;
 const modifiers=user.itemBonuses?.modifiers||{};
 let consumeItem=true,msg='Used '+item.name+'.',changed=true,save=true;
 const grant=(stat,amount)=>{
  const cap={energy:1000,nerve:1000,happiness:99999}[stat];
  if(!cap)throw new Error('Unknown resource.');
  const previous=user[stat];user[stat]=Math.max(0,Math.min(cap,user[stat]+amount));return user[stat]!==previous;
 };
 if(r.kind==='resource'){
  const multiplier=item.source_type==='Alcohol'?(modifiers.alcohol||1):item.source_type==='Energy Drink'?(modifiers.energyDrink||1):item.source_type==='Candy'?(modifiers.candy||1):1;
  changed=grant(r.stat,r.amount*multiplier);
 }else if(r.kind==='stat'){
  changed=r.stats.reduce((sum,stat)=>sum+scaledStat(user,stat,r.percent),0)>0;
 }else if(r.kind==='hotel'){
  changed=user.energy<user.max_energy||user.happiness<99999;
  user.energy=Math.max(user.energy,user.max_energy);grant('happiness',500);
 }else if(r.kind==='jail'||r.kind==='escapeCake'){
  if(!user.in_jail)return {error:'You are not in jail. Item kept.'};
  user.in_jail=0;user.jail_until=0;user.jail_reason=null;
 }else if(r.kind==='life'){
  if(user.hp>=user.max_hp*3)return {error:'Your life is already at three times its maximum. Item kept.'};
  user.hp=user.max_hp*3;
  await tx.run('INSERT INTO item_overlife(user_id,until_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET until_at=excluded.until_at',[user.id,(Math.floor(now/900)+1)*900]);
 }else if(r.kind==='addiction'){
  await workingProfile(tx,user.id,now);
  const p=await tx.get('SELECT addiction FROM company_profiles WHERE user_id=?',[user.id]);
  if(!p.addiction)return {error:'You have no addiction to reduce. Item kept.'};
  await tx.run('UPDATE company_profiles SET addiction=addiction/2 WHERE user_id=?',[user.id]);
 }else if(r.kind==='workStats'){
  await workingProfile(tx,user.id,now);
  await tx.run('UPDATE company_profiles SET manual=manual*1.01,intelligence=intelligence*1.01,endurance=endurance*1.01 WHERE user_id=?',[user.id]);
 }else if(r.kind==='education'){
  const course=await tx.get('SELECT * FROM education WHERE user_id=? AND completed_at IS NULL',[user.id]);
  if(!course||course.finishes_at<=now)return {error:'You need an unfinished education course. Item kept.'};
  await tx.run('UPDATE education SET finishes_at=MAX(?,finishes_at-21600) WHERE user_id=? AND course_key=?',[now,user.id,course.course_key]);
 }else if(r.kind==='drug'){
  const before=JSON.stringify([user.energy,user.nerve,user.happiness]);
  for(const [stat,amount] of Object.entries(r.resources||{}))grant(stat,draw(amount));
  if(r.doubleHappy)user.happiness=Math.min(99999,user.happiness*2);
  if(r.buff)await tx.run('INSERT INTO item_drug_effects(user_id,source_id,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET source_id=excluded.source_id,expires_at=excluded.expires_at',[user.id,item.source_id,now+duration]);
  changed=!!r.buff||before!==JSON.stringify([user.energy,user.nerve,user.happiness]);
 }else if(r.kind==='entertainment'){
  if(user.energy<5)return {error:'You need 5 energy. Item kept.'};
  if(user.happiness>=user.max_happiness)return {error:'Your happiness is already full. Item kept.'};
  user.energy-=5;user.happiness=Math.min(user.max_happiness,user.happiness+randomInt(8,16));consumeItem=false;
 }else if(r.kind==='tissues'){
  if(user.happiness>=user.max_happiness*.2)return {error:'Use tissues when happiness is below 20% of maximum. Item kept.'};
  grant('happiness',randomInt(5,21));
 }else if(r.kind==='casino'){
  const wallet=await require('./casino').wallet(tx,user.id);
  if(wallet.tokens>25)return {error:'Spend Casino Tokens down to 25 or fewer before redeeming 50; your wallet holds 75. Pass kept.'};
  await tx.run('UPDATE casino_wallets SET tokens=tokens+50 WHERE user_id=?',[user.id]);
 }else if(['pack','bundle','goodie'].includes(r.kind)){
  const rewards=new Map();
  if(r.kind==='pack'){const choice=r.choices[randomInt(r.choices.length)];rewards.set(choice[0],choice[1]);}
  else {
   const pool=[...records.values()].filter(row=>r.kind==='goodie'?['Candy','Alcohol','Energy Drink'].includes(row.type):row.type===r.category).filter(row=>row.id!==816&&row.id!==985&&row.id!==986&&row.id!==987);
   if(!pool.length)throw new Error('Empty supply reward pool.');
   const count=r.kind==='goodie'?30:r.count;
   // A six-pack contains six of one drink/candy; goodie bags contain an assortment.
   if(r.kind==='bundle')rewards.set('torn_'+pool[randomInt(pool.length)].id,count);
   else for(let i=0;i<count;i++){const key='torn_'+pool[randomInt(pool.length)].id;rewards.set(key,(rewards.get(key)||0)+1);}
  }
  for(const [key,n] of rewards)await add(tx,user.id,key,n);
  msg='Opened '+item.name+': '+[...rewards].map(([key,n])=>n+' × '+records.get(Number(key.slice(5))).name.replace(/torn/gi,'Lock down')).join(', ')+'.';
 }else if(r.kind==='lottery'){
  await require('./casino').settleLottery(tx);
  const day=new Date(now*1000).toISOString().slice(0,10);
  await tx.run('INSERT OR IGNORE INTO casino_lotteries(day) VALUES(?)',[day]);
  for(let i=0;i<100;i++)await tx.run('INSERT INTO casino_tickets(day,user_id) VALUES(?,?)',[day,user.id]);
  msg='Redeemed 100 tickets for the current Lockdown daily lottery.';
 }else if(r.kind==='donator'){
  await require('./casino').wallet(tx,user.id);
  await tx.run('UPDATE casino_wallets SET points=points+60 WHERE user_id=?',[user.id]);
  await tx.run('INSERT INTO item_donator(user_id,until_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET until_at=MAX(until_at,?)+?',[user.id,now+31*DAY,now,31*DAY]);
  msg='Added 60 points and 31 days of donator status.';
 }else if(r.kind==='book'){
  const previous=(await bookState(tx,user.id,now)).book;
  if(previous?.ends_at>now)return {error:'Finish reading your current book first. Item kept.'};
  const eye=await tx.get("SELECT id FROM inventory WHERE user_id=? AND item_key='torn_1170' AND quantity>0",[user.id]);
  if(!eye&&await tx.get('SELECT source_id FROM item_books_read WHERE user_id=? AND source_id=?',[user.id,item.source_id]))return {error:'You have already read this book. Item kept.'};
  const effect=item.source_id===785?previous?.effect_id:item.source_id;
  if(!BOOKS[effect])return {error:'No previous supported book effect to repeat. Item kept.'};
  await tx.run('INSERT INTO item_books(user_id,source_id,effect_id,started_at,ends_at,completed_at) VALUES(?,?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET source_id=excluded.source_id,effect_id=excluded.effect_id,started_at=excluded.started_at,ends_at=excluded.ends_at,completed_at=NULL',[user.id,item.source_id,effect,now,now+31*DAY]);
  await tx.run('INSERT OR IGNORE INTO item_books_read(user_id,source_id) VALUES(?,?)',[user.id,item.source_id]);
  msg='Started '+item.name+'. Reading lasts 31 days; permanent gains apply on completion.';
 }else if(r.kind==='fruitcake'){
  const ingredients=[];
  for(const key of ['torn_560','torn_793','torn_794']){
   const ingredient=await tx.get("SELECT * FROM inventory WHERE user_id=? AND item_key=? AND quantity>0 ORDER BY id",[user.id,key]);
   if(!ingredient)return {error:'Combine one Fruitcake, Cake Frosting and Lock Picking Kit. Ingredients kept.'};ingredients.push(ingredient);
  }
  for(const ingredient of ingredients)await consume(tx,ingredient);
  await add(tx,user.id,'torn_795',1);consumeItem=false;msg='Combined the ingredients into a Special Fruitcake.';
 }else if(r.kind==='piggy'){
  const action=body.action,amount=Number(body.amount),saved=(await tx.get('SELECT amount FROM item_piggy_banks WHERE user_id=?',[user.id]))?.amount||0;
  if(action==='deposit'){
   if(!Number.isSafeInteger(amount)||amount<1||amount>user.cash||saved+amount>MAX_CASH)return {error:'Enter an affordable whole cash amount to deposit.'};
   user.cash-=amount;
   await tx.run('INSERT INTO item_piggy_banks(user_id,amount) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET amount=amount+excluded.amount',[user.id,amount]);
   consumeItem=false;msg='Saved $'+amount.toLocaleString()+' in your piggy bank.';
  }else if(action==='break'){
   if(!saved)return {error:'Your piggy bank is empty. Item kept.'};
   if(user.cash+saved>MAX_CASH)return {error:'Cash limit reached. Bank some cash first.'};
   user.cash+=saved;await tx.run('DELETE FROM item_piggy_banks WHERE user_id=?',[user.id]);msg='Broke the piggy bank and withdrew $'+saved.toLocaleString()+'.';
  }else return {error:'Choose Deposit or Break piggy bank.'};
 }else if(r.kind==='ticket'){
  // The ticket is bound to the next return trip only after activation.
  if(await tx.get('SELECT user_id FROM item_travel_tickets WHERE user_id=?',[user.id]))return {error:'You already have a business-class ticket ready. Item kept.'};
  await tx.run('INSERT INTO item_travel_tickets(user_id) VALUES(?)',[user.id]);msg='Business class is ready for your next return trip: 70% shorter flights, 15 base cargo slots.';
 }else if(r.kind==='target'){
  const id=Number(body.target_id);
  if(!Number.isSafeInteger(id)||id===user.id)return {error:'Choose another player by ID.'};
  const target=await tx.get('SELECT * FROM users WHERE id=?',[id]);
  if(!target)return {error:'Player not found. Item kept.'};
  if(await tx.get('SELECT id FROM travel_trips WHERE user_id=? AND completed_at IS NULL',[id]))return {error:'That player is away. Item kept.'};
  const loss=r.factor?Math.floor(Math.max(0,target.happiness)*r.factor):0;
  if(!r.happy&&!loss)return {error:'That player has no happiness to remove. Item kept.'};
  await tx.run('UPDATE users SET happiness=MIN(99999,MAX(0,happiness-?)+?) WHERE id=?',[loss,r.happy||0,id]);
  if(r.happy)await keepHappy(tx,id,now);
  if(r.steal)grant('happiness',loss);
  await tx.run("INSERT INTO events(user_id,type,message) VALUES(?,'item',?)",[id,user.username+' used '+item.name+' on you.']);
  msg='Used '+item.name+' on '+target.username+'.';
 }else if(r.kind==='mirror'){
  const clothes=await tx.all('SELECT o.item_key FROM item_outfits o WHERE o.user_id=? AND EXISTS(SELECT 1 FROM inventory i WHERE i.user_id=o.user_id AND i.item_key=o.item_key AND i.quantity>0)',[user.id]);
  msg='Your outfit: '+(clothes.map(c=>records.get(Number(c.item_key.slice(5)))?.name.replace(/torn/gi,'Lock down')).filter(Boolean).join(', ')||'No accessories or clothing selected')+'.';consumeItem=false;save=false;
 }else throw new Error('Unhandled item rule.');
 if(!changed)return {error:'Your resources are already full. Item kept.'};
 if(user.happiness>user.max_happiness)await keepHappy(tx,user.id,now);
 if(consumeItem)await consume(tx,owned);
 let readyAt;
 if(r.group){
  readyAt=Math.max(now,timer?.ready_at||0)+duration;
  await tx.run('INSERT INTO recovery_cooldowns(user_id,category,ready_at) VALUES(?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET ready_at=excluded.ready_at',[user.id,r.group,readyAt]);
 }
 if(save)await saveUser(user,tx.run);
 await tx.run("INSERT INTO events(user_id,type,message) VALUES(?,'item',?)",[user.id,msg]);
 return {msg,category:r.group,readyAt,availableAt:r.group?allowedAt(r.group,readyAt):undefined};
}
async function fundedPiggy(tx,id,key){return key==='torn_820'&&!!(await tx.get('SELECT amount FROM item_piggy_banks WHERE user_id=? AND amount>0',[id]));}
module.exports={use,add,consume,keepHappy,bookState,settleBook,activeBonuses,cooldownDuration,allowedAt,fundedPiggy};
