// Catch up from persisted timestamps; repeated invocations cannot duplicate charges or payouts.
async function tick(tx,now=Math.floor(Date.now()/1000)){
 await require('./companies').settle(tx,now);
 const owners=await tx.all('SELECT DISTINCT user_id FROM owned_homes');
 for(const owner of owners)await require('./homes').homeState(tx,owner.user_id,now);
 const accounts=await tx.all('SELECT user_id FROM stock_accounts');
 for(const account of accounts)await require('./stocks').state(tx,account.user_id,now);
}
module.exports={tick};
