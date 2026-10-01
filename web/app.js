const BUDGET=10;
const ACTS=[
  {a:"Meeting or call",c:2},{a:"Unplanned interruption",c:3},
  {a:"Context switch",c:1},{a:"Deep focus (2 hours)",c:1},
  {a:"Social or noisy place",c:3},{a:"Travel or commute",c:2},
  {a:"Walk or dog walk",c:-2,rec:1},{a:"Quiet break",c:-1,rec:1}];
const SYM=["Face numb or tingling","Hand or arm numb","Arm clumsy","Blurred vision","Eye discomfort","Headache","Speech change","Weakness"];
const ONSET=["Built up gradually","Sudden"];
const TRIG=["Poor sleep","High stress","Overload or overwhelm","Long hyperfocus","Long screen time","Skipped meals","Low water","Noisy or busy place","Alcohol","Missed tablets"];
const ADVICE={green:"Normal plan. Still leave gaps between demanding things.",amber:"Cut today's plan. Drop or move one demanding thing now.",red:"Essentials only. Protect your energy and plan recovery time."};

const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,"0");
const dkey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const TODAY=dkey(new Date());
$("today").textContent=new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});

let docs={}; // id -> body

// ---- storage: this server's API ----
const API={headers:{"X-Requested-With":"jiggered"}};
function setSync(t){$("sync").textContent=t}
async function call(method,id,body){
  const r=await fetch("/api/docs/"+encodeURIComponent(id),{method,headers:{...API.headers,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,credentials:"same-origin"});
  if(r.status===401){location.href="/login";throw new Error("signed out")}
  if(!r.ok)throw new Error(r.status);
}
const store={
  save(id,b){docs[id]=b;render();call("PUT",id,b).then(()=>setSync("Saved."),()=>setSync("That change didn't save. Check your connection and try again."))},
  remove(id){delete docs[id];render();call("DELETE",id).catch(()=>setSync("Couldn't delete that. Try again."))}
};
async function load(){
  try{
    const r=await fetch("/api/docs",{credentials:"same-origin"});
    if(r.status===401){location.href="/login";return}
    docs=await r.json();setSync("Saved on your server.");render();
  }catch(e){setSync("Couldn't load your data. Check your connection and refresh.")}
}

// refresh when returning to the app
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")load()});

function day(){return docs["d-"+TODAY]||{date:TODAY,status:null,poorSleep:false,entries:[]}}
function saveDay(d){store.save("d-"+TODAY,{...d,date:TODAY})}
function used(d){return d.entries.reduce((s,e)=>s+e.c,0)}
function cap(d){return BUDGET-(d.poorSleep?3:0)}

// ---- build static controls ----
$("acts").innerHTML=ACTS.map((x,i)=>`<button class="act${x.rec?" rec":""}" data-i="${i}"><span>${x.a}</span><span class="c">${x.c>0?"−"+x.c:"+"+(-x.c)}</span></button>`).join("");
const chips=(el,arr,name,type)=>{$(el).innerHTML=arr.map((t,i)=>`<label class="chip"><input type="${type}" name="${name}" id="${name}-${i}" value="${t}"><span>${t}</span></label>`).join("")};
chips("ep-sym",SYM,"sym","checkbox");chips("ep-onset",ONSET,"onset","radio");chips("ep-trig",TRIG,"trig","checkbox");

$("checkin").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const d=day();d.status=d.status===b.dataset.s?null:b.dataset.s;saveDay(d)});
$("sleep").addEventListener("change",e=>{const d=day();d.poorSleep=e.target.checked;saveDay(d)});
$("acts").addEventListener("click",e=>{const b=e.target.closest(".act");if(!b)return;const x=ACTS[b.dataset.i];const d=day();
  const t=new Date();d.entries=[...d.entries,{a:x.a,c:x.c,t:`${pad(t.getHours())}:${pad(t.getMinutes())}`}];saveDay(d)});
$("entries").addEventListener("click",e=>{const b=e.target.closest(".x");if(!b)return;const d=day();d.entries=d.entries.filter((_,i)=>i!=b.dataset.i);saveDay(d)});

