// Раздел «Контрагенты»: единый справочник организаций. Здесь только разметка из данных; запись — команды pto_command.
import {escapeHtml as e,money,ourRoleNames} from './domain.js';

export const partyRoleNames={customer:'Заказчик',general_contractor:'Генподрядчик / подрядчик',subcontractor:'Субподрядчик',supplier:'Поставщик',service_provider:'Исполнитель услуг'};
const roleOrder=Object.keys(partyRoleNames);
// Официальные поля выписки МНС: в карточке существующего контрагента показываются, но не правятся вручную.
export const officialFields=['unp','short_name','full_name','address','registration_date','tax_office_code','tax_office_name','status_code','status_name','status_change_date','liquidation_info'];

const statusPill=c=>c.status_name?`<span class="pill ${c.status_name==='Действующий'?'g':'e'}">${e(c.status_name)}</span>`:'';
const day=v=>v?new Date(v+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'Europe/Minsk'}):'';
export const partyRoles=(data,id)=>(data.partyRoles||[]).filter(r=>r.counterparty_id===id).map(r=>r.role).filter(r=>partyRoleNames[r]);
const contractsOf=(data,id)=>(data.contracts||[]).filter(c=>c.counterparty_id===id);
const projectOf=(data,id)=>(data.projects||[]).find(p=>p.id===id);
const rolePills=(data,id)=>{const roles=partyRoles(data,id);return roles.length?`<div class="cp-role-list">${roles.map(r=>`<span class="pill">${e(partyRoleNames[r])}</span>`).join('')}</div>`:'<span class="muted">Не назначены</span>';};
// Текст для поиска по строке: названия, УНП, адрес, руководитель, ОКПО и роли.
export const partySearchText=(data,c)=>[c.short_name,c.full_name,c.unp,c.address,c.director_name,c.okpo,...partyRoles(data,c.id).map(r=>partyRoleNames[r])].join(' ').toLowerCase();

