// Integrates the real world, mesher and capsule solver. Exercises all 100 ground
// routes, every designed stair, mesh budgets and rebuilding in reverse chunk order.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { World, findLandmarks, lmCell, CW,CY,CD,CELL,LEVEL,DX,DZ } from '../src/world.js';
import { buildChunk } from '../src/mesher.js';
import { Colliders, step } from '../src/physics.js';
const seed=12345, places=findLandmarks(seed,undefined,480);
places.sort((a,b)=>Math.hypot(a.x0,a.z0)-Math.hypot(b.x0,b.z0));
const requested=process.argv.slice(2);
const sample=[...new Map(places.toReversed().map(L=>[L.kind,L])).values()].filter(L=>!requested.length||requested.includes(L.id)).sort((a,b)=>a.kind-b.kind);
const results=[], failures=[];
const digest=m=>createHash('sha256').update(new Uint8Array(m.tri.buffer)).update(new Uint8Array(m.geom.attributes.position.array.buffer)).digest('hex');
for(const L of sample){
  const w=new World(seed),col=new Colliders(),meshes=new Map(),metrics={kind:L.kind,id:L.id||L.kind,chunks:0,vertices:0,triangles:0,maxVertices:0,maxTriangles:0,buildMs:0,stairs:0};
  const make=(kx,ky,kz)=>{
    const key=[kx,ky,kz].join(',');if(meshes.has(key))return meshes.get(key);
    const start=performance.now(),m=buildChunk(w,kx,ky,kz);metrics.buildMs+=performance.now()-start;
    assert([...m.geom.attributes.position.array,...m.tri].every(Number.isFinite));
    assert.equal(m.triStart.length,145);assert.equal(m.triStart[144],m.tri.length/9);
    metrics.chunks++;metrics.vertices+=m.verts;metrics.triangles+=m.tri.length/9;
    metrics.maxVertices=Math.max(metrics.maxVertices,m.verts);metrics.maxTriangles=Math.max(metrics.maxTriangles,m.tri.length/9);
    meshes.set(key,m);col.set(key,m);return m;
  };
  const ensure=(x,y,z)=>{for(let ky=Math.floor((y-.6)/LEVEL/CY);ky<=Math.floor((y+2.5)/LEVEL/CY);ky++)for(let kz=Math.floor((z-.6)/CELL/CD);kz<=Math.floor((z+.6)/CELL/CD);kz++)for(let kx=Math.floor((x-.6)/CELL/CW);kx<=Math.floor((x+.6)/CELL/CW);kx++)make(kx,ky,kz);};
  const bodyAt=(x,y,z)=>({x,y,z,vx:0,vy:0,vz:0,grounded:false,gnx:0,gny:1,gnz:0});
  const drive=(body,tx,tz,seconds=8)=>{
    for(let n=0;n<seconds*60;n++){
      const d=Math.hypot(tx-body.x,tz-body.z);if(d<.10&&body.grounded)return true;
      const speed=Math.min(3,d*6);body.vx=d?speed*(tx-body.x)/d:0;body.vz=d?speed*(tz-body.z)/d:0;
      if(body.grounded)body.vy=-(body.vx*body.gnx+body.vz*body.gnz)/Math.max(.02,body.gny)-.5;
      ensure(body.x,body.y,body.z);step(body,col,1/60);
    }
    return Math.hypot(tx-body.x,tz-body.z)<.15;
  };
  try{
    if(L.kind>=6){
      const id=(x,z)=>z*L.W+x,at=(x,z)=>lmCell(seed,L.x0+x,L.y0,L.z0+z);
      const [a,b]=L.gates,from=id(a.ix,a.iz),to=id(b.ix,b.iz),prev=new Map([[from,null]]),q=[from];
      for(let n=0;n<q.length&&!prev.has(to);n++){
        const k=q[n],x=k%L.W,z=Math.floor(k/L.W),c=at(x,z);
        for(const d of [0,1,4,5]){
          const nx=x+DX[d],nz=z+DZ[d];if(nx<0||nx>=L.W||nz<0||nz>=L.D||!(c.hlink&(1<<d)))continue;
          const nc=at(nx,nz),nk=id(nx,nz);
          // Find a ground route around subcell obstacles and the stair flights.
          if(nc.rock||nc.solids.length||nc.up?.kind==='stair'||prev.has(nk))continue;
          prev.set(nk,k);q.push(nk);
        }
      }
      assert(prev.has(to),L.id+' no obstacle-free ground route');
      const path=[];for(let k=to;k!==null;k=prev.get(k))path.push(k);path.reverse();
      const body=bodyAt((L.x0+a.ix+.5)*CELL,L.y0*LEVEL+.1,(L.z0+a.iz+.5)*CELL);
      for(const k of [...path,...path.toReversed()]){
        const x=k%L.W,z=Math.floor(k/L.W);
        assert(drive(body,(L.x0+x+.5)*CELL,(L.z0+z+.5)*CELL),L.id+' blocked physical route '+[x,z]);
        assert(Math.abs(body.y-L.y0*LEVEL)<.12,L.id+' lost ground');
      }
      for(let z=0;z<L.D;z++)for(let x=0;x<L.W;x++){
        const c=at(x,z);if(c.rock||c.up?.kind!=='stair')continue;
        const d=c.up.dir,dx=DX[d],dz=DZ[d],cx=(L.x0+x+.5)*CELL,cz=(L.z0+z+.5)*CELL;
        const body=bodyAt(cx-dx*2.2,L.y0*LEVEL+.1,cz-dz*2.2);
        assert(drive(body,cx+dx*CELL,cz+dz*CELL,12),L.id+' cannot climb');
        assert(body.y>L.y0*LEVEL+2.5,L.id+' stair did not gain height');
        assert(drive(body,cx-dx*2.2,cz-dz*2.2,12),L.id+' cannot descend');metrics.stairs++;
      }
    }
    // Full footprint meshes, including ceiling geometry that the entrance cannot see.
    for(let ky=Math.floor(L.y0/CY);ky<=Math.floor(L.y1/CY);ky++)for(let kz=Math.floor(L.z0/CD);kz<=Math.floor(L.z1/CD);kz++)for(let kx=Math.floor(L.x0/CW);kx<=Math.floor(L.x1/CW);kx++)make(kx,ky,kz);
    // Another world builds a representative chunk after its opposite neighbours.
    const [key,original]=[...meshes][Math.floor(meshes.size/2)],coord=key.split(',').map(Number),w2=new World(seed);
    for(const [dx,dy,dz]of [[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[0,-1,0],[0,0,-1]])w2.chunk(coord[0]+dx,coord[1]+dy,coord[2]+dz);
    const rebuilt=buildChunk(w2,...coord);assert.equal(digest(rebuilt),digest(original),metrics.id+' order-dependent mesh');rebuilt.geom.dispose();rebuilt.marks?.dispose();
    const distant=buildChunk(w2,...coord,2);
    assert.deepEqual(distant.tri,original.tri,metrics.id+' LOD changed collision');
    assert(distant.verts<=original.verts,metrics.id+' LOD increased vertices');
    distant.geom.dispose();distant.marks?.dispose();
  }catch(e){failures.push(e.message);console.log('FAIL '+e.message);}
  finally{for(const m of meshes.values()){m.geom.dispose();m.marks?.dispose();}col.clear();}
  results.push(metrics);console.log(`${metrics.id}: ${metrics.chunks} chunks, max ${metrics.maxVertices} vertices / ${metrics.maxTriangles} collider triangles, ${metrics.stairs} stairs`);
}
await mkdir('test-results',{recursive:true});await writeFile('test-results/'+(requested.length?'geometry-changed.json':'geometry.json'),JSON.stringify({results,failures},null,2));
assert.equal(failures.length,0,failures.join('\n'));
console.log('All physical routes, stairs, meshes and chunk-order checks passed.');
