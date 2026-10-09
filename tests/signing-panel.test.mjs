import test from 'node:test';
import assert from 'node:assert/strict';
import {signingPanel,blockedReason} from '../src/signing-panel.js';

const steps=(tpl,codes)=>codes.map((code,i)=>({template_code:tpl,code,ordinal:i+1,label:{wait:'Ждём',acts:'Готовятся акты',tn:'У технадзора',check:'На проверке',signed:'Проверено',accepted:'В бухгалтерии'}[code]}));
function fixture(role='engineer'){
 const profile={id:'u',display_name:'Надя',role};
 const ours={id:'w',template_code:'claim',project_id:'p',project:'Пружаны',period_id:'per',contract_id:'c',contract_number:'21',money:true,acts_amount:'1973259.89',
  step_code:'tn',step_label:'У технадзора',step_ordinal:3,step_dates:{wait:'2026-10-02',acts:'2026-10-05'},step_since:'2026-10-06T10:00:00Z',open_notes:[]};
 const sub=(id,cid,step,ord)=>({id,template_code:'sub_claim',project_id:'p',period_id:'per',contract_id:cid,step_code:step,step_ordinal:ord,step_dates:{tn:'2026-10-05'},open_notes:[]});
 const data={projects:[{id:'p',name:'Пружаны'}],profiles:[profile,{id:'h',display_name:'Начальник',role:'head'}],memberships:[{project_id:'p',user_id:'u'}],
  periods:[{id:'per',project_id:'p',status:'open',revision:3}],
  steps:[...steps('claim',['wait','acts','tn','check','signed','accepted']),...steps('sub_claim',['wait','tn','check','signed','accepted'])],
  contracts:[{id:'c',project_id:'p',number:'21',direction:'outgoing'},{id:'m',project_id:'p',number:'С-1',party:'Мегалит',direction:'incoming'},{id:'s',project_id:'p',number:'С-2',party:'Стройком',direction:'incoming'}],
  workflows:[ours,sub('mw','m','check',3)],skips:[],
  documents:[{id:'a',workflow_id:'w',kind:'c2a',number:'7',current_version:'v1'}]};
 return {profile,data,ours,month:'2026-10',now:Date.parse('2026-10-08T10:00:00Z')};
}
const render=(f,x,extra={})=>signingPanel({x,data:f.data,profile:f.profile,month:f.month,now:f.now,...extra});

