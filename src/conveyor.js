// Экран «Подписание» (docs/conveyor.md): общие колонки для всех маршрутов, карточка открывает боковую панель, кнопки шага на карточке нет.
// Шаги в базе называются одинаково во всех маршрутах (миграция 20261008220000): колонка = код шага.
import {escapeHtml as e,money,canWrite} from './domain.js';
import {engineerName} from './portfolio.js';

export const COLUMNS=[['wait','Ждём объёмы'],['acts','Готовятся акты'],['tn','У технадзора'],['check','На проверке'],['signed','Проверено'],['accepted','В бухгалтерии']];
export const columnOf=w=>COLUMNS.some(([c])=>c===w.step_code)?w.step_code:'acts';
export const KIND={claim:'СУ-22',sub_claim:'Субподряд',c29:'С-29'};
const KIND_ORDER={claim:0,sub_claim:1,c29:2};
// Действие перехода с шага: кнопка в панели и строка «Ваш ход» на карточке. mark — отметка факта («отметить «…»»).
export const MOVES={
 claim:{wait:{v:'Объёмы сданы',mark:true,past:'Объёмы сданы'},acts:{v:'Передать технадзору',past:'Передано технадзору'},tn:{v:'Отправить заказчику',past:'Отправлено заказчику'},
  check:{v:'Заказчик подписал',mark:true,past:'Заказчик подписал'},signed:{v:'Передать в бухгалтерию',past:'Передано в бухгалтерию'}},
 sub_claim:{wait:{v:'Подал технадзору',mark:true,past:'Подал технадзору'},tn:{v:'Технадзор подтвердил',mark:true,past:'Технадзор подтвердил'},
  check:{v:'Проверено',mark:true,past:'Проверено'},signed:{v:'Передать в бухгалтерию',past:'Передано в бухгалтерию'}},
 c29:{wait:{v:'Начать С-29',past:'С-29 начата'},acts:{v:'Передать прорабу',past:'Передано прорабу'},tn:{v:'Получено от прораба',mark:true,past:'Получено от прораба'},
  check:{v:'Проверено',mark:true,past:'Проверено'},signed:{v:'Передать в бухгалтерию',past:'Передано в бухгалтерию'}}
};
// Субподрядчик на проверке у ПТО: сначала «Комплект получен».
export const moveOf=w=>w.template_code==='sub_claim'&&w.step_code==='check'&&!w.received_on&&!w.expected?{v:'Комплект получен',mark:true,received:true}:MOVES[w.template_code]?.[w.step_code]||null;
export const sayMove=m=>m?(m.mark?`отметить «${m.v}»`:m.v[0].toLowerCase()+m.v.slice(1)):'';
export const turnOf=w=>sayMove(moveOf(w));
export const openNotes=w=>Array.isArray(w?.open_notes)?w.open_notes:[];
// Цвет объекта: выбранный в карточке объекта, иначе по порядку объектов; красный и оранжевый заняты тревогами (решение 11.10.2026).
export const OBJECT_COLORS=['#1f6feb','#0ea5e9','#0d9488','#16a34a','#65a30d','#d4a00b','#db2777','#c026d3','#9333ea','#4f46e5','#475569','#b45309'];
export const COLOR_NAMES={'#1f6feb':'синий','#0ea5e9':'голубой','#0d9488':'бирюзовый','#16a34a':'зелёный','#65a30d':'салатовый','#d4a00b':'жёлтый','#db2777':'розовый','#c026d3':'сиреневый','#9333ea':'фиолетовый','#4f46e5':'индиго','#475569':'графит','#b45309':'коричневый'};
export const objectColor=(projects,id)=>{const i=projects.findIndex(p=>p.id===id);return projects[i]?.color||OBJECT_COLORS[(i<0?0:i)%OBJECT_COLORS.length];};

