// Карточка субподрядчика за месяц — на просмотр, устроена как карточка документа (замечание 12.10.2026):
// шапка, главная сумма (их цены), отметки списком, его справка С-3а и акты; поля ввода — по «Изменить».
import {escapeHtml as e,money,kindNames} from './domain.js';
import {kitStatus} from './kit-rows.js';

const has=v=>v!==null&&v!==undefined&&v!=='';
const byNo=(a,b)=>String(a.number||'').localeCompare(String(b.number||''),'ru',{numeric:true});
const TN={tn:'у технадзора',oral:'ТН устно',ok:'ТН подписал'};

// Удержание у субподрядчика за месяц: по его актам × процент договора субподряда, или введённое вручную.
export function retentionText(data,c,period){
 const r=(data.retention||[]).find(x=>x.side==='sub'&&x.contract_id===c.id&&x.period_id===period?.id);
 if(!r)return '';
 const pct=has(r.percent)?`${String(Number(r.percent)).replace('.',',')} % ${r.base==='gross'?'от СМР с НДС':'от СМР без НДС'}`:'';
 const manual=has(r.manual)&&Math.abs(Number(r.manual)-Number(r.calc))>=0.005;
 return `${money(r.amount)}${manual?` · вручную, по расчёту ${money(r.calc)}`:pct?` · ${pct}`:''}`;
}

export function subMonthCard({data,contract:c,period,canEdit=false}){
 const w=(data.workflows||[]).find(x=>x.template_code==='sub_claim'&&x.contract_id===c.id);
 const m=(data.subMonth||[]).find(x=>x.period_id===period?.id&&x.contract_id===c.id)||{};
 const D=w&&Number(w.acts_amount)?Number(w.acts_amount):null,F=has(m.on_customer)?Number(m.on_customer):null;
 const docs=(data.documents||[]).filter(d=>w?d.workflow_id===w.id:d.contract_id===c.id&&d.period_id===period?.id);
 const ver=d=>(data.versions||[]).find(v=>v.id===d.current_version)||{};
 const report=d=>(data.c3aReports||[]).find(r=>r.version_id===d.current_version);
 const list=[...docs.filter(d=>d.kind==='c3a').sort(byNo),...docs.filter(d=>d.kind!=='c3a').sort(byNo)];
 const rows=[['В этом месяце',m.expected===false?'не подаёт':'подаёт процентовку'],['План, их цены',has(m.plan)?money(m.plan):''],
  ['Технадзор',TN[m.tn_status]||''],['На заказчика, цены СУ-22',F!==null?money(F):''],['Генуслуги',F!==null&&D!==null?money(F-D):''],
  ['Оборудование',has(m.equipment)?money(m.equipment):''],['Зачёт целевого аванса',has(m.target_offset)?money(m.target_offset):''],
  ['Зачёт текущего аванса',has(m.current_offset)?money(m.current_offset):''],['Гарантийное удержание',retentionText(data,c,period)]].filter(([,x])=>x);
 const docLine=d=>{const r=d.kind==='c3a'?report(d):null;
  return `<div class="sc-doc${d.kind==='c3a'?' c3a':''}"><button type="button" class="link" data-action="doc" data-id="${e(d.id)}">${e(kindNames[d.kind]||'Документ')} № ${e(d.number)}</button><span class="num">${money(r?r.smr:ver(d).amount)}</span></div>`;};
 const buttons=`${w?`<button type="button" class="primary" data-action="workflow" data-id="${e(w.id)}">Открыть комплект</button>`:''}${canEdit?`<button type="button" data-action="sub-month" data-id="${e(c.id)}">Изменить</button>`:''}`;
 return `<div class="cp-drawer-shell ob dc sc"><div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>${e(c.party||'Субподрядчик')}</h2>
  <div class="ct-sub">дог. № ${e(c.number||'')} ${w?kitStatus(w):'<span class="ob-st n">Ждём процентовку</span>'}</div></div>
  <div class="cp-drawer-content"><div class="cp-total"><b>${D!==null?money(D):'—'}</b><span>руб. в их ценах${D===null?'<br>процентовка ещё не подана':''}</span></div>
  <dl class="ct-kv dc-kv">${rows.map(([k,x])=>`<dt>${k}</dt><dd>${e(x)}</dd>`).join('')}</dl>
  <section class="cp-block"><div class="cp-block-head"><h3>Документы за месяц</h3></div>${list.map(docLine).join('')||'<p class="cp-no-data">Справки и актов пока нет</p>'}</section></div>
  <div class="cp-drawer-foot">${buttons}</div></div>`;
}
