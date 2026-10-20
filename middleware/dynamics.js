// Shared rules for the long game. All times are seconds; perks come only from claimed courses.
const COURSES = [
  { key: 'streetcraft', name: 'Streetcraft', track: 'Crime', cost: 1000, duration: 900, requires: null, desc: 'Read patrol patterns. Permanently lowers catch risk by 3 percentage points.', perk: { crimeRisk: 3 } },
  { key: 'logistics', name: 'Contraband Logistics', track: 'Crime', cost: 3500, duration: 7200, requires: 'streetcraft', desc: 'Build reliable contacts. Permanently earns 10% more crime cash.', perk: { crimeCash: 10 } },
  { key: 'conditioning', name: 'Physical Conditioning', track: 'Training', cost: 1000, duration: 1800, requires: null, desc: 'Build a routine. Permanently improves gym gains by 10%.', perk: { training: 10 } },
  { key: 'sports_science', name: 'Sports Science', track: 'Training', cost: 5000, duration: 14400, requires: 'conditioning', desc: 'Refine your technique. Adds another 15% to gym gains.', perk: { training: 15 } },
  { key: 'anatomy', name: 'Applied Anatomy', track: 'Combat', cost: 2000, duration: 3600, requires: null, desc: 'Find weak spots. Permanently increases damage dealt by 8%.', perk: { damage: 8 } },
  { key: 'self_defense', name: 'Defensive Tactics', track: 'Combat', cost: 5000, duration: 10800, requires: 'anatomy', desc: 'Protect yourself. Permanently reduces incoming damage by 8%.', perk: { protection: 8 } },
];
COURSES.push(
  {key:'medical_training',name:'Medical Effectiveness',track:'Medical',cost:15000,duration:28800,requires:'anatomy',desc:'Improve medical healing and hospital time removal by 20%.',perk:{medical:20}},
  {key:'intravenous',name:'Intravenous Therapy',track:'Medical',cost:10000,duration:14400,requires:'anatomy',desc:'Unlock filling and using compatible blood bags.',perk:{intravenous:1}},
  {key:'brain_surgery',name:'Brain Surgery',track:'Medical',cost:50000,duration:86400,requires:'intravenous',desc:'Qualify for the Brain Surgeon job and unlock reviving when hired.',perk:{brainSurgery:1}}
);
// Lockdown course prices and durations; supplied benefit rules use their original IDs.
const businessCourses=[
 ['LAW2910','Property Law','5% estate-agent purchase discount'],['BUS3130','Advanced Business Management','Unlock the final two company and staff-room upgrades'],
 ['BUS2200','Production Planning','2% company productivity'],['BUS2500','Operations Management','2% company productivity'],['BUS2800','Supply Management','2% company productivity'],['BUS2100','Business Foundations','2% company productivity'],['BUS2120','Enterprise Management','2% company productivity'],
 ['BUS2300','Employee Management','5% employee effectiveness'],['BUS2600','Organizational Leadership','7% employee effectiveness'],['BUS2400','Marketing','Advertising effectiveness bonus'],['LAW2100','Business Law','Advertising effectiveness bonus'],['BUS2700','Pricing Strategy','10% higher prices without losing demand'],['BUS2900','Advanced Pricing','5% higher prices without losing demand'],['BUS2110','Workforce Development','Bonus daily working stats'],['MTH2280','Business Mathematics','1% company productivity']
];
COURSES.push(...businessCourses.map(([key,name,desc])=>({key,name,desc,track:'Business',cost:25000,duration:86400,requires:null,perk:{}})));
COURSES.push(
 {key:'BIO3420',name:'Bachelor of Biology',track:'Combat',cost:50000,duration:86400,requires:null,desc:'Unlock combat needles.',perk:{}},
 {key:'SPT2480',name:'Sports Medicine',track:'Combat',cost:50000,duration:86400,requires:'BIO3420',desc:'Increase needle bonuses by 10%.',perk:{}},
 {key:'martial_kick',name:'Kick Training',track:'Combat',cost:5000,duration:14400,requires:'self_defense',desc:'Unlock Kick: damage 30, accuracy 40.71.',perk:{}}
);
const APPROACHES = [
  { key: 'cautious', name: 'Cautious', risk: -8, reward: 0.75, heat: 3, desc: 'Less risk, 75% cash, +3 heat' },
  { key: 'balanced', name: 'Balanced', risk: 0, reward: 1, heat: 6, desc: 'Standard risk and cash, +6 heat' },
  { key: 'bold', name: 'Bold', risk: 12, reward: 1.5, heat: 12, desc: 'More risk, 150% cash, +12 heat' },
];
const STANCES = {
  balanced: { name: 'Balanced', damage: 1, defense: 1 },
  aggressive: { name: 'Aggressive', damage: 1.2, defense: 0.8 },
  defensive: { name: 'Defensive', damage: 0.85, defense: 1.25 },
};
function getPerks(completedKeys = []) {
  const perks = { crimeRisk: 0, crimeCash: 0, training: 0, damage: 0, protection: 0, medical:0, intravenous:0, brainSurgery:0 };
  for (const course of COURSES.filter(c => completedKeys.includes(c.key))) {
    for (const [key, amount] of Object.entries(course.perk)) perks[key] += amount;
  }
  return perks;
}
function getHeat(row, now = Math.floor(Date.now() / 1000)) {
  return Math.max(0, Math.min(100, (row?.heat || 0) - Math.max(0, Math.floor((now - (row?.heat_updated ?? now)) / 60))));
}
function crimeQuote(crime, mastery, user, approach) {
  return {
    risk: Math.min(90, Math.max(5, crime.catch_chance - Math.floor(user.speed / 50) * 5 - mastery.riskReduction + Math.floor((user.heat || 0) / 5) + approach.risk - (user.perks?.crimeRisk || 0))),
    multiplier: (1 + mastery.rewardBonus / 100) * approach.reward * (1 + (user.perks?.crimeCash || 0) / 100),
  };
}
function recoveryGroup(item, type) {
  const useRule=require('./item-uses').ruleFor(item);
  if(useRule?.group)return {key:useRule.group,label:useRule.group==='drug'?'Drug':'Booster',duration:useRule.duration};
  const medical=require('./medical').rule(item);
  if(medical)return {key:medical.opium?'drug':'medical',label:medical.opium?'Drug':'Medical',duration:medical.cooldown*60};
  if (type === 'drug' || item.permanent) return { key: 'drug', label: 'Drug', duration: 3600 };
  if (item.effect.energy || item.effect.nerve || item.effect.stamina) return { key: 'booster', label: 'Booster', duration: 900 };
  return { key: 'medical', label: 'Medical', duration: 300 };
}

