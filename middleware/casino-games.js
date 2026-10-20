const {randomInt}=require('node:crypto');
function shuffledDeck(random=randomInt){
 const deck=Array.from({length:52},(_,i)=>({rank:i%13+2,suit:Math.floor(i/13)}));
 for(let i=deck.length-1;i>0;i--){const j=random(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
 return deck;
}
function total(cards){let n=cards.reduce((s,c)=>s+(c.rank===14?11:Math.min(10,c.rank)),0),aces=cards.filter(c=>c.rank===14).length;while(n>21&&aces-- >0)n-=10;return n;}
function natural(cards){return cards.length===2&&total(cards)===21;}
// Lexicographically comparable five-card poker score, including ace-low straights.
function pokerScore(cards){
 const ranks=cards.map(c=>c.rank).sort((a,b)=>b-a);
 const counts=new Map();ranks.forEach(r=>counts.set(r,(counts.get(r)||0)+1));
 const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
 const flush=cards.every(c=>c.suit===cards[0].suit);
 const unique=[...new Set(ranks)];let straight=0;
 if(unique.length===5){if(unique[0]-unique[4]===4)straight=unique[0];else if(unique.join(',')==='14,5,4,3,2')straight=5;}
 let v;
 if(flush&&straight)v=[8,straight];
 else if(groups[0][1]===4)v=[7,groups[0][0],groups[1][0]];
 else if(groups[0][1]===3&&groups[1][1]===2)v=[6,groups[0][0],groups[1][0]];
 else if(flush)v=[5,...ranks];
 else if(straight)v=[4,straight];
 else if(groups[0][1]===3)v=[3,groups[0][0],...groups.slice(1).map(x=>x[0])];
 else if(groups[0][1]===2&&groups[1][1]===2)v=[2,Math.max(groups[0][0],groups[1][0]),Math.min(groups[0][0],groups[1][0]),groups[2][0]];
 else if(groups[0][1]===2)v=[1,groups[0][0],...groups.slice(1).map(x=>x[0])];
 else v=[0,...ranks];
 while(v.length<6)v.push(0);
 return v.reduce((n,x)=>n*15+x,0);
}
function slots(random=randomInt){
 const symbols=Array.from({length:3},()=>random(8));
 const triple=symbols.every(x=>x===symbols[0]);
 const pair=new Set(symbols).size===2;
 return {symbols,multiplier:triple?([100,40,20,10,10,10,10,10][symbols[0]]):pair ? .5 : 0,jackpot:triple&&symbols[0]===0};
}
function craps(random=randomInt){
 const dice=()=>[random(6)+1,random(6)+1],rolls=[dice()];let point=rolls[0][0]+rolls[0][1];
 if([7,11].includes(point))return {rolls,won:true};
 if([2,3,12].includes(point))return {rolls,won:false};
 for(let n=0;n<10000;n++){const roll=dice();rolls.push(roll);const sum=roll[0]+roll[1];if(sum===point||sum===7)return {rolls,point,won:sum===point};}
 throw new Error('Dice did not settle');
}
module.exports={shuffledDeck,total,natural,pokerScore,slots,craps};
