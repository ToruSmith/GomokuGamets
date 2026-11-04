const site='https://shtoruogigamets.pages.dev/';
const html=await (await fetch(site)).text();
const js=[...html.matchAll(/src="\.?\/?(assets\/[^"]+\.js)"/g)].map(m=>m[1]);
console.log('R shogi assets',js.join(' '));
for(const f of js){const t=await (await fetch(new URL(f,site))).text();console.log('R',f,t.length,'hub='+t.includes('QiguanGamets'),'tag='+t.includes('hub-link'));}
const sw=await (await fetch(site+'sw.js')).text();console.log('R sw prefix', sw.includes("startsWith('shogi-')"), sw.slice(0,70).replace(/\n/g,' '));
const x='https://online-2-player-chinese-chess.onrender.com/';
const t0=Date.now();let st=0;for(let i=0;i<40;i++){const r=await fetch(x+'healthz').catch(()=>null);st=r?.status;if(st===200)break;await new Promise(r=>setTimeout(r,3000));}
console.log('R render healthz',st,(Date.now()-t0)+'ms');
const h=await (await fetch(x)).text();const m=[...h.matchAll(/src="(\/[^"]+\.js)"/g)].map(a=>a[1]);for(const f of m){const t=await (await fetch(new URL(f,x))).text();console.log('R',f,t.length,'hub='+t.includes('QiguanGamets'));}
