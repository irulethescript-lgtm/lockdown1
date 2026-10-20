const { randomInt } = require('node:crypto');
const { shopItems } = require('./shops');
const utcDay = now => new Date(now).toISOString().slice(0,10);
// Label bounds match the lettering in the 1220 × 750 map artwork. The same
// destination records drive the visible map signs and keyboard-friendly Quick Links.
const LOCATIONS = [
 {name:'Travel Agency',href:'/airport',x:33,y:22,group:'Miscellaneous',label:{x:329,y:155,w:157,h:23}},
 {name:'Companies',href:'/companies',x:56.5,y:20,group:'Miscellaneous',label:{x:634,y:130,w:113,h:35}},
 {name:'Item Market',href:'/market',x:82,y:27,group:'Shopping',label:{x:944,y:190,w:112,h:25}},
 {name:'Gym',href:'/gym',x:72,y:32,group:'Leisure',label:{x:816,y:230,w:127,h:25}},
 {name:'Estate Agents',href:'/property#property-store',x:15,y:44,group:'Real Estate',label:{x:125,y:319,w:125,h:25}},
 {name:'City Bank',href:'/bank',x:34,y:45,group:'Financial',label:{x:375,y:325,w:86,h:35}},
 {name:'City Hall',href:'/home',x:47,y:44,group:'Administrative',label:{x:540,y:321,w:84,h:25}},
 {name:'Stock Exchange',href:'/stocks',x:59,y:45,group:'Financial',label:{x:669,y:325,w:112,h:35}},
 {name:'Your Property',href:'/property',x:82,y:49,group:'Real Estate',label:{x:932,y:357,w:141,h:27}},
 {name:'Job Listings',href:'/jobs',x:72,y:71,group:'Miscellaneous',label:{x:814,y:519,w:133,h:36}},
 {name:'Casino',href:'/casino',x:20.5,y:74,group:'Leisure',label:{x:197,y:546,w:108,h:26}},
 {name:'Factions',href:'/factions',x:92,y:10,group:'Miscellaneous',label:{x:1086,y:67,w:85,h:25}},
 {name:'Community',href:'/shoutbox',x:94,y:79,group:'Leisure',label:{x:1094,y:573,w:100,h:36}},
 {name:'Points Building',href:'/points',x:34,y:39,group:'Financial'},
 {name:'Gun Shop',href:'/shop?tab=primary',x:88,y:29,group:'Shopping'},
 {name:'General Store',href:'/shop?tab=items',x:83,y:22,group:'Shopping'},
 {name:'Education',href:'/education',x:46,y:30,group:'Administrative'},
 {name:'Hospital',href:'/hospital',x:46,y:38,group:'Administrative'},
 {name:'Jail',href:'/jail',x:51,y:45,group:'Administrative'},
 {name:'Plastic Surgeon',href:'/surgeon',x:67,y:43,group:'Shopping'},
 {name:'Broker',href:'/broker',x:78,y:65,group:'Shopping'},
];
async function dailyFind(store,userId,now=Date.now(),random=randomInt) {
 const day=utcDay(now);
 let find=await store.get('SELECT * FROM city_daily_finds WHERE user_id=? AND day=?',[userId,day]);
 if(!find){
  const spawned=random(100)<35;
  const items=spawned?shopItems():[];
  const item=spawned?items[random(items.length)]:null;
  await store.run('INSERT INTO city_daily_finds (user_id,day,item_type,item_key,x,y) VALUES (?,?,?,?,?,?)',
   [userId,day,item?.type||null,item?.key||null,10+random(80),15+random(65)]);
  find=await store.get('SELECT * FROM city_daily_finds WHERE user_id=? AND day=?',[userId,day]);
 }
 return find;
}
module.exports={LOCATIONS,utcDay,dailyFind};
