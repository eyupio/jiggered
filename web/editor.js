// Shared personal/default settings editor. Ordering works with pointer, touch, keyboard or buttons.
import { html, setHTML, uid } from "./util.js";
import { LOCALES, LIMITS, validateSettings, normaliseSettings, identifyActivities } from "./model.js";
export const moveItem = (items, from, to) => { const out = [...items]; if (from < 0 || to < 0 || from >= out.length || to >= out.length) return out; out.splice(to, 0, out.splice(from, 1)[0]); return out };
export function editorMarkup(prefix) {
 return html`<div class="row2"><label class="field">Points per day<input type="number" id="${prefix}-budget" min="1" max="30" required></label><label class="field">Poor sleep costs<input type="number" id="${prefix}-penalty" min="0" max="30" required></label></div><label class="field">Dates shown as<select id="${prefix}-locale">${LOCALES.map(([v,label])=>html`<option value="${v}">${label}</option>`)}</select></label>${[["acts","Activities"],["sym","Symptoms"],["trig","Triggers"]].map(([key,label])=>html`<fieldset><legend>${label}</legend><p class="hint">Drag the handle to reorder, or use its arrow keys and the move buttons. Up to ${LIMITS.items} distinct names, 60 characters each.${key === "acts" ? " Points: −10 to 10; negative gives points back, zero only logs. Optional group names (for example Work or Home) sort long lists into sections on Today." : ""}</p><div class="ordered-list" id="${prefix}-${key}" data-list="${key}"></div><button type="button" class="secondary" data-add="${key}">Add ${key === "acts" ? "activity" : key === "sym" ? "symptom" : "trigger"}</button></fieldset>`) }<datalist id="${prefix}-groups"></datalist>${prefix === "set" ? html`<p class="hint" data-gap hidden></p>` : ""}<p class="sr-only" role="status" data-order-status></p><div class="row"><button class="primary" type="submit">Save ${prefix === "def" ? "shared defaults" : "settings"}</button><button class="secondary" type="button" data-discard>Discard draft</button>${prefix === "set" ? html`<button class="secondary" type="button" data-merge>Add new shared items</button>` : ""}<button class="secondary" type="button" data-reset>${prefix === "def" ? "Use factory defaults" : "Replace with shared defaults"}</button></div><p class="msg" id="${prefix}-msg" role="status"></p>`;
}
export function createEditor(form, prefix, onChange = () => {}) {
 const get = key => form.querySelector(`#${prefix}-${key}`);
 const row = (key,name="",cost=1,id=uid(),group="") => html`<div class="order-row" data-row data-id="${id}"><button type="button" class="drag-handle" aria-label="Move ${name || "item"}; arrow keys reorder" title="Drag to reorder; arrow keys also work">⠿</button><input type="text" value="${name}" aria-label="${key === "acts" ? "Activity" : key === "sym" ? "Symptom" : "Trigger"} name" placeholder="Name">${key === "acts" ? html`<input class="order-cost" type="number" min="-10" max="10" step="1" value="${cost}" aria-label="Points it costs" required><input class="order-group" type="text" maxlength="30" list="${prefix}-groups" value="${group}" aria-label="Group (optional)" placeholder="Group">` : ""}<div class="order-actions"><button type="button" data-move="-1" class="x" aria-label="Move up">↑</button><button type="button" data-move="1" class="x" aria-label="Move down">↓</button><button type="button" data-remove class="x" aria-label="Remove ${name || "item"}">×</button></div></div>`;
 function syncGroups(){const dl=get('groups');if(dl)setHTML(dl,html`${[...new Set([...get('acts').querySelectorAll('.order-group')].map(i=>i.value.trim()).filter(Boolean))].map(g=>html`<option value="${g}">`)}`)}
 function refresh(list) {
  [...list.children].forEach((r,i)=>{ r.querySelector('[data-move="-1"]').disabled=i===0; r.querySelector('[data-move="1"]').disabled=i===list.children.length-1; r.querySelector('.drag-handle').setAttribute('aria-label',`Move ${r.querySelector('input').value || 'item'}, position ${i+1} of ${list.children.length}; arrow keys reorder`) });
 }
 function reposition(r, index) {
  const list=r.parentElement, rows=[...list.children], old=rows.indexOf(r); index=Math.max(0,Math.min(rows.length-1,index)); if(index===old)return;
  const rects=new Map(rows.map(el=>[el,el.getBoundingClientRect().top]));
  const ordered=moveItem(rows,old,index); list.replaceChildren(...ordered); refresh(list);
  if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) for(const el of rows) { const delta=rects.get(el)-el.getBoundingClientRect().top; if(delta && el.animate) el.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:160,easing:'ease-out'}) }
  form.querySelector('[data-order-status]').textContent=`${r.querySelector('input').value || 'Item'} moved to position ${index+1}.`;
  onChange();
 }
 form.addEventListener('input',()=>{ for(const list of form.querySelectorAll('[data-list]'))refresh(list); syncGroups(); onChange() });
 form.addEventListener('click',e=>{
  const add=e.target.closest('[data-add]'), remove=e.target.closest('[data-remove]'), move=e.target.closest('[data-move]');
  if(add){const list=get(add.dataset.add); if(list.children.length>=LIMITS.items){get('msg').textContent=`Keep at most ${LIMITS.items} items in each list.`;return} const template=document.createElement('template');setHTML(template,row(add.dataset.add));list.append(template.content);refresh(list);list.lastElementChild.querySelector('input').focus();onChange()}
  if(remove){const list=remove.closest('[data-list]');remove.closest('[data-row]').remove();refresh(list);onChange()}
  if(move){const r=move.closest('[data-row]');reposition(r,[...r.parentElement.children].indexOf(r)+Number(move.dataset.move));r.querySelector('.drag-handle').focus()}
 });
 form.addEventListener('keydown',e=>{ if(!e.target.closest('.drag-handle') || !['ArrowUp','ArrowDown','Home','End'].includes(e.key))return; e.preventDefault(); const r=e.target.closest('[data-row]'),list=r.parentElement,i=[...list.children].indexOf(r);reposition(r,e.key==='Home'?0:e.key==='End'?list.children.length-1:i+(e.key==='ArrowUp'?-1:1));r.querySelector('.drag-handle').focus() });
 // One gesture model for mouse and touch. A floating preview follows the pointer, the original is the drop placeholder.
 form.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('.drag-handle'); if(!handle || e.button!==0)return;
  const r=handle.closest('[data-row]'),list=r.parentElement,startX=e.clientX,startY=e.clientY;
  const originalIndex=[...list.children].indexOf(r), slots=[...list.children].map(row=>{const rect=row.getBoundingClientRect();return rect.top+rect.height/2+window.scrollY});
  let ghost=null,frame=null,lastY=startY,lastX=startX;
  const position=()=>{const rect=list.getBoundingClientRect();if(lastX<rect.left-40 || lastX>rect.right+40)return;const y=lastY+window.scrollY;let index=0;for(let i=1;i<slots.length;i++)if(Math.abs(slots[i]-y)<Math.abs(slots[index]-y))index=i;reposition(r,index)};
  const scroll=()=>{ if(ghost){ if(lastY<80)window.scrollBy(0,-10); else if(lastY>window.innerHeight-80)window.scrollBy(0,10); position(); frame=requestAnimationFrame(scroll) } };
  const move=event=>{
   if(event.pointerId!==e.pointerId)return;lastY=event.clientY;lastX=event.clientX;
   if(!ghost && Math.hypot(event.clientX-startX,event.clientY-startY)<6)return;
   event.preventDefault();
   if(!ghost){ghost=r.cloneNode(true);ghost.classList.add('drag-preview');ghost.setAttribute('aria-hidden','true');ghost.inert=true;const rect=r.getBoundingClientRect();ghost.style.width=rect.width+'px';document.body.append(ghost);r.classList.add('drop-placeholder');frame=requestAnimationFrame(scroll)}
   ghost.style.left=(event.clientX-20)+'px';ghost.style.top=(event.clientY-20)+'px';
   position();
  };
  const finish=event=>{if(event.pointerId!==e.pointerId)return;document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);document.removeEventListener('keydown',escape);if(event.type==='pointercancel')reposition(r,originalIndex);ghost?.remove();cancelAnimationFrame(frame);r.classList.remove('drop-placeholder');handle.focus();if(ghost){const stop=event=>{event.preventDefault();event.stopPropagation()};handle.addEventListener('click',stop,{once:true})}};
  const escape=event=>{if(event.key==='Escape'){event.preventDefault();finish({pointerId:e.pointerId,type:'pointercancel'})}};
  document.addEventListener('keydown',escape);
  document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
 });
 return {
  fill(S){get('budget').value=S.budget;get('penalty').value=S.sleepPenalty;get('locale').value=S.locale;for(const [key,items] of [['acts',identifyActivities(S.activities)],['sym',S.symptoms],['trig',S.triggers]]){setHTML(get(key),html`${items.map(x=>row(key,typeof x==='string'?x:x.a,x.c,x.id,x.g||""))}`);refresh(get(key))}syncGroups()},
  read(){return {budget:get('budget').value,sleepPenalty:get('penalty').value,locale:get('locale').value,activities:[...get('acts').children].map(r=>({id:r.dataset.id,a:r.querySelector('input').value,c:r.querySelectorAll('input')[1].value,...(r.querySelectorAll('input')[2].value.trim()?{g:r.querySelectorAll('input')[2].value.trim()}:{})})),symptoms:[...get('sym').children].map(r=>r.querySelector('input').value),triggers:[...get('trig').children].map(r=>r.querySelector('input').value)}},
  validate(){const value=this.read(),errors=validateSettings(value);form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));get('msg').textContent=errors.map(([,message])=>message).join(' ');get('msg').classList.toggle('err',!!errors.length);for(const [field] of errors){const el=get(field.replace('set-',''));el.setAttribute('aria-invalid','true')}if(errors.length){const el=get(errors[0][0].replace('set-',''));(el.matches('input,textarea,select')?el:el.querySelector('input'))?.focus();return null}return normaliseSettings(value)},
  focus(key){const el=get(key.replace('set-',''));el?.scrollIntoView({block:'center',behavior:'smooth'});(el?.matches('input,select')?el:el?.querySelector('input'))?.focus()},
 };
}