document.querySelector("nav").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  document.querySelectorAll("nav button").forEach(n=>n.setAttribute("aria-selected",n===b));
  ["today","episode","history"].forEach(t=>$(t+"-panel").hidden=t!==b.dataset.tab)});

function nowLocal(){const t=new Date();return `${dkey(t)}T${pad(t.getHours())}:${pad(t.getMinutes())}`}
$("ep-when").value=nowLocal();
$("epform").addEventListener("submit",e=>{e.preventDefault();
  const pick=n=>[...document.querySelectorAll(`input[name=${n}]:checked`)].map(i=>i.value);
  const body={when:$("ep-when").value,symptoms:pick("sym"),onset:pick("onset")[0]||"",duration:$("ep-dur").value,before:pick("trig"),notes:$("ep-notes").value.trim()};
  store.save("e-"+Date.now(),body);
  e.target.reset();$("ep-when").value=nowLocal();$("eptoast").textContent="Episode saved.";setTimeout(()=>$("eptoast").textContent="",3000)});
$("eps").addEventListener("click",e=>{const b=e.target.closest(".x");if(b)store.remove(b.dataset.id)});

const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function fmtDate(k){const[y,m,d]=k.split("-");return new Date(y,m-1,d).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}

function render(){
  const d=day(),u=used(d),c=cap(d),left=c-u;
  document.querySelectorAll("#checkin button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.s===d.status));
  $("advice").textContent=d.status?ADVICE[d.status]:"How are you starting today? Pick one.";
  $("sleep").checked=!!d.poorSleep;
  $("left").innerHTML=`${left} <small>of ${c}</small>`;
  $("spentline").textContent=u>=0?`${u} spent`:`${-u} recovered`;
  const cells=[];for(let i=0;i<BUDGET;i++){cells.push(i>=c?"cell lost":(i>=Math.max(0,left)?"cell spent":"cell"))}
  $("cells").innerHTML=cells.map(k=>`<div class="${k}"></div>`).join("");
  $("cells").className="cells"+(left<=0?" out":left<=3?" low":"");
  $("entries").innerHTML=d.entries.map((e,i)=>`<li><span><span class="meta">${e.t}</span> ${esc(e.a)} <b>${e.c>0?"−"+e.c:"+"+(-e.c)}</b></span><button class="x" data-i="${i}">Undo</button></li>`).join("");
  $("noentries").hidden=d.entries.length>0;

  // history
  const days=Object.entries(docs).filter(([k])=>k.startsWith("d-")).map(([,v])=>v).sort((a,b)=>b.date.localeCompare(a.date));
  const byDate=Object.fromEntries(days.map(x=>[x.date,x]));
  const strip=[];for(let i=13;i>=0;i--){const t=new Date();t.setDate(t.getDate()-i);const s=byDate[dkey(t)]?.status;strip.push(`<div class="${s||""}" title="${dkey(t)}"></div>`)}
  $("strip").innerHTML=strip.join("");
  $("days").innerHTML=days.slice(0,30).map(x=>{const uu=used(x),cc=cap(x);return `<li><span><span class="dot ${x.status||""}"></span>${fmtDate(x.date)}${x.poorSleep?' <span class="meta">· poor sleep</span>':""}</span><span class="meta">${uu} of ${cc} used</span></li>`}).join("");
  $("nodays").hidden=days.length>0;
  const eps=Object.entries(docs).filter(([k])=>k.startsWith("e-")).sort((a,b)=>b[1].when.localeCompare(a[1].when));
  $("eps").innerHTML=eps.map(([id,x])=>{const w=new Date(x.when);return `<div class="ep"><b>${w.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}, ${pad(w.getHours())}:${pad(w.getMinutes())}</b>
    <span>${esc(x.symptoms.join(", ")||"No symptoms ticked")}</span>
    <span class="meta">${esc([x.onset,x.duration].filter(Boolean).join(" · "))}</span>
    ${x.before.length?`<span class="meta">Before: ${esc(x.before.join(", "))}</span>`:""}
    ${x.notes?`<span class="meta">${esc(x.notes)}</span>`:""}
    <span><button class="x" data-id="${id}">Delete</button></span></div>`}).join("");
  $("noeps").hidden=eps.length>0;
}

render();
load();
