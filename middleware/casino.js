const {randomInt}=require('node:crypto');
const {getUser}=require('./db');
const {getItem}=require('./item-catalog');
const games=require('./casino-games');
const LEVELS={bookie:2,lottery:3,blackjack:4,poker:5,roulette:6,wheel:7,slots:8,craps:8,highlow:8};
const AWARDS={
 bookie_10:'Bookmaker: place 10 sports bets',bookie_100:'Sports Regular: place 100 sports bets',
 lottery_win:'Lucky Ticket: win a lottery',blackjack_natural:'Natural Talent: win with a natural',
 blackjack_double:'Double Trouble: win a double down',blackjack_charlie:'Five Alive: win with five cards',
 blackjack_insurance:'Covered: win an insurance bet',poker_score:'Card Shark: reach 10,000,000 poker score',
 roulette_50:'Last Standing: win 50 Russian Roulette matches',wheel_1000:'Wheel Veteran: spin 1,000 times',
 slots_jackpot:'Jackpot: match three diamonds',highlow_25:'High Roller: reach a 25-win High-Low streak'
};
const dayOf=now=>new Date(now).toISOString().slice(0,10);
const seconds=()=>Math.floor(Date.now()/1000);
function ensure(condition,message){if(!condition)throw new CasinoError(message);}
class CasinoError extends Error{}
function amount(v,min=10,max=1000000){ensure(Number.isSafeInteger(v)&&v>=min&&v<=max,'Enter a whole cash amount from $'+min+' to $'+max+'.');return v;}
async function wallet(tx,id,now=Date.now()){
 const day=dayOf(now);
 await tx.run('INSERT OR IGNORE INTO casino_wallets (user_id,day) VALUES (?,?)',[id,day]);
 await tx.run('UPDATE casino_wallets SET tokens=75,day=? WHERE user_id=? AND day<>?',[day,id,day]);
 return tx.get('SELECT * FROM casino_wallets WHERE user_id=?',[id]);
}
async function tokens(tx,id,n=1){const r=await tx.run('UPDATE casino_wallets SET tokens=tokens-? WHERE user_id=? AND tokens>=?',[n,id,n]);ensure(r.changes,'Not enough Casino Tokens.');}
async function cash(tx,id,delta,note){
 ensure(Number.isSafeInteger(delta),'Invalid payout.');
 const r=await tx.run('UPDATE users SET cash=cash+? WHERE id=? AND cash+? BETWEEN 0 AND 9000000000000',[delta,id,delta]);ensure(r.changes,delta<0?'Not enough cash.':'Cash balance limit reached.');
 await tx.run("INSERT INTO transaction_logs (type,to_id,cash_amount,note) VALUES ('casino',?,?,?)",[id,delta,note]);
}
async function award(tx,id,key){
 const r=await tx.run('INSERT OR IGNORE INTO casino_awards (user_id,award,earned_at) VALUES (?,?,?)',[id,key,seconds()]);
 if(r.changes)await tx.run("INSERT INTO events (user_id,type,message) VALUES (?,'casino_award',?)",[id,'Casino award earned: '+AWARDS[key]]);
}
async function stat(tx,id,key,n=1){
 await tx.run('INSERT INTO casino_stats (user_id,stat,value) VALUES (?,?,?) ON CONFLICT(user_id,stat) DO UPDATE SET value=value+excluded.value',[id,key,n]);
 const v=(await tx.get('SELECT value FROM casino_stats WHERE user_id=? AND stat=?',[id,key])).value;
 if(key==='roulette_wins'&&v>=50)await award(tx,id,'roulette_50');
 if(key==='wheel_spins'&&v>=1000)await award(tx,id,'wheel_1000');
 if(key==='poker_score'&&v>=10000000)await award(tx,id,'poker_score');
 if(key==='bookie_bets'&&v>=10)await award(tx,id,'bookie_10');
 if(key==='bookie_bets'&&v>=100)await award(tx,id,'bookie_100');
}
async function gate(tx,id,game){
 ensure(Object.hasOwn(LEVELS,game),'Unknown casino game.');
 const user=await getUser(id,tx);
 ensure(user.level>=LEVELS[game],'Unlocks at level '+LEVELS[game]+'.');
 ensure(user.travel.phase==='home','Return home to use the casino.');
 ensure(!user.in_jail&&!user.in_hospital,'Leave jail or hospital before playing.');
 await wallet(tx,id);
 return user;
}
async function round(tx,id,game){const row=await tx.get('SELECT * FROM casino_rounds WHERE user_id=? AND game=? AND active=1',[id,game]);ensure(row,'No active '+game+' round.');return {...row,data:JSON.parse(row.state)};}
async function saveRound(tx,row,active=1){await tx.run('UPDATE casino_rounds SET state=?,active=? WHERE id=?',[JSON.stringify(row.data),active,row.id]);}
async function newRound(tx,id,game,state){
 ensure(!await tx.get('SELECT id FROM casino_rounds WHERE user_id=? AND game=? AND active=1',[id,game]),'Finish your current '+game+' round first.');
 const r=await tx.run('INSERT INTO casino_rounds (user_id,game,state,created_at) VALUES (?,?,?,?)',[id,game,JSON.stringify(state),seconds()]);
 return {id:r.lastID,user_id:id,game,data:state};
}
function publicRound(row){
 const d=row.data;
 if(row.game==='blackjack')return {game:row.game,bet:d.bet,player:d.player,dealer:d.finished?d.dealer:[d.dealer[0]],total:games.total(d.player),insurance:d.insurance,canInsure:!d.acted&&d.dealer[0].rank===14&&!d.insurance,canDouble:!d.acted,result:d.result};
 if(row.game==='highlow')return {game:row.game,card:d.card,streak:d.streak,bank:d.bank,result:d.result};
}
async function blackjackFinish(tx,row){
 const d=row.data;let payout=0;
 if(!d.insuranceSettled&&d.insurance){
  if(games.natural(d.dealer)){await cash(tx,row.user_id,d.insurance*3,'Blackjack insurance payout');await award(tx,row.user_id,'blackjack_insurance');}
  d.insuranceSettled=true;
 }
 const pt=games.total(d.player),dt=games.total(d.dealer);
 if(games.natural(d.dealer)){payout=games.natural(d.player)?d.bet:0;d.result=payout?'Push against dealer natural.':'Dealer has blackjack.';}
 else if(games.natural(d.player)){payout=d.bet*2.5;d.result='Natural blackjack!';await award(tx,row.user_id,'blackjack_natural');}
 else if(pt>21){d.result='Bust.';}
 else if(d.player.length>=5){payout=d.bet*2;d.result='Five-card Charlie!';await award(tx,row.user_id,'blackjack_charlie');}
 else if(dt>21||pt>dt){payout=d.bet*2;d.result=dt>21?'Dealer busts. You win!':'You win!';}
 else if(pt===dt){payout=d.bet;d.result='Push: stake returned.';}
 else d.result='Dealer wins.';
 if(payout)await cash(tx,row.user_id,payout,'Blackjack payout');
 if(d.doubled&&payout>d.bet)await award(tx,row.user_id,'blackjack_double');
 d.finished=true;d.payout=payout;await saveRound(tx,row,0);
 return {msg:d.result,payout,round:publicRound(row),finished:true};
}
async function blackjack(tx,id,b){
 if(b.move==='start'){
  const bet=amount(b.bet);ensure(bet%2===0,'Blackjack wagers must be even for 3:2 payouts.');
  ensure(!await tx.get("SELECT id FROM casino_rounds WHERE user_id=? AND game='blackjack' AND active=1",[id]),'Finish your current blackjack hand first.');
  await cash(tx,id,-bet,'Blackjack wager');await tokens(tx,id);
  const deck=games.shuffledDeck(),player=[deck.pop(),deck.pop()],dealer=[deck.pop(),deck.pop()];
  const row=await newRound(tx,id,'blackjack',{bet,deck,player,dealer,acted:false,insurance:0});
  if(dealer[0].rank!==14&&(games.natural(player)||games.natural(dealer)))return blackjackFinish(tx,row);
  return {msg:'Choose hit, stand, double down or insurance.',round:publicRound(row)};
 }
 const row=await round(tx,id,'blackjack'),d=row.data;
 if(b.move==='insurance'){
  ensure(!d.acted&&!d.insurance&&d.dealer[0].rank===14,'Insurance is only available before your first move against an ace.');
  d.insurance=d.bet/2;await cash(tx,id,-d.insurance,'Blackjack insurance');
  if(games.natural(d.dealer)||games.natural(d.player))return blackjackFinish(tx,row);
  // An insurance action reveals only whether insurance paid; never the hidden card.
  d.insuranceSettled=true;await saveRound(tx,row);return {msg:'Dealer has no blackjack. Insurance lost; continue the hand.',round:publicRound(row)};
 }
 ensure(['hit','stand','double'].includes(b.move),'Choose a valid blackjack action.');
 if(games.natural(d.dealer)||games.natural(d.player))return blackjackFinish(tx,row);
 if(b.move==='double'){ensure(!d.acted,'Double down is only available on your first move.');await cash(tx,id,-d.bet,'Blackjack double down');d.bet*=2;d.doubled=true;}
 d.acted=true;
 if(b.move!=='stand')d.player.push(d.deck.pop());
 if(games.total(d.player)>21||d.player.length>=5)return blackjackFinish(tx,row);
 if(b.move==='stand'||b.move==='double'){
  while(games.total(d.dealer)<17)d.dealer.push(d.deck.pop());
  return blackjackFinish(tx,row);
 }
 await saveRound(tx,row);return {msg:'Hit or stand?',round:publicRound(row)};
}
async function highlow(tx,id,b){
 if(b.move==='start'){
  const bet=amount(b.bet);ensure(bet%2===0,'Use an even wager.');
  ensure(!await tx.get("SELECT id FROM casino_rounds WHERE user_id=? AND game='highlow' AND active=1",[id]),'Cash out or finish your current High-Low run.');
  await tokens(tx,id);await cash(tx,id,-bet,'High-Low wager');
  const row=await newRound(tx,id,'highlow',{card:randomInt(13)+2,streak:0,bank:bet});
  return {msg:'Guess higher or lower. A tie loses. Cash out any time.',round:publicRound(row)};
 }
 const row=await round(tx,id,'highlow'),d=row.data;
 if(b.move==='cashout'){await cash(tx,id,d.bank,'High-Low cash out');await saveRound(tx,row,0);return {msg:'Cashed out $'+d.bank+'.',finished:true,payout:d.bank};}
 ensure(['higher','lower'].includes(b.move),'Choose higher, lower or cash out.');
 const next=randomInt(13)+2,won=b.move==='higher'?next>d.card:next<d.card;
 d.previous=d.card;d.card=next;
 if(!won){d.bank=0;d.result='Lost: next card was '+next+'.';await saveRound(tx,row,0);return {msg:d.result,round:publicRound(row),finished:true};}
 // Fixed modest growth prevents low-risk edge-card guesses creating an infinite payout.
 d.streak++;d.bank=Math.min(100000000,Math.floor(d.bank*1.1));
 if(d.streak>=25)await award(tx,id,'highlow_25');
 if(d.streak>=25||d.bank>=100000000){await cash(tx,id,d.bank,'High-Low automatic cash out');await saveRound(tx,row,0);return {msg:'Run complete. Paid $'+d.bank+'.',finished:true,payout:d.bank};}
 await saveRound(tx,row);return {msg:'Correct! Cash out or keep going.',round:publicRound(row)};
}
async function simple(tx,id,game,b){
 const bet=game==='wheel'?1000:amount(b.bet);ensure(bet%2===0,'Use an even wager.');
 if(game==='wheel'){
  const today=dayOf(Date.now()),used=await tx.get("SELECT id FROM casino_rounds WHERE user_id=? AND game='wheel' AND state=?",[id,today]);
  ensure(!used,'You have already spun today. Come back after midnight UTC.');
  await tx.run("INSERT INTO casino_rounds (user_id,game,state,active,created_at) VALUES (?,'wheel',?,0,?)",[id,today,seconds()]);
 }
 await tokens(tx,id);await cash(tx,id,-bet,game+' wager');
 let payout=0,result;
 if(game==='slots'){result=games.slots();payout=bet*result.multiplier;if(result.jackpot)await award(tx,id,'slots_jackpot');}
 if(game==='craps'){result=games.craps();payout=result.won?bet*2:0;}
 if(game==='wheel'){const prizes=[0,0,0,0,500,500,1000,1000,2000,5000];const index=randomInt(prizes.length);payout=prizes[index];result={segment:index+1,prize:payout};await stat(tx,id,'wheel_spins');}
 if(payout)await cash(tx,id,payout,game+' payout');
 return {msg:payout?'Returned $'+payout+' on a $'+bet+' wager.':'No payout this time.',payout,result,finished:true};
}
async function settleLottery(tx,now=Date.now(),random=randomInt){
 const today=dayOf(now),draws=await tx.all("SELECT * FROM casino_lotteries WHERE day<? AND status='open'",[today]);
 for(const draw of draws){
  const tickets=await tx.all('SELECT user_id FROM casino_tickets WHERE day=? ORDER BY id',[draw.day]);
  let winner=null,prize=0;
  if(tickets.length){winner=tickets[random(tickets.length)].user_id;prize=Math.floor(draw.pot*.9);await cash(tx,winner,prize,'Lottery draw '+draw.day);await award(tx,winner,'lottery_win');}
  await tx.run("UPDATE casino_lotteries SET status='drawn',winner_id=?,prize=? WHERE day=?",[winner,prize,draw.day]);
 }
}
async function lottery(tx,id){
 const today=dayOf(Date.now());
 const held=await tx.get('SELECT COUNT(*) AS n FROM casino_tickets WHERE user_id=? AND day=?',[id,today]);ensure(held.n<10,'Maximum 10 tickets per day.');
 await tokens(tx,id);await cash(tx,id,-1000,'Lottery ticket');
 await tx.run('INSERT OR IGNORE INTO casino_lotteries (day) VALUES (?)',[today]);
 await tx.run('UPDATE casino_lotteries SET pot=pot+1000 WHERE day=?',[today]);
 await tx.run('INSERT INTO casino_tickets (day,user_id) VALUES (?,?)',[today,id]);
 return {msg:'Ticket purchased for tonight’s UTC draw. 90% of ticket sales go to one winner.'};
}
async function finishTable(tx,t,winner,reason){
 const state=JSON.parse(t.state);
 if(winner){
  const payout=Math.floor(t.stake*2*.95);
  await cash(tx,winner,payout,t.game+' table #'+t.id+' payout');
  if(t.game==='poker')await stat(tx,winner,'poker_score',payout-t.stake);
  else await stat(tx,winner,'roulette_wins');
  state.winner=winner;state.payout=payout;
 }else{
  await cash(tx,t.host_id,t.stake,'Table #'+t.id+' refund');
  if(t.guest_id)await cash(tx,t.guest_id,t.stake,'Table #'+t.id+' refund');
  state.payout=t.stake;
 }
 state.result=reason;
 await tx.run("UPDATE casino_tables SET status='finished',state=? WHERE id=?",[JSON.stringify(state),t.id]);
}
async function expireTables(tx){
 const tables=await tx.all("SELECT * FROM casino_tables WHERE status IN ('waiting','playing') AND expires_at<=?",[seconds()]);
 for(const t of tables){
  const d=JSON.parse(t.state);
  const winner=t.status==='playing'&&(Boolean(d.hostDone)!==Boolean(d.guestDone))?(d.hostDone?t.host_id:t.guest_id):null;
  await finishTable(tx,t,winner,winner?'Opponent timed out.':'Table expired; stakes refunded.');
 }
}
async function tableAction(tx,id,game,b){
 if(b.move==='create'){
  const stake=amount(b.bet,100,1000000);
  ensure(!await tx.get("SELECT id FROM casino_tables WHERE (host_id=? OR guest_id=?) AND status IN ('waiting','playing')",[id,id]),'Finish or cancel your current multiplayer table first.');
  await cash(tx,id,-stake,game+' table escrow');
  if(game==='roulette')await tokens(tx,id);
  const r=await tx.run("INSERT INTO casino_tables (game,host_id,stake,status,state,created_at,expires_at) VALUES (?,?,?,'waiting','{}',?,?)",[game,id,stake,seconds(),seconds()+86400]);
  return {msg:'Table #'+r.lastID+' opened. Your stake is held until another player joins, or you cancel. Russian Roulette tokens are not refunded.'};
 }
 ensure(Number.isSafeInteger(b.table_id)&&b.table_id>0,'Choose a table.');
 const t=await tx.get('SELECT * FROM casino_tables WHERE id=?',[b.table_id]);ensure(t&&t.game===game,'Table not found.');
 if(b.move==='cancel'){
  ensure(t.host_id===id&&t.status==='waiting','Only the host can cancel an empty table.');
  await finishTable(tx,t,null,'Host cancelled. Stake refunded.');return {msg:'Table cancelled; cash refunded.'};
 }
 if(b.move==='join'){
  ensure(t.status==='waiting'&&t.host_id!==id,'This table is unavailable.');
  ensure(!await tx.get("SELECT id FROM casino_tables WHERE (host_id=? OR guest_id=?) AND status IN ('waiting','playing')",[id,id]),'Finish your current table first.');
  await cash(tx,id,-t.stake,game+' table escrow');
  if(game==='roulette')await tokens(tx,id);
  t.guest_id=id;
  if(game==='roulette'){
   // Six chambers, alternating trigger pulls; one live chamber, no physical harm.
   const chamber=randomInt(6),winner=chamber%2===0?id:t.host_id;
   const d={chamber:chamber+1};t.state=JSON.stringify(d);
   await tx.run('UPDATE casino_tables SET guest_id=? WHERE id=?',[id,t.id]);
   await finishTable(tx,t,winner,'Chamber '+(chamber+1)+': '+(winner===id?'guest':'host')+' wins the cash pot.');
  }else{
   const deck=games.shuffledDeck(),host=deck.splice(0,5),guest=deck.splice(0,5);
   await tx.run("UPDATE casino_tables SET guest_id=?,status='playing',state=?,expires_at=? WHERE id=?",[id,JSON.stringify({deck,host,guest,hostDone:false,guestDone:false}),seconds()+600,t.id]);
  }
  return {msg:game==='roulette'?'Russian Roulette settled. See the table result.':'Deal complete. Choose cards to hold, then draw once.'};
 }
 ensure(game==='poker'&&b.move==='draw'&&t.status==='playing','Choose a valid table action.');
 ensure(id===t.host_id||id===t.guest_id,'You are not seated at this table.');
 const d=JSON.parse(t.state),side=id===t.host_id?'host':'guest';
 ensure(!d[side+'Done'],'You have already drawn.');
 ensure(Array.isArray(b.hold)&&b.hold.length<=5&&new Set(b.hold).size===b.hold.length&&b.hold.every(n=>Number.isInteger(n)&&n>=0&&n<5),'Choose card indexes from 0 to 4.');
 d[side]=d[side].map((card,i)=>b.hold.includes(i)?card:d.deck.pop());d[side+'Done']=true;
 if(d.hostDone&&d.guestDone){
  const h=games.pokerScore(d.host),g=games.pokerScore(d.guest);
  t.state=JSON.stringify(d);
  await finishTable(tx,t,h===g?null:h>g?t.host_id:t.guest_id,h===g?'Tie: both stakes returned.':h>g?'Host wins.':'Guest wins.');
 }else await tx.run('UPDATE casino_tables SET state=? WHERE id=?',[JSON.stringify(d),t.id]);
 return {msg:'Cards drawn. Waiting for the other player if necessary.'};
}
async function refill(tx,id,b){
 const w=await wallet(tx,id),today=dayOf(Date.now());ensure(w.tokens<75,'Your Casino Tokens are already full.');
 if(b.method==='points'){
  ensure(w.points_refill_day!==today,'Point refill already used today.');ensure(w.points>=30,'You need 30 points.');
  await tx.run('UPDATE casino_wallets SET tokens=75,points=points-30,points_refill_day=? WHERE user_id=?',[today,id]);
 }else if(b.method==='pass'){
  const pass=await tx.get("SELECT id FROM inventory WHERE user_id=? AND item_key='torn_428' AND item_type='item' AND quantity>0 ORDER BY id LIMIT 1",[id]);
  ensure(pass&&getItem('item','torn_428')?.name==='Casino Pass','You need a Casino Pass in Items.');
  ensure(w.tokens<=25,'Spend Casino Tokens down to 25 or fewer before redeeming 50.');
  await tx.run('UPDATE inventory SET quantity=quantity-1 WHERE id=? AND quantity>0',[pass.id]);
  await tx.run('UPDATE casino_wallets SET tokens=tokens+50 WHERE user_id=?',[id]);
  return {msg:'Casino Pass redeemed: +50 Casino Tokens.'};
 }else if(b.method==='job'){
  const user=await tx.get('SELECT job_key,job_prison_id,prison_id FROM users WHERE id=?',[id]);
  ensure(user.job_key==='gaming_consultant'&&user.job_prison_id===user.prison_id,'This special requires the Gaming Consultant job.');
  ensure(w.job_refill_day!==today,'Job special already used today.');
  await tx.run('UPDATE casino_wallets SET tokens=75,job_refill_day=? WHERE user_id=?',[today,id]);
 }else throw new CasinoError('Choose points, pass or job.');
 return {msg:'Casino Tokens refilled to 75.'};
}
async function sportsBet(tx,id,b){
 const event=await tx.get("SELECT * FROM casino_sports WHERE id=? AND status='open' AND starts_at>?",[String(b.event_id),seconds()]);
 ensure(event,'This event is closed or unavailable.');
 const selection=JSON.parse(event.options).find(o=>o.id===b.selection);ensure(selection,'Choose an available selection.');
 const bet=amount(b.bet);await cash(tx,id,-bet,'Bookie wager: '+event.title);await tokens(tx,id);
 await tx.run('INSERT INTO casino_sports_bets (event_id,user_id,selection,stake,odds) VALUES (?,?,?,?,?)',[event.id,id,selection.id,bet,selection.odds]);
 await stat(tx,id,'bookie_bets');return {msg:'Bet placed. Your odds are locked until official settlement.'};
}
// Only called by the local operator import command, never by a public HTTP route.
async function importSports(tx,events){
 ensure(Array.isArray(events)&&events.length<=200,'Expected at most 200 sports events.');
 for(const e of events){
  ensure(typeof e.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(e.id),'Invalid event ID.');
  ensure(typeof e.title==='string'&&e.title.length<=160&&e.title.length>0,'Invalid event title.');
  ensure(Number.isSafeInteger(e.starts_at)&&e.starts_at>0,'Invalid event start.');
  ensure(Array.isArray(e.options)&&e.options.length>=2&&e.options.length<=20,'Supply 2 to 20 selections.');
  ensure(new Set(e.options.map(o=>o.id)).size===e.options.length,'Selection IDs must be unique.');
  e.options.forEach(o=>ensure(typeof o.id==='string'&&/^[a-zA-Z0-9_-]{1,40}$/.test(o.id)&&typeof o.label==='string'&&o.label.length>0&&o.label.length<=80&&Number.isSafeInteger(o.odds)&&o.odds>=1001&&o.odds<=100000,'Invalid selection or odds.'));
  const old=await tx.get('SELECT * FROM casino_sports WHERE id=?',[e.id]);
  ensure(!old||old.starts_at===e.starts_at,'An existing event start cannot be changed.');
  ensure(!old||old.options===JSON.stringify(e.options),'Existing event selections cannot be changed.');
  await tx.run('INSERT OR IGNORE INTO casino_sports (id,title,starts_at,options) VALUES (?,?,?,?)',[e.id,e.title,e.starts_at,JSON.stringify(e.options)]);
  if(e.winner!==undefined){
   ensure(e.winner==='void'||e.options.some(o=>o.id===e.winner),'Invalid winning selection.');
   ensure(e.winner==='void'||seconds()>=e.starts_at,'Cannot settle before the event starts.');
   if(old&&old.status!=='open'){ensure(old.winner===e.winner,'This result was already settled differently.');continue;}
   const bets=await tx.all('SELECT * FROM casino_sports_bets WHERE event_id=? AND settled=0',[e.id]);
   for(const bet of bets){
    const payout=e.winner==='void'?bet.stake:bet.selection===e.winner?Math.floor(bet.stake*bet.odds/1000):0;
    if(payout)await cash(tx,bet.user_id,payout,'Bookie result: '+e.title);
    await tx.run('UPDATE casino_sports_bets SET settled=1 WHERE id=?',[bet.id]);
   }
   await tx.run("UPDATE casino_sports SET status='settled',winner=? WHERE id=?",[e.winner,e.id]);
  }
 }
}
function tableView(t,id){
 const d=JSON.parse(t.state),side=t.host_id===id?'host':t.guest_id===id?'guest':null;
 return {id:t.id,game:t.game,stake:t.stake,status:t.status,host:t.host_name,guest:t.guest_name,host_id:t.host_id,guest_id:t.guest_id,
  expires_at:t.expires_at,hand:side?d[side]:undefined,drawn:side?Boolean(d[side+'Done']):false,
  opponentHand:t.status==='finished'&&side?d[side==='host'?'guest':'host']:undefined,
  winner:d.winner,payout:d.payout,result:d.result};
}
async function state(tx,id){
 const w=await wallet(tx,id);
 await settleLottery(tx);await expireTables(tx);
 const user=await tx.get('SELECT level,cash,job_key FROM users WHERE id=?',[id]);
 const rounds=await tx.all('SELECT * FROM casino_rounds WHERE user_id=? AND active=1',[id]);
 const tables=await tx.all("SELECT t.*,h.username AS host_name,g.username AS guest_name FROM casino_tables t JOIN users h ON h.id=t.host_id LEFT JOIN users g ON g.id=t.guest_id WHERE t.status='waiting' OR (t.host_id=? OR t.guest_id=?) ORDER BY t.id DESC LIMIT 50",[id,id]);
 const events=await tx.all("SELECT * FROM casino_sports WHERE status='open' AND starts_at>? ORDER BY starts_at LIMIT 100",[seconds()]);
 const sportsBets=await tx.all('SELECT b.*,s.title FROM casino_sports_bets b JOIN casino_sports s ON s.id=b.event_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT 20',[id]);
 const awards=await tx.all('SELECT * FROM casino_awards WHERE user_id=?',[id]);
 const stats=await tx.all('SELECT stat,value FROM casino_stats WHERE user_id=?',[id]);
 const draw=await tx.get('SELECT * FROM casino_lotteries WHERE day=?',[w.day]);
 const ticketCount=(await tx.get('SELECT COUNT(*) AS n FROM casino_tickets WHERE user_id=? AND day=?',[id,w.day])).n;
 const lastDraw=await tx.get("SELECT l.*,u.username AS winner FROM casino_lotteries l LEFT JOIN users u ON u.id=l.winner_id WHERE l.status='drawn' ORDER BY l.day DESC LIMIT 1");
 const pass=(await tx.get("SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE user_id=? AND item_key='torn_428' AND item_type='item'",[id])).n;
 return {wallet:w,user,id,rounds:rounds.map(r=>publicRound({...r,data:JSON.parse(r.state)})),tables:tables.map(t=>tableView(t,id)),
  sports:events.map(e=>({...e,options:JSON.parse(e.options)})),sportsBets,awards:awards.map(a=>({...a,title:AWARDS[a.award]})),stats,
  lottery:{pot:draw?.pot||0,tickets:ticketCount,lastDraw},passes:pass,levels:LEVELS,awardGoals:AWARDS};
}
async function action(tx,id,b){
 ensure(b&&typeof b==='object','Invalid request.');
 ensure(typeof b.request_id==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(b.request_id),'Missing request ID. Refresh and try again.');
 const payload=JSON.stringify(b),previous=await tx.get('SELECT * FROM casino_requests WHERE user_id=? AND request_id=?',[id,b.request_id]);
 if(previous){ensure(previous.payload===payload,'Request ID already used for a different action.');return JSON.parse(previous.result);}
 await settleLottery(tx);await expireTables(tx);
 // Points purchase/refills are available from level 2; game levels are enforced below.
 await gate(tx,id,['refill','points'].includes(b.game)?'bookie':b.game);
 let result;
 if(b.game==='refill')result=await refill(tx,id,b);
 else if(b.game==='points'){
  const qty=amount(b.quantity,1,1000);await cash(tx,id,-qty*50000,'Points purchase');
  await tx.run('UPDATE casino_wallets SET points=points+? WHERE user_id=?',[qty,id]);result={msg:'Bought '+qty+' points for $'+qty*50000+'.'};
 }else if(b.game==='bookie')result=await sportsBet(tx,id,b);
 else if(b.game==='lottery')result=await lottery(tx,id);
 else if(b.game==='blackjack')result=await blackjack(tx,id,b);
 else if(b.game==='highlow')result=await highlow(tx,id,b);
 else if(['poker','roulette'].includes(b.game))result=await tableAction(tx,id,b.game,b);
 else result=await simple(tx,id,b.game,b);
 await tx.run('INSERT INTO casino_requests (user_id,request_id,payload,result) VALUES (?,?,?,?)',[id,b.request_id,payload,JSON.stringify(result)]);
 return result;
}
module.exports={LEVELS,AWARDS,dayOf,wallet,action,state,importSports,settleLottery,expireTables,CasinoError};
