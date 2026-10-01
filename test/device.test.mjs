import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrafts,openDeviceStorage} from '../web/device.js';
import {moveItem} from '../web/editor.js';
class Storage {m=new Map();get length(){return this.m.size}key(i){return [...this.m.keys()][i]}getItem(k){return this.m.get(k)||null}setItem(k,v){this.m.set(k,v)}removeItem(k){this.m.delete(k)}}
test('drafts isolate new/edit/settings, survive reload, expire and purge other people',()=>{
 const storage=new Storage();let now=100;const a=createDrafts({storage,userId:1,username:'a',now:()=>now});a.put('episode-new',{notes:'new'});a.put('episode-edit:e-1',{notes:'edit'});a.put('settings',{budget:12});
 const b=createDrafts({storage,userId:1,username:'a',now:()=>now});assert.equal(b.get('episode-new').notes,'new');assert.equal(b.get('episode-edit:e-1').notes,'edit');assert.equal(b.count(),3);
 now+=8*24*60*60*1000;assert.equal(b.get('settings'),null);assert.equal(createDrafts({storage,userId:1,username:'a',now:()=>now}).count(),0);
 a.put('episode-new',{notes:'private'});createDrafts({storage,userId:2,username:'b'});assert.equal(storage.length,0);
});
test('blocked draft storage keeps an exportable memory copy and signals the failure',()=>{
 let error;const drafts=createDrafts({storage:null,userId:1,username:'a',onError:e=>error=e});drafts.put('episode-new',{notes:'recover'});assert.match(error.message,/only in memory/);assert.equal(drafts.export()['episode-new'].notes,'recover');drafts.clear();assert.equal(drafts.count(),0);
});
test('without IndexedDB the persistence adapter falls back transparently',async()=>{
 const storage=new Storage();assert.equal(await openDeviceStorage({indexedDB:null,legacy:storage}),storage);
});
test('reordering preserves items and bounds invalid requests',()=>{
 assert.deepEqual(moveItem(['a','b','c'],0,2),['b','c','a']);assert.deepEqual(moveItem(['a'],0,1),['a']);
});


test('factory defaults match the server fallback and valid Unicode names retain every character',async()=>{
 const {readFile}=await import('node:fs/promises');const {DEFAULTS,validateSettings,normaliseSettings}=await import('../web/model.js');
 assert.deepEqual(JSON.parse(await readFile(new URL('../web/defaults.json',import.meta.url),'utf8')),DEFAULTS);
 const S={...DEFAULTS,symptoms:['😀'.repeat(60)]};assert.deepEqual(validateSettings(S),[]);assert.equal([...normaliseSettings(S).symptoms[0]].length,60);
});

test("editing lock allows one writer, fails closed without locks and releases on close",async()=>{
 const {claimEditingTab}=await import('../web/device.js');let held=false;
 const locks={request:async(name,opts,fn)=>{if(held)return fn(null);held=true;try{return await fn({name})}finally{held=false}}};
 const a=await claimEditingTab(locks,'user');assert.equal(a.writable,true);const b=await claimEditingTab(locks,'user');assert.equal(b.writable,false);a.close();await new Promise(r=>setImmediate(r));const c=await claimEditingTab(locks,'user');assert.equal(c.writable,true);c.close();assert.equal((await claimEditingTab(null,'user')).writable,false);
});
