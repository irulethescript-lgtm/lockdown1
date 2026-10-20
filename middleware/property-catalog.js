// Stable legacy keys preserve existing ownership and furnishing saves.
const rows = [
 ['starter','Shack',0,100,0],['trailer','Trailer',5000,110,10],['townhouse','Apartment',25000,125,25],
 ['semi','Semi-Detached House',75000,150,70],['detached','Detached House',300000,200,150],
 ['beach','Beach House',500000,300,200],['chalet','Chalet',750000,350,300],['villa','Villa',1250000,400,350],
 ['penthouse','Penthouse',2000000,450,450],['estate','Mansion',3000000,500,500],['ranch','Ranch',15000000,600,1000],
 ['palace','Palace',65000000,1000,3000],['castle','Castle',200000000,1500,10000],['island','Private Island',500000000,2000,100000]
];
const HOMES=rows.map(([key,name,price,happy,upkeep],tier)=>({key,name,price,happy,upkeep,tier,capacity:96+tier*32,image:`/img/properties/${key}.jpg`,description:`${name} in Lockdown City. ${happy.toLocaleString()} base happiness.`,icon:'⌂'}));
const UPGRADES={
 interior:[{name:'Sufficient interior',cost:.25,happy:.25,min:1},{name:'Superior interior',cost:.5,happy:.5,min:1}],
 hot_tub:[{name:'Hot tub',cost:17000,happy:25,min:3}],sauna:[{name:'Sauna',cost:12000,happy:25,min:3}],
 pool:[{name:'Small pool',cost:35000,happy:100,min:4},{name:'Medium pool',cost:100000,happy:125,min:4},{name:'Large pool',cost:500000,happy:150,min:4}],
 shooting:[{name:'Advanced shooting range',cost:250000,happy:50,tiers:[10,12,13]}],bar:[{name:'Open bar',cost:9000,happy:50,min:8}],
 vault:[{name:'Small vault',cost:20000000,happy:50,min:11,capacity:100000000},{name:'Medium vault',cost:42000000,happy:75,min:11,capacity:300000000},{name:'Large vault',cost:98000000,happy:100,min:11,capacity:500000000},{name:'Extra large vault',cost:215000000,happy:125,min:11,capacity:1000000000}],
 medical:[{name:'Medical facility',cost:17000000,happy:50,min:12}],airstrip:[{name:'Airstrip with plane',cost:75000000,happy:250,min:13}],yacht:[{name:'Private yacht',cost:895000000,happy:500,min:13}]
};
const STAFF={maid:{name:'Maid',min:8,tiers:[[1,5000,50],[2,10000,75],[3,15000,85],[5,25000,100]]},butler:{name:'Butler',min:8,tiers:[[1,7000,75],[2,15000,100],[3,22500,125]]},guard:{name:'Guard',min:9,tiers:[[1,15000,100],[2,30000,150],[3,45000,200],[5,75000,300],[10,150000,500]]},doctor:{name:'Doctor',min:12,tiers:[[1,25000,25]]},pilot:{name:'Pilot',min:13,tiers:[[1,30000,50]]}};
function allowed(home,upgrade){return upgrade.tiers?upgrade.tiers.includes(home.tier):home.tier>=upgrade.min;}
function summary(home,upgrades={},staff={},debt=0){
 let happy=home.happy,daily=home.upkeep;
 for(const [key,level] of Object.entries(upgrades)){const u=UPGRADES[key]?.[level-1];if(u&&allowed(home,u))happy+=key==='interior'?Math.round(home.happy*u.happy):u.happy;}
 for(const [key,count] of Object.entries(staff)){const s=STAFF[key]?.tiers.find(s=>s[0]===count);if(s&&home.tier>=STAFF[key].min){happy+=s[2];daily+=s[1];}}
 const reduction=home.price?Math.min(1,Math.max(0,(debt-.1*home.price)/home.price*2.5)):0;
 return {happy:Math.floor(happy*(1-reduction)),daily,reduction,vaultCapacity:UPGRADES.vault[upgrades.vault-1]?.capacity||0,pool:!!upgrades.pool,shooting:!!upgrades.shooting,medical:!!(upgrades.medical&&staff.doctor),airstrip:!!(upgrades.airstrip&&staff.pilot)};
}
module.exports={HOMES,UPGRADES,STAFF,allowed,summary};