const DAY=86400000;
export const daysOnStep=(w,now)=>{const t=w.step_since||w.updated_at||w.created_at;return t?Math.max(0,Math.floor((now-new Date(t).getTime())/DAY)):0;};
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
export const activeIn=(c,month)=>(!c.contract_date||c.contract_date<=monthEnd(month))&&(!c.current_end_date||c.current_end_date>=month+'-01');
// Справочные договоры (МПС с заказчиком, трёхсторонние) и непроверенные после загрузки в «Подписании» и месяце не участвуют.
const working=c=>!reference(c)&&c.checked!==false;
// Справочный договор: трёхсторонний (уровень 4) или договор уровня 1, где СУ-22 не сторона. До миграции уровней — по виду из файла.
export const reference=c=>c?.chain_level?c.chain_level===4||(c.chain_level===1&&!c.our_side):['mps_customer','mps_su22_sub'].includes(c?.contract_type);
// Договор субподряда СУ-22 (уровень 2 или 3, СУ-22 заказчик работ), без трёхсторонних и услуг.
export const subKind=c=>c.direction==='incoming'&&['customer',undefined,null,''].includes(c.our_role)&&!reference(c);
// Подаёт ли субподрядчик в этом месяце: отметка месяца (галочка на вкладке «Месяц»), иначе — действует по сроку и проверен.
export function subExpected(data,c,month){
 const per=(data.periods||[]).find(p=>p.project_id===c.project_id&&String(p.month||month).slice(0,7)===month);
 const m=per&&(data.subMonth||[]).find(x=>x.period_id===per.id&&x.contract_id===c.id);
 if(m&&m.expected!==null&&m.expected!==undefined)return m.expected;
 return activeIn(c,month)&&c.checked!==false;
}
export const oursContract=c=>c.direction==='outgoing'&&['contractor','subcontractor',undefined,null,''].includes(c.our_role)&&working(c);
export const subContract=c=>subKind(c)&&working(c);

// «Ждём объёмы»: действующие в месяце договоры без комплекта и объекты без С-29. Вычисляется; в базе только снятые ожидания (skips).
export function expectedCards(data,month){
 const {projects=[],contracts=[],workflows=[],skips=[]}=data;
 const has=(t,key,id)=>workflows.some(w=>w.template_code===t&&w[key]===id);
 const skipped=(t,cid)=>skips.some(s=>s.template_code===t&&s.contract_id===cid);
 const out=[];
 for(const c of contracts.filter(c=>activeIn(c,month)||(subKind(c)&&subExpected(data,c,month)))){
  if(oursContract(c)&&activeIn(c,month)&&!has('claim','contract_id',c.id)&&!skipped('claim',c.id))out.push({expected:true,template_code:'claim',step_code:'wait',project_id:c.project_id,contract_id:c.id,contract_number:c.number,party:c.party,note:'прораб не сдал объёмы'});
  else if(subKind(c)&&subExpected(data,c,month)&&!has('sub_claim','contract_id',c.id)&&!skipped('sub_claim',c.id))out.push({expected:true,template_code:'sub_claim',step_code:'wait',project_id:c.project_id,contract_id:c.id,contract_number:c.number,party:c.party,note:'ждём процентовку'});
 }
 for(const p of projects){
  const base=contracts.find(c=>c.project_id===p.id&&oursContract(c)&&activeIn(c,month));
  if(base&&!has('c29','project_id',p.id)&&!skips.some(s=>s.template_code==='c29'&&s.project_id===p.id))
   out.push({expected:true,template_code:'c29',step_code:'wait',project_id:p.id,contract_id:base.id,contract_number:base.number,note:'ждём акты месяца'});
 }
 return out.map(x=>({...x,key:`${x.template_code}:${x.contract_id}`}));
}

