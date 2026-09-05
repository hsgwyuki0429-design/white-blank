import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';
 const f=join(process.cwd(),normalize(p).replace(/^(\.\.[/\\])+/,''));const b=await readFile(f);
 res.writeHead(200,{'content-type':MIME[extname(f)]||'application/octet-stream'});res.end(b);}
 catch{if(!res.headersSent)res.writeHead(404);res.end('no');}});
await new Promise(r=>server.listen(8095,r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',ignoreDefaultArgs:['--headless=old'],
 args:['--headless=new','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox']});
const page=await browser.newPage({viewport:{width:480,height:300}});
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:8095/?t='+Date.now(),{waitUntil:'load'});
await page.waitForFunction(()=>!!window.__wb);
await page.fill('#seedinput','しろ'); await page.dispatchEvent('#seedinput','change');
await page.click('#start'); await page.waitForFunction(()=>window.__wb.playing);
console.log(await page.evaluate(()=>{
  const w=window.__wb.world,b=window.__wb.body;
  const YAW={0:-Math.PI/2,1:Math.PI/2,4:Math.PI,5:0};
  const cx=Math.floor(b.x/4),cy=Math.floor((b.y+0.35)/2.6),cz=Math.floor(b.z/4);
  const out={spawn:[cx,cy,cz], links:w.linkBits(cx,cy,cz).toString(2), y:+b.y.toFixed(2), g:b.grounded, tries:{}};
  const s=[b.x,b.y,b.z];
  for(const d of [0,1,4,5]){
    if(!(w.linkBits(cx,cy,cz)&(1<<d))) continue;
    window.__wb.put(s[0],s[1],s[2]); window.__wb.look(YAW[d],0);
    window.__wb.sim(0.3); window.__wb.sim(2.0,['KeyW']);
    out.tries[d]={moved:+Math.hypot(b.x-s[0],b.z-s[2]).toFixed(2), y:+b.y.toFixed(2), g:b.grounded,
                  cell:[Math.floor(b.x/4),Math.floor((b.y+0.35)/2.6),Math.floor(b.z/4)]};
  }
  window.__wb.put(s[0],s[1],s[2]);
  window.__wb.sim(0.3); window.__wb.sim(3.0,['KeyW']);
  out.after3s={pos:[+b.x.toFixed(2),+b.y.toFixed(2),+b.z.toFixed(2)], g:b.grounded, v:[+b.vx.toFixed(2),+b.vy.toFixed(2),+b.vz.toFixed(2)]};
  return out;
}));
await browser.close();server.close();
