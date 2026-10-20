(()=>{
 'use strict';
 let data=JSON.parse(document.getElementById('casino-initial').textContent),busy=false,pending=null,lastResult=null,dirty=false;
 const section=document.getElementById('casino-app').dataset.section;
 const $=id=>document.getElementById(id);
 const money=n=>'$'+Number(n).toLocaleString();
 function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
 function button(text,action,secondary=false){const e=el('button',text,'casino-button'+(secondary?' secondary':''));e.type='button';e.onclick=action;return e;}
 function append(parent,...children){children.forEach(c=>parent.append(c));return parent;}
 function info(parent,text){parent.append(el('p',text));}
 function card(c,held=false){const ranks={11:'J',12:'Q',13:'K',14:'A'},suits=['♠','♥','♦','♣'];return el('span',(ranks[c.rank]||c.rank)+suits[c.suit],'casino-card'+([1,2].includes(c.suit)?' red':'')+(held?' hold':''));}
 function cards(parent,hand){const row=el('div',undefined,'casino-cards');(hand||[]).forEach(c=>row.append(card(c)));parent.append(row);}
 async function refresh(){const r=await fetch('/casino/state');if(!r.ok)throw Error('Could not refresh casino balances.');data=await r.json();dirty=false;render();}
 async function submit(payload){
  if(busy)return;
  const key=JSON.stringify(payload);
  if(pending&&pending.key!==key){$('casino-message').textContent='The last request could not be confirmed. Retry that same action before making another play.';return;}
  if(!pending)pending={key,body:{...payload,request_id:crypto.randomUUID()}};
  busy=true;document.querySelectorAll('#casino-app button').forEach(b=>b.disabled=true);
  try{
   const response=await fetch('/casino/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.body)});
   let result;try{result=await response.json();}catch{throw Error('Connection interrupted. Retry the same action to confirm its result.');}
   if(response.status>=500)throw Error('The play could not be confirmed. Retry the same action.');
   pending=null;
   $('casino-message').textContent=result.error||result.msg||'Saved.';
   if(!result.error)lastResult={game:payload.game,...result};
   await refresh();
  }catch(err){$('casino-message').textContent=err.message;}
  finally{busy=false;document.querySelectorAll('#casino-app button').forEach(b=>b.disabled=false);}
 }
 function form(parent,label,payload,opts={}){
  const f=el('form',undefined,'casino-form'),l=el('label',opts.quantity?'Points':'Wager');
  const i=el('input');i.type='number';i.min=opts.quantity?'1':opts.multiplayer?'100':'10';i.max=opts.quantity?'1000':'1000000';i.step=opts.quantity||opts.multiplayer?'1':'2';i.value=opts.quantity?'30':'100';i.required=true;
  l.append(i);f.append(l);const b=button(label,()=>{});b.type='submit';b.onclick=null;f.append(b);
  f.onsubmit=e=>{e.preventDefault();if(f.reportValidity())submit({...payload,[opts.quantity?'quantity':'bet']:Number(i.value)});};parent.append(f);
 }
 function active(game){return data.rounds.find(r=>r.game===game);}
 function gameBox(game,title,description){
  const box=el('section',undefined,'casino-game'),level=data.levels[game];
  box.append(el('span','LEVEL '+level+' · '+(game==='poker'?'NO TOKENS':'1 CASINO TOKEN'),'casino-tag'),el('h2',title));
  info(box,description);
  $('casino-games').append(box);
  if(data.user.level<level){box.classList.add('locked');info(box,'Unlocks when you reach level '+level+'.');return null;}
  return box;
 }
 function render(){
  const cash=document.getElementById("um_cash");if(cash)cash.textContent=typeof formatCash==='function'?formatCash(data.user.cash):Number(data.user.cash).toLocaleString();
  $('casino-balances').replaceChildren();
  [['Cash',money(data.user.cash)],['Casino Tokens',data.wallet.tokens+' / 75'],['Points',data.wallet.points],['Level',data.user.level]].forEach(([name,value])=>{
   const box=el('div',undefined,'casino-balance');append(box,el('span',name),el('strong',value));$('casino-balances').append(box);
  });
  const clock=el('p','Next daily reset: '+new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z').getTime(),'casino-clock');
  // Use a human-readable reset time in UTC rather than a local timezone assumption.
  clock.textContent='Daily reset: midnight UTC · Casino Passes: '+data.passes;
  $('casino-balances').after(clock);
  document.querySelectorAll('.casino-clock').forEach((c,i)=>{if(i)c.remove();});
  $('casino-points').hidden=section!=='points';$('casino-awards').hidden=section!=='awards';$('casino-games').hidden=section!=='casino';
  renderRefills();renderAwards();renderResult();
  $('casino-games').replaceChildren();
  if(section!=='casino')return;
  renderBookie();renderLottery();renderBlackjack();renderTables('poker');renderTables('roulette');renderWheel();renderSimple('slots','Slots','Match three symbols for the biggest returns. A pair returns half your wager.');renderSimple('craps','Craps','Bet the pass line. Roll a 7 or 11 to win the come-out, or make your point before a 7.');renderHighlow();
 }
 function renderResult(){
  const root=$('casino-last-result');root.replaceChildren();if(!lastResult)return;
  const box=el('section',undefined,'casino-result');box.append(el('strong',lastResult.msg||'Result'));
  if(lastResult.round?.player){info(box,'Your hand');cards(box,lastResult.round.player);info(box,'Dealer');cards(box,lastResult.round.dealer);}
  if(lastResult.result?.symbols){const symbols=['💎','★','🔔','🍒','🍋','🍀','7','♠'];box.append(el('p',lastResult.result.symbols.map(x=>symbols[x]).join(' '),'casino-slots'));}
  if(lastResult.result?.rolls)info(box,'Dice: '+lastResult.result.rolls.map(r=>r.join('+')).join(' → '));
  if(lastResult.result?.segment)info(box,'Wheel segment '+lastResult.result.segment+': '+money(lastResult.result.prize));
  root.append(box);
 }
 function renderRefills(){
  const root=$('casino-refills');root.replaceChildren();info(root,'Buy points for $50,000 each. A 30-point Casino Token refill is available once per UTC day.');
  form(root,'Buy points',{game:'points'},{quantity:true});
  const row=el('div',undefined,'casino-form');
  ['points','pass','job'].forEach(method=>row.append(button(method==='points'?'Refill · 30 points':method==='pass'?'Use Casino Pass':'Gaming Consultant special',()=>submit({game:'refill',method}))));
  root.append(row);info(root,'Gaming Consultants can refill once per UTC day. Apply through Job Listings (100 Defence required). Refills require level 2 and fewer than 75 Casino Tokens.');
 }
 function renderAwards(){
  const root=$('casino-award-list');root.replaceChildren();Object.entries(data.awardGoals).forEach(([key,title])=>{
   const earned=data.awards.some(a=>a.award===key);root.append(el('div',(earned?'★ Earned · ':'☆ ')+title,'casino-award'+(earned?' earned':'')));
  });
  $('casino-stat-list').replaceChildren();data.stats.forEach(s=>$('casino-stat-list').append(el('p',s.stat.replaceAll('_',' ')+': '+s.value.toLocaleString())));
 }
 function renderBookie(){
  const box=gameBox('bookie','Bookie','Back a real sporting event with fixed decimal odds. Bets close at the listed UTC kickoff.');if(!box)return;
  if(!data.sports.length)info(box,'No events are open right now. Check back when fixtures are listed.');
  data.sports.forEach(event=>{
   const panel=el('div',undefined,'casino-table');panel.append(el('h3',event.title));info(panel,new Date(event.starts_at*1000).toUTCString());
   event.options.forEach(o=>form(panel,o.label+' · '+(o.odds/1000).toFixed(3),{game:'bookie',event_id:event.id,selection:o.id}));box.append(panel);
  });
  data.sportsBets.forEach(b=>info(box,b.title+' · '+b.selection+' · '+money(b.stake)+' · '+(b.settled?'settled':'pending')));
 }
 function renderLottery(){
  const box=gameBox('lottery','Lottery','One daily draw. 90% of ticket sales goes to a randomly chosen ticket.');if(!box)return;
  info(box,'Current prize: '+money(Math.floor(data.lottery.pot*.9))+' · Your tickets: '+data.lottery.tickets+'/10');
  box.append(button('Buy ticket · $1,000',()=>submit({game:'lottery'})));
  const last=data.lottery.lastDraw;if(last)info(box,'Last draw: '+(last.winner||'No tickets')+' · '+money(last.prize));
 }
 function renderBlackjack(){
  const box=gameBox('blackjack','Blackjack','Beat the dealer without going over 21. Natural pays 3:2; five cards without busting win.');if(!box)return;
  const r=active('blackjack');if(!r){form(box,'Deal',{game:'blackjack',move:'start'});return;}
  info(box,'Your hand · '+r.total+' · Stake '+money(r.bet));cards(box,r.player);info(box,'Dealer shows');cards(box,r.dealer);
  const row=el('div',undefined,'casino-form');
  ['hit','stand',...(r.canDouble?['double']:[]),...(r.canInsure?['insurance']:[])].forEach(move=>row.append(button(move,()=>submit({game:'blackjack',move}))));
  box.append(row);
 }
 function renderTables(game){
  const box=gameBox(game,game==='poker'?'Poker':'Russian Roulette',game==='poker'?'Two real players. Five-card draw with one redraw. Highest poker hand wins.':'Two real players. Alternating turns, six chambers. Winner takes 95% of the cash pot.');if(!box)return;
  form(box,'Open table',{game,move:'create'},{multiplayer:true});
  const tables=data.tables.filter(t=>t.game===game);
  if(!tables.length)info(box,'No tables yet. Open one for another player to join.');
  tables.forEach(t=>{
   const panel=el('div',undefined,'casino-table');panel.append(el('strong','#'+t.id+' · '+t.host+(t.guest?' vs '+t.guest:' · waiting')+' · '+money(t.stake)));
   info(panel,t.status+(t.result?' · '+t.result:''));
   const seated=data.id===t.host_id||data.id===t.guest_id;
   if(t.status==='waiting')panel.append(button(data.id===t.host_id?'Cancel and refund':'Join table',()=>submit({game,move:data.id===t.host_id?'cancel':'join',table_id:t.id}),true));
   if(t.hand){
    if(t.status==='playing'&&!t.drawn&&seated){
     const held=new Set(),row=el('div',undefined,'casino-cards');
     t.hand.forEach((c,i)=>{const b=el('button');b.type='button';b.className='casino-card'+([1,2].includes(c.suit)?' red':'');b.textContent=card(c).textContent;b.setAttribute('aria-label','Hold '+b.textContent);b.setAttribute('aria-pressed','false');b.onclick=()=>{if(held.has(i))held.delete(i);else held.add(i);b.classList.toggle('hold',held.has(i));b.setAttribute('aria-pressed',String(held.has(i)));};row.append(b);});
     info(panel,'Select cards to hold. Unselected cards will be replaced.');panel.append(row,button('Draw once',()=>submit({game,move:'draw',table_id:t.id,hold:[...held].sort()})));
    }else {cards(panel,t.hand);if(t.drawn&&t.status==='playing')info(panel,'You have drawn. Waiting for your opponent.');}
   }
   if(t.opponentHand){info(panel,'Opponent');cards(panel,t.opponentHand);}
   if(t.status==='playing')info(panel,'Deadline: '+new Date(t.expires_at*1000).toUTCString());
   if(t.winner)info(panel,(t.winner===data.id?'You won':'Winner #'+t.winner)+' · Payout '+money(t.payout));
   box.append(panel);
  });
 }
 function renderWheel(){const box=gameBox('wheel','Spin the Wheel','One spin per UTC day. Ten equal segments with cash prizes up to $5,000.');if(box)box.append(button('Spin · $1,000',()=>submit({game:'wheel'})));}
 function renderSimple(game,title,description){const box=gameBox(game,title,description);if(box)form(box,'Play',{game});}
 function renderHighlow(){
  const box=gameBox('highlow','High-Low','Guess whether the next card is higher or lower. Ties lose. Cash out before a wrong guess.');if(!box)return;
  const r=active('highlow');if(!r){form(box,'Start',{game:'highlow',move:'start'});return;}
  info(box,'Current rank: '+({11:'Jack',12:'Queen',13:'King',14:'Ace'}[r.card]||r.card)+' · Streak: '+r.streak+' · Bank: '+money(r.bank));
  const row=el('div',undefined,'casino-form');['higher','lower','cashout'].forEach(move=>row.append(button(move,()=>submit({game:'highlow',move}))));box.append(row);
 }
 render();
 // Poll only when the player has not changed a form or held cards.
 document.addEventListener('input',()=>dirty=true);document.addEventListener('click',e=>{if(e.target.closest('.casino-card'))dirty=true;});
 setInterval(async()=>{if(busy||pending||document.hidden||dirty)return;try{const r=await fetch('/casino/state');if(!r.ok)return;const next=await r.json();if(JSON.stringify(next)!==JSON.stringify(data)){data=next;render();}}catch{}},10000);
})();
