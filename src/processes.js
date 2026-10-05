import {createClient} from '@supabase/supabase-js';
import {escapeHtml as e,money,kindNames,stateNames} from './domain.js';

const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const dialog=document.querySelector('#dialog');
const esc=v=>e(v??'');

const rawBuckets=[
 ['pto','В ПТО'],
 ['site','На объекте'],
 ['review','На проверке'],
 ['external','У заказчика'],
 ['accounting','Бухгалтерия'],
 ['closed','Закрыто']
];
const bucketNames=Object.fromEntries(rawBuckets);
const displayStages=[
 ['pto','В ПТО'],
 ['site','На объекте'],
 ['external','У заказчика'],
 ['accounting','Бухгалтерия'],
 ['closed','Закрыто']
];
const transitions={
 pto:[['site','Передать на объект']],
 site:[['review','Передать технадзору'],['pto','Вернуть в ПТО']],
 review:[['external','Направить заказчику'],['pto','Вернуть в ПТО']],
 external:[['accounting','Передать в бухгалтерию'],['pto','Вернуть в ПТО']],
 accounting:[['closed','Закрыть комплект'],['pto','Вернуть в ПТО']],
 closed:[]
};

if(url&&key&&key.startsWith('sb_publishable_')){
 const client=createClient(url,key);
 let cache=null;
 let scheduled=false;
 let activeFilter='';

 async function q(request){const {data,error}=await request;if(error)throw error;return data;}
 const minskMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit'}).format(new Date());
 function selectedMonth(){
  const global=document.querySelector('.top input[type="month"]')||document.querySelector('input[type="month"]');
  return global?.value||minskMonth();
 }
 async function load(force=false){
  const month=selectedMonth();
  if(cache&&!force&&cache.month===month)return cache;
  const periodRows=await q(client.from('pto_periods').select('*').eq('month',month+'-01'));
  const periodIds=periodRows.map(x=>x.id);
  const [projects,contracts,profiles,processes]=await Promise.all([
   q(client.from('pto_projects').select('id,name,full_name')),
   q(client.from('pto_contract_list').select('*')),
   q(client.from('pto_profiles').select('id,display_name,role,active')),
   periodIds.length?q(client.from('pto_processes').select('*').in('period_id',periodIds).order('updated_at',{ascending:false})):Promise.resolve([])
  ]);
  const processIds=processes.map(x=>x.id);
  const [links,events]=processIds.length?await Promise.all([
   q(client.from('pto_process_documents').select('*').in('process_id',processIds)),
   q(client.from('pto_process_events').select('*').in('process_id',processIds).order('created_at',{ascending:false}))
  ]):[[],[]];
  const documentIds=[...new Set(links.map(x=>x.document_id))];
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
 const canMove=()=>canEdit()||canClose();
 const displayStage=b=>b==='review'?'site':b;
 const monthName=()=>new Date(`${cache.month}-01T12:00:00Z`).toLocaleDateString('ru-RU',{month:'long',timeZone:'UTC'});
 const fmtMillion=v=>(Number(v||0)/1e6).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});

 function stats(p){
  const docs=docsFor(p),acts=docs.filter(d=>['c2a','c2b'].includes(d.kind)),c3=docs.filter(d=>d.kind==='c3a');
  const actTotal=acts.reduce((s,d)=>s+Number(version(d.current_version)?.amount||0),0);
  const c3Total=c3.reduce((s,d)=>s+Number(version(d.current_version)?.amount||0),0);
  return {docs,acts,c3,actTotal,c3Total,match:c3.length===1&&Math.abs(actTotal-c3Total)<0.005};
 }
 function stageAgeDays(p){
  const ev=eventsFor(p).find(x=>x.to_bucket===p.bucket);
  const stamp=ev?.created_at||p.updated_at||p.created_at;
  if(!stamp)return 0;
  return Math.max(0,Math.floor((Date.now()-new Date(stamp).getTime())/86400000));
 }
 function stageRows(id){
  return cache.processes.filter(p=>displayStage(p.bucket)===id&&(!activeFilter||p.project_id===activeFilter));
 }
 function nextForward(p){
  const options=transitions[p.bucket]||[];
  return options.find(([target])=>target!=='pto')||null;
 }
 function cardCorner(p,s){
  if(p.attention_document_id)return '<span class="proc-corner red" aria-hidden="true"></span>';
  if(!s.match)return '<span class="proc-corner" aria-hidden="true"></span>';
  return '';
 }
 function processCard(p){
  const s=stats(p),pr=project(p.project_id),c=contract(p.contract_id),next=nextForward(p);
  const title=`Процентовка за ${monthName()}`;
  return `<article class="proc-card" data-proc-action="open" data-id="${esc(p.id)}" tabindex="0" role="button">
   <div class="proc-card-title">${esc(title)}</div>
   <span class="proc-card-object">${esc(pr?.name||'Объект')}</span>
   <span class="proc-card-line">Договор №${esc(c?.number||'')} · ${fmtMillion(s.actTotal)} млн</span>
   <span class="proc-card-line">${s.acts.length} акт${s.acts.length===1?'':'ов'} С-2 · С-3а ${s.c3.length?'есть':'нет'}${p.attention_document_id?' · на исправлении':''}</span>
   ${next&&canMove()?`<button class="proc-card-action" data-proc-action="transition" data-id="${esc(p.id)}" data-target="${esc(next[0])}">${esc(next[1])}</button>`:''}
   ${cardCorner(p,s)}
  </article>`;
 }
 function laneHtml(id,label){
  const rows=stageRows(id);
  const total=rows.reduce((sum,p)=>sum+stats(p).actTotal,0);
  const avg=rows.length?Math.round(rows.reduce((sum,p)=>sum+stageAgeDays(p),0)/rows.length):0;
  return `<section class="proc-stage" data-stage="${esc(id)}" data-proc-lane="${esc(id)}">
   <div class="proc-stage-head">${esc(label)} (${rows.length})</div>
   <div class="proc-stage-metric"><b>${fmtMillion(total)}</b> млн · ср. ${avg} дн.</div>
   <div class="proc-lane-body" data-proc-cards>${rows.length?rows.map(processCard).join(''):'<div class="proc-empty">Нет комплектов</div>'}</div>
  </section>`;
 }

 async function renderFlow(force=false){
  const pg=document.querySelector('#shell main .pg');if(!pg)return;
  const title=pg.querySelector('h1')?.textContent?.trim();
  if(title!=='Конвейер месяца'&&!pg.dataset.procBoard)return;
  if(pg.dataset.procBoard==='1'&&!force)return;
  try{
   await load(true);
   const activeProjects=[...new Set(cache.processes.map(p=>p.project_id))];
   if(activeFilter&&!activeProjects.includes(activeFilter))activeFilter='';
   pg.dataset.procBoard='1';
   pg.innerHTML=`<div class="proc-head"><h1>Конвейер месяца</h1><div class="proc-explain">Заголовок показывает направление потока, сумму процентовок и средний возраст комплектов на стадии. Красный уголок — комплект возвращён на исправление, жёлтый — есть расхождение С-2 и С-3а.</div></div>
    ${activeProjects.length?`<div class="proc-filters"><button class="${activeFilter?'':'on'}" data-proc-filter="">Все объекты</button>${activeProjects.map(id=>`<button class="${activeFilter===id?'on':''}" data-proc-filter="${esc(id)}">${esc(project(id)?.name||'')}</button>`).join('')}</div>`:''}
    <div class="proc-board">${displayStages.map(([id,label])=>laneHtml(id,label)).join('')}</div>`;
  }catch(err){pg.innerHTML=`<h1>Конвейер месяца</h1><p class="error">${esc(err.message||err)}</p>`;}
 }

 function timelineState(p){
  const map={pto:0,site:1,review:2,external:4,accounting:6,closed:7};
  return map[p.bucket]??0;
 }
 function timelineHtml(p){
  const steps=['Подготовлена','У прораба','Технадзор','Подписана технадзором','У заказчика','Подписана заказчиком','В бухгалтерии','Закрыта'];
  const current=timelineState(p);
  const actor=eventsFor(p)[0]?.actor;
  const actorName=cache.profiles.find(x=>x.id===actor)?.display_name||'';
  return `<div class="proc-timeline">${steps.map((label,i)=>{
   const cls=i<current?'done':i===current?'current':'';
   const note=i===current&&actorName?`<small>ответственный: ${esc(actorName)}</small>`:'';
   return `<div class="proc-step ${cls}"><span class="proc-step-dot"></span><div>${esc(label)}${note}</div></div>`;
  }).join('')}</div>`;
 }
 function helpText(p,s){
  if(p.bucket==='pto')return 'Проверьте состав комплекта, суммы актов С-2 и справки С-3а. После сверки передайте комплект на объект.';
  if(p.bucket==='site')return 'Комплект находится на объекте. После проверки прорабом передайте его технадзору.';
  if(p.bucket==='review')return 'Комплект рассматривает технадзор. После подтверждения направьте документы заказчику по договору.';
  if(p.bucket==='external')return 'Комплект находится у заказчика по договору. После подписания передайте подписанные документы в бухгалтерию.';
  if(p.bucket==='accounting')return 'Проверьте, что подписанный комплект передан в бухгалтерию и подтверждение передачи зафиксировано. После этого месяц можно закрывать.';
  if(p.bucket==='closed')return 'Комплект закрыт. Принятые акты участвуют в месячном реестре.';
  return s.match?'Суммы С-2 и С-3а совпадают.':'Есть расхождение между суммой актов С-2 и справкой С-3а.';
 }
 function processModal(p){
  const s=stats(p),pr=project(p.project_id),c=contract(p.contract_id),hist=eventsFor(p),next=nextForward(p);
  dialog.className='proc-drawer';
  dialog.innerHTML=`<div class="proc-drawer-body">
   <button class="proc-drawer-close" data-proc-action="close">Закрыть ×</button>
   <div class="proc-drawer-title">Процентовка за ${esc(monthName())}</div>
   <div class="proc-drawer-sub">Комплект процентовки · ${esc(pr?.name||'Объект')} · договор №${esc(c?.number||'')}</div>
   ${timelineHtml(p)}
   ${next&&canMove()?`<button class="proc-primary-action" data-proc-action="transition" data-id="${esc(p.id)}" data-target="${esc(next[0])}">${esc(next[1])}</button>`:''}
   ${p.bucket!=='pto'&&p.bucket!=='closed'&&canMove()?`<section class="proc-return"><h3>Вернуть назад</h3><textarea data-proc-return-note placeholder="Причина возврата"></textarea><button data-proc-action="quick-return" data-id="${esc(p.id)}">Вернуть на исправление</button><p class="error proc-error" data-proc-return-error></p></section>`:''}
   <section class="proc-help"><h3>Что делать на этом шаге</h3><p>${esc(helpText(p,s))}</p></section>
   <div class="proc-history-title">История</div>
   <div class="proc-history">${hist.length?hist.map(x=>`<div class="proc-event"><b>${esc(bucketNames[x.from_bucket]||'Создан')} → ${esc(bucketNames[x.to_bucket]||x.to_bucket)}</b><small>${esc(fmtDate(x.created_at))}${x.person?` · ${esc(x.person)}`:''}</small>${x.note?`<small>${esc(x.note)}</small>`:''}</div>`).join(''):'<div class="muted">Движение ещё не зафиксировано.</div>'}</div>
  </div>`;
  if(!dialog.open)dialog.showModal();
 }

 function transitionDialog(p,target){
  const docs=docsFor(p),c=contract(p.contract_id),isReturn=target==='pto';
  const label=(transitions[p.bucket]||[]).find(x=>x[0]===target)?.[1]||'Переместить';
  const step=target==='external'?`У ${c?.party||'заказчика'}`:bucketNames[target];
  dialog.className='proc-drawer';
  dialog.innerHTML=`<div class="proc-drawer-body"><div class="proc-transition-head"><h2>${esc(label)}</h2><button class="proc-transition-back" data-proc-action="back" data-id="${esc(p.id)}">← Назад</button></div>
   <form id="proc-transition-form"><div class="proc-grid">
    ${isReturn?`<label class="wide">Документ с замечанием<select name="document_id"><option value="">Весь комплект / без привязки</option>${docs.map(d=>`<option value="${esc(d.id)}">${esc(kindNames[d.kind])} №${esc(d.number)}</option>`).join('')}</select></label>`:`<label>Кому передано / кем подтверждено<input name="person" autocomplete="off" required></label><label>Способ передачи<input name="method" autocomplete="off" placeholder="Лично, электронно, письмо..."></label>`}
    ${!isReturn?`<label class="wide">Подтверждение / основание<textarea name="proof" ${['external','accounting','closed'].includes(target)?'required':''}></textarea></label>`:''}
    <label class="wide">${isReturn?'Причина возврата':'Комментарий'}<textarea name="note" ${isReturn?'required':''}></textarea></label>
   </div><input type="hidden" name="step_label" value="${esc(step||'')}"><p id="proc-error" class="error"></p><div class="actions"><button class="primary" type="submit">Сохранить переход</button></div></form></div>`;
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
 async function quickReturn(p){
  const note=dialog.querySelector('[data-proc-return-note]')?.value?.trim()||'';
  const error=dialog.querySelector('[data-proc-return-error]');
  if(!note){if(error)error.textContent='Укажите причину возврата.';return;}
  const per=period(p.period_id);
  try{
   await q(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload:{op:'transition_process',process_id:p.id,bucket:'pto',expected_revision:String(per?.revision??0),document_id:'',note,step_label:'Возвращено в ПТО'}}));
   cache=null;dialog.close();await renderFlow(true);showToast('Комплект возвращён в ПТО.');
  }catch(err){if(error)error.textContent=err.message||String(err);}
 }
 function showToast(text){const t=document.querySelector('#toast');if(!t)return;t.textContent=text;t.hidden=false;t.style.display='block';clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>{t.hidden=true;t.style.display='none';},7000);}

 document.addEventListener('click',async ev=>{
  const filter=ev.target.closest('[data-proc-filter]');
  if(filter){ev.preventDefault();activeFilter=filter.dataset.procFilter||'';await renderFlow(true);return;}
  const b=ev.target.closest('[data-proc-action]');if(!b)return;
  ev.preventDefault();ev.stopPropagation();
  if(b.dataset.procAction==='close'){dialog.close();return;}
  await load();const p=cache.processes.find(x=>x.id===b.dataset.id);if(!p)return;
  if(b.dataset.procAction==='open'){processModal(p);return;}
  if(b.dataset.procAction==='back'){processModal(p);return;}
  if(b.dataset.procAction==='transition'){transitionDialog(p,b.dataset.target);return;}
  if(b.dataset.procAction==='quick-return'){await quickReturn(p);return;}
 },true);

 document.addEventListener('keydown',ev=>{
  const card=ev.target.closest?.('.proc-card[data-proc-action="open"]');
  if(card&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();card.click();}
 });
 document.addEventListener('change',async ev=>{
  if(ev.target.matches('.top input[type="month"]')){cache=null;activeFilter='';const pg=document.querySelector('#shell main .pg');if(pg)delete pg.dataset.procBoard;await renderFlow(true);}
 });
 document.addEventListener('click',ev=>{const nav=ev.target.closest('[data-action="nav"][data-id="flow"]');if(nav){cache=null;activeFilter='';}},true);

 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(async()=>{scheduled=false;try{await renderFlow();}catch(err){console.error(err);}});}
 const observer=new MutationObserver(schedule);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 schedule();
}
