const homeLife = JSON.parse(document.getElementById('homeLifeState').textContent);
let homeBreakPending = false;
function refreshHomeLife() {
  const remaining = Math.max(0, homeLife.relax_ready_at - Math.floor(Date.now() / 1000));
  document.getElementById('homeHappiness').textContent = `${homeLife.happiness} / ${homeLife.max_happiness} happiness`;
  document.getElementById('homeRelax').disabled = homeBreakPending || remaining > 0 || homeLife.happiness >= homeLife.max_happiness || homeLife.in_jail || homeLife.in_hospital;
  document.getElementById('homeBreakStatus').textContent = remaining ? `Next home break in ${Math.floor(remaining / 60)}m ${remaining % 60}s.` : 'Available every 30 minutes. Cash is kept if your happiness is already full.';
}
document.getElementById('homeRelax').addEventListener('click', async () => {
  if (homeBreakPending) return;
  homeBreakPending = true; refreshHomeLife();
  const message = document.getElementById('homeBreakMessage');
  try {
    const response = await fetch('/property/relax', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data = await response.json();
    message.hidden = false; message.classList.toggle('is-error', !!data.error);
    message.textContent = data.error || data.msg;
    if (data.user) updateStats(data.user);
  } catch { message.hidden=false;message.textContent='Could not confirm your home break. Refresh before trying again.'; }
  finally {homeBreakPending=false;refreshHomeLife();}
});
document.addEventListener('player:updated', event => {Object.assign(homeLife, event.detail);refreshHomeLife();});
refreshHomeLife();setInterval(refreshHomeLife,1000);
