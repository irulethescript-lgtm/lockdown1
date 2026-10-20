const dailyButton = document.getElementById('claimDaily');
if (dailyButton) dailyButton.addEventListener('click', async () => {
  dailyButton.disabled = true;
  const feedback = document.getElementById('dailyFeedback');
  try {
    const response = await fetch('/daily/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await response.json();
    feedback.textContent = data.error || data.msg;
    if (data.error) { dailyButton.disabled = false; return; }
    updateStats(data.user);
    dailyButton.textContent = 'Collected ✓';
  } catch {
    feedback.textContent = 'Could not collect the reward. Try again.';
    dailyButton.disabled = false;
  }
});
const resetLabel = document.getElementById('dailyReset');
if (resetLabel) {
  function updateDailyReset() {
    const remaining = Math.max(0, Number(resetLabel.dataset.reset) - Date.now());
    resetLabel.textContent = remaining === 0 ? 'New objectives ready — refresh' : `Resets in ${Math.floor(remaining / 3600000)}h ${Math.floor(remaining % 3600000 / 60000)}m`;
  }
  updateDailyReset();
  setInterval(updateDailyReset, 60000);
}
