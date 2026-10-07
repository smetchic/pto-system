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

export function partiesList({data,canEdit}){
 const rows=(data.parties||[]).map(c=>`<tr data-search="${e(partySearchText(data,c))}"><td><button class="link" data-action="party" data-id="${e(c.id)}"><b>${e(c.short_name)}</b></button><small>${e(c.full_name)}</small></td><td>${e(c.unp)}</td><td>${rolePills(data,c.id)}</td><td>${statusPill(c)||'—'}</td><td>${e(c.address||'')}</td><td class="num">${contractsOf(data,c.id).length||''}</td></tr>`).join('');
 return `<div class="heading"><div><h1>Контрагенты</h1><div class="muted">Единый справочник организаций. Одна организация может иметь несколько ролей.</div></div><div class="actions">${canEdit?'<button data-action="mns-xml" data-id="">Загрузить XML МНС</button><input id="mns-xml" type="file" accept=".xml,text/xml,application/xml" multiple hidden><button class="primary" data-action="new-party" data-id="">Добавить контрагента</button>':''}</div></div>
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
  <div class="cp-fact"><span>Дата постановки на учёт в МНС</span><div>${e(day(c.registration_date)||'—')}</div></div>
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

const fileKinds={egr:'Выписка ЕГР',other:'Документ'};
// Выписки ЕГР и другие файлы контрагента: скачивание по закрытой ссылке, загрузка — у начальника ПТО и инженеров.
function partyFiles(data,c,canEdit){
 const files=(data.partyFiles||[]).filter(f=>f.counterparty_id===c.id).sort((a,b)=>String(b.statement_date||b.created_at).localeCompare(String(a.statement_date||a.created_at)));
 const list=files.length?`<div class="cp-system-list">${files.map(f=>`<div class="cp-system-row"><div><span class="pill">${e(fileKinds[f.kind]||'Документ')}</span></div><div><button type="button" class="link" data-action="download" data-id="${e(f.path)}">${e(f.name)}</button><small>${f.statement_date?`Сведения на ${e(day(f.statement_date))} · `:''}загружен ${e(day(String(f.created_at).slice(0,10)))}</small></div></div>`).join('')}</div>`:'<div class="cp-no-data">Выписка ЕГР не приложена.</div>';
 return list+(canEdit?`<div class="cp-work-grid cp-upload">${input('party-file-date','Сведения по состоянию на',new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Minsk'}),'date')}<label>Приложить выписку ЕГР (PDF, до 20 МБ)<input id="party-file" type="file" accept="application/pdf,.pdf"></label></div>`:'');
}

// Карточка: новый контрагент (c=null) или существующий. Без права записи все поля только для чтения.
export function partyCard({data,party:c=null,canEdit}){
 const ro=!canEdit,selected=new Set(c?partyRoles(data,c.id):[]);
 return `<form id="party-form" class="cp-drawer-shell" autocomplete="off">
  <div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>${e(c?(c.short_name||'Контрагент'):'Новый контрагент')}</h2>${c?`<div class="cp-card-meta"><span class="pill">УНП ${e(c.unp)}</span>${statusPill(c)}<span class="muted">Источник: ${e(c.source||'manual')}${c.mns_checked_at?` · сведения МНС на ${e(day(c.mns_checked_at))}`:''}</span></div>`:''}</div>
  <div class="cp-drawer-content">
   ${c?`<section class="cp-section"><div class="cp-section-title">В нашей системе</div>${usage(data,c)}</section>`:''}
   <section class="cp-section"><div class="cp-section-title">Роли контрагента</div><div class="cp-role-checks">${roleOrder.map(r=>`<label><input type="checkbox" name="roles" value="${e(r)}" ${selected.has(r)?'checked':''} ${ro?'disabled':''}>${e(partyRoleNames[r])}</label>`).join('')}</div></section>
   <section class="cp-section"><div class="cp-section-title">${c?'Официальные данные МНС':'Основные реквизиты'}</div>${c?facts(c):newFields()}</section>
   ${c?`<section class="cp-section"><div class="cp-section-title">Документы</div>${partyFiles(data,c,canEdit)}</section>`:''}
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
