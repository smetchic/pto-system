import {renderWorkspace} from './views.js';
import {createClient} from '@supabase/supabase-js';
import {escapeHtml as e,money,isDone,canActOn,canWrite,kindNames,roleNames,actionNames,emptyMatrix,registerSheetRows,ourRoleNames,addendumStateNames} from './domain.js';
import {partyCard,contactCard,contactPayload,partyPayload,parseMnsXml,mnsPreview,mnsPreviewHtml} from './parties.js';
import './style.css';
import './parties.css';
import './conveyor.css';
const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#dialog');
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const monthNow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit'}).format(new Date());
const ui={route:'today',month:monthNow,project:null,doc:null,busy:false,recovery:false,wide:false,more:false,portfolioView:'tiles',projectTab:'summary',flowProject:'',flowKind:'',theme:'system',textScale:100};
try{ui.wide=localStorage.getItem('pto-wide')==='true';ui.theme=localStorage.getItem('pto-theme')||'system';ui.textScale=Number(localStorage.getItem('pto-text-scale'))||100;}catch{}
function applyTheme(){if(ui.theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=ui.theme;}
// Размер текста масштабирует всю страницу, как Ctrl +; --zoom возвращает высоту окна и боковых карточек к размеру экрана.
const textScales=[100,115,130];
function applyTextScale(){const root=document.documentElement.style;if(!textScales.includes(ui.textScale))ui.textScale=100;if(ui.textScale===100){root.removeProperty('zoom');root.removeProperty('--zoom');}else{const z=String(ui.textScale/100);root.setProperty('zoom',z);root.setProperty('--zoom',z);}}
applyTheme();applyTextScale();
let client,session,profile,data={},loadId=0;
const btn=(text,action,id='',primary=false)=>`<button ${primary?'class="primary"':''} data-action="${action}" data-id="${e(id)}">${e(text)}</button>`;
const badge=(text,good=false)=>`<span class="badge ${good?'good':''}">${e(text)}</span>`;
const empty=text=>`<div class="empty">${e(text)}</div>`;
const field=(name,label,type='text',value='',required=true)=>`<label>${e(label)}<input name="${name}" type="${type}" value="${e(value)}" ${required?'required':''} ${type==='number'?'step="0.01" min="0"':''}></label>`;
const select=(name,label,options)=>`<label>${e(label)}<select name="${name}" required>${options.map(([id,title])=>`<option value="${e(id)}">${e(title)}</option>`).join('')}</select></label>`;
const note=(name,label,value='')=>`<label>${e(label)}<textarea name="${name}" required>${e(value)}</textarea></label>`;
const fmtDate=x=>x?new Date(x).toLocaleString('ru-RU',{timeZone:'Europe/Minsk'}):'';
const currentPeriod=()=>data.periods?.find(p=>p.project_id===ui.project);
const editor=(pid=ui.project)=>canWrite(profile,data.memberships,pid);
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
 if(profile?.theme&&profile.theme!==ui.theme){ui.theme=profile.theme;try{localStorage.setItem('pto-theme',ui.theme);}catch{}applyTheme();}
 if(profile?.text_scale&&profile.text_scale!==ui.textScale){ui.textScale=profile.text_scale;try{localStorage.setItem('pto-text-scale',String(ui.textScale));}catch{}applyTextScale();}
 if(!profile?.active){app.innerHTML=`<section class="login"><div class="mark">П</div><h1>Доступ ещё не назначен</h1><p>Начальник ПТО должен активировать вашу учётную запись и назначить объекты.</p><p class="muted">${e(session.user.email)}</p>${btn('Проверить доступ','refresh')}${btn('Выйти','logout')}</section>`;return;}
 const [projects,contracts,periods,profiles,memberships,templates,steps,parties,partyRoles,participants,partyContacts]=await Promise.all([all('pto_projects'),all('pto_contract_list'),all('pto_periods',q=>q.eq('month',ui.month+'-01')),all('pto_profiles'),query(client.from('pto_memberships').select('*')),query(client.from('pto_workflow_templates').select('*')),query(client.from('pto_workflow_steps').select('*')),query(client.from('pto_counterparties').select('*').order('short_name')),query(client.from('pto_counterparty_roles').select('counterparty_id,role')),query(client.from('pto_project_participants').select('*')),query(client.from('pto_counterparty_contacts').select('*').order('created_at'))]);
 if(generation!==loadId)return;
 const ids=periods.map(p=>p.id);
 // Состояние документа и задачи — из комплектов маршрутов (pto_document_list, pto_workflow_list).
 const [documents,allocations,register,matrix,workflows]=ids.length?await Promise.all([all('pto_document_list',q=>q.in('period_id',ids)),all('pto_allocations',q=>q.in('period_id',ids)),query(client.from('pto_register').select('*').eq('month',ui.month+'-01')),query(client.rpc('pto_register_matrix',{p_month:ui.month+'-01'})),all('pto_workflow_list',q=>q.in('period_id',ids))]):[[],[],[],emptyMatrix,[]];
 // Прошлый месяц — только для сравнения в портфеле (▲/▼ %).
 const prevMatrix=await query(client.rpc('pto_register_matrix',{p_month:prevMonth(ui.month)+'-01'})).catch(()=>emptyMatrix);
 const dids=documents.map(d=>d.id);
 const versions=dids.length?await all('pto_versions',q=>q.in('document_id',dids)):[];
 const events=await query(client.from('pto_events').select('*').order('id',{ascending:false}).limit(150));
 if(generation!==loadId)return;
 data={prevMatrix,projects,contracts,periods,profiles,memberships,documents,allocations,register,matrix,versions,events,workflows,templates,steps,parties,partyRoles,participants,partyContacts};
 if(ui.project&&!projects.some(p=>p.id===ui.project))ui.project=null;
 render();
}
function prevMonth(month){const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-2,1));return d.toISOString().slice(0,7);}
function render(){app.innerHTML=renderWorkspace({ui,data,profile});}
function modal(title,html,drawer=false){delete dialog.dataset.dirty;dialog.classList.remove('proc-drawer','cp-drawer');dialog.classList.toggle('document-drawer',drawer);dialog.innerHTML=`<div class="row"><h2>${e(title)}</h2>${btn('Закрыть','dismiss')}</div>${html}`;if(!dialog.open)dialog.showModal();}
function form(title,fields,submit){modal(title,`<form id="modal-form">${fields}<p id="form-error" class="error" role="alert"></p><div class="actions"><button class="primary" type="submit">Сохранить</button></div></form>`);$('#modal-form').onsubmit=async ev=>{ev.preventDefault();const button=ev.submitter;button.disabled=true;try{await submit(Object.fromEntries(new FormData(ev.target)));dialog.close();}catch(err){$('#form-error').textContent=errorMessage(err);}finally{button.disabled=false;}};}
async function mutate(payload){const result=await query(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload}));await load();toast('Сохранено');return result;}
function periodPayload(op,extra={}){const p=currentPeriod();if(!p)throw Error('Откройте месяц');return {op,period_id:p.id,expected_revision:p.revision,...extra};}
async function docModal(id){
 const d=data.documents.find(x=>x.id===id);if(!d)throw Error('Документ не найден');ui.doc=id;ui.project=d.project_id;
 const files=await all('pto_files',q=>q.in('version_id',data.versions.filter(v=>v.document_id===id).map(v=>v.id)));
 const v=ver(d),p=currentPeriod();
 const report=d.kind==='c3a'?(await query(client.from('pto_c3a_report').select('*').eq('version_id',v.id)))[0]:null;
 const amountBlock=d.kind==='c29'?`<p class="muted">Версия ${v.version} · материальный отчёт, денежной суммы нет.</p>`:d.kind==='c3a'?`<p class="muted">Версия ${v.version}</p>${c3aTable(report)}`:`<div class="stats"><article><small>Версия ${v.version}</small><strong>${money(v.amount)} <small>руб.</small></strong></article></div>`;
 // Документ не переходит сам по себе: передача, подпись и принятие — шаги его комплекта.
 const editable=p?.status==='open',done=isDone(d);
 modal(`${kindNames[d.kind]} № ${d.number}`,`<p>${badge(d.step_label||'Без комплекта',done)} · ${e(projectName(d.project_id))}</p>${amountBlock}<p>${e(v.note)}</p><div class="actions">${d.workflow_id?btn('Открыть комплект','workflow',d.workflow_id,true):''}${editable&&editor(d.project_id)?btn('Новая версия','revise',id):''}</div>${editable&&editor(d.project_id)&&done?'<p class="muted">Комплект принят бухгалтерией. Новая версия вернёт его на первый шаг; принятая сумма сохранится до повторного принятия.</p>':''}<h3>Файлы текущей версии</h3>${files.filter(f=>f.version_id===v.id).map(f=>`<p>${btn(f.name,'download',f.path)}</p>`).join('')||'<p class="muted">Файлы не прикреплены.</p>'}${editable&&editor(d.project_id)&&!done?`<label class="file">Прикрепить файл (до 20 МБ)<input id="upload" type="file"></label>`:''}<h3>История версий</h3>${data.versions.filter(x=>x.document_id===id).sort((a,b)=>b.version-a.version).map(x=>`<div class="version"><b>Версия ${x.version} · ${money(x.amount)} руб.</b> ${x.id===d.accepted_version?badge('Принята',true):''}<small>${e(fmtDate(x.created_at))}</small><p>${e(x.note)}</p>${files.filter(f=>f.version_id===x.id).map(f=>btn(f.name,'download',f.path)).join('')}</div>`).join('')}`,true);
 if($('#upload'))$('#upload').onchange=async ev=>{const file=ev.target.files[0];if(!file)return;if(file.size>20971520)return toast('Максимальный размер файла — 20 МБ');ev.target.disabled=true;try{
 const ext=file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g,'').slice(0,10);const path=`${d.project_id}/${d.id}/${v.id}/${crypto.randomUUID()}.${ext||'bin'}`;
 await query(client.storage.from('pto-documents').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'}));
 await mutate(periodPayload('attach',{document_id:id,path,name:file.name}));await docModal(id);
 }catch(err){toast(errorMessage(err));ev.target.disabled=false;}};
}
// Карточка контрагента — панель справа. Справочник общий: правят начальник ПТО и инженеры, руководитель только смотрит.
function partyModal(id,editing=false){
 const party=id?data.parties.find(c=>c.id===id):null;if(id&&!party)throw Error('Контрагент не найден');
 const canEdit=['head','engineer'].includes(profile?.role);
 delete dialog.dataset.dirty;dialog.className='cp-drawer';dialog.innerHTML=partyCard({data,party,canEdit,editing});if(!dialog.open)dialog.showModal();
 const form=$('#party-form');if(!canEdit||(party&&!editing))return;
 form.onsubmit=async ev=>{ev.preventDefault();const button=ev.submitter;button.disabled=true;
  try{await mutate(partyPayload(new FormData(form),party));if(party)partyModal(party.id);else dialog.close();}
  catch(err){$('#party-error').textContent=/duplicate key|pto_counterparties_unp_key/i.test(err?.message||'')?'Контрагент с таким УНП уже существует.':errorMessage(err);}
  finally{button.disabled=false;}};
}
// Контактное лицо контрагента: форма в той же боковой панели, после сохранения — обратно в карточку.
function contactModal(partyId,contactId=null){
 const party=data.parties.find(c=>c.id===partyId),contact=contactId?(data.partyContacts||[]).find(x=>x.id===contactId):null;
 if(!party||(contactId&&!contact))throw Error('Контакт не найден');
 delete dialog.dataset.dirty;dialog.className='cp-drawer';dialog.innerHTML=contactCard({data,party,contact});if(!dialog.open)dialog.showModal();
 const form=$('#contact-form');form.onsubmit=async ev=>{ev.preventDefault();const button=ev.submitter;button.disabled=true;
  try{await mutate(contactPayload(new FormData(form)));partyModal(party.id);}catch(err){$('#party-error').textContent=errorMessage(err);}finally{button.disabled=false;}};
}
// Копирование в буфер; подтверждение — рядом с нажатой кнопкой (тост не виден поверх открытой панели).
async function copyText(text){const b=document.activeElement;try{await navigator.clipboard.writeText(text);}catch{const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';(dialog.open?dialog:document.body).append(t);t.select();document.execCommand('copy');t.remove();}
 if(b?.dataset?.action==='copy'){b.classList.add('copied');setTimeout(()=>b.classList.remove('copied'),1500);}else toast('Скопировано');}
// Импорт выписок МНС: файлы разбираются в браузере, перед сохранением показываются изменения по каждому УНП.
async function readXml(file){const bytes=await file.arrayBuffer(),head=new TextDecoder('ascii').decode(bytes.slice(0,200)),enc=/encoding=["']([\w-]+)["']/i.exec(head)?.[1]||'utf-8';return new TextDecoder(enc).decode(bytes);}
async function importMns(files){
 const rows=[];for(const f of files){try{rows.push(...parseMnsXml(await readXml(f)));}catch(err){throw Error(`${f.name}: ${err.message}`);}}
 const preview=mnsPreview(data,rows),todo=preview.filter(p=>p.status!=='same');
 modal('Загрузка сведений МНС',mnsPreviewHtml(preview)+`<p id="form-error" class="error" role="alert"></p><div class="actions">${todo.length?btn(`Сохранить (${todo.length})`,'mns-apply','',true):'<span class="muted">Изменений нет.</span>'}</div>`);
 ui.mnsRows=preview.map(p=>p.row);
}
// Справка С-3а: СМР с НДС = сумма актов комплекта (считает база); вводятся только выделенный НДС, оборудование и зачёт авансов.
const c3aHint='<p class="muted">СМР с НДС за период не вводится: это сумма актов С-2 договора за месяц (текущие версии). После изменения акта создайте новую версию справки. «К оплате» и накопительные колонки считаются автоматически.</p>';
// Комплект: шаги маршрута из базы, состав, история; переход и возврат — одной командой.
const wfOf=id=>data.workflows.find(w=>w.id===id);
const stepsOf=w=>data.steps.filter(s=>s.template_code===w.template_code).sort((a,b)=>a.ordinal-b.ordinal);
const periodOf=w=>data.periods.find(p=>p.id===w.period_id);
const canMove=w=>canActOn(w,profile.role)&&editor(w.project_id)&&periodOf(w)?.status==='open';
async function workflowModal(id){
 const w=wfOf(id);if(!w)throw Error('Комплект не найден');
 const events=(await all('pto_workflow_events',q=>q.eq('workflow_id',id))).sort((a,b)=>b.id-a.id),steps=stepsOf(w),next=steps.find(s=>s.ordinal===w.step_ordinal+1);
 const kit=data.documents.filter(d=>d.workflow_id===id),label=code=>steps.find(s=>s.code===code)?.label||code||'';
 const who=a=>data.profiles.find(p=>p.id===a)?.display_name||'';
 delete dialog.dataset.dirty;dialog.className='proc-drawer';
 dialog.innerHTML=`<div class="proc-drawer-body"><button class="proc-drawer-close" data-action="dismiss">Закрыть ×</button>
  <div class="proc-drawer-title">${e(w.template_name)}</div><div class="proc-drawer-sub">${e(w.project)} · договор № ${e(w.contract_number)} · ${e(w.party||'')}${w.money?` · ${money(w.acts_amount)} руб.`:''}</div>
  <div class="proc-timeline">${steps.map(s=>`<div class="proc-step ${s.ordinal<w.step_ordinal?'done':s.code===w.step_code?'current':''}"><span class="proc-step-dot"></span><div>${e(s.label)}${s.code===w.step_code&&s.actor!=='none'?`<small>${s.actor==='accounting'?'у бухгалтерии · отмечает ПТО':'действует ПТО'}</small>`:''}</div></div>`).join('')}</div>
  ${next&&canMove(w)?`<button class="proc-primary-action" data-action="wf-advance" data-id="${e(id)}">→ ${e(next.label)}</button>`:''}
  ${w.hint?`<section class="proc-help"><h3>Что делать на этом шаге</h3><p>${e(w.hint)}</p></section>`:''}
  <div class="proc-history-title">Состав комплекта</div><div class="wf-docs">${kit.map(d=>`<button class="link" data-action="doc" data-id="${e(d.id)}">${e(kindNames[d.kind])} № ${e(d.number)}${d.id===w.attention_document_id?' <span class="wf-attention">· замечание</span>':''}</button>`).join('')||'<span class="muted">Документов нет.</span>'}</div>
  ${w.step_ordinal>1&&canMove(w)?`<section class="proc-return">${btn('Вернуть на исправление','wf-return',id)}</section>`:''}
  <div class="proc-history-title">История</div><div class="proc-history">${events.map(x=>`<div class="proc-event"><b>${x.kind==='created'?'Создан':x.kind==='reset'?'Возврат на первый шаг':x.kind==='return'?'Возврат':'Переход'}: ${e(x.from_step?label(x.from_step)+' → ':'')}${e(label(x.to_step))}</b><small>${e(fmtDate(x.created_at))}${x.actor?` · ${e(who(x.actor))}`:''}${x.person?` · ${e(x.person)}`:''}${x.method?` · ${e(x.method)}`:''}</small>${x.proof?`<small>Подтверждение: ${e(x.proof)}</small>`:''}${x.note?`<small>${e(x.note)}</small>`:''}</div>`).join('')}</div></div>`;
 if(!dialog.open)dialog.showModal();
}
function workflowAdvance(id){
 const w=wfOf(id),next=stepsOf(w).find(s=>s.ordinal===w.step_ordinal+1),req=next?.requires||[];
 if(!next)return toast('Маршрут завершён');
 const personLabel={accounting:'Кому в бухгалтерии передан оригинал',accepted:'Кто в бухгалтерии принял'}[next.code]||'Кому передан комплект';
 const proofLabel=next.code==='accepted'?'Подтверждение принятия: отметка на описи, номер реестра':'Подтверждение: номер письма, описи, отметка о подписи';
 const fields=(req.includes('person')?field('person',personLabel):'')+(req.includes('method')?field('method','Способ передачи'):'')
  +(req.includes('proof')?note('proof',proofLabel):'')+note('note','Комментарий').replace(' required','');
 const warn=req.includes('accept')?'<p>Все документы комплекта будут приняты одновременно; принятые версии зафиксируются.</p>':req.includes('files')?'<p class="muted">У каждого документа комплекта должен быть файл текущей версии.</p>':'';
 dialogReset();return form(`→ ${next.label}`,warn+fields,x=>mutate({op:'workflow_advance',workflow_id:id,expected_revision:periodOf(w)?.revision,...x}));
}
function workflowReturn(id){
 const w=wfOf(id),earlier=stepsOf(w).filter(s=>s.ordinal<w.step_ordinal).reverse(),kit=data.documents.filter(d=>d.workflow_id===id);
 dialogReset();return form('Вернуть комплект на исправление',select('to_step','Вернуть на шаг',earlier.map(s=>[s.code,s.label]))
  +`<label>Документ с замечанием<select name="document_id"><option value="">Весь комплект</option>${kit.map(d=>`<option value="${e(d.id)}">${e(kindNames[d.kind])} № ${e(d.number)}</option>`).join('')}</select></label>`
  +note('note','Причина возврата'),x=>mutate({op:'workflow_return',workflow_id:id,expected_revision:periodOf(w)?.revision,...x}));
}
function dialogReset(){dialog.className='';}
const c3aFields=(v={})=>[['smr_vat','в т.ч. НДС в СМР, руб.'],['equipment_amount','Оборудование с НДС, руб.'],['equipment_vat','в т.ч. НДС на оборудование, руб.'],['advance_target_offset','Зачёт целевого аванса, руб.'],['advance_current_offset','Зачёт текущего аванса, руб.']].map(([k,label])=>field(k,label,'number',v[k]??'',false)).join('');
const c3aRows=[['smr','СМР с НДС'],['smr_vat','в т.ч. НДС'],['equipment','Оборудование с НДС'],['equipment_vat','в т.ч. НДС'],['target_offset','Зачёт целевого аванса'],['current_offset','Зачёт текущего аванса'],['to_pay','К оплате']];
function c3aTable(r){if(!r)return '';const cell=(prefix,k)=>money(r[(prefix?prefix+'_':'')+k]);return `<div class="table-wrap"><table><thead><tr><th>Справка С-3а</th><th class="num">С начала работ</th><th class="num">С начала года</th><th class="num">За период</th></tr></thead><tbody>${c3aRows.map(([k,label])=>`<tr class="${k==='to_pay'?'total':''}"><td>${e(label)}</td><td class="num">${cell('total',k)}</td><td class="num">${cell('ytd',k)}</td><td class="num">${cell('',k)}</td></tr>`).join('')}</tbody></table></div><p class="muted">К оплате = СМР + оборудование − зачёт авансов. Накопление — по принятым справкам предыдущих месяцев.</p>`;}
// Карточка договора: введённые условия и вычисленные базой текущая стоимость и срок (pto_contract_list).
const day=x=>x?new Date(x+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'Europe/Minsk'}):'—';
const sum=x=>x===null||x===undefined||x===''?'—':money(x)+' руб.';
async function contractModal(id){
 const c=data.contracts.find(x=>x.id===id);if(!c)throw Error('Договор не найден');
 const addenda=(await all('pto_contract_addenda',q=>q.eq('contract_id',id))).sort((a,b)=>String(b.agreement_date).localeCompare(String(a.agreement_date))||String(b.created_at).localeCompare(String(a.created_at)));
 const parent=data.contracts.find(x=>x.id===c.parent_contract_id),edit=editor(c.project_id);
 const terms=[['Договорная цена',c.initial_amount],['НДС',c.vat_amount],['СМР',c.smr_amount],['НДС СМР',c.smr_vat_amount],['ПНР',c.pnr_amount],['НДС ПНР',c.pnr_vat_amount],['Оборудование',c.equipment_amount],['НДС оборудования',c.equipment_vat_amount]].filter(([,v])=>v!==null&&v!==undefined);
 const addendumActions=a=>!edit?'':a.status==='draft'?btn('Подписано','sign-addendum',a.id)+btn('Отменить','cancel-addendum',a.id):a.status==='signed'?btn('Отменить','cancel-addendum',a.id):'';
 modal(`Договор № ${c.number}`,`<p>${badge(c.direction==='incoming'?'Входящий':'Исходящий')} · ${e(c.party)} · наша роль: ${e(ourRoleNames[c.our_role]||c.our_role)}</p>
  <p class="muted">${c.contract_date?'от '+e(day(c.contract_date)):''}${parent?` · к договору № ${e(parent.number)}`:''}${c.subject?`<br>${e(c.subject)}`:''}</p>
  <div class="stats"><article><small>Текущая стоимость</small><strong>${sum(c.current_amount)}</strong><small>${c.amount_addendum_number?`по ДС № ${e(c.amount_addendum_number)} от ${e(day(c.amount_addendum_date))}`:'по договору'}</small></article>
  <article><small>Срок выполнения</small><strong>${e(day(c.work_start_date))} — ${e(day(c.current_end_date))}</strong><small>${c.term_addendum_number?`по ДС № ${e(c.term_addendum_number)}`:'по договору'}</small></article></div>
  <div class="actions">${edit?btn('Изменить условия','edit-contract',id,true)+btn('Добавить допсоглашение','new-addendum',id):''}</div>
  <h3>Условия договора</h3>${terms.length?`<table>${terms.map(([label,v])=>`<tr><td>${e(label)}</td><td class="num">${sum(v)}</td></tr>`).join('')}</table>`:'<p class="muted">Суммы договора не заполнены.</p>'}
  <h3>Допсоглашения</h3>${addenda.length?addenda.map(a=>`<div class="version"><b>ДС № ${e(a.number)} от ${e(day(a.agreement_date))}</b> ${badge(addendumStateNames[a.status]||a.status,a.status==='signed')}<small>${a.amount_after!==null?'Цена: '+sum(a.amount_after):''}${a.amount_after!==null&&a.work_end_date?' · ':''}${a.work_end_date?'Срок: до '+e(day(a.work_end_date)):''}</small><p>${e(a.note)}</p><div class="actions">${addendumActions(a)}</div></div>`).join(''):'<p class="muted">Допсоглашений нет.</p>'}
  <p class="muted">Текущие стоимость и срок считаются по последнему подписанному допсоглашению. Проекты и отменённые допсоглашения не учитываются.</p>`,true);
}
function editContract(id){
 const c=data.contracts.find(x=>x.id===id),v=k=>c[k]??'';
 const parents=data.contracts.filter(x=>x.project_id===c.project_id&&x.id!==c.id&&x.direction==='outgoing');
 const amount=(k,label)=>field(k,label,'number',v(k),false);
 form(`Условия договора № ${c.number}`,field('number','Номер договора','text',c.number)+field('contract_date','Дата договора','date',v('contract_date'),false)+note('subject','Предмет договора',v('subject')).replace(' required','')
  +`<label>Основной договор<select name="parent_contract_id"><option value="">—</option>${parents.map(p=>`<option value="${e(p.id)}" ${p.id===c.parent_contract_id?'selected':''}>${e(p.number+' · '+p.party)}</option>`).join('')}</select></label>`
  +amount('initial_amount','Договорная цена, руб.')+field('vat_rate','Ставка НДС, %','number',v('vat_rate'),false)+amount('vat_amount','НДС, руб.')
  +amount('smr_amount','СМР, руб.')+amount('smr_vat_amount','НДС СМР, руб.')+amount('pnr_amount','ПНР, руб.')+amount('pnr_vat_amount','НДС ПНР, руб.')
  +amount('equipment_amount','Оборудование, руб.')+amount('equipment_vat_amount','НДС оборудования, руб.')
  +field('work_start_date','Начало работ','date',v('work_start_date'),false)+field('work_end_date','Окончание работ по договору','date',v('work_end_date'),false),
  x=>mutate({op:'update_contract',contract_id:id,...x}));
}
function newAddendum(id){
 const c=data.contracts.find(x=>x.id===id);
 form(`Допсоглашение к договору № ${c.number}`,field('number','Номер ДС')+field('agreement_date','Дата ДС','date')
  +select('status','Состояние',[['draft','Проект (не учитывается)'],['signed','Подписано']])
  +field('amount_after','Цена договора после ДС, руб.','number','',false)+field('vat_rate','Ставка НДС, %','number','',false)+field('vat_amount','НДС, руб.','number','',false)
  +field('work_end_date','Новый срок окончания','date','',false)+note('note','Содержание изменений').replace(' required',''),
  x=>mutate({op:'create_addendum',contract_id:id,...x}));
}
async function action(name,id){
 if(name==='dismiss')return dialog.close();
 if(name==='logout'){++loadId;data={};profile=null;await client.auth.signOut();session=null;return login();}
 if(name==='refresh')return load();
 if(name==='nav'){ui.route=id;ui.more=false;return render();}
 if(name==='more'){ui.more=!ui.more;return render();}
 if(name==='wide'){ui.wide=!ui.wide;try{localStorage.setItem('pto-wide',String(ui.wide));}catch{}return render();}
 if(name==='portfolio-view'){ui.portfolioView=id;return render();}
 if(name==='project-tab'){ui.projectTab=id;return render();}
 if(name==='flow-filter'){ui.flowProject=id;return render();}
 if(name==='flow-kind'){ui.flowKind=id;return render();}
 // Тема хранится в профиле; в браузере — только копия для первой отрисовки до загрузки профиля.
 if(name==='text-scale'){const scale=Number(id);if(!textScales.includes(scale))return;ui.textScale=scale;try{localStorage.setItem('pto-text-scale',id);}catch{}applyTextScale();render();await query(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload:{op:'set_text_scale',text_scale:scale}}));profile.text_scale=scale;return toast('Размер текста сохранён в профиле');}
 if(name==='theme'){if(!['light','dark','system'].includes(id))return;ui.theme=id;try{localStorage.setItem('pto-theme',id);}catch{}applyTheme();render();await query(client.rpc('pto_command',{request_id:crypto.randomUUID(),payload:{op:'set_theme',theme:id}}));profile.theme=id;return toast('Тема сохранена в профиле');}
 if(name==='project'){ui.project=id;ui.route='project';ui.projectTab='summary';ui.more=false;return render();}
 if(name==='new-project')return form('Новый объект',field('name','Короткое название')+field('full_name','Полное наименование объекта')+field('address','Адрес','text','',false),async x=>{const r=await mutate({op:'create_project',...x});ui.project=r.project_id;ui.route='project';render();});
 if(name==='new-contract')return form('Новый договор',field('number','Номер договора')+field('party','Контрагент')+select('direction','Направление',[['outgoing','Предъявление заказчику'],['incoming','Входящий субподряд']]),x=>mutate({op:'create_contract',project_id:ui.project,...x}));
 if(name==='open-period')return mutate({op:'open_period',project_id:ui.project,month:ui.month+'-01'});
 if(['new-doc','new-c3a','new-c29'].includes(name)){
 const outgoingOnly=name!=='new-doc',contracts=data.contracts.filter(c=>c.project_id===ui.project&&(!outgoingOnly||c.direction==='outgoing'));if(!contracts.length)return toast(outgoingOnly?'Сначала добавьте договор с заказчиком.':'Сначала добавьте договор.');
 const head=select('contract_id','Договор',contracts.map(c=>[c.id,c.number+' · '+c.party]));
 if(name==='new-c3a')return form('Справка С-3а',head+field('number','Номер')+c3aHint+c3aFields()+field('due_date','Срок','date','',false)+note('note','Содержание / основание').replace(' required',''),x=>mutate(periodPayload('create_document',{...x,kind:'c3a'})));
 if(name==='new-c29')return form('Отчёт С-29',head+field('number','Номер')+field('due_date','Срок','date','',false)+note('note','Содержание / основание').replace(' required',''),x=>mutate(periodPayload('create_document',{...x,kind:'c29'})));
 return form('Новый акт',head+select('kind','Форма',[['c2a','С-2а'],['c2b','С-2б']])+field('number','Номер')+field('amount','Сумма акта с НДС, руб.','number','0')+field('due_date','Срок','date','',false)+note('note','Содержание / основание'),x=>mutate(periodPayload('create_document',x)));
 }
 if(name==='estimate'){
 const contracts=data.contracts.filter(c=>c.project_id===ui.project&&c.direction==='outgoing');if(!contracts.length)return toast('Сначала добавьте договор с заказчиком.');
 return form('Оперативная оценка выполнения',`<p class="muted">Предварительная сумма до подписания актов. Хранится отдельно от принятых сумм и показывается в реестре с пометкой «предварительно». Новая оценка заменяет прежнюю, история сохраняется.</p>`+select('contract_id','Договор',contracts.map(c=>[c.id,c.number+' · '+c.party]))+field('amount','Оценка выполнения за месяц с НДС, руб.','number')+note('note','Основание').replace(' required',''),x=>{const p=currentPeriod();if(!p)throw Error('Откройте месяц');return mutate({op:'set_estimate',period_id:p.id,...x});});
 }
 if(name==='mns-apply'){const r=await mutate({op:'import_counterparties',checked_at:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Minsk'}),rows:ui.mnsRows||[]});ui.mnsRows=null;dialog.close();return toast(`Сведения МНС загружены: новых ${r.created}, обновлено ${r.updated}, без изменений ${r.unchanged}.`);}
 if(name==='mns-xml')return $('#mns-xml')?.click();
 if(name==='party'||name==='new-party')return partyModal(name==='party'?id:null);
 if(name==='party-edit')return partyModal(id,true);
 if(name==='copy')return copyText(id);
 if(name==='party-contact-new')return contactModal(id);
 if(name==='party-contact'){const x=(data.partyContacts||[]).find(k=>k.id===id);return contactModal(x?.counterparty_id,id);}
 if(name==='party-contact-delete'){const x=(data.partyContacts||[]).find(k=>k.id===id);if(!x||!confirm(`Удалить контакт «${x.name}»?`))return;await mutate({op:'delete_counterparty_contact',contact_id:id});return partyModal(x.counterparty_id);}
 if(name==='doc')return docModal(id);
 if(name==='contract')return contractModal(id);
 if(name==='edit-contract')return editContract(id);
 if(name==='new-addendum')return newAddendum(id);
 if(name==='sign-addendum')return form('Допсоглашение подписано',`<p>После подписания цена и срок договора пересчитываются автоматически.</p>`,()=>mutate({op:'set_addendum_status',addendum_id:id,status:'signed'}));
 if(name==='cancel-addendum')return form('Отменить допсоглашение',note('reason','Причина отмены'),x=>mutate({op:'set_addendum_status',addendum_id:id,status:'cancelled',...x}));
 if(name==='revise'){const d=data.documents.find(d=>d.id===id),v=ver(d);
 const body=d.kind==='c3a'?c3aHint+c3aFields(v):d.kind==='c29'?'':field('amount','Сумма акта с НДС, руб.','number',v.amount);
 return form('Новая версия документа',body+note('note','Содержание / основание',v.note).replace(' required','')+note('reason','Причина изменения'),x=>mutate(periodPayload('revise',{document_id:id,...x})));}
 if(name==='workflow')return workflowModal(id);
 if(name==='wf-advance')return workflowAdvance(id);
 if(name==='wf-return')return workflowReturn(id);
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
async function exportXlsx(){const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();book.creator='СУ-22 · ПТО';const sheet=book.addWorksheet('Реестр',{views:[{state:'frozen',xSplit:1,ySplit:2}]});const lines=registerSheetRows(data.matrix,ui.month);for(const line of lines){const row=sheet.addRow(line.values);if(line.bold)row.font={bold:true};}const width=lines[1].values.length;sheet.columns.forEach((c,i)=>{c.width=i?22:58;if(i)c.numFmt='#,##0.00;[Red]-#,##0.00';});sheet.autoFilter={from:{row:2,column:1},to:{row:2,column:width}};const buffer=await book.xlsx.writeBuffer();const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));link.download=`Реестр_ПТО_${ui.month}.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),10000);}
function login(){app.innerHTML=`<section class="login"><div class="mark">П</div><div class="eyebrow">СУ-22 · единая система ПТО</div><h1>${ui.recovery?'Новый пароль':'Вход в рабочее пространство'}</h1><p class="muted">Объекты, документы и выполнение за месяц.</p><form id="login-form">${ui.recovery?'':field('email','Электронная почта','email')}${field('password','Пароль','password')}<p class="error" id="login-error" role="alert"></p><button class="primary">${ui.recovery?'Сохранить пароль':'Войти'}</button></form><p class="muted">Доступ выдаёт администратор системы.</p></section>`;$('#login-form').onsubmit=async ev=>{ev.preventDefault();const button=ev.submitter;button.disabled=true;try{const f=Object.fromEntries(new FormData(ev.target));if(ui.recovery){await query(client.auth.updateUser({password:f.password}));ui.recovery=false;toast('Пароль сохранён');await load();}else{const result=await query(client.auth.signInWithPassword(f));session=result.session;await load();}}catch(err){$('#login-error')&&($('#login-error').textContent=errorMessage(err));}finally{button.disabled=false;}};}
// Поиск по справочнику контрагентов: строки скрываются на месте, без перерисовки страницы.
document.addEventListener('change',async ev=>{if(ev.target.id!=='mns-xml'||!ev.target.files.length)return;try{await importMns([...ev.target.files]);}catch(err){toast(errorMessage(err));}finally{ev.target.value='';}});
document.addEventListener('input',ev=>{if(ev.target.id!=='party-search')return;const s=ev.target.value.trim().toLowerCase();let shown=0;for(const tr of document.querySelectorAll('tr[data-search]')){tr.hidden=!!s&&!tr.dataset.search.includes(s);if(!tr.hidden)shown++;}const none=$('#party-empty');if(none)none.hidden=shown>0;});
// Боковая карточка на просмотре закрывается кликом мимо неё. При правке (форма с data-editing или уже что-то введено) — нет, чтобы не потерять ввод.
dialog.addEventListener('input',()=>{dialog.dataset.dirty='1';});
// Конвейер: карточка раскрывается поверх соседних через полсекунды наведения (docs/conveyor.md).
let hoverTimer=null;
document.addEventListener('mouseover',ev=>{const w=ev.target.closest?.('.cv-wrap'),cur=document.querySelector('.cv-wrap.open');if(w===cur)return;clearTimeout(hoverTimer);cur?.classList.remove('open');if(w&&w.querySelector('.cv-more'))hoverTimer=setTimeout(()=>w.classList.add('open'),450);});
dialog.addEventListener('click',ev=>{if(ev.target!==dialog||!/drawer/.test(dialog.className))return;const r=dialog.getBoundingClientRect();
 if(ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom)return;
 if(dialog.querySelector('[data-editing]')||dialog.dataset.dirty)return;dialog.close();});
document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-action]');if(!b||b.disabled||ui.busy)return;ui.busy=true;try{await action(b.dataset.action,b.dataset.id);}catch(err){toast(errorMessage(err));}finally{ui.busy=false;}});
// Карточки конвейера — не кнопки: открываются клавишами Enter и пробел.
document.addEventListener('keydown',ev=>{const card=ev.target.closest?.('[role="button"][data-action]');if(card&&ev.target===card&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();card.click();}});
document.addEventListener('change',async ev=>{if(ev.target.id==='jump'&&ev.target.value){const value=ev.target.value;return action(value.startsWith('project:')?'project':'nav',value.split(':')[1]);}if(ev.target.id==='month'&&ev.target.value){const previous=ui.month;ui.month=ev.target.value;try{await load();}catch(err){ui.month=previous;ev.target.value=previous;toast(errorMessage(err));}}});
if(!url||!key||!key.startsWith('sb_publishable_'))app.innerHTML=`<section class="login"><div class="mark">П</div><h1>Подключение ещё не настроено</h1><p>Для запуска администратор должен подключить базу системы ПТО и опубликовать сборку.</p></section>`;
else{
 client=createClient(url,key);
 client.auth.onAuthStateChange((event,s)=>{session=s;if(event==='PASSWORD_RECOVERY'){ui.recovery=true;setTimeout(login,0);}else if(event==='SIGNED_OUT'){++loadId;data={};profile=null;setTimeout(login,0);}else if(event==='INITIAL_SESSION'){setTimeout(()=>load().catch(err=>{app.innerHTML=`<section class="login"><h1>Не удалось загрузить систему</h1><p>${e(errorMessage(err))}</p>${btn('Повторить','refresh')}${btn('Выйти','logout')}</section>`;}),0);}});
}
