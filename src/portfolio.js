// Портфель: итог месяца и плитки объектов (docs/portfolio.md). Суммы — из реестра базы (pto_register_matrix), здесь не складываются.
import {escapeHtml as e,money} from './domain.js';
import {objectColor,subsOf} from './conveyor.js';

const DAY=86400000;
// Строка реестра по объекту: итог объекта, а если договор один — строка договора.
// Строки частей договора (kind 'part') в итог не входят: раньше из-за них у объекта с частями плитка показывала 0,00.
export function projectAmounts(matrix,projectId){
 const rows=(matrix?.rows||[]).filter(r=>r.project_id===projectId&&r.kind!=='part');
 const row=rows.find(r=>r.kind==='project')||(rows.length===1?rows[0]:null);
 return row?{total:row.total,own:row.own,subcontract:row.subcontract,basis:row.basis}:{total:'0.00',own:'0.00',subcontract:'0.00'};
}
// Изменение к прошлому месяцу, %; null, если сравнивать не с чем или за месяц ещё ничего нет (не «▼100 %»).
export function deltaPercent(current,previous){const c=Number(current),p=Number(previous);return p>0&&c>0?Math.round((c-p)/p*100):null;}
// 15-е число месяца, следующего за отчётным (срок С-29).
export function c29Deadline(month){const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m,15));return d.toISOString().slice(0,10);}
const daysBetween=(from,to)=>Math.round((new Date(to+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/DAY);
const age=(w,now)=>{const t=w.step_since||w.updated_at||w.created_at;return t?Math.max(0,Math.floor((now-new Date(t).getTime())/DAY)):0;};
const noteOf=w=>{const n=Array.isArray(w.open_notes)?w.open_notes:[];return n[n.length-1]||null;};
// Отстающий комплект объекта по маршруту: с наименьшим шагом.
const lagging=(workflows,projectId,template)=>workflows.filter(w=>w.project_id===projectId&&w.template_code===template).sort((a,b)=>a.step_ordinal-b.step_ordinal)[0]||null;

export function claimStatus(workflows,projectId,now=Date.now()){
 const w=lagging(workflows,projectId,'claim');
 if(!w)return {text:'Не начата',cls:'n'};
 if(w.step_code==='accepted')return {text:'В бухгалтерии',cls:'ok',done:true,signed:true};
 const days=` · ${age(w,now)} дн.`;
 if(noteOf(w))return {text:`Замечание · ${w.step_label}${days}`,cls:'o',title:noteOf(w).note};
 if(w.step_code==='signed')return {text:'Подписана заказчиком',cls:'ok',signed:true};
 if(w.step_code==='check')return {text:`У заказчика${days}`,cls:'b'};
 return {text:`${w.step_label}${days}`,cls:'w'};
}

export function c29Status(workflows,projectId,month,today,now=Date.now()){
 const w=lagging(workflows,projectId,'c29'),deadline=c29Deadline(month),left=daysBetween(today,deadline);
 if(w&&w.step_code==='accepted')return {text:'В бухгалтерии',cls:'ok',done:true,deadline};
 let s;
 if(!w)s={text:'Не начат',cls:'n'};
 else{const days=` · ${age(w,now)} дн.`;
  if(noteOf(w))s={text:`Замечания${days}`,cls:'o',title:noteOf(w).note};
  else if(w.step_code==='signed')s={text:`Проверен${days}`,cls:'b'};
  else s={text:`В работе · ${w.step_code==='tn'?'у прораба':'у ПТО'}${days}`,cls:'w'};}
 if(left<0)return {...s,text:`Просрочен · ${s.text}`,cls:'e',deadline};
 if(left<=5)return {...s,soon:left,deadline};
 return {...s,deadline};
}

// Ответственный инженер объекта: выбранный в карточке объекта (engineer_id), иначе первый инженер с доступом к объекту.
export function engineerName(data,projectId){
 const p=(data.projects||[]).find(x=>x.id===projectId);
 if(p?.engineer_id){const u=(data.profiles||[]).find(x=>x.id===p.engineer_id);if(u)return u.display_name;}
 const ids=(data.memberships||[]).filter(m=>m.project_id===projectId).map(m=>m.user_id);
 return (data.profiles||[]).find(p=>ids.includes(p.id)&&p.role==='engineer')?.display_name||'';
}

const fmtShort=x=>new Date(x+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',timeZone:'Europe/Minsk'});
const pill=s=>`<span class="st ${s.cls}"${s.title?` title="${e(s.title)}"`:''}>${e(s.text)}</span>`;
const delta=d=>d===null?'':`<span class="delta ${d>=0?'up':'dn'}" title="К прошлому месяцу">${d>=0?'▲':'▼'} ${Math.abs(d)}%</span>`;
const negHint='Собственные силы отрицательны: субподряд больше выполнения по договору';
// Субподрядчики месяца: подали (есть комплект) из ожидаемых, без исключённых.
export function subsFiled(data,projectIds,month){
 let filed=0,active=0;for(const pid of projectIds)for(const s of subsOf(data,pid,month)){if(s.skip)continue;active++;if(s.workflow)filed++;}
 return {filed,active};
}
// Тонкая полоса «своими силами (синий) / субподряд (зелёный)»: пока подали не все — конец штрихован и «предварительно»;
// отрицательные свои силы — красная рамка и подпись. Общая для Портфеля и страницы объекта.
export function splitBar({own,sub,filed,active}){
 const o=Number(own)||0,b=Number(sub)||0,pos=Math.max(0,o)+Math.max(0,b)||1,pre=filed<active,neg=o<0;
 return `<div class="pf-split2${neg?' neg':''}"><div class="pf-sbar${pre?' pre':''}" role="img" aria-label="Своими силами ${money(o)}, субподряд ${money(b)} руб.">${o>0?`<i class="own" style="width:${o/pos*100}%" title="Своими силами: ${money(o)} руб."></i>`:''}${b>0?`<i class="sub" style="width:${b/pos*100}%" title="Субподряд: ${money(b)} руб."></i>`:''}</div>
 <div class="pf-slegend"><span><i class="own"></i>Своими силами <b class="${neg?'neg':''}">${money(o)}</b>${neg?' <span class="neg">отрицательные, проверьте</span>':''}</span><span><i class="sub"></i>Субподряд <b>${money(b)}</b></span><span class="muted">подали ${filed} из ${active}${pre?' · предварительно':''}</span></div></div>`;
}

export function portfolioPage({ui,data,profile,today,now=Date.now(),view}){
 const projects=data.projects||[],workflows=data.workflows||[];
 const rows=projects.map(p=>{const a=projectAmounts(data.matrix,p.id),prev=projectAmounts(data.prevMatrix,p.id);
  return {p,a,subs:subsFiled(data,[p.id],ui.month),d:deltaPercent(a.total,prev.total),eng:engineerName(data,p.id),claim:claimStatus(workflows,p.id,now),c29:c29Status(workflows,p.id,ui.month,today,now),period:(data.periods||[]).find(x=>x.project_id===p.id)};});
 const t=data.matrix?.total||{total:'0.00',own:'0.00',subcontract:'0.00'},n=projects.length;
 const count=f=>rows.filter(f).length;
 const ownCell=v=>Number(v)<0?`<span class="own neg" title="${negHint}">${money(v)}</span>`:`<span class="own">${money(v)}</span>`;
 const totals=rows.map(r=>({p:r.p,v:Number(r.a.total)||0})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v),sum=totals.reduce((t,x)=>t+x.v,0);
 // Полоса СМР месяца по объектам: кусок в цвете объекта, подпись внутри, если кусок широкий; клик открывает объект.
 const bar=sum?`<div class="pf-objbar" role="group" aria-label="СМР месяца по объектам">${totals.map(x=>`<button class="pf-seg" style="flex:${x.v} 1 0;--oc:${objectColor(projects,x.p.id)}" data-action="project" data-id="${e(x.p.id)}" title="${e(x.p.name)}: ${money(x.v)} руб. · ${Math.round(x.v/sum*100)} %">${x.v/sum>=0.07?`<span>${e(x.p.name)}</span><small>${money(x.v)}</small>`:''}</button>`).join('')}</div>`:'';
 const band=`<section class="pf-band" aria-label="Итог портфеля за месяц">
<div class="pf-k"><small>СМР всего за месяц</small><b>${money(t.total)}</b>${delta(deltaPercent(t.total,data.prevMatrix?.total?.total))}</div>
<div class="pf-k s"><small>Своими силами</small><b${Number(t.own)<0?` class="neg" title="${negHint}"`:''}>${money(t.own)}</b></div>
<div class="pf-k s"><small>Субподряд</small><b>${money(t.subcontract)}</b></div>
<div class="pf-counters"><span>Процентовки подписаны <b>${count(r=>r.claim.signed)} из ${n}</b></span><span>С-29 приняты <b>${count(r=>r.c29.done)} из ${n}</b></span><span class="${n&&count(r=>r.period?.status==='closed')===n?'ok':''}">Месяц закрыт <b>${count(r=>r.period?.status==='closed')} из ${n}</b></span></div>
${sum?`<div class="pf-graph">${bar}${splitBar({own:t.own,sub:t.subcontract,...subsFiled(data,projects.map(p=>p.id),ui.month)})}</div>`:''}
</section>`;
 const tile=r=>{const {p,a,c29}=r;
  return `<button class="tile pf-tile" data-action="project" data-id="${e(p.id)}">
<span class="pf-head"><b title="${e(p.full_name||p.name)}"><i class="ct-dot" style="background:${objectColor(projects,p.id)}"></i>${e(p.name)}</b><span class="eng">${e(r.eng)}</span></span>
<span class="pf-sum"><span class="amt">${money(a.total)}</span>${delta(r.d)}</span>
<span class="pf-split">${ownCell(a.own)}<span class="muted">своими</span><span class="muted">·</span><span>${money(a.subcontract)}</span><span class="muted">субподряд${r.subs.active?` · подали ${r.subs.filed} из ${r.subs.active}`:''}${r.subs.filed<r.subs.active||a.basis==='acts'?' · предв.':''}</span></span>
<span class="pf-rows">
<span class="pf-row"><span class="muted">Процентовка заказчику</span>${pill(r.claim)}</span>
<span class="pf-row"><span class="muted">С-29 <small>до ${e(fmtShort(c29.deadline))}</small></span><span class="pf-c29">${pill(c29)}${c29.soon!==undefined?`<span class="st w">срок через ${c29.soon} дн.</span>`:''}</span></span>
</span>
<span class="pf-foot ${r.period?.status==='closed'?'closed':''}">${r.period?.status==='closed'?'Месяц закрыт':r.period?'Месяц в работе':'Месяц не открыт'}</span>
</button>`;};
 const table=`<div class="table-wrap"><table><thead><tr><th>Объект</th><th>Инженер</th><th class="num">СМР за месяц, руб.</th><th class="num">Своими силами</th><th class="num">Субподряд</th><th>Процентовка заказчику</th><th>С-29</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="link" data-action="project" data-id="${e(r.p.id)}">${e(r.p.name)}</button></td><td>${e(r.eng)}</td><td class="num">${money(r.a.total)} ${delta(r.d)}</td><td${Number(r.a.own)<0?` class="num neg" title="${negHint}"`:' class="num"'}>${money(r.a.own)}</td><td class="num">${money(r.a.subcontract)}</td><td>${pill(r.claim)}</td><td>${pill(r.c29)}</td></tr>`).join('')}</tbody></table></div>`;
 const toggle=`<div class="view-toggle">${[['tiles','Плитки'],['table','Таблица']].map(([id,label])=>`<button class="${view===id?'on':''}" data-action="portfolio-view" data-id="${id}" aria-pressed="${view===id}">${label}</button>`).join('')}</div>`;
 const head=`<div class="heading"><div><h1>Портфель</h1><div class="muted">Объекты и выполнение за отчётный месяц.</div></div><div class="actions">${toggle}</div></div>`;
 if(!n)return head+`<div class="empty">${profile?.role==='head'?'Пока нет объектов. Добавьте первый в разделе «Объекты».':'Пока нет объектов.'}</div>`;
 return head+band+(view==='table'?table:`<div class="pf-grid">${rows.map(tile).join('')}</div>`);
}

// «Объекты»: список объектов; строка открывает карточку объекта. Создаёт объекты только начальник ПТО.
export function objectListPage({data,profile}){
 const add=profile?.role==='head'?`<button class="primary" data-action="new-project" data-id="">Добавить объект</button>`:'';
 const list=data.projects||[];
 return `<div class="heading"><div><h1>Объекты</h1><div class="muted">Справочник объектов. Строка открывает карточку: название, адрес, ответственный инженер и цвет.</div></div><div class="actions">${add}</div></div>`+
 (list.length?`<div class="table-wrap"><table class="ob-list"><thead><tr><th>Объект</th><th>Полное наименование</th><th>Адрес</th><th>Инженер</th></tr></thead><tbody>${list.map(p=>`<tr class="ob-row" data-action="object-card" data-id="${e(p.id)}" tabindex="0" role="button"><td class="ct-nw"><i class="ob-dot2" style="background:${objectColor(list,p.id)}"></i><b>${e(p.name)}</b></td><td>${e(p.full_name||'')}</td><td>${e(p.address||'')}</td><td>${e(engineerName(data,p.id))}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">Пока нет объектов.</div>`);
}
