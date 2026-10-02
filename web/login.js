const e = new URLSearchParams(location.search).get("e");
const msgs = {
  bad: "That username or password didn't match. Try again. (After ten wrong tries an account is paused for 15 minutes.)",
  locked: "Too many attempts. Wait 15 minutes, then try again.",
  disabled: "This account has been switched off. Ask whoever runs this Jiggered to turn it back on.",
  busy: "Lots of people are signing in at once. Try again in a moment."
};
const msg = msgs[Object.hasOwn(msgs, e) ? e : ""];
if (msg) document.getElementById("err").textContent = msg;

const $ = id => document.getElementById(id);
const forms = ['signin','register','forgot','reset','verify','two-step'];
function show(which) { for(const name of forms) $(name+'-form').hidden=name!==which; $(which+'-form').querySelector('input,button')?.focus() }
$('open-register').addEventListener('click',()=>show('register'));
$('open-forgot').addEventListener('click',()=>show('forgot'));
document.querySelectorAll('[data-signin]').forEach(b=>b.addEventListener('click',()=>{history.replaceState(null,'','/login');show('signin')}));
fetch('/api/auth/options',{credentials:'same-origin'}).then(r=>r.ok?r.json():{}).then(o=>{$('open-register').hidden=!o.registration;$('open-forgot').hidden=!o.recovery}).catch(()=>{});
let token='';
function readFragment(){const fragment=new URLSearchParams(location.hash.slice(1));token=fragment.get('reset')||fragment.get('verify')||'';if(location.hash){history.replaceState(null,'',location.pathname+location.search);show(fragment.has('reset')?'reset':fragment.has('verify')?'verify':'signin')}else if(new URLSearchParams(location.search).get('step')==='2')show('two-step')}
readFragment();window.addEventListener('hashchange',readFragment);
async function submit(which,path,body,success) {
 const form=$(which+'-form'),button=form.querySelector('[type=submit]'),message=$(which+'-msg');
 if(button.disabled)return;button.disabled=true;form.setAttribute('aria-busy','true');message.textContent='Working…';message.classList.remove('err');
 try{const r=await fetch('/api/auth/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'jiggered'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const value=await r.json().catch(()=>({}));message.textContent=value.message||value.error||'Request failed. Try again.';message.classList.toggle('err',!r.ok);if(r.ok){success?.();form.querySelectorAll('input[type=password]').forEach(el=>el.value='')}}
 catch{message.textContent='Could not connect. Check your connection and try again.';message.classList.add('err')}
 finally{button.disabled=false;form.removeAttribute('aria-busy')}
}
function passwordsMatch(which){if($(which+'-password').value===$(which+'-confirm').value)return true;$(which+'-msg').textContent='The passwords do not match.';$(which+'-confirm').focus();return false}
$('register-form').addEventListener('submit',ev=>{ev.preventDefault();if(passwordsMatch('register'))submit('register','register',{username:$('register-name').value,email:$('register-email').value,password:$('register-password').value})});
$('forgot-form').addEventListener('submit',ev=>{ev.preventDefault();submit('forgot','forgot-password',{email:$('forgot-email').value})});
$('verify-form').addEventListener('submit',ev=>{ev.preventDefault();submit('verify','verify',{token},()=>token='')});
$('reset-form').addEventListener('submit',ev=>{ev.preventDefault();if(passwordsMatch('reset'))submit('reset','reset-password',{token,password:$('reset-password').value,code:$('reset-code').value},()=>token='')});
$('two-step-form').addEventListener('submit',ev=>{ev.preventDefault();submit('two-step','two-step',{code:$('two-step-code').value},()=>location.assign('/'))});
