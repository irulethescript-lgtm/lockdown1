// Operator-only import; keep result files outside public/. Never accept player-supplied results.
const fs=require('node:fs');
const {db,withTransaction}=require('../middleware/db');
const {importSports}=require('../middleware/casino');
(async()=>{
 try{
  if(!process.argv[2])throw Error('Usage: node scripts/casino-sports.js /path/to/verified-events.json');
  const events=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  await withTransaction(tx=>importSports(tx,events));
  console.log('Sports events imported and results settled.');
 }catch(err){console.error(err.message);process.exitCode=1;}
 finally{db.close();}
})();
