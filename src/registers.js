// Раздел «Реестры» (решение 11.10.2026): «Общий (С-15)» · «По генуслугам» · «Проверка и закрытие месяца».
// Суммы месяца считает база (pto_register_matrix, справки С-3а, отметки субподрядчиков); здесь только раскладка и итоги строк.
import {escapeHtml as e,money,matrixOf} from './domain.js';
import {objectColor,subsOf} from './conveyor.js';
import {subsFiled} from './portfolio.js';

const negHint='Собственные силы отрицательны: субподряд больше выполнения по договору';
const num=v=>v===null||v===undefined||v===''?null:Number(v);
const cell=(v,cls='num')=>`<td class="${cls}">${v===null||v===undefined||(typeof v==='number'&&Math.abs(v)<0.005)?'':money(v)}</td>`;
const negCell=(v,pre=false)=>`<td class="num${Number(v)<0?' neg':''}"${Number(v)<0?` title="${negHint}"`:''}>${money(v)}${pre?' <small class="rg-pre" title="Подали не все субподрядчики: собственные силы завышены">предв.</small>':''}</td>`;
export const REGISTER_VIEWS=[['c15','Общий (С-15)'],['gen','По генуслугам'],['close','Проверка и закрытие месяца']];

// Общий реестр С-15: договоры СУ-22 по объектам, части договора, «Итого по договору», итоги объектов и общий итог.
// Договоры и колонки без данных за месяц скрыты сами (база не возвращает пустые).
export function c15Table(data,month){
 const m=matrixOf(data.matrix);
 const pre=pid=>{const x=subsFiled(data,[pid],month);return x.filed<x.active;};
 const partVat=r=>r.vat_rate===null||r.vat_rate===undefined?'':Number(r.vat_rate)===0?' · без НДС':` · НДС ${Number(r.vat_rate)} %`;
 const subs=r=>m.columns.map(c=>cell(num(r.cells?.[c.id]))).join('');
 // Оперативная оценка (предварительно) — отдельная колонка, только если она внесена; в «Всего» не входит.
 const has=v=>v!==null&&v!==undefined;
 const hasEst=m.rows.some(r=>has(r.estimate));
 const est=r=>hasEst?`<td class="num muted">${has(r.estimate)?money(r.estimate):''}</td>`:'';
 const basis={acts:' · по актам, С-3а не принята',c3a:' · по С-3а'};
 const row=r=>r.kind==='part'?`<tr class="part"><td><small>дог. № ${e(r.number)} · ${e(r.part)}${partVat(r)}</small></td>${cell(num(r.total))}${hasEst?'<td></td>':''}<td></td><td></td>${m.columns.map(()=>'<td></td>').join('')}</tr>`
  :r.kind==='project'?`<tr class="rg-obj"><td>Итого по объекту</td>${cell(num(r.total))}${est(r)}${negCell(r.own,pre(r.project_id))}${cell(num(r.subcontract))}${subs(r)}</tr>`
  :`<tr><td><i class="ct-dot" style="background:${objectColor(data.projects||[],r.project_id)}"></i><button class="link" data-action="project" data-id="${e(r.project_id)}">${e(r.project)}</button><small>дог. № ${e(r.number)}${r.has_parts?' · Итого по договору':''}${basis[r.basis]||''}</small></td>${cell(num(r.total))}${est(r)}${negCell(r.own,pre(r.project_id))}${cell(num(r.subcontract))}${subs(r)}</tr>`;
 // Части договора идут под своим договором: база отдаёт их после строки договора.
 return {m,html:`<div class="table-wrap rg-wrap"><table class="rg-table"><thead><tr><th>Объект / договор</th><th class="num">Генподряд всего, с НДС</th>${hasEst?'<th class="num" title="Оперативная оценка до подписания, в итог не входит">Оценка, предв.</th>':''}<th class="num">Собственные силы</th><th class="num">Субподряд всего</th>${m.columns.map(c=>`<th class="num rg-sub">${e(c.label)}</th>`).join('')}</tr></thead>
 <tbody>${m.rows.map(row).join('')}${m.rows.length?`<tr class="total"><td>Всего</td>${cell(num(m.total.total))}${est(m.total)}${negCell(m.total.own)}${cell(num(m.total.subcontract))}${m.columns.map(c=>cell(num(m.total.cells?.[c.id]))).join('')}</tr>`:''}</tbody></table></div>`};
}

