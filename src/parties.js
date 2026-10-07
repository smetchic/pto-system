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

// Ручное добавление — запасной путь (основной — XML МНС): только то, без чего контрагента не сохранить.
const newFields=()=>`<p class="cp-hint">Быстрее и точнее — «Загрузить XML МНС» в списке контрагентов.</p><div class="cp-work-grid">${input('unp','УНП')}${input('short_name','Краткое наименование')}<div class="wide">${input('full_name','Полное наименование')}</div><div class="wide">${input('address','Юридический адрес')}</div></div>${['registration_date','tax_office_code','tax_office_name','status_code','status_name','status_change_date','liquidation_info'].map(k=>hidden(k)).join('')}`;

// Недействующий контрагент заметен сразу: дата и сведения МНС в красной плашке под заголовком.
function statusAlert(c){
 if(!c?.status_name||c.status_name==='Действующий')return '';
 return `<div class="cp-alert"><b>${e(c.status_name)}${c.status_change_date?` с ${e(day(c.status_change_date))}`:''}.</b> ${e(c.liquidation_info||'Проверьте договоры и платежи с этим контрагентом.')}</div>`;
}

const plural=(n,one,few,many)=>{const m10=n%10,m100=n%100;return `${n} ${m10===1&&m100!==11?one:m10>=2&&m10<=4&&(m100<12||m100>14)?few:many}`;};
// Договоры одной строкой каждый: номер, объект, текущая стоимость (из pto_contract_list, по последнему подписанному ДС).
function usage(data,c){
 const list=contractsOf(data,c.id),withContract=new Set(list.map(x=>x.project_id));
 const objects=new Set([...withContract,...(data.participants||[]).filter(x=>x.counterparty_id===c.id).map(x=>x.project_id)]);
 const sum=list.reduce((t,x)=>t+(Number(x.current_amount)||0),0);
 const rows=list.map(x=>{const p=projectOf(data,x.project_id),has=x.current_amount!==null&&x.current_amount!==undefined&&x.current_amount!=='';
  return `<div class="cp-use" title="Наша роль: ${e(ourRoleNames[x.our_role]||x.our_role||'')}${x.amount_addendum_number?` · стоимость по ДС №${e(x.amount_addendum_number)} от ${e(day(x.amount_addendum_date))}`:''}"><span><b>№${e(x.number||'—')}</b>${x.contract_date?` от ${e(day(x.contract_date))}`:''} · ${e(p?.name||'')}</span><span class="cp-use-sum">${has?money(x.current_amount):''}</span></div>`;});
 (data.participants||[]).filter(x=>x.counterparty_id===c.id&&!withContract.has(x.project_id)).forEach(x=>{const p=projectOf(data,x.project_id);rows.push(`<div class="cp-use"><span><b>${e(p?.name||'Объект')}</b> · ${e(partyRoleNames[x.role]||x.role)}, без договора</span><span></span></div>`);});
 if(!rows.length)return '<div class="cp-no-data">Пока не используется в объектах и договорах.</div>';
 return `<div class="cp-use-total"><span>${plural(objects.size,'объект','объекта','объектов')} · ${plural(list.length,'договор','договора','договоров')}</span>${list.length?`<b>${money(sum)} руб.</b>`:''}</div><div class="cp-use-list">${rows.join('')}</div>`;
}

const section=(title,body)=>`<section class="cp-section"><div class="cp-section-title">${title}</div>${body}</section>`;
const dash='<span class="muted">—</span>';
const row=(label,value)=>`<dt>${e(label)}</dt><dd>${value||dash}</dd>`;
const join=(...parts)=>parts.filter(Boolean).join(' · ');

