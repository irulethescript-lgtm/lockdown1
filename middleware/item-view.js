const { getItem } = require('./item-catalog');
const { recoveryGroup } = require('./dynamics');

const ITEM_CATEGORIES = [
  { key: 'all', name: 'All items' },
  ...require('../data/torn-item-categories.json').categories,
  { key: 'gear', name: 'Gear' },
  { key: 'amenity', name: 'Property items' },
  { key: 'other', name: 'Other' },
];

function itemCategory(row, item, group) {
  if (item?.category && ITEM_CATEGORIES.some(c => c.key === item.category)) return item.category;
  if (row.item_type === 'weapon') {
    if (['gun', 'minigun', 'plasma_cutter', 'pump_shotgun'].includes(row.item_key)) return 'primary';
    if (row.item_key === 'compact_pistol') return 'secondary';
    return 'melee';
  }
  if (row.item_type === 'collectible') return 'collectibles';
  if (row.item_type === 'drug') return row.item_key === 'moonshine' ? 'alcohol' : 'drugs';
  if (row.item_type !== 'item') return row.item_type;
  if (item?.permanent) return 'other_boosters';
  if (['chocolate_bar'].includes(row.item_key)) return 'candy';
  if (['energy_drink', 'redbull', 'pulse_can', 'espresso_shot'].includes(row.item_key)) return 'energy_drinks';
  if (row.item_key === 'courage_flask') return 'alcohol';
  if (group?.key === 'medical') return 'medical';
  if (group?.key === 'booster') return 'other_boosters';
  return 'other';
}

function describeItem(row, cooldowns = [], equipped = {}) {
  const item = getItem(row.item_type, row.item_key);
  const usable = ['active','outfit'].includes(item?.usage?.mode) || item?.weaponProfile?.kind==='needle' || Boolean(item && ['item', 'drug'].includes(row.item_type) && (item.consumable || item.permanent));
  const group = usable && item?.weaponProfile?.kind!=='needle' && (!item.usage || item.consumable || item.useRule?.group) ? recoveryGroup(item, row.item_type) : null;
  const category = itemCategory(row, item, group);
  return {
    ...row,
    name: item?.name || row.item_key,
    desc: item?.desc || 'An item from your collection.',
    img: item?.img || '/amenities/default.png',
    category: ITEM_CATEGORIES.some(c => c.key === category) ? category : 'other',
    price: item?.price || item?.buy || 0,
    usable,
    usage:item?.usage||null,
    useKind:item?.useRule?.kind||null,
    known: Boolean(item),
    tradeable: Boolean(item && item.tradeable !== false),
    forSale: item?.for_sale !== false,
    weaponProfile:item?.weaponProfile||null,
    prepareable: item?.weaponProfile?.category==='temporary',
    sourceId: item?.source_id || null,
    sourceDescription: item?.source_description || '',
    sourceImageUnavailable: [1218,1229].includes(item?.source_id),
    sourceMarketValue: item?.source_market_value ?? null,
    equippable: Boolean(item && item.weaponProfile?.category!=='temporary' && ['weapon', 'armor', 'gear'].includes(row.item_type)),
    equipped: Boolean(equipped[row.item_type] === row.item_key),
    group,
    availableAt: group ? (group.key==='booster'?require('./item-actions').allowedAt:require('./medical').allowedAt)(group.key,cooldowns.find(c=>c.category===group.key)?.ready_at||0) : 0,
    readyAt: group ? cooldowns.find(c => c.category === group.key)?.ready_at || 0 : 0,
  };
}

function categoryCounts(rows) {
  return ITEM_CATEGORIES.map(category => ({
    ...category,
    count: rows.filter(row => category.key === 'all' || row.category === category.key)
      .reduce((sum, row) => sum + row.quantity, 0),
  }));
}

module.exports = { ITEM_CATEGORIES, describeItem, categoryCounts };
