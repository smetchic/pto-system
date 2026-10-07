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

// Сведения МНС одной компактной группой: адрес, инспекция, дата постановки. Коды МНС хранятся, но не показываются.
function facts(c){
 return `<dl class="cp-facts">
  <div class="wide"><dt>Юридический адрес</dt><dd>${e(c.address||'—')}</dd></div>
  <div><dt>Инспекция МНС</dt><dd>${e(c.tax_office_name||'—')}</dd></div>
  <div><dt>На учёте с</dt><dd>${e(day(c.registration_date)||'—')}</dd></div>
 </dl>`;
}
// Ручное добавление — запасной путь (основной — XML МНС): только то, без чего контрагента не сохранить.
const newFields=()=>`<p class="cp-hint">Быстрее и точнее — «Загрузить XML МНС» в списке контрагентов.</p><div class="cp-work-grid">${input('unp','УНП')}${input('short_name','Краткое наименование')}${area('full_name','Полное наименование')}${area('address','Юридический адрес')}</div>${['registration_date','tax_office_code','tax_office_name','status_code','status_name','status_change_date','liquidation_info'].map(k=>hidden(k)).join('')}`;

// Недействующий контрагент заметен сразу: дата и сведения МНС в красной плашке под заголовком.
function statusAlert(c){
 if(!c?.status_name||c.status_name==='Действующий')return '';
 return `<div class="cp-alert"><b>${e(c.status_name)}${c.status_change_date?` с ${e(day(c.status_change_date))}`:''}.</b> ${e(c.liquidation_info||'Проверьте договоры и платежи с этим контрагентом.')}</div>`;
}

// Итоги по контрагенту: объекты, договоры и их текущая стоимость (из pto_contract_list).
function totals(data,c){
 const list=contractsOf(data,c.id),objects=new Set([...list.map(x=>x.project_id),...(data.participants||[]).filter(x=>x.counterparty_id===c.id).map(x=>x.project_id)]);
 const sum=list.reduce((t,x)=>t+(Number(x.current_amount)||0),0);
 return `<div class="cp-kpis"><div><span>Объектов</span><b>${objects.size}</b></div><div><span>Договоров</span><b>${list.length}</b></div><div><span>Стоимость договоров</span><b>${list.length?`${money(sum)} руб.`:'—'}</b></div></div>`;
}

function usage(data,c){
 const rows=[],withContract=new Set(contractsOf(data,c.id).map(x=>x.project_id));
 contractsOf(data,c.id).forEach(x=>{
  // Текущая стоимость вычисляется в базе (pto_contract_list) по последнему подписанному допсоглашению.
  const p=projectOf(data,x.project_id),amount=x.current_amount,has=amount!==null&&amount!==undefined&&amount!=='';
  rows.push(`<div class="cp-use"><div><b>Договор №${e(x.number||'—')}${x.contract_date?` от ${e(day(x.contract_date))}`:''}</b><small>${e(p?.name||'')} · наша роль: ${e(ourRoleNames[x.our_role]||x.our_role||'')}${x.amount_addendum_number?` · ДС №${e(x.amount_addendum_number)} от ${e(day(x.amount_addendum_date))}`:''}</small></div><div class="cp-use-sum">${has?`${money(amount)} руб.`:''}</div></div>`);
 });
 (data.participants||[]).filter(x=>x.counterparty_id===c.id&&!withContract.has(x.project_id)).forEach(x=>{const p=projectOf(data,x.project_id);rows.push(`<div class="cp-use"><div><b>${e(p?.name||'Объект')}</b><small>${e(partyRoleNames[x.role]||x.role)} · без договора</small></div><div></div></div>`);});
 return rows.length?`<div class="cp-use-list">${rows.join('')}</div>`:'<div class="cp-no-data">Пока не используется в объектах и договорах.</div>';
}

const section=(title,body,cls='')=>`<section class="cp-section ${cls}"><div class="cp-section-title">${title}</div>${body}</section>`;

// Карточка: новый контрагент (c=null) или существующий. Без права записи все поля только для чтения.
// Раскладка под монитор 24″ (окно ≈1920×950): две колонки без прокрутки. Слева — кто это и где он у нас,
// справа — реквизиты для документов. На узком экране колонки встают друг под друга.
export function partyCard({data,party:c=null,canEdit}){
 const ro=!canEdit,selected=new Set(c?partyRoles(data,c.id):[]);
 const roles=`<div class="cp-role-checks">${roleOrder.map(r=>`<label class="cp-chip"><input type="checkbox" name="roles" value="${e(r)}" ${selected.has(r)?'checked':''} ${ro?'disabled':''}>${e(partyRoleNames[r])}</label>`).join('')}</div>`;
 const left=c?`${totals(data,c)}${section('Объекты и договоры',usage(data,c))}${section('Роли',roles)}${section(`Сведения МНС${c.mns_checked_at?` <span class="cp-muted-title">на ${e(day(c.mns_checked_at))}</span>`:''}`,facts(c))}`
  :`${section('Основные реквизиты',newFields())}${section('Роли',roles)}`;
 const right=`${section('Руководитель и право подписи',`<div class="cp-work-grid">${input('director_title','Должность',c?.director_title,'text',ro)}${input('director_name','ФИО',c?.director_name,'text',ro)}<div class="wide">${input('authority_basis','Действует на основании',c?.authority_basis,'text',ro)}</div></div>`)}
  ${section('Банк',`<div class="cp-work-grid"><div class="wide">${input('bank_account','Расчётный счёт (IBAN)',c?.bank_account,'text',ro)}</div>${input('bank_bic','БИК',c?.bank_bic,'text',ro)}${input('okpo','ОКПО',c?.okpo,'text',ro)}<div class="wide">${input('bank_name','Банк',c?.bank_name,'text',ro)}</div></div>`)}
  ${section('Контакты',`<div class="cp-work-grid cp-contacts">${input('phone','Телефоны',(c?.phone||'').replace(/\s*\n\s*/g,', '),'text',ro)}${input('email','Электронная почта',c?.email,'email',ro)}</div>`)}
  ${section('Примечание',`<div class="cp-work-grid">${area('note','Для своих: особенности, с кем говорить',c?.note,ro)}</div>`)}`;
 return `<form id="party-form" class="cp-drawer-shell" autocomplete="off">
  <div class="cp-drawer-head"><div class="cp-title"><h2>${e(c?(c.short_name||'Контрагент'):'Новый контрагент')}</h2>${c&&c.full_name&&c.full_name!==c.short_name?`<div class="cp-full-name">${e(c.full_name)}</div>`:''}${c?`<div class="cp-card-meta"><span class="pill cp-unp">УНП ${e(c.unp)}</span>${statusPill(c)}</div>`:''}</div><button type="button" class="cp-drawer-close" data-action="dismiss" aria-label="Закрыть">×</button></div>
  ${statusAlert(c)}
  <div class="cp-drawer-content"><div class="cp-col">${left}</div><div class="cp-col cp-col-edit">${right}</div>
   ${c?officialFields.map(k=>hidden(k,c[k])).join(''):''}${hidden('source',c?.source||'manual')}</div>
  <div class="cp-drawer-foot"><p id="party-error" class="error" role="alert"></p><button type="button" data-action="dismiss">${ro?'Закрыть':'Отмена'}</button>${ro?'':'<button class="primary" type="submit">Сохранить</button>'}</div>
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
