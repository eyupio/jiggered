// Local-only security regression: real IndexedDB, two tabs, copied cookie and admin step-up.
const {chromium}=require('playwright');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jiggered-security-'));
const binary=process.env.JIGGERED_TEST_BINARY||path.join(dir,'jiggered');
if(!process.env.JIGGERED_TEST_BINARY)execFileSync(process.env.GO_BINARY||'go',['build','-o',binary,'.']);
const base='http://127.0.0.1:'+(process.env.JIGGERED_SECURITY_PORT||'18755');
const server=spawn(binary,[],{env:{...process.env,APP_ADDR:new URL(base).host,APP_DB:path.join(dir,'test.db'),APP_USERNAME:'tester',APP_PASSWORD:'local-preview-password',APP_SECURE_COOKIE:'false'},stdio:'ignore'});
(async()=>{let browser;try {
 for(let i=0;i<40;i++){try{if((await fetch(base+'/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.JIGGERED_BROWSER_PATH?{executablePath:process.env.JIGGERED_BROWSER_PATH}:{}),args:JSON.parse(process.env.JIGGERED_BROWSER_ARGS||'[]')});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login');await page.locator('#username').fill('tester');await page.locator('#password').fill('local-preview-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('#t-admin').waitFor();await page.waitForFunction(()=>document.querySelector('#sync')?.dataset.state==='saved');
 const headers={'X-Requested-With':'jiggered'};
 const denied=await context.request.post(base+'/api/admin/users',{headers,data:{username:'intruder',role:'admin'}});assert.equal(denied.status(),403);
 await page.locator('#t-admin').click();await page.locator('#new-name').fill('safeuser');await page.locator('#admin-confirm-pw').fill('local-preview-password');await page.locator('#adduser [type=submit]').click();await page.locator('#adduser-msg').filter({hasText:'Created safeuser.'}).waitFor();assert.equal(await page.locator('#admin-confirm-pw').inputValue(),'');
 const stolen=await browser.newContext();await stolen.addCookies(await context.cookies());
 const changed=await context.request.post(base+'/api/me/password',{headers,data:{current:'local-preview-password',new:'changed-owner-password'}});assert.equal(changed.status(),204);
 assert.equal((await stolen.request.get(base+'/api/docs')).status(),401);assert.equal((await context.request.get(base+'/api/docs')).status(),200);await stolen.close();
 // Put private acknowledged and unsent copies on the writer, then sign out from its reader.
 await page.locator('#t-today').click();await page.locator('#checkin [data-s=amber]').click();await page.waitForFunction(()=>document.querySelector('#sync')?.dataset.state==='saved');
 await page.route('**/api/docs/*',route=>route.fulfill({status:503,body:'{}',contentType:'application/json'}));
 await page.locator('#acts button.act').first().click();
 const reader=await context.newPage();reader.on('pageerror',e=>errors.push(e.message));await reader.goto(base);await reader.locator('#tab-reload').waitFor();
 reader.on('dialog',d=>d.accept());await reader.locator('#signout').evaluate(form=>form.requestSubmit());await reader.waitForURL('**/login');await page.waitForURL('**/login');
 const state=await reader.evaluate(async()=>({me:localStorage.getItem('jiggered:me'),keys:Object.keys(localStorage).filter(k=>k.startsWith('jiggered:')&&k!=='jiggered:purge-generation'),items:await new Promise((resolve,reject)=>{const req=indexedDB.open('jiggered-device');req.onsuccess=()=>{const db=req.result,tx=db.transaction('items','readonly'),r=tx.objectStore('items').getAll();tx.oncomplete=()=>{db.close();resolve(r.result)};tx.onerror=()=>reject(tx.error)};req.onerror=()=>reject(req.error)})}));
 assert.equal(state.me,null);assert.deepEqual(state.keys,[]);assert.deepEqual(state.items,[]);assert.deepEqual(errors,[]);
 // A revoked session also removes identity and device copies, rather than reopening offline.
 await reader.locator('#username').fill('tester');await reader.locator('#password').fill('changed-owner-password');await reader.getByRole('button',{name:'Sign in',exact:true}).click();await reader.locator('#t-today').waitFor();await reader.waitForFunction(()=>document.querySelector('#sync')?.dataset.state==='saved');
 assert.equal((await context.request.post(base+'/api/me/sessions/revoke-all',{headers})).status(),200);
 await reader.evaluate(()=>window.dispatchEvent(new Event('online')));await reader.waitForURL('**/login');assert.equal(await reader.evaluate(()=>localStorage.getItem('jiggered:me')),null);
 console.log('PASS: admin changes require fresh password, cookie rotation kills copied token, reader logout purges IndexedDB and fences writer, revoked sessions purge identity');
 }catch(e){console.error(e.stack);process.exitCode=1}finally{await browser?.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true})}})();
