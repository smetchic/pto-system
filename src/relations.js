import {createClient} from '@supabase/supabase-js';
import {escapeHtml as e} from './domain.js';

const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const dialog=document.querySelector('#dialog');
const esc=v=>e(v??'');

const counterpartyRoleNames={
 customer:'Заказчик',
 general_contractor:'Генподрядчик / подрядчик',
 subcontractor:'Субподрядчик',
 supplier:'Поставщик',
 service_provider:'Исполнитель услуг'
};
const contractModes={
 contractor:{label:'Подрядчик',counterpartyRole:'customer',counterpartyLabel:'Заказчик'},
 subcontractor:{label:'Субподрядчик',counterpartyRole:'general_contractor',counterpartyLabel:'Генподрядчик / подрядчик'},
 customer:{label:'Заказчик субподрядных работ',counterpartyRole:'subcontractor',counterpartyLabel:'Субподрядчик'},
 buyer:{label:'Покупатель',counterpartyRole:'supplier',counterpartyLabel:'Поставщик'},
 service_customer:{label:'Заказчик услуг',counterpartyRole:'service_provider',counterpartyLabel:'Исполнитель услуг'}
};
const participantRoles=['customer','general_contractor','subcontractor','supplier','service_provider'];

if(url&&key&&key.startsWith('sb_publishable_')){
 const client=createClient(url,key);
 let cache=null;
 let userRole=null;
 let currentProjectId='';
 let scheduled=false;

 const css=document.createElement('style');
 css.textContent=`
  .rel-participants{margin-bottom:22px}.rel-table td{vertical-align:top}.rel-org{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 14px}
  .rel-org b{font-weight:600}.rel-subject{display:block;margin-top:3px}.rel-role-note{display:block;margin-top:3px}
  .rel-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.rel-grid .wide{grid-column:1/-1}
  @media(max-width:760px){.rel-grid{grid-template-columns:1fr}.rel-grid .wide{grid-column:auto}}
 `;
 document.head.appendChild(css);

 async function q(request){const {data,error}=await request;if(error)throw error;return data;}
 async function load(force=false){
  if(cache&&!force)return cache;
  const [counterparties,roles,participants,contracts,projects,organization]=await Promise.all([
   q(client.from('pto_counterparties').select('*').order('short_name')),
   q(client.from('pto_counterparty_roles').select('counterparty_id,role')),
   q(client.from('pto_project_participants').select('*')),
   q(client.from('pto_contract_list').select('*').order('id')),
   q(client.from('pto_projects').select('id,name,full_name')),
   q(client.from('pto_organization').select('*').limit(1).maybeSingle())
  ]);
  cache={counterparties,roles,participants,contracts,projects,organization};
  return cache;
 }
 async function getUserRole(){
  if(userRole!==null)return userRole;
  const {data:{session}}=await client.auth.getSession();
  if(!session)return userRole='';
  const p=await q(client.from('pto_profiles').select('role,active').eq('id',session.user.id).maybeSingle());
  return userRole=p?.active?p.role:'';
 }
 const canEdit=()=>['head','engineer','admin'].includes(userRole);
 const rolesFor=id=>cache?.roles?.filter(r=>r.counterparty_id===id).map(r=>r.role)||[];
 const cpById=id=>cache?.counterparties?.find(c=>c.id===id);

 function resolveProject(){
  if(currentProjectId&&cache?.projects?.some(p=>p.id===currentProjectId))return currentProjectId;
  const h1=document.querySelector('#shell main .pg .object-heading h1');
  if(!h1)return '';
  const name=h1.textContent.trim();
  const matches=cache?.projects?.filter(p=>p.name===name)||[];
  if(matches.length===1)currentProjectId=matches[0].id;
  return currentProjectId;
 }

 function makeField(label,name,type='text',required=false){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.name=name;input.type=type;input.autocomplete='off';input.required=required;l.appendChild(input);return l;}
 function makeArea(label,name){const l=document.createElement('label');l.className='wide';l.textContent=label;const ta=document.createElement('textarea');ta.name=name;ta.autocomplete='off';l.appendChild(ta);return l;}
 function makeSelect(label,name,options){const l=document.createElement('label');l.textContent=label;const s=document.createElement('select');s.name=name;s.required=true;s.innerHTML=options.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('');l.appendChild(s);return {label:l,select:s};}

 function counterpartyOptions(role){
  const matching=[],other=[];
  for(const c of cache.counterparties){
   const item=`<option value="${esc(c.id)}">${esc(c.short_name)} · УНП ${esc(c.unp)}</option>`;
   (rolesFor(c.id).includes(role)?matching:other).push(item);
  }
  let html='<option value="">Выберите контрагента</option>';
  if(matching.length)html+=`<optgroup label="${esc(counterpartyRoleNames[role])}">${matching.join('')}</optgroup>`;
  if(other.length)html+=`<optgroup label="Другие контрагенты">${other.join('')}</optgroup>`;
  return html;
 }

 async function enhanceContractDialog(){
  if(!dialog?.open)return;
  const title=dialog.querySelector('h2')?.textContent?.trim();
  if(title!=='Новый договор')return;
  const form=dialog.querySelector('#modal-form');
  if(!form||form.dataset.relations==='1')return;
  await load();
  if(!form.isConnected)return;
  form.dataset.relations='1';

  const numberInput=form.querySelector('input[name="number"]');
  const partyInput=form.querySelector('input[name="party"]');
  const directionSelect=form.querySelector('select[name="direction"]');
  if(!numberInput||!partyInput||!directionSelect)return;

  const dateLabel=makeField('Дата договора','contract_date','date',true);
  numberInput.closest('label').after(dateLabel);

  const mode=makeSelect('Наша роль по договору','our_role',Object.entries(contractModes).map(([v,x])=>[v,x.label]));
  mode.select.value='subcontractor';
  directionSelect.closest('label').replaceWith(mode.label);

  const cpLabel=partyInput.closest('label');
  const cpSelect=document.createElement('select');
  cpSelect.name='counterparty_id';cpSelect.required=true;
  cpLabel.textContent='';cpLabel.append('Контрагент',cpSelect);

  const hiddenRole=document.createElement('input');hiddenRole.type='hidden';hiddenRole.name='counterparty_role';form.appendChild(hiddenRole);
  const subject=makeArea('Предмет договора','subject');cpLabel.after(subject);

  const sync=()=>{
   const def=contractModes[mode.select.value]||contractModes.subcontractor;
   hiddenRole.value=def.counterpartyRole;
   cpLabel.firstChild.textContent=def.counterpartyLabel;
   const prev=cpSelect.value;
   cpSelect.innerHTML=counterpartyOptions(def.counterpartyRole);
   if([...cpSelect.options].some(o=>o.value===prev))cpSelect.value=prev;
  };
  mode.select.addEventListener('change',sync);
  sync();
 }

 function patchContractTable(projectId){
  const title=[...document.querySelectorAll('#shell main .pg h2')].find(x=>x.textContent.trim()==='Договоры объекта');
  const table=title?.parentElement?.nextElementSibling;
  if(!table||table.tagName!=='TABLE'||table.dataset.relations==='1')return;
  const contracts=cache.contracts.filter(c=>c.project_id===projectId).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const headers=table.querySelectorAll('thead th');
  if(headers[1])headers[1].textContent='Наша роль';
  if(headers[2])headers[2].textContent='Контрагент / роль';
  [...table.querySelectorAll('tbody tr')].forEach((tr,i)=>{
   const c=contracts[i];if(!c)return;
   const cells=tr.querySelectorAll('td');
   if(cells[0])cells[0].innerHTML=`<button class="link" data-action="contract" data-id="${esc(c.id)}">${esc(c.number)}</button>${c.contract_date?`<small>${esc(new Date(c.contract_date+'T12:00:00Z').toLocaleDateString('ru-RU'))}</small>`:''}${c.subject?`<small class="rel-subject">${esc(c.subject)}</small>`:''}`;
   if(cells[1])cells[1].textContent=contractModes[c.our_role]?.label||c.our_role||'';
   if(cells[2])cells[2].innerHTML=`${esc(c.party)}<small class="rel-role-note">${esc(counterpartyRoleNames[c.counterparty_role]||c.counterparty_role||'')}</small>`;
  });
  table.dataset.relations='1';
 }

 function participantRows(projectId){
  const rows=cache.participants.filter(p=>p.project_id===projectId);
  if(!rows.length)return '<tr><td colspan="4"><div class="empty">Участники объекта ещё не назначены.</div></td></tr>';
  return rows.sort((a,b)=>participantRoles.indexOf(a.role)-participantRoles.indexOf(b.role)).map(p=>{
   const c=cpById(p.counterparty_id);
   return `<tr><td><span class="pill">${esc(counterpartyRoleNames[p.role]||p.role)}</span></td><td><b>${esc(c?.short_name||'')}</b><small>${esc(c?.full_name||'')}</small></td><td>${esc(c?.unp||'')}</td><td>${canEdit()?`<button data-rel-action="remove-participant" data-id="${esc(p.id)}">Убрать</button>`:''}</td></tr>`;
  }).join('');
 }

 function participantSignature(projectId){
  const rows=cache.participants
   .filter(p=>p.project_id===projectId)
   .map(p=>[p.id,p.counterparty_id,p.role])
   .sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({projectId,editable:canEdit(),org:[cache.organization?.unp||'',cache.organization?.short_name||''],rows});
 }

 function renderParticipants(projectId){
  const title=[...document.querySelectorAll('#shell main .pg h2')].find(x=>x.textContent.trim()==='Договоры объекта');
  if(!title)return;
  const anchor=title.parentElement;
  let box=document.querySelector('[data-rel-participants]');
  const signature=participantSignature(projectId);
  if(box?.dataset.relSignature===signature)return;
  const org=cache.organization;
  const html=`<div class="section-title"><h2>Участники объекта</h2>${canEdit()?'<button data-rel-action="add-participant">Добавить участника</button>':''}</div>
   <div class="rel-org"><span class="pill g">Наша организация</span><b>${esc(org?.short_name||'Государственное предприятие "СУ № 22"')}</b><span class="muted">УНП ${esc(org?.unp||'191426884')}</span></div>
   <div class="table-wrap"><table class="rel-table"><thead><tr><th>Роль на объекте</th><th>Организация</th><th>УНП</th><th></th></tr></thead><tbody>${participantRows(projectId)}</tbody></table></div>`;
  if(!box){box=document.createElement('section');box.dataset.relParticipants='1';box.className='rel-participants';anchor.before(box);}
  box.dataset.relSignature=signature;
  box.innerHTML=html;
 }

 async function enhanceProject(){
  if(!document.querySelector('#shell main .pg .object-heading'))return;
  await Promise.all([load(),getUserRole()]);
  const projectId=resolveProject();if(!projectId)return;
  const contractTitle=[...document.querySelectorAll('#shell main .pg h2')].find(x=>x.textContent.trim()==='Договоры объекта');
  if(!contractTitle)return;
  renderParticipants(projectId);
  patchContractTable(projectId);
 }

 function participantDialog(){
  const projectId=resolveProject();if(!projectId)return;
  const roleOptions=participantRoles.map(r=>[r,counterpartyRoleNames[r]]);
  const role=makeSelect('Роль на объекте','role',roleOptions);
  const cp=makeSelect('Организация','counterparty_id',cache.counterparties.map(c=>[c.id,`${c.short_name} · УНП ${c.unp}`]));
  dialog.classList.remove('document-drawer');
  dialog.innerHTML=`<div class="row"><h2>Участник объекта</h2><button data-rel-action="close">Закрыть</button></div><form id="rel-participant-form"><div class="rel-grid"></div><p id="rel-error" class="error" role="alert"></p><div class="actions"><button class="primary" type="submit">Сохранить</button></div></form>`;
  const grid=dialog.querySelector('.rel-grid');grid.append(role.label,cp.label);
  if(!dialog.open)dialog.showModal();
  const form=dialog.querySelector('#rel-participant-form');
  form.onsubmit=async ev=>{
   ev.preventDefault();const button=ev.submitter;button.disabled=true;
   const x=Object.fromEntries(new FormData(form));
   try{
    await q(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload:{op:'add_project_participant',project_id:projectId,...x}}));
    cache=null;dialog.close();await load(true);renderParticipants(projectId);patchContractTable(projectId);
   }catch(err){dialog.querySelector('#rel-error').textContent=err.message||String(err);}
   finally{button.disabled=false;}
  };
 }

 document.addEventListener('click',async ev=>{
  const projectLink=ev.target.closest('[data-action="project"]');
  if(projectLink?.dataset.id)currentProjectId=projectLink.dataset.id;

  const b=ev.target.closest('[data-rel-action]');if(!b)return;
  ev.preventDefault();ev.stopPropagation();
  if(b.dataset.relAction==='close'){dialog.close();return;}
  await Promise.all([load(),getUserRole()]);
  if(b.dataset.relAction==='add-participant'){if(canEdit())participantDialog();return;}
  if(b.dataset.relAction==='remove-participant'){
   const projectId=resolveProject();if(!projectId||!canEdit())return;
   try{
    await q(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload:{op:'remove_project_participant',project_id:projectId,participant_id:b.dataset.id}}));
    cache=null;await load(true);renderParticipants(projectId);
   }catch(err){console.error(err);}
  }
 },true);

 function schedule(){
  if(scheduled)return;scheduled=true;
  queueMicrotask(async()=>{scheduled=false;try{await enhanceContractDialog();await enhanceProject();}catch(err){console.error(err);}});
 }
 const observer=new MutationObserver(schedule);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 schedule();
}
