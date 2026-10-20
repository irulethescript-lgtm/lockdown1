// Source metadata is a local Torn Stats snapshot. Gameplay uses Lockdown rules.
const source = require('../data/tornstats-items.json');
const legacyTypes = require('../data/torn-legacy-types.json').types;
const categoryLabels = Object.fromEntries(require('../data/torn-item-categories.json').categories.map(c => [c.key, c.name]));
const categories = {
  Primary:'primary', Secondary:'secondary', Melee:'melee', Temporary:'temporary',
  Defensive:'armor', Medical:'medical', Drug:'drugs', 'Energy Drink':'energy_drinks',
  Alcohol:'alcohol', Candy:'candy', Booster:'other_boosters', Enhancer:'enhancers',
  Special:'special', Tool:'tools', Material:'materials', 'Supply Pack':'supply_packs',
  Clothing:'clothing', Jewelry:'jewelry', Flower:'flowers', Plushie:'plushies',
  Car:'cars', Artifact:'artifacts', Collectible:'collectibles', Other:'miscellaneous',
  Unused:'miscellaneous', Book:'books',
};
const profiles = {
  melee: { type:'weapon', effect:{ strength:15 } },
  secondary: { type:'weapon', effect:{ strength:30, speed:5 } },
  primary: { type:'weapon', effect:{ strength:60 } },
  armor: { type:'armor', effect:{ defense:40, max_hp:10 } },
  medical: { type:'item', effect:{ hp:100 }, consumable:true },
  drugs: { type:'drug', effect:{ energy:80 }, consumable:true },
  energy_drinks: { type:'item', effect:{ energy:50 }, consumable:true },
  alcohol: { type:'item', effect:{ nerve:3 }, consumable:true },
  candy: { type:'item', effect:{ energy:15 }, consumable:true },
  other_boosters: { type:'item', effect:{ stamina:25 }, consumable:true },
};
const statLabels = { strength:'STR', defense:'DEF', speed:'SPD', max_hp:'Max HP', hp:'HP', energy:'Energy', nerve:'Nerve', stamina:'Stamina' };

function categoryFor(sourceType) {
  if (!Object.hasOwn(categories, sourceType)) throw new Error('Unknown source item type: ' + sourceType);
  return categories[sourceType];
}
function buildCatalog() {
  const catalogs = { item:{}, weapon:{}, armor:{}, gear:{}, drug:{} };
  for (const record of source.items) {
    const { id, name } = record;
    const category = categoryFor(record.type);
    const profile = profiles[category];
    // Existing typed keys can be referenced by inventories, equipped slots and listings.
    const type = legacyTypes[id] || profile?.type || 'item';
    const balance = ['weapon','armor'].includes(type)
      ? (profile?.type === type ? profile : profiles[type === 'weapon' ? 'melee' : 'armor'])
      : (profile && ['item','drug'].includes(profile.type) ? profile : null);
    const useRule=require('./item-uses').ruleFor(record);
    const usage=require('./item-uses').usageFor(record);
    const effect = { ...(balance?.effect || {}) };
    if(useRule || ['Booster','Drug','Candy','Energy Drink','Alcohol'].includes(record.type))for(const stat of Object.keys(effect))delete effect[stat];
    const weaponProfile = require('./weapon-profiles').profileFor({source_name:name});
    if(weaponProfile)for(const stat of Object.keys(effect))delete effect[stat];
    const medical = require('./medical').RULES[id];
    if (medical) for (const key of Object.keys(effect)) delete effect[key];
    const unused = record.type === 'Unused';
    const priceSource = record.buy > 0 ? 'buy' : record.market_value > 0 ? 'market_value' : record.sell > 0 ? 'sell' : 'fallback';
    const price = priceSource === 'fallback' ? 250 : record[priceSource];
    const desc = medical ? (medical.opium ? "Clears standard hospital time, restores life up to 50%, +30% defense during a 120–180m drug cooldown." : medical.withdraw ? "Withdraw 30% life into a bag of your blood type. Requires Intravenous Therapy; +60m medical cooldown." : medical.radiation ? "Radiation hospitalization only: removes 3h hospital time and 12h radiation; +3h medical cooldown." : `Restores ${medical.life}% life; removes ${medical.minutes}m standard hospital time; +${medical.cooldown}m medical cooldown.${medical.blood ? " Requires Intravenous Therapy and compatible blood." : ""}`)
      : usage.reference || (balance && Object.keys(effect).length
        ? 'Lockdown effect: ' + Object.entries(effect).map(([stat,value]) => '+' + value + ' ' + statLabels[stat]).join(', ') + '.'
        : 'Collect or trade this item.');
    catalogs[type]['torn_' + id] = {
      name:name.replace(/torn/gi, 'Lock down'), source_name:name, source_id:id, source_type:record.type,
      source_description:record.description.replace(/torn/gi, 'Lock down'), source_buy:record.buy, source_sell:record.sell,
      source_market_value:record.market_value, source_circulation:record.circulation,
      price_source:priceSource, category, price,
      img:'/images/torn-items/' + id + '.png', weaponProfile, desc:weaponProfile ? require('./weapon-profiles').summary(weaponProfile) : desc,
      effect, usage, useRule, consumable:Boolean(medical) && !unused, tier:1,
      tradeable:category !== 'books' && !unused, for_sale:!unused,
    };
  }
  return catalogs;
}
module.exports = { buildCatalog, categoryFor };
