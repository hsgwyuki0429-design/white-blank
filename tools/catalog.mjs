import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LANDMARK_CATALOG, compileLandmark, selectLandmark, RARITY_WEIGHT } from '../src/landmark-catalog.js';
import { findLandmarks, lmCell, lmLinked, landmarkOf, inLandmark } from '../src/landmarks.js';
import { DX, DY, DZ, OPP, CELL, LEVEL, MIN_HEAD } from '../src/dims.js';
import { hash32 } from '../src/rng.js';

const signatures=new Set(), totals={}, unsupported=[];
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
assert.equal(LANDMARK_CATALOG.length,100);
for(const [i,e] of LANDMARK_CATALOG.entries()) {
  assert.equal(e.id,`LM_${String(i+1).padStart(3,'0')}`);
  totals[e.rarity]=(totals[e.rarity]||0)+1;
  const c=compileLandmark(e), {W,D,H,index,cells}=c;
  assert.equal(digest(c),digest(compileLandmark(e)),e.id+' compilation determinism');
  const sig=digest(cells);assert(!signatures.has(sig),e.id+' duplicate geometry');signatures.add(sig);
  const at=(x,y,z)=>x>=0&&x<W&&y>=0&&y<H&&z>=0&&z<D?cells[index(x,y,z)]:null;
  // Every retained voxel must connect to bedrock, floor or ceiling. A suspended
  // feature needs real supports; accidental isolated floating masses are errors.
  const anchored=new Set(),rockQueue=[];
  for(let y=0;y<H;y++)for(let z=0;z<D;z++)for(let x=0;x<W;x++)if(at(x,y,z).rock&&(x===0||z===0||y===0||x===W-1||z===D-1||y===H-1)){
    anchored.add(index(x,y,z));rockQueue.push([x,y,z]);
  }
  for(let n=0;n<rockQueue.length;n++){
    const [x,y,z]=rockQueue[n];
    for(let d=0;d<6;d++){
      const nx=x+DX[d],ny=y+DY[d],nz=z+DZ[d],k=index(nx,ny,nz);
      if(at(nx,ny,nz)?.rock&&!anchored.has(k)){anchored.add(k);rockQueue.push([nx,ny,nz]);}
    }
  }
  if(cells.some((a,k)=>a.rock&&!anchored.has(k)))unsupported.push(e.id);
  const floor=(x,y,z)=>{const a=at(x,y,z),b=at(x,y-1,z);return a&&!a.rock&&(!b||b.rock||b.up?.kind!=='open');};
  const fall=(x,y,z)=>{while(y>=0){const a=at(x,y,z);if(!a||a.rock)return null;if(floor(x,y,z))return index(x,y,z);y--;}return null;};
  const forward=new Map(), reverse=new Map();
  const edge=(a,b)=>{if(b===null)return;if(!forward.has(a))forward.set(a,[]);if(!reverse.has(b))reverse.set(b,[]);forward.get(a).push(b);reverse.get(b).push(a);};
  for(let y=0;y<H;y++)for(let z=0;z<D;z++)for(let x=0;x<W;x++){
    const a=at(x,y,z);if(a.rock)continue;
    assert(a.ceil>=MIN_HEAD,e.id+' low ceiling');
    for(const s of a.solids){assert(s.x0>=0&&s.x1<=CELL&&s.z0>=0&&s.z1<=CELL&&s.y0>=0&&s.y1<=LEVEL);assert(s.x1>s.x0&&s.z1>s.z0&&s.y1>s.y0);}
    for(const d of [0,1,4,5])if(a.hlink&(1<<d)){
      const b=at(x+DX[d],y,z+DZ[d]);assert(b&&!b.rock&&(b.hlink&(1<<OPP[d])),e.id+' asymmetric link');
    }
    if(!floor(x,y,z))continue;
    const k=index(x,y,z);
    for(const d of [0,1,4,5])if(a.hlink&(1<<d))edge(k,fall(x+DX[d],y,z+DZ[d]));
    if(a.up?.kind==='stair')edge(k,index(x,y+1,z));
    if(at(x,y-1,z)?.up)edge(k,fall(x,y-1,z));
  }
  const flood=(map,start)=>{const seen=new Set([start]),q=[start];for(let i=0;i<q.length;i++)for(const k of map.get(q[i])||[])if(!seen.has(k)){seen.add(k);q.push(k);}return seen;};
  const g=c.gates.map(g=>index(g.ix,g.iy,g.iz));assert.notEqual(g[0],g[1]);
  const f=flood(forward,g[0]),r=flood(reverse,g[0]);
  assert(f.has(g[1])&&r.has(g[1]),e.id+' gates must connect both ways');
  // Every reachable standing place must have a return route; includes fall destinations.
  for(const k of f)assert(r.has(k),e.id+' trapping floor cell '+k);
  for(let z=0;z<D;z++)for(let x=0;x<W;x++)if(floor(x,0,z))assert(f.has(index(x,0,z)),e.id+' disconnected ground '+[x,z]);
}

assert.equal(unsupported.length,0,'Unsupported masses: '+unsupported.join(', '));
// Real natural placement, including every very rare ID. No debug injection.
const seed=12345, all=findLandmarks(seed,undefined,480), newKinds=new Set();
for(const L of all){
  if(L.kind>=6)newKinds.add(L.kind);
  assert(Math.floor(L.x0/24)===Math.floor(L.x1/24)&&Math.floor(L.z0/24)===Math.floor(L.z1/24));
  assert(L.W<=19&&L.D<=19);
  // The eight neighbouring coarse cells must be empty: separation is independent of load order.
  const cx=Math.floor(L.x0/24),cz=Math.floor(L.z0/24);
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(dx||dz){
    const h=hash32(seed,cx+dx,cz+dz,0x1AA7);assert(h<=hash32(seed,cx,cz,0x1AA7));
  }
}
assert.equal(newKinds.size,100,'all 100 naturally generated');
// Interleaved seeds and cache eviction must never contaminate lookup.
for(const L of all.filter(L=>L.kind>=6).slice(0,12)){
  const a=digest(lmCell(seed,L.x0,L.y0,L.z0));
  for(const other of [1,7,999])inLandmark(other,L.x0,L.y0,L.z0);
  assert.equal(digest(lmCell(seed,L.x0,L.y0,L.z0)),a);
  for(const d of [0,1,2,3,4,5])assert.equal(lmLinked(seed,L.x0,L.y0,L.z0,d),lmLinked(seed,L.x0+DX[d],L.y0+DY[d],L.z0+DZ[d],OPP[d]));
}
// Exact selection intervals, so ultra-rare membership is not left to a flaky random sample.
const total=LANDMARK_CATALOG.reduce((s,e)=>s+RARITY_WEIGHT[e.rarity],0);let offset=0;
for(const e of LANDMARK_CATALOG){assert.equal(selectLandmark((offset+RARITY_WEIGHT[e.rarity]/2)/total).id,e.id);offset+=RARITY_WEIGHT[e.rarity];}
console.log(JSON.stringify({designs:signatures.size,rarity:totals,naturallyGenerated:newKinds.size,coarseWinners:all.length},null,2));
