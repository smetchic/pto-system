// Экран «Подписание» (docs/conveyor.md): общие колонки для всех маршрутов, карточка открывает боковую панель, кнопки шага на карточке нет.
// Шаг 1 — без изменений базы: шаги маршрутов из базы раскладываются по шести общим колонкам.
import {escapeHtml as e,money,actorRoles,canWrite} from './domain.js';

export const COLUMNS=[['wait','Ждём объёмы'],['acts','Готовятся акты'],['tn','У технадзора'],['check','На проверке'],['ok','Проверено'],['acc','В бухгалтерии']];
// Шаг маршрута в базе → общая колонка. Убранные по описанию шаги (скан, принято, закрыто) попадают в «В бухгалтерии».
const COLUMN_OF={
 claim:{prepared:'acts',site:'acts',supervision:'tn',customer:'check',signed:'ok',scan:'acc',accounting:'acc',accepted:'acc',closed:'acc'},
 sub_claim:{received:'check',review:'check',agreed:'ok',signed:'ok',accounting:'acc',accepted:'acc',closed:'acc'},
 c29:{formation:'acts',site:'acts',review:'check',checked:'ok',accounting:'acc',accepted:'acc',closed:'acc'}
};
export const columnOf=w=>COLUMN_OF[w.template_code]?.[w.step_code]||'acts';
export const KIND={claim:'Наша',sub_claim:'Субподряд',c29:'С-29'};
// Что делать дальше, словами (строка «Ваш ход» на карточке). Ключ — текущий шаг маршрута в базе.
const TURN={
 claim:{prepared:'передать прорабу',site:'передать технадзору',supervision:'отправить заказчику',customer:'отметить подписание заказчиком',signed:'приложить сканы',scan:'передать в бухгалтерию',accounting:'отметить приём бухгалтерией',accepted:'закрыть'},
 sub_claim:{received:'взять на проверку',review:'согласовать',agreed:'отметить подписание',signed:'передать в бухгалтерию',accounting:'отметить приём бухгалтерией',accepted:'закрыть'},
 c29:{formation:'передать прорабу',site:'взять на проверку',review:'отметить проверку',checked:'передать в бухгалтерию',accounting:'отметить приём бухгалтерией',accepted:'закрыть'}
};
export const turnOf=w=>TURN[w.template_code]?.[w.step_code]||'';
// Цвет объекта: назначается по порядку объектов; красный и оранжевый заняты тревогами.
export const OBJECT_COLORS=['#2e5bd8','#0e8a80','#7446c2','#3d8a2c','#a83e85','#56677d','#1f7fae','#8a6d1f','#5b4fc4','#2f7a5a'];
export const objectColor=(projects,id)=>{const i=projects.findIndex(p=>p.id===id);return OBJECT_COLORS[(i<0?0:i)%OBJECT_COLORS.length];};

const DAY=86400000;
const age=(w,now)=>{const t=w.last_event_at||w.updated_at||w.created_at;return t?Math.max(0,Math.floor((now-new Date(t).getTime())/DAY)):0;};
const returned=w=>['return','reset'].includes(w.last_event_kind);
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};

// «Ждём объёмы»: действующие в месяце договоры без комплекта и объекты без С-29. Вычисляется, в базе не хранится.
export function expectedCards({projects,contracts,workflows},month){
 const start=month+'-01',end=monthEnd(month),has=(t,key,id)=>workflows.some(w=>w.template_code===t&&w[key]===id);
 const active=c=>(!c.contract_date||c.contract_date<=end)&&(!c.current_end_date||c.current_end_date>=start);
 const ours=c=>c.direction==='outgoing'&&['contractor','subcontractor',undefined,null,''].includes(c.our_role);
 const subs=c=>c.direction==='incoming'&&['customer',undefined,null,''].includes(c.our_role);
 const out=[];
 for(const c of contracts.filter(active)){
  if(ours(c)&&!has('claim','contract_id',c.id))out.push({expected:true,template_code:'claim',project_id:c.project_id,contract_number:c.number,party:c.party,note:'прораб не сдал объёмы'});
  else if(subs(c)&&!has('sub_claim','contract_id',c.id))out.push({expected:true,template_code:'sub_claim',project_id:c.project_id,contract_number:c.number,party:c.party,note:'ждём процентовку'});
 }
 for(const p of projects)if(contracts.some(c=>c.project_id===p.id&&ours(c)&&active(c))&&!has('c29','project_id',p.id))
  out.push({expected:true,template_code:'c29',project_id:p.id,note:'ждём акты месяца'});
 return out;
}

