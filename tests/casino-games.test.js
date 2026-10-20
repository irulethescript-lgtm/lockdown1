const {test}=require('node:test');
const assert=require('node:assert/strict');
const {shuffledDeck,total,natural,pokerScore,slots,craps}=require('../middleware/casino-games');
test('casino deck contains each card once and blackjack handles soft aces',()=>{
 const deck=shuffledDeck(()=>0);assert.equal(deck.length,52);assert.equal(new Set(deck.map(c=>c.rank+':'+c.suit)).size,52);
 assert.equal(total([{rank:14},{rank:14},{rank:9}]),21);assert.equal(total([{rank:14},{rank:6}]),17);
 assert.ok(natural([{rank:14},{rank:10}]));assert.ok(!natural([{rank:7},{rank:7},{rank:7}]));
});
test('poker ranks all categories, kickers and ace-low straights correctly',()=>{
 const c=(ranks,suits=[0,1,2,3,0])=>ranks.map((rank,i)=>({rank,suit:suits[i]}));
 const hands=[c([14,11,9,6,2]),c([2,2,14,11,9]),c([2,2,3,3,14]),c([2,2,2,14,9]),c([14,2,3,4,5]),c([14,11,9,6,2],[1,1,1,1,1]),c([3,3,3,2,2]),c([2,2,2,2,14]),c([9,10,11,12,13],[1,1,1,1,1])];
 for(let i=1;i<hands.length;i++)assert.ok(pokerScore(hands[i])>pokerScore(hands[i-1]),'category '+i);
 assert.ok(pokerScore(c([6,5,4,3,2]))>pokerScore(c([14,5,4,3,2])));
 assert.ok(pokerScore(c([2,2,14,11,10]))>pokerScore(c([2,2,14,11,9])));
});
test('slot returns match symbols and pass-line craps resolves comeout and points',()=>{
 assert.deepEqual(slots(()=>0),{symbols:[0,0,0],multiplier:100,jackpot:true});
 const rng=seq=>()=>seq.shift();
 assert.equal(slots(rng([1,1,2])).multiplier,.5);assert.equal(slots(rng([1,2,3])).multiplier,0);
 assert.equal(craps(rng([2,3])).won,true);assert.equal(craps(rng([0,0])).won,false);
 const win=craps(rng([1,2,0,0,1,2]));assert.equal(win.point,5);assert.equal(win.won,true);
 assert.equal(craps(rng([1,2,2,3])).won,false);
});
