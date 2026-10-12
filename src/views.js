import {escapeHtml as e,money,kindNames,roleNames,actionNames,isDone,canWrite} from './domain.js';
import {partiesList} from './parties.js';
import {contractsList} from './contracts.js';
import {portfolioPage,objectListPage} from './portfolio.js';
import {conveyorPage} from './conveyor.js';
import {objectPage} from './object-page.js';
import {todayPage as todayView} from './today.js';
import {registersPage as registersView} from './registers.js';

export function renderWorkspace({ui,data,profile}) {
const btn=(text,action,id='',primary=false)=>`<button ${primary?'class="primary"':''} data-action="${action}" data-id="${e(id)}">${e(text)}</button>`;
const badge=(text,good=false)=>`<span class="badge ${good?'good':''}">${e(text)}</span>`;
const empty=text=>`<div class="empty">${e(text)}</div>`;
const fmtDate=x=>x?new Date(x).toLocaleString('ru-RU',{timeZone:'Europe/Minsk'}):'';
const currentPeriod=()=>data.periods?.find(p=>p.project_id===ui.project);
const editor=(pid=ui.project)=>canWrite(profile,data.memberships,pid);
const canEdit=()=>editor()&&currentPeriod()?.status==='open';
const docs=()=>data.documents.filter(d=>d.project_id===ui.project);
const ver=d=>data.versions.find(v=>v.id===d.current_version);
const projectName=id=>data.projects?.find(p=>p.id===id)?.name||'';
function documentsPage(){
 const allDocs=data.documents||[];
 const our=allDocs.filter(d=>data.contracts.find(c=>c.id===d.contract_id)?.direction==='outgoing');
 const marked=new Set((data.subMonth||[]).filter(x=>x.expected===true||x.expected==='true').map(x=>x.contract_id));
 const subs=allDocs.filter(d=>data.contracts.find(c=>c.id===d.contract_id)?.direction==='incoming'&&marked.has(d.contract_id));
 const actions=ui.project&&canEdit()?btn('Новый акт','new-doc','','primary')+btn('Справка С-3а','new-c3a')+btn('С-29','new-c29'):'';
 const row=d=>{
  const v=ver(d),a=data.versions.find(x=>x.id===d.accepted_version),c=data.contracts.find(x=>x.id===d.contract_id);
  const mark=(data.docMarks||[]).find(x=>x.document_id===d.id),part=mark?.part_id?(data.contractParts||[]).find(p=>p.id===mark.part_id)?.name:mark?.part;
  const fileCount=(data.files||[]).filter(f=>f.version_id===d.current_version).length;
  return `<tr class="dt-act"><td><button class="link" data-action="doc" data-id="${e(d.id)}">${e(kindNames[d.kind])} № ${e(d.number)}</button><small class="dt-part">${e(part||'')}</small><small>Версия ${v?.version||1}${d.accepted_version&&d.current_version!==d.accepted_version?' · есть изменения':''}</small></td><td><span class="dt-party">${e(c?.party||'')}</span><small class="dt-contract">Договор № ${e(c?.number||'—')}</small><small>${e(projectName(d.project_id))}</small></td><td>${d.workflow_id?`<button class="link" data-action="workflow" data-id="${e(d.workflow_id)}">${badge(d.step_label||'—',isDone(d))}</button>`:badge('Без комплекта')}</td><td>${e(d.due_date||'—')}</td><td class="num">${d.kind==='c29'?'—':money(v?.amount)}</td><td class="num">${d.kind==='c29'?'—':a?money(a.amount):'—'}</td><td class="dt-scan">${fileCount?fileCount+' ✓':'—'}</td></tr>`;
 };
 const group=(title,items,cls)=>items.length?`<tr class="${cls}"><td colspan="7">${e(title)} <span>${items.length}</span></td></tr>${items.map(row).join('')}`:'';
 const body=group('Наши документы',our,'dt-ours-head')+group('Документы субподрядчиков',subs,'dt-subs-head');
 const table=`<div class="table-wrap"><table class="dt-table"><thead><tr><th>Документ / часть объекта</th><th>Контрагент / договор</th><th>Состояние</th><th>Срок</th><th class="num">Рабочая версия, руб.</th><th class="num">Принято, руб.</th><th>Скан</th></tr></thead><tbody>${body}</tbody></table></div>`;
 return heading('Документы','Документы текущего отчётного месяца. Субподрядчики отображаются только при отметке «Подаёт в этом месяце».')+`<section><div class="dt-toolbar">${actions}</div>${body?table:empty('В этом месяце документов ещё нет.')}</section>`;
}
function auditPage(){return heading('Журнал изменений','Последние 150 событий по доступным объектам. Время — Минск.')+`<section class="table-wrap"><table><thead><tr><th>Время</th><th>Событие</th><th>Объект</th><th>Пользователь</th><th>Основание</th></tr></thead><tbody>${data.events.map(x=>`<tr><td>${e(fmtDate(x.created_at))}</td><td>${e(actionNames[x.action]||x.action)}</td><td>${e(projectName(x.project_id))}</td><td>${e(data.profiles.find(p=>p.id===x.actor)?.display_name||x.actor)}</td><td>${e(x.detail.reason||x.detail.proof||x.detail.note||'')}</td></tr>`).join('')}</tbody></table></section>`;}
function teamPage(){return heading('Команда','Учётные записи и роли ведёт начальник ПТО. Инженер видит все объекты, а вносит данные по закреплённым. Руководитель только смотрит.',profile.role==='head'?btn('Добавить сотрудника','new-member','','primary'):'')+`<section class="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Роль</th><th>Доступ</th><th>Объекты</th></tr></thead><tbody>${data.profiles.map(p=>`<tr><td><button class="link" data-action="member-card" data-id="${e(p.id)}">${e(p.display_name)}</button></td><td>${e(roleNames[p.role])}</td><td>${p.active?'Активен':'Не активирован'}</td><td>${p.role==='head'?'Все':p.role==='director'?'Просмотр всех':data.memberships.filter(m=>m.user_id===p.id).map(m=>e(projectName(m.project_id))).join(', ')}</td></tr>`).join('')}</tbody></table></section>`;}

// Все разделы в левой колонке, три группы (решение 11.10.2026): работа, справочники, служебные. На телефоне внизу — работа и «Ещё».
const NAV=[
 ['work',[
  ['today','Сегодня','<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'],
  ['objects','Портфель','<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'],
  ['flow','Подписание','<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v12"/>'],
  ['register','Реестры','<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>']]],
 ['ref',[
  ['objectlist','Объекты','<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 10h1M14 10h1M9 14h1M14 14h1M10 21v-3h4v3"/>'],
  ['contracts','Договоры','<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'],
  ['parties','Контрагенты','<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>'],
  ['documents','Документы','<path d="M8 7V4a1 1 0 0 1 1-1h7l4 4v11a1 1 0 0 1-1 1h-3"/><rect x="4" y="7" width="12" height="14" rx="1"/>'],
  ['deadlines','Сроки','<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>']]],
 ['service',[
  ['audit','Журнал изменений','<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>'],
  ['team','Команда и права','<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'],
  ['settings','Настройки','<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'],
  ['help','Справка','<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4M12 17h.01"/>']]]
];
const allNav=NAV.flatMap(([,items])=>items),mobileMain=['today','objects','flow','register'];
const icon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const todayKey=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function heading(title,sub,actions=''){return `<div class="heading"><div><h1>${e(title)}</h1><div class="muted">${e(sub)}</div></div><div class="actions">${actions}</div></div>`;}
function due(d){if(!d.due_date)return '<span class="muted">Без срока</span>';const done=isDone(d),late=!done&&d.due_date<todayKey;return `<span class="pill ${late?'e':done?'g':'w'}">${late?'Просрочен · ':''}${e(new Date(d.due_date+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:'Europe/Minsk'}))}</span>`;}
function actionList(list){return list.length?list.slice().sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')).map(d=>`<button class="act" data-action="doc" data-id="${e(d.id)}"><span class="av">${e(projectName(d.project_id).slice(0,1)||'П')}</span><span class="t"><b>${e(d.step_label||'Без комплекта')}</b><small>${e(kindNames[d.kind])} № ${e(d.number)} · ${e(projectName(d.project_id))}</small></span>${due(d)}</button>`).join(''):empty('Нет документов со сроками.');}
function todayPage(){return todayView({ui,data,profile,today:todayKey,lastVisit:ui.lastVisit});}
function objectsPage(){return portfolioPage({ui,data,profile,today:todayKey,view:ui.portfolioView==='table'?'table':'tiles'});}
function flowPage(){return conveyorPage({ui,data,profile,month:ui.month});}
// Страница объекта: docs/object.md, разметка в object-page.js.
function projectPage(){return objectPage({ui,data,profile,today:todayKey});}
function registersPage(){return registersView({ui,data,profile,cum:ui.genCum});}
function deadlinesPage(){const list=data.documents.filter(d=>!isDone(d));return heading('Сроки','Документы за отчётный месяц, комплекты которых ещё не отмечены как принятые бухгалтерией.')+actionList(list);}
function contractsPage(){return contractsList({data,ui,profile,today:todayKey});}
function partiesPage(){return partiesList({data,ui,canEdit:['head','engineer'].includes(profile?.role)});}
function settingsPage(){return heading('Настройки','Тема и размер текста сохраняются в вашем профиле и действуют на любом устройстве.')+`<h2>Тема оформления</h2><div class="theme-options">${[['light','Светлая'],['dark','Тёмная'],['system','Как в системе']].map(([id,label])=>`<button class="theme-option ${ui.theme===id?'on':''}" data-action="theme" data-id="${id}" aria-pressed="${ui.theme===id}"><span class="theme-preview ${id}"><i></i><b></b></span><span>${label}${ui.theme===id?' ✓':''}</span></button>`).join('')}</div><p class="muted">«Как в системе» следует настройке вашего устройства.</p><h2>Размер текста</h2><div class="theme-options">${[[100,'Обычный'],[115,'Крупнее'],[130,'Крупный']].map(([id,label])=>`<button class="theme-option scale-option ${ui.textScale===id?'on':''}" data-action="text-scale" data-id="${id}" aria-pressed="${ui.textScale===id}"><span class="scale-preview" style="font-size:${13*id/100}px">Аа 12 486,91</span><span>${label} · ${id} %${ui.textScale===id?' ✓':''}</span></button>`).join('')}</div><p class="muted">Увеличивает всю страницу, как Ctrl +. Выбор сохраняется в профиле и действует на любом компьютере.</p><h2>Учётная запись</h2><p>${e(profile.display_name)} · ${e(roleNames[profile.role])}</p>${btn('Сменить пароль','password')} ${btn('Выйти из системы','logout')}`;}
function helpPage(){return heading('Справка','Работа с объектами и документами.')+`<div class="help-text"><h2>Начало работы</h2><p>Начальник ПТО добавляет объект в разделе «Объекты», затем откройте вкладку «Договоры» и создайте договор. Откройте отчётный месяц и добавьте документы.</p><h2>Комплекты и маршруты</h2><p>Документы месяца по договору собираются в комплект автоматически: акты С-2 и справка С-3а — процентовка заказчику, акты субподрядчика — процентовка субподрядчика, С-29 — отдельный маршрут. Комплект движется по шагам; все шаги, включая передачу и принятие бухгалтерией, отмечает ПТО — бухгалтерия системой не пользуется. Переход фиксирует, кому передано и подтверждение; при принятии бухгалтерией — кто принял и отметку о принятии.</p><p>Возврат — на любой предыдущий шаг с причиной и указанием документа с замечанием. Новая версия документа или новый документ возвращают комплект на первый шаг. Бухгалтерия принимает комплект целиком: принятые версии всех документов фиксируются одновременно. Запись о подписи в системе не является электронной подписью.</p><h2>Выполнение и субподряд</h2><p>В реестр входят суммы принятых актов. С-3а и С-29 не увеличивают выполнение повторно. На вкладке «Месяц» страницы объекта (клетка «Субподряд сопоставлен») сопоставьте принятые входящие и исходящие акты в ценах предъявления заказчику.</p><h2>Закрытие месяца</h2><p>Начальник ПТО проверяет комплект документов и закрывает период. Система сохраняет снимок выполнения. Администратор может повторно открыть период с указанием причины.</p><h2>Доступ</h2><p>Учётные записи активирует администратор. Инженеры работают только с назначенными объектами. Доступные действия определяются вашей ролью.</p></div>`;}
// Выбор отчётного месяца: «‹ Сентябрь 2026 ›», по клику — год со стрелками и 12 месяцев; будущие серые, месяц всегда выбран.
const MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
function monthPicker(){
 const [y,m]=ui.month.split('-').map(Number),cur=todayKey.slice(0,7),year=ui.pickYear||y;
 const pop=ui.monthPick?`<div class="bk" data-action="month-pick" data-id="close"></div><div class="mp-pop" role="dialog" aria-label="Отчётный месяц"><div class="mp-y"><button class="mp-a" data-action="month-year" data-id="${year-1}" aria-label="Предыдущий год">‹</button><b>${year}</b><button class="mp-a" data-action="month-year" data-id="${year+1}" aria-label="Следующий год">›</button></div>
  <div class="mp-grid">${MONTHS.map((n,i)=>{const k=`${year}-${String(i+1).padStart(2,'0')}`;return `<button class="${k===ui.month?'on':''}${k===cur?' now':''}${k>cur?' fut':''}" data-action="month-set" data-id="${k}" aria-pressed="${k===ui.month}">${n.slice(0,3)}</button>`;}).join('')}</div>
  <button class="mp-now" data-action="month-set" data-id="${cur}">Текущий месяц</button></div>`:'';
 return `<div class="mp" aria-label="Отчётный месяц"><button class="mp-a" data-action="month-step" data-id="-1" aria-label="Предыдущий месяц" title="Предыдущий месяц">‹</button><button class="mp-l" data-action="month-pick" data-id="" aria-expanded="${!!ui.monthPick}">${MONTHS[m-1]} ${y}</button><button class="mp-a" data-action="month-step" data-id="1" aria-label="Следующий месяц" title="Следующий месяц">›</button>${pop}</div>`;
}
function shell(content){const title=ui.route==='project'?projectName(ui.project):allNav.find(n=>n[0]===ui.route)?.[1]||'Сегодня';
 const railItem=([id,label,path])=>`<button class="nav-item ${mobileMain.includes(id)?'':'m-hide'} ${ui.route===id||(id==='objects'&&ui.route==='project')?'on':''}" title="${label}" aria-label="${label}" data-action="nav" data-id="${id}">${icon(path)}<span>${label}</span></button>`;
 const groups=NAV.map(([g,items])=>`<div class="nav-g ${g}">${items.map(railItem).join('')}</div>`);
 const moreOn=!mobileMain.includes(ui.route)&&ui.route!=='project';
 return `<div id="shell"><aside id="hd" class="${ui.wide?'wide':''}" aria-label="Навигация"><div class="logo" title="Система ПТО">П</div>${groups[0]}<div class="nav-sep"></div>${groups[1]}<div class="sp"></div>${groups[2]}<button class="nav-item m-only ${ui.more||moreOn?'on':''}" data-action="more" aria-label="Ещё" title="Ещё" aria-expanded="${!!ui.more}">${icon('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>')}<span>Ещё</span></button><button class="nav-item wb" data-action="wide" title="${ui.wide?'Свернуть':'Подписи'}" aria-label="${ui.wide?'Свернуть':'Подписи'}">${icon('<path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>')}<span>Свернуть</span></button></aside>${ui.more?`<div class="bk" data-action="more"></div><nav class="pop" aria-label="Разделы">${allNav.filter(n=>!mobileMain.includes(n[0])).map(([id,label,path])=>`<button data-action="nav" data-id="${id}">${icon(path)}${label}</button>`).join('')}</nav>`:''}<main><header class="top"><div class="crumb">${ui.route==='project'?'<button class="link" data-action="nav" data-id="objects">Портфель</button> / ':''}${e(title)}</div><select id="jump" class="jump" aria-label="Перейти к объекту или разделу"><option value="">Перейти к объекту или разделу</option><optgroup label="Объекты">${data.projects.map(p=>`<option value="project:${e(p.id)}">${e(p.name)}</option>`).join('')}</optgroup><optgroup label="Разделы">${allNav.map(([id,label])=>`<option value="nav:${id}">${label}</option>`).join('')}</optgroup></select>${monthPicker()}<button class="refresh" title="Обновить данные" aria-label="Обновить данные" data-action="refresh">${icon('<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2"/>')}</button><button class="who" data-action="nav" data-id="settings">${e(profile.display_name)} · ${e(roleNames[profile.role])}</button></header><div class="pg">${content}</div></main></div>`;
}
const pages={today:todayPage,contracts:contractsPage,objects:objectsPage,project:projectPage,flow:flowPage,register:registersPage,documents:documentsPage,audit:auditPage,team:()=>teamPage().replace('<h1>Команда</h1>','<h1>Команда и права</h1>'),deadlines:deadlinesPage,objectlist:()=>objectListPage({data,profile}),parties:partiesPage,settings:settingsPage,help:helpPage};
return shell((pages[ui.route]||todayPage)());
}