export function conveyorPage({ui,data,profile,month,now=Date.now()}){
 const projects=data.projects||[],workflows=data.workflows||[],steps=data.steps||[];
 const engineer=pid=>{const ids=(data.memberships||[]).filter(m=>m.project_id===pid).map(m=>m.user_id);return (data.profiles||[]).find(p=>ids.includes(p.id)&&p.role==='engineer')?.display_name||'';};
 const projectName=pid=>projects.find(p=>p.id===pid)?.name||'';
 const canMove=w=>(actorRoles[w.actor]||[]).includes(profile?.role)&&canWrite(profile,data.memberships,w.project_id)&&data.periods?.find(p=>p.id===w.period_id)?.status!=='closed';
 const nextOf=w=>steps.filter(s=>s.template_code===w.template_code&&s.ordinal>w.step_ordinal).sort((a,b)=>a.ordinal-b.ordinal)[0];
 const kindOk=x=>!ui.flowKind||x.template_code===ui.flowKind;
 const all=[...workflows.map(w=>({...w,column:columnOf(w)})),...expectedCards({projects,contracts:data.contracts||[],workflows},month).map(x=>({...x,column:'wait'}))];
 const shown=all.filter(x=>kindOk(x)&&(!ui.flowProject||x.project_id===ui.flowProject));
 const problem=x=>!x.expected&&returned(x);

 const kit=w=>(data.documents||[]).filter(d=>d.workflow_id===w.id);
 const card=x=>{
  const color=objectColor(projects,x.project_id),name=x.project||projectName(x.project_id),who=engineer(x.project_id);
  const second=[x.template_code==='c29'?'':x.template_code==='sub_claim'?(x.party||''):`дог. № ${x.contract_number||''}`,who].filter(Boolean).join(', ');
  if(x.expected)return `<div class="cv-wrap"><article class="cv-card" style="--oc:${color}"><div class="cv-row1"><span class="cv-title">${e(name)}</span></div>
   <span class="cv-line"><span class="cv-kind">${KIND[x.template_code]}</span>${second?`, ${e(second)}`:''}</span><span class="cv-line">${e(x.note)}</span></article></div>`;
  const days=age(x,now),next=nextOf(x),mine=next&&canMove(x);
  const docs=kit(x),more=`<div class="cv-more" style="--oc:${color}">${docs.length?`<h4>Комплект</h4><ul>${docs.slice(0,4).map(d=>`<li>${e(({c2a:'С-2а',c2b:'С-2б',c3a:'С-3а',c29:'С-29'})[d.kind]||d.kind)} № ${e(d.number)}${d.id===x.attention_document_id?' <span class="cv-bad">замечание</span>':''}</li>`).join('')}${docs.length>4?`<li class="cv-mu">и ещё ${docs.length-4}</li>`:''}</ul>`:''}
   ${returned(x)&&x.last_note?`<h4>Замечание</h4><div class="cv-bad">${e(x.last_note)}</div>`:''}<h4>Шаг</h4><div class="cv-mu">${e(x.step_label)}, ${days?`${days} дн.`:'сегодня'}</div></div>`;
  return `<div class="cv-wrap"><article class="cv-card" style="--oc:${color}" data-action="workflow" data-id="${e(x.id)}" tabindex="0" role="button">
   <div class="cv-row1"><span class="cv-title">${e(name)}</span><span class="cv-days">${days?days+' дн.':'сегодня'}</span></div>
   <span class="cv-line"><span class="cv-kind">${KIND[x.template_code]}</span>${second?`, ${e(second)}`:''}</span>
   <span class="cv-line">${x.money&&Number(x.acts_amount)?`<b>${money(x.acts_amount)}</b> `:''}${e(x.step_label)}</span>
   ${returned(x)&&x.last_note?`<span class="cv-flag">${e(x.last_note)}</span>`:''}
   ${mine&&turnOf(x)?`<span class="cv-turn">Ваш ход: ${e(turnOf(x))}</span>`:''}
   ${problem(x)?'<span class="cv-corner" aria-hidden="true"></span>':''}</article>${more}</div>`;
 };
 const plural=n=>{const m=n%10,h=n%100;return n+' '+(m===1&&h!==11?'документ':m>=2&&m<=4&&(h<12||h>14)?'документа':'документов');};
 const column=([code,label],i)=>{
  const items=shown.filter(x=>x.column===code),sum=items.filter(x=>!x.expected&&x.money).reduce((t,x)=>t+Number(x.acts_amount||0),0);
  const body=code==='acc'?`<div class="cv-done"><b>${items.length}</b>передано за месяц</div>`:(items.map(card).join('')||'<div class="cv-empty">Пусто</div>');
  return `<section class="cv-stage"><div class="cv-head">${e(label)}</div><div class="cv-metric">${sum&&code!=='acc'?`<b>${money(sum)}</b> `:''}<span>${plural(items.length)}</span></div>
   <div class="cv-rail"><i class="${items.some(problem)?'bad':''}">${i+1}</i></div><div class="cv-lane">${body}</div></section>`;
 };
 const counts={};for(const x of all)if(kindOk(x)&&x.column!=='acc'){const c=counts[x.project_id]||(counts[x.project_id]={n:0,bad:false});c.n++;if(problem(x))c.bad=true;}
 const kinds=`<div class="cv-seg" role="group" aria-label="Что показывать">${[['','Все'],['claim','Наша'],['sub_claim','Субподряд'],['c29','С-29']].map(([k,l])=>`<button class="${(ui.flowKind||'')===k?'on':''}" data-action="flow-kind" data-id="${k}">${l}</button>`).join('')}</div>`;
 const chips=`<div class="cv-chips"><button class="cv-chip ${ui.flowProject?'':'on'}" data-action="flow-filter" data-id="">Все объекты</button>${projects.map(p=>`<button class="cv-chip ${ui.flowProject===p.id?'on':''}" data-action="flow-filter" data-id="${e(ui.flowProject===p.id?'':p.id)}" style="--oc:${objectColor(projects,p.id)}"><i class="cv-od"></i>${e(p.name)}<span class="cv-c">${counts[p.id]?.n||0}</span>${counts[p.id]?.bad?'<i class="cv-rd" aria-label="есть замечания"></i>':''}</button>`).join('')}</div>`;
 return `<div class="cv-top"><h1>Подписание</h1>${kinds}</div>${chips}<div class="cv-board">${COLUMNS.map(column).join('')}</div>
  <div class="cv-legend"><span>Полоска и цвет названия: объект.</span><span>Красный уголок: замечание.</span><span>«Ваш ход» видит тот, кто делает следующий шаг; шаг делается в карточке справа.</span></div>`;
}
