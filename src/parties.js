// Раздел «Контрагенты»: единый справочник организаций. Здесь только разметка из данных; запись — команды pto_command.
import {escapeHtml as e,money,ourRoleNames} from './domain.js';

export const partyRoleNames={customer:'Заказчик',general_contractor:'Генподрядчик / подрядчик',subcontractor:'Субподрядчик',supplier:'Поставщик',service_provider:'Исполнитель услуг'};
const roleOrder=Object.keys(partyRoleNames);
// Официальные поля выписки МНС: в карточке существующего контрагента показываются, но не правятся вручную.
export const officialFields=['unp','short_name','full_name','address','registration_date','tax_office_code','tax_office_name','status_code','status_name','status_change_date','liquidation_info'];

const day=v=>v?new Date(v+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'Europe/Minsk'}):'';
export const partyRoles=(data,id)=>(data.partyRoles||[]).filter(r=>r.counterparty_id===id).map(r=>r.role).filter(r=>partyRoleNames[r]);
const contractsOf=(data,id)=>(data.contracts||[]).filter(c=>c.counterparty_id===id);
const projectOf=(data,id)=>(data.projects||[]).find(p=>p.id===id);
const rolePills=(data,id)=>{const roles=partyRoles(data,id);return roles.length?`<div class="cp-role-list">${roles.map(r=>`<span class="pill">${e(partyRoleNames[r])}</span>`).join('')}</div>`:'<span class="muted">Не назначены</span>';};
// Текст для поиска по строке: названия, УНП, адрес, руководитель, ОКПО и роли.
export const partySearchText=(data,c)=>[c.short_name,c.full_name,c.unp,c.address,c.director_name,c.okpo,...partyRoles(data,c.id).map(r=>partyRoleNames[r])].join(' ').toLowerCase();

export function partiesList({data,canEdit}){
 const rows=(data.parties||[]).map(c=>`<tr data-search="${e(partySearchText(data,c))}"><td><button class="link" data-action="party" data-id="${e(c.id)}"><b>${e(c.short_name)}</b></button><small>${e(c.full_name)}</small></td><td>${e(c.unp)}</td><td>${rolePills(data,c.id)}</td><td>${c.status_name?`<span class="pill ${c.status_name==='Действующий'?'g':''}">${e(c.status_name)}</span>`:'—'}</td><td>${e(c.address||'')}</td><td class="num">${contractsOf(data,c.id).length||''}</td></tr>`).join('');
 return `<div class="heading"><div><h1>Контрагенты</h1><div class="muted">Единый справочник организаций. Одна организация может иметь несколько ролей.</div></div><div class="actions">${canEdit?'<button class="primary" data-action="new-party" data-id="">Добавить контрагента</button>':''}</div></div>
 <div class="cp-toolbar"><input id="party-search" class="cp-search" type="search" autocomplete="off" placeholder="Поиск по названию, УНП или роли"></div>
 <section class="table-wrap"><table class="cp-table"><thead><tr><th>Контрагент</th><th>УНП</th><th>Роли</th><th>Статус</th><th>Адрес</th><th class="num">Договоров</th></tr></thead><tbody>${rows}<tr id="party-empty" ${rows?'hidden':''}><td colspan="6"><div class="empty cp-empty">Контрагенты не найдены.</div></td></tr></tbody></table></section>`;
}

const hidden=(name,value='')=>`<input type="hidden" name="${e(name)}" value="${e(value)}">`;
const input=(name,label,value='',type='text',ro=false)=>`<label>${e(label)}<input name="${e(name)}" type="${e(type)}" value="${e(value)}" autocomplete="off" ${ro?'readonly':''}></label>`;
const area=(name,label,value='',ro=false)=>`<label class="wide">${e(label)}<textarea name="${e(name)}" autocomplete="off" ${ro?'readonly':''}>${e(value)}</textarea></label>`;

function facts(c){
 return `<div class="cp-facts">
  <div class="cp-fact wide"><span>Полное наименование</span><div class="cp-full-name">${e(c.full_name||'—')}</div></div>
  <div class="cp-fact wide"><span>Юридический адрес</span><div>${e(c.address||'—')}</div></div>
  <div class="cp-fact"><span>Дата регистрации</span><div>${e(day(c.registration_date)||'—')}</div></div>
  <div class="cp-fact"><span>Инспекция МНС</span><div>${e(c.tax_office_name||'—')}${c.tax_office_code?` <span class="muted">(${e(c.tax_office_code)})</span>`:''}</div></div>
  <div class="cp-fact"><span>Состояние</span><div>${e(c.status_name||'—')}</div></div>
  ${c.status_change_date?`<div class="cp-fact"><span>Дата изменения состояния</span><div>${e(day(c.status_change_date))}</div></div>`:''}
  ${c.liquidation_info?`<div class="cp-fact wide"><span>Сведения МНС</span><div>${e(c.liquidation_info)}</div></div>`:''}
 </div>`;
}
const newFields=()=>`<div class="cp-work-grid">${input('unp','УНП')}${input('short_name','Краткое наименование')}${area('full_name','Полное наименование')}${area('address','Адрес')}${input('registration_date','Дата регистрации','','date')}${input('tax_office_code','Код инспекции МНС')}${input('tax_office_name','Инспекция МНС')}${input('status_code','Код состояния')}${input('status_name','Статус')}${input('status_change_date','Дата изменения состояния','','date')}${area('liquidation_info','Сведения МНС')}</div>`;

