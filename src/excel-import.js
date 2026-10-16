// Загрузка актов С-2 и справки С-3а из Excel (просьба пользователя 11.10.2026: вносить прошлые месяцы из своих файлов).
// Книга: каждый видимый лист с надписью «Форма С-2а/С-2б/С-3а» — отдельный документ; месяцы в книге могут быть разные.
// Чтение — чистые функции над таблицей значений (grid[строка][колонка], с нуля), без ExcelJS: его подключает main.js.
// Документы создаются обычной командой create_document, по одному; С-3а — после актов своего договора и месяца,
// потому что СМР справки база считает по актам комплекта. Сумма ноль или меньше — только акт-корректировка
// (решение пользователя 11.10.2026: такая пометка у всех таких актов).
import {escapeHtml as e,money} from './domain.js';

// УНП СУ-22: акт, где СУ-22 исполнитель, — наш; иначе акт субподрядчика.
export const SU22_UNP='191426884';
const MONTHS=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const MONTH_NAMES=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const text=v=>v===null||v===undefined?'':String(v).replace(/\s+/g,' ').trim();
const num=v=>{if(typeof v==='number')return v;const s=text(v).replace(/\s/g,'').replace(',','.');return /^-?\d+(\.\d+)?$/.test(s)?Number(s):null;};
const round=v=>v===null?null:Math.round(v*100)/100;
// В файлах встречаются латинские буквы внутри русских слов («СЕHТЯБРЬ», «HДC»): в таких словах они заменяются русскими.
const LATIN={A:'А',B:'В',C:'С',E:'Е',H:'Н',K:'К',M:'М',O:'О',P:'Р',T:'Т',X:'Х',Y:'У',a:'а',c:'с',e:'е',o:'о',p:'р',x:'х',y:'у'};
export const cyr=s=>String(s).replace(/[A-Za-zА-Яа-яЁё]+/g,w=>/[А-Яа-яЁё]/.test(w)?w.replace(/[ABCEHKMOPTXYaceopxy]/g,ch=>LATIN[ch]):w);
const low=s=>cyr(s).toLowerCase().replace(/ё/g,'е');

// Месяц из «за Сентябрь месяц 2026 года» / «за СЕНТЯБРЬ 2026» → '2026-09'.
export function monthOf(s){
 const m=low(s).match(/за\s+([а-я]+)\s+(?:месяц\s+)?(\d{4})/);if(!m)return '';
 const i=MONTHS.findIndex((p,k)=>k===4?/^ма[йя]$/.test(m[1]):m[1].startsWith(p));
 return i<0?'':`${m[2]}-${String(i+1).padStart(2,'0')}`;
}
const cells=(grid,from=0,to=grid.length)=>{const out=[];for(let r=from;r<Math.min(to,grid.length);r++)(grid[r]||[]).forEach((v,c)=>{const t=text(v);if(t)out.push([r,c,t]);});return out;};
const find=(grid,re,from=0,to)=>cells(grid,from,to).find(([,,t])=>re.test(low(t)));
// Строка с подписью в первых колонках: [номер строки, подпись]. Пустые ячейки и номер строки («1», «4») не мешают.
const rowsWithLabel=(grid,re)=>grid.map((row,r)=>[r,(row||[]).slice(0,4).map(text).filter(t=>t&&!/^\d+(\.\d+)?$/.test(t)).join(' ')]).filter(([,l])=>re.test(low(l)));
const unps=(grid,to)=>[...new Set(cells(grid,0,to).flatMap(([,,t])=>t.match(/\b\d{9}\b/g)||[]))];
// Значение по подписи: «Часть объекта: X» в одной ячейке или «Часть объекта» | «X» в соседних (объединённые ячейки повторяют подпись).
function labelValue(grid,re,to=30){
 const hit=find(grid,re,0,to);if(!hit)return '';
 const [r,c,t]=hit,rest=t.replace(/^[^:]*:\s*/,'');
 if(t.includes(':')&&rest)return rest;
 return (grid[r]||[]).slice(c+1).map(text).find(v=>v&&v!==t&&!re.test(low(v)))||'';
}
const monthWord=m=>m?`${MONTH_NAMES[Number(m.slice(5))-1]} ${m.slice(0,4)}`:'';
// «(корректировка акта сдачи-приемки … №1 формы С-2б за ИЮНЬ 2026 г.)» → «акт №1 за июнь 2026».
export function correctsOf(title){
 const t=low(title),i=t.indexOf('корректировк');if(i<0)return '';
 const tail=t.slice(i),no=tail.match(/акта?[^№]*№\s*([0-9][\w./-]*)/)?.[1]||'',m=monthOf(tail);
 return no||m?`акт${no?` №${no}`:''}${m?` за ${monthWord(m)}`:''}`:'корректировка';
}

