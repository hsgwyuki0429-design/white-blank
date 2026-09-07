// Static-site build. No bundler or runtime download is needed by the game.
import { mkdir, readdir, readFile, cp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { LANDMARK_CATALOG, compileLandmark } from '../src/landmark-catalog.js';
for(const name of await readdir('src'))if(name.endsWith('.js'))execFileSync(process.execPath,['--check','src/'+name]);
if(LANDMARK_CATALOG.length!==100)throw new Error('Expected 100 new landmarks');
for(const e of LANDMARK_CATALOG)compileLandmark(e);
await mkdir('dist',{recursive:true});
for(const p of ['src','vendor','index.html'])await cp(p,'dist/'+p,{recursive:true});
const files=['index.html',...(await readdir('src')).map(n=>'src/'+n),...(await readdir('vendor')).map(n=>'vendor/'+n)];
const manifest={};
for(const p of files)manifest[p]=createHash('sha256').update(await readFile('dist/'+p)).digest('hex');
await writeFile('dist/build-manifest.json',JSON.stringify(manifest,null,2));
console.log(`Built dist: ${files.length} static files; 6 legacy + ${LANDMARK_CATALOG.length} new landmarks.`);
