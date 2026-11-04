import { chromium } from 'playwright';
const hub='https://torusmith.github.io/QiguanGamets/';
const sites={shogi:'https://shtoruogigamets.pages.dev/',gomoku:'https://gomokugamets.pages.dev/',xiangqi:'https://online-2-player-chinese-chess.onrender.com/',chess:'https://chesstorusgamets.pages.dev/'};
const onlinePath={shogi:'#/online',xiangqi:'online',chess:'#/online'};
const b=await chromium.launch();
async function probe(name,url,vp){
  const ctx=await b.newContext({viewport:vp,locale:'zh-TW'}); const p=await ctx.newPage(); const bad=[]; let bytes=0;
  p.on('console',m=>{if(m.type()==='error')bad.push('console:'+m.text().slice(0,140))});
  p.on('pageerror',e=>bad.push('pageerror:'+e.message.slice(0,140)));
  p.on('requestfailed',r=>bad.push('failed:'+r.url().slice(0,90)));
  p.on('response',async r=>{if(r.status()>=400)bad.push(r.status()+':'+r.url().slice(0,90));try{bytes+=(await r.body()).length}catch{}});
  const t=Date.now(); await p.goto(url,{waitUntil:'load',timeout:90000}); const ms=Date.now()-t; await p.waitForTimeout(2500);
  const info=await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(x=>x.href.includes('QiguanGamets'));const r=a?.getBoundingClientRect();return{title:document.title,overflow:document.documentElement.scrollWidth-innerWidth,hub:a?{text:a.textContent.trim(),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),visible:r.width>0&&getComputedStyle(a).visibility!=='hidden'}:null,vh:innerHeight,desc:!!document.querySelector('meta[name=description]'),og:!!document.querySelector('meta[property="og:title"]'),manifest:!!document.querySelector('link[rel=manifest]')}});
  const sw=await p.evaluate(async()=>!!(await navigator.serviceWorker?.getRegistration()));
  console.log('R',name,vp.width,ms+'ms',Math.round(bytes/1024)+'KB',JSON.stringify(info),'sw='+sw,'bad='+JSON.stringify(bad.slice(0,5)));
  await ctx.close();
}
await probe('hub',hub,{width:1440,height:900}); await probe('hub',hub,{width:390,height:844});
for(const [n,u] of Object.entries(sites)){await probe(n,u,{width:1440,height:900});await probe(n,u,{width:390,height:844});}
for(const [n,path] of Object.entries(onlinePath)){const p=await b.newPage();const bad=[];p.on('console',m=>{if(m.type()==='error')bad.push(m.text().slice(0,120))});await p.goto(new URL(path,sites[n]).href,{timeout:90000});await p.waitForTimeout(5000);console.log('O',n,(await p.innerText('body')).replace(/\s+/g,' ').slice(0,170),JSON.stringify(bad.slice(0,3)));await p.close();}
{const p=await b.newPage();await p.goto(sites.gomoku);await p.getByRole('button',{name:/線上/}).first().click().catch(e=>console.log('O gomoku click',e.message.slice(0,80)));await p.waitForTimeout(2500);console.log('O gomoku',(await p.innerText('body')).replace(/\s+/g,' ').slice(0,170));await p.close();}
{const p=await b.newPage();await p.goto(hub);const hrefs=await p.$$eval('a',a=>a.map(x=>x.href));console.log('H',hrefs.length,hrefs.join(' '));for(const h of hrefs){const q=await b.newPage();const r=await q.goto(h,{timeout:90000});await q.waitForTimeout(1500);console.log('H',h,r.status(),(await q.innerText('body')).replace(/\s+/g,' ').slice(0,60));await q.close();}await p.close();}
await b.close();
