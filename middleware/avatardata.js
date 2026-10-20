// ─── AVATAR LAYER SYSTEM ────────────────────────────────────────────────────
// Layered paper-doll avatar. Each category is one transparent PNG layer.

const AVATAR_CATEGORIES = [
  { id: 'head',     label: 'Heads',   icon: '👤', zIndex: 0 },
  { id: 'tattoos',  label: 'Tattoos',     icon: '🩸', zIndex: 1 },
  { id: 'eyebrows', label: 'Eyebrows',    icon: '〰️', zIndex: 2 },
  { id: 'eyes',     label: 'Eyes',        icon: '👁️', zIndex: 3 },
  { id: 'nose',     label: 'Nose',        icon: '👃', zIndex: 4 },
  { id: 'mouth',    label: 'Mouth',       icon: '👄', zIndex: 5 },
  { id: 'extras',   label: 'Extras',      icon: '🎭', zIndex: 6 },
  { id: 'hair',     label: 'Hair',        icon: '💈', zIndex: 7 },
  { id: 'features', label: 'Features', icon: '✦', zIndex: 6 },
  { id: 'eyewear', label: 'Eyewear', icon: '🕶', zIndex: 10 },
  { id: 'accessories', label: 'Accessories', icon: '♧', zIndex: 11 },
  { id: 'appendages', label: 'Appendages', icon: '♆', zIndex: 12 },
  { id: 'hats',     label: 'Hats',        icon: '🎩', zIndex: 8 },
];

const imported = require('./imported-avatar-parts.json');
const AVATAR_PARTS = Object.fromEntries(AVATAR_CATEGORIES.map(cat => [
  cat.id, [{ key: 'none', name: 'None', img: null, rep_cost: 0, free: true }, ...(imported[cat.id] || []).map(part => ({...part, free: true, rep_cost: 0}))]
]));
const DEFAULT_AVATAR = Object.fromEntries(AVATAR_CATEGORIES.map(cat => [cat.id, 'none']));
const STARTER_AVATARS = [];

function cleanAvatar(value) {
  let input = {};
  try { input = typeof value === 'string' ? JSON.parse(value) : value; } catch {}
  return Object.fromEntries(AVATAR_CATEGORIES.map(cat => {
    const part = AVATAR_PARTS[cat.id].find(p => p.key === input?.[cat.id]);
    return [cat.id, part?.key || 'none'];
  }));
}
function avatarImages(value) {
  const layers = cleanAvatar(value);
  return [...AVATAR_CATEGORIES].sort((a,b)=>a.zIndex-b.zIndex).map(cat => AVATAR_PARTS[cat.id].find(p => p.key === layers[cat.id])?.img).filter(Boolean);
}
module.exports = { AVATAR_CATEGORIES, AVATAR_PARTS, DEFAULT_AVATAR, STARTER_AVATARS, cleanAvatar, avatarImages };
