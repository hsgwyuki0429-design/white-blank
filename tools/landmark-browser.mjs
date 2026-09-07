// Actual game renderer, actual seeded locations; screenshots are review artifacts.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
const root=process.cwd(), out=resolve('test-results');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  try{const u=new URL(req.url,'http://localhost');const path=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!path.startsWith(root))throw new Error('outside root');
    const data=await readFile(path);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream'});res.end(data);
  }catch{res.writeHead(404);res.end();}
});
const port=Number(process.env.WB_PORT||8100);
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.WB_CHROME||undefined,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const mobile=!!process.env.WB_MOBILE;
const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:900,height:560}}), errors=[],results=[];
page.setDefaultTimeout(120000);
await page.addInitScript(()=>{HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>!!window.__wb);
  await page.evaluate(()=>{window.__wb.setup(12345);window.__wb.begin();});
  const ids=process.argv.slice(2).length?process.argv.slice(2):Array.from({length:100},(_,i)=>`LM_${String(i+1).padStart(3,'0')}`);
  for(const id of ids){
    const t=performance.now();
    const result=await page.evaluate(id=>{
      const L=window.__wb.jump(id);if(!L)throw new Error('missing '+id);
      window.__wb.sim(0.1);return {...L,body:{...window.__wb.body},chunks:window.__wb.chunks};
    },id);
    await page.screenshot({path:resolve(out,(mobile?'mobile-':'')+id+'.png')});
    result.render=await page.evaluate(async()=>{
      const times=[];let last=await new Promise(requestAnimationFrame);
      for(let i=0;i<12;i++){const now=await new Promise(requestAnimationFrame);times.push(now-last);last=now;}
      times.sort((a,b)=>a-b);
      return {...window.__wb.renderStats,frameMedianMs:times[6],frameMaxMs:times[11]};
    });
    results.push({id,...result,ms:Math.round(performance.now()-t)});
    console.log(id+' '+Math.round(performance.now()-t)+'ms');
  }
  await writeFile(resolve(out,mobile?'browser-mobile.json':process.argv.slice(2).length?'browser-changed.json':'browser.json'),JSON.stringify({results,errors},null,2));
  if(!mobile&&!process.argv.slice(2).length)await writeFile(resolve(out,'contact.html'),`<!doctype html><meta charset="utf-8"><style>body{background:#ddd;font:14px system-ui;margin:12px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}figure{margin:0}img{width:100%}</style>`+results.map(r=>`<figure><img src="${r.id}.png"><figcaption>${r.id}</figcaption></figure>`).join(''));
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();await new Promise(r=>server.close(r));}
