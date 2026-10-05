import {createClient} from '@supabase/supabase-js';
import {escapeHtml as e} from './domain.js';

const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const dialog=document.querySelector('#dialog');
const esc=v=>e(v??'');
const roleNames={customer:'Заказчик',general_contractor:'Генподрядчик / подрядчик',subcontractor:'Субподрядчик',supplier:'Поставщик',service_provider:'Исполнитель услуг'};
const roleOrder=Object.keys(roleNames);
const ourRoleNames={contractor:'Подрядчик',subcontractor:'Субподрядчик',customer:'Заказчик субподрядных работ',buyer:'Покупатель',service_customer:'Заказчик услуг'};

if(url&&key&&key.startsWith('sb_publishable_')){
 const client=createClient(url,key);
 let cache=null,role=null,scheduled=false;

 const css=document.createElement('style');
 css.textContent=`
  .cp-toolbar{display:flex;gap:10px;align-items:center;margin:16px 0}.cp-search{max-width:420px;width:100%}
  .cp-empty{padding:30px 0}.cp-table button.link{text-align:left}.cp-table td{vertical-align:top}
  .cp-role-list,.cp-card-meta{display:flex;gap:6px;flex-wrap:wrap}.cp-card-meta{margin:8px 0 0}.cp-card-meta .pill{white-space:nowrap}
  #dialog.cp-drawer{margin:0 0 0 auto!important;inset:0 0 0 auto!important;width:720px;max-width:calc(100vw - 56px);height:100vh;max-height:100vh;border:0;border-left:1px solid var(--ln);border-radius:0;padding:0;background:var(--sf);color:var(--ink);box-shadow:-10px 0 28px rgba(0,0,0,.08);overflow:hidden}
  #dialog.cp-drawer::backdrop{background:rgba(15,17,21,.08)}
  .cp-drawer-shell{height:100%;display:flex;flex-direction:column;overflow:hidden}
  .cp-drawer-head{flex:none;background:var(--sf);border-bottom:1px solid var(--ln);padding:14px 24px 16px}
  .cp-drawer-close{display:inline-flex;align-items:center;min-height:40px;border:0!important;background:transparent!important;padding:8px 10px 8px 0!important;color:var(--mu);font-size:13px;font-weight:500;margin:0 0 8px;cursor:pointer}.cp-drawer-close:hover{color:var(--ink);background:transparent!important}
  .cp-drawer-head h2{margin:0;color:var(--ink);font-size:20px;line-height:1.3;text-transform:none;letter-spacing:0}
  .cp-drawer-content{flex:1;overflow:auto;padding:20px 24px 28px;overscroll-behavior:contain}
  .cp-drawer-foot{flex:none;display:flex;justify-content:flex-end;gap:8px;background:var(--sf);border-top:1px solid var(--ln);padding:12px 24px}
  .cp-section{padding:0 0 20px;margin:0 0 20px;border-bottom:1px solid var(--ln)}.cp-section:last-of-type{border-bottom:0;margin-bottom:0}
  .cp-section-title{font-size:11px;line-height:1.3;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);font-weight:600;margin:0 0 10px}
  .cp-full-name{font-size:14px;line-height:1.5;font-weight:500;margin:0 0 8px}.cp-address{color:var(--mu);line-height:1.5;margin:0}
  .cp-role-checks{display:flex;gap:9px 18px;flex-wrap:wrap}.cp-role-checks label{display:flex;align-items:center;gap:7px;margin:0}.cp-role-checks input{width:auto;margin:0}
  .cp-system-list{display:grid;gap:8px}.cp-system-row{display:grid;grid-template-columns:128px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid color-mix(in srgb,var(--ln) 70%,transparent)}.cp-system-row:last-child{border-bottom:0}.cp-system-row small{display:block;margin-top:2px}.cp-contract-money{margin-top:4px;font-variant-numeric:tabular-nums}
  .cp-facts{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}.cp-fact{min-width:0}.cp-fact.wide{grid-column:1/-1}.cp-fact span{display:block;color:var(--mu);font-size:11px;margin-bottom:3px}.cp-fact b,.cp-fact div{font-weight:400;overflow-wrap:anywhere}
  .cp-work-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}.cp-work-grid .wide{grid-column:1/-1}.cp-work-grid label{display:grid;gap:4px}.cp-work-grid input,.cp-work-grid textarea{width:100%}.cp-work-grid textarea{min-height:72px;resize:vertical}
  .cp-hidden{display:none!important}.cp-no-data{color:var(--mu);font-size:12px;padding:3px 0}
  @media(max-width:820px){#dialog.cp-drawer{width:100%;max-width:100%}.cp-drawer-head,.cp-drawer-content,.cp-drawer-foot{padding-left:18px;padding-right:18px}.cp-facts,.cp-work-grid{grid-template-columns:1fr}.cp-fact.wide,.cp-work-grid .wide{grid-column:auto}.cp-system-row{grid-template-columns:1fr}}
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
  const [counterparties,contracts,roles,participants,projects]=await Promise.all([
   q(client.from('pto_counterparties').select('*').order('short_name')),
   q(client.from('pto_contract_list').select('*')),
   q(client.from('pto_counterparty_roles').select('counterparty_id,role')),
   q(client.from('pto_project_participants').select('*')),
   q(client.from('pto_projects').select('id,name,full_name'))
  ]);
  cache={counterparties,contracts,roles,participants,projects};
  return cache;
 }
 const canEdit=()=>['head','engineer','admin'].includes(role);
 const countContracts=id=>cache?.contracts?.filter(c=>c.counterparty_id===id).length||0;
 const rolesFor=id=>cache?.roles?.filter(r=>r.counterparty_id===id).map(r=>r.role).filter(r=>roleNames[r])||[];
 const projectById=id=>cache?.projects?.find(p=>p.id===id);
 const rolePills=id=>{const roles=rolesFor(id);return roles.length?`<div class="cp-role-list">${roles.map(r=>`<span class="pill">${esc(roleNames[r])}</span>`).join('')}</div>`:'<span class="muted">Не назначены</span>';};
 const fmtDate=v=>v?new Date(v+'T12:00:00').toLocaleDateString('ru-RU'):'';
 const fmtMoney=v=>v===null||v===undefined||v===''?'':Number(v).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});

 function rowsHtml(rows){
  if(!rows.length)return `<tr><td colspan="6"><div class="empty cp-empty">Контрагенты не найдены.</div></td></tr>`;
  return rows.map(c=>`<tr><td><button class="link" data-cp-action="open" data-id="${esc(c.id)}"><b>${esc(c.short_name)}</b></button><small>${esc(c.full_name)}</small></td><td>${esc(c.unp)}</td><td>${rolePills(c.id)}</td><td>${c.status_name?`<span class="pill ${c.status_name==='Действующий'?'g':''}">${esc(c.status_name)}</span>`:'—'}</td><td>${esc(c.address||'')}</td><td class="num">${countContracts(c.id)||''}</td></tr>`).join('');
 }

 async function renderPage(){
  const pg=document.querySelector('#shell main .pg');if(!pg)return;
  const title=pg.querySelector('h1')?.textContent?.trim();
  if(title!=='Контрагенты'||pg.querySelector('[data-cp-page]'))return;
  pg.innerHTML='<div class="muted">Загрузка контрагентов…</div>';
  try{
   await Promise.all([load(),getRole()]);
   pg.innerHTML=`<div data-cp-page><div class="heading"><div><h1>Контрагенты</h1><div class="muted">Единый справочник организаций. Одна организация может иметь несколько ролей.</div></div><div class="actions">${canEdit()?'<button class="primary" data-cp-action="new">Добавить контрагента</button>':''}</div></div><div class="cp-toolbar"><input id="cp-search" class="cp-search" type="search" autocomplete="off" placeholder="Поиск по названию, УНП или роли"></div><section class="table-wrap"><table class="cp-table"><thead><tr><th>Контрагент</th><th>УНП</th><th>Роли</th><th>Статус</th><th>Адрес</th><th class="num">Договоров</th></tr></thead><tbody id="cp-body">${rowsHtml(cache.counterparties)}</tbody></table></section></div>`;
  }catch(err){pg.innerHTML=`<div data-cp-page><div class="heading"><div><h1>Контрагенты</h1><div class="muted">Не удалось загрузить справочник.</div></div></div><p class="error">${esc(err.message||err)}</p></div>`;}
 }

 function roleChecks(c){const selected=new Set(c?rolesFor(c.id):[]);return `<div class="cp-role-checks">${roleOrder.map(r=>`<label><input type="checkbox" data-cp-role value="${esc(r)}" ${selected.has(r)?'checked':''} ${canEdit()?'':'disabled'}>${esc(roleNames[r])}</label>`).join('')}</div>`;}
 function systemUsage(c){
  if(!c)return '';
  const participants=cache.participants.filter(x=>x.counterparty_id===c.id);
  const contracts=cache.contracts.filter(x=>x.counterparty_id===c.id);
  const rows=[];
  participants.forEach(x=>{const p=projectById(x.project_id);rows.push(`<div class="cp-system-row"><div><span class="pill">${esc(roleNames[x.role]||x.role)}</span></div><div><b>${esc(p?.name||'Объект')}</b>${p?.full_name&&p.full_name!==p.name?`<small>${esc(p.full_name)}</small>`:''}</div></div>`);});
  contracts.forEach(x=>{
   // Текущая стоимость вычисляется в базе (pto_contract_list) по последнему подписанному допсоглашению.
   const p=projectById(x.project_id),amount=x.current_amount;
   const money=amount!==null&&amount!==undefined&&amount!==''?`<small class="cp-contract-money"><b>${esc(fmtMoney(amount))} руб.</b>${x.amount_addendum_number?` · ДС №${esc(x.amount_addendum_number)} от ${esc(fmtDate(x.amount_addendum_date))}`:''}</small>`:'';
   rows.push(`<div class="cp-system-row"><div><span class="pill g">Договор</span></div><div><b>№${esc(x.number||'—')}${x.contract_date?` от ${esc(fmtDate(x.contract_date))}`:''}</b><small>${esc(p?.name||'')} · наша роль: ${esc(ourRoleNames[x.our_role]||x.our_role||'')}</small>${money}${x.subject?`<small>${esc(x.subject)}</small>`:''}</div></div>`);
  });
  return rows.length?`<div class="cp-system-list">${rows.join('')}</div>`:'<div class="cp-no-data">Пока не используется в объектах и договорах.</div>';
 }
 function hidden(name,value=''){return `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;}
 function workField(name,label,value='',type='text'){return `<label>${esc(label)}<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" autocomplete="off"></label>`;}
 function workArea(name,label,value=''){return `<label class="wide">${esc(label)}<textarea name="${esc(name)}" autocomplete="off">${esc(value)}</textarea></label>`;}
 function officialFields(c){
  return `<div class="cp-facts">
   <div class="cp-fact wide"><span>Полное наименование</span><div class="cp-full-name">${esc(c.full_name||'—')}</div></div>
   <div class="cp-fact wide"><span>Юридический адрес</span><div>${esc(c.address||'—')}</div></div>
   <div class="cp-fact"><span>Дата регистрации</span><div>${esc(fmtDate(c.registration_date)||'—')}</div></div>
   <div class="cp-fact"><span>Инспекция МНС</span><div>${esc(c.tax_office_name||'—')}${c.tax_office_code?` <span class="muted">(${esc(c.tax_office_code)})</span>`:''}</div></div>
   <div class="cp-fact"><span>Состояние</span><div>${esc(c.status_name||'—')}</div></div>
   ${c.status_change_date?`<div class="cp-fact"><span>Дата изменения состояния</span><div>${esc(fmtDate(c.status_change_date))}</div></div>`:''}
   ${c.liquidation_info?`<div class="cp-fact wide"><span>Сведения МНС</span><div>${esc(c.liquidation_info)}</div></div>`:''}
  </div>`;
 }
 function newFormFields(){
  return `<div class="cp-work-grid">${workField('unp','УНП','')} ${workField('short_name','Краткое наименование','')} ${workArea('full_name','Полное наименование','')} ${workArea('address','Адрес','')} ${workField('registration_date','Дата регистрации','','date')} ${workField('tax_office_code','Код инспекции МНС','')} ${workField('tax_office_name','Инспекция МНС','')} ${workField('status_code','Код состояния','')} ${workField('status_name','Статус','')} ${workField('status_change_date','Дата изменения состояния','','date')} ${workArea('liquidation_info','Сведения МНС','')}</div>`;
 }
 function resetDrawer(){dialog.classList.remove('cp-drawer');document.documentElement.style.overflow='';}
 function openCard(c=null){
  const edit=!!c;
  dialog.classList.remove('document-drawer','proc-drawer');dialog.classList.add('cp-drawer');document.documentElement.style.overflow='hidden';
  const title=edit?(c.short_name||'Контрагент'):'Новый контрагент';
  const officialHidden=edit?[hidden('unp',c.unp),hidden('short_name',c.short_name),hidden('full_name',c.full_name),hidden('address',c.address),hidden('registration_date',c.registration_date),hidden('tax_office_code',c.tax_office_code),hidden('tax_office_name',c.tax_office_name),hidden('status_code',c.status_code),hidden('status_name',c.status_name),hidden('status_change_date',c.status_change_date),hidden('liquidation_info',c.liquidation_info)].join(''):'';
  dialog.innerHTML=`<form id="cp-form" class="cp-drawer-shell" autocomplete="off">
   <div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-cp-action="close">Закрыть ×</button><h2>${esc(title)}</h2>${edit?`<div class="cp-card-meta"><span class="pill">УНП ${esc(c.unp)}</span>${c.status_name?`<span class="pill ${c.status_name==='Действующий'?'g':''}">${esc(c.status_name)}</span>`:''}<span class="muted">Источник: ${esc(c.source||'manual')}</span></div>`:''}</div>
   <div class="cp-drawer-content">
    ${edit?`<section class="cp-section"><div class="cp-section-title">В нашей системе</div>${systemUsage(c)}</section>`:''}
    <section class="cp-section"><div class="cp-section-title">Роли контрагента</div>${roleChecks(c)}</section>
    <section class="cp-section"><div class="cp-section-title">${edit?'Официальные данные МНС':'Основные реквизиты'}</div>${edit?officialFields(c):newFormFields()}</section>
    <section class="cp-section"><div class="cp-section-title">Руководитель и право подписи</div><div class="cp-work-grid">${workField('director_title','Должность',c?.director_title||'')}${workField('director_name','ФИО руководителя',c?.director_name||'')}${workField('authority_basis','Действует на основании',c?.authority_basis||'')}</div></section>
    <section class="cp-section"><div class="cp-section-title">Контакты</div><div class="cp-work-grid">${workArea('phone','Телефоны',c?.phone||'')}${workField('email','Электронная почта',c?.email||'','email')}</div></section>
    <section class="cp-section"><div class="cp-section-title">Банковские реквизиты</div><div class="cp-work-grid">${workField('okpo','ОКПО',c?.okpo||'')}${workField('bank_bic','БИК',c?.bank_bic||'')}${workArea('bank_account','Расчётный счёт / IBAN',c?.bank_account||'')}${workArea('bank_name','Банк',c?.bank_name||'')}</div></section>
    <section class="cp-section"><div class="cp-section-title">Примечание</div><div class="cp-work-grid">${workArea('note','Внутреннее примечание',c?.note||'')}</div></section>
    ${officialHidden}${hidden('source',c?.source||'manual')}<p id="cp-error" class="error" role="alert"></p>
   </div>
   <div class="cp-drawer-foot"><button type="button" data-cp-action="close">Отмена</button>${canEdit()?'<button class="primary" type="submit">Сохранить</button>':''}</div>
  </form>`;
  if(!dialog.open)dialog.showModal();
  const form=dialog.querySelector('#cp-form');
  if(!canEdit())return;
  form.onsubmit=async ev=>{
   ev.preventDefault();const button=ev.submitter;button.disabled=true;
   const payload=Object.fromEntries(new FormData(form));
   payload.roles=[...form.querySelectorAll('[data-cp-role]:checked')].map(x=>x.value);payload.op=edit?'update_counterparty':'create_counterparty';if(edit)payload.counterparty_id=c.id;
   try{await q(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload}));cache=null;resetDrawer();dialog.close();const pg=document.querySelector('#shell main .pg');if(pg)pg.innerHTML='<h1>Контрагенты</h1>';await renderPage();}
   catch(err){dialog.querySelector('#cp-error').textContent=/duplicate key|pto_counterparties_unp_key/i.test(err.message||'')?'Контрагент с таким УНП уже существует.':(err.message||String(err));}
   finally{button.disabled=false;}
  };
 }

 document.addEventListener('click',async ev=>{
  const b=ev.target.closest('[data-cp-action]');if(!b)return;ev.preventDefault();ev.stopPropagation();
  if(b.dataset.cpAction==='close'){resetDrawer();dialog.close();return;}
  if(b.dataset.cpAction==='new'){await Promise.all([load(),getRole()]);if(canEdit())openCard();return;}
  if(b.dataset.cpAction==='open'){await Promise.all([load(),getRole()]);const c=cache.counterparties.find(x=>x.id===b.dataset.id);if(c)openCard(c);}
 },true);
 document.addEventListener('input',ev=>{
  if(ev.target.id!=='cp-search'||!cache)return;const s=ev.target.value.trim().toLowerCase();
  const rows=!s?cache.counterparties:cache.counterparties.filter(c=>{const rt=rolesFor(c.id).map(r=>roleNames[r]).join(' ');return[c.short_name,c.full_name,c.unp,c.address,c.director_name,c.okpo,rt].some(v=>(v||'').toLowerCase().includes(s));});const body=document.querySelector('#cp-body');if(body)body.innerHTML=rowsHtml(rows);
 });
 dialog?.addEventListener('close',()=>{if(dialog.classList.contains('cp-drawer'))resetDrawer();});
 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(async()=>{scheduled=false;await renderPage();});}
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});schedule();
}
