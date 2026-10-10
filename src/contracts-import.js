// Загрузка договоров из файла pto-contracts v1 (сканы и Word-реестры папки ДОГОВОРА).
// Файл разбирается в браузере; перед загрузкой — предпросмотр по объектам с галочками. Пишет база (import_contracts).
import {escapeHtml as e} from './domain.js';

export const contractTypes={su22_sub:'СУ-22 — субподрядчик',su22_mps:'СУ-22 — МПС',mps_customer:'МПС — заказчик, справочно',mps_su22_sub:'МПС — СУ-22 — субподрядчик, справочно'};
// Справочные договоры (МПС с заказчиком, трёхсторонние) и непроверенные не участвуют в «Подписании» и месяце.
export const referenceType=c=>['mps_customer','mps_su22_sub'].includes(c?.contract_type);
export const working=c=>!referenceType(c)&&c?.checked!==false;

const money=v=>v===null||v===undefined||v===''?null:String(v);
const vatOf=p=>p?.vat_mode==='no_vat'?'0':money(p?.vat_rate);
// Срок может быть только месяцем (ГГГГ-ММ): начало — первое число, окончание — последнее.
// Дата из файла: несуществующая (например, 31 апреля) не загружается.
const realDay=v=>{const d=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d?d:null;};
const startDay=v=>!v?null:/^\d{4}-\d{2}$/.test(v)?v+'-01':realDay(v);
const endDay=v=>{if(!v)return null;if(!/^\d{4}-\d{2}$/.test(v))return realDay(v);const [y,m]=v.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const direction=kind=>['customer','general_contractor'].includes(String(kind).split(':')[1])?'outgoing':'incoming';

export function parseContractsFile(text){
 let doc;try{doc=JSON.parse(text);}catch{throw Error('Файл не JSON');}
 if(doc?.format!=='pto-contracts'||Number(doc.version)!==1||!Array.isArray(doc.contracts))throw Error('Нужен файл формата pto-contracts, версия 1');
 return doc.contracts.map(c=>{
  const [our_role,counterparty_role]=String(c.kind||'').split(':'),parts=Array.isArray(c.parts)?c.parts:[];
  const other=(c.parties||[]).find(p=>p.side!=='СУ-22'&&p.name)?.name,bad=[c.date,c.work_start,c.work_end].filter(v=>v&&!/^\d{4}-\d{2}$/.test(v)&&!realDay(v));
  return {key:c.key,object:String(c.object||'').trim(),type:c.type||null,our_role,counterparty_role,
   number:String(c.number||'').trim(),date:realDay(c.date),bad_dates:bad,subject:c.subject||'',
   unp:c.counterparty?.unp||null,party:c.counterparty?.name||other||'Контрагент не указан',no_party:!c.counterparty?.name&&!other,party_full_name:c.counterparty?.full_name||'',
   amount:money(c.amount_with_vat),vat_amount:money(c.vat_amount),vat_rate:parts.length===1?vatOf(parts[0]):null,
   work_start:startDay(c.work_start),work_end:endDay(c.work_end),status:c.status||null,replaced_by:c.replaced_by||'',note:c.note||'',
   checked:c.confidence==='high',files:(c.files||[]).map(f=>({type:f.type,path:f.path})),parent_number:c.parent?.number||null,
   advance_current_percent:money(c.advance?.current_percent),advance_target_amount:money(c.advance?.target_amount),
   parts:parts.length>1?parts.map(p=>({name:p.name,vat_rate:vatOf(p),amount:money(p.amount_with_vat)})):[],
   addenda:(c.addenda||[]).map(a=>({number:String(a.number||'').trim(),date:realDay(a.date),amount_after:money(a.amount_with_vat_after),vat_amount_after:money(a.vat_amount_after),
    work_end_after:endDay(a.work_end_after),note:a.changes||a.note||'',signed:a.signed})),
   confidence:c.confidence||'low',check:Array.isArray(c.check)?c.check.length:0};
 });
}

// Предпросмотр: по объектам, что будет создано, дополнено и что не загрузится.
export function previewContracts(data,items){
 const projectId=name=>(data.projects||[]).find(p=>p.name.trim().toLowerCase()===name.toLowerCase())?.id||null;
 const seen=new Map(),groups=new Map();
 for(const it of items){
  const pid=projectId(it.object),number=it.number||'б/н',dir=direction(`${it.our_role}:${it.counterparty_role}`);
  const same=(data.contracts||[]).find(c=>(it.key&&c.source_key===it.key)||(pid&&c.project_id===pid&&c.number===number&&c.direction===dir));
  const k=`${it.object}|${number}|${dir}`,dup=seen.has(k);seen.set(k,true);
  const nums=it.addenda.filter(a=>a.number&&a.date).map(a=>a.number),twice=nums.length-new Set(nums).size;
  const problems=[!it.number&&'без номера — «б/н»',it.no_party&&'контрагент не указан',dup&&'номер повторяется в файле — не загрузится',
   it.bad_dates?.length&&`неверная дата ${it.bad_dates.join(', ')} — не загрузится`,
   it.addenda.some(a=>!a.number||!a.date)&&`ДС без номера или даты: ${it.addenda.filter(a=>!a.number||!a.date).length} — не загрузятся`,
   twice&&`ДС с повторяющимся номером: ${twice} — загрузится первое`].filter(Boolean);
  const g=groups.get(it.object)||{object:it.object,exists:!!pid,items:[]};
  g.items.push({...it,state:dup?'skip':same?'update':'new',problems});groups.set(it.object,g);
 }
 return [...groups.values()].sort((a,b)=>(b.exists-a.exists)||a.object.localeCompare(b.object,'ru'));
}

export function previewHtml(groups){
 const n=(g,s)=>g.items.filter(x=>x.state===s).length;
 const row=x=>`<tr><td>№ ${e(x.number||'б/н')}<small>${e(x.date||'')}</small></td><td>${e(x.party||'—')}<small>${e(contractTypes[x.type]||'')}${x.unp?' · УНП '+e(x.unp):''}</small></td>
  <td>${x.state==='new'?'новый':x.state==='update'?'дополнит пустые поля':'<span class="neg">не загрузится</span>'}${x.checked?'':' · <span class="muted">не проверен</span>'}${x.problems.length?`<small class="ct-warn">${e(x.problems.join('; '))}</small>`:''}</td></tr>`;
 return `<p class="muted">Отметьте объекты, договоры которых нужны. Загрузка создаёт недостающие объекты и контрагентов с УНП, у существующих договоров заполняет только пустые поля. Договоры с низкой уверенностью (из реестров и имён файлов) попадут с пометкой «не проверен» и не появятся в «Подписании», пока их не отметят.</p>
 <div class="ci-list">${groups.map(g=>`<details class="ci-obj"><summary><label><input type="checkbox" class="ci-check" value="${e(g.object)}" ${g.exists?'checked':''}> <b>${e(g.object)}</b></label>
  <span class="muted">${g.items.length} дог. · ${g.exists?'объект есть':'новый объект'}${n(g,'update')?` · дополнит ${n(g,'update')}`:''}${n(g,'skip')?` · <span class="neg">не загрузится ${n(g,'skip')}</span>`:''} · ДС ${g.items.reduce((t,x)=>t+x.addenda.length,0)}</span></summary>
  <table class="ci-table"><tbody>${g.items.map(row).join('')}</tbody></table></details>`).join('')}</div>`;
}
