(() => {
 const message=document.getElementById('arsenal-message');
 let pending=false;
 const disabled=new Map([...document.querySelectorAll('.arsenal-form button')].map(b=>[b,b.disabled]));
 document.querySelectorAll('.arsenal-form').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(pending||!form.reportValidity())return;
  pending=true;document.querySelectorAll('.arsenal-form button').forEach(b=>b.disabled=true);
  try{
   const response=await fetch(form.dataset.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
   if(response.redirected&&new URL(response.url).pathname==='/login')throw new Error('Your session expired. Sign in again.');
   if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Request failed. Refresh and try again.');
   const result=await response.json();
   if(!response.ok||result.error)throw new Error(result.error||'Unable to save equipment.');
   message.textContent=result.msg;location.reload();
  }catch(error){
   message.textContent=error.message||'Connection failed. Refresh before trying again.';
   pending=false;document.querySelectorAll('.arsenal-form button').forEach(b=>b.disabled=disabled.get(b));
  }
 }));
})();
