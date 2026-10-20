const battleState=JSON.parse(document.getElementById('battleState').textContent);
let busy=false,target=null,battle=battleState.battle,victory=!!battleState.pending,expiresAt=battle?.expiresAt||battleState.pending?.expiresAt||0,selected=null;
const el=id=>document.getElementById(id);
function notice(text,error=false){el('fightResult').hidden=false;el('fightResult').textContent=text;el('fightResult').classList.toggle('is-error',error);}
function showTarget(t){if(!t)return;target=t;el('enemyName').textContent=t.username;el('enemyLife').textContent=t.hp+' / '+t.max_hp;el('enemyHealth').max=t.max_hp;el('enemyHealth').value=t.hp;el('backToProfile').href='/profile/'+encodeURIComponent(t.username);}
function choose(id){showTarget(battleState.targets.find(t=>t.id===id));refresh();}
function log(lines){el('logLines').replaceChildren();for(const text of lines||[]){const p=document.createElement('p');p.textContent=text;el('logLines').appendChild(p);}el('logLines').scrollTop=el('logLines').scrollHeight;}
function refresh(){
 const u=battleState.user,restricted=u.in_jail||u.in_hospital||u.energy<battleState.energyCost||u.stamina<10;
 el('fightReadiness').textContent=u.energy+' energy · '+u.stamina+'% stamina';
 const targetButton=target&&document.querySelector('[data-target="'+target.id+'"]');
 el('startAttack').disabled=busy||!!battle||victory||restricted||!target||targetButton?.dataset.recovering==='true'||Number(targetButton?.dataset.ready)>Date.now()/1000;
 el('fightStance').disabled=busy||!!battle||victory;
 el('startAttack').hidden=!!battle||victory;el('victoryChoices').hidden=!victory;el('weaponTray').hidden=!battle;
 document.querySelectorAll('[data-ending],#weaponTray button').forEach(b=>b.disabled=busy);
 document.querySelectorAll('[data-target]').forEach(b=>{b.disabled=busy||!!battle||victory||restricted||b.dataset.recovering==='true'||Number(b.dataset.ready)>Date.now()/1000;});
 const hp=battle?.hp??u.hp,max=battle?.max_hp??u.max_hp;
 el('yourLife').textContent=hp+' / '+max;el('yourHealth').max=max;el('yourHealth').value=hp;el('participantMeter').max=max;el('participantMeter').value=hp;el('participantHealth').textContent=hp+' / '+max+' HP';
 el('battleHint').textContent=battle?'Round '+(battle.round+1)+' / 25 · choose your action':victory?'Choose the outcome':battleState.energyCost+' Energy · 10% stamina';
 if(expiresAt){const remaining=Math.max(0,expiresAt-Math.floor(Date.now()/1000));el('attackTimer').textContent=(battle?'⌛ Battle: ':'⌛ Choose outcome: ')+String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');if(!remaining&&!busy){if(victory)finish('leave');else if(battle)sync();}}
 else el('attackTimer').textContent='25 rounds · 5 minutes';
}
function tray(){
 const box=el('weaponTray');box.replaceChildren();if(!battle)return;
 const heading=document.createElement('h2');heading.textContent='Choose your weapon / action';box.append(heading);
 const choices=[...battle.weapons.map(w=>({...w,key:'weapon:'+w.id,action:'weapon',label:w.category,name:w.name,detail:'Damage '+w.damage.toFixed(2)+' · Accuracy '+w.accuracy.toFixed(2)+(w.caliber?' · '+w.loaded+' / '+w.clip+' · reserve '+w.reserve:'')})),
 {key:'fists',action:'fists',label:'Unarmed',name:'Fists',detail:'Damage 10 · Accuracy 50'},...(battle.kick?[{key:'kick',action:'kick',label:'Unarmed',name:'Kick',detail:'Damage 30 · Accuracy 40.71'}]:[]),
 ...battle.temporary.map(t=>({...t,key:'temporary:'+t.key,item_key:t.key,action:'temporary',label:'Temporary item',detail:'One temporary item per fight'}))];
 if(!choices.some(c=>c.key===selected))selected=choices[0]?.key;
 for(const choice of choices){
  const card=document.createElement('article');card.className='weapon-card'+(selected===choice.key?' selected':'');
  const select=document.createElement('button');select.className='weapon-select';select.type='button';select.setAttribute('aria-pressed',String(selected===choice.key));
  if(choice.img){const img=document.createElement('img');img.src=choice.img;img.alt='';select.append(img);}
  const label=document.createElement('small');label.textContent=choice.label;const name=document.createElement('strong');name.textContent=choice.name;select.append(label,name);select.addEventListener('click',()=>{selected=choice.key;tray();refresh();});card.append(select);
  const detail=document.createElement('p');detail.textContent=choice.detail;card.append(detail);
  if(selected===choice.key){const act=document.createElement('button');act.type='button';act.textContent=choice.action==='temporary'?'USE':'ATTACK';act.addEventListener('click',()=>turn(choice));card.append(act);
   if(choice.caliber){const reload=document.createElement('button');reload.type='button';reload.textContent='RELOAD · 1 turn';reload.addEventListener('click',()=>turn({...choice,action:'reload'}));card.append(reload);}
  }box.append(card);
 }
}
async function send(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(r.redirected)throw new Error('Sign in again to continue.');const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Action could not be confirmed.');if(d.user){battleState.user=d.user;updateStats(d.user);}return d;}
function receive(d){
 if(d.battle){if(battle&&battle.attackId===d.battle.attackId&&d.battle.version<battle.version)return;battle=d.battle;const targetButton=document.querySelector('[data-target="'+battle.target.id+'"]');if(targetButton)targetButton.dataset.ready=String(battle.expiresAt+300);expiresAt=battle.expiresAt;showTarget(battle.target);log(battle.log);el('battleStatus').textContent='YOUR TURN';tray();}
 else{battle=null;victory=d.result==='win';expiresAt=victory?d.expiresAt:0;if(d.target)showTarget(d.target);log(d.log);el('battleStatus').textContent=victory?'YOU WON!':d.result==='loss'?'YOU LOST':'STALEMATE';el('enemyOutcome').textContent=el('battleStatus').textContent;el('battleComplete').hidden=victory;tray();}
 if(d.msg)notice(d.msg);refresh();
}
el('startAttack').addEventListener('click',async()=>{if(busy||!target||battle)return;busy=true;refresh();try{receive(await send('/battles/attack',{target_id:target.id,stance:el('fightStance').value}));}catch(e){notice(e.message,true);}finally{busy=false;refresh();}});
async function turn(choice){if(busy||!battle)return;busy=true;refresh();try{receive(await send('/battles/turn',{attack_id:battle.attackId,version:battle.version,action:choice.action,weapon_id:choice.id,item_key:choice.item_key}));}catch(e){notice(e.message,true);await sync();}finally{busy=false;refresh();}}
async function sync(){try{const r=await fetch('/battles/state');if(!r.ok||r.redirected)return;const d=await r.json();if(d.user){battleState.user=d.user;updateStats(d.user);}if(d.battle){if(!battle||d.battle.attackId!==battle.attackId||d.battle.version!==battle.version)receive(d);}else if(d.pending){if(!victory)location.reload();}else if(battle){receive({result:'draw',log:[...(battle.log||[]),'The battle has ended.'],msg:'Battle ended. See recent battles for the result.'});}}catch(e){notice('Connection lost. Refresh to resume your saved fight.',true);}}
async function finish(ending){if(busy||!victory)return;busy=true;refresh();try{const d=await send('/battles/finish',{ending});victory=false;expiresAt=0;notice(d.msg);el('battleStatus').textContent='VICTORY COMPLETE';el('yourOutcome').textContent=d.msg;el('battleComplete').hidden=false;el('logLines').appendChild(Object.assign(document.createElement('p'),{textContent:d.msg}));}catch(e){notice(e.message,true);}finally{busy=false;refresh();}}
document.querySelectorAll('[data-ending]').forEach(b=>b.addEventListener('click',()=>finish(b.dataset.ending)));
document.querySelectorAll('[data-target]').forEach(b=>b.addEventListener('click',()=>{choose(Number(b.dataset.target));el('attackArena').scrollIntoView({behavior:'smooth',block:'start'});}));
if(battle){receive({battle});}else if(battleState.pending){showTarget({id:battleState.pending.defender_id,username:battleState.pending.username,hp:0,max_hp:battleState.pending.max_hp});log(battleState.pending.log);el('battleStatus').textContent='YOU WON!';el('enemyHealth').value=0;el('enemyLife').textContent='0 / '+(target?.max_hp||100);}else{const initial=Number(new URLSearchParams(location.search).get('target'));if(initial)choose(initial);}
document.addEventListener('player:updated',e=>{battleState.user=e.detail;refresh();});refresh();setInterval(refresh,1000);setInterval(()=>{if(battle&&!busy)sync();},5000);
