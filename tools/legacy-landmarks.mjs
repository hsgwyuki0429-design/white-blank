// Compare against the unmodified repository revision, not a reimplementation of it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { findLandmarks, landmarkOf, lmCell } from '../src/landmarks.js';
const base='0f4fda4';
await mkdir('test-results/legacy',{recursive:true});
for(const file of ['landmarks.js','dims.js','rng.js'])await writeFile('test-results/legacy/'+file,execFileSync('git',['show',base+':src/'+file]));
const old=await import(pathToFileURL(resolve('test-results/legacy/landmarks.js')));
let locations=0,cells=0;
for(const seed of [1,7,12345,999,4242,31337])for(const L of old.findLandmarks(seed,undefined,12)){
  const current=landmarkOf(seed,L.x0,L.y0,L.z0);
  assert.deepEqual(current,L,'legacy location, size, parameters or gates changed');locations++;
  for(let y=L.y0;y<=L.y1;y++)for(let z=L.z0;z<=L.z1;z++)for(let x=L.x0;x<=L.x1;x++){
    assert.deepEqual(lmCell(seed,x,y,z),old.lmCell(seed,x,y,z),'legacy shape changed');cells++;
  }
}
console.log(`Legacy revision ${base}: ${locations} exact locations, ${cells} exact cell shapes preserved across six seeds.`);
