// Real-browser coverage for the administration workspace; no external services.
const {chromium}=require('playwright');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jiggered-admin-nav-'));
const binary=process.env.JIGGERED_TEST_BINARY||path.join(dir,'jiggered');
if(!process.env.JIGGERED_TEST_BINARY)execFileSync(process.env.GO_BINARY||'go',['build','-o',binary,'.']);
const base='http://127.0.0.1:'+(process.env.JIGGERED_TEST_PORT||'18795');
const server=spawn(binary,[],{env:{...process.env,APP_DB:path.join(dir,'jiggered.db'),APP_ADDR:new URL(base).host,APP_USERNAME:'admin',APP_PASSWORD:'preview-password1',APP_SECURE_COOKIE:'false'},stdio:'ignore'});
process.on('exit',()=>server.kill());
(async()=>{let browser;try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,...(process.env.JIGGERED_BROWSER_PATH?{executablePath:process.env.JIGGERED_BROWSER_PATH}:{}),args:JSON.parse(process.env.JIGGERED_BROWSER_ARGS||'[]')});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/login');await page.locator('#username').fill('admin');await page.locator('#password').fill('preview-password1');await page.locator('#signin-form [type=submit]').click();await page.locator('#t-admin').click();
 await page.locator('#users-msg').filter({hasText:'Updated'}).waitFor();
 const sections=['people','email','backups','defaults','connection','activity'];
 assert.equal(await page.locator('.admin-section:visible').count(),1);
 assert.equal(await page.locator('#admin-tab-people').getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#svc-host').isVisible(),false);
 // Arrow keys, Home and End move both focus and the selected panel.
 await page.locator('#admin-tab-people').focus();await page.keyboard.press('ArrowDown');
 assert.equal(await page.locator('#admin-tab-email').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('End');assert.equal(await page.locator('#admin-tab-activity').getAttribute('aria-selected'),'true');
 await page.keyboard.press('Home');assert.equal(await page.locator('#admin-tab-people').getAttribute('aria-selected'),'true');
 await page.locator('#new-name').fill('unfinished-member');await page.locator('#admin-tab-activity').click();await page.locator('#admin-tab-people').click();assert.equal(await page.locator('#new-name').inputValue(),'unfinished-member');
 // Service edits and password reuse survive moving between menus.
 await page.locator('#admin-tab-email').click();await page.locator('#svc-status').filter({hasText:'Paused'}).waitFor({state:'attached'});
 await page.locator('#svc-public_url').fill('https://jiggered.example.com');await page.locator('#svc-password').fill('preview-password1');await page.locator('#services-form [type=submit]').click();await page.locator('#svc-msg').filter({hasText:'Configuration saved'}).waitFor();
 const authStatus=await page.locator('#svc-auth-status').textContent();
 await page.locator('#svc-host').fill('unfinished.example.com');await page.locator('#admin-tab-backups').click();
 assert.equal(await page.locator('#svc-host').isVisible(),false);assert.equal(await page.locator('#svc-bucket').isVisible(),true);
 assert.equal(await page.locator('#svc-auth-status').textContent(),authStatus);
 await page.locator('#svc-bucket').fill('unfinished-backups');await page.locator('#admin-tab-email').click();
 assert.equal(await page.locator('#svc-host').inputValue(),'unfinished.example.com');
 assert.equal(await page.locator('#svc-bucket').inputValue(),'unfinished-backups');
 // An invalid hidden field is revealed by native form validation.
 await page.locator('#svc-port').fill('0');await page.locator('#admin-tab-backups').click();await page.locator('#services-form [type=submit]').click();
 assert.equal(await page.locator('#admin-tab-email').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#svc-port').isVisible(),true);
 await page.locator('#svc-port').fill('587');
 await page.locator('#admin-tab-backups').click();const interval=await page.locator('#svc-interval_hours').inputValue();await page.locator('#svc-interval_hours').fill('0');
 await page.locator('#admin-tab-email').click();await page.locator('#svc-port').fill('0');await page.locator('#services-form [type=submit]').click();
 assert.equal(await page.locator('#admin-tab-backups').getAttribute('aria-selected'),'true','first invalid section stays visible when several fields are invalid');
 await page.locator('#svc-interval_hours').fill(interval);await page.locator('#admin-tab-email').click();await page.locator('#svc-port').fill('587');
 // Validate every section at desktop/tablet/phone widths in both themes.
 const shots=process.env.JIGGERED_SCREENSHOT_DIR;if(shots)fs.mkdirSync(shots,{recursive:true});
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:1000});
   for(const section of sections){
    await page.locator('#admin-tab-'+section).click();
    assert.equal(await page.locator('.admin-section:visible').count(),1,section+' focused panel');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,section+' overflow '+width+' '+theme);
    if(shots&&((width===1440&&theme==='light')||(width===390&&theme==='dark')))await page.screenshot({path:path.join(shots,'admin-'+section+'-'+width+'-'+theme+'.png'),fullPage:true});
   }
  }
 }
 // Manual backup encryption is independent of the admin confirmation password.
 await page.locator('#admin-tab-backups').click();await page.locator('#backup-encrypt').check();
 await page.locator('#backup-pw').fill('preview-password1');await page.locator('#backup-encryption-password').fill('archive-password1');await page.locator('#backup-encryption-confirm').fill('different-password');
 await page.locator('#backup').click();await page.locator('#backup-msg').filter({hasText:'match it in both fields'}).waitFor();
 await page.locator('#backup-encryption-confirm').fill('archive-password1');const downloadReady=page.waitForEvent('download');await page.locator('#backup').click();const download=await downloadReady;
 assert.match(download.suggestedFilename(),/\.zip\.enc$/);const content=fs.readFileSync(await download.path());assert.equal(content.subarray(0,Buffer.byteLength('jiggered-backup-enc-v1\n')).toString(),'jiggered-backup-enc-v1\n');
 await page.locator('#backup-msg').filter({hasText:'Backup downloaded'}).waitFor();assert.equal(await page.locator('#backup-encryption-password').inputValue(),'');
 // Adding a member keeps account management inside its own section.
 await page.locator('#admin-tab-people').click();await page.locator('#new-name').fill('newmember');await page.locator('#admin-confirm-pw').fill('preview-password1');await page.locator('#adduser [type=submit]').click();await page.locator('#adduser-msg').filter({hasText:'Created newmember'}).waitFor();
 const row=page.locator('[data-name="newmember"]');assert.equal(await row.locator('[data-act="reset"]').isVisible(),false);await row.locator('summary').click();assert.equal(await row.locator('[data-act="reset"]').isVisible(),true);
 await page.locator('#brand-home').click();assert.equal(await page.locator('#t-today').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#today-panel').isVisible(),true);await page.locator('#t-admin').click();assert.equal(await page.locator('#admin-tab-people').getAttribute('aria-selected'),'true');
 assert.deepEqual(errors,[]);console.log('PASS: admin sections, keyboard navigation, preserved edits/password cache, validation, account actions and responsive themes.');
 }finally{await browser?.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
