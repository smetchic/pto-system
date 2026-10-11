// Загрузка актов С-2 и справки С-3а из Excel (просьба пользователя 11.10.2026: вносить прошлые месяцы из своих файлов).
// Чтение — чистые функции над таблицей значений (grid[строка][колонка], с нуля), без ExcelJS: его подключает main.js.
// Документы создаются обычной командой create_document, по одному; С-3а — после актов своего договора и месяца,
// потому что СМР справки база считает по актам комплекта.
import {escapeHtml as e,money} from './domain.js';

// УНП СУ-22: акт, где СУ-22 исполнитель, — наш; иначе акт субподрядчика.
export const SU22_UNP='191426884';
const MONTHS=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const text=v=>v===null||v===undefined?'':String(v).replace(/\s+/g,' ').trim();
const num=v=>{if(typeof v==='number')return v;const s=text(v).replace(/\s/g,'').replace(',','.');return /^-?\d+(\.\d+)?$/.test(s)?Number(s):null;};
const round=v=>v===null?null:Math.round(v*100)/100;
const low=s=>s.toLowerCase().replace(/ё/g,'е');

// Месяц из «за Сентябрь месяц 2026 года» / «за Сентябрь 2026 года» → '2026-09'.
export function monthOf(s){
 const m=low(s).match(/за\s+([а-я]+)\s+(?:месяц\s+)?(\d{4})/);if(!m)return '';
 const i=MONTHS.findIndex((p,k)=>k===4?/^ма[йя]$/.test(m[1]):m[1].startsWith(p));
 return i<0?'':`${m[2]}-${String(i+1).padStart(2,'0')}`;
}
const cells=(grid,from=0,to=grid.length)=>{const out=[];for(let r=from;r<Math.min(to,grid.length);r++)(grid[r]||[]).forEach((v,c)=>{const t=text(v);if(t)out.push([r,c,t]);});return out;};
const find=(grid,re,from=0,to)=>cells(grid,from,to).find(([,,t])=>re.test(low(t)));
// Строка с подписью в первых колонках: [номер строки, подпись].
const rowsWithLabel=(grid,re)=>grid.map((row,r)=>[r,(row||[]).slice(0,3).map(text).filter(Boolean).join(' ')]).filter(([,l])=>re.test(low(l)));
const unps=(grid,to)=>[...new Set(cells(grid,0,to).flatMap(([,,t])=>t.match(/\b\d{9}\b/g)||[]))];

// Акт С-2а / С-2б: номер, месяц, часть объекта, сумма за отчётный период с НДС и НДС, УНП сторон.
function parseAct(grid,form){
 const title=find(grid,/сдачи-приемки/,0,40),no=title?.[2].match(/№\s*([^\s]+)/)?.[1]||find(grid,/^акт\s*№/,0,40)?.[2].match(/№\s*([^\s]+)/)?.[1]||'';
 const month=monthOf((find(grid,/^за\s+[а-я]+\s+(месяц\s+)?\d{4}/,0,40)||[])[2]||'');
 const head=find(grid,/^ед\.\s*изм/,0,60),problems=[];
 let col=-1;
 if(head){const cols=(grid[head[0]]||[]).map((v,c)=>[c,low(text(v))]).filter(([,t])=>t==='стоимость').map(([c])=>c);col=cols[2]??-1;}
 if(col<0)problems.push('не найдена колонка «стоимость в отчетном периоде»');
 const total=rowsWithLabel(grid,/^всего стоимость работ/)[0]||rowsWithLabel(grid,/^итого по неизменной/)[0];
 const vat=rowsWithLabel(grid,/^сумма ндс/)[0];
 const amount=total&&col>=0?round(num(grid[total[0]][col])):null,vatAmount=vat&&col>=0?round(num(grid[vat[0]][col])):null;
 if(amount===null)problems.push('не найдена строка «Всего стоимость работ»');
 if(!no)problems.push('не найден номер акта');if(!month)problems.push('не найден месяц');
 const part=(find(grid,/^часть объекта:/,0,30)||[])[2]?.replace(/^часть объекта:\s*/i,'')||'';
 return {type:'act',kind:form==='c2a'?'c2a':'c2b',number:no,month,part,amount,vat:vatAmount,unps:unps(grid,20),problems};
}

