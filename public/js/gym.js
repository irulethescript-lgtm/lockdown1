const gymState = JSON.parse(document.getElementById('gymState').textContent);
const energyInput = document.getElementById('trainingEnergy');
const trainButtons = [...document.querySelectorAll('.train-button')];
let trainingPending = false;

function refreshTraining() {
  const user = gymState.user;
  const amount = Number(energyInput.value);
  const max = Math.max(0, Math.min(user.energy, Math.floor(user.stamina / 2)));
  energyInput.max = max;
  const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= max;
  trainButtons.forEach(button => button.disabled = trainingPending || !valid || user.in_jail || user.in_hospital);
  document.querySelectorAll('.gainPreview').forEach(el => el.textContent = valid ? '+' + Math.floor(amount * 2 * gymState.gym.multiplier * (1 + (user.perks?.training || 0) / 100) * (1 + Math.min(100, Math.max(0, (user.happiness ?? 100) - 100)) / 400)) : '—');
  document.getElementById('trainingCost').textContent = valid ? `This session uses ${amount} energy, ${amount} happiness and ${amount * 2}% stamina, and earns ${amount * 15} XP. The current gym’s bonus applies to this session.` : max === 0 ? 'You need energy and stamina to train. Your resources recover over time.' : `Choose between 1 and ${max} energy for this session.`;
  document.getElementById('gymEnergy').textContent = `${user.energy} / ${user.max_energy}`;
  document.getElementById('gymStamina').textContent = user.stamina + '%';
  document.getElementById('gymHappiness').textContent = `${user.happiness} / ${user.max_happiness} happiness`;
}

function gymFeedback(message, error = false) {
  const el = document.getElementById('gymMsg');
  el.hidden = false;
  el.classList.toggle('is-error', error);
  el.textContent = message;
}

energyInput.addEventListener('input', refreshTraining);
document.querySelectorAll('[data-energy]').forEach(button => button.addEventListener('click', () => {
  energyInput.value = button.dataset.energy === 'max' ? Math.min(gymState.user.energy, Math.floor(gymState.user.stamina / 2)) : button.dataset.energy;
  refreshTraining();
}));
trainButtons.forEach(button => button.addEventListener('click', async () => {
  if (trainingPending) return;
  trainingPending = true;
  const stat = button.dataset.stat;
  refreshTraining();
  try {
    const response = await fetch('/gym/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stat, energy_amount: Number(energyInput.value) }) });
    const data = await response.json();
    if (data.error) { gymFeedback(data.error, true); return; }
    gymState.user = data.user;
    gymState.gym = data.gym;
    updateStats(data.user);
    gymFeedback([data.msg, ...(data.levelUp || []), data.unlockedGym ? `New gym unlocked: ${data.unlockedGym}!` : ''].filter(Boolean).join(' '));
    ['strength', 'defense', 'speed', 'dexterity'].forEach(key => document.getElementById('gymStat-' + key).textContent = data.user[key].toLocaleString());
    document.getElementById('gymName').textContent = data.gym.name;
    document.getElementById('gymMultiplier').textContent = Math.round((data.gym.multiplier - 1) * 100) + '% training bonus';
    document.getElementById('lifetimeEnergy').textContent = data.gym.energySpent + ' energy spent';
    document.getElementById('gymProgressBar').style.width = data.gym.progress + '%';
    document.getElementById('nextGym').textContent = data.gym.nextGym ? `${data.gym.nextGym.threshold - data.gym.energySpent} more energy to unlock ${data.gym.nextGym.name}.` : 'Every gym unlocked. Keep pushing your limits.';
    document.querySelectorAll('[data-gym-threshold]').forEach(row => {
      const unlocked = data.gym.energySpent >= Number(row.dataset.gymThreshold);
      row.classList.toggle('unlocked', unlocked);
      row.querySelector('.unlock-indicator').textContent = unlocked ? '✓' : '○';
    });
    gymState.history.push(data.historyEntry);
    gymState.history = gymState.history.slice(-20);
    document.getElementById('historyEmpty').hidden = true;
    drawGymChart();
  } catch {
    gymFeedback('Could not confirm the session. Refresh to check your stats before trying again.', true);
  } finally {
    trainingPending = false;
    refreshTraining();
  }
}));

function drawGymChart() {
  const canvas = document.getElementById('gymChart');
  const ctx = canvas.getContext('2d');
  const history = gymState.history;
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!history.length) return;
  const padding = { left: 60, top: 20, bottom: 30, right: 20 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const max = Math.max(10, ...history.flatMap(row => [row.strength, row.defense, row.speed, row.dexterity ?? 8])) * 1.1;
  ctx.font = '11px Arial';
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + chartHeight * i / 4;
    ctx.strokeStyle = '#30363e';
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    ctx.fillStyle = '#909aaa'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max * (1 - i / 4)).toLocaleString(), padding.left - 8, y + 4);
  }
  for (const [key, color] of [['strength', '#d4ac7c'], ['defense', '#9aaebf'], ['speed', '#a6bc97'], ['dexterity', '#b6a0ce']]) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    const points = history.map((row, i) => [padding.left + chartWidth * i / Math.max(1, history.length - 1), padding.top + chartHeight * (1 - (row[key] ?? 8) / max)]);
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    points.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); });
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#909aaa'; ctx.fillText('Recent sessions →', width / 2, height - 4);
}
refreshTraining();
drawGymChart();

document.addEventListener('player:updated', event => { gymState.user = event.detail; refreshTraining(); });