// Буква для алфавита: первая буква собственного названия — после открывающей кавычки (ООО "ТАГКров" → Т),
// без кавычек — после формы собственности (ООО, ОАО, УП, ЧУП…).
const FORMS=/^(?:(?:ООО|ОАО|ЗАО|АО|ПАО|ОДО|СООО|ИООО|ИУП|ЧУП|ЧТУП|ЧСУП|ЧП|УП|РУП|КУП|КПУП|ГП|ГУ|ИП|ТОО|Филиал|Частное|Государственное|Унитарное|Коммунальное|Республиканское|производственное|торговое|предприятие)\s+)+/i;
export function partyLetter(name){
 const s=String(name||'').trim(),q=s.search(/["«“„']/);
 const own=(q>=0?s.slice(q):s.replace(FORMS,'')).replace(/^[^0-9A-Za-zА-Яа-яЁё]+/,'');
 const ch=(own[0]||'').toUpperCase();
 return /[А-ЯЁ]/.test(ch)?(ch==='Ё'?'Е':ch):/[A-Z]/.test(ch)?'A–Z':/[0-9]/.test(ch)?'0–9':'#';
}
const ALPHABET=[...'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ','A–Z','0–9'];
// Объекты контрагента: по договорам и по участию в объекте без договора.
export const partyProjects=(data,id)=>[...new Set([...contractsOf(data,id).map(c=>c.project_id),...(data.participants||[]).filter(x=>x.counterparty_id===id).map(x=>x.project_id)])];

export function partiesList({data,canEdit,ui={}}){
 const letter=ui.partyLetter||'',project=ui.partyProject||'';
 const all=(data.parties||[]).map(c=>({c,l:partyLetter(c.short_name),p:partyProjects(data,c.id)}));
 const scoped=all.filter(x=>!project||x.p.includes(project));
 const have=new Set(scoped.map(x=>x.l));
 const list=scoped.filter(x=>!letter||x.l===letter).sort((a,b)=>ALPHABET.indexOf(a.l)-ALPHABET.indexOf(b.l)||String(a.c.short_name).replace(/^[^"«“„']*["«“„']/,'').localeCompare(String(b.c.short_name).replace(/^[^"«“„']*["«“„']/,''),'ru'));
 const objects=p=>p.map(id=>projectOf(data,id)?.name).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru')).join(', ');
 const rows=list.map(({c,p})=>`<tr data-search="${e(partySearchText(data,c))}"><td><button class="link" data-action="party" data-id="${e(c.id)}"><b>${e(c.short_name)}</b></button><small>${e(c.full_name)}</small></td><td>${e(c.unp)}</td><td>${rolePills(data,c.id)}</td><td>${statusPill(c)||'—'}</td><td>${e(objects(p))}</td><td class="num">${contractsOf(data,c.id).length||''}</td></tr>`).join('');
 const projects=[...(data.projects||[])].sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
 const letters=`<div class="cp-letters" role="group" aria-label="Первая буква названия"><button type="button" class="${letter?'':'on'}" data-action="party-letter" data-id="">Все</button>${ALPHABET.map(l=>`<button type="button" class="${l===letter?'on':''}" data-action="party-letter" data-id="${e(l)}" ${have.has(l)||l===letter?'':'disabled'}>${e(l)}</button>`).join('')}</div>`;
 return `<div class="heading"><div><h1>Контрагенты</h1><div class="muted">Единый справочник организаций. Одна организация может иметь несколько ролей.</div></div><div class="actions">${canEdit?'<button data-action="mns-xml" data-id="">Загрузить XML МНС</button><input id="mns-xml" type="file" accept=".xml,text/xml,application/xml" multiple hidden><button class="primary" data-action="new-party" data-id="">Добавить контрагента</button>':''}</div></div>
 <div class="cp-toolbar"><input id="party-search" class="cp-search" type="search" autocomplete="off" placeholder="Поиск по названию, УНП или роли"><select id="party-project" class="cp-project" aria-label="Объект"><option value="">Все объекты</option>${projects.map(x=>`<option value="${e(x.id)}" ${x.id===project?'selected':''}>${e(x.name)}</option>`).join('')}</select></div>
 ${letters}
 <section class="table-wrap"><table class="cp-table"><thead><tr><th>Контрагент</th><th>УНП</th><th>Роли</th><th>Статус</th><th>Объекты</th><th class="num">Договоров</th></tr></thead><tbody>${rows}<tr id="party-empty" ${rows?'hidden':''}><td colspan="6"><div class="empty cp-empty">Контрагенты не найдены.</div></td></tr></tbody></table></section>`;
}

const hidden=(name,value='')=>`<input type="hidden" name="${e(name)}" value="${e(value)}">`;
const input=(name,label,value='',type='text',extra='')=>`<label>${e(label)}<input name="${e(name)}" type="${e(type)}" value="${e(value??'')}" autocomplete="off" ${extra}></label>`;
const copyIcon='<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5H5"/></svg>';
const copyChip=(text,label=text,title='Скопировать')=>`<button type="button" class="cp-chip-copy" data-action="copy" data-id="${e(text)}" title="${e(title)}">${e(label)}${copyIcon}</button>`;
const plural=(n,one,few,many)=>{const m10=n%10,m100=n%100;return `${n} ${m10===1&&m100!==11?one:m10>=2&&m10<=4&&(m100<12||m100>14)?few:many}`;};
const minskToday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Minsk'});
const daysBetween=(from,to)=>Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/864e5);
// Счёт группами по 4 знака, как в банковских документах.
const iban=v=>String(v||'').replace(/\s+/g,'').replace(/(.{4})(?=.)/g,'$1 ');
// «Петров Пётр Петрович» → «П.П. Петров» для строки подписи.
const signName=v=>{const [last,...rest]=String(v||'').trim().split(/\s+/);return rest.length?`${rest.map(x=>x[0]+'.').join('')} ${last}`:String(v||'');};

// Что не заполнено для реквизитов договора (в родительном падеже — «не хватает …»).
export const missingRequisites=c=>[['postal_code','индекса'],['address','адреса'],['bank_account','счёта'],['bank_bic','BIC'],['bank_name','банка'],['director_name','подписанта'],['authority_basis','основания подписи']].filter(([k])=>!String(c[k]||'').trim()).map(([,label])=>label);

// Маркеры под названием: можно ли работать, свежие ли сведения МНС, готовы ли реквизиты для договора.
export function partyMarks(c,today=minskToday()){
 if(c.status_name&&c.status_name!=='Действующий')return [['bad',`${c.status_name}${c.status_change_date?` с ${day(c.status_change_date)}`:''}`],['bad','Не заключать новые договоры']];
 const marks=[];
 if(c.status_name)marks.push(['ok','Действующий']);
 if(!c.mns_checked_at)marks.push(['off','Нет сведений МНС','mns']);
 else{const age=daysBetween(c.mns_checked_at,today);marks.push(age>30?['warn',`Сведения МНС ${plural(age,'день','дня','дней')} назад`,'mns']:['ok',`Сведения МНС на ${day(c.mns_checked_at)}`]);}
 const missing=missingRequisites(c);
 marks.push(missing.length?['off',`Для договора не хватает ${missing.join(', ')}`]:['ok','Реквизиты для договора заполнены']);
 return marks;
}

// Текст реквизитов в порядке договора: наименование → юр. адрес → счёт в банке, BIC → УНП, ОКПО → телефон, e-mail → подписант.
export function partyRequisitesText(c){
 const lines=[c.full_name||c.short_name,
  c.address?`Юр. адрес: ${[c.postal_code,c.address].filter(Boolean).join(', ')}`:'',
  c.bank_account?`р/с ${iban(c.bank_account)}${c.bank_name?` в ${c.bank_name}`:''}${c.bank_bic?`, BIC ${c.bank_bic}`:''}`:'',
  [c.unp?`УНП ${c.unp}`:'',c.okpo?`ОКПО ${c.okpo}`:''].filter(Boolean).join(', '),
  [c.phone?`тел. ${String(c.phone).replace(/\s*\n\s*/g,', ')}`:'',c.email?`e-mail ${c.email}`:''].filter(Boolean).join(', '),
  c.director_name?`${c.director_title||'Руководитель'} _______________ ${signName(c.director_name)}`:''];
 return lines.filter(Boolean).join('\n');
}

// Деньги: итог, полоса долей по объектам и договоры с цветом своего объекта (оттенки одного синего, крупный объект ярче).
function money_(data,c){
 const list=contractsOf(data,c.id);
 const participants=(data.participants||[]).filter(x=>x.counterparty_id===c.id&&!list.some(k=>k.project_id===x.project_id));
 if(!list.length&&!participants.length)return '<div class="cp-no-data">Пока нет договоров и объектов.</div>';
 const amount=x=>Number(x.current_amount)||0,total=list.reduce((t,x)=>t+amount(x),0);
 const groups=[...new Set(list.map(x=>x.project_id))].map(id=>({id,name:projectOf(data,id)?.name||'Объект',sum:list.filter(x=>x.project_id===id).reduce((t,x)=>t+amount(x),0)})).sort((a,b)=>b.sum-a.sum);
 const tone=id=>Math.min(groups.findIndex(g=>g.id===id),3);
 const objects=new Set([...groups.map(g=>g.id),...participants.map(x=>x.project_id)]).size;
 const total_=money(total).replace(/,(\d\d)$/,'<small>,$1</small>');
 return `<div class="cp-total"><b>${total_}</b><span>руб. по ${plural(list.length,'договору','договорам','договорам')}<br>на ${plural(objects,'объекте','объектах','объектах')}</span></div>
  ${total>0&&groups.length>1?`<div class="cp-bar">${groups.map(g=>`<i class="t${tone(g.id)}" style="flex:${g.sum}" title="${e(g.name)}: ${money(g.sum)}"></i>`).join('')}</div><div class="cp-legend">${groups.map(g=>`<span><i class="t${tone(g.id)}"></i>${e(g.name)} <b>${money(g.sum)}</b></span>`).join('')}</div>`:''}
  <div class="cp-contracts">${list.slice().sort((a,b)=>amount(b)-amount(a)).map(x=>`<div class="cp-k" title="Наша роль: ${e(ourRoleNames[x.our_role]||x.our_role||'')}"><i class="t${tone(x.project_id)}"></i><b>№${e(x.number||'—')}</b><span>${x.contract_date?`от ${e(day(x.contract_date))}`:''}${x.amount_addendum_number?` · <em>ДС №${e(x.amount_addendum_number)}</em>`:''} · ${e(projectOf(data,x.project_id)?.name||'')}</span><span class="cp-k-sum">${x.current_amount!==null&&x.current_amount!==undefined&&x.current_amount!==''?money(x.current_amount):''}</span></div>`).join('')}
  ${participants.map(x=>`<div class="cp-k"><i class="t3"></i><b>—</b><span>${e(projectOf(data,x.project_id)?.name||'Объект')} · ${e(partyRoleNames[x.role]||x.role)}, без договора</span><span></span></div>`).join('')}</div>`;
}

function contacts(data,c,canEdit){
 const list=(data.partyContacts||[]).filter(x=>x.counterparty_id===c.id);
 const rows=list.map(x=>{const objects=(x.project_ids||[]).map(id=>projectOf(data,id)?.name).filter(Boolean).join(', ');
  return `<div class="cp-person"><div>${canEdit?`<button type="button" class="link" data-action="party-contact" data-id="${e(x.id)}"><b>${e(x.name)}</b></button>`:`<b>${e(x.name)}</b>`}${x.topics?`<span class="cp-topic">${e(x.topics)}</span>`:''}<small>${e([x.position,objects].filter(Boolean).join(' · '))}</small></div>
   <div class="cp-person-c">${x.phone?`<a href="tel:${e(x.phone.replace(/[^\d+]/g,''))}">${e(x.phone)}</a>`:''}${x.email?`<button type="button" class="cp-copy-line" data-action="copy" data-id="${e(x.email)}" title="Скопировать адрес">${e(x.email)}${copyIcon}</button>`:''}</div></div>`;}).join('');
 return `<section class="cp-block"><div class="cp-block-head"><h3>Контактные лица</h3>${canEdit?`<button type="button" class="cp-small" data-action="party-contact-new" data-id="${e(c.id)}">+ Добавить</button>`:''}</div>${rows||'<div class="cp-no-data">Кто ведёт процентовки, бухгалтерия, снабжение — добавьте, чтобы не искать телефоны.</div>'}</section>`;
}

function requisites(c){
 const text=partyRequisitesText(c),[name,...rest]=text.split('\n');
 return `<section class="cp-req"><div class="cp-block-head"><h3>Реквизиты для договора</h3><button type="button" class="cp-small" data-action="copy" data-id="${e(text)}">${copyIcon}Скопировать</button></div>
  <div class="cp-doc"><p><b>${e(name)}</b></p>${rest.map(l=>/_{5,}/.test(l)?`<p class="cp-sign">${e(l.replace(/_+/,'§')).replace('§','<span></span>')}${c.authority_basis?`<small>на основании ${e(c.authority_basis)}</small>`:''}</p>`:`<p>${e(l)}</p>`).join('')}</div></section>`;
}

const head=(c,title,sub='')=>`<div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>${e(title)}</h2>${sub}</div>`;

// Ручное добавление — запасной путь (основной — XML МНС): только то, без чего контрагента не сохранить.
const newFields=()=>`<p class="cp-hint">Быстрее и точнее — «Загрузить XML МНС» в списке контрагентов.</p><div class="cp-work-grid">${input('unp','УНП')}${input('short_name','Краткое наименование')}<div class="wide">${input('full_name','Полное наименование')}</div><div class="wide">${input('address','Юридический адрес')}</div></div>${['registration_date','tax_office_code','tax_office_name','status_code','status_name','status_change_date','liquidation_info'].map(k=>hidden(k)).join('')}`;
const section=(title,body)=>`<section class="cp-section"><div class="cp-section-title">${title}</div>${body}</section>`;

// Карточка контрагента — боковая панель общей ширины (--drawer-w). Открывается на просмотр, правка — по кнопке «Изменить».
// Новый контрагент (c=null) сразу открывается на правку.
export function partyCard({data,party:c=null,canEdit,editing=false,today}){
 const editMode=canEdit&&(editing||!c);
 if(editMode){
  const selected=new Set(c?partyRoles(data,c.id):[]);
  return `<form id="party-form" class="cp-drawer-shell" autocomplete="off" data-editing>${head(c,c?(c.short_name||'Контрагент'):'Новый контрагент',c?`<div class="cp-full-name">${e(c.full_name)}</div>`:'')}
  <div class="cp-drawer-content">${c?'':section('Основные реквизиты',newFields())}
   ${section('Роли',`<div class="cp-role-checks">${roleOrder.map(r=>`<label class="cp-chip"><input type="checkbox" name="roles" value="${e(r)}" ${selected.has(r)?'checked':''}>${e(partyRoleNames[r])}</label>`).join('')}</div>`)}
   ${section('Подписант',`<div class="cp-work-grid">${input('director_title','Должность',c?.director_title)}${input('director_name','ФИО полностью',c?.director_name)}<div class="wide">${input('authority_basis','Действует на основании (Устава, доверенности № …)',c?.authority_basis)}</div></div>`)}
   ${section('Связь и адрес',`<div class="cp-work-grid">${input('email','Эл. почта организации',c?.email,'email')}${input('phone','Телефон приёмной',(c?.phone||'').replace(/\s*\n\s*/g,', '))}${input('postal_code','Почтовый индекс',c?.postal_code,'text','inputmode="numeric" pattern="[0-9]{6}" maxlength="6"')}</div>`)}
   ${section('Банк',`<div class="cp-work-grid"><div class="wide">${input('bank_account','Расчётный счёт (IBAN)',c?.bank_account)}</div>${input('bank_bic','BIC',c?.bank_bic)}${input('okpo','ОКПО',c?.okpo)}<div class="wide">${input('bank_name','Банк',c?.bank_name)}</div></div>`)}
   ${section('Примечание',`<div class="cp-work-grid"><div class="wide">${input('note','Для своих',c?.note)}</div></div>`)}
   ${c?officialFields.map(k=>hidden(k,c[k])).join(''):''}${hidden('source',c?.source||'manual')}</div>
  <div class="cp-drawer-foot"><p id="party-error" class="error" role="alert"></p>${c?`<button type="button" data-action="party" data-id="${e(c.id)}">Отмена</button>`:'<button type="button" data-action="dismiss">Отмена</button>'}<button class="primary" type="submit">Сохранить</button></div></form>`;
 }
 const roles=partyRoles(data,c.id).map(r=>partyRoleNames[r]);
 const marks=partyMarks(c,today);
 const sub=`${c.full_name&&c.full_name!==c.short_name?`<div class="cp-full-name">${e(c.full_name)}</div>`:''}${roles.length?`<div class="cp-roles">${e(roles.join(', '))}</div>`:''}
  <div class="cp-ids">${copyChip(c.unp,`УНП ${c.unp}`,'Скопировать УНП')}${c.email?copyChip(c.email,c.email,'Скопировать адрес почты'):''}</div>
  <div class="cp-marks">${marks.map(([k,t,act])=>`<span class="cp-mark ${k}"><i></i>${e(t)}${act==='mns'&&canEdit?' <button type="button" class="link" data-action="mns-xml" data-id="">обновить</button>':''}</span>`).join('')}</div>
  ${c.note?`<div class="cp-note">${e(c.note)}</div>`:''}`;
 return `<form id="party-form" class="cp-drawer-shell" autocomplete="off">${head(c,c.short_name||'Контрагент',sub)}
  <div class="cp-drawer-content">${money_(data,c)}${contacts(data,c,canEdit)}${requisites(c)}</div>
  <div class="cp-drawer-foot"><span class="cp-foot-note">${c.updated_at?`Изменено ${e(day(String(c.updated_at).slice(0,10)))}`:''}</span>${canEdit?`<button class="primary" type="button" data-action="party-edit" data-id="${e(c.id)}">Изменить</button>`:''}</div></form>`;
}

// Контактное лицо: форма в той же панели. Объекты — из справочника объектов.
export function contactCard({data,party:c,contact:x=null}){
 const chosen=new Set(x?.project_ids||[]);
 return `<form id="contact-form" class="cp-drawer-shell" autocomplete="off" data-editing>${head(c,x?x.name:'Новое контактное лицо',`<div class="cp-full-name">${e(c.short_name)}</div>`)}
  <div class="cp-drawer-content"><div class="cp-work-grid">
   <div class="wide">${input('name','ФИО или отдел',x?.name,'text','required')}</div>${input('position','Должность',x?.position)}${input('topics','По каким вопросам',x?.topics,'text','list="cp-topics"')}
   ${input('phone','Телефон',x?.phone,'tel')}${input('email','Эл. почта',x?.email,'email')}</div>
   <datalist id="cp-topics"><option value="Процентовки"><option value="Оплата, акты сверки"><option value="Снабжение"><option value="Исполнительная документация"><option value="Руководство"></datalist>
   ${(data.projects||[]).length?section('Объекты',`<div class="cp-role-checks">${data.projects.map(p=>`<label class="cp-chip"><input type="checkbox" name="project_ids" value="${e(p.id)}" ${chosen.has(p.id)?'checked':''}>${e(p.name)}</label>`).join('')}</div>`):''}
   ${hidden('counterparty_id',c.id)}${hidden('contact_id',x?.id||'')}</div>
  <div class="cp-drawer-foot"><p id="party-error" class="error" role="alert"></p>${x?`<button type="button" class="cp-danger" data-action="party-contact-delete" data-id="${e(x.id)}">Удалить</button>`:''}<button type="button" data-action="party" data-id="${e(c.id)}">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
}
export function contactPayload(form){
 const payload={op:'save_counterparty_contact'};for(const [k,v] of form)if(k!=='project_ids')payload[k]=v;
 payload.project_ids=form.getAll('project_ids');
 if(!payload.contact_id)delete payload.contact_id;
 return payload;
}

// Команда сохранения из полей формы: create_counterparty или update_counterparty с полным набором ролей.
export function partyPayload(form,party=null){
 const payload={};for(const [k,v] of form)if(k!=='roles')payload[k]=v;
 payload.roles=form.getAll('roles');
 payload.op=party?'update_counterparty':'create_counterparty';
 if(party)payload.counterparty_id=party.id;
 return payload;
}

// Выписка МНС в XML: <ROWSET><ROW><VUNP>…</VUNP>…</ROW></ROWSET>. Формат плоский, разбирается без DOM (и в тестах).
const mnsTags={VUNP:'unp',VNAIMK:'short_name',VNAIMP:'full_name',VPADRES:'address',DREG:'registration_date',NMNS:'tax_office_code',VMNS:'tax_office_name',CKODSOST:'status_code',VKODS:'status_name',DLIKV:'status_change_date',VLIKV:'liquidation_info'};
const xmlText=v=>v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&amp;/g,'&').trim();
const isoDate=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v)||/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);return !m?'':m[1].length===4?`${m[1]}-${m[2]}-${m[3]}`:`${m[3]}-${m[2]}-${m[1]}`;};
export function parseMnsXml(text){
 const rows=[...String(text).matchAll(/<ROW>([\s\S]*?)<\/ROW>/g)].map(([,body])=>{
  const row=Object.fromEntries(Object.values(mnsTags).map(k=>[k,'']));
  for(const [tag,key] of Object.entries(mnsTags)){const m=new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);if(m)row[key]=xmlText(m[1]);}
  for(const k of ['registration_date','status_change_date'])row[k]=isoDate(row[k]);
  return row;
 });
 if(!rows.length)throw Error('В файле нет сведений МНС (ожидается ROWSET/ROW).');
 return rows;
}
const mnsLabels={short_name:'Краткое наименование',full_name:'Полное наименование',address:'Адрес',registration_date:'Дата постановки на учёт',tax_office_code:'Код инспекции',tax_office_name:'Инспекция МНС',status_code:'Код состояния',status_name:'Состояние',status_change_date:'Дата изменения состояния',liquidation_info:'Сведения о ликвидации'};
// Сравнение с справочником по УНП: новый, изменились поля (что было → что станет) или без изменений.
export function mnsPreview(data,rows){
 const seen=new Map();for(const r of rows)seen.set(r.unp,r);
 return [...seen.values()].map(row=>{
  const party=(data.parties||[]).find(c=>c.unp===row.unp);
  if(!party)return {row,status:'new',changes:[]};
  const after={...row,short_name:row.short_name||row.full_name};
  const changes=Object.keys(mnsLabels).filter(k=>String(party[k]??'').trim()!==String(after[k]??'').trim()).map(k=>({field:k,label:mnsLabels[k],before:party[k]??'',after:after[k]??''}));
  return {row,party,status:changes.length?'changed':'same',changes};
 });
}
export function mnsPreviewHtml(preview){
 const count=s=>preview.filter(p=>p.status===s).length,badge={new:'<span class="pill">Новый</span>',changed:'<span class="pill w">Изменения</span>',same:'<span class="pill g">Без изменений</span>'};
 const val=(k,v)=>k.endsWith('_date')?day(v):v;
 const rows=preview.map(p=>`<tr><td>${badge[p.status]}</td><td><b>${e(p.row.short_name||p.row.full_name)}</b><small>УНП ${e(p.row.unp)} · ${e(p.row.status_name||'')}</small></td><td>${p.status==='changed'?p.changes.map(c=>`<div><small>${e(c.label)}</small>${e(val(c.field,c.before)||'—')} → <b>${e(val(c.field,c.after)||'—')}</b></div>`).join(''):p.status==='new'?'<small>Будет создан. Роли, руководитель, контакты и банк заполните в карточке.</small>':''}</td></tr>`).join('');
 return `<p>Новых: <b>${count('new')}</b> · с изменениями: <b>${count('changed')}</b> · без изменений: <b>${count('same')}</b>. Импорт меняет только сведения МНС; роли, руководитель, контакты, банк и примечание остаются как есть.</p>
 <div class="table-wrap"><table class="cp-table"><thead><tr><th></th><th>Организация</th><th>Что изменится</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
