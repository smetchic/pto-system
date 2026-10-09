// Страница объекта (docs/object.md): Месяц · Договоры · Документы · История. Чистая функция: данные из main.js, шаги делаются в боковой панели «Подписания».
import {escapeHtml as e,money,kindNames,actionNames,canWrite,ourRoleNames} from './domain.js';
import {COLUMNS,KIND,openNotes,objectColor,subsOf,canMoveCard,turnOf,daysOnStep,expectedCards,activeIn,oursContract} from './conveyor.js';
import {projectAmounts,deltaPercent,c29Deadline,c29Status,engineerName} from './portfolio.js';

export const OBJECT_TABS=[['month','Месяц'],['contracts','Договоры'],['documents','Документы'],['history','История']];
export const objectTab=t=>OBJECT_TABS.some(([id])=>id===t)?t:'month';
const DAY=86400000;
const day=x=>x?new Date(String(x).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Europe/Minsk'}):'';
const dm=x=>x?new Date(String(x).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',timeZone:'Europe/Minsk'}):'';
const st=(text,cls='n',title='')=>`<span class="ob-st ${cls}"${title?` title="${e(title)}"`:''}>${e(text)}</span>`;
const btn=(text,action,id='',primary=false)=>`<button ${primary?'class="primary"':''} data-action="${action}" data-id="${e(id)}">${e(text)}</button>`;
const KIND_LONG={claim:'Процентовка заказчику',sub_claim:'Процентовка субподрядчика',c29:'С-29'};
const monthName=month=>new Date(month+'-01T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',timeZone:'Europe/Minsk'});
// Прошлый месяц в родительном падеже («сентября»).
const prevGenitive=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-2,1,12)).toLocaleDateString('ru-RU',{day:'numeric',month:'long',timeZone:'Europe/Minsk'}).replace(/^\d+\s*/,'');};

// Доля прошедшего срока договора, %: от начала работ (или даты договора) до текущего срока; null, если дат нет.
export function termPassed(c,today){
 const from=c.work_start_date||c.contract_date,to=c.current_end_date;if(!from||!to||to<=from)return null;
 const p=(new Date(today)-new Date(from))/(new Date(to)-new Date(from));return Math.max(0,Math.min(100,Math.round(p*100)));
}
// Условия закрытия месяца объекта (docs/object.md): процентовки и С-29 в бухгалтерии или сняты, субподрядчики прошли или исключены, месяц проверен.
export function closeConditions(data,projectId,month){
 const ws=(data.workflows||[]).filter(w=>w.project_id===projectId),skips=(data.skips||[]).filter(s=>s.project_id===projectId);
 const ours=(data.contracts||[]).filter(c=>c.project_id===projectId&&oursContract(c)&&activeIn(c,month));
 const claimOk=ours.every(c=>ws.some(w=>w.template_code==='claim'&&w.contract_id===c.id&&w.step_code==='accepted')||skips.some(s=>s.template_code==='claim'&&s.contract_id===c.id));
 const c29=ws.find(w=>w.template_code==='c29');
 const c29Ok=!ours.length||c29?.step_code==='accepted'||skips.some(s=>s.template_code==='c29');
 const subs=subsOf(data,projectId,month),subsDone=subs.filter(s=>s.passed||s.skip).length;
 const per=(data.periods||[]).find(p=>p.project_id===projectId);
 const reviewed=!!per&&per.reviewed_revision===per.revision;
 return [
  {ok:claimOk,text:ours.length>1?'Процентовки заказчику в бухгалтерии или сняты':'Процентовка заказчику в бухгалтерии или снята'},
  {ok:c29Ok,text:'С-29 в бухгалтерии'},
  {ok:subsDone===subs.length,text:`Субподрядчики прошли технадзор или исключены · ${subsDone} из ${subs.length}`},
  {ok:reviewed,text:'Месяц проверен начальником ПТО'}
 ];
}

