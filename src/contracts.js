// Раздел «Договоры» (раздел «Договоры»): все договоры организации и боковая карточка договора.
// Здесь только разметка из данных; запись — команды pto_command (create_contract, update_contract, create_addendum, set_addendum_status).
import {escapeHtml as e,money,canWrite,moneyText,vatInfo} from './domain.js';
import {objectColor,OBJECT_COLORS,COLOR_NAMES,activeIn,expectedCards,openNotes} from './conveyor.js';
import {engineerName} from './portfolio.js';

// Уровень договора — место в цепочке объекта; роли сторон (решение 11.10.2026, docs/contracts.md).
export const SIDE_NAMES={customer:'Заказчик',general_contractor:'Генподрядчик',contractor:'Подрядчик',subcontractor:'Субподрядчик',service_provider:'Исполнитель'};
// Уровни и роли (решение пользователя 11.10.2026). Генподрядчик МПС: 1 заказчик — МПС, 2 МПС — СУ-22 (субподрядчик), 3 СУ-22 — исполнитель (наш субподрядчик).
// Генподрядчик СУ-22: 1 заказчик — СУ-22, 2 СУ-22 — субподрядчик. 4 — трёхсторонние, СУ-22 третья сторона. «Подрядчик» сам не назначается.
export const LEVELS=[[1,'Заказчик — генподрядчик'],[2,'Генподрядчик — субподрядчик'],[3,'Субподрядчик — исполнитель'],[4,'Трёхсторонний, СУ-22 третья сторона']];
// Уровень и роли из базы (миграция 20261011100000); до неё — по прежним ролям, как переносит миграция.
export function sidesOf(c,data={}){
 if(c.chain_level)return {level:c.chain_level,our:c.our_side||null,party:c.party_side||null};
 if(c.contract_type==='mps_customer')return {level:1,our:null,party:'customer'};
 if(c.contract_type==='mps_su22_sub')return {level:4,our:null,party:'subcontractor'};
 if(c.counterparty_role==='customer')return {level:1,our:'general_contractor',party:'customer'};
 if(c.counterparty_role==='general_contractor')return {level:2,our:'subcontractor',party:'general_contractor'};
 if(['service_provider','supplier'].includes(c.counterparty_role))return {level:2,our:'customer',party:'service_provider'};
 const top=(data.contracts||[]).some(x=>x.project_id===c.project_id&&(x.counterparty_role==='general_contractor'||x.contract_type==='mps_customer'));
 return top?{level:3,our:'subcontractor',party:'service_provider'}:{level:2,our:'general_contractor',party:'subcontractor'};
}
// «СУ-22 — субподрядчик»: роль СУ-22 по договору.
export const ourSideLabel=(c,data)=>{const x=sidesOf(c,data);return x.our?`СУ-22 — ${SIDE_NAMES[x.our].toLowerCase()}`:x.level===4?'СУ-22 — третья сторона':'СУ-22 не сторона договора';};
// Группы списка от лица СУ-22 вместо «Уровень N» (решение 11.10.2026, демо «Договоры и ДС» v4). Внешний генподрядчик — МПС.
export const GROUPS=[
 ['top','Заказчик и МПС','СУ-22 не сторона, для справки'],
 ['customer','Наш договор с заказчиком','СУ-22 генподрядчик'],
 ['gc','Наш договор с МПС','СУ-22 субподрядчик'],
 ['exec','Наши исполнители','нанимает СУ-22'],
 ['sub','Наши субподрядчики','нанимает СУ-22'],
 ['service','Услуги для СУ-22','СУ-22 заказчик'],
 ['tri','Трёхсторонние с МПС','СУ-22 третья сторона, в итоги не входят'],
];
export function contractGroup(c,data){
 const x=sidesOf(c,data);
 if(x.level===1)return x.our?'customer':'top';
 if(x.level===3)return 'exec';
 if(x.level===4)return 'tri';
 return x.our==='subcontractor'?'gc':x.our==='customer'?'service':'sub';
}
export const groupName=(c,data)=>GROUPS.find(([g])=>g===contractGroup(c,data))?.[1]||'';
// Группы с договорами по порядку GROUPS: [название, договоры, пояснение].
export const groupsOf=(data,list)=>GROUPS.map(([g,label,hint])=>[label,list.filter(c=>contractGroup(c,data)===g).sort(byDate),hint]).filter(([,l])=>l.length);
// Новый договор: пара прежних ролей, которую принимает create_contract; уровень и роли база выводит сама, их можно поправить в карточке.
export const contractKinds=[
 ['subcontractor:general_contractor','С генподрядчиком, СУ-22 — субподрядчик'],
 ['customer:subcontractor','С привлечённой организацией (исполнитель или субподрядчик)'],
 ['contractor:customer','С заказчиком, СУ-22 — генподрядчик'],
 ['service_customer:service_provider','Услуги, СУ-22 — заказчик'],
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
// Внутри группы — по дате договора, сначала старые; без даты в конце.
export const byDate=(a,b)=>(a.contract_date?0:1)-(b.contract_date?0:1)||String(a.contract_date||'').localeCompare(String(b.contract_date||''))||String(a.number).localeCompare(String(b.number),'ru',{numeric:true});
// Допсоглашения в строке списка: кнопка «N допсоглашений · M в работе» раскрывает их строками под договором.
const addendaOf=(data,c)=>(data.addenda||[]).filter(a=>a.contract_id===c.id).sort((a,b)=>String(a.agreement_date).localeCompare(String(b.agreement_date))||String(a.created_at).localeCompare(String(b.created_at)));
const plural=n=>n%10===1&&n%100!==11?'допсоглашение':n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'допсоглашения':'допсоглашений';
const addendumWhat=a=>[has(a.amount_after)?'цена → '+money(a.amount_after):'',a.work_end_date?'срок → '+day(a.work_end_date):'',a.note].filter(Boolean).join(' · ');
const addendumPill=a=>a.status==='draft'?'<span class="ob-st w">В работе</span>':a.status==='cancelled'?'<span class="ob-st">Отменено</span>':'<span class="ob-st ok">Подписано</span>';
export function addendaCell(data,c,open){
 const l=addendaOf(data,c),w=l.filter(a=>a.status==='draft').length;
 if(!l.length)return '<span class="muted">нет</span>';
 return `<button type="button" class="ct-ds-btn${open?' on':''}" data-action="contract-ds" data-id="${e(c.id)}" aria-expanded="${open}">${l.length} ${plural(l.length)}${w?` · <span class="ct-warn">${w} в работе</span>`:''} ${open?'▾':'▸'}</button>`;
}
// Строки ДС под договором; search — тот же текст, что у строки договора, чтобы поиск прятал их вместе.
export function addendaRows(data,c,cols,search='',hidden=false){
 return `<tr class="ct-ds"${search?` data-search="${e(search)}"`:''}${hidden?' hidden':''}><td></td><td colspan="${cols-1}">${addendaOf(data,c).map(a=>`<div class="ct-ds-l${a.status==='cancelled'?' off':''}"><b>ДС № ${e(a.number)}</b><span class="muted">${e(day(a.agreement_date))}</span><span>${e(addendumWhat(a)||'—')}</span>${addendumPill(a)}</div>`).join('')}</td></tr>`;
}
// Ячейки начала и окончания работ: истёкший срок — мелкая серая пометка, изменённый ДС — «по ДС № N».
export const startCell=c=>c.work_start_date?e(day(c.work_start_date)):'<span class="muted">—</span>';
export const endCell=(c,today)=>!c.current_end_date?'<span class="muted">—</span>':`${e(day(c.current_end_date))}${c.term_addendum_number?`<small>по ДС № ${e(c.term_addendum_number)}</small>`:''}${expired(c,today)?'<small>срок истёк</small>':''}`;

export function contractsList({data,ui,profile,today}){
 const q=ui.contractQuery||'',kind=GROUPS.some(([g])=>g===ui.contractKind)?ui.contractKind:'all',open=ui.contractDs||{},state=ui.contractState||'act',obj=ui.contractObject||'';
 // Отбор из «Сегодня»: не проверенные или без цены или срока.
 const flag={unchecked:['Не проверенные',c=>c.checked===false],noterms:['Без цены или срока',c=>c.checked!==false&&(!has(c.current_amount)||!c.current_end_date)]}[ui.contractFlag];
 const all=(data.contracts||[]).filter(c=>(!obj||c.project_id===obj)&&(kind==='all'||contractGroup(c,data)===kind)&&(flag?flag[1](c):state==='any'||(state==='act')!==contractFinished(data,c,today)));
 const canAdd=['head','engineer'].includes(profile?.role)&&(data.projects||[]).some(p=>canWrite(profile,data.memberships,p.id)),canImport=profile?.role==='head';
 const row=c=>{const p=projectOf(data,c.project_id),text=searchText(data,c);
  return `<tr class="ct-row${contractFinished(data,c,today)?' ct-off':''}" data-search="${e(text)}" ${q&&!text.includes(q)?'hidden':''} data-action="contract" data-id="${e(c.id)}" tabindex="0" role="button">
 <td class="ct-nw"><b>№ ${e(c.number)}</b><small>${c.contract_date?'от '+e(day(c.contract_date)):''}${c.checked===false?' · <span class="ct-warn">не проверен</span>':''}</small></td>
 <td class="ct-nw"><i class="ct-dot" style="background:${objectColor(data.projects||[],c.project_id)}"></i>${e(p?.name||'')}<small>${e(engineerName(data,c.project_id)||'')}</small></td>
 <td>${e(c.party||'')}</td><td class="ct-subj">${e(c.subject||'')}</td>
 <td class="num">${has(c.current_amount)?money(c.current_amount):'<span class="muted">—</span>'}<small>${c.amount_addendum_number?'по ДС № '+e(c.amount_addendum_number):'по договору'}</small></td>
 <td class="ct-nw">${endCell(c,today)}</td><td class="ct-nw">${addendaCell(data,c,!!open[c.id])}</td></tr>${open[c.id]?addendaRows(data,c,7,text,!!q&&!text.includes(q)):''}`;};
 const groups=groupsOf(data,all);
 const present=GROUPS.filter(([g])=>(data.contracts||[]).some(c=>contractGroup(c,data)===g));
 const live=(data.contracts||[]).filter(c=>!contractFinished(data,c,today));
 const late=live.filter(c=>expired(c,today)).length,ds=live.filter(c=>draftsOf(data,c).length).length;
 return `<div class="ob"><div class="heading"><div><h1>Договоры</h1><div class="muted">Все договоры организации по месту СУ-22 в цепочке объекта. Стоимость и срок считаются по подписанным допсоглашениям.</div></div><div class="actions">${canImport?'<button data-action="contracts-json" data-id="">Загрузить из файла</button><input id="contracts-json" type="file" accept=".json,application/json" hidden>':''}${canAdd?'<button class="primary" data-action="new-contract" data-id="">Добавить договор</button>':''}</div></div>
 <div class="ct-toolbar"><input id="contract-search" class="cp-search" type="search" autocomplete="off" placeholder="Поиск по номеру, контрагенту, предмету или объекту" aria-label="Поиск договора" value="${e(q)}">
 ${seg('contract-kind',kind,[['all','Все'],...present.map(([g,label])=>[g,label])])}
 ${seg('contract-state',state,[['act','Действующие'],['done','Завершённые'],['any','Все']])}
 <select id="contract-object" aria-label="Объект"><option value="">Все объекты</option>${(data.projects||[]).map(p=>`<option value="${e(p.id)}" ${p.id===obj?'selected':''}>${e(p.name)}</option>`).join('')}</select></div>
 ${flag?`<div class="ct-flag">Отбор: <b>${flag[0]}</b> · ${all.length} <button class="link" data-action="contract-flag" data-id="">Показать все</button></div>`:''}
 <div class="ct-sum"><span>Действующих <b>${live.length}</b></span>${late?`<span>Срок истёк, работы продолжаются <b>${late}</b></span>`:''}${ds?`<span class="ct-warn">ДС в работе <b>${ds}</b></span>`:''}</div>
 <section class="table-wrap"><table class="ct-table"><thead><tr><th>Договор</th><th>Объект</th><th>Контрагент</th><th>Предмет договора</th><th class="num">Стоимость, руб.</th><th>Окончание работ</th><th>Допсоглашения</th></tr></thead><tbody>
 ${groups.map(([label,l,hint])=>`<tr class="ct-grp" ${q&&!l.some(c=>searchText(data,c).includes(q))?'hidden':''}><td colspan="7"><span class="ct-grp-l">${label}</span> <span class="ct-grp-h">${hint}</span><span class="ct-grp-n">${l.length}</span></td></tr>${l.map(row).join('')}`).join('')}
 <tr id="contract-empty" ${all.some(c=>!q||searchText(data,c).includes(q))?'hidden':''}><td colspan="7"><div class="empty cp-empty">${(data.contracts||[]).length?'Договоры не найдены.':'Договоров пока нет.'}</div></td></tr></tbody></table></section></div>`;
}

const head=(title,sub='')=>`<div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>${e(title)}</h2>${sub}</div>`;
const input=(name,label,value='',type='text',extra='')=>`<label>${e(label)}<input name="${e(name)}" type="${e(type)}" value="${e(value??'')}" autocomplete="off" ${extra}></label>`;
// Многострочное поле, высота по тексту (полное наименование, предмет, примечание).
const area=(name,label,value='',extra='')=>`<label>${e(label)}<textarea class="cp-auto" name="${e(name)}" rows="1" ${extra}>${e(value??'')}</textarea></label>`;
// Сумма — с разделителем тысяч (domain.js moneyText; на сервер main.js отправляет без пробелов).
const MONEY_ATTRS='inputmode="decimal" data-money pattern="\\s*-?[0-9 \\u00a0]*([.,][0-9]{0,2})?\\s*" title="Сумма, например 1 234 567,89"';
const amount=(name,label,value)=>input(name,label,has(value)?moneyText(value):'','text',MONEY_ATTRS);
const percent=(name,label,value)=>input(name,label,has(value)?String(value):'','text','inputmode="decimal"');
// НДС с посчитанной ставкой рядом с подписью: ставка = НДС / (сумма − НДС); красным, если не 20 % (main.js обновляет при вводе).
const vatAmount=(name,label,value,of)=>`<label>${e(label)} <small class="cp-rate" data-rate-of="${e(of)}" data-rate-vat="${e(name)}"></small><input name="${e(name)}" type="text" value="${e(has(value)?moneyText(value):'')}" autocomplete="off" ${MONEY_ATTRS}></label>`;
export const rateHtml=(total,vat)=>{const r=vatInfo(total,vat);return r?`<small class="cp-rate${r.ok?'':' bad'}" title="${r.ok?'Ставка посчитана по сумме и НДС':'НДС не равен 20 % от суммы: проверьте'}">${e(r.text)}</small>`:'';};
// «Выбрать файл…»: путь от папки ДОГОВОРА подставляется в поле (main.js, folder-pick.js); окно открывается в папке договора.
const pickButton=(field,c)=>`<button type="button" class="cp-small cp-pick" data-action="pick-file" data-id="${e(field)}" data-base="${e(c.source_key||'')}">Выбрать файл…</button>`;
const section=(title,body)=>`<section class="cp-section"><div class="cp-section-title">${title}</div>${body}</section>`;
const options=(list,cur)=>list.map(([v,label])=>`<option value="${e(v)}" ${String(v)===String(cur??'')?'selected':''}>${e(label)}</option>`).join('');
const subLine=(data,c)=>`<div class="ct-sub">${c.contract_date?`от ${e(day(c.contract_date))} · `:''}<i class="ct-dot" style="background:${objectColor(data.projects||[],c.project_id)}"></i>${e(projectOf(data,c.project_id)?.name||'')} · ${e(groupName(c,data))} · ${e(ourSideLabel(c,data))}</div>`;

// Маркеры под заголовком: действует ли договор, ДС в работе, заполнены ли цена и срок. Истёкший срок — серым, без тревоги.
export function contractMarks(data,c,today){
 const m=[];
 if(!c.current_end_date)m.push(['off','Срок не указан']);
 else if(expired(c,today))m.push(contractFinished(data,c,today)?['off',`Завершён ${day(c.current_end_date)}`]:['off',`Срок истёк ${day(c.current_end_date)}, работы продолжаются`]);
 else m.push(['ok',`Действует до ${day(c.current_end_date)}`]);
 const drafts=draftsOf(data,c);
 if(drafts.length)m.push(['warn',`ДС № ${drafts.map(a=>a.number).join(', ')} в работе, в цене не учтено`]);
 if(!has(c.current_amount))m.push(['off','Цена не указана']);
 return m;
}

// Строка ДС: номер, дата, что меняет; «В работе», пока нет скана. Скан приложен — подписано, плашки нет. Клик — правка.
const addendumLine=(a,canEdit)=>{
 const what=[has(a.amount_after)?'цена → '+money(a.amount_after):'',a.work_end_date?'срок → '+day(a.work_end_date):''].filter(Boolean).join(', ');
 const pill=a.status==='draft'?'<span class="ob-st w">В работе</span>':a.status==='cancelled'?'<span class="ob-st">Отменено</span>':'';
 const open=canEdit&&a.status!=='cancelled'?` data-action="edit-addendum" data-id="${e(a.id)}" role="button" tabindex="0"`:'';
 return `<div class="ct-line ${a.status==='cancelled'?'off':''}${open?' ct-click':''}"${open}><div><b>ДС № ${e(a.number)}</b> <span class="muted">от ${e(day(a.agreement_date))}</span><small>${e([what,a.note].filter(Boolean).join(' · ')||'—')}</small>${a.scan_path?`<small class="ct-path" title="${e(a.scan_path)}">${e(a.scan_path)}</small>`:''}</div><div class="ct-line-r">${pill}</div></div>`;
};

// Карточка договора — боковая панель общей ширины (--drawer-w). Просмотр; правка — по кнопке «Изменить».
export function contractCard({data,contract:c,canEdit,editing=false,today,profile=null}){
 const parent=(data.contracts||[]).find(x=>x.id===c.parent_contract_id),x=sidesOf(c,data);
 const rs=(data.retentionSummary||[]).find(r=>r.contract_id===c.id);
 if(canEdit&&editing){
  const parents=(data.contracts||[]).filter(k=>k.project_id===c.project_id&&k.id!==c.id).sort(byDate);
  const projects=(data.projects||[]).filter(p=>p.id===c.project_id||!profile||canWrite(profile,data.memberships,p.id));
  const parties=[...(data.parties||[])].sort((a,b)=>String(a.short_name).localeCompare(String(b.short_name),'ru'));
  const sides=Object.entries(SIDE_NAMES);
  return `<form id="contract-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(`Договор № ${c.number}`,subLine(data,c))}
 <div class="cp-drawer-content">
  ${section('Договор',`<div class="cp-work-grid">${input('number','Номер',c.number,'text','required')}${input('contract_date','Дата',c.contract_date||'','date')}
   <div class="wide"><label>Объект${c.has_documents?`<span class="ct-ro">${e(projectOf(data,c.project_id)?.name||'')} <span class="muted">по договору есть документы, объект не меняется</span></span><input type="hidden" name="project_id" value="${e(c.project_id)}">`:`<select name="project_id">${options(projects.map(p=>[p.id,p.name]),c.project_id)}</select>`}</label></div>
   <div class="wide"><label>Контрагент<select name="counterparty_id" ${c.counterparty_id?'required':''}>${c.counterparty_id?'':`<option value="">${e(c.party||'Не из справочника')}</option>`}${options(parties.map(p=>[p.id,p.short_name+(p.unp?' · УНП '+p.unp:'')]),c.counterparty_id)}</select></label></div>
   <div class="wide"><label>Место в цепочке<select name="chain_level">${options(LEVELS,x.level)}</select></label></div>
   <label>Роль СУ-22<select name="our_side"><option value="">не сторона / третья сторона</option>${options(sides,x.our)}</select></label>
   <label>Роль стороны<select name="party_side">${options(sides,x.party)}</select></label>
   ${input('our_role_title','СУ-22 в договоре',c.our_role_title||'','text','maxlength="100" placeholder="как написано в договоре"')}${input('party_role_title','Контрагент в договоре',c.party_role_title||'','text','maxlength="100" placeholder="как написано в договоре"')}
   <div class="wide">${area('subject','Предмет',c.subject||'','maxlength="1000"')}</div>
   <div class="wide"><label>К основному договору<select name="parent_contract_id"><option value="">—</option>${parents.map(p=>`<option value="${e(p.id)}" ${p.id===c.parent_contract_id?'selected':''}>№ ${e(p.number)} · ${e(p.party||'')}</option>`).join('')}</select></label></div></div>`)}
  ${section('Цена по договору, руб. (без допсоглашений)',`<div class="cp-work-grid">${amount('initial_amount','Цена с НДС',c.initial_amount)}${vatAmount('vat_amount','В т. ч. НДС',c.vat_amount,'initial_amount')}
   ${amount('smr_amount','СМР',c.smr_amount)}${vatAmount('smr_vat_amount','НДС СМР',c.smr_vat_amount,'smr_amount')}${amount('pnr_amount','ПНР',c.pnr_amount)}${vatAmount('pnr_vat_amount','НДС ПНР',c.pnr_vat_amount,'pnr_amount')}${amount('equipment_amount','Оборудование',c.equipment_amount)}${vatAmount('equipment_vat_amount','НДС оборудования',c.equipment_vat_amount,'equipment_amount')}
   <p class="wide cp-sum-check" data-sum-check="initial_amount:smr_amount,pnr_amount,equipment_amount;vat_amount:smr_vat_amount,pnr_vat_amount,equipment_vat_amount"></p></div>`)}
  ${section('Срок по договору',`<div class="cp-work-grid">${input('work_start_date','Начало работ',c.work_start_date||'','date')}${input('work_end_date','Окончание работ',c.work_end_date||'','date')}</div>`)}
  ${section('Аванс и прочее',`<div class="cp-work-grid">${percent('advance_current_percent','Текущий аванс, %',c.advance_current_percent)}${amount('advance_target_amount','Целевой аванс, руб.',c.advance_target_amount)}
   <div class="wide">${area('note','Примечание',c.note||'','maxlength="1000"')}</div>
   <label>Проверен<select name="checked">${options([['true','Да, проверен'],['false','Нет, не проверен']],String(c.checked!==false))}</select></label></div>`)}
  ${section('Гарантийное удержание',`<div class="cp-work-grid">${percent('retention_percent','Удержание, % (пусто — нет)',rs?.percent)}<label>База<select name="retention_base">${options([['net','СМР без НДС (по закону)'],['gross','СМР с НДС']],rs?.base||'net')}</select></label>
   ${percent('retention_first_share','Первый возврат, %',rs?.first_share??50)}${input('retention_first_years','через, лет после ввода',String(rs?.first_years??1),'number','min="0" max="10"')}
   ${input('retention_final_years','Остаток через, лет после ввода',String(rs?.final_years??2),'number','min="0" max="10"')}</div>`)}
  ${section('Файлы в папке ДОГОВОРА',`<div class="cp-work-grid"><div class="wide">${area('files','Пути к файлам, по одному в строке',(c.files||[]).map(f=>f.path).join('\n'),'maxlength="20000"')}</div><div class="wide">${pickButton('files',c)}</div></div>`)}
  <p class="cp-hint">Текущие цена и срок считаются по подписанным допсоглашениям (у которых указан скан), их здесь не правят. Не проверенный договор не участвует в «Подписании».</p>
  <input type="hidden" name="contract_id" value="${e(c.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="contract" data-id="${e(c.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
 }
 const marks=contractMarks(data,c,today);
 const addenda=addendaOf(data,c),wip=addenda.filter(a=>a.status==='draft').length,signed=addenda.filter(a=>a.status==='signed').length;
 const sub=`${subLine(data,c)}<div class="cp-ids">${c.counterparty_id?`<button type="button" class="cp-chip-copy" data-action="party" data-id="${e(c.counterparty_id)}" title="Открыть карточку контрагента">${e(c.party||'Контрагент')}</button>`:`<span class="cp-chip-copy">${e(c.party||'')}</span>`}<span class="muted ct-side">${e(SIDE_NAMES[x.party]||'')}</span></div>
 <div class="cp-marks">${marks.map(([k,text])=>`<span class="cp-mark ${k}"><i></i>${e(text)}</span>`).join('')}</div>`;
 const total=has(c.current_amount)?money(c.current_amount).replace(/,(\d\d)$/,'<small>,$1</small>'):'—';
 const terms=[['Цена по договору',c.initial_amount,c.vat_amount],['СМР',c.smr_amount,c.smr_vat_amount],['ПНР',c.pnr_amount,c.pnr_vat_amount],['Оборудование',c.equipment_amount,c.equipment_vat_amount]].filter(([,v])=>has(v));
 return `<form id="contract-form" class="cp-drawer-shell ob" autocomplete="off">${head(`Договор № ${c.number}`,sub)}
 <div class="cp-drawer-content">
  <div class="cp-total"><b>${total}</b><span>руб.${has(c.current_vat_amount)?' с НДС '+money(c.current_vat_amount):''}<br>${c.amount_addendum_number?`по ДС № ${e(c.amount_addendum_number)} от ${e(day(c.amount_addendum_date))}`:'по договору'}</span></div>
  <dl class="ct-kv">${c.subject?`<dt>Предмет</dt><dd>${e(c.subject)}</dd>`:''}<dt>Начало работ</dt><dd>${c.work_start_date?e(day(c.work_start_date)):'<span class="muted">не указано</span>'}</dd>
  <dt>Окончание работ</dt><dd>${c.current_end_date?`${e(day(c.current_end_date))} <span class="muted">${c.term_addendum_number?'по ДС № '+e(c.term_addendum_number):'по договору'}${expired(c,today)?' · срок истёк':''}</span>`:'<span class="muted">не указано</span>'}</dd>
  ${parent?`<dt>К договору</dt><dd><button type="button" class="link" data-action="contract" data-id="${e(parent.id)}">№ ${e(parent.number)}</button> <span class="muted">${e(parent.party||'')}</span></dd>`:''}
  ${c.our_role_title||c.party_role_title?`<dt>В договоре</dt><dd>${e([c.our_role_title?'СУ-22 — '+c.our_role_title:'',c.party_role_title?'контрагент — '+c.party_role_title:''].filter(Boolean).join(' · '))}</dd>`:''}
  <dt>Инженер</dt><dd>${e(engineerName(data,c.project_id)||'—')}</dd>
  ${c.advance_current_percent||c.advance_target_amount?`<dt>Аванс</dt><dd>${[c.advance_current_percent?`текущий ${e(Number(c.advance_current_percent))} %`:'',c.advance_target_amount?`целевой ${money(c.advance_target_amount)}`:''].filter(Boolean).join(' · ')}</dd>`:''}
  ${c.replaced_by||c.note?`<dt>Примечание</dt><dd>${e([c.replaced_by?'заменён: '+c.replaced_by:'',c.note].filter(Boolean).join(' · '))}</dd>`:''}
  ${(c.files||[]).length?`<dt>Файлы</dt><dd>${c.files.map(f=>`<small class="ct-path">${e(f.path)}</small>`).join('')}</dd>`:''}</dl>
  ${c.checked===false?`<div class="ct-unchecked"><span class="ct-warn">Не проверен: загружен из реестра или имени файла. В «Подписании» не участвует, пока не отмечен.</span>${canEdit?`<button type="button" class="cp-small" data-action="contract-checked" data-id="${e(c.id)}">Проверен</button>`:''}</div>`:''}
  ${terms.length?`<section class="cp-block"><div class="cp-block-head"><h3>Условия договора</h3></div>${terms.map(([label,v,vat])=>`<div class="ct-line"><span>${label}</span><span class="ct-line-r ct-one">${has(vat)?`<small>НДС ${money(vat)} ${rateHtml(v,vat)}</small>`:''}${money(v)}</span></div>`).join('')}</section>`:''}
  ${retentionBlock(data,c,rs)}
  ${partsBlock(data,c,canEdit)}
  <section class="cp-block"><div class="cp-block-head"><h3>Допсоглашения <span class="muted">${addenda.length?`${addenda.length} · подписано ${signed}${wip?` · в работе ${wip}`:''}`:''}</span></h3>${canEdit?`<button type="button" class="cp-small" data-action="new-addendum" data-id="${e(c.id)}">+ Допсоглашение</button>`:''}</div>${addenda.length?`<div class="ct-line ct-edge"><div><b>Договор</b> <span class="muted">${c.contract_date?'от '+e(day(c.contract_date)):''}</span><small>начальная цена</small></div><div class="ct-line-r">${has(c.initial_amount)?money(c.initial_amount):''}</div></div>${addenda.map(a=>addendumLine(a,canEdit)).join('')}<div class="ct-line ct-edge"><div><b>Действует сейчас</b><small>${c.amount_addendum_number?'по ДС № '+e(c.amount_addendum_number):'по договору'}${wip?' · ДС в работе не учтены':''}</small></div><div class="ct-line-r"><b>${has(c.current_amount)?money(c.current_amount):'—'}</b></div></div>`:'<div class="cp-no-data">Допсоглашений нет.</div>'}</section>
 </div>
 <div class="cp-drawer-foot"><span class="cp-foot-note">${c.created_at?'Внесён '+e(day(c.created_at)):''}</span>${canEdit&&profile?.role==='head'&&!c.has_documents?`<button class="cp-danger" type="button" data-action="delete-contract" data-id="${e(c.id)}" title="Для ошибочных записей: договор и его допсоглашения удаляются, в журнале остаётся запись">Удалить</button>`:''}${canEdit?`<button class="primary" type="button" data-action="edit-contract" data-id="${e(c.id)}">Изменить</button>`:''}</div></form>`;
}

// Гарантийное удержание по договору: процент и база, удержано по справкам и актам, сроки возврата от ввода объекта.
export function retentionBlock(data,c,rs){
 if(!rs||!has(rs.percent)&&!Number(rs.retained))return '';
 const pct=v=>String(Number(v)).replace('.',',');
 const who=c.direction==='incoming'?'удерживаем мы у субподрядчика':'удерживает заказчик';
 const cond=has(rs.percent)?`${pct(rs.percent)} % ${rs.base==='gross'?'от СМР с НДС':'от СМР без НДС'} · ${who}`:'процента нет, введено вручную';
 const project=(data.projects||[]).find(p=>p.id===c.project_id);
 const line=(label,amount,due)=>`<div class="ct-line"><span>${label}</span><span class="ct-line-r ct-one"><small>${due?'до '+e(day(due)):'после ввода объекта'}</small>${money(amount)}</span></div>`;
 return `<section class="cp-block"><div class="cp-block-head"><h3>Гарантийное удержание</h3></div>
  <div class="ct-line"><span>${e(cond)}</span></div>
  <div class="ct-line"><span><b>Удержано</b> <small class="muted">по справкам С-3а и актам</small></span><span class="ct-line-r ct-one"><b>${money(rs.retained)}</b></span></div>
  ${Number(rs.retained)?line(`Возврат ${pct(rs.first_share)} % через ${rs.first_years} г.`,rs.first_amount,rs.first_due)+(Number(rs.final_amount)?line(`Остаток через ${rs.final_years} г.`,rs.final_amount,rs.final_due):''):''}
  ${project?.commissioned_on?`<p class="cp-hint">Объект введён ${e(day(project.commissioned_on))}.</p>`:'<p class="cp-hint">Дата ввода объекта не указана: сроки возврата появятся, когда её внесут в карточке объекта.</p>'}</section>`;
}

// Новый договор: объект, сторона из справочника контрагентов, роли сторон. Цену и срок вносят потом в карточке.
export function newContractCard({data,profile,projectId=''}){
 const projects=(data.projects||[]).filter(p=>canWrite(profile,data.memberships,p.id));
 const parties=[...(data.parties||[])].sort((a,b)=>String(a.short_name).localeCompare(String(b.short_name),'ru'));
 return `<form id="new-contract-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head('Новый договор')}
 <div class="cp-drawer-content"><div class="cp-work-grid">
  <div class="wide"><label>Объект<select name="project_id" required>${projects.length>1?'<option value="">Выберите объект</option>':''}${projects.map(p=>`<option value="${e(p.id)}" ${p.id===projectId?'selected':''}>${e(p.name)}</option>`).join('')}</select></label></div>
  <div class="wide"><label>Вид договора<select name="kind" required>${contractKinds.map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select></label></div>
  <div class="wide"><label>Контрагент<select name="counterparty_id" required><option value="">Выберите из справочника</option>${parties.map(p=>`<option value="${e(p.id)}">${e(p.short_name)}${p.unp?' · УНП '+e(p.unp):''}</option>`).join('')}</select></label></div>
  ${input('number','Номер','','text','required')}${input('contract_date','Дата','','date')}
  <div class="wide">${input('subject','Предмет')}</div></div>
  <p class="cp-hint">Нет нужной организации — сначала добавьте её в «Контрагенты». Цену и срок внесёте в карточке договора после сохранения.</p></div>
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
// НДС части: у частей, внесённых до 11.10.2026, есть только ставка — НДС считается из стоимости и ставки.
const partVat=p=>has(p?.vat_amount)?p.vat_amount:has(p?.vat_rate)&&has(p?.amount)?(Math.round(Number(p.amount)*Number(p.vat_rate)/(100+Number(p.vat_rate))*100)/100):null;
export function partCard({data,contract:c,part:p}){
 return `<form id="part-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(p?`Часть договора № ${c.number}`:`Новая часть договора № ${c.number}`,subLine(data,c))}
 <div class="cp-drawer-content"><div class="cp-work-grid">
  <div class="wide">${input('name','Название (как в ССР)',p?.name||'','text','required maxlength="200"')}</div>
  ${amount('amount','Стоимость части с НДС, руб.',p?.amount)}${vatAmount('vat_amount','В т. ч. НДС, руб. (0 — без НДС)',partVat(p),'amount')}
  ${p?`<div class="wide"><label>Состояние<select name="active"><option value="true">Действует</option><option value="false" ${p.active?'':'selected'}>Не действует</option></select></label></div>`:''}</div>
  <p class="cp-hint">Акт и справку С-3а относят к части в карточке документа («Отметки»). В реестре строка на каждую часть и «Итого по договору».</p>
  <input type="hidden" name="${p?'part_id':'contract_id'}" value="${e(p?p.id:c.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="contract" data-id="${e(c.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
}
// Допсоглашение: новое и правка в одной форме. Скан — путь к файлу в папке ДОГОВОРА; путь указан — ДС подписано.
export function addendumCard({data,contract:c,addendum:a=null}){
 return `<form id="addendum-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(a?`ДС № ${a.number} к договору № ${c.number}`:`Допсоглашение к договору № ${c.number}`,subLine(data,c))}
 <div class="cp-drawer-content"><div class="cp-work-grid">
  ${input('number','Номер ДС',a?.number||'','text','required')}${input('agreement_date','Дата ДС',a?.agreement_date||'','date','required')}
  ${amount('amount_after','Цена договора после ДС, руб.',a?.amount_after)}${vatAmount('vat_amount','В т. ч. НДС, руб.',a?.vat_amount,'amount_after')}
  ${input('work_end_date','Новый срок окончания',a?.work_end_date||'','date')}
  <div class="wide">${area('note','Что меняет',a?.note||'')}</div>
  <div class="wide">${input('scan_path','Скан: путь к файлу в папке ДОГОВОРА',a?.scan_path||'','text',`maxlength="500" placeholder="${e(c.source_key||'ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД')}/ДС 3.pdf"`)}${pickButton('scan_path',c)}</div></div>
  <p class="cp-hint">Пока скан не указан, ДС «в работе» и в цене не учитывается. Указали путь к скану — ДС подписано, цена и срок договора пересчитываются. Пустые цена и срок значат «не меняется».</p>
  <input type="hidden" name="${a?'addendum_id':'contract_id'}" value="${e(a?a.id:c.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p>${a?`<button type="button" class="cp-danger" data-action="cancel-addendum" data-id="${e(a.id)}">Отменить ДС</button>`:''}<button type="button" data-action="contract" data-id="${e(c.id)}">Назад</button><button class="primary" type="submit">Сохранить</button></div></form>`;
}
export function addendumStatusCard({data,contract:c,addendum:a}){
 return `<form id="addendum-status-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(`Отменить ДС № ${a.number}`,subLine(data,c))}
 <div class="cp-drawer-content"><div class="cp-work-grid"><div class="wide">${input('reason','Причина отмены','','text','required minlength="5"')}</div></div>
  <p class="cp-hint">Отменённое допсоглашение не учитывается в цене и сроке договора. Запись остаётся в истории.</p>
  <input type="hidden" name="addendum_id" value="${e(a.id)}"><input type="hidden" name="status" value="cancelled"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="edit-addendum" data-id="${e(a.id)}">Назад</button><button class="primary" type="submit">Отменить ДС</button></div></form>`;
}

// Карточка объекта в разделе «Объекты»: название, полное наименование, адрес, ответственный инженер и цвет (правит начальник ПТО).
// Ответственный инженер один; при выборе он получает доступ к объекту, как в «Команде и правах».
const colorPicker=cur=>`<div class="ob-colors" role="radiogroup" aria-label="Цвет объекта">${OBJECT_COLORS.map(c=>`<label class="ob-sw" title="${e(COLOR_NAMES[c]||c)}"><input type="radio" name="color" value="${c}" ${c===cur?'checked':''} aria-label="${e(COLOR_NAMES[c]||c)}"><i style="background:${c}"></i></label>`).join('')}</div>`;
export function objectCard({data,project:p,canEdit,editing=false}){
 const color=objectColor(data.projects||[],p.id),dot=`<i class="ct-dot" style="background:${color}"></i>`;
 const engineers=(data.profiles||[]).filter(u=>u.role==='engineer'&&(u.active||u.id===p.engineer_id)).sort((a,b)=>String(a.display_name).localeCompare(String(b.display_name),'ru'));
 const eng=p.engineer_id||(data.profiles||[]).find(u=>u.display_name===engineerName(data,p.id))?.id||'';
 if(canEdit&&editing)return `<form id="project-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(p.name,`<div class="ct-sub">${dot}Объект</div>`)}
 <div class="cp-drawer-content">${section('Объект',`<div class="cp-work-grid"><div class="wide">${input('name','Краткое название',p.name,'text','required maxlength="120"')}</div>
  <div class="wide">${area('full_name','Полное наименование',p.full_name||'','maxlength="500"')}</div><div class="wide">${input('address','Адрес',p.address||'')}</div>
  <div class="wide"><label>Ответственный инженер ПТО<select name="engineer_id"><option value="">Не назначен</option>${options(engineers.map(u=>[u.id,u.display_name]),eng)}</select></label></div>
  ${input('commissioned_on','Ввод в эксплуатацию',p.commissioned_on||'','date')}</div>`)}
  ${section('Цвет объекта',colorPicker(color))}
  <p class="cp-hint">Краткое название и цвет видны в Портфеле, «Подписании» и реестрах. Ответственный инженер получает доступ к объекту; другие объекты инженера настраиваются в «Команда и права». От даты ввода считаются сроки возврата гарантийных удержаний.</p>
  <input type="hidden" name="project_id" value="${e(p.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="object-card" data-id="${e(p.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
 const list=(data.contracts||[]).filter(c=>c.project_id===p.id);
 const count=g=>list.filter(c=>contractGroup(c,data)===g).length,unchecked=list.filter(c=>c.checked===false).length;
 const counts=GROUPS.map(([g,label])=>[label.replace(/ ·.*$/,''),count(g)]).filter(([,n])=>n);
 return `<div class="cp-drawer-shell ob">${head(p.name,`<div class="ct-sub">${dot}Объект</div>`)}
 <div class="cp-drawer-content"><dl class="ct-kv"><dt>Полное наименование</dt><dd>${e(p.full_name||'—')}</dd><dt>Адрес</dt><dd>${p.address?e(p.address):'<span class="muted">не указан</span>'}</dd>
  <dt>Инженер</dt><dd>${e(engineerName(data,p.id)||'—')}</dd>
  <dt>Ввод в эксплуатацию</dt><dd>${p.commissioned_on?e(day(p.commissioned_on)):'<span class="muted">не указан</span>'}</dd>
  <dt>Договоры</dt><dd>${list.length?counts.map(([label,n])=>`${e(label)}: ${n}`).join(' · ')+(unchecked?` <span class="ct-warn">не проверено: ${unchecked}</span>`:''):'<span class="muted">нет</span>'}</dd></dl></div>
 <div class="cp-drawer-foot"><span class="cp-foot-note">${p.created_at?'Внесён '+e(day(p.created_at)):''}</span><button type="button" data-action="project" data-id="${e(p.id)}">Открыть объект</button>${canEdit?`<button class="primary" type="button" data-action="edit-object" data-id="${e(p.id)}">Изменить</button>`:''}</div></div>`;
}

// Карточка сотрудника в «Команда и права»: просмотр и правка имени, роли, доступа и объектов (правит начальник ПТО, себя — нет).
const memberRoles={head:'Начальник ПТО',engineer:'Инженер ПТО',director:'Руководитель'};
export function memberCard({data,person:u,canEdit,editing=false,email=''}){
 const own=new Set((data.memberships||[]).filter(m=>m.user_id===u.id).map(m=>m.project_id));
 const projects=[...(data.projects||[])].sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
 const scope=u.role==='head'?'Все объекты':u.role==='director'?'Просмотр всех объектов':projects.filter(p=>own.has(p.id)).map(p=>p.name).join(', ')||'не назначены';
 if(canEdit&&editing)return `<form id="member-form" class="cp-drawer-shell ob" autocomplete="off" data-editing>${head(u.display_name,`<div class="ct-sub">Сотрудник</div>`)}
 <div class="cp-drawer-content">${section('Учётная запись',`<div class="cp-work-grid"><div class="wide">${input('display_name','Имя',u.display_name,'text','required maxlength="120"')}</div>
  <div class="wide">${input('email','Почта для входа',email,'email',email?'required':'')}</div><div class="wide">${input('password','Новый пароль (пусто — не менять)','','text','minlength="8" autocomplete="new-password"')}</div>
  <label>Роль<select name="role">${Object.entries(memberRoles).map(([k,v])=>`<option value="${k}" ${k===u.role?'selected':''}>${v}</option>`).join('')}</select></label>
  <label>Доступ<select name="active"><option value="true" ${u.active?'selected':''}>Активен</option><option value="false" ${u.active?'':'selected'}>Отключён</option></select></label></div>`)}
  ${section('Объекты инженера',`<div class="member-objects">${projects.map(p=>`<label><input type="checkbox" name="project_ids" value="${e(p.id)}" ${own.has(p.id)?'checked':''}>${e(p.name)}</label>`).join('')||'<span class="muted">Объектов пока нет.</span>'}</div>`)}
  <p class="cp-hint">Начальник ПТО и руководитель видят все объекты; объекты нужны инженеру. Отключённый сотрудник не может войти. Новый пароль сообщите сотруднику, он сможет сменить его в «Настройках».</p>
  <input type="hidden" name="user_id" value="${e(u.id)}"></div>
 <div class="cp-drawer-foot"><p id="contract-error" class="error" role="alert"></p><button type="button" data-action="member-card" data-id="${e(u.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
 return `<div class="cp-drawer-shell ob">${head(u.display_name,`<div class="ct-sub">${e(memberRoles[u.role]||u.role)}</div>`)}
 <div class="cp-drawer-content"><dl class="ct-kv">${email?`<dt>Почта</dt><dd>${e(email)}</dd>`:''}<dt>Роль</dt><dd>${e(memberRoles[u.role]||u.role)}</dd><dt>Доступ</dt><dd>${u.active?'Активен':'<span class="ct-warn">Отключён</span>'}</dd><dt>Объекты</dt><dd>${e(scope)}</dd></dl></div>
 <div class="cp-drawer-foot"><span class="cp-foot-note"></span>${canEdit?`<button class="primary" type="button" data-action="edit-member" data-id="${e(u.id)}">Изменить</button>`:''}</div></div>`;
}
