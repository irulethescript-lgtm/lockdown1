const travelState=JSON.parse(document.getElementById('travelState').textContent);
let travelPending=false, polling=false;
const feedback=document.getElementById('travelFeedback');
function travelMessage(message,error=false) { feedback.hidden=false;feedback.textContent=message;feedback.classList.toggle('is-error',error); }
const saved=sessionStorage.getItem('travelFeedback');
if(saved){travelMessage(saved);sessionStorage.removeItem('travelFeedback');}
function clockText(seconds) {return `${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s`;}
let serverOffset=travelState.now-Math.floor(Date.now()/1000);
function updateTravelClocks() {
  const now=Math.floor(Date.now()/1000)+serverOffset;
  const clock=document.querySelector('[data-arrival]');
  if(clock){
    const end=Number(clock.dataset.arrival),seconds=Math.max(0,end-now);
    clock.textContent=seconds?clockText(seconds)+' to arrival':'Arriving…';
    const bar=document.getElementById('tripProgress'),start=Number(bar.dataset.start);
    bar.style.width=Math.min(100,Math.max(0,(now-start)/(end-start)*100))+'%';
  }
  document.querySelectorAll('[data-restock]').forEach(el=>el.textContent=clockText(Math.max(0,Number(el.dataset.restock)-now)));
}
async function pollTravel() {
  if(polling||travelPending||document.hidden)return;
  polling=true;
  try {
    const response=await fetch('/yard/state',{headers:{Accept:'application/json'}});
    if(!response.ok) return;
    const data=await response.json();
    if(!data.travel) return;
    serverOffset=data.travel.now-Math.floor(Date.now()/1000);
    if(data.travel.phase!==travelState.phase || data.travel.revision!==travelState.revision){location.reload();return;}
    if(data.user)updateStats(data.user);
  } catch { /* Keep the last confirmed state; the next poll can recover. */ }
  finally{polling=false;}
}
document.querySelectorAll('[data-travel-action]').forEach(button=>button.addEventListener('click',async()=>{
  if(travelPending)return;
  const action=button.dataset.travelAction;
  const body={};
  if(button.dataset.destination)body.destination_id=Number(button.dataset.destination);
  if(button.dataset.item){
    body.item_key=button.dataset.item;
    body.item_type=button.dataset.type;
    const input=document.getElementById((action==='buy'?'buy-':'sell-')+body.item_key);
    if(!input.reportValidity())return;
    body.quantity=Number(input.value);
  }
  travelPending=true;button.disabled=true;
  try{
    const response=await fetch('/yard/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(data.error){travelMessage(data.error,true);return;}
    sessionStorage.setItem('travelFeedback',data.msg);location.reload();
  }catch{travelMessage('Could not confirm the action. Refresh to check your trip and cargo before trying again.',true);}
  finally{travelPending=false;button.disabled=false;}
}));
updateTravelClocks();setInterval(updateTravelClocks,1000);setInterval(pollTravel,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollTravel();});

function filterOverseas(){
 const q=document.getElementById('overseas-search').value.trim().toLowerCase();
 const category=document.getElementById('overseas-category')?.value||'all';
 document.querySelectorAll('[data-overseas-name]').forEach(row=>row.hidden=!row.dataset.overseasName.toLowerCase().includes(q)||(category!=='all'&&row.dataset.group!==category));
}
document.getElementById('overseas-search')?.addEventListener('input',filterOverseas);
document.getElementById('overseas-category')?.addEventListener('change',filterOverseas);