export function genRows(data,pid,month,cum=null){
 const per=(data.periods||[]).find(p=>p.project_id===pid);
 const reports=(data.c3aReports||[]).filter(r=>r.project_id===pid&&r.is_current);
 const rs=(f,prefix='')=>reports.reduce((t,r)=>t+Number(r[(prefix?prefix+'_':'')+f]||0),0);
 const mrows=(data.matrix?.rows||[]).filter(r=>r.kind==='contract'&&r.project_id===pid);
 const cellsOf=key=>{const o={};for(const r of mrows)for(const [k,v] of Object.entries(r[key]||{}))o[k]=(o[k]||0)+Number(v);return o;};
 const D=cellsOf('cells'),F=cellsOf('customer_cells');
 const sm=id=>(data.subMonth||[]).find(x=>x.period_id===per?.id&&x.contract_id===id)||{};
 const T=reports.length?rs('smr'):mrows.reduce((t,r)=>t+Number(r.total||0),0);
 const our={label:'Всего по генподряду',month:{D:T,F:T,H:null,eq:reports.length?rs('equipment'):null,off:reports.length?rs('target_offset')+rs('current_offset'):null,pay:reports.length?rs('to_pay'):null},
  total:reports.length?{D:rs('smr','total'),F:rs('smr','total'),H:null,eq:rs('equipment','total'),off:rs('target_offset','total')+rs('current_offset','total'),pay:rs('to_pay','total')}:cum?.our||null};
 const subs=subsOf(data,pid,month,{all:true}).filter(s=>s.expected||D[s.contract.id]||cum?.subs?.[s.contract.id]).map(s=>{
  const m=sm(s.contract.id),d=D[s.contract.id]??(s.workflow&&!s.skip&&Number(s.workflow.acts_amount)?Number(s.workflow.acts_amount):null);
  const f=num(m.on_customer)??F[s.contract.id]??null,eq=num(m.equipment),off=(num(m.target_offset)||0)+(num(m.current_offset)||0);
  const c=cum?.subs?.[s.contract.id];
  return {label:s.contract.party||s.contract.number,number:s.contract.number,id:s.contract.id,filed:d!==null,
   month:{D:d,F:f,H:d!==null&&f!==null?f-d:null,eq,off:off||null,pay:d!==null?d+(eq||0)-off:null},
   total:c?{D:c.D,F:c.F,H:c.F-c.D,eq:c.eq,off:c.off||null,pay:c.D+c.eq-c.off}:null};
 });
 const sum=(k,part)=>subs.reduce((t,s)=>t+(s[part]?.[k]||0),0);
 const itog={label:'Итого субподряд',month:{D:sum('D','month'),F:sum('F','month'),H:sum('H','month'),eq:sum('eq','month'),off:sum('off','month'),pay:sum('pay','month')},
  total:subs.every(s=>s.total)&&cum?{D:sum('D','total'),F:sum('F','total'),H:sum('H','total'),eq:sum('eq','total'),off:sum('off','total'),pay:sum('pay','total')}:null};
 const own={label:'Собственные силы',month:{D:T-itog.month.D,F:T-itog.month.F},total:our.total&&itog.total?{D:our.total.D-itog.total.D,F:our.total.F-itog.total.F}:null};
 return {our,subs,itog,own,pre:subs.some(s=>!s.filed)};
}

