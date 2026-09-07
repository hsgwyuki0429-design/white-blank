import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
const server = createServer(async (req,res) => {
  try { const p = req.url.split('?')[0]; const f=join(process.cwd(),p==='/'?'index.html':p); res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(f)]||'application/octet-stream');res.end(await readFile(f)); }
  catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(8099,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.WB_CHROME,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 // Fixed simulation time avoids slow software rendering changing input assertions.
 await page.addInitScript(()=>{window.requestAnimationFrame=fn=>{if(fn.name!=='frame')return setTimeout(()=>fn(performance.now()),0);return 0;};HTMLCanvasElement.prototype.requestPointerLock=()=>{throw new Error('Touch must not lock pointer');};});
 await page.goto('http://127.0.0.1:8099');await page.waitForFunction(()=>!!window.__wb);
 await page.fill('#seedinput','しろ');await page.dispatchEvent('#seedinput','change');await page.tap('#start');await page.waitForFunction(()=>window.__wb.playing);
 assert(await page.locator('#touch-controls').isVisible());
 const cdp=await page.context().newCDPSession(page);
 const touch=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y}))});await page.waitForTimeout(100);};
 const state=()=>page.evaluate(()=>window.__wb.touchInput);
 await touch('touchStart',[[1,95,700]]);await touch('touchMove',[[1,95,652]]);
 assert((await state()).forward>.99);
 const walk=await page.evaluate(()=>{const w=__wb;w.look(0,0);w.sim(.12);return Math.hypot(w.body.vx,w.body.vz);});
 await touch('touchStart',[[1,95,652],[2,300,700]]);assert((await state()).dash);
 const dash=await page.evaluate(()=>{__wb.sim(.12);return Math.hypot(__wb.body.vx,__wb.body.vz);});assert(dash>walk,'Dash increases physical movement speed');
 await touch('touchMove',[[1,143,700],[2,300,680]]);assert((await state()).turn>.99);
 const facing=await page.evaluate(()=>{__wb.sim(.2);return __wb.camera.parent.rotation.y;});assert(Math.abs(facing)>.2,'Stick turns camera');
 await touch('touchEnd',[[2,300,680]]);assert(!(await state()).dash);assert((await state()).turn>.99,'Other finger remains active');
 await touch('touchCancel',[]);assert.deepEqual(await state(),{forward:0,turn:0,dash:false,jump:false});
 // Real touch on the jump button, followed by a browser cancellation.
 const jump=await page.locator('#touch-jump').boundingBox();await touch('touchStart',[[3,jump.x+24,jump.y+24]]);assert((await state()).jump);await touch('touchCancel',[]);assert(!(await state()).jump);
 await touch('touchStart',[[4,300,700]]);await page.evaluate(()=>dispatchEvent(new Event('blur')));assert(!(await state()).dash);await touch('touchEnd',[]);
 await page.tap('#touch-pause');assert(!(await page.evaluate(()=>__wb.playing)));assert(!(await page.locator('#touch-controls').isVisible()));
 await page.tap('#start');assert((await state()).forward===0);
 await touch('touchStart',[[5,300,700]]);await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);assert(!(await state()).dash);await touch('touchCancel',[]);
 await mkdir('test-results',{recursive:true});await page.evaluate(()=>__wb.renderer.render(__wb.scene,__wb.camera));await page.screenshot({path:'test-results/touch-landscape.png'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>__wb.renderer.render(__wb.scene,__wb.camera));await page.screenshot({path:'test-results/touch-portrait.png'});
 const desktop=await browser.newPage({hasTouch:false,isMobile:false});await desktop.goto('http://127.0.0.1:8099');await desktop.waitForFunction(()=>!!window.__wb);assert(!(await desktop.locator('#touch-controls').isVisible()));assert(await desktop.locator('#keys').isVisible());
 assert.deepEqual(errors,[]);console.log('PASS: mobile start without pointer lock, analog movement, physical dash, simultaneous steering, drag look, independent release, cancel, jump, blur, pause/resume, rotation reset, portrait/landscape, desktop controls; no page errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));}



