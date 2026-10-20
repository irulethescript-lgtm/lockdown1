(() => {
 const feedback=document.getElementById('economy-feedback');
 const saved=sessionStorage.getItem('economy-feedback');
 if(saved&&feedback){feedback.textContent=saved;feedback.hidden=false;sessionStorage.removeItem('economy-feedback');}
 let busy=false;
 document.querySelectorAll('form[data-economy]').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(form.dataset.confirm&&!confirm(form.dataset.confirm))return;
  const body=Object.fromEntries(new FormData(form));
  if(event.submitter?.name)body[event.submitter.name]=event.submitter.value;
  busy=true;const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{const response=await fetch(form.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||'Unable to save.');sessionStorage.setItem('economy-feedback',result.msg||'Saved.');location.reload();}
  catch(err){if(feedback){feedback.textContent=err.message;feedback.hidden=false;feedback.scrollIntoView({block:'center'});}}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);}
 }));
 document.querySelectorAll('[data-filter-list]').forEach(input=>input.addEventListener('input',()=>{document.querySelectorAll(input.dataset.filterList).forEach(row=>row.hidden=!row.dataset.search.toLowerCase().includes(input.value.toLowerCase()));}));
})();
