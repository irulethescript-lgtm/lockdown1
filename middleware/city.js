// Public city routes map to the original handlers so existing clients and saves keep working.
const aliases = [
  ['/broker-supplies','/warden-amenities'], ['/property-raids','/cell-raids'],
  ['/faction-invites','/gang-invites'], ['/my-faction','/my-gang'],
  ['/property','/cell'], ['/citizens','/inmates'], ['/relocate','/transport'],
  ['/factions','/gangs'], ['/faction','/gang'], ['/broker','/warden'],
  ['/jail','/isolation'],
];
function cityRoutes(req,res,next) {
  const path=req.path;
  let target;
  if(path==='/airport') target='/prison/yard';
  else if(path.startsWith('/airport/')) target='/yard'+path.slice('/airport'.length);
  else if(path==='/hospital') target='/prison/infirmary';
  else if(path.startsWith('/hospital/')) target='/infirmary'+path.slice('/hospital'.length);
  else if(path==='/shop') target='/prison/marketplace';
  else if(path.startsWith('/shop/')) target='/marketplace'+path.slice('/shop'.length);
  else {
    const entry=aliases.find(([from])=>path===from||path.startsWith(from+'/'));
    if(entry) target=entry[1]+path.slice(entry[0].length);
  }
  if(target) req.url=target+req.url.slice(path.length);
  next();
}
module.exports={cityRoutes};
