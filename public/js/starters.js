document.querySelectorAll('[data-starter]').forEach(button => {
  button.addEventListener('click', async () => {
    const buttons = document.querySelectorAll('[data-starter]');
    buttons.forEach(b => b.disabled = true);
    const status = document.getElementById('starter-status');
    status.textContent = 'Saving your look…';
    try {
      const response = await fetch('/surgeon/starter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: button.dataset.starter }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || 'Could not save your look.');
      window.location.reload();
    } catch (err) {
      status.textContent = 'Could not save your look. Please try again.';
      buttons.forEach(b => b.disabled = false);
    }
  });
});
