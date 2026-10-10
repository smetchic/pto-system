// Раздел «Договоры» (Ещё → Договоры): все договоры организации и боковая карточка договора.
// Здесь только разметка из данных; запись — команды pto_command (create_contract, update_contract, create_addendum, set_addendum_status).
import {escapeHtml as e,money,canWrite} from './domain.js';
import {objectColor,activeIn,expectedCards,openNotes} from './conveyor.js';
import {termPassed} from './object-page.js';
import {engineerName} from './portfolio.js';
import {contractTypes,referenceType} from './contracts-import.js';

// Наша роль по договору, как её называют в ПТО.
export const ourSide={contractor:'мы генподрядчик',subcontractor:'мы субподрядчик',customer:'мы генподрядчик',buyer:'мы покупатель',service_customer:'мы заказчик услуг'};
const sideNames={customer:'Заказчик',general_contractor:'Генподрядчик',subcontractor:'Субподрядчик',supplier:'Поставщик',service_provider:'Исполнитель услуг'};
// Группы списка: с заказчиком, субподряда, поставка и услуги.
export const contractGroup=c=>referenceType(c)?'ref':c.direction==='outgoing'?'out':['customer',null,undefined,''].includes(c.our_role)?'in':'other';
const GROUPS=[['out','С заказчиком'],['in','Субподряда'],['other','Поставка и услуги'],['ref','Справочно: договоры МПС с заказчиком и трёхсторонние']];
// Новый договор: пара ролей сторон, которую принимает create_contract.
export const contractKinds=[
 ['contractor:customer','С заказчиком, мы генподрядчик'],
 ['subcontractor:general_contractor','С генподрядчиком, мы субподрядчик'],
 ['customer:subcontractor','Субподряда, мы генподрядчик'],
 ['buyer:supplier','Поставка, мы покупатель'],
 ['service_customer:service_provider','Услуги, мы заказчик'],
];

const day=v=>v?new Date(String(v).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'Europe/Minsk'}):'';
const has=v=>v!==null&&v!==undefined&&v!=='';
const st=(text,cls='n',title='')=>`<span class="ob-st ${cls}"${title?` title="${e(title)}"`:''}>${e(text)}</span>`;
const draftsOf=(data,c)=>(data.addenda||[]).filter(a=>a.contract_id===c.id&&a.status==='draft');
const projectOf=(data,id)=>(data.projects||[]).find(p=>p.id===id);
const expired=(c,today)=>!!c.current_end_date&&c.current_end_date<today;
const workflowOf=(data,c)=>(data.workflows||[]).find(w=>w.contract_id===c.id&&w.template_code!=='c29');

// Завершённый договор: срок прошёл, в этом месяце по нему нет комплекта и нет допсоглашения в работе.
export const contractFinished=(data,c,today)=>expired(c,today)&&!workflowOf(data,c)&&!draftsOf(data,c).length;

// Состояние договора в выбранном месяце: шаг комплекта, ожидание, снятие или «не действует».
export function contractMonthState(data,c,month,expected=null){
 const w=workflowOf(data,c);
 if(w){const n=openNotes(w);return w.step_code==='accepted'?st('В бухгалтерии','ok'):st(w.step_label||'В работе',n.length?'e':w.step_code==='signed'?'b':'w',n.length?n[n.length-1].note:'');}
 const x=(expected||expectedCards(data,month)).find(z=>z.contract_id===c.id&&z.template_code!=='c29');
 if(x)return st(x.note==='прораб не сдал объёмы'?'Ждём объёмы · прораб не сдал':x.note||'Ожидается','n');
 const skip=(data.skips||[]).find(s=>s.contract_id===c.id&&s.template_code!=='c29');
 if(skip)return st('Снят'+(skip.reason?': '+skip.reason:''),'n');
 return activeIn(c,month)?'<span class="muted">—</span>':'<span class="muted">не действует</span>';
}

const searchText=(data,c)=>[c.number,c.party,c.subject,projectOf(data,c.project_id)?.name].join(' ').toLowerCase();
const seg=(action,value,items)=>`<div class="ct-seg" role="group">${items.map(([v,label])=>`<button type="button" class="${v===value?'on':''}" data-action="${action}" data-id="${v}" aria-pressed="${v===value}">${label}</button>`).join('')}</div>`;
const termCell=(c,today)=>{const t=termPassed(c,today);return t===null?'<span class="muted">—</span>':`<div class="ob-mini"><span class="${t>=90?'neg':'muted'}">прошло ${t} % срока</span><div class="ob-track"><i style="left:${t}%"></i></div></div>`;};

