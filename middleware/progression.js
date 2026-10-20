const { get, withTransaction } = require('./db');

const GYMS = [
  { name: 'Street Gym', threshold: 0, multiplier: 1 },
  { name: 'Iron Works', threshold: 100, multiplier: 1.2 },
  { name: 'The Foundry', threshold: 500, multiplier: 1.4 },
  { name: 'Lockdown Elite', threshold: 1500, multiplier: 1.6 },
];

function getGymProgress(energySpent = 0) {
  const gym = [...GYMS].reverse().find(g => energySpent >= g.threshold) || GYMS[0];
  const nextGym = GYMS.find(g => energySpent < g.threshold) || null;
  return { ...gym, energySpent, nextGym,
    progress: nextGym ? Math.floor((energySpent - gym.threshold) / (nextGym.threshold - gym.threshold) * 100) : 100 };
}

const utcDay = () => new Date().toISOString().slice(0, 10);

function getMastery(row = {}, crime, speed = 0) {
  const successes = row?.successes || 0;
  const level = Math.min(10, 1 + Math.floor(successes / 10));
  const riskReduction = level - 1;
  return {
    level, successes, attempts: row?.attempts || 0,
    progress: level === 10 ? 100 : (successes % 10) * 10,
    nextSuccesses: level === 10 ? 0 : 10 - (successes % 10),
    riskReduction, rewardBonus: (level - 1) * 2,
    catchChance: crime ? Math.max(5, crime.catch_chance - Math.floor(speed / 50) * 5 - riskReduction) : null,
  };
}

async function getDailyProgress(userId, store = { get }) {
  const day = utcDay();
  const row = await store.get('SELECT * FROM daily_progress WHERE user_id=? AND day=?', [userId, day]);
  return { day, crimes: row?.crimes || 0, training: row?.training || 0, claimed: !!row?.claimed,
    complete: (row?.crimes || 0) >= 3 && (row?.training || 0) >= 2,
    resetAt: new Date(`${day}T00:00:00Z`).getTime() + 86400000 };
}

async function recordActivity(userId, activity, store) {
  if (!['crimes', 'training'].includes(activity)) throw new Error('Unknown objective activity');
  await store.run(`INSERT INTO daily_progress (user_id, day, ${activity}) VALUES (?,?,1)
    ON CONFLICT(user_id,day) DO UPDATE SET ${activity}=${activity}+1`, [userId, utcDay()]);
}

// Commit before sending the response so a success always means persisted progress.
function progressionAction(action) {
  return async (req, res, next) => {
    try {
      const result = await withTransaction(async tx => {
        const result=await action(req,tx);
        if(!result?.error&&req.session?.userId)await tx.run('UPDATE company_profiles SET last_action=? WHERE user_id=?',[Math.floor(Date.now()/1000),req.session.userId]);
        return result;
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { GYMS, getGymProgress, getMastery, getDailyProgress, recordActivity, progressionAction };