// Справка С-3а: договор, месяц, колонка «за отчетный период», строки по подписям.
function parseC3a(grid){
 const contract=(find(grid,/^договор.*№/,0,30)||[])[2]?.match(/№\s*([^\s]+)\s+от/)?.[1]||'';
 const month=monthOf((find(grid,/^за\s+[а-я]+\s+\d{4}/,0,30)||[])[2]||'');
 const head=find(grid,/^за отчетный период$/,0,40),col=head?head[1]:-1,problems=[];
 if(col<0)problems.push('не найдена колонка «за отчетный период»');
 const at=r=>r&&col>=0?round(num(grid[r[0]][col])):null;
 const smr=rowsWithLabel(grid,/^всего стоимость выполненных/)[0],eq=rowsWithLabel(grid,/^стоимость оборудования/)[0];
 const vats=rowsWithLabel(grid,/^сумма ндс/);
 const smrVat=vats.find(([r])=>smr&&r>smr[0]&&(!eq||r<eq[0])),eqVat=vats.find(([r])=>eq&&r>eq[0]);
 const v={smr:at(smr),smr_vat:at(smrVat),equipment_amount:at(eq),equipment_vat:at(eqVat),
  advance_target_offset:at(rowsWithLabel(grid,/^зачет целевого аванса/)[0]),advance_current_offset:at(rowsWithLabel(grid,/^зачет текущего аванса/)[0]),
  to_pay:at(rowsWithLabel(grid,/^всего к оплате/)[0])};
 if(v.smr===null)problems.push('не найдена строка «Всего стоимость выполненных работ»');if(!month)problems.push('не найден месяц');
 // К оплате = СМР + оборудование − зачёты (AGENTS.md §2); расхождение показываем, не исправляем.
 const calc=round((v.smr||0)+(v.equipment_amount||0)-(v.advance_target_offset||0)-(v.advance_current_offset||0));
 if(v.to_pay!==null&&Math.abs(calc-v.to_pay)>0.05)problems.push(`к оплате в файле ${money(v.to_pay)}, по формуле ${money(calc)}`);
 return {type:'c3a',kind:'c3a',number:month?`${month.slice(5)}/${month.slice(0,4)}`:'',contract,month,...v,unps:unps(grid,15),problems};
}

// Лист: видимые листы книги по порядку; берётся первый с «Форма С-2а/С-2б/С-3а».
export function parseSheets(sheets){
 for(const {grid} of sheets){
  const f=find(grid,/^форма\s*с-?(2а|2б|3а)$/,0,5);if(!f)continue;
  const k=low(f[2]).replace(/\s|-/g,'');
  return k.endsWith('3а')?parseC3a(grid):parseAct(grid,k.endsWith('2а')?'c2a':'c2b');
 }
 return {type:null,problems:['не похоже на акт С-2 или справку С-3а: нет надписи «Форма С-2б» или «Форма С-3а» на видимом листе']};
}

// Договор объекта: акт субподрядчика — по УНП контрагента входящего договора; наш акт и С-3а — договор с заказчиком (по номеру из С-3а).
export function matchContract(data,projectId,doc){
 const list=(data.contracts||[]).filter(c=>c.project_id===projectId),unpOf=c=>(data.parties||[]).find(p=>p.id===c.counterparty_id)?.unp||'';
 if(doc.type==='act'){
  const sub=list.filter(c=>c.direction==='incoming'&&doc.unps.includes(unpOf(c)));
  if(sub.length)return sub[0].id;
 }
 const out=list.filter(c=>c.direction==='outgoing');
 return (doc.contract&&out.find(c=>String(c.number).trim()===doc.contract))?.id||(out.length===1||doc.unps?.includes(SU22_UNP)?out[0]?.id:'')||'';
}

