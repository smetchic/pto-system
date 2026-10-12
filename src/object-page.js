// Страница объекта: новый штатный рендер вкладки «Документы».
// Для остальных вкладок используется прежний рендер без постобработки DOM.
import {objectPage as coreObjectPage} from './object-page-core.js';
export * from './object-page-core.js';
import {escapeHtml as e,money,kindNames,canWrite} from './domain.js';
import {objectColor,activeIn,oursContract} from './conveyor.js';
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

 const cellMoney=v=>v===null||v===undefined||v===''?'<span class="muted">—</span>':money(v);
 const docName=d=>`${e(kindNames[d.kind]||'Документ')} № ${e(d.number)}${ver(d).version>1?` <span class="dt-v">в${ver(d).version}</span>`:''}`;
 const row=d=>{const r=d.kind==='c3a'?report(d):null,part=partOf(d),c3a=d.kind==='c3a';
  return `<tr class="ob-row ${c3a?'dt-c3a':'dt-act'}" data-action="doc" data-id="${e(d.id)}" tabindex="0" role="button"><td>${c3a?`<b>${docName(d)}</b>`:docName(d)}${!c3a&&part?` <span class="dt-part">· ${e(part)}</span>`:''}</td><td class="num">${c3a?cellMoney(r?.smr??ver(d).amount):cellMoney(ver(d).amount)}</td><td class="num">${c3a?cellMoney(Number(r?.equipment)||null):''}</td><td class="num">${c3a?cellMoney((Number(r?.target_offset)||0)+(Number(r?.current_offset)||0)||null):''}</td><td class="num">${c3a&&r?`<b>${money(r.to_pay)}</b>`:''}</td><td class="dt-scan">${scan(d)}</td></tr>`;};
 const createRow=(kind,contract,party='')=>`<tr class="${kind==='c3a'?'dt-c3a':'dt-act'} dt-create"><td colspan="6"><span>${kind==='c3a'?'Справка С-3а':'Акты С-2'}${party?` · ${e(party)}`:''}${contract?.number?` <span class="muted">· дог. № ${e(contract.number)}</span>`:''}</span>${canEdit?btn(kind==='c3a'?'+ Создать справку':'+ Создать акт',kind==='c3a'?'new-c3a':'new-doc',contract?.id||''):''}</td></tr>`;
 const groupRows=(contract,w,{sub=false}={})=>{const list=docs.filter(d=>(w&&d.workflow_id===w.id)||(!w&&d.contract_id===contract?.id));const c3a=list.filter(d=>d.kind==='c3a').sort(byNo),acts=list.filter(d=>d.kind==='c2a'||d.kind==='c2b').sort(byNo),rest=list.filter(d=>!['c3a','c2a','c2b','c29'].includes(d.kind)).sort(byNo);const party=sub?(w?.party||contract?.party||''):'';
  return `${c3a.length?c3a.map(d=>{const base=row(d);return sub?base.replace('</b>',`</b> <span class="dt-party">· ${e(party)}</span>${contract?.number?` <span class="dt-contract">· дог. № ${e(contract.number)}</span>`:''}`):base;}).join(''):createRow('c3a',contract,party)}${acts.map(row).join('')}${rest.map(row).join('')}${canEdit?createRow('act',contract,''):''}`;};

 const outgoing=contracts.filter(c=>c.direction==='outgoing'&&(activeIn(c,month)||ws.some(w=>w.contract_id===c.id&&w.template_code==='claim')));
 const incoming=contracts.filter(c=>c.direction==='incoming'&&(activeIn(c,month)||ws.some(w=>w.contract_id===c.id&&w.template_code==='sub_claim')));
 const claimed=new Set();
 const ourGroups=[];
 for(const c of outgoing){const w=ws.find(x=>x.template_code==='claim'&&x.contract_id===c.id);if(w)claimed.add(w.id);ourGroups.push({c,w});}
 for(const w of ws.filter(x=>x.template_code==='claim'&&!claimed.has(x.id))){ourGroups.push({c:contracts.find(c=>c.id===w.contract_id)||null,w});claimed.add(w.id);}
 const subGroups=[];
 for(const c of incoming){const w=ws.find(x=>x.template_code==='sub_claim'&&x.contract_id===c.id);if(w)claimed.add(w.id);subGroups.push({c,w});}
 for(const w of ws.filter(x=>x.template_code==='sub_claim'&&!claimed.has(x.id))){subGroups.push({c:contracts.find(c=>c.id===w.contract_id)||null,w});claimed.add(w.id);}
 const loose=docs.filter(d=>d.kind!=='c29'&&!claimed.has(d.workflow_id));

 const ourHtml=ourGroups.length?ourGroups.map(({c,w})=>`<tr class="ob-grp dt-ours-head"><td colspan="6"><span>Процентовка СУ-22 заказчику${c?.number?` · дог. № ${e(c.number)}`:''}</span>${statusOf(w)}</td></tr>${groupRows(c,w)}`).join(''):`<tr class="ob-grp dt-ours-head"><td colspan="6">Процентовка СУ-22 заказчику</td></tr>${createRow('c3a',outgoing[0]||null)}${createRow('act',outgoing[0]||null)}`;
 const subsHtml=subGroups.length?`<tr class="ob-grp dt-subs-head"><td colspan="6">Субподрядчики</td></tr>${subGroups.map(({c,w})=>groupRows(c,w,{sub:true})).join('')}`:'';
 const looseHtml=loose.length?`<tr class="ob-grp"><td colspan="6">Без комплекта</td></tr>${loose.sort(byNo).map(row).join('')}`:'';
 const importAction=canEdit?`${btn('Импорт Excel','excel-acts')}<input type="file" id="excel-acts" accept=".xlsx" multiple hidden>`:'';

 const body=`<div class="ob-bar dt-toolbar"><span class="muted">${e(monthName(month))} ${e(String(month).slice(0,4))} · справка С-3а выше актов</span><div class="actions">${importAction}</div></div>
  <div class="table-wrap"><table class="ob-table dt-table"><colgroup><col><col style="width:150px"><col style="width:140px"><col style="width:140px"><col style="width:150px"><col style="width:70px"></colgroup><thead><tr><th>Документ</th><th class="num">СМР с НДС</th><th class="num">Оборудование</th><th class="num">Зачёт авансов</th><th class="num">К оплате</th><th>Скан</th></tr></thead><tbody>${ourHtml}${subsHtml}${looseHtml}</tbody></table></div>`;
 return `<div class="ob">${head}${body}</div>`;
}

export function objectPage(args){
 if(args?.ui?.projectTab==='documents')return documentsPage(args);
 return coreObjectPage(args);
}
