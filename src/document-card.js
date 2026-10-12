// Карточка документа месяца — одна схема для актов С-2а/С-2б и справки С-3а.
// Идентификация: контрагент → объект → часть объекта → договор → документ → месяц.
import {escapeHtml as e,money,kindNames,actVatCheck,vatRateOf} from './domain.js';
import {signedOn} from './kit-rows.js';

const KIND_TITLE={c2a:'Акт С-2а',c2b:'Акт С-2б',c3a:'Справка С-3а',c29:'С-29'};
export const docTitle=d=>`${KIND_TITLE[d.kind]||kindNames[d.kind]||'Документ'} № ${d.number}`;
const MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const monthWord=m=>m?`${MONTHS[Number(String(m).slice(5,7))-1]} ${String(m).slice(0,4)}`:'';
const has=v=>v!==null&&v!==undefined&&v!=='';
const when=x=>x?new Date(x).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Minsk'}):'';
const byNumber=(a,b)=>String(a.number).localeCompare(String(b.number),'ru',{numeric:true});
const TN={prep:'готовится',tn:'у технадзора',remarks:'замечания технадзора',ok:'подписал'};
const ORIG={party:'у заказчика',ours:'у нас',accounting:'передан в бухгалтерию'};

export const C3A_ROWS=[['smr','СМР с НДС',1],['smr_vat','в т. ч. НДС',2],['equipment','Оборудование с НДС',1],['equipment_vat','в т. ч. НДС',2],
 ['target_offset','Зачёт целевого аванса',1],['current_offset','Зачёт текущего аванса',1],['to_pay','К оплате',3]];

export function scanName({project,contract,doc,version=1,month,index=1,ext='pdf'}){
 const clean=s=>String(s||'').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim();
 const m=String(month||'').slice(0,7),mm=m?`${m.slice(5,7)}.${m.slice(0,4)}`:'';
 const party=contract?.direction==='incoming'?clean(contract.party):'';
 const kind=KIND_TITLE[doc.kind]||kindNames[doc.kind]||'Документ';
 const name=[clean(project),kind,`№${clean(doc.number)}`,mm?`за ${mm}`:'',party,version>1?`в${version}`:'',index>1?`(${index})`:''].filter(Boolean).join(' ');
 return `${name}.${clean(ext).toLowerCase()||'pdf'}`;
}

export function sourceOf(note){
 const t=String(note||'');const i=t.search(/Из файла /);
 return {part:(t.match(/^Часть объекта:\s*(.+?)\.\s*(?=Из файла|$)/)||[])[1]||'',from:i>=0?t.slice(i).replace(/^Из файла /,'из файла '):'',rest:i>=0||/^Часть объекта:/.test(t)?'':t};
}

