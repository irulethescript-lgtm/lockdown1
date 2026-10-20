// Catalog identity is always (type, key): some legacy items share keys.
const { ITEMS, WEAPONS, ARMOR, GEAR, DRUGS, CELL_AMENITIES, PRISONS } = require('./gamedata');
const { TRAVEL_ITEMS } = require('./travel');
const CATALOGS = { item:ITEMS, weapon:WEAPONS, armor:ARMOR, gear:GEAR, drug:DRUGS, amenity:CELL_AMENITIES, collectible:TRAVEL_ITEMS };
function getItem(type, key) {
  if (typeof type!=='string' || typeof key!=='string' || !Object.hasOwn(CATALOGS,type)) return null;
  return Object.hasOwn(CATALOGS[type],key) ? CATALOGS[type][key] : null;
}
function canBuyInPrison(type, key, prisonId) {
  const item=getItem(type,key), prison=PRISONS.find(p=>p.id===prisonId);
  if(!item || item.for_sale === false || !prison || !['item','weapon','armor','gear','drug'].includes(type)) return false;
  return true; // Availability now comes from shared rotating stock, not relocation.

}
module.exports={CATALOGS,getItem,canBuyInPrison};