// Акт С-2а / С-2б: номер, месяц, часть, договор, сумма за отчётный период с НДС и НДС, корректировка, УНП сторон.
function parseAct(grid,form){
 const title=find(grid,/сдачи\s*-\s*приемки/,0,40)||find(grid,/^акт\s*№/,0,40),problems=[];
 const no=title?.[2].match(/№\s*([0-9][\w./-]*)/)?.[1]||'';
 const month=monthOf((find(grid,/^за\s+[а-я]+\s+(месяц\s+)?\d{4}/,0,40)||[])[2]||'');
 const head=find(grid,/^ед\.\s*изм/,0,60);
 let col=-1;
 if(head){const cols=(grid[head[0]]||[]).map((v,c)=>[c,low(text(v))]).filter(([,t])=>/^ст(оимость|-сть)$/.test(t)).map(([c])=>c);col=cols[2]??-1;}
 if(col<0)problems.push('не найдена колонка «стоимость в отчетном периоде»');
 const total=rowsWithLabel(grid,/^всего стоимость работ/)[0]||rowsWithLabel(grid,/^итого по неизменной/)[0];
 const vat=rowsWithLabel(grid,/^сумма ндс/)[0];
 const at=r=>r&&col>=0?round(num(grid[r[0]][col])):null;
 const amount=at(total),vatAmount=at(vat);
 if(amount===null)problems.push('не найдена строка «Всего стоимость работ»');
 if(!no)problems.push('не найден номер акта');if(!month)problems.push('не найден месяц');
 // Корректировка: так написано в заголовке, или сумма ноль и меньше (такая сумма бывает только у корректировки).
 const corrects=correctsOf(title?.[2]||''),correction=!!corrects||(amount!==null&&amount<=0);
 const contract=labelValue(grid,/^договор/).match(/№\s*(\S+)/)?.[1]||'';
 return {type:'act',kind:form==='c2a'?'c2a':'c2b',number:no,month,part:labelValue(grid,/^часть объекта/),contract,amount,vat:vatAmount,
  correction,corrects:correction?corrects||'корректировка':'',unps:unps(grid,20),problems};
}

// Справка С-3а: номер, договор, месяц, колонка «за отчетный период», строки по подписям.
function parseC3a(grid){
 const contract=(find(grid,/^договор.*№/,0,30)||[])[2]?.match(/№\s*([^\s]+)\s+от/)?.[1]||labelValue(grid,/^договор/).match(/№\s*(\S+)/)?.[1]||'';
 const month=monthOf((find(grid,/^за\s+[а-я]+\s+(месяц\s+)?\d{4}/,0,30)||[])[2]||'');
 const no=(find(grid,/^справка.*№\s*[0-9]/,0,30)||[])[2]?.match(/№\s*([0-9][\w./-]*)/)?.[1]||'';
 const head=find(grid,/^за отчетный период$/,0,40),col=head?head[1]:-1,problems=[];
 if(col<0)problems.push('не найдена колонка «за отчетный период»');
 const at=r=>r&&col>=0?round(num(grid[r[0]][col])):null;
 const smr=rowsWithLabel(grid,/^всего стоимость выполненных/)[0],eq=rowsWithLabel(grid,/^стоимость оборудования/)[0];
 const vats=rowsWithLabel(grid,/^сумма ндс/);
 const smrVat=vats.find(([r])=>smr&&r>smr[0]&&(!eq||r<eq[0])),eqVat=vats.find(([r])=>eq&&r>eq[0]);
 const v={smr:at(smr),smr_vat:at(smrVat),equipment_amount:at(eq),equipment_vat:at(eqVat),
  advance_target_offset:at(rowsWithLabel(grid,/^зачет целевого аванса/)[0]),advance_current_offset:at(rowsWithLabel(grid,/^зачет текущего аванса/)[0]),
  retention:at(rowsWithLabel(grid,/^(гарантийн\S* )?удержан/)[0]),to_pay:at(rowsWithLabel(grid,/^всего к оплате/)[0])};
 if(v.smr===null)problems.push('не найдена строка «Всего стоимость выполненных работ»');if(!month)problems.push('не найден месяц');
 // К оплате = СМР + оборудование − зачёты − гарантийное удержание (AGENTS.md §2, удержания 12.10.2026); расхождение показываем, не исправляем.
 const calc=round((v.smr||0)+(v.equipment_amount||0)-(v.advance_target_offset||0)-(v.advance_current_offset||0)-(v.retention||0));
 if(v.to_pay!==null&&Math.abs(calc-v.to_pay)>0.05)problems.push(`к оплате в файле ${money(v.to_pay)}, по формуле ${money(calc)}`);
 // Номер справки: из файла, иначе «09/2026» (решение пользователя 11.10.2026).
 return {type:'c3a',kind:'c3a',number:no||(month?`${month.slice(5)}/${month.slice(0,4)}`:''),contract,month,...v,correction:false,corrects:'',unps:unps(grid,15),problems};
}