function usage(data,c){
 const rows=[];
 (data.participants||[]).filter(x=>x.counterparty_id===c.id).forEach(x=>{const p=projectOf(data,x.project_id);rows.push(`<div class="cp-system-row"><div><span class="pill">${e(partyRoleNames[x.role]||x.role)}</span></div><div><b>${e(p?.name||'Объект')}</b>${p?.full_name&&p.full_name!==p.name?`<small>${e(p.full_name)}</small>`:''}</div></div>`);});
 contractsOf(data,c.id).forEach(x=>{
  // Текущая стоимость вычисляется в базе (pto_contract_list) по последнему подписанному допсоглашению.
  const p=projectOf(data,x.project_id),amount=x.current_amount;
  const sum=amount!==null&&amount!==undefined&&amount!==''?`<small class="cp-contract-money"><b>${money(amount)} руб.</b>${x.amount_addendum_number?` · ДС №${e(x.amount_addendum_number)} от ${e(day(x.amount_addendum_date))}`:''}</small>`:'';
  rows.push(`<div class="cp-system-row"><div><span class="pill g">Договор</span></div><div><b>№${e(x.number||'—')}${x.contract_date?` от ${e(day(x.contract_date))}`:''}</b><small>${e(p?.name||'')} · наша роль: ${e(ourRoleNames[x.our_role]||x.our_role||'')}</small>${sum}${x.subject?`<small>${e(x.subject)}</small>`:''}</div></div>`);
 });
 return rows.length?`<div class="cp-system-list">${rows.join('')}</div>`:'<div class="cp-no-data">Пока не используется в объектах и договорах.</div>';
}

// Карточка: новый контрагент (c=null) или существующий. Без права записи все поля только для чтения.
export function partyCard({data,party:c=null,canEdit}){
 const ro=!canEdit,selected=new Set(c?partyRoles(data,c.id):[]);
 return `<form id="party-form" class="cp-drawer-shell" autocomplete="off">
  <div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>${e(c?(c.short_name||'Контрагент'):'Новый контрагент')}</h2>${c?`<div class="cp-card-meta"><span class="pill">УНП ${e(c.unp)}</span>${c.status_name?`<span class="pill ${c.status_name==='Действующий'?'g':''}">${e(c.status_name)}</span>`:''}<span class="muted">Источник: ${e(c.source||'manual')}</span></div>`:''}</div>
  <div class="cp-drawer-content">
   ${c?`<section class="cp-section"><div class="cp-section-title">В нашей системе</div>${usage(data,c)}</section>`:''}
   <section class="cp-section"><div class="cp-section-title">Роли контрагента</div><div class="cp-role-checks">${roleOrder.map(r=>`<label><input type="checkbox" name="roles" value="${e(r)}" ${selected.has(r)?'checked':''} ${ro?'disabled':''}>${e(partyRoleNames[r])}</label>`).join('')}</div></section>
   <section class="cp-section"><div class="cp-section-title">${c?'Официальные данные МНС':'Основные реквизиты'}</div>${c?facts(c):newFields()}</section>
   <section class="cp-section"><div class="cp-section-title">Руководитель и право подписи</div><div class="cp-work-grid">${input('director_title','Должность',c?.director_title,'text',ro)}${input('director_name','ФИО руководителя',c?.director_name,'text',ro)}${input('authority_basis','Действует на основании',c?.authority_basis,'text',ro)}</div></section>
   <section class="cp-section"><div class="cp-section-title">Контакты</div><div class="cp-work-grid">${area('phone','Телефоны',c?.phone,ro)}${input('email','Электронная почта',c?.email,'email',ro)}</div></section>
   <section class="cp-section"><div class="cp-section-title">Банковские реквизиты</div><div class="cp-work-grid">${input('okpo','ОКПО',c?.okpo,'text',ro)}${input('bank_bic','БИК',c?.bank_bic,'text',ro)}${area('bank_account','Расчётный счёт / IBAN',c?.bank_account,ro)}${area('bank_name','Банк',c?.bank_name,ro)}</div></section>
   <section class="cp-section"><div class="cp-section-title">Примечание</div><div class="cp-work-grid">${area('note','Внутреннее примечание',c?.note,ro)}</div></section>
   ${c?officialFields.map(k=>hidden(k,c[k])).join(''):''}${hidden('source',c?.source||'manual')}<p id="party-error" class="error" role="alert"></p>
  </div>
  <div class="cp-drawer-foot"><button type="button" data-action="dismiss">${ro?'Закрыть':'Отмена'}</button>${ro?'':'<button class="primary" type="submit">Сохранить</button>'}</div>
 </form>`;
}

// Команда сохранения из полей формы: create_counterparty или update_counterparty с полным набором ролей.
export function partyPayload(form,party=null){
 const payload={};for(const [k,v] of form)if(k!=='roles')payload[k]=v;
 payload.roles=form.getAll('roles');
 payload.op=party?'update_counterparty':'create_counterparty';
 if(party)payload.counterparty_id=party.id;
 return payload;
}