export function genTable(data,pid,month,cum=null){
 const g=genRows(data,pid,month,cum);
 const cols=[['D','СМР, их цены (D)'],['F','На заказчика, цены СУ-22 (F)'],['H','Генуслуги H = F − D'],['eq','Оборудование'],['off','Зачёт авансов'],['pay','К оплате']];
 const vals=(x,part)=>cols.map(([k])=>{const v=x[part]?.[k];return k==='H'&&v!==null&&v!==undefined?`<td class="num${v<0?' neg':''}">${money(v)}</td>`:cell(v??null);}).join('');
 const line=(x,cls='')=>`<tr class="${cls}"><td>${e(x.label)}${x.number?` <span class="muted">№ ${e(x.number)}</span>`:''}${x.filed===false?' <small class="muted">не подал</small>':''}</td>${vals(x,'month')}${vals(x,'total')}</tr>`;
 const ownLine=`<tr class="rg-own"><td>Собственные силы${g.pre?' <small class="rg-pre">предв.</small>':''}<small>по D · по F</small></td>${negCell(g.own.month.D)}${negCell(g.own.month.F)}<td colspan="4"></td>${g.own.total?negCell(g.own.total.D)+negCell(g.own.total.F):'<td></td><td></td>'}<td colspan="4"></td></tr>`;
 return `<div class="table-wrap rg-wrap"><table class="rg-table rg-gen"><thead><tr><th rowspan="2"></th><th colspan="6" class="rg-c">За месяц</th><th colspan="6" class="rg-c">С начала работ</th></tr><tr>${cols.map(([,l])=>`<th class="num">${l}</th>`).join('')}${cols.map(([,l])=>`<th class="num">${l}</th>`).join('')}</tr></thead>
 <tbody>${line(g.our,'rg-obj')}${g.subs.map(s=>line(s)).join('')}${line(g.itog,'total')}${ownLine}</tbody></table></div>${cum?'':'<p class="muted">Колонки «С начала работ» считаются по всем месяцам объекта; загружаются при открытии.</p>'}`;
}

// Строки Excel в том же виде, что на экране.
export function genSheetRows(data,pid,month,cum=null){
 const g=genRows(data,pid,month,cum),k=['D','F','H','eq','off','pay'],v=(x,p)=>k.map(c=>x[p]?.[c]??null);
 return [{values:['Реестр по генуслугам · '+((data.projects||[]).find(p=>p.id===pid)?.name||'')+' · '+month],bold:true},
  {values:['','За месяц','','','','','','С начала работ'],bold:true},
  {values:['Строка','D, их цены','F, на заказчика','H = F − D','Оборудование','Зачёт авансов','К оплате','D, их цены','F, на заказчика','H = F − D','Оборудование','Зачёт авансов','К оплате'],bold:true},
  {values:[g.our.label,...v(g.our,'month'),...v(g.our,'total')],bold:true},
  ...g.subs.map(s=>({values:[`${s.label} № ${s.number}`,...v(s,'month'),...v(s,'total')]})),
  {values:[g.itog.label,...v(g.itog,'month'),...v(g.itog,'total')],bold:true},
  {values:['Собственные силы, по D',g.own.month.D,null,null,null,null,null,g.own.total?.D??null],bold:true},
  {values:['Собственные силы, по F',null,g.own.month.F,null,null,null,null,null,g.own.total?.F??null],bold:true}];
}

// Сумма «с начала» по субподрядчикам из реестров всех месяцев объекта (main.js загружает их при открытии вкладки).
export function genCumulative(pid,matrices,subMonths,periods){
 const subs={},our={D:0,F:0,H:null,eq:null,off:null,pay:null};
 const add=(id,k,v)=>{const s=subs[id]||(subs[id]={D:0,F:0,eq:0,off:0});s[k]+=Number(v)||0;};
 for(const m of matrices)for(const r of (m?.rows||[]).filter(r=>r.kind==='contract'&&r.project_id===pid)){
  our.D+=Number(r.total)||0;our.F+=Number(r.total)||0;
  for(const [k,v] of Object.entries(r.cells||{}))add(k,'D',v);
  for(const [k,v] of Object.entries(r.customer_cells||{}))add(k,'F',v);
 }
 const ids=new Set(periods.filter(p=>p.project_id===pid).map(p=>p.id));
 for(const x of subMonths.filter(x=>ids.has(x.period_id))){add(x.contract_id,'eq',x.equipment);add(x.contract_id,'off',(Number(x.target_offset)||0)+(Number(x.current_offset)||0));}
 return {our,subs};
}