// Battle time advances six seconds per round. The route persists sidecar combat
// state (ammo, consumed temporary and remaining buffs) with rewards atomically.
function simulateFight(attacker, defender, stanceKey, random = Math.random, options = {}) {
  const {AMMO}=require('./weapons');
  const stance=STANCES[stanceKey];
  const log=[stance.name+' stance. Weapon damage and accuracy combine with strength, defense, speed and dexterity.'];
  let aHp=attacker.hp,dHp=defender.hp,damageDealt=0,damageTaken=0,elapsed=0;
  const manual=!!options.manual;
  const fighters=options.state?.fighters || [attacker,defender].map(u=>({
    user:u,combat:u.combat||{weapon:null,ammo:{},buffs:[],unarmed:{name:'Fists',damage:10,accuracy:50}},
    base:u._combatBaseStats||Object.fromEntries(['strength','defense','speed','dexterity'].map(k=>[k,u[k]??u.speed])),
    debuffs:[],skip:0,burns:[]
  }));
  const power=u=>Math.max(.25,(u.stamina??100)/100);
  const stat=(f,key)=>Math.max(0,f.base[key]*(1+f.combat.buffs.filter(b=>b.stat===key&&b.remaining>elapsed).reduce((n,b)=>n+b.bonus,0))*f.debuffs.filter(b=>b.stat===key&&b.until>elapsed).reduce((n,b)=>n*b.factor,1));
  const chance=(f,t,accuracy)=>Math.max(.1,Math.min(.995,1.5*Math.max(1,stat(f,'speed')*power(f.user))/(Math.max(1,stat(f,'speed')*power(f.user))+Math.max(1,stat(t,'dexterity')*power(t.user)))*accuracy/50));
  const inflict=(attacking,amount)=>{if(attacking){dHp-=amount;damageDealt+=amount;}else{aHp-=amount;damageTaken+=amount;}};
  function damage(f,t,attacking,w,ammo=AMMO.standard){
    const offense=stat(f,'strength')*power(f.user)*(attacking?stance.damage:1)*(w.damage/10)*ammo.damage;
    const defense=stat(t,'defense')*power(t.user)*(attacking?1:stance.defense)*(1-ammo.pierce);
    const speedFactor=Math.max(.85,Math.min(1.15,1+(stat(f,'speed')-stat(t,'speed'))/Math.max(1,stat(f,'speed')+stat(t,'speed'))*.15));
    const critical=random()<Math.min(.25,.05+stat(f,'speed')/Math.max(1,stat(t,'speed'))*.02);
    const value=Math.max(1,offense*(.9+random()*.2)*speedFactor-defense*.45);
    const zones=critical?['head','throat','heart']:['chest','stomach','groin','left arm','right arm','left leg','right leg','left hand','right hand','left foot','right foot'];
    const zone=zones[Math.floor(random()*zones.length)];
    const multiplier=critical?3.5:['chest','stomach','groin'].includes(zone)?2:['left hand','right hand','left foot','right foot'].includes(zone)?.7:1;
    return {zone,amount:Math.max(1,Math.floor(value*multiplier*(1+(f.user.perks?.damage||0)/100)*(1-(t.user.perks?.protection||0)/100))),critical};
  }
  for(const f of fighters)f.user.combat=f.combat;
  let round=0,lastRound=options.state?.round||0;
  const first=lastRound+1;
  for(round=first;round<=25&&(!manual||round===first)&&aHp>0&&dHp>0;round++){
    lastRound=round;elapsed=manual?options.elapsed:(round-1)*6;
    const aFirst=manual || stat(fighters[0],'speed')*power(attacker)>=stat(fighters[1],'speed')*power(defender);
    for(const attacking of aFirst?[true,false]:[false,true]){
      const f=fighters[attacking?0:1],t=fighters[attacking?1:0],c=f.combat;
      for(const burn of f.burns.filter(b=>b.until>elapsed)){
        inflict(!attacking,burn.amount);log.push('R'+round+': '+f.user.username+' takes '+burn.amount+' burning damage.');
      }
      if(aHp<=0||dHp<=0)break;
      if(f.skip>0){f.skip--;log.push('R'+round+': '+f.user.username+' is Ensnared and misses a turn.');continue;}
      if(manual&&attacking&&options.action==='reload'){
        const w=c.weapon,k=w.profile.caliber+'|'+w.ammo_type,count=Math.min(w.profile.clip-w.loaded,c.ammo[k]||0);
        c.ammo[k]-=count;w.loaded+=count;log.push('R'+round+': '+f.user.username+' reloads '+w.name+' ('+count+' rounds).');continue;
      }
      const temp=c.temporary;
      if(temp&&!c.usedTemporary&&(!manual||!attacking||options.action==='temporary')){
        c.usedTemporary=true;
        log.push('R'+round+': '+f.user.username+' uses '+temp.name+'.');
        if(temp.kind==='needle'){
          const bonus=temp.boost*c.needleBoost;
          const previous=c.buffs.find(b=>b.stat===temp.stat);
          if(previous){previous.bonus=(previous.remaining>elapsed?previous.bonus:0)+bonus;previous.remaining=elapsed+120;}
          else c.buffs.push({stat:temp.stat,bonus,remaining:elapsed+120});
          if(temp.heal){const healed=Math.floor(f.user.max_hp*temp.heal);if(attacking)aHp=Math.min(f.user.max_hp,aHp+healed);else dHp=Math.min(f.user.max_hp,dHp+healed);}
          log.push('+'+(bonus*100).toFixed(0)+'% '+temp.stat+' for 120 seconds.');continue;
        }
        if(temp.kind==='decorative'){log.push('[festive] '+temp.name+' bursts across the battlefield.');continue;}
        if(random()>=chance(f,t,temp.accuracy[0])){log.push(temp.name+' misses.');continue;}
        if(temp.kind==='debuff'){
          if(temp.stat==='skip')t.skip+=3;
          else t.debuffs.push({stat:temp.stat,factor:temp.factor,until:elapsed+temp.duration[0]+Math.floor(random()*(temp.duration[1]-temp.duration[0]+1))});
          log.push(t.user.username+' suffers '+temp.name+'.');continue;
        }
        const hit=damage(f,t,attacking,{damage:temp.damage[0]});
        inflict(attacking,hit.amount);
        log.push(temp.name+' hits for '+hit.amount+' in the '+hit.zone+'.');
        if(temp.burn)t.burns.push({amount:Math.max(1,Math.floor(hit.amount*.1)),until:elapsed+24});
        if(aHp<=0||dHp<=0)break;
        continue;
      }
      let w=c.weapon||c.unarmed,ammo=AMMO.standard;
      if(w.profile?.caliber){
        if(w.loaded<=0){
          const k=w.profile.caliber+'|'+w.ammo_type,available=c.ammo[k]||0;
          if(available>0){
            const count=Math.min(w.profile.clip,available);c.ammo[k]-=count;w.loaded=count;
            log.push('R'+round+': '+f.user.username+' reloads '+w.name+' ('+count+' rounds).');continue;
          }
          w=c.unarmed;log.push(f.user.username+' is out of ammunition and switches to '+w.name+'.');
        }else{
          const [low,high]=w.profile.rate;
          const fired=Math.min(w.loaded,low+Math.floor(random()*(high-low+1)));w.loaded-=fired;
          ammo=AMMO[w.ammo_type]||AMMO.standard;
          log.push('R'+round+': '+f.user.username+' fires '+fired+' rounds ('+w.ammo_type+').');
        }
      }
      if(random()>=chance(f,t,w.accuracy*ammo.accuracy)){log.push('R'+round+': '+f.user.username+' misses; '+t.user.username+' evades.');continue;}
      const hit=damage(f,t,attacking,w,ammo);inflict(attacking,hit.amount);
      log.push('R'+round+': '+f.user.username+' hits with '+w.name+' for '+hit.amount+' in the '+hit.zone+(hit.critical?' (critical ×3.5)':'')+'.');
      if(ammo.burn)t.burns.push({amount:Math.max(1,Math.floor(hit.amount*.1)),until:elapsed+24});
      if(aHp<=0||dHp<=0)break;
    }
  }
  const seconds=lastRound*6;
  if(!manual)for(const f of fighters)for(const b of f.combat.buffs)b.remaining=Math.max(0,b.remaining-seconds);
  return {state:{fighters,round:lastRound},result:dHp<=0?'win':aHp<=0?'loss':manual&&lastRound<25?'ongoing':'draw',aHp:Math.max(0,aHp),dHp:Math.max(0,dHp),damageDealt,damageTaken,log,seconds};
}
module.exports={COURSES,APPROACHES,STANCES,getPerks,getHeat,crimeQuote,recoveryGroup,simulateFight};
