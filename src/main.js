import {createClient} from '@supabase/supabase-js';
import {escapeHtml as e,money,stateNames,kindNames,roleNames,actionNames,registerMatrix} from './domain.js';
import './style.css';
const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#dialog');
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const monthNow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit'}).format(new Date());
const ui={route:'today',month:monthNow,project:null,doc:null,busy:false,recovery:false};
let client,session,profile,data={},loadId=0;
const btn=(text,action,id='',primary=false)=>`<button ${primary?'class="primary"':''} data-action="${action}" data-id="${e(id)}">${e(text)}</button>`;
const badge=(text,good=false)=>`<span class="badge ${good?'good':''}">${e(text)}</span>`;
const empty=text=>`<div class="empty">${e(text)}</div>`;
const field=(name,label,type='text',value='',required=true)=>`<label>${e(label)}<input name="${name}" type="${type}" value="${e(value)}" ${required?'required':''} ${type==='number'?'step="0.01" min="0"':''}></label>`;
const select=(name,label,options)=>`<label>${e(label)}<select name="${name}" required>${options.map(([id,title])=>`<option value="${e(id)}">${e(title)}</option>`).join('')}</select></label>`;
const note=(name,label,value='')=>`<label>${e(label)}<textarea name="${name}" required>${e(value)}</textarea></label>`;
const fmtDate=x=>x?new Date(x).toLocaleString('ru-RU',{timeZone:'Europe/Minsk'}):'';
const currentPeriod=()=>data.periods?.find(p=>p.project_id===ui.project);
const editor=()=>['head','engineer'].includes(profile?.role);
const canEdit=()=>editor()&&currentPeriod()?.status==='open';
const docs=()=>data.documents.filter(d=>d.project_id===ui.project);
const ver=d=>data.versions.find(v=>v.id===d.current_version);
const projectName=id=>data.projects?.find(p=>p.id===id)?.name||'';
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,8000);}
function errorMessage(err){const text=err?.message||String(err);return /Invalid login credentials/.test(text)?'Неверная почта или пароль.':/Failed to fetch|fetch failed/.test(text)?'Нет связи с сервером. Изменения не подтверждены. Обновите данные перед повтором.':text;}
async function query(q){const {data,error}=await q;if(error)throw error;return data;}
async function all(table,filter=q=>q){let rows=[],start=0;while(true){const part=await query(filter(client.from(table).select('*')).order('id').range(start,start+499));rows.push(...part);if(part.length<500)return rows;start+=500;}}
async function load(){
 const generation=++loadId;if(!session||ui.recovery)return login();
 profile=await query(client.from('pto_profiles').select('*').eq('id',session.user.id).maybeSingle());
 if(generation!==loadId)return;
 if(!profile?.active){app.innerHTML=`<section class="login"><div class="mark">22</div><h1>Доступ ещё не назначен</h1><p>Администратор должен активировать вашу учётную запись и назначить объекты.</p><p class="muted">${e(session.user.email)}</p>${btn('Проверить доступ','refresh')}${btn('Выйти','logout')}</section>`;return;}
 const [projects,contracts,periods,profiles,memberships]=await Promise.all([all('pto_projects'),all('pto_contracts'),all('pto_periods',q=>q.eq('month',ui.month+'-01')),all('pto_profiles'),query(client.from('pto_memberships').select('*'))]);
 if(generation!==loadId)return;
 const ids=periods.map(p=>p.id);
 const [documents,allocations,register]=ids.length?await Promise.all([all('pto_documents',q=>q.in('period_id',ids)),all('pto_allocations',q=>q.in('period_id',ids)),query(client.from('pto_register').select('*').eq('month',ui.month+'-01'))]):[[],[],[]];
 const dids=documents.map(d=>d.id);
 const versions=dids.length?await all('pto_versions',q=>q.in('document_id',dids)):[];
 const events=await query(client.from('pto_events').select('*').order('id',{ascending:false}).limit(150));
 if(generation!==loadId)return;
 data={projects,contracts,periods,profiles,memberships,documents,allocations,register,versions,events};
 if(ui.project&&!projects.some(p=>p.id===ui.project))ui.project=null;
 render();
}
function shell(content,title){return `<div class="shell"><aside><div class="brand"><div class="mark">22</div><div><b>Система ПТО</b><small>СУ-22 · рабочее пространство</small></div></div><nav>${[['today','Сегодня'],['objects','Объекты'],['register','Реестр выполнения'],['documents','Документы'],['audit','Журнал изменений'],['team','Команда']].map(([id,label])=>`<button data-action="nav" data-id="${id}" class="${ui.route===id?'active':''}">${label}</button>`).join('')}</nav><div class="navfoot"><b>${e(profile.display_name)}</b><small>${e(roleNames[profile.role])}</small>${btn('Выйти','logout')}</div></aside><main><header><span>${e(title)}</span><label class="month">Отчётный месяц <input id="month" type="month" value="${ui.month}"></label>${btn('Обновить','refresh')}</header><div class="content">${content}</div></main></div>`;}
function heading(title,sub,actions=''){return `<div class="heading"><div><h1>${e(title)}</h1><p class="muted">${e(sub)}</p></div><div class="actions">${actions}</div></div>`;}
function render(){
 const pages={today:todayPage,objects:objectsPage,project:projectPage,register:registerPage,documents:documentsPage,audit:auditPage,team:teamPage};
 app.innerHTML=shell((pages[ui.route]||todayPage)(),ui.route==='project'?projectName(ui.project):'Единая система ПТО');
}
function todayPage(){const pending=data.documents.filter(d=>d.status!=='accepted'),total=data.register.reduce((s,r)=>s+Number(r.total),0);
 return heading('Рабочий месяц','Действия сформированы по состоянию документов и периодов.')+`<div class="stats"><article><small>Объекты в работе</small><strong>${data.projects.length}</strong></article><article><small>Ожидают завершения</small><strong>${pending.length}</strong></article><article><small>Принято, руб.</small><strong>${money(total)}</strong></article><article><small>Закрыто периодов</small><strong>${data.periods.filter(p=>p.status==='closed').length} / ${data.periods.length}</strong></article></div><section><h2>Ближайшие действия</h2>${pending.length?docTable(pending):empty('Открытых документов нет. Начните с объекта и отчётного месяца.')}</section><section><h2>Объекты</h2>${projectCards()}</section>`;
}
function projectCards(){return data.projects.length?`<div class="cards">${data.projects.map(p=>{const period=data.periods.find(x=>x.project_id===p.id);return `<button class="project-card" data-action="project" data-id="${p.id}"><small>${period?.status==='closed'?'Месяц закрыт':period?'Месяц в работе':'Месяц ещё не открыт'}</small><h2>${e(p.name)}</h2><p>${e(p.address)}</p><span>Открыть объект →</span></button>`;}).join('')}</div>`:empty('Пока нет объектов. Начальник ПТО или администратор может добавить первый.');}
function objectsPage(){return heading('Объекты','Договоры, документы и выполнение по каждому объекту.',['head','admin'].includes(profile.role)?btn('Добавить объект','new-project','',true):'')+projectCards();}
function projectPage(){const p=currentPeriod(),contracts=data.contracts.filter(c=>c.project_id===ui.project);
 let actions=btn('Все объекты','nav','objects');if(!p&&editor())actions+=btn('Открыть месяц','open-period','',true);if(canEdit())actions+=btn('Новый документ','new-doc','',true);
 if(p?.status==='open'&&profile.role==='head')actions+=btn('Проверить','review')+btn('Закрыть период','close');
 if(p?.status==='closed'&&profile.role==='admin')actions+=btn('Открыть повторно','reopen');
 const reg=data.register.filter(r=>r.project_id===ui.project),total=reg.reduce((s,r)=>s+Number(r.total),0),sub=reg.reduce((s,r)=>s+Number(r.subcontract),0);
 return heading(projectName(ui.project),p?(p.status==='closed'?'Период закрыт. Снимок сохранён.':p.reviewed_revision===p.revision?'Период проверен начальником ПТО.':'Период в работе. Обязательный комплект: акт, С-3а, С-29.'):'Создайте договоры и откройте отчётный месяц.',actions)+`<div class="stats"><article><small>Принято по актам, руб.</small><strong>${money(total)}</strong></article><article><small>Своими силами, руб.</small><strong>${money(total-sub)}</strong></article><article><small>Субподряд в ценах предъявления, руб.</small><strong>${money(sub)}</strong></article></div><section><div class="row"><h2>Документы месяца</h2>${canEdit()?btn('Сопоставить субподряд','allocate'):''}</div>${docTable(docs())}</section><section><div class="row"><h2>Договоры</h2>${editor()?btn('Добавить договор','new-contract'):''}</div>${contracts.length?`<table><thead><tr><th>Договор</th><th>Направление</th><th>Контрагент</th></tr></thead><tbody>${contracts.map(c=>`<tr><td>${e(c.number)}</td><td>${c.direction==='incoming'?'Входящий субподряд':'Предъявление заказчику'}</td><td>${e(c.party)}</td></tr>`).join('')}</tbody></table>`:empty('Добавьте договор для подготовки документов.')}</section>`;
}
function docTable(list){return list.length?`<div class="table-wrap"><table><thead><tr><th>Документ</th><th>Объект / договор</th><th>Состояние</th><th>Срок</th><th class="num">Рабочая версия, руб.</th><th class="num">Принято, руб.</th></tr></thead><tbody>${list.map(d=>{const v=ver(d),a=data.versions.find(x=>x.id===d.accepted_version),c=data.contracts.find(x=>x.id===d.contract_id);return `<tr><td><button class="link" data-action="doc" data-id="${d.id}">${kindNames[d.kind]} № ${e(d.number)}</button><small>Версия ${v?.version||1}${d.accepted_version&&d.current_version!==d.accepted_version?' · есть изменения':''}</small></td><td>${e(projectName(d.project_id))}<small>${e(c?.number)} · ${c?.direction==='incoming'?'Входящий':'Исходящий'}</small></td><td>${badge(stateNames[d.status],d.status==='accepted')}</td><td>${e(d.due_date||'')}</td><td class="num">${money(v?.amount)}</td><td class="num">${a?money(a.amount):''}</td></tr>`;}).join('')}</tbody></table></div>`:empty('В этом месяце документы ещё не созданы.');}
function documentsPage(){return heading('Документы','Передача, получение, подпись и принятие фиксируются отдельно.')+`<section>${docTable(data.documents)}</section>`;}
function matrix(){return registerMatrix(data.register,data.projects,data.contracts,data.documents,data.allocations);}
function registerPage(){const m=matrix();return heading('Реестр выполнения','Суммы принятых актов. Распределение субподряда — в ценах предъявления заказчику.',btn('Excel','export')+btn('Печать','print'))+`<section><div class="table-wrap"><table><thead><tr><th>Объект / договор</th><th class="num">Всего, руб.</th><th class="num">Своими силами</th><th class="num">Субподряд</th>${m.subs.map(s=>`<th class="num">${e(s)}</th>`).join('')}</tr></thead><tbody>${m.rows.map(r=>`<tr><td><button class="link" data-action="project" data-id="${r.project_id}">${e(r.object)}</button><small>${e(r.number)} · Итого по договору</small></td><td class="num">${money(r.total)}</td><td class="num">${money(r.own)}</td><td class="num">${money(r.subcontract)}</td>${m.subs.map(s=>`<td class="num">${r.split[s]?money(r.split[s]):''}</td>`).join('')}</tr>`).join('')}<tr class="total"><td>Итого</td>${['total','own','subcontract'].map(k=>`<td class="num">${money(m.rows.reduce((s,r)=>s+Number(r[k]),0))}</td>`).join('')}${m.subs.map(s=>`<td class="num">${money(m.rows.reduce((sum,r)=>sum+r.split[s],0))}</td>`).join('')}</tr></tbody></table></div>${!m.rows.length?empty('Откройте месяц в карточке объекта.'):''}</section>`;}
function auditPage(){return heading('Журнал изменений','Последние 150 событий по доступным объектам. Время — Минск.')+`<section><table><thead><tr><th>Время</th><th>Событие</th><th>Объект</th><th>Пользователь</th><th>Основание</th></tr></thead><tbody>${data.events.map(x=>`<tr><td>${e(fmtDate(x.created_at))}</td><td>${e(actionNames[x.action]||x.action)}</td><td>${e(projectName(x.project_id))}</td><td>${e(data.profiles.find(p=>p.id===x.actor)?.display_name||x.actor)}</td><td>${e(x.detail.reason||x.detail.proof||x.detail.note||'')}</td></tr>`).join('')}</tbody></table></section>`;}
function teamPage(){return heading('Команда','Учётные записи создаются администратором. Доступ инженеров назначается по объектам.')+`<section><table><thead><tr><th>Сотрудник</th><th>Роль</th><th>Доступ</th><th>Объекты</th><th></th></tr></thead><tbody>${data.profiles.map(p=>`<tr><td>${e(p.display_name)}</td><td>${e(roleNames[p.role])}</td><td>${p.active?'Активен':'Не активирован'}</td><td>${['admin','head'].includes(p.role)?'Все':data.memberships.filter(m=>m.user_id===p.id).map(m=>e(projectName(m.project_id))).join(', ')}</td><td>${profile.role==='admin'&&p.id!==profile.id?btn('Учётная запись','profile',p.id):''}${['head','admin'].includes(profile.role)?btn('Назначить объект','member',p.id):''}</td></tr>`).join('')}</tbody></table></section>`;}
function modal(title,html){dialog.innerHTML=`<div class="row"><h2>${e(title)}</h2>${btn('Закрыть','dismiss')}</div>${html}`;if(!dialog.open)dialog.showModal();}
function form(title,fields,submit){modal(title,`<form id="modal-form">${fields}<p id="form-error" class="error" role="alert"></p><div class="actions"><button class="primary" type="submit">Сохранить</button></div></form>`);$('#modal-form').onsubmit=async ev=>{ev.preventDefault();const button=ev.submitter;button.disabled=true;try{await submit(Object.fromEntries(new FormData(ev.target)));dialog.close();}catch(err){$('#form-error').textContent=errorMessage(err);}finally{button.disabled=false;}};}
async function mutate(payload){const result=await query(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload}));await load();toast('Сохранено');return result;}
function periodPayload(op,extra={}){const p=currentPeriod();if(!p)throw Error('Откройте месяц');return {op,period_id:p.id,expected_revision:p.revision,...extra};}
async function docModal(id){
 const d=data.documents.find(x=>x.id===id);if(!d)throw Error('Документ не найден');ui.doc=id;ui.project=d.project_id;
 const files=await all('pto_files',q=>q.in('version_id',data.versions.filter(v=>v.document_id===id).map(v=>v.id)));
 const v=ver(d),p=currentPeriod();const next={draft:['send','Передать'],sent:['receive','Подтвердить получение'],received:['sign','Зафиксировать подпись'],signed:['accept','Принять бухгалтерией']}[d.status];
 const editable=p?.status==='open';const canNext=editable&&next&&(next[0]==='accept'?['head','accountant'].includes(profile.role):editor());
 modal(`${kindNames[d.kind]} № ${d.number}`,`<p>${badge(stateNames[d.status],d.status==='accepted')} · ${e(projectName(d.project_id))}</p><div class="stats"><article><small>Версия ${v.version}</small><strong>${money(v.amount)} <small>руб.</small></strong></article></div><p>${e(v.note)}</p><p class="muted">Фиксация подписи в системе — запись о подтверждении, не электронная подпись.</p><div class="actions">${canNext?btn(next[1],'transition',next[0],true):''}${editable&&editor()?btn('Новая версия','revise',id):''}</div><h3>Файлы текущей версии</h3>${files.filter(f=>f.version_id===v.id).map(f=>`<p>${btn(f.name,'download',f.path)}</p>`).join('')||'<p class="muted">Файлы не прикреплены.</p>'}${editable&&editor()&&d.status==='draft'?`<label class="file">Прикрепить файл (до 20 МБ)<input id="upload" type="file"></label>`:''}<h3>История версий</h3>${data.versions.filter(x=>x.document_id===id).sort((a,b)=>b.version-a.version).map(x=>`<div class="version"><b>Версия ${x.version} · ${money(x.amount)} руб.</b> ${x.id===d.accepted_version?badge('Принята',true):''}<small>${e(fmtDate(x.created_at))}</small><p>${e(x.note)}</p>${files.filter(f=>f.version_id===x.id).map(f=>btn(f.name,'download',f.path)).join('')}</div>`).join('')}`);
 if($('#upload'))$('#upload').onchange=async ev=>{const file=ev.target.files[0];if(!file)return;if(file.size>20971520)return toast('Максимальный размер файла — 20 МБ');ev.target.disabled=true;try{
 const ext=file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g,'').slice(0,10);const path=`${d.project_id}/${d.id}/${v.id}/${crypto.randomUUID()}.${ext||'bin'}`;
 await query(client.storage.from('pto-documents').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'}));
 await mutate(periodPayload('attach',{document_id:id,path,name:file.name}));await docModal(id);
 }catch(err){toast(errorMessage(err));ev.target.disabled=false;}};
}
async function action(name,id){
 if(name==='dismiss')return dialog.close();
 if(name==='logout'){++loadId;data={};profile=null;await client.auth.signOut();session=null;return login();}
 if(name==='refresh')return load();
 if(name==='nav'){ui.route=id;return render();}
 if(name==='project'){ui.project=id;ui.route='project';return render();}
 if(name==='new-project')return form('Новый объект',field('name','Название')+field('address','Адрес','text','',false),async x=>{const r=await mutate({op:'create_project',...x});ui.project=r.project_id;ui.route='project';render();});
 if(name==='new-contract')return form('Новый договор',field('number','Номер договора')+field('party','Контрагент')+select('direction','Направление',[['outgoing','Предъявление заказчику'],['incoming','Входящий субподряд']]),x=>mutate({op:'create_contract',project_id:ui.project,...x}));
 if(name==='open-period')return mutate({op:'open_period',project_id:ui.project,month:ui.month+'-01'});
 if(name==='new-doc'){
 const contracts=data.contracts.filter(c=>c.project_id===ui.project);if(!contracts.length)return toast('Сначала добавьте договор.');
 return form('Новый документ',select('contract_id','Договор',contracts.map(c=>[c.id,c.number+' · '+c.party]))+select('kind','Форма',Object.entries(kindNames))+field('number','Номер')+field('amount','Контрольная сумма, руб.','number','0')+field('due_date','Срок','date','',false)+note('note','Содержание / основание'),x=>mutate(periodPayload('create_document',x)));
 }
 if(name==='doc')return docModal(id);
 if(name==='revise'){const d=data.documents.find(d=>d.id===id),v=ver(d);return form('Новая версия документа',field('amount','Контрольная сумма, руб.','number',v.amount)+note('note','Содержание / основание',v.note)+note('reason','Причина изменения'),x=>mutate(periodPayload('revise',{document_id:id,...x})));}
 if(name==='transition')return form(actionNames[id],field('person',id==='send'?'Кому передано':'Кто подтвердил')+(id==='send'?field('method','Способ передачи'):'')+note('proof','Подтверждение: номер письма, описи, скана'),x=>mutate(periodPayload(id,{document_id:ui.doc,...x})));
 if(name==='review')return mutate(periodPayload('review'));
 if(name==='close')return form('Закрыть отчётный период',`<p>Все документы будут заблокированы. Сохранится неизменяемый снимок выполнения. Повторно открыть период сможет администратор с указанием причины.</p>`,()=>mutate(periodPayload('close')));
 if(name==='reopen')return form('Повторное открытие',note('reason','Причина открытия'),x=>mutate(periodPayload('reopen',x)));
 if(name==='allocate'){
 const acts=docs().filter(d=>['c2a','c2b'].includes(d.kind)&&d.accepted_version),opts=direction=>acts.filter(d=>data.contracts.find(c=>c.id===d.contract_id)?.direction===direction).map(d=>[d.id,kindNames[d.kind]+' № '+d.number+' · '+data.contracts.find(c=>c.id===d.contract_id).party]);
 if(!opts('incoming').length||!opts('outgoing').length)return toast('Нужны принятые исходящий и входящий акты.');
 return form('Сопоставить субподряд',select('outgoing_document','Исходящий акт',opts('outgoing'))+select('incoming_document','Входящий акт субподрядчика',opts('incoming'))+field('amount','Сумма в ценах предъявления заказчику, руб.','number')+note('note','Основание сопоставления работ'),x=>mutate(periodPayload('allocate',x)));
 }
 if(name==='profile'){const p=data.profiles.find(p=>p.id===id);return form('Учётная запись',field('display_name','Имя', 'text',p.display_name)+select('role','Роль',Object.entries(roleNames).sort(([a])=>a===p.role?-1:1))+select('active','Состояние',p.active?[['true','Активен'],['false','Отключён']]:[['false','Отключён'],['true','Активен']]),x=>mutate({op:'profile',user_id:id,...x}));}
 if(name==='member'){if(!data.projects.length)return toast('Сначала создайте объект');return form('Доступ к объекту',select('project_id','Объект',data.projects.map(p=>[p.id,p.name]))+select('remove','Действие',[['false','Предоставить доступ'],['true','Снять доступ']]),x=>mutate({op:'member',user_id:id,...x}));}
 if(name==='download'){const r=await query(client.storage.from('pto-documents').createSignedUrl(id,60,{download:true}));const a=document.createElement('a');a.href=r.signedUrl;a.target='_blank';a.rel='noopener';a.click();return;}
 if(name==='print')return window.print();
 if(name==='export')return exportXlsx();
}
async function exportXlsx(){const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();book.creator='СУ-22 · ПТО';const sheet=book.addWorksheet('Реестр',{views:[{state:'frozen',xSplit:1,ySplit:2}]});const m=matrix();sheet.addRow(['Реестр выполнения · '+ui.month]);sheet.addRow(['Объект / договор','Всего, руб.','Своими силами','Субподряд',...m.subs]);for(const r of m.rows)sheet.addRow([r.object+' · '+r.number+' · Итого по договору',Number(r.total),r.own,Number(r.subcontract),...m.subs.map(s=>r.split[s])]);sheet.addRow(['Итого',...['total','own','subcontract'].map(k=>m.rows.reduce((s,r)=>s+Number(r[k]),0)),...m.subs.map(s=>m.rows.reduce((sum,r)=>sum+r.split[s],0))]);sheet.columns.forEach((c,i)=>{c.width=i?22:58;if(i)c.numFmt='#,##0.00';});[1,2,sheet.rowCount].forEach(n=>{sheet.getRow(n).font={bold:true};});sheet.autoFilter={from:{row:2,column:1},to:{row:2,column:4+m.subs.length}};const buffer=await book.xlsx.writeBuffer();const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));link.download=`Реестр_ПТО_${ui.month}.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),10000);}
function login(){app.innerHTML=`<section class="login"><div class="mark">22</div><div class="eyebrow">СУ-22 · единая система ПТО</div><h1>${ui.recovery?'Новый пароль':'Вход в рабочее пространство'}</h1><p class="muted">Объекты, документы и выполнение за месяц.</p><form id="login-form">${ui.recovery?'':field('email','Электронная почта','email')}${field('password','Пароль','password')}<p class="error" id="login-error" role="alert"></p><button class="primary">${ui.recovery?'Сохранить пароль':'Войти'}</button></form><p class="muted">Доступ выдаёт администратор системы.</p></section>`;$('#login-form').onsubmit=async ev=>{ev.preventDefault();const button=ev.submitter;button.disabled=true;try{const f=Object.fromEntries(new FormData(ev.target));if(ui.recovery){await query(client.auth.updateUser({password:f.password}));ui.recovery=false;toast('Пароль сохранён');await load();}else{const result=await query(client.auth.signInWithPassword(f));session=result.session;await load();}}catch(err){$('#login-error')&&($('#login-error').textContent=errorMessage(err));}finally{button.disabled=false;}};}
document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-action]');if(!b||b.disabled||ui.busy)return;ui.busy=true;try{await action(b.dataset.action,b.dataset.id);}catch(err){toast(errorMessage(err));}finally{ui.busy=false;}});
document.addEventListener('change',async ev=>{if(ev.target.id==='month'&&ev.target.value){const previous=ui.month;ui.month=ev.target.value;try{await load();}catch(err){ui.month=previous;ev.target.value=previous;toast(errorMessage(err));}}});
if(!url||!key||!key.startsWith('sb_publishable_'))app.innerHTML=`<section class="login"><div class="mark">22</div><h1>Подключение ещё не настроено</h1><p>Для запуска администратор должен подключить базу системы ПТО и опубликовать сборку.</p></section>`;
else{
 client=createClient(url,key);
 client.auth.onAuthStateChange((event,s)=>{session=s;if(event==='PASSWORD_RECOVERY'){ui.recovery=true;setTimeout(login,0);}else if(event==='SIGNED_OUT'){++loadId;data={};profile=null;setTimeout(login,0);}else if(event==='INITIAL_SESSION'){setTimeout(()=>load().catch(err=>{app.innerHTML=`<section class="login"><h1>Не удалось загрузить систему</h1><p>${e(errorMessage(err))}</p>${btn('Повторить','refresh')}${btn('Выйти','logout')}</section>`;}),0);}});
}
