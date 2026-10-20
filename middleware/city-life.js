// City progression rules shared by persistent actions and page summaries.
const RELAX_COST = 50;
const RELAX_COOLDOWN = 1800;
function criminalProgress(experience = 0) {
  const xp = Math.max(0, Math.floor(experience));
  const nerveBonus = Math.min(25, Math.floor(xp / 100));
  return { xp, nerveBonus, nextAt: nerveBonus < 25 ? (nerveBonus + 1) * 100 : null,
    progress: nerveBonus < 25 ? xp % 100 : 100 };
}
function happinessMultiplier(happiness = 100) {
  return 1 + Math.sqrt(Math.max(0, happiness - 100)) / 40;
}
module.exports = { RELAX_COST, RELAX_COOLDOWN, criminalProgress, happinessMultiplier };
