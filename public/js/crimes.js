const crimeState = JSON.parse(document.getElementById('crimeState').textContent);
let crimePending = false;

function refreshCrimes() {
  const user = crimeState.user;
  const approach = crimeState.approaches.find(a => a.key === document.querySelector('[name=approach]:checked').value);
  document.getElementById('crimeNerve').textContent = `${user.nerve} / ${user.max_nerve}`;
  document.getElementById('crimeStam').textContent = user.stamina + '%';
  document.getElementById('crimeSpeed').textContent = user.speed;
  document.getElementById('crimeHeat').textContent = user.heat || 0;
  document.getElementById('heatBar').style.width = (user.heat || 0) + '%';
  document.querySelectorAll('[name=approach]').forEach(input => input.disabled = crimePending);
  if (user.criminal) {
    document.getElementById('criminalBonus').textContent = `+${user.criminal.nerveBonus} NERVE CAPACITY`;
    document.getElementById('criminalExperience').textContent = `${user.criminal.xp} criminal experience`;
    document.getElementById('criminalProgressBar').style.width = user.criminal.progress + '%';
    document.getElementById('criminalNext').textContent = user.criminal.nextAt ? `${user.criminal.nextAt-user.criminal.xp} experience to your next nerve point.` : 'Maximum criminal nerve bonus earned.';
  }
  const restricted = user.in_jail || user.in_hospital;
  document.getElementById('crimeRecovery').hidden = !restricted;
  document.getElementById('crimeRestriction').textContent = user.in_jail ? 'You are in jail.' : user.in_hospital ? 'You are in the hospital.' : '';
  document.getElementById('crimeRecoveryLink').href = user.in_jail ? '/jail' : '/hospital';
  crimeState.crimes.forEach(crime => {
    const card = document.getElementById('crime-' + crime.key);
    const button = card.querySelector('[data-crime]');
    const reason = user.in_jail ? 'In jail' : user.in_hospital ? 'In hospital' : user.nerve < crime.nerve ? 'Not enough nerve' : user.stamina < crime.stamina ? 'Not enough stamina' : '';
    button.disabled = crimePending || !!reason;
    button.textContent = crimePending ? 'Please wait…' : reason || 'Commit crime ↗';
    const skill = crimeState.mastery[crime.key];
    card.querySelector('.crime-risk').textContent = Math.min(90, Math.max(5, crime.catch_chance - Math.floor(user.speed / 50) * 5 - skill.riskReduction + Math.floor((user.heat || 0) / 5) + approach.risk - (user.perks?.crimeRisk || 0))) + '%';
    const multiplier = (1 + skill.rewardBonus / 100) * approach.reward * (1 + (user.perks?.crimeCash || 0) / 100);
    card.querySelector('.crime-cash').textContent = '$' + Math.floor(crime.cash[0] * multiplier).toLocaleString() + '–$' + Math.floor(crime.cash[1] * multiplier).toLocaleString();
    card.querySelector('.mastery-level').textContent = skill.level;
    card.querySelector('.mastery-successes').textContent = skill.successes + ' successes';
    card.querySelector('.mastery-bar').style.width = skill.progress + '%';
    card.querySelector('.mastery-next').textContent = skill.nextSuccesses ? `${skill.nextSuccesses} successes to the next mastery level` : 'Maximum mastery reached';
    card.querySelector('.mastery-bonus').textContent = `+${skill.rewardBonus}% cash · −${skill.riskReduction} points catch risk`;
  });
}

document.querySelectorAll('[data-crime]').forEach(button => button.addEventListener('click', async () => {
  if (crimePending) return;
  crimePending = true;
  refreshCrimes();
  const message = document.getElementById('crimeMsg');
  try {
    const response = await fetch('/crimes/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crime_key: button.dataset.crime, approach: document.querySelector('[name=approach]:checked').value }) });
    const data = await response.json();
    message.hidden = false;
    message.classList.toggle('is-error', !!data.error || data.caught);
    message.textContent = [data.error || data.msg, ...(data.levelUp || [])].join(' ');
    if (data.user) { crimeState.user = data.user; updateStats(data.user); }
    if (data.mastery) crimeState.mastery[button.dataset.crime] = data.mastery;
    if (data.error && !data.user) message.textContent += ' Refresh the page to check your current resources.';
  } catch {
    message.hidden = false;
    message.classList.add('is-error');
    message.textContent = 'Could not confirm the outcome. Refresh to check your activity before trying again.';
  } finally {
    crimePending = false;
    refreshCrimes();
  }
}));
function updateIsolationTimer() {
  const user = crimeState.user;
  const approach = crimeState.approaches.find(a => a.key === document.querySelector('[name=approach]:checked').value);
  if (!user.in_jail) return;
  const remaining = Math.max(0, user.jail_until - Math.floor(Date.now() / 1000));
  document.getElementById('crimeJailTimer').textContent = remaining ? ` · Release in ${Math.floor(remaining / 60)}m ${remaining % 60}s` : ' · Your sentence is complete. Refresh to continue.';
}
document.querySelectorAll('[name=approach]').forEach(input => input.addEventListener('change', refreshCrimes));
refreshCrimes();
updateIsolationTimer();
setInterval(updateIsolationTimer, 1000);

document.addEventListener('player:updated', event => { crimeState.user = event.detail; refreshCrimes(); updateIsolationTimer(); });