export function documentCard({data,doc:d,files=[],checks=[],canEdit=false,cum=false}){
 const versions=(data.versions||[]).filter(v=>v.document_id===d.id).sort((a,b)=>b.version-a.version);
 const v=versions.find(x=>x.id===d.current_version)||versions[0]||{};
 const c=(data.contracts||[]).find(x=>x.id===d.contract_id)||{},p=(data.projects||[]).find(x=>x.id===d.project_id)||{};
 const per=(data.periods||[]).find(x=>x.id===d.period_id),month=String(per?.month||'').slice(0,7);
 const m=(data.docMarks||[]).find(x=>x.document_id===d.id)||{};
 const part=m.part_id?(data.contractParts||[]).find(x=>x.id===m.part_id)?.name:m.part;
 const src=sourceOf(v.note),who=(data.profiles||[]).find(x=>x.id===v.created_by)?.display_name||'';
 const done=d.step_code==='accepted',act=d.kind==='c2a'||d.kind==='c2b',c3a=d.kind==='c3a';
 const kit=(data.documents||[]).filter(x=>d.workflow_id&&x.workflow_id===d.workflow_id&&x.id!==d.id);
 const report=c3a?(data.c3aReports||[]).find(r=>r.version_id===v.id||r.document_id===d.id&&r.is_current):null;
 const verOf=x=>(data.versions||[]).find(y=>y.id===x.current_version);
 // Шаг: «Проверено» и «В бухгалтерии» — зелёные с галочкой; дата подписания — напротив названия документа (замечание 12.10.2026).
 const passed=['signed','accepted','closed'].includes(d.step_code),on=signedOn((data.workflows||[]).find(w=>w.id===d.workflow_id));
 const step=`<span class="ob-st ${passed?'ok':d.step_label?'w':'n'}">${passed?'✓ ':''}${e(d.step_label||'Без комплекта')}</span>`;
 const signed=on?`<span class="dc-signed">Дата подписания ${new Date(on+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'Europe/Minsk'})}</span>`:'';
 const identity=`<div class="dc-ident">
  <div class="dc-party${c.party?'':' muted'}">${e(c.party||'Контрагент не указан')}</div>
  <div class="dc-object">${e(p.name||'')}</div>
  <div class="dc-part${part||src.part?'':' muted'}">${e(part||src.part||'Часть объекта не указана')}</div>
  <div class="dc-contract">${c.number?`Договор № ${e(c.number)}`:'Договор не указан'}</div>
  <div class="dc-title"><h2>${e(docTitle(d))}</h2>${signed}</div>
  <div class="dc-month">${e(monthWord(month))}</div>
 </div>`;

 const big=c3a?(report?report.to_pay:null):v.amount;
 // Сумма крупно, «руб.» мелко рядом; ниже — НДС. Ставка пишется, только если она не 20 % (льгота, часть без НДС).
 // НДС, введённый не по расчёту (больше 0,01 руб. от суммы × ставка части/договора), — красным рядом (12.10.2026).
 const vatChk=act&&has(v.smr_vat)?actVatCheck(v.amount,v.smr_vat,vatRateOf(data,d.contract_id,m.part_id)):null,vatBad=vatChk?.bad?vatChk:null;
 const vatRate=act&&has(v.smr_vat)&&Number(v.amount)&&Number(v.amount)!==Number(v.smr_vat)?Math.round(Number(v.smr_vat)/(Number(v.amount)-Number(v.smr_vat))*100):null;
 const vatLine=act&&has(v.smr_vat)?`<div class="dc-vat">в т. ч. НДС ${money(v.smr_vat)}${vatRate!==null&&vatRate!==20?` · ставка ${vatRate} %`:''}${vatBad?` <span class="neg">· по расчёту ${money(vatBad.calc)}, разница ${money(vatBad.diff)}</span>`:''}</div>`:'';
 const total=`<div class="dc-sum"><div><b class="${Number(big)<0?'neg':''}">${has(big)?money(big):'—'}</b> <small>руб.${c3a?' к оплате':''}</small></div>${vatLine}</div>`;
 const amountRow=`<div class="dc-amount-row">${total}${step}</div>`;
 const corr=d.correction?`<p class="dc-corr"><span class="pill w">Корректировка</span> ${d.corrects?'исправляет '+e(d.corrects):''}</p>`:'';

 let middle='';
 if(act){
  const rows=[['Технадзор',m.tn_status?TN[m.tn_status]+(m.note?` · ${m.note}`:''):''],['Оригинал',ORIG[m.original]||'']].filter(([,x])=>x);
  middle=`<dl class="ct-kv dc-kv">${rows.map(([k,x])=>`<dt>${k}</dt><dd>${e(x)}</dd>`).join('')||'<dt>Отметки</dt><dd class="muted">не внесены</dd>'}</dl>`;
 } else if(c3a){
  const cell=(k,pre='')=>{const x=report?.[pre+k];return has(x)?money(x):'<span class="muted">—</span>';};
  const ytd=report&&C3A_ROWS.some(([k])=>Number(report['ytd_'+k]||0)!==Number(report['total_'+k]||0));
  const head=cum?`<th class="num">С начала работ</th>${ytd?'<th class="num">С начала года</th>':''}`:'';
  middle=`<div class="dc-c3a${cum?' cum':''}"><table><thead><tr><th>Раздел справки</th>${head}<th class="num dc-now">За ${e(monthWord(month).split(' ')[0]||'месяц')}</th></tr></thead><tbody>
   ${C3A_ROWS.map(([k,l,lv])=>`<tr class="${lv===2?'dc-in':lv===3?'total':''}"><td>${l}</td>${cum?`<td class="num">${cell(k,'total_')}</td>${ytd?`<td class="num">${cell(k,'ytd_')}</td>`:''}`:''}<td class="num dc-now">${cell(k)}</td></tr>`).join('')}</tbody></table></div>
   <button type="button" class="link dc-cum" data-action="c3a-cum" data-id="${e(d.id)}" aria-pressed="${cum}">${cum?'Без накопления':'С накоплением'}</button>`;
 }

 // С-3а с частью договора сверяется с актами этой части (справка на каждую часть, решение 12.10.2026).
 const partOf=x=>(data.docMarks||[]).find(y=>y.document_id===x.id)?.part_id||'';
 let check='';
 if(act){const s=kit.find(x=>x.kind==='c3a'&&partOf(x)&&partOf(x)===m.part_id)||kit.find(x=>x.kind==='c3a'&&!partOf(x));check=s?`<p class="dc-check">Входит в <button type="button" class="link" data-action="doc" data-id="${e(s.id)}">${e(docTitle(s))}</button></p>`:d.workflow_id?'<p class="dc-check muted">Справки С-3а в комплекте пока нет</p>':'';}
 if(c3a){const acts=kit.filter(x=>(x.kind==='c2a'||x.kind==='c2b')&&(!m.part_id||partOf(x)===m.part_id)).sort(byNumber),sum=acts.reduce((t,x)=>t+Number(verOf(x)?.amount||0),0);const ok=report&&Math.abs(sum-Number(report.smr))<0.005;
  check=acts.length?`<p class="dc-check ${ok?'mo-ok':'neg'}">СМР ${ok?'=':'≠'} акты № ${acts.map(x=>e(x.number)).join(', ')} на ${money(sum)} ${ok?'✓':''}</p>`:'<p class="dc-check neg">В комплекте нет актов: СМР справки 0</p>';}

 const mine=files.filter(f=>f.version_id===v.id);
 const fileLine=(f,i)=>{const k=checks.find(x=>x.file_id===f.id),pdf=/\.pdf$/i.test(f.name||f.path||'');const label=mine.length>1?`${pdf?'Открыть PDF':'Открыть скан'} ${i+1}`:(pdf?'Открыть PDF':'Открыть скан');
  return `<div class="dc-file">${mine.length>1?`<span class="dc-file-no">${i+1}</span>`:''}<button type="button" class="link" data-action="download" data-id="${e(f.path)}">${label}</button>${k?`<span class="ob-st ${k.result==='ok'?'ok':'e'}">${k.result==='ok'?'сверен ✓':'расхождение'}</span>`:''}${canEdit&&(act||c3a)?`<button type="button" class="cp-small" data-action="check-file" data-id="${e(f.id)}">${k?'Сверить заново':'Сверить'}</button>`:''}</div>`;};
 const upload=canEdit?`<label class="cp-small dc-up">${mine.length?'Ещё файл':'Загрузить скан'}<input id="upload" type="file" accept=".pdf,image/*" hidden></label>`:'';
 const scan=`<section class="cp-block dc-scan"><div class="cp-block-head"><h3>Скан</h3>${upload}</div>${mine.map(fileLine).join('')||'<p class="cp-no-data">Скан не загружен</p>'}</section>`;

 const hist=versions.length>1?`<section class="cp-block"><div class="cp-block-head"><h3>Версии</h3></div>${versions.map(x=>`<div class="dc-ver"><b>в${x.version}</b><span class="num">${money(x.amount)}</span>${x.id===d.accepted_version?'<span class="ob-st ok">принята бухгалтерией</span>':''}<small class="muted">${e(when(x.created_at))}${sourceOf(x.note).rest?' · '+e(sourceOf(x.note).rest):''}</small></div>`).join('')}</section>`:'';
 const meta=`<p class="dc-meta">${['внесено '+when(v.created_at),who,src.from||src.rest].filter(Boolean).map(e).join(' · ')}</p>`;
 const buttons=`${d.workflow_id?`<button type="button" class="primary" data-action="workflow" data-id="${e(d.workflow_id)}">Открыть комплект</button>`:''}${canEdit&&(act||c3a)?`<button type="button" data-action="doc-edit" data-id="${e(d.id)}" title="${done?'Изменение создаст новую версию и вернёт комплект на первый шаг; принятая версия останется в истории':''}">Изменить</button>`:''}`;
 const body=act?`${amountRow}${corr}${check}${scan}${middle}${hist}${meta}`:`${amountRow}${corr}${middle}${check}${scan}${hist}${meta}`;
 return `<div class="cp-drawer-shell ob dc"><div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button>${identity}</div>
 <div class="cp-drawer-content">${body}</div>
 <div class="cp-drawer-foot">${buttons}</div></div>`;
}