// Просмотр: всё нужное списком «подпись — значение», без полей ввода, поэтому помещается без прокрутки.
function view(data,c){
 const roles=partyRoles(data,c.id);
 const director=join(e(join(c.director_title,c.director_name)),c.authority_basis?`на основании ${e(c.authority_basis)}`:'');
 return `${section('Объекты и договоры',usage(data,c))}
  ${section('Роли',roles.length?`<div class="cp-role-list">${roles.map(r=>`<span class="pill">${e(partyRoleNames[r])}</span>`).join('')}</div>`:'<span class="muted">Не назначены</span>')}
  ${section('Реквизиты',`<dl class="cp-props">
   ${row('Руководитель',director)}${row('Телефоны',e(String(c.phone||'').replace(/\s*\n\s*/g,', ')))}${row('Эл. почта',c.email?`<a href="mailto:${e(c.email)}">${e(c.email)}</a>`:'')}
   ${row('Счёт',c.bank_account?`<span class="cp-mono">${e(c.bank_account)}</span>`:'')}${row('Банк',join(e(c.bank_name),c.bank_bic?`БИК ${e(c.bank_bic)}`:''))}${row('ОКПО',e(c.okpo))}
   ${row('Адрес',e(c.address))}
   ${c.note?row('Примечание',e(c.note)):''}
  </dl>${c.mns_checked_at?`<div class="cp-source">Сведения МНС на ${e(day(c.mns_checked_at))}</div>`:''}`)}`;
}

// Правка: те же данные полями ввода. Официальные поля МНС уходят скрытыми и не правятся.
function edit(data,c){
 const selected=new Set(c?partyRoles(data,c.id):[]);
 return `${c?'':section('Основные реквизиты',newFields())}
  ${section('Роли',`<div class="cp-role-checks">${roleOrder.map(r=>`<label class="cp-chip"><input type="checkbox" name="roles" value="${e(r)}" ${selected.has(r)?'checked':''}>${e(partyRoleNames[r])}</label>`).join('')}</div>`)}
  ${section('Руководитель',`<div class="cp-work-grid">${input('director_title','Должность',c?.director_title)}${input('director_name','ФИО',c?.director_name)}<div class="wide">${input('authority_basis','Действует на основании',c?.authority_basis)}</div></div>`)}
  ${section('Контакты и банк',`<div class="cp-work-grid">${input('phone','Телефоны',(c?.phone||'').replace(/\s*\n\s*/g,', '))}${input('email','Эл. почта',c?.email,'email')}<div class="wide">${input('bank_account','Расчётный счёт (IBAN)',c?.bank_account)}</div>${input('bank_bic','БИК',c?.bank_bic)}${input('okpo','ОКПО',c?.okpo)}<div class="wide">${input('bank_name','Банк',c?.bank_name)}</div><div class="wide">${input('note','Примечание',c?.note)}</div></div>`)}
  ${c?officialFields.map(k=>hidden(k,c[k])).join(''):''}${hidden('source',c?.source||'manual')}`;
}

// Карточка контрагента — боковая панель общей ширины (--drawer-w). Открывается на просмотр, правка — по кнопке «Изменить».
// Новый контрагент (c=null) сразу открывается на правку.
export function partyCard({data,party:c=null,canEdit,editing=false}){
 const editMode=canEdit&&(editing||!c);
 const foot=editMode?`<p id="party-error" class="error" role="alert"></p>${c?`<button type="button" data-action="party" data-id="${e(c.id)}">Отмена</button>`:'<button type="button" data-action="dismiss">Отмена</button>'}<button class="primary" type="submit">Сохранить</button>`
  :canEdit?`<button class="primary" type="button" data-action="party-edit" data-id="${e(c.id)}">Изменить</button>`:'';
 return `<form id="party-form" class="cp-drawer-shell" autocomplete="off"${editMode?' data-editing':''}>
  <div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><div class="cp-title"><h2>${e(c?(c.short_name||'Контрагент'):'Новый контрагент')}</h2>${c&&c.full_name&&c.full_name!==c.short_name?`<div class="cp-full-name">${e(c.full_name)}</div>`:''}${c?`<div class="cp-card-meta"><span class="pill cp-unp">УНП ${e(c.unp)}</span>${statusPill(c)}</div>`:''}</div></div>
  ${statusAlert(c)}
  <div class="cp-drawer-content">${editMode?edit(data,c):view(data,c)}</div>
  ${foot?`<div class="cp-drawer-foot">${foot}</div>`:''}
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
