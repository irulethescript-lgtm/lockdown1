(() => {
  let busy=false;
  function tick(){
    const now=Math.floor(Date.now()/1000);
    document.querySelectorAll('[data-med-timer]').forEach(n=>{
      const seconds=Math.max(0,Number(n.dataset.medTimer)-now);
      n.textContent=seconds?Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m '+seconds%60+'s':'Ready';
    });
    document.querySelectorAll('[data-med-ready]').forEach(n=>n.disabled=busy||Number(n.dataset.medReady)>now);
  }
  async function send(path,body){
    if(busy)return;busy=true;tick();
    try{
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok || !response.headers.get('content-type')?.includes('application/json'))throw Error('Could not save. Refresh and try again.');
      const result=await response.json();
      if(result.error)throw Error(result.error);
      showMsg(result.msg,false);
      setTimeout(()=>location.reload(),900);
    }catch(e){showMsg(e.message,true);busy=false;tick();}
  }
  document.querySelectorAll('[data-med-use]').forEach(b=>b.addEventListener('click',()=>send('/inventory/use',{item_key:b.dataset.medUse,item_type:b.dataset.medType})));
  document.querySelectorAll('[data-med-revive]').forEach(b=>b.addEventListener('click',()=>send('/infirmary/revive',{target_id:Number(b.dataset.medRevive)})));
  document.querySelectorAll('[data-med-upgrade]').forEach(b=>b.addEventListener('click',()=>send('/infirmary/faction-upgrade',{upgrade:b.dataset.medUpgrade})));
  document.getElementById('accept-revives')?.addEventListener('change',e=>send('/infirmary/preferences',{accepts_revives:e.target.checked}));
  tick();setInterval(tick,1000);
})();