export function contractsList({data,ui,profile,today}){
 const q=ui.contractQuery||'',kind=ui.contractKind||'all',state=ui.contractState||'act',obj=ui.contractObject||'',month=ui.month;
 const expected=expectedCards(data,month);
 const all=(data.contracts||[]).filter(c=>(!obj||c.project_id===obj)&&(kind==='all'||contractGroup(c)===kind)&&(state==='any'||(state==='act')!==contractFinished(data,c,today)));
 const canAdd=['head','engineer'].includes(profile?.role)&&(data.projects||[]).some(p=>canWrite(profile,data.memberships,p.id)),canImport=profile?.role==='head';
 const row=c=>{const p=projectOf(data,c.project_id),drafts=draftsOf(data,c),text=searchText(data,c);
  return `<tr class="ct-row" data-search="${e(text)}" ${q&&!text.includes(q)?'hidden':''} data-action="contract" data-id="${e(c.id)}" tabindex="0" role="button">
 <td class="ct-nw"><b>№ ${e(c.number)}</b><small>${c.contract_date?'от '+e(day(c.contract_date)):''}${c.checked===false?' · <span class="ct-warn">не проверен</span>':''}</small></td>
 <td class="ct-nw"><i class="ct-dot" style="background:${objectColor(data.projects||[],c.project_id)}"></i>${e(p?.name||'')}<small>${e(engineerName(data,c.project_id)||'')}</small></td>
 <td>${e(c.party||'')}<small>${e([sideNames[c.counterparty_role],ourSide[c.our_role]].filter(Boolean).join(' · '))}</small></td>
 <td class="num">${has(c.current_amount)?money(c.current_amount):'<span class="muted">—</span>'}<small>${c.amount_addendum_number?'по ДС № '+e(c.amount_addendum_number):'по договору'}${drafts.length?` · <span class="ct-warn">ДС № ${drafts.map(a=>e(a.number)).join(', ')} в работе</span>`:''}</small></td>
 <td class="ct-nw">${!c.current_end_date?'<span class="muted">—</span>':expired(c,today)?st('Истёк '+day(c.current_end_date),'e'):e(day(c.current_end_date))}<small>${c.term_addendum_number?'по ДС № '+e(c.term_addendum_number):c.current_end_date?'по договору':''}</small></td>
 <td>${termCell(c,today)}</td>
 <td>${contractMonthState(data,c,month,expected)}</td></tr>`;};
 const groups=GROUPS.map(([g,label])=>[label,all.filter(c=>contractGroup(c)===g)]).filter(([,l])=>l.length);
 const live=(data.contracts||[]).filter(c=>!contractFinished(data,c,today));
 const sumOf=l=>l.reduce((t,c)=>t+(Number(c.current_amount)||0),0);
 const out=live.filter(c=>contractGroup(c)==='out'),sub=live.filter(c=>contractGroup(c)==='in');
 const late=live.filter(c=>expired(c,today)).length,ds=live.filter(c=>draftsOf(data,c).length).length;
 const monthLabel=new Date(month+'-01T12:00:00Z').toLocaleDateString('ru-RU',{month:'long',timeZone:'Europe/Minsk'});
 return `<div class="ob"><div class="heading"><div><h1>Договоры</h1><div class="muted">Все договоры организации. Стоимость и срок считаются по подписанным допсоглашениям.</div></div><div class="actions">${canImport?'<button data-action="contracts-json" data-id="">Загрузить из файла</button><input id="contracts-json" type="file" accept=".json,application/json" hidden>':''}${canAdd?'<button class="primary" data-action="new-contract" data-id="">Добавить договор</button>':''}</div></div>
 <div class="ct-toolbar"><input id="contract-search" class="cp-search" type="search" autocomplete="off" placeholder="Поиск по номеру, стороне или объекту" aria-label="Поиск договора" value="${e(q)}">
 ${seg('contract-kind',kind,[['all','Все'],['out','С заказчиком'],['in','Субподряда'],['other','Поставка и услуги'],['ref','Справочно']])}
 ${seg('contract-state',state,[['act','Действующие'],['done','Завершённые'],['any','Все']])}
 <select id="contract-object" aria-label="Объект"><option value="">Все объекты</option>${(data.projects||[]).map(p=>`<option value="${e(p.id)}" ${p.id===obj?'selected':''}>${e(p.name)}</option>`).join('')}</select></div>
 <div class="ct-sum"><span>С заказчиком <b>${out.length}</b> на <b>${money(sumOf(out))}</b></span><span>Субподряда <b>${sub.length}</b> на <b>${money(sumOf(sub))}</b></span>${late?`<span class="ct-bad">Срок истёк <b>${late}</b></span>`:''}${ds?`<span class="ct-warn">ДС в работе <b>${ds}</b></span>`:''}</div>
 <section class="table-wrap"><table class="ct-table"><thead><tr><th>Договор</th><th>Объект</th><th>Сторона</th><th class="num">Стоимость, руб.</th><th>Срок</th><th>Прошло срока</th><th>${e(monthLabel.replace(/^./,x=>x.toUpperCase()))}</th></tr></thead><tbody>
 ${groups.map(([label,l])=>`<tr class="ct-grp" ${q&&!l.some(c=>searchText(data,c).includes(q))?'hidden':''}><td colspan="7">${label}<span>${l.length}</span></td></tr>${l.map(row).join('')}`).join('')}
 <tr id="contract-empty" ${all.some(c=>!q||searchText(data,c).includes(q))?'hidden':''}><td colspan="7"><div class="empty cp-empty">${(data.contracts||[]).length?'Договоры не найдены.':'Договоров пока нет.'}</div></td></tr></tbody></table></section></div>`;
}

