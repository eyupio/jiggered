import { $, api, html, setHTML, withBusy, downloadFile } from './util.js';
export const securityMarkup=`<section class="panel" id="security-panel" aria-labelledby="security-title">
 <div class="service-heading"><h2 id="security-title">Sign-in security</h2><span class="badge" id="security-status">Loading</span></div>
 <p class="meta">Protect your account with an authenticator app and a verified recovery email.</p>
 <form id="security-email-form"><h3>Recovery email</h3><p id="security-email-current" class="meta"></p><label>Email address<input id="security-email" type="email" autocomplete="email" required></label><label>Your current password<input id="security-email-password" type="password" autocomplete="current-password" required></label><button class="secondary" type="submit">Send verification email</button><p class="msg" id="security-email-msg" role="status"></p></form>
 <form id="security-factor-form"><h3>Two-step verification</h3><p class="meta" id="security-factor-description">Use an authenticator such as Microsoft Authenticator, Google Authenticator, Aegis or your password manager.</p>
 <label>Your current password<input id="security-password" type="password" autocomplete="current-password" required></label>
 <div id="security-setup" hidden><p class="meta">1. Scan the QR code in your authenticator app, or enter the key manually.<br>2. Enter the app's six-digit code below, then confirm.</p><img class="security-qr" id="security-qr" alt="Authenticator setup QR code"><p class="security-secret" id="security-secret"></p></div>
 <label id="security-code-label" hidden>Authenticator or unused recovery code<input id="security-code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false"></label>
 <div class="service-actions"><button class="primary" type="button" id="security-start" data-tooltip="A code must be confirmed before two-step verification is enabled. Recovery codes are shown once after setup.">Set up authenticator</button><button class="primary" type="button" id="security-enable" hidden>Confirm & enable</button><button class="secondary" type="button" id="security-regenerate" hidden>Create new recovery codes</button><button class="danger" type="button" id="security-disable" hidden>Disable two-step verification</button></div>
 <p class="msg" id="security-msg" role="status" aria-live="polite"></p></form>
 <div id="security-recovery" hidden><h3>Keep your recovery codes safe</h3><p class="meta">Each code works once if you lose access to your authenticator. These codes are shown only now. Store them privately; keep them separate from your password.</p><div id="security-codes" class="security-codes"></div><div class="service-actions"><button class="secondary" id="security-download" type="button">Download codes</button><button class="primary" id="security-hide" type="button">I've saved my codes</button></div></div>
 <button class="secondary small" id="security-refresh">Refresh security status</button>
</section>`;
export function initSecurity(ctx){
 let enabled=false,pending=false,codes=[];
 const say=(id,text,bad=false)=>{if(!$(id))return;$(id).textContent=text;$(id).classList.toggle('err',bad)};
 async function load(){const r=await api('GET','/api/me/security');if(!$('security-status'))return;if(!r.ok)return say('security-msg',r.error,true);enabled=r.data.two_factor;$('security-status').textContent=enabled?'Two-step enabled':'Password only';$('security-email-current').textContent=r.data.email?`Verified address: ${r.data.email}`:'No verified recovery email yet.';$('security-email-form').hidden=!r.data.email_available;
  $('security-start').hidden=enabled||pending;$('security-enable').hidden=!pending;$('security-regenerate').hidden=!enabled;$('security-disable').hidden=!enabled;$('security-code-label').hidden=!enabled&&!pending;
  $('security-factor-description').textContent=enabled?`Authenticator protection is on. ${r.data.recovery_codes_left} unused recovery codes remain.`:'Use an authenticator app for a second step after your password.';
 }
 $('security-email-form').addEventListener('submit',ev=>{ev.preventDefault();withBusy(ev.target.querySelector('[type=submit]'),'Sending…',async()=>{const password=$('security-email-password').value;$('security-email-password').value='';const r=await api('POST','/api/me/security/email',{password,email:$('security-email').value});say('security-email-msg',r.ok?r.data.message:r.error,!r.ok)})});
 async function action(button,action){
  const password=$('security-password').value;if(!password){$('security-password').focus();return say('security-msg','Enter your current password to continue.',true)}
  if(action==='disable'&&!confirm('Disable authenticator protection? Your other devices will be signed out.'))return;
  if(action==='regenerate'&&!confirm('Replace all recovery codes? Previously saved codes will no longer work.'))return;
  await withBusy(button,'Working…',async()=>{const code=$('security-code').value;$('security-password').value='';$('security-code').value='';const r=await api('POST','/api/me/security/two-factor',{action,password,code});if(!r.ok)return say('security-msg',r.error,true);say('security-msg',r.data.message);
   if(action==='setup'){pending=true;$('security-setup').hidden=false;$('security-qr').src=r.data.qr;$('security-secret').textContent=r.data.secret}
   else{pending=false;$('security-setup').hidden=true;$('security-qr').removeAttribute('src');$('security-secret').textContent=''}
   if(r.data.codes){codes=r.data.codes;setHTML($('security-codes'),html`${codes.map(c=>html`<code>${c}</code>`)}`);$('security-recovery').hidden=false}
   await load();if(action==='setup')$('security-code').focus();
  });
 }
 for(const [id,act]of [['start','setup'],['enable','enable'],['regenerate','regenerate'],['disable','disable']])$('security-'+id).addEventListener('click',e=>action(e.currentTarget,act));
 $('security-factor-form').addEventListener('submit',e=>{e.preventDefault();if(pending)action($('security-enable'),'enable')});
 $('security-download').addEventListener('click',()=>downloadFile('jiggered-recovery-codes.txt',`Jiggered recovery codes for ${ctx.me.username}\n${location.origin}\nEach code can be used once. Keep private.\n\n${codes.join('\n')}`));
 $('security-hide').addEventListener('click',()=>{codes=[];$('security-codes').replaceChildren();$('security-recovery').hidden=true});$('security-refresh').addEventListener('click',load);
 return {load};
}
