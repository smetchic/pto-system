// Раздел «Сегодня» (решение 11.10.2026): что сделать мне, чего ждём от других, сроки на 7 дней, что изменилось с прошлого входа.
// Всё вычисляется из комплектов, ожиданий, договоров и журнала; строки открывают ту же боковую карточку, что в «Подписании».
import {escapeHtml as e,money,canWrite,actionNames} from './domain.js';
import {objectColor,expectedCards,canMoveCard,turnOf,openNotes,daysOnStep,subsOf,KIND,reference} from './conveyor.js';
import {c29Status} from './portfolio.js';

const DAY=86400000;
const addDays=(key,n)=>{const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const dm=x=>new Date(String(x).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:'Europe/Minsk'});
const cap=t=>t?t[0].toUpperCase()+t.slice(1):'';
const plural=(n,one,few,many)=>{const a=n%10,b=n%100;return a===1&&b!==11?one:a>=2&&a<=4&&(b<12||b>14)?few:many;};

// Мои объекты: инженер — закреплённые и где он ответственный; начальник ПТО и руководитель видят все.
export function myProjects(data,profile){
 return (data.projects||[]).filter(p=>p.engineer_id===profile?.id||(profile?.role==='engineer'&&canWrite(profile,data.memberships,p.id)));
}