test('our claim at the supervisor: step line with dates, blocked move names missing subcontractors and C-3a, exclude link',()=>{
 const f=fixture();let html=render(f,f.ours);
 assert.match(html,/Закрыть ×/);assert.match(html,/Наша процентовка заказчику, дог\. № 21; инженер Надя/);assert.match(html,/1[\s ]973[\s ]259,89/);
 assert.match(html,/sp-st done"><i><\/i>Готовятся акты<em>05\.10<\/em>/,'пройденный шаг с датой');
 assert.match(html,/sp-st cur"><i><\/i>У технадзора<em>2 дн\.<\/em>/,'текущий шаг с днями');
 assert.match(html,/Отправить заказчику нельзя: технадзор не подтвердил: Стройком; нет справки С-3а/);
 assert.match(html,/data-id="step" disabled/);
 assert.match(html,/Технадзор <span>1 из 2 субподрядчиков/);assert.match(html,/data-id="exclude:s"/);
 assert.match(html,/Справка С-3а<\/span><span class="r">нужна для отправки заказчику/);
 f.data.skips=[{template_code:'sub_claim',contract_id:'s',reason:'нет ДС на новые сметы'}];f.data.documents.push({id:'b',workflow_id:'w',kind:'c3a',number:'7',current_version:'v2'});
 html=render(f,f.ours);assert.doesNotMatch(html,/disabled/,'все прошли или исключены');assert.match(html,/исключён: нет ДС на новые сметы/);
 html=render(f,f.ours,{mode:'step'});
 assert.match(html,/<form class="sp-move" data-op="advance" data-editing>/,'форма появляется после нажатия');
 for(const name of ['date','method','proof'])assert.match(html,new RegExp(`name="${name}"`));
 assert.match(html,/max="2026-10-08"/,'дата не позже сегодняшней');
 assert.match(render(f,f.ours,{mode:'exclude:s'}),/data-op="exclude" data-editing data-contract="s"/);
});

test('remarks are flags with round and removal; the open remark blocks the move',()=>{
 const f=fixture();f.ours.open_notes=[{id:5,note:'Не тот объём кладки <b>',source:'заказчик',person:'Надя',round:2,date:'2026-10-07'}];
 const html=render(f,f.ours);
 assert.match(html,/Не тот объём кладки &lt;b&gt;/);assert.match(html,/07\.10, заказчик; исправляет Надя; 2-й круг/);
 assert.match(html,/data-action="sp-note-off" data-id="5"/);assert.match(html,/нельзя: есть открытое замечание/);
 assert.match(html,/sp-st cur bad/);
 assert.match(render(f,f.ours,{mode:'note'}),/data-op="note"[\s\S]*name="source"[\s\S]*name="note"[\s\S]*name="person"/);
});

test('expected card: start with a date or skip with a reason; subcontractor first marks the kit received',()=>{
 const f=fixture();
 const exp={expected:true,key:'sub_claim:s',template_code:'sub_claim',step_code:'wait',project_id:'p',contract_id:'s',party:'Стройком'};
 let html=render(f,exp);
 assert.match(html,/Ваш ход: отметить «Подал технадзору»/);assert.match(html,/data-id="skip">Исключить из месяца/);
 assert.match(html,/sp-st skip"><i><\/i>Готовятся акты<em>не нужен/,'субподрядчик пропускает шаг');
 assert.match(render(f,exp,{mode:'step'}),/data-op="start"/);
 assert.match(render(f,exp,{mode:'skip'}),/data-op="skip"[\s\S]*работ не было/);
 const sw=f.data.workflows[1];
 assert.match(render(f,sw),/Ваш ход: отметить «Комплект получен»/);
 assert.match(render(f,sw,{mode:'step'}),/data-op="received"/);
 assert.match(render(f,{...sw,received_on:'2026-10-06'}),/Ваш ход: отметить «Проверено»/);
});

test('transfer to accounting needs scans; undo is offered to the one who moved and to the head; director only reads',()=>{
 const f=fixture();const w={...f.ours,step_code:'signed',step_ordinal:5};
 assert.equal(blockedReason(w,{data:f.data,files:[],month:f.month}),'не приложены сканы: 1');
 assert.match(render(f,w),/Приложить скан/);
 assert.equal(blockedReason(w,{data:f.data,files:[{version_id:'v1'}],month:f.month}),'');
 const events=[{id:9,kind:'advance',from_step:'check',to_step:'signed',actor:'u',event_date:'2026-10-07',created_at:'2026-10-07T10:00:00Z'}];
 let html=render(f,w,{events});
 assert.match(html,/Отменить переход/);assert.match(html,/07\.10<\/span><span class="t">Заказчик подписал/);
 assert.match(render(f,w,{events,mode:'undo'}),/data-op="undo"[\s\S]*Карточка вернётся на «На проверке»/);
 const other={...f,profile:{id:'x',role:'engineer'}};other.data={...f.data,memberships:[...f.data.memberships,{project_id:'p',user_id:'x'}]};
 assert.match(render(other,w,{events}),/Ошибочный переход отменяет Надя или начальник ПТО/);
 const dir=fixture('director');html=render(dir,dir.ours,{events});
 assert.match(html,/Следующий шаг: отправить заказчику/);assert.doesNotMatch(html,/data-action="sp-mode"|Отменить переход/);
 html=render(f,{...w,step_code:'accepted',step_ordinal:6},{events:[{...events[0],to_step:'accepted',from_step:'signed'}],files:[{version_id:'v1'}]});
 assert.match(html,/Передано в бухгалтерию/);assert.match(html,/Отменить переход/,'передачу можно отменить, пока период открыт');assert.doesNotMatch(html,/Добавить замечание/);
});

test('a closed panel is hidden: the drawer display rule applies only to an open dialog',async()=>{
 const css=(await import('node:fs')).readFileSync(new URL('../src/conveyor.css',import.meta.url),'utf8');
 for(const rule of css.match(/#dialog[^{]*\{[^}]*display:[^}]*\}/g)||[])assert.match(rule,/\[open\]/,rule);
});