// Видимые листы книги → документы: лист с «Форма С-2а/С-2б/С-3а» — документ, остальные пропускаются.
export function parseSheets(sheets){
 const out=[];
 for(const {name,grid} of sheets){
  const f=find(grid,/^форма\s*с-?(2а|2б|3а)$/,0,5);if(!f)continue;
  const k=low(f[2]).replace(/\s|-/g,'');
  out.push({sheet:name||'',...(k.endsWith('3а')?parseC3a(grid):parseAct(grid,k.endsWith('2а')?'c2a':'c2b'))});
 }
 return out;
}

// Наш документ или субподрядчика: исполнитель (последний УНП в шапке) — СУ-22. Справка без УНП считается нашей.
export const isOurs=doc=>doc.type==='c3a'&&!(doc.unps||[]).length||(doc.unps||[]).at(-1)===SU22_UNP;
// Договор объекта: сначала по номеру из файла; акт и справка субподрядчика — по УНП контрагента входящего договора;
// наш акт и С-3а — договор с заказчиком (у объекта он один).
export function matchContract(data,projectId,doc){
 const list=(data.contracts||[]).filter(c=>c.project_id===projectId),unpOf=c=>(data.parties||[]).find(p=>p.id===c.counterparty_id)?.unp||'';
 const norm=s=>String(s||'').trim().toLowerCase();
 const ours=isOurs(doc);
 const byNo=doc.contract&&list.filter(c=>norm(c.number)===norm(doc.contract)&&(ours?c.direction==='outgoing':doc.type!=='c3a'||c.direction==='incoming'));
 if(byNo?.length===1)return byNo[0].id;
 if(!ours){
  const sub=list.filter(c=>c.direction==='incoming'&&doc.unps.includes(unpOf(c)));
  if(sub.length===1)return sub[0].id;
 }
 const out=list.filter(c=>c.direction==='outgoing');
 return ours&&out.length===1?out[0].id:'';
}

