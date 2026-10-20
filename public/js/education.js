function refreshCourses() {
  document.querySelectorAll('[data-finishes]').forEach(timer => {
    const seconds = Math.max(0, Number(timer.dataset.finishes) - Math.floor(Date.now() / 1000));
    timer.textContent = seconds ? `Ready in ${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s · continues offline` : 'Study complete. Collect your permanent perk.';
    timer.nextElementSibling.disabled = seconds > 0 || timer.nextElementSibling.dataset.pending === 'true';
  });
}
let educationPending = false;
document.querySelectorAll('[data-course]').forEach(button => button.addEventListener('click', async () => {
  if (educationPending) return;
  educationPending = true;
  button.dataset.pending = 'true'; button.disabled = true;
  const message = document.getElementById('educationMsg');
  try {
    const response = await fetch('/education/' + button.dataset.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course_key: button.dataset.course }) });
    const data = await response.json();
    message.hidden = false; message.textContent = data.error || data.msg; message.classList.toggle('is-error', !!data.error);
    if (!data.error) { if (data.user) updateStats(data.user); location.reload(); }
  } catch {
    message.hidden = false; message.textContent = 'Could not confirm your course. Refresh to check its status.'; message.classList.add('is-error');
  } finally { educationPending = false; button.dataset.pending = 'false'; button.disabled = false; refreshCourses(); }
}));
refreshCourses();
setInterval(refreshCourses, 1000);
