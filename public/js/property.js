(() => {
 let busy=false;
 const message=document.getElementById('property-feedback');
 const saved=sessionStorage.getItem('property-feedback');
 if(saved){message.textContent=saved;message.hidden=false;sessionStorage.removeItem('property-feedback');}
 document.querySelectorAll('[data-property-action]').forEach(button=>button.addEventListener('click',async()=>{
  if(busy)return;
  const action=button.dataset.propertyAction;
  const body={home_key:button.dataset.home,db_id:Number(button.dataset.id),item_key:button.dataset.item};

  busy=true;button.disabled=true;
  try {
   const response=await fetch('/property/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const result=await response.json();
   if(result.error)throw new Error(result.error);
   sessionStorage.setItem('property-feedback',result.msg||'Saved.');
   location.reload();
  }catch(err){message.textContent=err.message||'Could not save. Please refresh.';message.hidden=false;message.scrollIntoView({block:'center'});}
  finally{busy=false;button.disabled=false;}
 }));
 document.getElementById('furnishing-search').addEventListener('input',event=>{
  const q=event.target.value.trim().toLowerCase();document.querySelectorAll('.furnishing-sale').forEach(row=>row.hidden=!row.dataset.name.includes(q));
 });
})();
