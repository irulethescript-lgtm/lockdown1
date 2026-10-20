// Uses are extracted from the pinned Torn Stats descriptions, not inferred from price/type.
const source = require('../data/tornstats-items.json');
const records = new Map(source.items.map(row => [row.id, row]));
const STATS = ['strength','defense','speed','dexterity'];
const rules = {};
const DAY = 86400;
for (const row of source.items) {
  const text = row.description.split('Effect:')[1]?.trim();
  if (!text || !['Candy','Alcohol','Energy Drink'].includes(row.type)) continue;
  const match = text.match(/^Increases (happiness|nerve|energy) by (\d+) and booster cooldown by (\d+) (minutes?|hours?)\./);
  if (match) rules[row.id] = {kind:'resource', stat:match[1], amount:Number(match[2]), group:'booster', duration:Number(match[3])*(match[4].startsWith('hour')?3600:60)};
}
Object.assign(rules, {
  106:{kind:'stat',stats:['dexterity'],percent:1},329:{kind:'stat',stats:['speed'],percent:1},
  330:{kind:'stat',stats:['defense'],percent:1},331:{kind:'stat',stats:['strength'],percent:1},
  366:{kind:'resource',stat:'happiness',amount:2500},367:{kind:'hotel'},368:{kind:'jail'},
  472:{kind:'life'},473:{kind:'resource',stat:'energy',amount:500},474:{kind:'resource',stat:'nerve',amount:250},
  475:{kind:'resource',stat:'happiness',amount:10000},476:{kind:'addiction'},
  478:{kind:'stat',stats:STATS,percent:1},561:{kind:'education'},583:{kind:'workStats'},
  105:{kind:'entertainment'},145:{kind:'entertainment'},403:{kind:'tissues'},428:{kind:'casino'},
  365:{kind:'pack',choices:[['torn_66',20],['torn_731',20],['torn_67',30],['torn_68',50]]},
  364:{kind:'pack',choices:[['torn_12',100]]}, // Corrected below using source names.
  370:{kind:'pack',choices:[['torn_206',10],['torn_205',10]]},
  817:{kind:'bundle',category:'Alcohol',count:6},818:{kind:'bundle',category:'Energy Drink',count:6},
  1298:{kind:'bundle',category:'Candy',count:6},588:{kind:'goodie'},
  369:{kind:'lottery'},283:{kind:'donator'},
  793:{kind:'fruitcake'},794:{kind:'fruitcake'},560:{kind:'fruitcake'},795:{kind:'escapeCake'},
  820:{kind:'piggy'},396:{kind:'ticket'},422:{kind:'mirror'},
  627:{kind:'target',factor:.2},628:{kind:'target',factor:.2},629:{kind:'target',factor:.2},
  865:{kind:'target',factor:.25,steal:true},1029:{kind:'target',happy:2500},
});
const byName=name=>source.items.find(row=>row.name===name)?.id;
rules[364].choices=['Grenade','HEG'].map(name=>['torn_'+byName(name),100]);
for(const [id,r] of Object.entries(rules)) {
  if(['stat','hotel','jail','life','addiction','education','workStats'].includes(r.kind)||[473,474,475].includes(Number(id))) {
    r.group='booster';r.duration=r.kind==='jail'?3600:21600;
  }
}
// Unpublished drug cooldowns/overdose probabilities are not fabricated. The
// existing one-hour Lockdown drug timer remains, with the stated use corrected.
Object.assign(rules,{
  870:{kind:'drug',buff:{speed:.5,dexterity:.25}},
  196:{kind:'drug',resources:{nerve:[8,12]}},197:{kind:'drug',doubleHappy:true},
  198:{kind:'drug',buff:{defense:.5}},199:{kind:'drug',resources:{energy:50,nerve:5,happiness:[200,500]}},
  201:{kind:'drug',resources:{happiness:250},buff:{strength:.2,dexterity:.2}},
  203:{kind:'drug',resources:{happiness:500,energy:-25}},204:{kind:'drug',resources:{happiness:50},buff:{speed:.2}},
  205:{kind:'drug',resources:{happiness:75},buff:Object.fromEntries(STATS.map(s=>[s,.25]))},
  206:{kind:'drug',resources:{energy:250,happiness:75}},
});
for(const r of Object.values(rules))if(r.kind==='drug'){r.group='drug';r.duration=3600;}
const BOOKS={};
[744,745,746,747].forEach((id,i)=>BOOKS[id]={complete:{stats:[['strength','speed','defense','dexterity'][i]],percent:5,limit:10000000}});
BOOKS[748]={complete:{work:5,limit:2500}};
BOOKS[752]={battle:Object.fromEntries(STATS.map(s=>[s,.25]))};
[753,754,755,756].forEach((id,i)=>BOOKS[id]={battle:{[['strength','defense','speed','dexterity'][i]]:1}});
BOOKS[757]={gym:.2};
[758,759,760,761].forEach((id,i)=>BOOKS[id]={gymStat:['strength','defense','speed','dexterity'][i],gym:.3});
Object.assign(BOOKS,{
  762:{crimeXp:.25},763:{xp:.25},764:{hospital:.5},765:{jail:.5},766:{travel:.75},767:{capacity:10},
  770:{happyOverMax:true},774:{energyRegen:1.2},775:{nerveRegen:2},776:{happyRegen:2},
  779:{consumableCooldown:.5},780:{medicalCooldown:.5},781:{alcohol:2},782:{energyDrink:2},783:{candy:2},784:{maxEnergy:250},
});
for(const id of Object.keys(BOOKS))rules[id]={kind:'book'};
rules[785]={kind:'book'};
function ruleFor(item){return rules[item?.source_id??item?.id]||null;}
function referenceFor(record){return record.description.split('Effect:').slice(1).join('Effect:').trim().replace(/torn/gi,'Lock down');}
function usageFor(record){
 const reference=referenceFor(record), rule=rules[record.id];
 if(rule)return {reference,mode:'active',label:({book:'Read',pack:'Open',bundle:'Open',goodie:'Open',entertainment:'Play',fruitcake:'Combine',ticket:'Travel',piggy:'Manage savings',target:'Use on player',mirror:'Check appearance'})[rule.kind]||'Use'};
 if(record.type==='Enhancer')return {reference,mode:'passive',label:[386,419,420,421,567,1346].includes(record.id)?'Active while owned':'Requires its listed crime or feature'};
 if(['Primary','Secondary','Melee','Defensive'].includes(record.type))return {reference,mode:'equipment',label:'Equip in Equipment'};
 if(record.type==='Temporary'||(record.type==='Medical'&&record.id>=838&&record.id<=841))return {reference,mode:'combat',label:'Prepare in Equipment'};
 if(record.type==='Collectible')return {reference:reference||'A collectible for your collection or player trading.',mode:'collection',label:'Collect or trade'};
 if(record.type==='Clothing'||record.type==='Jewelry')return {reference:reference||'Wear as part of your outfit; no combat stat bonus.',mode:'outfit',label:'Wear / remove'};
 if(record.type==='Unused')return {reference:'Retired catalog entry.',mode:'unavailable',label:'Retired'};
 if(record.type==='Car')return {reference:reference||'A vehicle for racing and player trading.',mode:'context',label:'Racing is not available yet'};
 if(['Flower','Plushie','Artifact'].includes(record.type))return {reference:reference||'Collect or trade this item. Selected sets can be exchanged at the Museum.',mode:'context',label:'Museum collection'};
 if(record.type==='Medical')return {reference,mode:'medical',label:'Use medical treatment'};
 if(reference)return {reference,mode:'context',label:/Forgery|forgery/.test(reference)?'Used in forgery projects; production is not available yet':record.type==='Book'?'This book’s required feature is not available yet':'Requires its listed feature; activation is not available yet'};
 return {reference:record.type==='Tool'?'A tool for the activity described in its item details.':'Collect or trade this item.',mode:'collection',label:'Collect or trade'};
}
module.exports={records,rules,BOOKS,STATS,DAY,ruleFor,referenceFor,usageFor};