export function todayPage({ui,data,profile,today,now=Date.now(),lastVisit=null}){
 const scope=ui.todayScope||(profile?.role==='engineer'?'mine':'all');
 const mine=new Set(myProjects(data,profile).map(p=>p.id));
 const inScope=pid=>scope==='all'||mine.has(pid);
 const projects=(data.projects||[]).filter(p=>inScope(p.id)),month=ui.month;
 const name=pid=>(data.projects||[]).find(p=>p.id===pid)?.name||'';
 const color=pid=>objectColor(data.projects||[],pid);
 const cards=[...(data.workflows||[]),...expectedCards(data,month)].filter(x=>inScope(x.project_id)&&x.step_code!=='accepted');
 const open=x=>x.expected?`data-action="expected" data-id="${e(x.key)}"`:`data-action="workflow" data-id="${e(x.id)}"`;
 const days=x=>x.expected?0:daysOnStep(x,now);
 const second=x=>x.template_code==='c29'?'С-29':x.template_code==='sub_claim'?`Субподряд, ${x.party||''}`:`${KIND[x.template_code]}, дог. № ${x.contract_number||''}`;
 const row=(x,what,right,cls='')=>`<button class="td-row ${cls}" ${open(x)} style="--oc:${color(x.project_id)}"><i class="td-dot"></i><span class="td-t"><b>${e(name(x.project_id))}</b> <span class="td-what">${e(what)}</span><small>${e(second(x))}${openNotes(x).length?` · <span class="neg">замечание: ${e(openNotes(x).at(-1).note)}</span>`:''}</small></span><span class="td-r">${right}</span></button>`;

 // Ваш ход: следующий шаг за пользователем; сначала с замечанием, затем по дням на шаге.
 const turn=cards.filter(x=>canMoveCard(x,{profile,data})&&turnOf(x)).sort((a,b)=>(openNotes(b).length>0)-(openNotes(a).length>0)||days(b)-days(a));
 const notes=cards.filter(x=>openNotes(x).length);
 const amount=x=>x.money&&Number(x.acts_amount)?`<b>${money(x.acts_amount)}</b>`:'';
 const turnRow=x=>row(x,cap(turnOf(x)),`${amount(x)}<span class="st ${openNotes(x).length?'e':days(x)>=7?'w':''}">${x.expected?'ждёт':days(x)?days(x)+' дн.':'сегодня'}</span>`,openNotes(x).length?'bad':'');

 // Ждём других: субподрядчики не подали, прораб не сдал объёмы, технадзор и заказчик держат, ДС без скана.
 const wait=[];
 for(const p of projects){
  const subs=subsOf(data,p.id,month).filter(s=>!s.skip),left=subs.filter(s=>!s.workflow);
  if(left.length)wait.push({pid:p.id,act:`data-action="project" data-id="${e(p.id)}"`,what:`Субподрядчики: подали ${subs.length-left.length} из ${subs.length}`,sub:left.map(s=>s.contract.party||s.contract.number).join(', '),right:''});
 }
 for(const x of cards){
  if(x.expected&&x.template_code==='claim')wait.push({pid:x.project_id,act:open(x),what:'Прораб не сдал объёмы',sub:`дог. № ${x.contract_number||''}`,right:''});
  else if(!x.expected&&x.step_code==='tn'&&x.template_code!=='c29')wait.push({pid:x.project_id,act:open(x),what:`Технадзор держит ${days(x)} дн.`,sub:second(x),right:amount(x),n:days(x)});
  else if(!x.expected&&x.step_code==='tn'&&x.template_code==='c29')wait.push({pid:x.project_id,act:open(x),what:`С-29 у прораба ${days(x)} дн.`,sub:'фактический расход',right:'',n:days(x)});
  else if(!x.expected&&x.step_code==='check'&&x.template_code==='claim')wait.push({pid:x.project_id,act:open(x),what:`Заказчик проверяет ${days(x)} дн.`,sub:second(x),right:amount(x),n:days(x)});
 }
 for(const a of (data.addenda||[]).filter(a=>a.status==='draft')){const c=(data.contracts||[]).find(k=>k.id===a.contract_id);if(!c||!inScope(c.project_id))continue;
  wait.push({pid:c.project_id,act:`data-action="contract" data-id="${e(c.id)}"`,what:`ДС № ${a.number} в работе, без скана`,sub:`дог. № ${c.number} · ${c.party||''}`,right:''});}
 wait.sort((a,b)=>(b.n||0)-(a.n||0));
 const waitRow=w=>`<button class="td-row" ${w.act} style="--oc:${color(w.pid)}"><i class="td-dot"></i><span class="td-t"><b>${e(name(w.pid))}</b> <span class="td-what">${e(w.what)}</span><small>${e(w.sub)}</small></span><span class="td-r">${w.right}</span></button>`;

 // Сроки на 7 дней: С-29 до 15 числа, окончание договоров в ближайшие 30 дней, сроки документов. Просроченное — красным.
 const end7=addDays(today,7),end30=addDays(today,30),dues=[];
 for(const p of projects){const s=c29Status(data.workflows||[],p.id,month,today,now);const w=(data.workflows||[]).find(x=>x.template_code==='c29'&&x.project_id===p.id)||expectedCards(data,month).find(x=>x.template_code==='c29'&&x.project_id===p.id);
  if(w&&!s.done&&s.deadline<=end7)dues.push({pid:p.id,date:s.deadline,act:open(w),what:'С-29 за месяц',sub:s.text});}
 for(const c of (data.contracts||[]).filter(c=>inScope(c.project_id)&&!reference(c)&&c.checked!==false&&c.current_end_date&&c.current_end_date>=today&&c.current_end_date<=end30))
  dues.push({pid:c.project_id,date:c.current_end_date,act:`data-action="contract" data-id="${e(c.id)}"`,what:`Окончание договора № ${c.number}`,sub:c.party||''});
 for(const d of (data.documents||[]).filter(d=>inScope(d.project_id)&&d.due_date&&d.due_date<=end7&&d.step_code!=='accepted'))
  dues.push({pid:d.project_id,date:d.due_date,act:`data-action="doc" data-id="${e(d.id)}"`,what:`Срок документа № ${d.number}`,sub:d.step_label||''});
 dues.sort((a,b)=>a.date.localeCompare(b.date));
 const late=dues.filter(d=>d.date<today).length,soon=dues.filter(d=>d.date<=end7);
 const dueRow=d=>`<button class="td-row" ${d.act} style="--oc:${color(d.pid)}"><i class="td-dot"></i><span class="td-t"><b>${e(name(d.pid))}</b> <span class="td-what">${e(d.what)}</span><small>${e(d.sub)}</small></span><span class="td-r"><span class="st ${d.date<today?'e':d.date<=end7?'w':''}">${d.date<today?'просрочено · ':''}${e(dm(d.date))}</span></span></button>`;
 const week=Array.from({length:7},(_,i)=>{const k=addDays(today,i);return {k,n:dues.filter(d=>d.date===k).length};});

 // Изменилось с прошлого входа: события моих объектов, без своих.
 const evs=(data.events||[]).filter(x=>inScope(x.project_id)&&x.actor!==profile?.id);
 const fresh=lastVisit?evs.filter(x=>x.created_at>lastVisit):[];
 const changes=(fresh.length?fresh:evs).slice(0,6);
 const who=id=>(data.profiles||[]).find(p=>p.id===id)?.display_name||'';
 const when=x=>new Date(x).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Minsk'});

 const f=['turn','notes','wait','due'].includes(ui.todayFilter)?ui.todayFilter:'turn';
 const lists={turn:['Ваш ход',turn.map(turnRow),profile?.role==='director'?'Руководитель только смотрит: шаги делает ПТО.':'Сейчас ваших шагов нет.'],
  notes:['С замечаниями',notes.map(turnRow),'Открытых замечаний нет.'],
  wait:['Ждём других',wait.map(waitRow),'Ничего не ждём.'],
  due:['Сроки 7 дней',soon.map(dueRow),'На ближайшие 7 дней сроков нет.']};
 const MAX=8,list=([title,rows,empty])=>`<section class="td-box"><h2>${title} <span>${rows.length||''}</span></h2>${rows.length?rows.slice(0,MAX).join('')+(rows.length>MAX?`<div class="td-more">и ещё ${rows.length-MAX}</div>`:''):`<div class="td-empty">${e(empty)}</div>`}</section>`;
 const counter=(id,label,n,extra='')=>`<button class="td-k ${f===id?'on':''} ${extra}" data-action="today-filter" data-id="${id}" aria-pressed="${f===id}"><b>${n}</b><span>${label}</span></button>`;

 // Начальнику ПТО: что поправить в справочниках.
 let headBox='';
 if(profile?.role==='head'){
  const live=(data.contracts||[]).filter(c=>!reference(c));
  const unchecked=live.filter(c=>c.checked===false).length,noTerms=live.filter(c=>c.checked!==false&&(!c.current_amount||!c.current_end_date)).length;
  const old=(data.parties||[]).filter(c=>!c.mns_checked_at||(Date.parse(today)-Date.parse(c.mns_checked_at))/DAY>30).length;
  headBox=`<div class="td-head"><span class="muted">Справочники:</span>${[['unchecked','не проверено договоров',unchecked],['noterms','договоров без цены или срока',noTerms],['mns','контрагентов со сведениями МНС старше 30 дней',old]].map(([id,l,n])=>`<button class="link" data-action="today-link" data-id="${id}"${n?'':' disabled'}><b>${n}</b> ${l}</button>`).join('')}</div>`;
 }
 const second_=f==='wait'?lists.due:lists.wait;
 return `<div class="td"><div class="td-top"><div><h1>Сегодня</h1><div class="muted">${e(new Date(now).toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long',timeZone:'Europe/Minsk'}))} · отчётный месяц ${e(new Date(month+'-01T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'Europe/Minsk'}).replace(' г.',''))}</div></div>
 <div class="ct-seg" role="group" aria-label="Объекты">${[['mine','Мои объекты'],['all','Все']].map(([v,l])=>`<button class="${scope===v?'on':''}" data-action="today-scope" data-id="${v}" aria-pressed="${scope===v}">${l}${v==='mine'?` <span class="muted">${mine.size}</span>`:''}</button>`).join('')}</div></div>
 <div class="td-ks">${counter('turn','Ваш ход',turn.length)}${counter('notes','С замечаниями',notes.length,notes.length?'bad':'')}${counter('wait','Ждём других',wait.length)}${counter('due','Сроки 7 дней',soon.length,late?'bad':'')}</div>
 ${headBox}
 <div class="td-grid">${list(lists[f])}${list(second_)}</div>
 <div class="td-grid"><section class="td-box"><h2>Ближайшие 7 дней</h2><div class="td-week">${week.map(d=>`<div class="${d.n?'has':''}${d.k===today?' now':''}"><b>${d.n||'—'}</b><span>${e(dm(d.k))}</span></div>`).join('')}</div></section>
 <section class="td-box"><h2>${fresh.length?`Изменилось с прошлого входа <span>${fresh.length}</span>`:'Последние изменения'}</h2>${changes.length?changes.map(x=>`<div class="td-ev" style="--oc:${color(x.project_id)}"><i class="td-dot"></i><span>${e(actionNames[x.action]||x.action)} <span class="muted">· ${e(name(x.project_id))}</span></span><small>${e(who(x.actor))} · ${e(when(x.created_at))}</small></div>`).join(''):'<div class="td-empty">Событий пока нет.</div>'}</section></div></div>`;
}