const monthName=m=>m?new Date(m+'-01T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}):'—';
// Уже внесённый документ: тот же договор, месяц, форма и номер.
export const isLoaded=(existing,f,contract,number)=>(existing||[]).some(x=>x.contract_id===contract&&String(x.month).slice(0,7)===f.doc.month&&x.kind===f.doc.kind&&String(x.number).trim()===String(number).trim());
// Похоже на уже внесённый акт с другим номером: тот же договор, месяц, форма и сумма (12.10.2026) — чтобы ошибка в номере
// не стала вторым документом. Пользователь выбирает: заменить номер у внесённого или добавить как новый.
export const lookAlike=(existing,f,contract,number)=>f.doc.type!=='act'?null:(existing||[]).find(x=>x.contract_id===contract&&String(x.month).slice(0,7)===f.doc.month&&x.kind===f.doc.kind
 &&String(x.number).trim()!==String(number).trim()&&x.amount!==null&&x.amount!==undefined&&Math.abs(Number(x.amount)-Number(f.doc.amount))<0.005)||null;
const STEPS=[['','Не ставить: комплект в начале «Подписания»'],['check','На проверке'],['signed','Проверено'],['accepted','В бухгалтерии']];

// Предпросмотр: строка на лист, галочка, договор, номер; С-3а сверяется с суммой актов того же договора и месяца.
// canJump: начальник ПТО и все месяцы прошлые — тогда можно сразу поставить шаг «Подписания».
export function importCard({data,projectId,files,existing=[],canJump=false}){
 const like=(f,i)=>{const x=!isLoaded(existing,f,f.contract,f.doc.number)&&lookAlike(existing,f,f.contract,f.doc.number);if(!x)return '';
  return `<div class="xi-like ct-warn">Похоже на акт № ${e(x.number)} с другим номером (тот же договор, месяц и сумма).
   <label><input type="radio" name="mode-${i}" value="renumber:${e(x.id)}" checked> заменить номер у № ${e(x.number)} на номер из файла</label>
   <label><input type="radio" name="mode-${i}" value="new"> добавить как новый акт</label></div>`;};
 const contracts=(data.contracts||[]).filter(c=>c.project_id===projectId);
 const opt=(sel,dir)=>`<option value="">— выберите договор —</option>${contracts.filter(c=>!dir||c.direction===dir).map(c=>`<option value="${e(c.id)}"${c.id===sel?' selected':''}>№ ${e(c.number)} · ${e(c.party||'')}</option>`).join('')}`;
 const acts=files.filter(f=>f.doc.type==='act');
 const rows=files.map((f,i)=>{const d=f.doc,loaded=d.type&&isLoaded(existing,f,f.contract,d.number),ok=d.type&&!d.problems.filter(p=>!p.startsWith('к оплате')).length&&!loaded;
  let check='';
  if(d.type==='c3a'){const sum=round(acts.filter(a=>a.doc.month===d.month&&a.contract===f.contract).reduce((s,a)=>s+(a.doc.amount||0),0));
   check=sum?(Math.abs(sum-d.smr)<0.01?`<small class="xi-ok">СМР совпадает с актами из файла: ${money(sum)}</small>`:`<small class="ct-warn">СМР ${money(d.smr)}, акты из файла ${money(sum)}: проверьте, все ли акты выбраны</small>`):'';}
  const what=!d.type?'Не распознан':d.type==='c3a'?(isOurs(d)?'Справка С-3а':'Справка С-3а субподрядчика'):`Акт ${d.kind==='c2a'?'С-2а':'С-2б'}`;
  const sum=d.type==='c3a'?`СМР ${money(d.smr)}${d.equipment_amount?` · оборуд. ${money(d.equipment_amount)}`:''}${d.to_pay!==null?` · к оплате ${money(d.to_pay)}`:''}`:d.type?`<b class="${d.amount<0?'neg':''}">${money(d.amount)}</b>${d.vat!==null?` <small>в т. ч. НДС ${money(d.vat)}</small>`:''}`:'';
  return `<div class="xi-row${ok?'':' off'}" data-i="${i}"><label class="xi-c"><input type="checkbox" name="pick" value="${i}"${ok?' checked':' disabled'}></label>
   <div class="xi-main"><div class="xi-top"><b>${what}${d.number?` № ${e(d.number)}`:''}</b>${d.correction?'<span class="pill w">Корректировка</span>':''}<span class="xi-sum num">${sum}</span></div>
    <small class="muted xi-where" title="${e(d.part||'')}">${e(monthName(d.month))} · лист «${e(d.sheet||f.name)}»${d.part?` · ${e(d.part)}`:''}</small>
    ${d.type?`<div class="xi-grid${d.correction?' corr':''}"><label>№<input name="number-${i}" value="${e(d.number)}" maxlength="40" required></label><label>Договор<select name="contract-${i}">${opt(f.contract,d.type==='c3a'?(isOurs(d)?'outgoing':'incoming'):'')}</select></label>${d.correction?`<label>Исправляет<input name="corrects-${i}" value="${e(d.corrects)}" maxlength="120"></label>`:''}</div>`:''}
    ${loaded?'<small class="muted">Уже внесён: пропускается</small>':''}${like(f,i)}${check}${d.problems.map(p=>`<small class="${ok||loaded?'ct-warn':'error'}">${e(p)}</small>`).join('')}</div></div>`;}).join('');
 const n=files.filter(f=>f.doc.type).length,corr=files.filter(f=>f.doc.correction).length;
 // Дата подписания процентовки (замечание 12.10.2026) обязательна для шага «Проверено» и дальше: это не дата ввода в базу.
 const step=canJump?`<label class="xi-step">Шаг «Подписания» после загрузки<select name="to_step">${STEPS.map(([v,l])=>`<option value="${v}"${v==='accepted'?' selected':''}>${l}</option>`).join('')}</select></label><label class="xi-step">Дата подписания процентовки<input type="date" name="signed_on"></label><small class="muted">Нужна для шагов «Проверено» и «В бухгалтерии». Если месяцы подписаны в разные дни, исправьте дату в «Изменить» карточки любого документа месяца.</small>`:'';
 return `<form id="excel-import-form" class="cp-drawer-shell ob" autocomplete="off" data-editing><div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>Загрузка из Excel</h2><div class="ct-sub">Распознано ${n} из ${files.length}${corr?` · корректировок ${corr}`:''}${acts.length?` · акты на ${money(round(acts.reduce((t,f)=>t+(f.doc.amount||0),0)))}`:''}. Документы попадут в месяц из файла; уже внесённые с тем же номером пропускаются.</div></div>
 <div class="cp-drawer-content">${rows}${step}<p class="cp-hint">Сумма акта — «Всего стоимость работ» за отчётный период с НДС. Акт с суммой ноль или меньше вносится как корректировка. Справка С-3а вносится после актов своего договора: СМР в ней база считает по актам, остальные строки берутся из файла.</p></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="dismiss">Отмена</button><button class="primary" type="submit">Загрузить</button></div></form>`;
}

// Порядок загрузки: по месяцам, внутри — акты раньше справки С-3а.
// renumber — id внесённого акта, у которого меняется номер, вместо создания нового (только если договор тот же).
export function importPlan(files,form,existing=[]){
 const picked=new Set(form.getAll('pick').map(Number));
 const target=(f,i)=>{const m=String(form.get('mode-'+i)||'');if(!m.startsWith('renumber:'))return null;const x=(existing||[]).find(y=>y.id===m.slice(9));return x&&x.contract_id===String(form.get('contract-'+i)||'')?x.id:null;};
 return files.map((f,i)=>({...f,i,number:String(form.get('number-'+i)||'').trim(),contract:String(form.get('contract-'+i)||''),corrects:String(form.get('corrects-'+i)??f.doc.corrects??'').trim(),renumber:target(f,i)}))
  .filter(f=>picked.has(f.i)&&f.doc.type&&!isLoaded(existing,f,f.contract,f.number))
  .sort((a,b)=>a.doc.month.localeCompare(b.doc.month)||(a.doc.type==='c3a')-(b.doc.type==='c3a'));
}
export function createPayload(f){
 const d=f.doc,from=`Из файла ${f.name}${d.sheet?`, лист «${d.sheet}»`:''}`;
 const base={op:'create_document',contract_id:f.contract,kind:d.kind,number:f.number,note:d.part?`Часть объекта: ${d.part}. ${from}`:from};
 if(d.type==='act')return {...base,amount:String(d.amount),...(d.vat!==null&&d.vat!==undefined?{smr_vat:String(d.vat)}:{}),...(d.correction?{correction:true,corrects:f.corrects||d.corrects||'корректировка'}:{})};
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

// Итог загрузки — в той же боковой панели.
export function importResult({created,failed,moved,step,renumbered=0}){
 return `<div class="cp-drawer-shell ob"><div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>Загрузка из Excel</h2>
 <div class="ct-sub">Внесено документов: ${created}${renumbered?` · заменён номер у ${renumbered}`:''}${moved?` · комплектов на шаге «${e(step)}»: ${moved}`:''}</div></div>
 <div class="cp-drawer-content">${failed.length?`<h3>Не внесены (${failed.length})</h3>${failed.map(x=>`<p class="error">${e(x)}</p>`).join('')}`:'<p class="xi-ok">Всё отмеченное внесено.</p>'}</div>
 <div class="cp-drawer-foot"><button class="primary" type="button" data-action="dismiss">Готово</button></div></div>`;
}