// Субподрядчики месяца для процентовки СУ-22: прошёл технадзор, исключён или ещё нет.
// По умолчанию — те, кто подаёт в этом месяце (галочка или действует по сроку и проверен); all — все договоры субподряда объекта.
export function subsOf(data,projectId,month,{all=false}={}){
 const ws=data.workflows||[],skips=data.skips||[],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Minsk'});
 const rows=(data.contracts||[]).filter(c=>c.project_id===projectId&&subKind(c)).map(c=>{
  const w=ws.find(x=>x.template_code==='sub_claim'&&x.contract_id===c.id),skip=skips.find(s=>s.template_code==='sub_claim'&&s.contract_id===c.id);
  return {contract:c,workflow:w,skip,passed:!!w&&w.step_ordinal>=3,expected:!!w||subExpected(data,c,month),
   expired:!!c.current_end_date&&c.current_end_date<(month+'-01'>today?month+'-01':today),unchecked:c.checked===false};
 });
 return all?rows:rows.filter(r=>r.expected);
}

export function canMoveCard(x,{profile,data}){
 if(!['head','engineer'].includes(profile?.role)||!canWrite(profile,data.memberships,x.project_id))return false;
 const per=(data.periods||[]).find(p=>p.project_id===x.project_id);
 return per?.status!=='closed'&&x.step_code!=='accepted';
}