const head=(title,sub='')=>`<div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>${e(title)}</h2>${sub}</div>`;
const input=(name,label,value='',type='text',extra='')=>`<label>${e(label)}<input name="${e(name)}" type="${e(type)}" value="${e(value??'')}" autocomplete="off" ${extra}></label>`;
const amount=(name,label,value)=>input(name,label,has(value)?String(value):'','text','inputmode="decimal"');
const section=(title,body)=>`<section class="cp-section"><div class="cp-section-title">${title}</div>${body}</section>`;
const subLine=(data,c)=>`<div class="ct-sub">${c.contract_date?`от ${e(day(c.contract_date))} · `:''}<i class="ct-dot" style="background:${objectColor(data.projects||[],c.project_id)}"></i>${e(projectOf(data,c.project_id)?.name||'')}${ourSide[c.our_role]?' · '+e(ourSide[c.our_role]):''}</div>`;

// Маркеры под заголовком: действует ли договор, ДС в работе, заполнены ли цена и срок.
export function contractMarks(data,c,today){
 const m=[];
 if(!c.current_end_date)m.push(['off','Срок не указан']);
 else if(expired(c,today))m.push(contractFinished(data,c,today)?['ok',`Завершён ${day(c.current_end_date)}`]:['bad',`Срок истёк ${day(c.current_end_date)}, работы продолжаются`]);
 else m.push(['ok',`Действует до ${day(c.current_end_date)}`]);
 const drafts=draftsOf(data,c);
 if(drafts.length)m.push(['warn',`ДС № ${drafts.map(a=>a.number).join(', ')} в работе, в цене не учтено`]);
 if(!has(c.current_amount))m.push(['off','Цена не указана']);
 return m;
}

const addendumLine=(a,canEdit)=>{
 const what=[has(a.amount_after)?'цена → '+money(a.amount_after):'',a.work_end_date?'срок → '+day(a.work_end_date):''].filter(Boolean).join(', ');
 const pill=a.status==='signed'?'<span class="ob-st ok">Подписано</span>':a.status==='draft'?'<span class="ob-st w">В работе</span>':'<span class="ob-st">Отменено</span>';
 const acts=!canEdit?'':a.status==='draft'?`<button type="button" class="cp-small" data-action="sign-addendum" data-id="${e(a.id)}">Подписано</button><button type="button" class="link" data-action="cancel-addendum" data-id="${e(a.id)}">отменить</button>`:a.status==='signed'?`<button type="button" class="link" data-action="cancel-addendum" data-id="${e(a.id)}">отменить</button>`:'';
 return `<div class="ct-line ${a.status==='cancelled'?'off':''}"><div><b>ДС № ${e(a.number)}</b> <span class="muted">от ${e(day(a.agreement_date))}</span><small>${e([what,a.note].filter(Boolean).join(' · ')||'—')}</small></div><div class="ct-line-r">${pill}${acts?`<span class="ct-acts">${acts}</span>`:''}</div></div>`;
};

