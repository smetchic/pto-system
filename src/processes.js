import {createClient} from '@supabase/supabase-js';
import {escapeHtml as e,money,kindNames,stateNames} from './domain.js';

const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const dialog=document.querySelector('#dialog');
const esc=v=>e(v??'');

const buckets=[
 ['pto','В ПТО'],
 ['site','На объекте'],
 ['review','На проверке'],
 ['external','Внешняя сторона'],
 ['accounting','Бухгалтерия'],
 ['closed','Закрыто']
];
const bucketNames=Object.fromEntries(buckets);
const transitions={
 pto:[['site','Передать на объект'],['review','Передать на проверку'],['external','Передать внешней стороне']],
 site:[['pto','Вернуть в ПТО'],['review','Передать на проверку'],['external','Передать внешней стороне']],
 review:[['pto','Вернуть в ПТО'],['external','Передать внешней стороне']],
 external:[['pto','Вернуть в ПТО'],['accounting','Передать в бухгалтерию']],
 accounting:[['pto','Вернуть в ПТО'],['closed','Закрыть комплект']],
 closed:[]
};

if(url&&key&&key.startsWith('sb_publishable_')){
 const client=createClient(url,key);
 let cache=null;
 let monthOverride='';
 let scheduled=false;

 const css=document.createElement('style');
 css.textContent=`
  .proc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:18px}.proc-head input{width:auto;min-width:160px}
  .proc-board{display:grid;grid-template-columns:repeat(6,minmax(230px,1fr));gap:12px;overflow-x:auto;padding-bottom:10px}.proc-lane{min-width:230px;background:var(--soft);border:1px solid var(--ln);border-radius:12px;padding:10px}.proc-lane-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px}.proc-lane-head span{font-variant-numeric:tabular-nums}
  .proc-card{display:block;width:100%;text-align:left;background:var(--bg);border:1px solid var(--ln);border-radius:10px;padding:12px;margin:0 0 9px;color:var(--ink)}.proc-card:hover{border-color:var(--ac)}.proc-card b{display:block}.proc-card small{display:block;margin-top:4px}.proc-card .proc-total{font-size:16px;margin-top:9px}.proc-card .proc-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.proc-card.attn{border-color:var(--err,#b42318)}
  .proc-check{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.proc-docs td{vertical-align:top}.proc-history{display:grid;gap:8px}.proc-event{border-left:2px solid var(--ln);padding-left:10px}.proc-event small{display:block}.proc-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.proc-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.proc-grid .wide{grid-column:1/-1}
  @media(max-width:900px){.proc-board{grid-template-columns:repeat(6,250px)}.proc-grid{grid-template-columns:1fr}.proc-grid .wide{grid-column:auto}}
 `;
 document.head.appendChild(css);

 async function q(request){const {data,error}=await request;if(error)throw error;return data;}
 const minskMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit'}).format(new Date());
 function selectedMonth(){
  if(monthOverride)return monthOverride;
  const global=document.querySelector('input[type="month"]:not([data-proc-month])');
  return global?.value||minskMonth();
 }
 async function load(force=false){
  const month=selectedMonth();
  if(cache&&!force&&cache.month===month)return cache;
  const periodRows=await q(client.from('pto_periods').select('*').eq('month',month+'-01'));
  const periodIds=periodRows.map(x=>x.id);
  const [projects,contracts,profiles,processes]=await Promise.all([
   q(client.from('pto_projects').select('id,name,full_name')),
   q(client.from('pto_contracts').select('*')),
   q(client.from('pto_profiles').select('id,display_name,role,active')),
   periodIds.length?q(client.from('pto_processes').select('*').in('period_id',periodIds).order('updated_at',{ascending:false})):Promise.resolve([])
  ]);
  const processIds=processes.map(x=>x.id);
  const [links,events]=processIds.length?await Promise.all([
   q(client.from('pto_process_documents').select('*').in('process_id',processIds)),
   q(client.from('pto_process_events').select('*').in('process_id',processIds).order('created_at',{ascending:false}))
  ]):[[],[]];
  const documentIds=links.map(x=>x.document_id);
  const documents=documentIds.length?await q(client.from('pto_documents').select('*').in('id',documentIds)):[];
  const versions=documentIds.length?await q(client.from('pto_versions').select('*').in('document_id',documentIds)):[];
  const {data:{session}}=await client.auth.getSession();
  const profile=session?profiles.find(x=>x.id===session.user.id):null;
  cache={month,periods:periodRows,projects,contracts,profiles,processes,links,events,documents,versions,profile};
  return cache;
 }
 const project=id=>cache?.projects.find(x=>x.id===id);
 const contract=id=>cache?.contracts.find(x=>x.id===id);
 const period=id=>cache?.periods.find(x=>x.id===id);
 const version=id=>cache?.versions.find(x=>x.id===id);
 const docsFor=p=>cache?.links.filter(x=>x.process_id===p.id).map(x=>cache.documents.find(d=>d.id===x.document_id)).filter(Boolean)||[];
 const eventsFor=p=>cache?.events.filter(x=>x.process_id===p.id)||[];
 const fmtDate=x=>x?new Date(x).toLocaleString('ru-RU',{timeZone:'Europe/Minsk'}):'';
 const canEdit=()=>['head','engineer'].includes(cache?.profile?.role);
 const canClose=()=>['head','accountant'].includes(cache?.profile?.role);

 function stats(p){
  const docs=docsFor(p),acts=docs.filter(d=>['c2a','c2b'].includes(d.kind)),c3=docs.filter(d=>d.kind==='c3a');
  const actTotal=acts.reduce((s,d)=>s+Number(version(d.current_version)?.amount||0),0);
  const c3Total=c3.reduce((s,d)=>s+Number(version(d.current_version)?.amount||0),0);
  return {docs,acts,c3,actTotal,c3Total,match:c3.length===1&&Math.abs(actTotal-c3Total)<0.005};
 }
 function processCard(p){
  const s=stats(p),pr=project(p.project_id),c=contract(p.contract_id),attention=p.attention_document_id?cache.documents.find(d=>d.id===p.attention_document_id):null;
  return `<button class="proc-card ${attention?'attn':''}" data-proc-action="open" data-id="${esc(p.id)}">
   <b>${esc(pr?.name||'Объект')}</b><small>Договор №${esc(c?.number||'')} · Процентовка</small>
   <div class="proc-total"><b>${money(s.actTotal)} руб.</b></div>
   <div class="proc-meta"><span class="pill">С-2: ${s.acts.length}</span><span class="pill">С-3а: ${s.c3.length}</span><span class="pill ${s.match?'g':'e'}">${s.match?'Сверка ✓':'Есть расхождение'}</span></div>
   <small>${esc(p.step_label||bucketNames[p.bucket]||p.bucket)}</small>
   ${attention?`<small><b>На исправлении:</b> ${esc(kindNames[attention.kind])} №${esc(attention.number)}</small>`:''}
  </button>`;
 }

 async function renderFlow(force=false){
  const pg=document.querySelector('#shell main .pg');if(!pg)return;
  const title=pg.querySelector('h1')?.textContent?.trim();
  if(title!=='Конвейер месяца'&&!pg.dataset.procBoard)return;
  if(pg.dataset.procBoard==='1'&&!force)return;
  try{
   await load(true);
   const activeProjects=[...new Set(cache.processes.map(p=>p.project_id))];
   pg.dataset.procBoard='1';
   pg.innerHTML=`<div class="proc-head"><div><h1>Конвейер месяца</h1><div class="muted">Одна карточка = комплект процентовки по объекту, договору и месяцу.</div></div><label>Отчётный месяц<input data-proc-month type="month" value="${esc(cache.month)}"></label></div>
    ${activeProjects.length?`<div class="filter-pills"><button class="on" data-proc-filter="">Все объекты</button>${activeProjects.map(id=>`<button data-proc-filter="${esc(id)}">${esc(project(id)?.name||'')}</button>`).join('')}</div>`:''}
    <div class="proc-board">${buckets.map(([id,label])=>{const rows=cache.processes.filter(p=>p.bucket===id);return `<section class="proc-lane" data-proc-lane="${id}"><div class="proc-lane-head"><b>${esc(label)}</b><span>${rows.length}</span></div><div data-proc-cards>${rows.map(processCard).join('')||'<div class="muted">Нет комплектов</div>'}</div></section>`;}).join('')}</div>`;
  }catch(err){pg.innerHTML=`<h1>Конвейер месяца</h1><p class="error">${esc(err.message||err)}</p>`;}
 }

 function processModal(p){
  const s=stats(p),pr=project(p.project_id),c=contract(p.contract_id),hist=eventsFor(p);
  const buttons=(transitions[p.bucket]||[]).filter(([target])=>target!=='closed'||canClose()).map(([target,label])=>`<button ${target==='closed'?'class="primary"':''} data-proc-action="transition" data-id="${esc(p.id)}" data-target="${target}">${esc(label)}</button>`).join('');
  dialog.classList.add('document-drawer');
  dialog.innerHTML=`<div class="row"><h2>Процентовка · ${esc(pr?.name||'')}</h2><button data-proc-action="close">Закрыть</button></div>
   <p><span class="pill">${esc(bucketNames[p.bucket]||p.bucket)}</span> · договор №${esc(c?.number||'')} · ${esc(c?.party||'')}</p>
   <div class="stats"><article><small>Сумма актов</small><strong>${money(s.actTotal)} <small>руб.</small></strong></article><article><small>С-3а</small><strong>${money(s.c3Total)} <small>руб.</small></strong></article></div>
   <div class="proc-check"><span class="pill">С-2: ${s.acts.length}</span><span class="pill">С-3а: ${s.c3.length}</span><span class="pill ${s.match?'g':'e'}">${s.match?'Суммы совпадают':'Суммы не совпадают'}</span></div>
   ${p.attention_document_id?`<p class="error">На исправлении: ${(()=>{const d=cache.documents.find(x=>x.id===p.attention_document_id);return d?`${esc(kindNames[d.kind])} №${esc(d.number)}`:'документ';})()}</p>`:''}
   <h3>Комплект документов</h3><div class="table-wrap"><table class="proc-docs"><thead><tr><th>Документ</th><th>Состояние</th><th class="num">Сумма, руб.</th></tr></thead><tbody>${s.docs.sort((a,b)=>(a.kind==='c3a'?1:0)-(b.kind==='c3a'?1:0)||String(a.number).localeCompare(String(b.number))).map(d=>`<tr><td><button class="link" data-action="doc" data-id="${esc(d.id)}">${esc(kindNames[d.kind])} №${esc(d.number)}</button><small>${esc(version(d.current_version)?.note||'')}</small></td><td>${esc(stateNames[d.status]||d.status)}</td><td class="num">${money(version(d.current_version)?.amount)}</td></tr>`).join('')}</tbody></table></div>
   ${buttons&&canEdit()||p.bucket==='accounting'&&canClose()?`<div class="proc-actions">${buttons}</div>`:''}
   <h3>История движения</h3><div class="proc-history">${hist.length?hist.map(x=>`<div class="proc-event"><b>${esc(bucketNames[x.from_bucket]||'Создан')} → ${esc(bucketNames[x.to_bucket]||x.to_bucket)}</b><small>${esc(fmtDate(x.created_at))} · ${esc(cache.profiles.find(u=>u.id===x.actor)?.display_name||'')}</small>${x.person?`<small>${esc(x.person)}${x.method?` · ${esc(x.method)}`:''}</small>`:''}${x.proof?`<small>${esc(x.proof)}</small>`:''}${x.note?`<small>${esc(x.note)}</small>`:''}</div>`).join(''):'<div class="muted">Движение ещё не зафиксировано.</div>'}</div>`;
  if(!dialog.open)dialog.showModal();
 }

 function transitionDialog(p,target){
  const docs=docsFor(p),c=contract(p.contract_id),isReturn=target==='pto';
  const label=transitions[p.bucket]?.find(x=>x[0]===target)?.[1]||'Переместить';
  const step=target==='external'?`У ${c?.party||'внешней стороны'}`:bucketNames[target];
  dialog.classList.remove('document-drawer');
  dialog.innerHTML=`<div class="row"><h2>${esc(label)}</h2><button data-proc-action="back" data-id="${esc(p.id)}">Назад</button></div>
   <form id="proc-transition-form"><div class="proc-grid">
    ${isReturn?`<label class="wide">Документ с замечанием<select name="document_id"><option value="">Весь комплект / без привязки</option>${docs.map(d=>`<option value="${esc(d.id)}">${esc(kindNames[d.kind])} №${esc(d.number)}</option>`).join('')}</select></label>`:`<label>Кому передано / кем подтверждено<input name="person" autocomplete="off" required></label><label>Способ передачи<input name="method" autocomplete="off" placeholder="Лично, электронно, письмо..."></label>`}
    ${!isReturn?`<label class="wide">Подтверждение / основание<textarea name="proof" ${['external','accounting','closed'].includes(target)?'required':''}></textarea></label>`:''}
    <label class="wide">${isReturn?'Причина возврата':'Комментарий'}<textarea name="note" ${isReturn?'required':''}></textarea></label>
   </div><input type="hidden" name="step_label" value="${esc(step||'')}"><p id="proc-error" class="error"></p><div class="actions"><button class="primary" type="submit">Сохранить переход</button></div></form>`;
  const form=dialog.querySelector('#proc-transition-form');
  form.onsubmit=async ev=>{
   ev.preventDefault();const button=ev.submitter;button.disabled=true;
   const x=Object.fromEntries(new FormData(form));const per=period(p.period_id);
   try{
    await q(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload:{op:'transition_process',process_id:p.id,bucket:target,expected_revision:String(per?.revision??0),...x}}));
    cache=null;dialog.close();await renderFlow(true);showToast(target==='closed'?'Комплект закрыт. Принятые акты попали в реестр.':'Переход сохранён.');
   }catch(err){dialog.querySelector('#proc-error').textContent=err.message||String(err);}
   finally{button.disabled=false;}
  };
 }
 function showToast(text){const t=document.querySelector('#toast');if(!t)return;t.textContent=text;t.hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.hidden=true,7000);}

 document.addEventListener('click',async ev=>{
  const filter=ev.target.closest('[data-proc-filter]');
  if(filter){ev.preventDefault();const id=filter.dataset.procFilter;document.querySelectorAll('[data-proc-filter]').forEach(x=>x.classList.toggle('on',x===filter));for(const lane of document.querySelectorAll('[data-proc-lane]')){const box=lane.querySelector('[data-proc-cards]');const rows=cache.processes.filter(p=>p.bucket===lane.dataset.procLane&&(!id||p.project_id===id));box.innerHTML=rows.map(processCard).join('')||'<div class="muted">Нет комплектов</div>'; }return;}
  const b=ev.target.closest('[data-proc-action]');if(!b)return;
  ev.preventDefault();ev.stopPropagation();
  if(b.dataset.procAction==='close'){dialog.close();return;}
  await load();const p=cache.processes.find(x=>x.id===b.dataset.id);if(!p)return;
  if(b.dataset.procAction==='open'){processModal(p);return;}
  if(b.dataset.procAction==='back'){processModal(p);return;}
  if(b.dataset.procAction==='transition'){transitionDialog(p,b.dataset.target);return;}
 },true);

 document.addEventListener('change',async ev=>{
  if(ev.target.matches('[data-proc-month]')){monthOverride=ev.target.value;cache=null;const pg=document.querySelector('#shell main .pg');if(pg)delete pg.dataset.procBoard;await renderFlow(true);return;}
  if(ev.target.matches('input[type="month"]')){monthOverride='';cache=null;}
 });
 document.addEventListener('click',ev=>{const nav=ev.target.closest('[data-action="nav"][data-id="flow"]');if(nav)cache=null;},true);

 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(async()=>{scheduled=false;try{await renderFlow();}catch(err){console.error(err);}});}
 const observer=new MutationObserver(schedule);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 schedule();
}