export function conveyorPage({ui,data,profile,month,now=Date.now()}){
 const projects=data.projects||[],workflows=data.workflows||[];
 const engineer=pid=>engineerName(data,pid);
 const projectName=pid=>projects.find(p=>p.id===pid)?.name||'';
 const kindOk=x=>!ui.flowKind||x.template_code===ui.flowKind;
 const all=[...workflows.map(w=>({...w,column:columnOf(w)})),...expectedCards({...data,projects,workflows},month).map(x=>({...x,column:'wait'}))];
 const shown=all.filter(x=>kindOk(x)&&(!ui.flowProject||x.project_id===ui.flowProject));
 const problem=x=>openNotes(x).length>0;

 const kit=w=>(data.documents||[]).filter(d=>d.workflow_id===w.id);
 const card=x=>{
  const color=objectColor(projects,x.project_id),name=x.project||projectName(x.project_id),who=engineer(x.project_id);
  const second=[x.template_code==='c29'?'':x.template_code==='sub_claim'?(x.party||''):`дог. № ${x.contract_number||''}`,who].filter(Boolean).join(', ');
  const turn=canMoveCard(x,{profile,data})&&turnOf(x)?`<span class="cv-turn">Ваш ход: ${e(turnOf(x))}</span>`:'';
  const open=x.expected?`data-action="expected" data-id="${e(x.key)}"`:`data-action="workflow" data-id="${e(x.id)}"`;
  if(x.expected)return `<div class="cv-wrap"><article class="cv-card" style="--oc:${color}" ${open} tabindex="0" role="button"><div class="cv-row1"><span class="cv-title">${e(name)}</span></div>
   <span class="cv-line"><span class="cv-kind">${KIND[x.template_code]}</span>${second?`, ${e(second)}`:''}</span><span class="cv-line">${e(x.note)}</span>${turn}</article></div>`;
  const days=daysOnStep(x,now),notes=openNotes(x),flag=notes[notes.length-1];
  const docs=kit(x),more=`<div class="cv-more" style="--oc:${color}">${docs.length?`<h4>Комплект</h4><ul>${docs.slice(0,4).map(d=>`<li>${e(({c2a:'С-2а',c2b:'С-2б',c3a:'С-3а',c29:'С-29'})[d.kind]||d.kind)} № ${e(d.number)}${notes.some(n=>n.document_id===d.id)?' <span class="cv-bad">замечание</span>':''}</li>`).join('')}${docs.length>4?`<li class="cv-mu">и ещё ${docs.length-4}</li>`:''}</ul>`:''}
   ${notes.length?`<h4>Замечания</h4>${notes.map(n=>`<div class="cv-bad">${e(n.note)}</div>`).join('')}`:''}<h4>Шаг</h4><div class="cv-mu">${e(x.step_label)}, ${days?`${days} дн.`:'сегодня'}</div></div>`;
  return `<div class="cv-wrap"><article class="cv-card" style="--oc:${color}" ${open} tabindex="0" role="button">
   <div class="cv-row1"><span class="cv-title">${e(name)}</span><span class="cv-days">${days?days+' дн.':'сегодня'}</span></div>
   <span class="cv-line"><span class="cv-kind">${KIND[x.template_code]}</span>${second?`, ${e(second)}`:''}</span>
   <span class="cv-line">${x.money&&Number(x.acts_amount)?`<b>${money(x.acts_amount)}</b> `:''}${e(x.step_label)}</span>
   ${flag?`<span class="cv-flag">${e(flag.note)}${flag.round>1?`, ${flag.round}-й круг`:''}</span>`:''}${turn}
   ${problem(x)?'<span class="cv-corner" aria-hidden="true"></span>':''}</article>${more}</div>`;
 };
 const plural=n=>{const m=n%10,h=n%100;return n+' '+(m===1&&h!==11?'документ':m>=2&&m<=4&&(h<12||h>14)?'документа':'документов');};
 const column=([code,label],i)=>{
  // В колонке: сначала процентовки СУ-22, затем субподрядчики, затем С-29 (решение пользователя 10.10.2026); внутри вида порядок прежний.
  const items=shown.filter(x=>x.column===code).map((x,n)=>[x,n]).sort(([a,i],[b,j])=>(KIND_ORDER[a.template_code]??9)-(KIND_ORDER[b.template_code]??9)||i-j).map(([x])=>x),sum=items.filter(x=>!x.expected&&x.money).reduce((t,x)=>t+Number(x.acts_amount||0),0);
  const body=items.map(card).join('')||'<div class="cv-empty">Пусто</div>';
  return `<section class="cv-stage"><div class="cv-head">${e(label)}</div><div class="cv-metric">${sum?`<b>${money(sum)}</b> `:''}<span>${plural(items.length)}</span></div>
   <div class="cv-rail"><i class="${items.some(problem)?'bad':''}">${i+1}</i></div><div class="cv-lane">${body}</div></section>`;
 };
 const counts={};for(const x of all)if(kindOk(x)&&x.column!=='accepted'){const c=counts[x.project_id]||(counts[x.project_id]={n:0,bad:false});c.n++;if(problem(x))c.bad=true;}
 const kinds=`<div class="cv-seg" role="group" aria-label="Что показывать">${[['','Все'],['claim','СУ-22'],['sub_claim','Субподряд'],['c29','С-29']].map(([k,l])=>`<button class="${(ui.flowKind||'')===k?'on':''}" data-action="flow-kind" data-id="${k}">${l}</button>`).join('')}</div>`;
 // Объекты в одну строку: все серые, выбранный — заливкой своего цвета; без карточек — бледнее (решение 11.10.2026).
 const chips=`<div class="cv-chips" role="group" aria-label="Объекты"><button class="cv-chip ${ui.flowProject?'':'on all'}" data-action="flow-filter" data-id="" aria-pressed="${!ui.flowProject}">Все</button>${projects.map(p=>`<button class="cv-chip ${ui.flowProject===p.id?'on':''}${counts[p.id]?.n?'':' none'}" data-action="flow-filter" data-id="${e(ui.flowProject===p.id?'':p.id)}" style="--oc:${objectColor(projects,p.id)}" title="${e(p.name)}" aria-pressed="${ui.flowProject===p.id}"><span class="cv-n">${e(p.name)}</span><span class="cv-c">${counts[p.id]?.n||0}</span>${counts[p.id]?.bad?'<i class="cv-rd" aria-label="есть замечания"></i>':''}</button>`).join('')}</div>`;
 return `<div class="cv-top"><h1>Подписание</h1>${kinds}</div>${chips}<div class="cv-board">${COLUMNS.map(column).join('')}</div>
  <div class="cv-legend"><span>Полоска и цвет названия: объект.</span><span>Красный уголок: замечание.</span><span>«Ваш ход» видит тот, кто делает следующий шаг; шаг делается в карточке справа.</span></div>`;
}