export function objectPage({ui,data,profile,today,now=Date.now()}){
 const pid=ui.project,p=(data.projects||[]).find(x=>x.id===pid);
 if(!p)return '<div class="empty">Объект не найден.</div>';
 const month=ui.month,tab=objectTab(ui.projectTab),color=objectColor(data.projects,pid),eng=engineerName(data,pid);
 const per=(data.periods||[]).find(x=>x.project_id===pid),writer=canWrite(profile,data.memberships,pid),head=profile?.role==='head';
 const canEdit=writer&&per?.status==='open';
 const contracts=(data.contracts||[]).filter(c=>c.project_id===pid);
 const ws=(data.workflows||[]).filter(w=>w.project_id===pid);
 const exp=expectedCards({projects:data.projects,contracts:data.contracts||[],workflows:data.workflows||[],skips:data.skips||[]},month).filter(x=>x.project_id===pid);
 const docs=(data.documents||[]).filter(d=>d.project_id===pid);
 const ver=d=>(data.versions||[]).find(v=>v.id===d.current_version);
 const open=x=>x.expected?`data-action="expected" data-id="${e(x.key)}"`:`data-action="workflow" data-id="${e(x.id)}"`;
 const days=x=>x.expected?'':` · ${daysOnStep(x,now)} дн.`;
 const status=x=>{const n=openNotes(x);if(x.expected)return st(x.note==='прораб не сдал объёмы'?'Ждём объёмы · прораб не сдал':x.note,'n');
  if(x.step_code==='accepted')return st('В бухгалтерии','ok');return st(x.step_label+days(x),n.length?'e':x.step_code==='signed'?'b':'w',n.length?n[n.length-1].note:'');};
 const turn=x=>canMoveCard(x,{profile,data})&&turnOf(x)?`<b>Ваш ход: ${e(turnOf(x))}.</b>`:'';
 const periodState=!per?st('Месяц не открыт','n'):per.status==='closed'?st('Месяц закрыт','ok'):per.reviewed_revision===per.revision?st('Месяц проверен','b'):st('Месяц в работе','w');

 const headHtml=`<div class="ob-head"><h1><i class="ob-color" style="background:${color}" title="Цвет объекта, как на карточках «Подписания»"></i><span title="${e(p.full_name||p.name)}">${e(p.name)}</span>${eng?`<small title="Ответственный инженер ПТО">${e(eng)}</small>`:''}</h1>
 <div class="ob-right"><span class="ob-month">${e(monthName(month))} ${e(month.slice(0,4))}</span>${periodState}${!per&&writer?btn('Открыть месяц','open-period','',true):''}</div></div>
 <div class="tabs" role="tablist" aria-label="Разделы объекта">${OBJECT_TABS.map(([id,label])=>`<button role="tab" aria-selected="${tab===id}" class="${tab===id?'on':''}" data-action="project-tab" data-id="${id}">${label}${id==='contracts'?`<span class="ob-cnt">${contracts.length}</span>`:id==='documents'?`<span class="ob-cnt">${docs.length}</span>`:''}</button>`).join('')}</div>`;

 // ——— Месяц ———
 function monthTab(){
  const ours=contracts.filter(c=>oursContract(c)&&(activeIn(c,month)||ws.some(w=>w.contract_id===c.id)));
  const subs=subsOf(data,pid,month);
  const stepsBar=x=>{const cur=COLUMNS.findIndex(([c])=>c===x.step_code),dates=x.step_dates||{};
   return `<div class="ob-steps" aria-label="Шаги маршрута">${COLUMNS.map(([c,l],i)=>`<span class="${i<cur?'d':i===cur?'c':''}">${e(l)}${i<cur&&dates[c]?' '+dm(dates[c]):''}</span>`).join('')}</div>`;};
  const blocked=x=>{if(x.expected||x.step_code!=='tn')return '';const why=[];
   const left=subs.filter(s=>!s.passed&&!s.skip).map(s=>s.contract.party||s.contract.number);if(left.length)why.push('не прошли технадзор: '+left.join(', '));
   if(!docs.some(d=>d.workflow_id===x.id&&d.kind==='c3a'))why.push('нет справки С-3а');
   return why.length?` <span class="ob-why">Отправить заказчику нельзя: ${e(why.join('; '))}.</span>`:'';};
  const parts=(x,first)=>{if(!first||(!subs.length&&x.expected))return '';
   const row=ws.length?(data.matrix?.rows||[]).find(r=>r.kind==='contract'&&r.contract_id===x.contract_id):null;
   const passed=subs.filter(s=>s.passed).length;
   const subRow=s=>{const w=s.workflow,n=openNotes(w),flag=n.length?` <span class="ob-flag" title="${e(n[n.length-1].note)}">⚑${n[n.length-1].round>1?' '+n[n.length-1].round+'-й круг':''}</span>`:'';
    const state=s.skip?st('Исключён','n',s.skip.reason||''):!w?st('Ждём процентовку','n'):s.passed?st(w.step_code==='accepted'?'В бухгалтерии':'ТН ✓ · '+w.step_label,'ok'):st(w.step_label+days(w),n.length?'e':'w');
    return `<tr><td>${e(s.contract.party||'')} <span class="muted">№ ${e(s.contract.number)}</span>${flag}</td><td class="s">${state}</td><td class="n">${w&&Number(w.acts_amount)?money(w.acts_amount):'<span class="muted">—</span>'}</td></tr>`;};
   return `<div><h3>Части процентовки <span>· субподрядчики прошли технадзор ${passed} из ${subs.length}</span></h3><table class="ob-rows"><tbody>
    <tr><td>Наша часть <span class="muted">своими силами</span></td><td class="s">${x.expected?st('Ждём объёмы','n'):st(x.step_label,'w')}</td><td class="n">${row?`<span${Number(row.own)<0?' class="neg"':''}>${money(row.own)}</span>`:'<span class="muted">—</span>'}</td></tr>
    ${subs.map(subRow).join('')}</tbody></table></div>`;};
  const kit=x=>{if(x.expected)return '';const list=docs.filter(d=>d.workflow_id===x.id);const noC3a=!list.some(d=>d.kind==='c3a')&&['acts','tn'].includes(x.step_code);
   return `<div><h3>Комплект <span>· ${list.length} ${list.length===1?'документ':list.length>=2&&list.length<=4?'документа':'документов'}</span></h3><table class="ob-rows"><tbody>
    ${list.map(d=>{const v=ver(d);return `<tr><td><button class="link" data-action="doc" data-id="${e(d.id)}">${e(kindNames[d.kind])} № ${e(d.number)}</button> <span class="muted">в.${v?.version||1}</span></td><td class="n">${d.kind==='c29'?'':money(v?.amount)}</td></tr>`;}).join('')}
    ${noC3a?`<tr><td class="muted">Справка С-3а</td><td class="n muted">нужна для отправки заказчику</td></tr>`:''}</tbody></table></div>`;};
  const claimItem=(c,i)=>{const x=ws.find(w=>w.template_code==='claim'&&w.contract_id===c.id)||exp.find(z=>z.template_code==='claim'&&z.contract_id===c.id);
   const skip=(data.skips||[]).find(s=>s.template_code==='claim'&&s.contract_id===c.id);
   if(!x)return skip?`<div class="ob-item"><span class="ob-dot ok"></span><div class="ob-it"><b>Процентовка заказчику</b><span class="muted">дог. № ${e(c.number)} · ${e(c.party||'')}</span>${st('Снята: '+(skip.reason||'без причины'),'n')}</div></div>`:'';
   const inner=`${stepsBar(x)}<div class="ob-move">${turn(x)}${blocked(x)}</div>${parts(x,i===0)||kit(x)?`<div class="ob-two">${parts(x,i===0)}${kit(x)}</div>`:''}`;
   return `<div class="ob-item ob-click" ${open(x)} tabindex="0" role="button"><span class="ob-dot ${x.expected?'n':x.step_code==='accepted'?'ok':openNotes(x).length?'e':'w'}"></span>
    <div class="ob-it"><b>Процентовка заказчику</b><span class="muted">дог. № ${e(c.number)} · ${e(c.party||'')}</span>${status(x)}</div><div class="ob-act">${!x.expected&&Number(x.acts_amount)?`<b>${money(x.acts_amount)}</b>`:''}</div><div class="ob-span">${inner}</div></div>`;};
  const c29w=ws.find(w=>w.template_code==='c29')||exp.find(z=>z.template_code==='c29');
  const c29s=c29Status(data.workflows||[],pid,month,today,now);
  const c29Item=c29w?`<div class="ob-item ob-click" ${open(c29w)} tabindex="0" role="button"><span class="ob-dot ${c29s.done?'ok':c29s.cls==='e'||c29s.cls==='o'?'e':c29w.expected?'n':'w'}"></span>
   <div class="ob-it"><b>С-29 за ${e(monthName(month))}</b>${st(c29s.text,c29s.cls==='o'?'e':c29s.cls,c29s.title||'')}<span class="muted">срок ${e(dm(c29s.deadline))}${c29s.soon!==undefined?` · через ${c29s.soon} дн.`:''}</span></div><div class="ob-act"></div>
   <div class="ob-span ob-move">${turn(c29w)||'<span class="muted">Материальный отчёт по объекту за месяц.</span>'}</div></div>`:'';
  const cond=closeConditions(data,pid,month),allOk=cond.every(c=>c.ok);
  const closeBtns=head&&per?(per.status==='open'?btn('Проверить месяц','review')+btn('Закрыть месяц','close','',allOk):btn('Открыть повторно','reopen')):'';
  const closeItem=`<div class="ob-item"><span class="ob-dot ${per?.status==='closed'?'ok':'n'}"></span><div class="ob-it"><b>Закрытие месяца</b>${per?.status==='closed'?st('Закрыт, снимок сохранён','ok'):st(allOk?'можно закрыть':'ждёт','n')}</div><div class="ob-act">${closeBtns}</div>
   <div class="ob-span"><ul class="ob-cond">${cond.map(c=>`<li class="${c.ok?'ok':''}">${c.ok?'✓':'—'} ${e(c.text)}</li>`).join('')}</ul>${head?'':'<span class="muted">Проверяет и закрывает начальник ПТО.</span>'}</div></div>`;
  const tails=(data.prevWorkflows||[]).filter(w=>w.project_id===pid&&w.step_code!=='accepted');
  const tailHtml=tails.length?`<div class="ob-tail"><b>Хвост ${e(prevGenitive(month))}</b>${tails.map(w=>`<button class="link" data-action="workflow" data-id="${e(w.id)}">${e(KIND_LONG[w.template_code]||w.template_name)}${w.template_code==='sub_claim'?' · '+e(w.party||''):''}: ${e(w.step_label)}${days(w)}</button>`).join('')}<span class="muted">Прошлый месяц закроется, когда всё уйдёт в бухгалтерию.</span></div>`:'';
  const accepted=[...ours.map(c=>ws.find(w=>w.template_code==='claim'&&w.contract_id===c.id)),c29w].filter(Boolean);
  const inAcc=accepted.filter(x=>x.step_code==='accepted').length;
  // Другие дела месяца: оценка, допсоглашения в работе, сопоставление субподряда.
  const est=(data.matrix?.rows||[]).filter(r=>r.kind==='contract'&&r.project_id===pid&&r.estimate!==null&&r.estimate!==undefined);
  const drafts=(data.addenda||[]).filter(a=>a.status==='draft'&&contracts.some(c=>c.id===a.contract_id));
  const alloc=(data.allocations||[]).filter(a=>a.period_id===per?.id),allocSum=alloc.reduce((t,a)=>t+Number(a.amount||0),0);
  const others=`<div class="ob-others">
   <div class="ob-other"><b>Оценка выполнения</b>${est.length?`<span>${est.map(r=>money(r.estimate)).join(' · ')} · предварительно</span>`:'<span class="muted">не вводилась</span>'}<span class="muted">до подписания актов, в реестре отдельно</span>${canEdit?`<span>${btn(est.length?'Изменить оценку':'Ввести оценку','estimate')}</span>`:''}</div>
   <div class="ob-other"><b>Допсоглашения в работе</b>${drafts.length?drafts.map(a=>{const c=contracts.find(k=>k.id===a.contract_id);return `<button class="link" data-action="contract" data-id="${e(a.contract_id)}">ДС № ${e(a.number)} к дог. № ${e(c?.number||'')}</button>`;}).join(''):'<span class="muted">нет</span>'}<span class="muted">цена и срок пересчитаются после подписания</span></div>
   <div class="ob-other"><b>Субподряд сопоставлен</b><span>${alloc.length?money(allocSum):'<span class="muted">пока нет</span>'}</span><span class="muted">в ценах предъявления заказчику</span>${canEdit?`<span>${btn('Сопоставить','allocate')}</span>`:''}</div></div>`;
  const left=`<section class="ob-panel" aria-label="Работа за месяц"><div class="ob-ph"><h2>Работа за ${e(monthName(month))}</h2><span class="muted">в бухгалтерии ${inAcc} из ${accepted.length}</span></div>${tailHtml}
   ${ours.length?ours.map(claimItem).join(''):`<div class="ob-item"><span class="ob-dot n"></span><div class="ob-it"><b>Договора с заказчиком нет</b><span class="muted">Добавьте его во вкладке «Договоры».</span></div></div>`}
   ${c29Item}${closeItem}${others}</section>`;

  // Правая колонка: деньги, договоры с заказчиком, сроки.
  const a=projectAmounts(data.matrix,pid),prev=projectAmounts(data.prevMatrix,pid),d=deltaPercent(a.total,prev.total);
  const subsAll=subs.length,subsIn=subs.filter(s=>s.workflow).length,pre=subsIn<subsAll;
  const reports=(data.c3aReports||[]).filter(r=>r.project_id===pid&&r.is_current);
  const pay=reports.length?`<div class="ob-pay"><span>К оплате по С-3а</span><b>${money(reports.reduce((t,r)=>t+Number(r.to_pay),0))}</b></div>
   <div class="muted ob-small">СМР ${money(reports.reduce((t,r)=>t+Number(r.smr),0))} + оборудование ${money(reports.reduce((t,r)=>t+Number(r.equipment),0))} − зачёт авансов ${money(reports.reduce((t,r)=>t+Number(r.target_offset)+Number(r.current_offset),0))}</div>`:'';
  const money1=`<section class="ob-panel ob-box" aria-label="Деньги за месяц"><h3>${e(monthName(month))}, руб. <button class="link" data-action="nav" data-id="register">реестр →</button></h3>
   <div class="ob-big"><b>${money(a.total)}</b>${d===null?'':`<span class="ob-delta ${d>=0?'up':'dn'}" title="Прошлый месяц: ${money(prev.total)}">${d>=0?'▲':'▼'} ${Math.abs(d)}%</span>`}</div>
   <div class="ob-kv"><span class="muted">Своими силами</span><span class="${Number(a.own)<0?'neg':pre?'muted':''}" ${pre?'title="Предварительно: подали не все субподрядчики"':''}>${pre?'≈ ':''}${money(a.own)}</span></div>
   <div class="ob-kv"><span class="muted">Субподряд${subsAll?` <span class="ob-small">подали ${subsIn} из ${subsAll}</span>`:''}</span><span>${money(a.subcontract)}</span></div>${pay}</section>`;
  const termRow=c=>{const t=termPassed(c,today);return `<div class="ob-kv"><span><button class="link" data-action="contract" data-id="${e(c.id)}"><b>№ ${e(c.number)}</b></button> <span class="muted">${c.amount_addendum_number?'по ДС № '+e(c.amount_addendum_number):'по договору'}</span></span><span>${c.current_amount!==null&&c.current_amount!==undefined?money(c.current_amount):'—'}${c.current_end_date?' · до '+e(dm(c.current_end_date)):''}</span></div>
   ${t===null?'':`<div class="ob-kv ob-small"><span class="muted">${c.current_end_date<today?'срок истёк':''}</span><span class="${t>=90?'neg':'muted'}">прошло ${t} % срока</span></div><div class="ob-track" role="img" aria-label="Прошло ${t} процентов срока"><i style="left:${t}%"></i></div>`}`;};
  const ourAll=contracts.filter(oursContract);
  const contractsBox=`<section class="ob-panel ob-box" aria-label="Договоры с заказчиком"><h3>Договоры с заказчиком <button class="link" data-action="project-tab" data-id="contracts">все →</button></h3>${ourAll.length?ourAll.map(termRow).join(''):'<span class="muted">нет</span>'}</section>`;
  const soon=[...(c29w?[{t:`С-29 за ${monthName(month)}`,d:c29Deadline(month)}]:[]),...contracts.filter(c=>c.current_end_date&&c.current_end_date>=today).map(c=>({t:`${c.party||''} № ${c.number}: конец работ`,d:c.current_end_date})),
   ...docs.filter(x=>x.due_date&&x.step_code!=='accepted'&&x.due_date>=today).map(x=>({t:`${kindNames[x.kind]} № ${x.number}`,d:x.due_date}))].sort((x,y)=>x.d.localeCompare(y.d)).slice(0,5);
  const left2=x=>Math.round((new Date(x)-new Date(today))/DAY);
  const datesBox=`<section class="ob-panel ob-box" aria-label="Ближайшие сроки"><h3>Сроки</h3>${soon.length?`<ul class="ob-dates">${soon.map(s=>`<li><span>${e(s.t)}</span>${left2(s.d)<=30?st(`${dm(s.d)} · ${left2(s.d)} дн.`,'w'):`<span class="muted">${e(dm(s.d))}</span>`}</li>`).join('')}</ul>`:'<span class="muted">Ближайших сроков нет.</span>'}</section>`;
  return `<div class="ob-layout">${left}<aside class="ob-side">${money1}${contractsBox}${datesBox}</aside></div>`;
 }

 // ——— Договоры ———
 function contractsTab(){
  const inMonth=c=>{const w=ws.find(x=>x.contract_id===c.id&&x.template_code!=='c29'),x=w||exp.find(z=>z.contract_id===c.id&&z.template_code!=='c29');
   const skip=(data.skips||[]).find(s=>s.contract_id===c.id&&s.template_code!=='c29');
   return x?status(x):skip?st('Снят: '+(skip.reason||''),'n'):activeIn(c,month)?'':'<span class="muted">не действует</span>';};
  const draftOf=c=>(data.addenda||[]).filter(a=>a.contract_id===c.id&&a.status==='draft');
  const row=c=>{const t=termPassed(c,today),drafts=draftOf(c);
   return `<tr class="ob-row" data-action="contract" data-id="${e(c.id)}" tabindex="0" role="button"><td><b>№ ${e(c.number)}</b>${c.contract_date?` <span class="muted">от ${e(day(c.contract_date))}</span>`:''}</td>
    <td>${e(c.party||'')}<small>${e(ourRoleNames[c.our_role]||'')}</small></td>
    <td class="num">${c.current_amount!==null&&c.current_amount!==undefined?money(c.current_amount):'<span class="muted">—</span>'}<small>${c.amount_addendum_number?'по ДС № '+e(c.amount_addendum_number):'по договору'}${drafts.length?` · ДС № ${drafts.map(a=>e(a.number)).join(', ')} в работе`:''}</small></td>
    <td>${c.current_end_date?`${c.current_end_date<today?st('Истёк · '+day(c.current_end_date),'e'):e(day(c.current_end_date))}`:'<span class="muted">—</span>'}${c.term_addendum_number?`<small>по ДС № ${e(c.term_addendum_number)}</small>`:''}</td>
    <td>${t===null?'<span class="muted">—</span>':`<div class="ob-mini"><span class="${t>=90?'neg':'muted'}">прошло ${t} % срока</span><div class="ob-track"><i style="left:${t}%"></i></div></div>`}</td>
    <td>${inMonth(c)}</td></tr>`;};
  const groups=[['С заказчиком',contracts.filter(c=>c.direction==='outgoing')],['Субподряда',contracts.filter(c=>c.direction!=='outgoing')]].filter(([,l])=>l.length);
  return `<div class="ob-bar"><span class="muted">Стоимость и срок считаются по подписанным допсоглашениям. Строка открывает карточку договора.</span>${writer?btn('Добавить договор','new-contract','',true):''}</div>
   ${contracts.length?`<div class="table-wrap"><table class="ob-table"><thead><tr><th>Договор</th><th>Сторона</th><th class="num">Стоимость, руб.</th><th>Срок</th><th>Прошло срока</th><th>${e(monthName(month).replace(/^./,c=>c.toUpperCase()))}</th></tr></thead><tbody>
   ${groups.map(([label,list])=>`<tr class="ob-grp"><td colspan="6">${label}</td></tr>${list.map(row).join('')}`).join('')}</tbody></table></div>`:'<div class="empty">Добавьте договор с заказчиком, чтобы готовить процентовки.</div>'}`;
 }

 // ——— Документы ———
 function documentsTab(){
  const add=canEdit?btn('Новый акт','new-doc','',true)+btn('Справка С-3а','new-c3a')+btn('С-29','new-c29'):'';
  const groups=[...ws.map(w=>({title:`${KIND_LONG[w.template_code]||w.template_name} · ${w.template_code==='c29'?'':w.template_code==='sub_claim'?(w.party||'')+' · ':''}дог. № ${w.contract_number||''}`,w,list:docs.filter(d=>d.workflow_id===w.id)})),
   {title:'Без комплекта',list:docs.filter(d=>!d.workflow_id||!ws.some(w=>w.id===d.workflow_id))}].filter(g=>g.list.length);
  const row=d=>{const v=ver(d),acc=(data.versions||[]).find(x=>x.id===d.accepted_version);
   return `<tr class="ob-row" data-action="doc" data-id="${e(d.id)}" tabindex="0" role="button"><td><b>${e(kindNames[d.kind])} № ${e(d.number)}</b></td><td>в.${v?.version||1}${d.accepted_version&&d.current_version!==d.accepted_version?' <span class="muted">есть изменения</span>':''}</td>
    <td class="num">${d.kind==='c29'?'<span class="muted">—</span>':money(v?.amount)}</td><td class="num">${acc&&d.kind!=='c29'?money(acc.amount):''}</td><td>${d.step_label?st(d.step_label,d.step_code==='accepted'?'ok':'w'):st('Без комплекта','n')}</td><td>${d.due_date?e(day(d.due_date)):''}</td></tr>`;};
  return `<div class="ob-bar"><span class="muted">Документы за ${e(monthName(month))} по комплектам. Строка открывает карточку документа: версии и файлы.</span><div class="actions">${add}</div></div>
   ${groups.length?`<div class="table-wrap"><table class="ob-table"><thead><tr><th>Документ</th><th>Версия</th><th class="num">Рабочая версия, руб.</th><th class="num">Принято, руб.</th><th>Где</th><th>Срок</th></tr></thead><tbody>
   ${groups.map(g=>`<tr class="ob-grp"><td colspan="6">${e(g.title)}${g.w?` · ${e(g.w.step_label)}`:''}</td></tr>${g.list.map(row).join('')}`).join('')}</tbody></table></div>`:`<div class="empty">${per?'В этом месяце документы ещё не созданы.':'Отчётный месяц ещё не открыт.'}</div>`}`;
 }

 // ——— История ———
 function historyTab(){
  const KINDS=[['','Всё'],['workflow','Шаги'],['document','Документы'],['contract','Договоры'],['period','Месяц']];
  const kindOf=a=>/^workflow|process_transition/.test(a)?'workflow':/document|revise|attach|send|receive|sign$|accept/.test(a)?'document':/contract|addendum|allocate/.test(a)?'contract':/period|review|close|reopen|estimate/.test(a)?'period':'';
  const f=ui.historyKind||'';
  const list=(data.events||[]).filter(x=>x.project_id===pid&&(!f||kindOf(x.action)===f));
  const who=id=>(data.profiles||[]).find(p=>p.id===id)?.display_name||'';
  const when=x=>x?new Date(x).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Minsk'}):'';
  return `<div class="ob-bar"><div class="ob-chips">${KINDS.map(([k,l])=>`<button class="ob-chip ${f===k?'on':''}" data-action="history-kind" data-id="${k}">${l}</button>`).join('')}</div><span class="muted">Записи только добавляются. Последние события по доступным объектам.</span></div>
   ${list.length?`<div class="table-wrap"><table class="ob-table"><thead><tr><th>Когда</th><th>Что</th><th>Кто</th><th>Комментарий</th></tr></thead><tbody>${list.map(x=>`<tr><td>${e(when(x.created_at))}</td><td>${e(actionNames[x.action]||x.action)}</td><td>${e(who(x.actor))}</td><td class="muted">${e(x.detail?.reason||x.detail?.proof||x.detail?.note||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Событий пока нет.</div>'}`;
 }

 const body={month:monthTab,contracts:contractsTab,documents:documentsTab,history:historyTab}[tab]();
 return `<div class="ob">${headHtml}${body}</div>`;
}
