import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('client registration follows the public package name after a rename',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const registrations=[];
 runInNewContext(readFileSync(new URL('../client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:r=>registrations.push(r)}}});
 assert.equal(registrations.length,1);
 assert.equal(registrations[0].id,pkg.name);
 assert.equal(typeof registrations[0].factory,'function');
});
