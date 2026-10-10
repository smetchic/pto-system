// Страница объекта (docs/object.md, вкладка «Месяц» — docs/month.md): Месяц · Договоры · Документы · История. Чистая функция: данные из main.js, шаги делаются в боковой панели «Подписания».
import {escapeHtml as e,money,kindNames,actionNames,canWrite,ourRoleNames} from './domain.js';
import {COLUMNS,KIND,openNotes,objectColor,subsOf,canMoveCard,turnOf,daysOnStep,expectedCards,activeIn,oursContract} from './conveyor.js';
import {projectAmounts,c29Status,engineerName} from './portfolio.js';

export const OBJECT_TABS=[['month','Месяц'],['contracts','Договоры'],['documents','Документы'],['history','История']];
export const objectTab=t=>OBJECT_TABS.some(([id])=>id===t)?t:'month';
const day=x=>x?new Date(String(x).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Europe/Minsk'}):'';
const dm=x=>x?new Date(String(x).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',timeZone:'Europe/Minsk'}):'';
const st=(text,cls='n',title='')=>`<span class="ob-st ${cls}"${title?` title="${e(title)}"`:''}>${e(text)}</span>`;
const btn=(text,action,id='',primary=false)=>`<button ${primary?'class="primary"':''} data-action="${action}" data-id="${e(id)}">${e(text)}</button>`;
const KIND_LONG={claim:'Процентовка заказчику',sub_claim:'Процентовка субподрядчика',c29:'С-29'};
const monthName=month=>new Date(month+'-01T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',timeZone:'Europe/Minsk'});

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

 // ——— Месяц (docs/month.md): один экран на все шесть шагов, меняются только данные ———
 function monthTab(){
  const ours=contracts.filter(c=>oursContract(c)&&(activeIn(c,month)||ws.some(w=>w.contract_id===c.id)));
  const subs=subsOf(data,pid,month);
  const claims=ours.map(c=>({c,x:ws.find(w=>w.template_code==='claim'&&w.contract_id===c.id)||exp.find(z=>z.template_code==='claim'&&z.contract_id===c.id),skip:(data.skips||[]).find(s=>s.template_code==='claim'&&s.contract_id===c.id)}));
  const ixOf=x=>x?Math.max(0,COLUMNS.findIndex(([c])=>c===x.step_code)):0;
  const live=claims.filter(k=>k.x),ix=live.length?Math.min(...live.map(k=>ixOf(k.x))):0;
  const claimIds=new Set(live.filter(k=>!k.x.expected).map(k=>k.x.id));
  const kit=docs.filter(d=>claimIds.has(d.workflow_id));
  const acts=kit.filter(d=>d.kind==='c2a'||d.kind==='c2b').sort((a,b)=>String(a.number).localeCompare(String(b.number),'ru',{numeric:true}));
  const reports=(data.c3aReports||[]).filter(r=>r.project_id===pid&&r.is_current);
  const rs=f=>reports.reduce((t,r)=>t+Number(r[f]||0),0);
  const cells={};for(const r of (data.matrix?.rows||[]).filter(r=>r.kind==='contract'&&r.project_id===pid))for(const [k,v] of Object.entries(r.cells||{}))cells[k]=(cells[k]||0)+Number(v);
  // Отметки месяца (pto_sub_month_current и др.): «на заказчика» из отметки, иначе из сопоставления.
  const num=v=>v===null||v===undefined||v===''?null:Number(v);
  const smOf=id=>(data.subMonth||[]).find(x=>x.period_id===per?.id&&x.contract_id===id)||{};
  const dmOf=id=>(data.docMarks||[]).find(x=>x.document_id===id)||{};
  const mm=(data.monthMarks||[]).find(x=>x.period_id===per?.id)||{};
  const subRows=subs.map(s=>{const m=smOf(s.contract.id),D=s.workflow&&!s.skip&&Number(s.workflow.acts_amount)?Number(s.workflow.acts_amount):null,F=num(m.on_customer)??cells[s.contract.id]??null;
   return {...s,m,D,F,G:D!==null&&F!==null?F-D:null,plan:num(m.plan),eq:num(m.equipment),oral:m.tn_status==='oral'&&!(s.workflow?.step_ordinal>=4),off:m.expected===false&&!s.workflow};});
  const active=subRows.filter(s=>!s.skip&&!s.off),oral=active.filter(s=>s.oral),filed=active.filter(s=>s.D!==null),passed=active.filter(s=>s.passed);
  const amounts=projectAmounts(data.matrix,pid),T=reports.length?rs('smr'):Number(amounts.total);
  const D=filed.reduce((t,s)=>t+s.D,0),G=filed.reduce((t,s)=>t+(s.G||0),0),F=active.reduce((t,s)=>t+(s.F||0),0),own=T-D,work=own-G;
  const pre=filed.length<active.length;
  const SUMST=['оценка','предварительно','предварительно','предварительно','проверено','зафиксировано'];

  // 1. Полоса процентовки: шаг, шкала, «Ваш ход», что держит шаг.
  const stepsBar=x=>{const cur=ixOf(x),dates=x.step_dates||{};
   return `<div class="ob-steps" aria-label="Шаги маршрута">${COLUMNS.map(([c,l],i)=>`<span class="${i<cur?'d':i===cur?'c':''}">${e(l)}${i<cur&&dates[c]?' '+dm(dates[c]):''}</span>`).join('')}</div>`;};
  const blocked=x=>{if(x.expected||x.step_code!=='tn')return '';const why=[];
   const left=subs.filter(s=>!s.passed&&!s.skip).map(s=>s.contract.party||s.contract.number);if(left.length)why.push('не прошли технадзор: '+left.join(', '));
   if(!docs.some(d=>d.workflow_id===x.id&&d.kind==='c3a'))why.push('нет справки С-3а');
   return why.length?`<span class="ob-why">Отправить заказчику нельзя: ${e(why.join('; '))}.</span>`:'';};
  const stepCard=({c,x,skip})=>{
   if(!x)return skip?`<section class="ob-panel mo-step"><div><div class="mo-cap">Процентовка за ${e(monthName(month))}</div><b>Снята</b></div><div class="mo-turn"><span class="muted">дог. № ${e(c.number)} · ${e(c.party||'')} · ${e(skip.reason||'без причины')}</span></div></section>`:'';
   const n=openNotes(x),flag=n.length?`<span class="ob-flag" title="${e(n[n.length-1].note)}">⚑ ${e(n[n.length-1].note)}</span>`:'';
   const counts=x.expected?'':`<span class="muted">актов ${kit.filter(d=>d.workflow_id===x.id&&d.kind!=='c3a'&&d.kind!=='c29').length} · субподряд: прошли ТН ${passed.length} из ${active.length}</span>`;
   return `<section class="ob-panel mo-step ob-click" ${open(x)} tabindex="0" role="button" aria-label="Процентовка по договору № ${e(c.number)}">
    <div><div class="mo-cap">Процентовка за ${e(monthName(month))}${ours.length>1?` · дог. № ${e(c.number)}`:''}</div><b class="mo-now">${e(COLUMNS[ixOf(x)][1])}</b></div>
    <div class="mo-right">${stepsBar(x)}<div class="mo-turn">${turn(x)}${counts}${blocked(x)}${flag}</div></div></section>`;};
  const stepHtml=ours.length?claims.map(stepCard).join(''):`<section class="ob-panel mo-step"><div><div class="mo-cap">Процентовка за ${e(monthName(month))}</div><b>Договора с заказчиком нет</b></div><div class="mo-turn"><span class="muted">Добавьте его во вкладке «Договоры».</span></div></section>`;

  // 2. Деньги: С-3а из четырёх сумм, сверка, «Из чего СМР».
  const cell=(cap,v,small,dim)=>`<div><div class="mo-cap">${cap}</div><div class="mo-big${dim?' muted':''}">${v}</div><small>${small}</small></div>`;
  const actsSum=acts.reduce((t,d)=>t+Number(ver(d)?.amount||0),0),mats=acts.reduce((t,d)=>t+(num(dmOf(d.id).materials)||0),0);
  const chk=reports.length?[
   [`Сумма актов = СМР в справке С-3а`,Math.abs(actsSum-rs('smr'))<0.005?'ok':'er'],
   [`СМР + оборудование − авансы = к оплате`,Math.abs(rs('smr')+rs('equipment')-rs('target_offset')-rs('current_offset')-rs('to_pay'))<0.005?'ok':'er'],
   [`«На заказчика» введено у ${active.filter(s=>s.F!==null).length} из ${active.length} субподрядчиков`,active.every(s=>s.F!==null)?'ok':'w'],
   ...(oral.length?[[`ТН устно: ${oral.map(s=>s.contract.party||s.contract.number).join(', ')} · суммы предварительные`,'w']]:[]),
   ...(passed.length<active.length?[[`Технадзор прошли ${passed.length} из ${active.length} субподрядчиков · суммы предварительные`,'w']]:[])]:[];
  const bad=chk.filter(i=>i[1]==='er').length,warn=chk.filter(i=>i[1]==='w').length;
  const chkLine=reports.length?`<details class="mo-chk"><summary class="${bad?'neg':warn?'mo-w':'mo-ok'}">Сверка сумм: ${bad?`✗ не сходится ${bad}`:warn?'✓ сходится, есть предварительные':'✓ всё сходится'}</summary><ul>${chk.map(i=>`<li class="${i[1]==='ok'?'mo-ok':i[1]==='w'?'mo-w':'neg'}">${i[1]==='ok'?'✓':i[1]==='w'?'!':'✗'} ${e(i[0])}</li>`).join('')}</ul></details>`:'сверка сумм появится с С-3а';
  const strip=reports.length
   ?cell(`Выполнено СМР · ${SUMST[ix]}`,money(rs('smr')),`${mats?`в т.ч. материалы заказчика ${money(mats)} · `:''}${acts.length} ${acts.length===1?'акт':acts.length>=2&&acts.length<=4?'акта':'актов'}`)+cell('+ оборудование',money(rs('equipment')),'по справке С-3а')+cell('− зачёт авансов',money(rs('target_offset')+rs('current_offset')),`целевой ${money(rs('target_offset'))} · текущий ${money(rs('current_offset'))}`)+'<div class="mo-sep"></div>'+cell('= к оплате по С-3а',money(rs('to_pay')),chkLine)
   :cell(T?`СМР · ${SUMST[ix]}`:'СМР за месяц',T?money(T):'—',T?'по актам месяца':'актов ещё нет',!T)+cell('+ оборудование','—','появится с С-3а на шаге «На проверке»',true)+cell('− зачёт авансов','—','появится с С-3а',true)+'<div class="mo-sep"></div>'+cell('= к оплате по С-3а','—',chkLine,true);
  const pos=[Math.max(0,work),Math.max(0,G),Math.max(0,D)],sumPos=pos.reduce((a,b)=>a+b,0)||1,[pw,pg,ps]=pos.map(v=>v/sumPos*100);
  const info=T?`<div class="mo-lab"><b>Из чего СМР</b><small>${pre?'предварительно':'две разбивки одной суммы'}</small></div><div class="mo-viz">
   <div class="mo-lt"><b>Своими силами</b> <b class="${own<0?'neg':''}">${money(own)}</b> <span class="muted">· ${Math.round(own/T*100)} %${pre?` · предварительно: подали ${filed.length} из ${active.length}`:''}${own<0?' · отрицательные, проверьте':''}</span></div><div class="mo-br t" style="width:${pw+pg}%"></div>
   <div class="mo-bar"><i class="w" style="width:${pw}%">свои работы ${money(work)}</i>${pg?`<i class="g" style="width:${pg}%">генуслуги</i>`:''}${ps?`<i class="s" style="width:${ps}%">субподряд, их цены ${money(D)}</i>`:''}</div>
   <div class="mo-br b" style="margin-left:${pw}%;width:${pg+ps}%"></div>
   <div class="mo-rowb"><span class="muted">${filed.some(s=>s.F!==null)?`генуслуги <b class="${G<0?'neg':''}">${money(G)}</b>`:'генуслуги появятся с «на заказчика»'}</span><span class="mo-lt"><b>Субподряд в ценах заказчика</b> <b>${F?money(F):'—'}</b> <span class="muted">· подали ${filed.length} из ${active.length}</span></span></div></div>`
   :`<div class="mo-lab"><b>Из чего СМР</b></div><div class="muted">Сумм за ${e(monthName(month))} ещё нет: появятся с актами.</div>`;
  const moneyHtml=`<section class="ob-panel mo-money" aria-label="Деньги месяца"><div class="mo-strip">${strip}</div><div class="mo-info">${info}</div></section>`;

  // 3–4. Документы заказчику и субподрядчики: общая сетка колонок.
  const cols='<colgroup><col><col style="width:150px"><col style="width:150px"><col style="width:130px"><col style="width:150px"><col style="width:250px"></colgroup>';
  const needC3a=live.some(k=>!k.x.expected&&['acts','tn','check'].includes(k.x.step_code))&&!kit.some(d=>d.kind==='c3a');
  const TN={prep:['готовится','n'],tn:['у ТН','w'],remarks:['замечания ТН','e'],ok:['ТН подписал','ok']},ORIG={party:'оригинал у заказчика',ours:'оригинал у нас',accounting:'оригинал в бухгалтерии'};
  const docState=d=>{const m=dmOf(d.id),early=['wait','acts','tn'].includes(d.step_code);
   const base=early&&m.tn_status?st(TN[m.tn_status][0],TN[m.tn_status][1],m.note||''):d.step_label?st(d.step_label,d.step_code==='accepted'?'ok':'w'):st('Без комплекта','n');
   return base+(m.original?` <span class="muted">· ${ORIG[m.original]}</span>`:'');};
  const docRow=d=>{const v=ver(d),c3a=d.kind==='c3a',m=dmOf(d.id);
   return `<tr class="ob-row${c3a?' mo-tot':''}" data-action="doc" data-id="${e(d.id)}" tabindex="0" role="button"><td><span class="link">${e(kindNames[d.kind])} № ${e(d.number)}</span>${v?.version>1?` <span class="muted">в.${v.version}</span>`:''}${m.part?` · ${e(m.part)}`:''}${num(m.materials)?` <span class="muted">· в т.ч. материалы заказчика ${money(m.materials)}</span>`:''}</td>
    <td class="num">${c3a?(reports.length?money(rs('smr')):money(v?.amount)):money(v?.amount)}</td><td></td><td></td><td class="num">${c3a&&reports.length?money(rs('equipment')):'<span class="muted">—</span>'}</td><td>${docState(d)}</td></tr>`;};
  // Оценка выполнения = план месяца (шаг 1): одна сумма до актов, в реестре отдельно.
  const est=(data.matrix?.rows||[]).filter(r=>r.kind==='contract'&&r.project_id===pid&&r.estimate!==null&&r.estimate!==undefined);
  const estSum=est.reduce((t,r)=>t+Number(r.estimate),0);
  const estRow=est.length||(canEdit&&ix<=1&&!acts.length)?`<tr class="ob-row${est.length?'':' mo-off'}" ${canEdit?'data-action="estimate" data-id="" tabindex="0" role="button"':''}><td>Оценка выполнения <span class="muted">план до актов, в реестре отдельно</span></td>
    <td class="num">${est.length?money(estSum):'<span class="muted">—</span>'}</td><td></td><td></td><td></td><td>${est.length?st('оценка','n'):canEdit?'<span class="link">ввести</span>':''}</td></tr>`:'';
  const docsHtml=`<section class="ob-panel" aria-label="Документы заказчику"><div class="ob-ph"><h2>Документы заказчику</h2><span class="muted">${acts.length?`${acts.length} ${acts.length===1?'акт':acts.length>=2&&acts.length<=4?'акта':'актов'} · сумма ${money(actsSum)}`:''}</span>${canEdit?`<span class="mo-marks">В месяце будет: <button class="mo-cb" role="checkbox" aria-checked="${!!mm.equipment_expected}" data-action="month-mark" data-id="equipment">оборудование</button><button class="mo-cb" role="checkbox" aria-checked="${!!mm.materials_expected}" data-action="month-mark" data-id="materials">материалы заказчика</button></span>`:''}${canEdit?`<span class="mo-add">${btn('Новый акт','new-doc')}${btn('Справка С-3а','new-c3a')}</span>`:''}</div>
   <div class="table-wrap"><table class="ob-table mo-grid">${cols}<thead><tr><th>Документ</th><th class="num">СМР</th><th></th><th></th><th class="num">Оборудование</th><th>Статус</th></tr></thead><tbody>
   ${estRow}${acts.map(docRow).join('')}${kit.filter(d=>d.kind==='c3a').map(docRow).join('')}
   ${mm.equipment_expected&&!(reports.length&&rs('equipment'))?`<tr class="mo-off"><td>Ведомости оборудования</td><td></td><td></td><td></td><td></td><td>ожидается</td></tr>`:''}
   ${mm.materials_expected&&!mats?`<tr class="mo-off"><td>Ведомость материалов заказчика</td><td></td><td></td><td></td><td></td><td>ожидается · для экономиста</td></tr>`:''}
   ${needC3a?`<tr class="mo-off"><td>Справка С-3а</td><td></td><td></td><td></td><td></td><td>нужна для отправки заказчику</td></tr>`:''}
   ${!acts.length&&!needC3a?`<tr class="mo-off"><td colspan="6">${per?'Акты месяца появятся на шаге «Готовятся акты».':'Отчётный месяц ещё не открыт.'}</td></tr>`:''}</tbody></table></div></section>`;
  const subState=s=>{const w=s.workflow,n=openNotes(w);
   if(s.skip)return st('Исключён','n',s.skip.reason||'');if(s.off)return '<span class="muted">не подаёт</span>';if(!w)return st('Ждём процентовку','n');
   if(s.oral&&s.workflow)return st('ТН устно · '+w.step_label,'w');
   if(s.passed)return st(w.step_code==='accepted'?'В бухгалтерии':'ТН ✓ · '+w.step_label,'ok');return st(w.step_label+days(w),n.length?'e':'w',n.length?n[n.length-1].note:'');};
  const subOpen=s=>canEdit&&per?`data-action="sub-month" data-id="${e(s.contract.id)}"`:s.workflow?`data-action="workflow" data-id="${e(s.workflow.id)}"`:(exp.find(z=>z.template_code==='sub_claim'&&z.contract_id===s.contract.id)?`data-action="expected" data-id="${e('sub_claim:'+s.contract.id)}"`:`data-action="contract" data-id="${e(s.contract.id)}"`);
  const dash='<span class="muted">—</span>',eqSum=active.reduce((t,s)=>t+(s.eq||0),0);
  const subsHtml=`<section class="ob-panel" aria-label="Субподрядчики"><div class="ob-ph"><h2>Субподрядчики</h2><span class="muted">подали ${filed.length} из ${active.length} · прошли ТН ${passed.length}</span>${canEdit&&subs.length?`<span class="mo-add">${btn('Сопоставить «на заказчика»','allocate')}</span>`:''}</div>
   ${subs.length?`<div class="table-wrap"><table class="ob-table mo-grid">${cols}<thead><tr><th>Субподрядчик</th><th class="num">СМР, их цены</th><th class="num">На заказчика</th><th class="num">Генуслуги</th><th class="num">Оборудование</th><th>Статус</th></tr></thead><tbody>
   ${subRows.slice().sort((a,b)=>(a.skip||a.off)-(b.skip||b.off)).map(s=>`<tr class="ob-row${s.skip||s.off?' mo-off':''}" ${subOpen(s)} tabindex="0" role="button"><td>${e(s.contract.party||'')} <span class="muted">№ ${e(s.contract.number)}</span></td>
    <td class="num">${s.D!==null?money(s.D):s.plan!==null&&!s.off?`<span class="muted" title="план, уточнится по их акту">${money(s.plan)}</span>`:dash}</td><td class="num">${s.F===null||s.off?dash:`<span class="${s.oral?'mo-w':''}">${money(s.F)}</span>`}</td><td class="num">${s.G===null?dash:`<span class="${s.G<0?'neg':''}">${money(s.G)}</span>`}</td><td class="num">${s.eq===null?dash:money(s.eq)}</td><td>${subState(s)}</td></tr>`).join('')}
   <tr class="mo-tot"><td>Итого</td><td class="num">${money(D)}</td><td class="num">${F?money(F):dash}</td><td class="num">${filed.some(s=>s.G!==null)?money(G):dash}</td><td class="num">${eqSum?money(eqSum):dash}</td><td></td></tr></tbody></table></div>`
   :'<div class="empty">Договоров субподряда на этот месяц нет.</div>'}</section>`;

  // 5. С-29 и закрытие месяца — по одной строке.
  const c29w=ws.find(w=>w.template_code==='c29')||exp.find(z=>z.template_code==='c29');
  const c29s=c29Status(data.workflows||[],pid,month,today,now);
  const c29Html=c29w?`<section class="ob-panel"><div class="ob-item ob-click" ${open(c29w)} tabindex="0" role="button"><span class="ob-dot ${c29s.done?'ok':c29s.cls==='e'||c29s.cls==='o'?'e':c29w.expected?'n':'w'}"></span>
   <div class="ob-it"><b>С-29 за ${e(monthName(month))}</b>${st(c29s.text,c29s.cls==='o'?'e':c29s.cls,c29s.title||'')}<span class="muted">отдельно от процентовки · срок ${e(dm(c29s.deadline))}</span>${turn(c29w)}</div><div class="ob-act"></div></div></section>`:'';
  const cond=closeConditions(data,pid,month),allOk=cond.every(c=>c.ok);
  const closeBtns=head&&per?(per.status==='open'?btn('Проверить месяц','review')+btn('Закрыть месяц','close','',allOk):btn('Открыть повторно','reopen')):'';
  const closeHtml=`<section class="ob-panel"><div class="ob-item"><span class="ob-dot ${per?.status==='closed'?'ok':'n'}"></span><div class="ob-it"><b>Закрытие месяца</b>${per?.status==='closed'?st('Закрыт, снимок сохранён','ok'):st(allOk?'можно закрыть':'ждёт','n')}<ul class="ob-cond">${cond.map(c=>`<li class="${c.ok?'ok':''}">${c.ok?'✓':'—'} ${e(c.text)}</li>`).join('')}</ul>${head?'':'<span class="muted">Проверяет и закрывает начальник ПТО.</span>'}</div><div class="ob-act">${closeBtns}</div></div></section>`;
  return `<div class="mo">${stepHtml}${moneyHtml}${docsHtml}${subsHtml}${c29Html}${closeHtml}</div>`;
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
