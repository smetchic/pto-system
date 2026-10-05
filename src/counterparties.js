import {createClient} from '@supabase/supabase-js';
import {escapeHtml as e} from './domain.js';

const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const dialog=document.querySelector('#dialog');
const esc=v=>e(v??'');
const roleNames={
 customer:'Заказчик',
 general_contractor:'Генподрядчик / подрядчик',
 subcontractor:'Субподрядчик',
 supplier:'Поставщик',
 service_provider:'Исполнитель услуг'
};
const roleOrder=Object.keys(roleNames);

if(url&&key&&key.startsWith('sb_publishable_')){
 const client=createClient(url,key);
 let cache=null;
 let role=null;
 let scheduled=false;

 const css=document.createElement('style');
 css.textContent=`
  .cp-toolbar{display:flex;gap:10px;align-items:center;margin:16px 0}.cp-search{max-width:420px;width:100%}
  .cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.cp-grid .wide{grid-column:1/-1}
  .cp-card-meta{display:flex;gap:10px;flex-wrap:wrap;margin:-4px 0 16px}.cp-card-meta .pill{white-space:nowrap}
  .cp-empty{padding:30px 0}.cp-table button.link{text-align:left}.cp-table td{vertical-align:top}
  .cp-role-list{display:flex;gap:6px;flex-wrap:wrap}.cp-role-checks{display:flex;gap:8px 16px;flex-wrap:wrap;padding:10px 0 2px}
  .cp-role-checks label{display:flex;align-items:center;gap:7px;margin:0}.cp-role-checks input{width:auto;margin:0}
  #dialog.cp-drawer{margin:0 0 0 auto!important;inset:0 0 0 auto!important;width:640px;max-width:calc(100vw - 56px);height:100vh;max-height:100vh;border:0;border-left:1px solid var(--ln);border-radius:0;padding:0;background:var(--sf);color:var(--ink);box-shadow:-10px 0 28px rgba(0,0,0,.08);overflow:hidden}
  #dialog.cp-drawer::backdrop{background:rgba(15,17,21,.08)}
  .cp-drawer-shell{height:100%;overflow:auto;padding:0 26px 28px}
  .cp-drawer-head{position:sticky;top:0;z-index:3;background:var(--sf);border-bottom:1px solid var(--ln);padding:14px 0 14px;margin-bottom:16px}
  .cp-drawer-close{display:inline-flex;align-items:center;min-height:40px;border:0!important;background:transparent!important;padding:8px 10px 8px 0!important;color:var(--mu);font-size:13px;font-weight:500;margin:0 0 8px;cursor:pointer}.cp-drawer-close:hover{color:var(--ink);background:transparent!important}
  .cp-drawer-head h2{margin:0;color:var(--ink);font-size:18px;text-transform:none;letter-spacing:0}
  .cp-drawer .actions{padding-bottom:8px}
  @media(max-width:760px){.cp-grid{grid-template-columns:1fr}.cp-grid .wide{grid-column:auto}#dialog.cp-drawer{width:100%;max-width:100%}.cp-drawer-shell{padding:0 18px 24px}}
 `;
 document.head.appendChild(css);

 async function q(request){const {data,error}=await request;if(error)throw error;return data;}
 async function getRole(){
  if(role!==null)return role;
  const {data:{session}}=await client.auth.getSession();
  if(!session)return role='';
  const p=await q(client.from('pto_profiles').select('role,active').eq('id',session.user.id).maybeSingle());
  return role=p?.active?p.role:'';
 }
 async function load(force=false){
  if(cache&&!force)return cache;
  const [counterparties,contracts,roles]=await Promise.all([
   q(client.from('pto_counterparties').select('*').order('short_name')),
   q(client.from('pto_contracts').select('id,counterparty_id')),
   q(client.from('pto_counterparty_roles').select('counterparty_id,role'))
  ]);
  cache={counterparties,contracts,roles};
  return cache;
 }
 const canEdit=()=>['head','engineer','admin'].includes(role);
 const countContracts=id=>cache?.contracts?.filter(c=>c.counterparty_id===id).length||0;
 const rolesFor=id=>cache?.roles?.filter(r=>r.counterparty_id===id).map(r=>r.role).filter(r=>roleNames[r])||[];
 const rolePills=id=>{const roles=rolesFor(id);return roles.length?`<div class="cp-role-list">${roles.map(r=>`<span class="pill">${esc(roleNames[r])}</span>`).join('')}</div>`:'<span class="muted">Не назначены</span>';};

 function rowsHtml(rows){
  if(!rows.length)return `<tr><td colspan="6"><div class="empty cp-empty">Контрагенты не найдены.</div></td></tr>`;
  return rows.map(c=>`<tr>
   <td><button class="link" data-cp-action="open" data-id="${esc(c.id)}"><b>${esc(c.short_name)}</b></button><small>${esc(c.full_name)}</small></td>
   <td>${esc(c.unp)}</td>
   <td>${rolePills(c.id)}</td>
   <td>${c.status_name?`<span class="pill ${c.status_name==='Действующий'?'g':''}">${esc(c.status_name)}</span>`:'—'}</td>
   <td>${esc(c.address||'')}</td>
   <td class="num">${countContracts(c.id)||''}</td>
  </tr>`).join('');
 }

 async function renderPage(){
  const pg=document.querySelector('#shell main .pg');
  if(!pg)return;
  const title=pg.querySelector('h1')?.textContent?.trim();
  if(title!=='Контрагенты'||pg.querySelector('[data-cp-page]'))return;
  pg.innerHTML='<div class="muted">Загрузка контрагентов…</div>';
  try{
   await Promise.all([load(),getRole()]);
   pg.innerHTML=`<div data-cp-page>
    <div class="heading"><div><h1>Контрагенты</h1><div class="muted">Единый справочник организаций. Одна организация может иметь несколько ролей.</div></div><div class="actions">${canEdit()?'<button class="primary" data-cp-action="new">Добавить контрагента</button>':''}</div></div>
    <div class="cp-toolbar"><input id="cp-search" class="cp-search" type="search" autocomplete="off" placeholder="Поиск по названию, УНП или роли"></div>
    <section class="table-wrap"><table class="cp-table"><thead><tr><th>Контрагент</th><th>УНП</th><th>Роли</th><th>Статус</th><th>Адрес</th><th class="num">Договоров</th></tr></thead><tbody id="cp-body">${rowsHtml(cache.counterparties)}</tbody></table></section>
   </div>`;
  }catch(err){pg.innerHTML=`<div data-cp-page><div class="heading"><div><h1>Контрагенты</h1><div class="muted">Не удалось загрузить справочник.</div></div></div><p class="error">${esc(err.message||err)}</p></div>`;}
 }

 function field(name,label,value='',type='text',required=false){return `<label>${esc(label)}<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" autocomplete="off" ${required?'required':''}></label>`;}
 function area(name,label,value='',cls=''){return `<label class="${cls}">${esc(label)}<textarea name="${esc(name)}" autocomplete="off">${esc(value)}</textarea></label>`;}
 function roleChecks(c){const selected=new Set(c?rolesFor(c.id):[]);return `<div class="wide"><b>Роли контрагента</b><div class="cp-role-checks">${roleOrder.map(r=>`<label><input type="checkbox" data-cp-role value="${esc(r)}" ${selected.has(r)?'checked':''}>${esc(roleNames[r])}</label>`).join('')}</div></div>`;}
 function resetDrawerClass(){dialog.classList.remove('cp-drawer');}
 function openCard(c=null){
  const edit=!!c;
  dialog.classList.remove('document-drawer','proc-drawer');
  dialog.classList.add('cp-drawer');
  dialog.innerHTML=`<div class="cp-drawer-shell"><div class="cp-drawer-head"><button class="cp-drawer-close" data-cp-action="close">Закрыть ×</button><h2>${edit?'Контрагент':'Новый контрагент'}</h2></div>
   ${edit?`<div class="cp-card-meta"><span class="pill">УНП ${esc(c.unp)}</span>${c.status_name?`<span class="pill ${c.status_name==='Действующий'?'g':''}">${esc(c.status_name)}</span>`:''}<span class="muted">Источник: ${esc(c.source||'manual')}</span></div>`:''}
   <form id="cp-form" autocomplete="off">
    <div class="cp-grid">
     ${field('unp','УНП',c?.unp||'','text',true)}
     ${field('short_name','Краткое наименование',c?.short_name||'','text',true)}
     ${area('full_name','Полное наименование',c?.full_name||'','wide')}
     ${area('address','Адрес',c?.address||'','wide')}
     ${roleChecks(c)}
     ${field('registration_date','Дата регистрации',c?.registration_date||'','date')}
     ${field('tax_office_code','Код инспекции МНС',c?.tax_office_code||'')}
     ${field('tax_office_name','Инспекция МНС',c?.tax_office_name||'')}
     ${field('status_code','Код состояния',c?.status_code||'')}
     ${field('status_name','Статус',c?.status_name||'')}
     ${field('status_change_date','Дата изменения состояния',c?.status_change_date||'','date')}
     ${area('liquidation_info','Сведения МНС',c?.liquidation_info||'','wide')}
     ${field('phone','Телефон',c?.phone||'','tel')}
     ${field('email','Электронная почта',c?.email||'','email')}
     ${area('note','Примечание',c?.note||'','wide')}
    </div>
    <input type="hidden" name="source" value="${esc(c?.source||'manual')}">
    <p id="cp-error" class="error" role="alert"></p>
    <div class="actions"><button class="primary" type="submit">Сохранить</button></div>
   </form></div>`;
  if(!dialog.open)dialog.showModal();
  const form=dialog.querySelector('#cp-form');
  form.onsubmit=async ev=>{
   ev.preventDefault();const button=ev.submitter;button.disabled=true;
   const payload=Object.fromEntries(new FormData(form));
   payload.roles=[...form.querySelectorAll('[data-cp-role]:checked')].map(x=>x.value);
   payload.op=edit?'update_counterparty':'create_counterparty';
   if(edit)payload.counterparty_id=c.id;
   try{
    await q(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload}));
    cache=null;resetDrawerClass();dialog.close();
    const pg=document.querySelector('#shell main .pg');if(pg)pg.innerHTML='<h1>Контрагенты</h1>';
    await renderPage();
   }catch(err){dialog.querySelector('#cp-error').textContent=/duplicate key|pto_counterparties_unp_key/i.test(err.message||'')?'Контрагент с таким УНП уже существует.':(err.message||String(err));}
   finally{button.disabled=false;}
  };
 }

 document.addEventListener('click',async ev=>{
  const b=ev.target.closest('[data-cp-action]');if(!b)return;
  ev.preventDefault();ev.stopPropagation();
  if(b.dataset.cpAction==='close'){resetDrawerClass();dialog.close();return;}
  if(b.dataset.cpAction==='new'){await Promise.all([load(),getRole()]);if(canEdit())openCard();return;}
  if(b.dataset.cpAction==='open'){
   await Promise.all([load(),getRole()]);
   const c=cache.counterparties.find(x=>x.id===b.dataset.id);if(c)openCard(c);
  }
 },true);

 document.addEventListener('input',ev=>{
  if(ev.target.id!=='cp-search'||!cache)return;
  const s=ev.target.value.trim().toLowerCase();
  const rows=!s?cache.counterparties:cache.counterparties.filter(c=>{
   const roleText=rolesFor(c.id).map(r=>roleNames[r]).join(' ');
   return [c.short_name,c.full_name,c.unp,c.address,roleText].some(v=>(v||'').toLowerCase().includes(s));
  });
  const body=document.querySelector('#cp-body');if(body)body.innerHTML=rowsHtml(rows);
 });

 function schedule(){
  if(scheduled)return;scheduled=true;
  queueMicrotask(async()=>{scheduled=false;await renderPage();});
 }
 const observer=new MutationObserver(schedule);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 schedule();
}
