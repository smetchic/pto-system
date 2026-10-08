// Боковая панель «Подписания» (docs/conveyor.md, раздел «Боковая панель»): что есть по шагу и форма следующего действия.
// Чистая функция: данные приходят из main.js, команды отправляет main.js по формам с data-op.
import {escapeHtml as e,money,kindNames} from './domain.js';
import {COLUMNS,KIND,moveOf,sayMove,openNotes,objectColor,subsOf,canMoveCard,daysOnStep} from './conveyor.js';

const KIND_LONG={claim:'Наша процентовка заказчику',sub_claim:'Процентовка субподрядчика',c29:'С-29, расход материалов'};
const REASONS=['работ не было','нет ДС на новые сметы','подаст в следующем месяце'];
const SOURCES={claim:['заказчик','технадзор','ПТО','бухгалтерия'],sub_claim:['ПТО','технадзор','бухгалтерия'],c29:['ПТО','прораб','бухгалтерия']};
// Что значит шаг и что вводится при переходе (docs/conveyor.md, «Что вводится при переходе»).
const ABOUT={
 claim:{wait:'Прораб сдал объёмы за месяц. С этой даты считается, сколько ПТО готовит акты.',acts:'Акты С-2а готовы и переданы технадзору на защиту.',
  tn:'Технадзор подтвердил нашу часть и всех субподрядчиков месяца, комплект собран. С этого шага нужна справка С-3а.',check:'Вводится только дата подписания. Сумма в реестре становится «подписана».',
  signed:'Оригиналы передаются в бухгалтерию, сканы прикладываются при передаче. Сумма фиксируется.'},
 sub_claim:{wait:'Субподрядчик подал процентовку технадзору и защищает её сам.',tn:'Технадзор подписал объёмы субподрядчика; после этого он засчитывается в нашей процентовке.',
  received:'Субподрядчик принёс подписанные технадзором объёмы и комплект. С этой даты ПТО проверяет.',check:'ПТО проверило комплект. Субподрядчику сообщают нести бумагу на подпись.',
  signed:'Бумага подписана с обеих сторон и передана в бухгалтерию со сканами. Сумма фиксируется.'},
 c29:{wait:'Акты месяца готовы, можно формировать С-29.',acts:'ПТО сформировало нормативный расход; прораб вносит фактический.',tn:'Прораб вернул С-29 с фактическим расходом и объяснениями отклонений.',
  check:'ПТО проверило отклонения. Срок С-29: до 15 числа следующего месяца.',signed:'Утверждённая С-29 передаётся в бухгалтерию.'}
};
const FIELDS={
 claim:{wait:[['date','Дата сдачи прорабом']],acts:[['date','Дата передачи']],tn:[['date','Дата отправки'],['method','Как отправили'],['proof','Номер письма']],
  check:[['date','Дата подписания']],signed:[['date','Дата передачи'],['person','Кому']]},
 sub_claim:{wait:[['date','Дата подачи']],tn:[['date','Дата подтверждения']],received:[['date','Дата получения']],check:[['date','Дата проверки']],
  signed:[['paper','Бумага подписана'],['date','Дата передачи'],['person','Кому']]},
 c29:{wait:[['date','Дата']],acts:[['date','Дата передачи'],['person','Прораб']],tn:[['date','Дата получения']],check:[['date','Дата проверки']],signed:[['date','Дата передачи'],['person','Кому']]}
};
const EVENT={created:'Комплект создан',start:'',advance:'',undo:'Переход отменён',note:'Замечание',note_off:'Замечание снято',received:'Комплект получен',revised:'Документ изменён',return:'Возврат',reset:'Возврат на первый шаг'};
const day=x=>x?new Date(String(x).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',timeZone:'Europe/Minsk'}):'';

function input([type,label],x,today){
 const id='sp-'+type;
 if(type==='date')return `<label for="${id}">${e(label)}</label><input id="${id}" name="date" type="date" value="${today}" max="${today}" required>`;
 if(type==='method')return `<label for="${id}">${e(label)}</label><select id="${id}" name="method">${['письмом','нарочно','через СЭД'].map(o=>`<option>${o}</option>`).join('')}</select>`;
 if(type==='paper')return `<label for="${id}">${e(label)}</label><span><input id="${id}" name="proof" type="checkbox" value="подписана с обеих сторон" required> с обеих сторон</span>`;
 if(type==='proof')return `<label for="${id}">${e(label)}</label><input id="${id}" name="proof" type="text" placeholder="№ 412" required minlength="3">`;
 return `<label for="${id}">${e(label)}</label><input id="${id}" name="person" type="text" required minlength="2">`;
}
const form=(op,title,about,fields,submit,extra='')=>`<form class="sp-move" data-op="${op}" data-editing${extra}><h3>${e(title)}</h3>${about?`<p>${e(about)}</p>`:''}<div class="sp-form">${fields}</div>
 <p class="sp-error" role="alert"></p><div class="sp-btns"><button class="primary" type="submit">${e(submit)}</button><button type="button" data-action="sp-mode" data-id="">Отмена</button></div></form>`;

// Чего не хватает для перехода (подсказка; окончательно проверяет база).
export function blockedReason(x,{data,files=[],month}){
 if(x.expected)return '';
 if(openNotes(x).length)return 'есть открытое замечание';
 const kit=(data.documents||[]).filter(d=>d.workflow_id===x.id);
 if(x.template_code==='claim'&&x.step_code==='acts'&&!kit.some(d=>['c2a','c2b'].includes(d.kind)))return 'в комплекте нет актов С-2';
 if(x.template_code==='claim'&&x.step_code==='tn'){
  const lag=subsOf(data,x.project_id,month).filter(s=>!s.passed&&!s.skip).map(s=>s.contract.party||s.contract.number);
  const out=[];if(lag.length)out.push('технадзор не подтвердил: '+lag.join(', '));if(!kit.some(d=>d.kind==='c3a'))out.push('нет справки С-3а');
  return out.join('; ');
 }
 if(x.template_code==='c29'&&x.step_code==='acts'&&!kit.some(d=>d.kind==='c29'))return 'нет документа С-29';
 if(x.step_code==='signed'){const n=kit.filter(d=>!files.some(f=>f.version_id===d.current_version)).length;if(n)return `не приложены сканы: ${n}`;}
 return '';
}

export function signingPanel({x,data,profile,mode='',events=[],files=[],month,now=Date.now()}){
 const projects=data.projects||[],color=objectColor(projects,x.project_id),name=x.project||projects.find(p=>p.id===x.project_id)?.name||'';
 const ids=(data.memberships||[]).filter(m=>m.project_id===x.project_id).map(m=>m.user_id);
 const eng=(data.profiles||[]).find(p=>ids.includes(p.id)&&p.role==='engineer')?.display_name||'';
 const today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Europe/Minsk'});
 const can=canMoveCard(x,{profile,data}),tpl=x.template_code,steps=(data.steps||[]).filter(s=>s.template_code===tpl);
 const label=code=>steps.find(s=>s.code===code)?.label||COLUMNS.find(c=>c[0]===code)?.[1]||code||'';
 const notes=openNotes(x),kit=(data.documents||[]).filter(d=>d.workflow_id===x.id&&!x.expected);
 const who=a=>(data.profiles||[]).find(p=>p.id===a)?.display_name||'';
 const second=tpl==='sub_claim'?(x.party||''):`дог. № ${x.contract_number||''}`;

 // Шкала шести шагов: пройденные с датами, текущий с днями, пропущенный бледный.
 const curOrd=steps.find(s=>s.code===x.step_code)?.ordinal||1,dates=x.step_dates||{};
 const strip=`<div class="sp-steps">${COLUMNS.map(([code])=>{const s=steps.find(t=>t.code===code);
  const cls=!s?'skip'+(COLUMNS.findIndex(c=>c[0]===x.step_code)>COLUMNS.findIndex(c=>c[0]===code)?' done':''):s.ordinal<curOrd?'done':s.code===x.step_code?'cur'+(notes.length?' bad':''):'';
  const when=!s?'не нужен':s.ordinal<curOrd?day(dates[code]):s.code===x.step_code&&!x.expected?(daysOnStep(x,now)?daysOnStep(x,now)+' дн.':'сегодня'):'';
  return `<div class="sp-st ${cls}"><i></i>${e(s?s.label:label(code))}<em>${e(when)}</em></div>`;}).join('')}</div>`;

 // «Ваш ход»: главная кнопка; поля появляются после нажатия.
 const m=moveOf(x),key=m?.received?'received':x.step_code,blocked=blockedReason(x,{data,files,month});
 const skipWord=tpl==='sub_claim'?'Исключить из месяца':'Снять ожидание';
 let move;
 if(x.step_code==='accepted')move=`<div class="sp-move done"><h3>Передано в бухгалтерию ${e(day(dates.signed))}</h3><p>Сумма зафиксирована. Дальше шагов нет: бухгалтерия системой не пользуется.</p></div>`;
 else if(!can)move=`<div class="sp-move done"><h3>Следующий шаг: ${e(sayMove(m))}</h3><p>Делает ${e(eng||'инженер объекта')} или начальник ПТО.</p></div>`;
 else if(mode==='step')move=form(x.expected?'start':m.received?'received':'advance',m.v,ABOUT[tpl][key],(FIELDS[tpl][key]||[['date','Дата']]).map(f=>input(f,x,today)).join(''),m.v);
 else if(mode==='skip')move=form('skip',skipWord,tpl==='sub_claim'?'Субподрядчик переносится в следующий месяц, наша процентовка его больше не ждёт.':'Карточка уходит с доски; причина остаётся в истории.',
  `<label for="sp-reason">Причина</label><select id="sp-reason" name="reason">${REASONS.map(r=>`<option>${r}</option>`).join('')}</select><label for="sp-note">Пояснение</label><textarea id="sp-note" name="note" placeholder="необязательно"></textarea>`,skipWord);
 else move=`<div class="sp-move"><h3>Ваш ход: ${e(sayMove(m))}</h3><p>${blocked?`<span class="sp-why">${e(m.v)} нельзя: ${e(blocked)}.</span>`:e(ABOUT[tpl][key]||'')}</p>
  <div class="sp-btns"><button class="primary" data-action="sp-mode" data-id="step"${blocked?' disabled':''}>${e(m.v)}</button>${x.expected?`<button data-action="sp-mode" data-id="skip">${skipWord}</button>`:''}</div></div>`;

 // Технадзор: субподрядчики месяца для нашей процентовки.
 let tn='';
 if(tpl==='claim'&&!x.expected&&['acts','tn'].includes(x.step_code)){
  const subs=subsOf(data,x.project_id,month);
  if(subs.length){const ok=subs.filter(s=>s.passed||s.skip).length;
   tn=`<div class="sp-blk"><h4>Технадзор <span>${ok} из ${subs.length} субподрядчиков</span></h4><ul class="sp-rows">${subs.map(s=>{
    const n=s.contract.party||s.contract.number;
    const right=s.skip?`исключён: ${e(s.skip.reason)}`:s.passed?`подтвердил ${e(day(s.workflow.step_dates?.tn))}`:s.workflow?'у технадзора':can?`ждём процентовку <button class="link" data-action="sp-mode" data-id="exclude:${e(s.contract.id)}">Исключить из месяца</button>`:'ждём процентовку';
    return `<li class="${s.skip?'ex':s.passed?'':'no'}"><span class="m">${s.skip?'–':s.passed?'✓':'—'}</span><span class="t">${e(n)}</span><span class="r">${right}</span></li>`;}).join('')}</ul>
    ${mode.startsWith('exclude:')?form('exclude','Исключить из месяца','Субподрядчик переносится в следующий месяц; наша процентовка его больше не ждёт.',`<label for="sp-reason">Причина</label><select id="sp-reason" name="reason">${REASONS.map(r=>`<option>${r}</option>`).join('')}</select>`,'Исключить',` data-contract="${e(mode.slice(8))}"`):''}</div>`;}
 }

 // Комплект: документы; при передаче в бухгалтерию — сканы.
 let kitBlk='';
 if(!x.expected){
  const scans=['signed','accepted'].includes(x.step_code),has=d=>files.some(f=>f.version_id===d.current_version);
  const rows=kit.map(d=>`<li class="${scans&&!has(d)?'no':''}"><span class="m">${scans&&!has(d)?'—':'✓'}</span><span class="t"><button class="link" data-action="doc" data-id="${e(d.id)}">${e(kindNames[d.kind])} № ${e(d.number)}</button></span><span class="r">${scans?(has(d)?'скан приложен':can?`<button class="link" data-action="doc" data-id="${e(d.id)}">Приложить скан</button>`:'нет скана'):''}</span></li>`);
  if(tpl==='claim'&&['acts','tn'].includes(x.step_code)&&!kit.some(d=>d.kind==='c3a'))rows.push('<li class="no"><span class="m">—</span><span class="t">Справка С-3а</span><span class="r">нужна для отправки заказчику</span></li>');
  const title=tpl==='claim'?'Комплект для заказчика':tpl==='sub_claim'?'Комплект субподрядчика':'Документы';
  kitBlk=`<div class="sp-blk"><h4>${title} <span>${kit.length} ${kit.length===1?'документ':'док.'}${scans?`, сканы ${kit.filter(has).length} из ${kit.length}`:''}${x.money&&Number(x.acts_amount)?`, ${money(x.acts_amount)}`:''}</span></h4>${rows.length?`<ul class="sp-rows">${rows.join('')}</ul>`:'<p class="sp-mu">Документов пока нет: они добавляются на странице объекта.</p>'}
   ${tpl==='sub_claim'&&x.received_on?`<p class="sp-mu">Комплект получен ${e(day(x.received_on))}.</p>`:''}</div>`;
 }

 // Замечания: флажок на шаге, не возврат назад.
 let notesBlk='';
 if(!x.expected){
  const ed=can&&x.step_code!=='accepted';
  const add=ed&&mode!=='note'?`<button class="link" data-action="sp-mode" data-id="note">Добавить замечание</button>`:'';
  const addForm=mode==='note'?form('note','Замечание','',`<label for="sp-source">Чьё</label><select id="sp-source" name="source">${SOURCES[tpl].map(s=>`<option>${s}</option>`).join('')}</select>
   <label for="sp-text">Что не так</label><textarea id="sp-text" name="note" required minlength="3" placeholder="например: не тот объём кладки, п. 14"></textarea>
   <label for="sp-fix">Кто исправляет</label><input id="sp-fix" name="person" type="text" value="${e(tpl==='sub_claim'?x.party||'':eng)}">`,'Добавить'):'';
  notesBlk=`<div class="sp-blk"><h4>Замечания <span>${notes.length?`${notes.length} открыто`:'нет открытых'}</span>${add}</h4>
   ${notes.map(n=>`<div class="sp-note"><b>${e(n.note)}</b><span>${e(day(n.date))}, ${e(n.source)}${n.person?`; исправляет ${e(n.person)}`:''}${n.round>1?`; ${n.round}-й круг`:''}${ed?` <button class="link" data-action="sp-note-off" data-id="${e(n.id)}">Снять замечание</button>`:''}</span></div>`).join('')}${addForm}
   ${!notes.length&&!addForm?'<p class="sp-mu">Замечание не возвращает карточку назад: она остаётся на шаге с красным флажком.</p>':''}</div>`;
 }

 // История: последние записи.
 const hist=events.slice(0,5).map(v=>`<li><span class="m">${e(day(v.event_date||v.created_at))}</span><span class="t">${e(EVENT[v.kind]||'')}${['start','advance'].includes(v.kind)?e(MOVES_LABEL(tpl,v)):''}${v.kind==='undo'||v.kind==='note'||v.kind==='revised'?`${v.note?': '+e(v.note):''}`:''}${v.proof&&v.kind==='advance'?`, ${e(v.method?v.method+' ':'')}${e(v.proof)}`:''}${v.person&&v.kind==='advance'?`, ${e(v.person)}`:''}</span><span class="r">${e(who(v.actor)||'')}</span></li>`).join('');
 const histBlk=hist?`<div class="sp-blk"><h4>История</h4><ul class="sp-rows sp-hist">${hist}</ul></div>`:'';

 // Отмена ошибочного перехода: нажавший или начальник ПТО.
 const lastMove=events.find(v=>['start','advance','undo'].includes(v.kind));
 let foot='';
 if(!x.expected&&lastMove&&lastMove.kind!=='undo'&&['head','engineer'].includes(profile?.role)&&canMoveCardAny(x,{profile,data})){
  const may=profile.role==='head'||lastMove.actor===profile.id;
  foot=!may?`<div class="sp-foot">Ошибочный переход отменяет ${e(who(lastMove.actor)||'нажавший')} или начальник ПТО.</div>`
   :mode==='undo'?`<div class="sp-foot">${form('undo','Отменить переход',`Карточка вернётся на «${label(lastMove.from_step)}». Запись останется в истории.`,'<label for="sp-why">Почему отменяем</label><input id="sp-why" name="note" type="text" required minlength="3" placeholder="нажал по ошибке">','Отменить переход')}</div>`
   :`<div class="sp-foot"><button class="link sp-er" data-action="sp-mode" data-id="undo">Отменить переход</button><span>только если нажали по ошибке; запись останется в истории</span></div>`;
 }

 return `<div class="sp" style="--oc:${color}"><div class="sp-scroll"><button class="proc-drawer-close" data-action="dismiss">Закрыть ×</button>
  <div class="sp-head"><h2>${e(name)}</h2><div class="sp-sub">${KIND_LONG[tpl]}, ${e(second)}${eng?`; инженер ${e(eng)}`:''}</div>
  ${x.money&&Number(x.acts_amount)?`<div class="sp-sum">${money(x.acts_amount)}<small>${x.step_code==='accepted'?'зафиксирована':x.step_code==='signed'&&tpl==='claim'?'подписана':'за месяц'}</small></div>`:''}</div>
  ${strip}${move}${tn}${kitBlk}${notesBlk}${histBlk}</div>${foot}</div>`;
}
// Отмена доступна и на последнем шаге (передано в бухгалтерию), пока период открыт.
function canMoveCardAny(x,{profile,data}){return canMoveCard({...x,step_code:'acts'},{profile,data});}
function MOVES_LABEL(tpl,v){const m=moveOf({template_code:tpl,step_code:v.from_step,received_on:true});return m?m.past:`${v.from_step} → ${v.to_step}`;}
export {KIND};