const monthName=m=>m?new Date(m+'-01T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}):'—';
// Предпросмотр: строка на файл, галочка, договор, номер; С-3а сверяется с суммой актов того же договора и месяца.
export function importCard({data,projectId,files}){
 const contracts=(data.contracts||[]).filter(c=>c.project_id===projectId);
 const opt=(sel,dir)=>`<option value="">— выберите договор —</option>${contracts.filter(c=>!dir||c.direction===dir).map(c=>`<option value="${e(c.id)}"${c.id===sel?' selected':''}>№ ${e(c.number)} · ${e(c.party||'')}</option>`).join('')}`;
 const acts=files.filter(f=>f.doc.type==='act');
 const rows=files.map((f,i)=>{const d=f.doc,ok=d.type&&!d.problems.filter(p=>!p.startsWith('к оплате')).length;
  let check='';
  if(d.type==='c3a'){const sum=round(acts.filter(a=>a.doc.month===d.month&&a.contract===f.contract).reduce((s,a)=>s+(a.doc.amount||0),0));
   check=sum?(Math.abs(sum-d.smr)<0.01?`<small class="xi-ok">СМР совпадает с актами из файлов: ${money(sum)}</small>`:`<small class="ct-warn">СМР ${money(d.smr)}, акты из файлов ${money(sum)}: проверьте, все ли акты выбраны</small>`):'';}
  const what=!d.type?'Не распознан':d.type==='c3a'?'Справка С-3а':`Акт ${d.kind==='c2a'?'С-2а':'С-2б'}`;
  const sum=d.type==='c3a'?`СМР ${money(d.smr)}${d.equipment_amount?` · оборуд. ${money(d.equipment_amount)}`:''}${d.to_pay!==null?` · к оплате ${money(d.to_pay)}`:''}`:d.type?`${money(d.amount)}${d.vat!==null?` <small>в т. ч. НДС ${money(d.vat)}</small>`:''}`:'';
  return `<div class="xi-row${ok?'':' off'}" data-i="${i}"><label class="xi-c"><input type="checkbox" name="pick" value="${i}"${ok?' checked':' disabled'}></label>
   <div class="xi-main"><b>${what}</b> <span class="muted">${e(f.name)}</span>
    ${d.type?`<div class="xi-grid"><span>${e(monthName(d.month))}</span><span class="num">${sum}</span></div>${d.part?`<small>${e(d.part)}</small>`:''}`:''}
    ${d.type?`<div class="xi-grid"><label>№<input name="number-${i}" value="${e(d.number)}" maxlength="40" required></label><label>Договор<select name="contract-${i}">${opt(f.contract,d.type==='c3a'?'outgoing':'')}</select></label></div>`:''}
    ${check}${d.problems.map(p=>`<small class="${ok?'ct-warn':'error'}">${e(p)}</small>`).join('')}</div></div>`;}).join('');
 const n=files.filter(f=>f.doc.type).length;
 return `<form id="excel-import-form" class="cp-drawer-shell ob" autocomplete="off" data-editing><div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>Загрузка из Excel</h2><div class="ct-sub">Распознано ${n} из ${files.length}. Документы попадут в месяц из файла; уже внесённые с тем же номером пропускаются.</div></div>
 <div class="cp-drawer-content">${rows}<p class="cp-hint">Сумма акта — «Всего стоимость работ» за отчётный период с НДС. Справка С-3а вносится после актов своего договора: СМР в ней база считает по актам, остальные строки берутся из файла.</p></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="dismiss">Отмена</button><button class="primary" type="submit">Загрузить</button></div></form>`;
}

// Порядок загрузки: по месяцам, внутри — акты раньше справки С-3а.
export function importPlan(files,form){
 const picked=new Set(form.getAll('pick').map(Number));
 return files.map((f,i)=>({...f,i,number:String(form.get('number-'+i)||'').trim(),contract:String(form.get('contract-'+i)||'')}))
  .filter(f=>picked.has(f.i)&&f.doc.type)
  .sort((a,b)=>a.doc.month.localeCompare(b.doc.month)||(a.doc.type==='c3a')-(b.doc.type==='c3a'));
}
export function createPayload(f){
 const d=f.doc,base={op:'create_document',contract_id:f.contract,kind:d.kind,number:f.number,note:d.part?`Часть объекта: ${d.part}. Из файла ${f.name}`:`Из файла ${f.name}`};
 if(d.type==='act')return {...base,amount:String(d.amount)};
 const v={};for(const k of ['smr_vat','equipment_amount','equipment_vat','advance_target_offset','advance_current_offset'])if(d[k]!==null&&d[k]!==undefined)v[k]=String(d[k]);
 return {...base,...v};
}

// ExcelJS → видимые листы как таблицы значений: формула — её результат, форматированный текст — строка.
const plain=v=>v&&typeof v==='object'?('result' in v?plain(v.result):v.richText?v.richText.map(x=>x.text).join(''):'text' in v?v.text:v instanceof Date?v.toISOString().slice(0,10):''):v;
export function sheetsOf(book){
 const out=[];
 book.eachSheet(ws=>{if(ws.state&&ws.state!=='visible')return;const grid=[];
  ws.eachRow({includeEmpty:false},(row,r)=>{const line=[];row.eachCell({includeEmpty:false},(cell,c)=>{line[c-1]=plain(cell.value);});grid[r-1]=line;});
  for(let r=0;r<grid.length;r++)if(!grid[r])grid[r]=[];
  out.push({name:ws.name,grid});});
 return out;
}