export function registersPage({ui,data,profile,cum}){
 const view=REGISTER_VIEWS.some(([v])=>v===ui.registerView)?ui.registerView:'c15';
 const monthLabel=new Date(ui.month+'-01T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'Europe/Minsk'}).replace(' г.','');
 const seg=`<div class="ct-seg" role="group" aria-label="Реестр">${REGISTER_VIEWS.map(([v,l])=>`<button class="${v===view?'on':''}" data-action="register-view" data-id="${v}" aria-pressed="${v===view}">${l}</button>`).join('')}</div>`;
 const head=(sub,actions='')=>`<div class="heading"><div><h1>Реестры</h1><div class="muted">${e(sub)}</div></div><div class="actions">${seg}${actions}</div></div>`;
 const btns=`<button data-action="export" data-id="${view}">Excel</button><button data-action="print" data-id="">Печать</button>`;
 if(view==='gen'){
  const withData=(data.projects||[]).filter(p=>(data.matrix?.rows||[]).some(r=>r.project_id===p.id)||subsOf(data,p.id,ui.month).length);
  const pid=withData.some(p=>p.id===ui.genProject)?ui.genProject:withData[0]?.id;
  const picker=`<select id="gen-project" aria-label="Объект">${withData.map(p=>`<option value="${e(p.id)}" ${p.id===pid?'selected':''}>${e(p.name)}</option>`).join('')}</select>`;
  return head(`Генуслуги за ${monthLabel}: разница между «на заказчика» и ценами субподрядчика. «С начала работ» только вычисляется.`,btns)+(pid?`<div class="rg-bar">${picker}</div>${genTable(data,pid,ui.month,cum?.pid===pid&&cum.month===ui.month?cum.value:null)}`:'<div class="empty">За этот месяц данных по субподряду нет.</div>');
 }
 if(view==='close'){
  const rows=(data.projects||[]).map(p=>{const per=(data.periods||[]).find(x=>x.project_id===p.id),f=subsFiled(data,[p.id],ui.month);
   return `<tr class="ob-row" data-action="project" data-id="${e(p.id)}" tabindex="0" role="button"><td><i class="ct-dot" style="background:${objectColor(data.projects,p.id)}"></i>${e(p.name)}</td><td>${f.active?`подали ${f.filed} из ${f.active}`:'<span class="muted">—</span>'}</td><td>${per&&per.reviewed_revision===per.revision?'<span class="st ok">Проверено</span>':per?'<span class="st w">Не проверено</span>':'<span class="muted">—</span>'}</td><td>${per?.status==='closed'?'<span class="st ok">Закрыт</span>':per?'<span class="st w">В работе</span>':'<span class="muted">Не открыт</span>'}</td></tr>`;}).join('');
  return head(`Проверка и закрытие месяца: ${monthLabel}. Закрыть месяц можно на странице объекта, когда данные проверены и документы приняты.`)+`<div class="table-wrap"><table><thead><tr><th>Объект</th><th>Субподрядчики</th><th>Проверка ПТО</th><th>Месяц</th></tr></thead><tbody>${rows}</tbody></table></div>`;
 }
 const {m,html}=c15Table(data,ui.month);
 return head(`Реестр актов С-15 за ${monthLabel}. Генподряд всего = СМР с НДС по С-3а без оборудования. Договоры и колонки без данных за месяц скрыты.`,btns)
  +(m.rows.length?html:'<div class="empty">За этот месяц принятых актов нет.</div>')
  +`<div class="rg-sign"><div><span>Утверждаю: директор</span><i></i></div><div><span>Начальник ПТО</span><i></i></div></div>`;
}
