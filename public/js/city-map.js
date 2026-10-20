(()=>{
 const viewport=document.getElementById('city-map-viewport'),canvas=document.getElementById('city-map-canvas');
 let zoom=1,x=0,y=0,drag;
 function draw(){x=Math.max(viewport.clientWidth*(1-zoom),Math.min(0,x));y=Math.max(viewport.clientHeight*(1-zoom),Math.min(0,y));canvas.style.transform='translate('+x+'px,'+y+'px) scale('+zoom+')';}
 function setZoom(next){const prev=zoom;zoom=Math.max(1,Math.min(3,next));x=viewport.clientWidth/2-(viewport.clientWidth/2-x)*zoom/prev;y=viewport.clientHeight/2-(viewport.clientHeight/2-y)*zoom/prev;draw();}
 document.getElementById('map-zoom-in').onclick=()=>setZoom(zoom+.5);
 document.getElementById('map-zoom-out').onclick=()=>setZoom(zoom-.5);
 document.getElementById('map-reset').onclick=()=>{zoom=1;x=y=0;draw();};
 viewport.addEventListener('pointerdown',e=>{if(e.target.closest('a,button'))return;drag={x:e.clientX,y:e.clientY,ox:x,oy:y};viewport.setPointerCapture(e.pointerId);});
 viewport.addEventListener('pointermove',e=>{if(!drag)return;x=drag.ox+e.clientX-drag.x;y=drag.oy+e.clientY-drag.y;draw();});
 const end=()=>{drag=null;};viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);window.addEventListener('resize',draw);
 const tabs=[document.getElementById('map-tab'),document.getElementById('links-tab')];
 tabs.forEach((tab,index)=>{function activate(){tabs.forEach((t,i)=>{t.setAttribute('aria-selected',String(i===index));t.tabIndex=i===index?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=i!==index;});if(index===0)draw();}
 tab.onclick=activate;tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?1:1-index;tabs[next].click();tabs[next].focus();}};});
 const find=document.getElementById('city-find');
 if(find)find.onclick=async()=>{find.disabled=true;try{const response=await fetch('/city/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('Could not collect this item. Try again.');const result=await response.json();document.getElementById('city-find-status').textContent=result.error||result.msg;if(result.error)find.disabled=false;else find.remove();}catch(err){document.getElementById('city-find-status').textContent=err.message;find.disabled=false;}};
})();
