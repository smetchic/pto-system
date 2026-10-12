// Страница объекта: новый штатный рендер вкладки «Документы».
// Для остальных вкладок используется прежний рендер без постобработки DOM.
import {objectPage as coreObjectPage} from './object-page-core.js';
export * from './object-page-core.js';
import {escapeHtml as e,money,kindNames,canWrite} from './domain.js';
import {objectColor,activeIn,oursContract,subsOf} from './conveyor.js';
import {kitRows,kitTitle,kitStatus,KIT_COLS,KIT_HEAD} from './kit-rows.js';
import {engineerName} from './portfolio.js';

const MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const monthName=month=>MONTHS[Number(String(month).slice(5,7))-1]||'';
const btn=(text,action,id='',primary=false)=>`<button ${primary?'class="primary"':''} data-action="${action}" data-id="${e(id)}">${e(text)}</button>`;
const st=(text,cls='n')=>`<span class="ob-st ${cls}">${e(text||'')}</span>`;
const byNo=(a,b)=>String(a.number||'').localeCompare(String(b.number||''),'ru',{numeric:true});

function documentsPage({ui,data,profile}){
 const pid=ui.project,p=(data.projects||[]).find(x=>x.id===pid);
 if(!p)return '<div class="empty">Объект не найден.</div>';
 const month=ui.month,color=objectColor(data.projects,pid),eng=engineerName(data,pid);
 const per=(data.periods||[]).find(x=>x.project_id===pid),writer=canWrite(profile,data.memberships,pid),canEdit=writer&&per?.status==='open';
 const contracts=(data.contracts||[]).filter(c=>c.project_id===pid);
 const ws=(data.workflows||[]).filter(w=>w.project_id===pid);
 const docs=(data.documents||[]).filter(d=>d.project_id===pid&&(!per||d.period_id===per.id));
 const ver=d=>(data.versions||[]).find(v=>v.id===d.current_version)||{};
 const report=d=>(data.c3aReports||[]).find(r=>r.version_id===d.current_version||r.document_id===d.id&&r.is_current);
 const mark=d=>(data.docMarks||[]).find(x=>x.document_id===d.id)||{};
 const partOf=d=>{const m=mark(d);return m.part_id?(data.contractParts||[]).find(x=>x.id===m.part_id)?.name||m.part||'':m.part||'';};
 const scan=d=>(data.files||[]).some(f=>f.version_id===d.current_version)?'<span class="mo-ok" title="Скан загружен">✓</span>':'<span class="muted">—</span>';
 const statusOf=w=>w?st(w.step_label||'В работе',w.step_code==='accepted'?'ok':w.step_code==='signed'?'b':'w'):'';
 const periodState=!per?st('Месяц не открыт','n'):per.status==='closed'?st('Месяц закрыт','ok'):per.reviewed_revision===per.revision?st('Месяц проверен','b'):st('Месяц в работе','w');

 const head=`<div class="ob-head"><h1><i class="ob-color" style="background:${color}"></i><span title="${e(p.full_name||p.name)}">${e(p.name)}</span>${eng?`<small>${e(eng)}</small>`:''}</h1>
  <div class="ob-right"><span class="ob-month">${e(monthName(month))} ${e(String(month).slice(0,4))}</span>${periodState}</div></div>
  <div class="tabs" role="tablist" aria-label="Разделы объекта">${[['month','Месяц'],['contracts','Договоры'],['documents','Документы'],['history','История']].map(([id,label])=>`<button role="tab" aria-selected="${id==='documents'}" class="${id==='documents'?'on':''}" data-action="project-tab" data-id="${id}">${label}${id==='contracts'?`<span class="ob-cnt">${contracts.length}</span>`:id==='documents'?`<span class="ob-cnt">${docs.length}</span>`:''}</button>`).join('')}</div>`;

 // Комплекты (замечания 12.10.2026): справочные договоры МПС не показываются; субподрядчики — только отмеченные «подаёт»
 // в этом месяце или уже с документами; блоки и заголовки — как во вкладке «Месяц» (kit-rows.js).
 const kitOf=(c,w)=>docs.filter(d=>d.kind!=='c29'&&(w?d.workflow_id===w.id:d.contract_id===c?.id&&!d.workflow_id));
 const ours=contracts.filter(c=>oursContract(c)&&(activeIn(c,month)||ws.some(w=>w.contract_id===c.id&&w.template_code==='claim')));
 const ticked=id=>(data.subMonth||[]).some(x=>x.period_id===per?.id&&x.contract_id===id&&x.expected===true);
 const subs=subsOf(data,pid,month,{all:true}).filter(s=>s.workflow||ticked(s.contract.id)||docs.some(d=>d.contract_id===s.contract.id));
 const group=(c,w,sub)=>`<tr class="ob-grp kt-head${sub?' kt-sub':''}"><td colspan="7"><span class="kt-title">${e(kitTitle(w,c))}</span> ${kitStatus(w)}</td></tr>${kitRows({data,list:kitOf(c,w),contract:c,canEdit})}`;
 const ourHtml=ours.map(c=>group(c,ws.find(w=>w.template_code==='claim'&&w.contract_id===c.id),false)).join('');
 const filed=subs.filter(s=>s.workflow).length;
 const subsHtml=subs.length?`<tr class="ob-grp kt-section"><td colspan="7">Субподрядчики <span class="muted">· подали ${filed} из ${subs.length}</span></td></tr>${subs.map(s=>group(s.contract,s.workflow,true)).join('')}`:'';
 const shown=new Set([...ours.map(c=>c.id),...subs.map(s=>s.contract.id)]);
 const loose=docs.filter(d=>d.kind!=='c29'&&!shown.has(d.contract_id));
 const looseHtml=loose.length?`<tr class="ob-grp kt-section"><td colspan="7">Без комплекта</td></tr>${kitRows({data,list:loose,contract:null})}`:'';
 const body=`${canEdit?'<input type="file" id="excel-acts" accept=".xlsx" multiple hidden>':''}
  <div class="table-wrap"><table class="ob-table dt-table kt-table">${KIT_COLS}${KIT_HEAD}<tbody>${ourHtml}${subsHtml}${looseHtml}</tbody></table></div>`;
 return `<div class="ob">${head}${body}</div>`;
}

export function objectPage(args){
 if(args?.ui?.projectTab==='documents')return documentsPage(args);
 return coreObjectPage(args);
}
