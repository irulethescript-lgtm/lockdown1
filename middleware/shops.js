const { createHash } = require('node:crypto');
const HOUR = 3600;
const roll = seed => createHash('sha256').update(seed).digest().readUInt32BE(0) / 4294967296;
function quantityFor(price, seed) {
  const [low,high] = price<=100?[400,1000]:price<=1000?[200,500]:price<=10000?[60,140]:price<=100000?[20,50]:price<=1000000?[8,20]:price<=10000000?[4,8]:price<=100000000?[2,5]:[2,3];
  return low + Math.floor(roll(seed)*(high-low+1));
}
function shopItems() {
  const {CATALOGS}=require('./item-catalog');
  return ['item','weapon','armor','gear','drug'].flatMap(type=>Object.entries(CATALOGS[type])
    .filter(([,item])=>item.for_sale!==false && Number.isSafeInteger(item.price) && item.price>0)
    .map(([key,item])=>({type,key,...item})));
}
const groupFor = item => /\bcache\b/i.test(item.name)?'caches':
  ['energy_drinks','other_boosters'].includes(item.category)?'boosters':
  item.type==='weapon'?'weapons':item.category;
let countryCatalogs;
function overseasCatalog(country) {
  if(!countryCatalogs)countryCatalogs=new Map();
  if(countryCatalogs.has(country))return countryCatalogs.get(country);
  const all=shopItems();
  const quota={flowers:3,plushies:3,drugs:2,weapons:2,boosters:1,caches:1};
  const result=Object.entries(quota).flatMap(([group,count])=>all.filter(i=>groupFor(i)===group)
    .sort((a,b)=>roll(`country:${country}:${a.type}:${a.key}`)-roll(`country:${country}:${b.type}:${b.key}`))
    .slice(0,count).map(item=>({...item,group,rare:group==='boosters'||group==='caches',
      localPrice:Math.max(1,Math.round(item.price*(0.65+roll(`price:${country}:${item.key}`)*0.7)))})));
  if(result.length!==12)throw new Error('Incomplete overseas catalog');
  countryCatalogs.set(country,result);
  return result;
}
async function stockFor(store,scope,items,now=Math.floor(Date.now()/1000)) {
  const epoch=Math.floor(now/HOUR), restockAt=(epoch+1)*HOUR;
  const existing=await store.all('SELECT * FROM rotating_stock WHERE scope=?',[scope]);
  const map=new Map(existing.map(s=>[s.item_type+':'+s.item_key,s]));
  const rows=[];
  for(const item of items) {
    const identity=item.type+':'+item.key;
    let stock=map.get(identity);
    if(!stock || stock.restock_at<=now) {
      const seed=`${scope}:${epoch}:${identity}`;
      const chance=scope==='home' ? (!item.source_id?1:item.price>=100000000?0.3:0.65) : item.rare?0.22:1;
      const active=roll(seed+':active')<chance?1:0;
      const price=scope==='home'?item.price:item.localPrice;
      const quantity=active?(item.rare?1+Math.floor(roll(seed+':qty')*3):quantityFor(price,seed+':qty')):0;
      const expiresAt=item.rare?epoch*HOUR+1200:0;
      await store.run(`INSERT INTO rotating_stock (scope,item_type,item_key,quantity,price,active,restock_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(scope,item_type,item_key) DO UPDATE SET
        quantity=excluded.quantity,price=excluded.price,active=excluded.active,restock_at=excluded.restock_at,expires_at=excluded.expires_at`,
        [scope,item.type,item.key,quantity,price,active,restockAt,expiresAt]);
      stock={scope,item_type:item.type,item_key:item.key,quantity,price,active,restock_at:restockAt,expires_at:expiresAt};
    }
    const available=Boolean(stock.active && (!stock.expires_at||now<stock.expires_at));
    rows.push({...item,...stock,available,quantity:available?stock.quantity:0});
  }
  return rows;
}
async function debitStock(store,scope,type,key,quantity,now=Math.floor(Date.now()/1000)) {
  const changed=await store.run(`UPDATE rotating_stock SET quantity=quantity-? WHERE scope=? AND item_type=? AND item_key=?
    AND quantity>=? AND active=1 AND restock_at>? AND (expires_at=0 OR expires_at>?)`,[quantity,scope,type,key,quantity,now,now]);
  return changed.changes===1;
}
module.exports={HOUR,roll,quantityFor,shopItems,overseasCatalog,stockFor,debitStock};
