// Supplied reference values; unknown values deliberately remain null.
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases = { tauruspt92:'taurus', metalnunchaku:'metalnunchakus' };
const profiles = new Map(require('../data/weapon-stats.json').weapons.map(row=>[normalize(row.name),row]));
const temporary = {};
function temp(name, values) { temporary[normalize(name)] = {name, category:'temporary', ...values}; }
for (const [name,damage,accuracy,stealth] of [
 ['Book',10,88,7.5],['Brick',28,43,7.3],['Claymore Mine',83,27,3.3],['Fireworks',45,34,4.3],
 ['Grenade',86,106,4],['HEG',90,116,3.8],['Molotov Cocktail',85,78,3.9],['Nail Bomb',99,106,3],
 ['Ninja Star',67,67,7.6],['Snowball',5,50,7.9],['Stick Grenade',87,97,3.6],
 ['Throwing Knife',69,63,7.9],['Trout',35,90,7.3],['Wrench',14,53,7.6],
]) temp(name,{kind:'damage',damage:[damage,damage],accuracy:[accuracy,accuracy],stealth,burn:name==='Molotov Cocktail'});
for (const [name,stat,factor,min,max,stealth,accuracy] of [
 ['Bolas','skip',0,3,3,8.2,31],
 ['Concussion Grenade','dexterity',.2,15,20,10,200],['Flash Grenade','speed',.2,15,20,10,200],
 ['Pepper Spray','dexterity',.2,15,20,10,200],['Smoke Grenade','speed',1/3,120,180,10,200],
 ['Tear Gas','dexterity',1/3,120,180,10,200],
]) temp(name,{kind:'debuff',stat,factor,duration:[min,max],stealth,accuracy:[accuracy,accuracy]});
for (const [name,stat,boost,heal] of [['Epinephrine','strength',5,0],['Melatonin','speed',5,0],['Serotonin','defense',3,.25],['Tyrosine','dexterity',5,0]])
 temp(name,{kind:'needle',stat,boost,heal,duration:[120,120],stealth:10});
for (const name of ['Party Popper','Glitter Bomb']) temp(name,{kind:'decorative',accuracy:[200,200],stealth:10});
temp('Stygian Darkness',{kind:'boss',accuracy:[200,200],stealth:10});
function profileFor(item) {
 const name=normalize(item?.source_name || item?.name || '');
 return profiles.get(aliases[name] || name) || temporary[name] || null;
}
function range(values) { return values ? (values[0]===values[1] ? values[0].toFixed(2) : values.map(n=>n.toFixed(2)).join('–')) : 'Unknown'; }
function summary(p) {
 if(p.kind==='needle')return `+${p.boost*100}% ${p.stat} for 120s${p.heal?'; restores 25% life':''}. Requires BIO3420. SPT2480 increases the bonus by 10%.`;
 if(p.kind==='debuff')return p.stat==='skip'?'Ensnared: opponent misses their next 3 turns.':`${p.name}: opponent ${p.stat} ×${p.factor.toFixed(2)} for ${p.duration.join('–')}s.`;
 if(p.kind==='decorative')return 'Festive visual effect; no damage or stat changes.';
 if(p.kind==='boss')return 'Draws an interdimensional opponent into the physical realm. No eligible target in citizen battles.';
 return `Damage ${range(p.damage)} · Accuracy ${range(p.accuracy)} · Stealth ${p.stealth}.${p.burn?' Causes burning damage.':''}${p.caliber?` ${p.caliber} · ${p.clip}-round magazine · ${p.rate.join('–')} rounds/attack.`:''}`;
}
module.exports={profileFor,range,summary,profiles,temporary};