// Карточка договора — боковая панель общей ширины (--drawer-w). Просмотр; правка — по кнопке «Изменить».
export function contractCard({data,contract:c,canEdit,editing=false,today}){
 const parent=(data.contracts||[]).find(x=>x.id===c.parent_contract_id);
 if(canEdit&&editing){
  const parents=(data.contracts||[]).filter(x=>x.project_id===c.project_id&&x.id!==c.id&&x.direction==='outgoing');
  return `<form id="contract-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(`Договор № ${c.number}`,subLine(data,c))}
 <div class="cp-drawer-content">
  ${section('Договор',`<div class="cp-work-grid">${input('number','Номер',c.number,'text','required')}${input('contract_date','Дата',c.contract_date||'','date')}
   <div class="wide"><label>Сторона<span class="ct-ro">${e(c.party||'')} <span class="muted">${e(sideNames[c.counterparty_role]||'')}</span></span></label></div>
   <div class="wide">${input('subject','Предмет',c.subject||'')}</div>
   ${parents.length?`<div class="wide"><label>К основному договору<select name="parent_contract_id"><option value="">—</option>${parents.map(p=>`<option value="${e(p.id)}" ${p.id===c.parent_contract_id?'selected':''}>№ ${e(p.number)} · ${e(p.party||'')}</option>`).join('')}</select></label></div>`:`<input type="hidden" name="parent_contract_id" value="${e(c.parent_contract_id||'')}">`}</div>`)}
  ${section('Цена по договору, руб. (без допсоглашений)',`<div class="cp-work-grid">${amount('initial_amount','Цена с НДС',c.initial_amount)}${amount('vat_amount','В т. ч. НДС',c.vat_amount)}${amount('vat_rate','Ставка НДС, %',c.vat_rate)}<span></span>
   ${amount('smr_amount','СМР',c.smr_amount)}${amount('smr_vat_amount','НДС СМР',c.smr_vat_amount)}${amount('pnr_amount','ПНР',c.pnr_amount)}${amount('pnr_vat_amount','НДС ПНР',c.pnr_vat_amount)}${amount('equipment_amount','Оборудование',c.equipment_amount)}${amount('equipment_vat_amount','НДС оборудования',c.equipment_vat_amount)}</div>`)}
  ${section('Срок по договору',`<div class="cp-work-grid">${input('work_start_date','Начало работ',c.work_start_date||'','date')}${input('work_end_date','Окончание',c.work_end_date||'','date')}</div>`)}
  <p class="cp-hint">Текущие цена и срок меняются только подписанным допсоглашением. Сторона и объект договора не меняются.</p>
  <input type="hidden" name="contract_id" value="${e(c.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="contract" data-id="${e(c.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
 }
 const marks=contractMarks(data,c,today),t=termPassed(c,today);
 const addenda=(data.addenda||[]).filter(a=>a.contract_id===c.id).sort((a,b)=>String(b.agreement_date).localeCompare(String(a.agreement_date))||String(b.created_at).localeCompare(String(a.created_at)));
 const sub=`${subLine(data,c)}<div class="cp-ids">${c.counterparty_id?`<button type="button" class="cp-chip-copy" data-action="party" data-id="${e(c.counterparty_id)}" title="Открыть карточку контрагента">${e(c.party||'Контрагент')}</button>`:`<span class="cp-chip-copy">${e(c.party||'')}</span>`}<span class="muted ct-side">${e(sideNames[c.counterparty_role]||'')}</span></div>
 <div class="cp-marks">${marks.map(([k,text])=>`<span class="cp-mark ${k}"><i></i>${e(text)}</span>`).join('')}</div>`;
 const total=has(c.current_amount)?money(c.current_amount).replace(/,(\d\d)$/,'<small>,$1</small>'):'—';
 const terms=[['Цена по договору',c.initial_amount,c.vat_amount],['СМР',c.smr_amount,c.smr_vat_amount],['ПНР',c.pnr_amount,c.pnr_vat_amount],['Оборудование',c.equipment_amount,c.equipment_vat_amount]].filter(([,v])=>has(v));
 return `<form id="contract-form" class="cp-drawer-shell ob" autocomplete="off">${head(`Договор № ${c.number}`,sub)}
 <div class="cp-drawer-content">
  <div class="cp-total"><b>${total}</b><span>руб.${has(c.current_vat_amount)?' с НДС '+money(c.current_vat_amount):''}<br>${c.amount_addendum_number?`по ДС № ${e(c.amount_addendum_number)} от ${e(day(c.amount_addendum_date))}`:'по договору'}</span></div>
  ${t===null?'':`<div class="ct-term"><div class="ct-term-l"><span class="${t>=90&&!contractFinished(data,c,today)?'neg':''}">прошло ${t} % срока</span><span class="muted">${e(day(c.work_start_date||c.contract_date))} — ${e(day(c.current_end_date))}</span></div><div class="ob-track"><i style="left:${t}%"></i></div></div>`}
  <dl class="ct-kv">${c.subject?`<dt>Предмет</dt><dd>${e(c.subject)}</dd>`:''}<dt>Срок</dt><dd>${c.current_end_date||c.work_start_date?`${e(day(c.work_start_date)||'…')} — ${e(day(c.current_end_date)||'…')} <span class="muted">${c.term_addendum_number?'по ДС № '+e(c.term_addendum_number):'по договору'}</span>`:'<span class="muted">не указан</span>'}</dd>
  ${parent?`<dt>К договору</dt><dd><button type="button" class="link" data-action="contract" data-id="${e(parent.id)}">№ ${e(parent.number)}</button> <span class="muted">${e(parent.party||'')}</span></dd>`:''}
  <dt>Инженер</dt><dd>${e(engineerName(data,c.project_id)||'—')}</dd>
  ${c.contract_type?`<dt>Вид</dt><dd>${e(contractTypes[c.contract_type]||c.contract_type)}</dd>`:''}
  ${c.advance_current_percent||c.advance_target_amount?`<dt>Аванс</dt><dd>${[c.advance_current_percent?`текущий ${e(Number(c.advance_current_percent))} %`:'',c.advance_target_amount?`целевой ${money(c.advance_target_amount)}`:''].filter(Boolean).join(' · ')}</dd>`:''}
  ${c.replaced_by||c.note?`<dt>Примечание</dt><dd>${e([c.replaced_by?'заменён: '+c.replaced_by:'',c.note].filter(Boolean).join(' · '))}</dd>`:''}
  ${(c.files||[]).length?`<dt>Сканы</dt><dd>${c.files.map(f=>`<small class="ct-path">${e(f.path)}</small>`).join('')}</dd>`:''}</dl>
  ${c.checked===false?`<div class="ct-unchecked"><span class="ct-warn">Не проверен: загружен из реестра или имени файла. В «Подписании» и месяце не участвует, пока не отмечен.</span>${canEdit?`<button type="button" class="cp-small" data-action="contract-checked" data-id="${e(c.id)}">Проверен</button>`:''}</div>`:''}
  ${terms.length?`<section class="cp-block"><div class="cp-block-head"><h3>Условия договора</h3>${has(c.vat_rate)?`<span class="muted">НДС ${e(c.vat_rate)} %</span>`:''}</div>${terms.map(([label,v,vat])=>`<div class="ct-line"><span>${label}</span><span class="ct-line-r ct-one">${has(vat)?`<small>НДС ${money(vat)}</small>`:''}${money(v)}</span></div>`).join('')}</section>`:''}
  ${partsBlock(data,c,canEdit)}
  <section class="cp-block"><div class="cp-block-head"><h3>Допсоглашения</h3>${canEdit?`<button type="button" class="cp-small" data-action="new-addendum" data-id="${e(c.id)}">+ Допсоглашение</button>`:''}</div>${addenda.length?addenda.map(a=>addendumLine(a,canEdit)).join(''):'<div class="cp-no-data">Допсоглашений нет.</div>'}</section>
 </div>
 <div class="cp-drawer-foot"><span class="cp-foot-note">${c.created_at?'Внесён '+e(day(c.created_at)):''}</span>${canEdit?`<button class="primary" type="button" data-action="edit-contract" data-id="${e(c.id)}">Изменить</button>`:''}</div></form>`;
}

// Новый договор: объект, сторона из справочника контрагентов, роли сторон. Цену и срок вносят потом в карточке.
export function newContractCard({data,profile,projectId=''}){
 const projects=(data.projects||[]).filter(p=>canWrite(profile,data.memberships,p.id));
 const parties=[...(data.parties||[])].sort((a,b)=>String(a.short_name).localeCompare(String(b.short_name),'ru'));
 return `<form id="new-contract-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head('Новый договор')}
 <div class="cp-drawer-content"><div class="cp-work-grid">
  <div class="wide"><label>Объект<select name="project_id" required>${projects.length>1?'<option value="">Выберите объект</option>':''}${projects.map(p=>`<option value="${e(p.id)}" ${p.id===projectId?'selected':''}>${e(p.name)}</option>`).join('')}</select></label></div>
  <div class="wide"><label>Вид договора<select name="kind" required>${contractKinds.map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select></label></div>
  <div class="wide"><label>Сторона<select name="counterparty_id" required><option value="">Выберите из справочника</option>${parties.map(p=>`<option value="${e(p.id)}">${e(p.short_name)}${p.unp?' · УНП '+e(p.unp):''}</option>`).join('')}</select></label></div>
  ${input('number','Номер','','text','required')}${input('contract_date','Дата','','date')}
  <div class="wide">${input('subject','Предмет')}</div></div>
  <p class="cp-hint">Нет нужной организации — сначала добавьте её в «Ещё → Контрагенты». Цену и срок внесёте в карточке договора после сохранения.</p></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="dismiss">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
}
export function newContractPayload(form){
 const x=Object.fromEntries(form),[our_role,counterparty_role]=String(x.kind||'').split(':');
 delete x.kind;
 return {op:'create_contract',...x,our_role,counterparty_role};
}

// Допсоглашение: новое (проект или подписанное) и отмена с причиной — формы в той же панели.
// Части договора (ССР) со своей ставкой НДС: акты и С-3а по частям, комплект и статус общие (бриф, раздел 2).
export const partsOf=(data,contractId)=>(data.contractParts||[]).filter(p=>p.contract_id===contractId).sort((a,b)=>a.ordinal-b.ordinal);
export const vatLabel=p=>!has(p.vat_rate)?'НДС не указан':Number(p.vat_rate)===0?'без НДС':`НДС ${Number(p.vat_rate)} %`;
function partsBlock(data,c,canEdit){
 const parts=partsOf(data,c.id);
 if(!parts.length&&!canEdit)return '';
 return `<section class="cp-block"><div class="cp-block-head"><h3>Части договора</h3>${canEdit?`<button type="button" class="cp-small" data-action="new-part" data-id="${e(c.id)}">+ Часть</button>`:''}</div>${parts.length?parts.map(p=>`<div class="ct-line${p.active?'':' muted'}"${canEdit?` data-action="edit-part" data-id="${e(p.id)}" role="button" tabindex="0"`:''}><span>${e(p.name)}${p.active?'':' · не действует'}</span><span class="ct-line-r ct-one"><small>${e(vatLabel(p))}</small>${has(p.amount)?money(p.amount):''}</span></div>`).join(''):'<div class="cp-no-data">Одна часть: акты и справка С-3а на весь договор.</div>'}</section>`;
}
export function partCard({data,contract:c,part:p}){
 return `<form id="part-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(p?`Часть договора № ${c.number}`:`Новая часть договора № ${c.number}`,subLine(data,c))}
 <div class="cp-drawer-content"><div class="cp-work-grid">
  <div class="wide">${input('name','Название (как в ССР)',p?.name||'','text','required maxlength="200"')}</div>
  ${amount('vat_rate','Ставка НДС, % (0 — без НДС)',p?.vat_rate)}${amount('amount','Стоимость части, руб.',p?.amount)}
  ${p?`<div class="wide"><label>Состояние<select name="active"><option value="true">Действует</option><option value="false" ${p.active?'':'selected'}>Не действует</option></select></label></div>`:''}</div>
  <p class="cp-hint">Акт и справку С-3а относят к части в карточке документа («Отметки»). В реестре строка на каждую часть и «Итого по договору».</p>
  <input type="hidden" name="${p?'part_id':'contract_id'}" value="${e(p?p.id:c.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="contract" data-id="${e(c.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
}
export function addendumCard({data,contract:c}){
 return `<form id="addendum-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(`Допсоглашение к договору № ${c.number}`,subLine(data,c))}
 <div class="cp-drawer-content"><div class="cp-work-grid">
  ${input('number','Номер ДС','','text','required')}${input('agreement_date','Дата ДС','','date','required')}
  <div class="wide"><label>Состояние<select name="status"><option value="draft">В работе (в цене не учитывается)</option><option value="signed">Подписано</option></select></label></div>
  ${amount('amount_after','Цена договора после ДС, руб.','')}${amount('vat_amount','В т. ч. НДС, руб.','')}
  ${amount('vat_rate','Ставка НДС, %','')}${input('work_end_date','Новый срок окончания','','date')}
  <div class="wide">${input('note','Что меняет')}</div></div>
  <p class="cp-hint">Цену и срок договора меняет только подписанное допсоглашение. Пустые поля значит «не меняется».</p>
  <input type="hidden" name="contract_id" value="${e(c.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="contract" data-id="${e(c.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
}
export function addendumStatusCard({data,contract:c,addendum:a,status}){
 const cancel=status==='cancelled';
 return `<form id="addendum-status-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(`${cancel?'Отменить':'Подписано:'} ДС № ${a.number}`,subLine(data,c))}
 <div class="cp-drawer-content">${cancel?`<div class="cp-work-grid"><div class="wide">${input('reason','Причина отмены','','text','required minlength="5"')}</div></div>`:''}
  <p class="cp-hint">${cancel?'Отменённое допсоглашение не учитывается в цене и сроке договора. Запись остаётся в истории.':'После подписания цена и срок договора пересчитаются по этому допсоглашению.'}</p>
  <input type="hidden" name="addendum_id" value="${e(a.id)}"><input type="hidden" name="status" value="${status}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="contract" data-id="${e(c.id)}">Назад</button><button class="primary" type="submit">${cancel?'Отменить ДС':'Подтвердить'}</button></div></form>`;
}

// Карточка объекта в «Ещё → Объекты»: просмотр и правка названия, полного наименования и адреса (правит начальник ПТО).
// Инженер назначается в «Команда и права»; работа по объекту — на его странице («Открыть объект»).
export function objectCard({data,project:p,canEdit,editing=false}){
 const dot=`<i class="ct-dot" style="background:${objectColor(data.projects||[],p.id)}"></i>`;
 if(canEdit&&editing)return `<form id="project-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(p.name,`<div class="ct-sub">${dot}Объект</div>`)}
 <div class="cp-drawer-content">${section('Объект',`<div class="cp-work-grid"><div class="wide">${input('name','Краткое название',p.name,'text','required maxlength="120"')}</div>
  <div class="wide">${input('full_name','Полное наименование',p.full_name||'','text','maxlength="500"')}</div><div class="wide">${input('address','Адрес',p.address||'')}</div></div>`)}
  <p class="cp-hint">Краткое название видно в Портфеле, «Подписании» и реестрах. Ответственного инженера назначают в «Команда и права».</p>
  <input type="hidden" name="project_id" value="${e(p.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="object-card" data-id="${e(p.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
 const list=(data.contracts||[]).filter(c=>c.project_id===p.id);
 const count=g=>list.filter(c=>contractGroup(c)===g).length,unchecked=list.filter(c=>c.checked===false).length;
 const counts=GROUPS.map(([g,label])=>[label.replace(/:.*$/,''),count(g)]).filter(([,n])=>n);
 return `<div class="cp-drawer-shell ob">${head(p.name,`<div class="ct-sub">${dot}Объект</div>`)}
 <div class="cp-drawer-content"><dl class="ct-kv"><dt>Полное наименование</dt><dd>${e(p.full_name||'—')}</dd><dt>Адрес</dt><dd>${p.address?e(p.address):'<span class="muted">не указан</span>'}</dd>
  <dt>Инженер</dt><dd>${e(engineerName(data,p.id)||'—')}</dd>
  <dt>Договоры</dt><dd>${list.length?counts.map(([label,n])=>`${e(label)}: ${n}`).join(' · ')+(unchecked?` <span class="ct-warn">не проверено: ${unchecked}</span>`:''):'<span class="muted">нет</span>'}</dd></dl></div>
 <div class="cp-drawer-foot"><span class="cp-foot-note">${p.created_at?'Внесён '+e(day(p.created_at)):''}</span><button type="button" data-action="project" data-id="${e(p.id)}">Открыть объект</button>${canEdit?`<button class="primary" type="button" data-action="edit-object" data-id="${e(p.id)}">Изменить</button>`:''}</div></div>`;
}
