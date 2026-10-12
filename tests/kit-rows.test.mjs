import test from 'node:test';
import assert from 'node:assert/strict';
import {kitRows,kitTitle,kitStatus,signedOn} from '../src/kit-rows.js';
import {subMonthCard} from '../src/sub-card.js';

const data=()=>({versions:[{id:'v1',amount:'100.00',version:1},{id:'v2',amount:'50.00',version:1,note:'Часть объекта: ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ. Из файла Акт.xlsx, лист «Акт»'},{id:'v3',amount:null,version:1}],
 documents:[],c3aReports:[{version_id:'v3',document_id:'s',smr:'150.00',equipment:'0',target_offset:'0',current_offset:'0',to_pay:'150.00'}],
 docMarks:[{document_id:'a1',part:'Жилая часть'}],files:[]});
const list=[{id:'a2',kind:'c2b',number:'2',current_version:'v2'},{id:'s',kind:'c3a',number:'04/2026',current_version:'v3'},{id:'a1',kind:'c2b',number:'1',current_version:'v1'}];

test('kit rows: C-3a on top, acts below by number, part in its own column, green when acts match',()=>{
 const html=kitRows({data:data(),list,contract:{id:'c'},canEdit:true});
 assert.ok(html.indexOf('С-3а № 04/2026')<html.indexOf('С-2б № 1')&&html.indexOf('С-2б № 1')<html.indexOf('С-2б № 2'));
 assert.match(html,/class="kt-part" title="Жилая часть">Жилая часть/);assert.match(html,/class="kt-part" title="ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ">ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ</,'часть из загрузки Excel');
 assert.match(html,/class="kt-ok">150,00 ✓/);assert.match(html,/class="kt-ok">100,00/);
 assert.doesNotMatch(html,/new-c3a/,'справка есть — ссылки на новую справку нет');assert.match(html,/data-action="new-doc" data-id="c">\+ акт/);
});
test('kit rows: mismatch is red with the difference; no links for readers',()=>{
 const d=data();d.c3aReports[0].smr='160.00';
 const html=kitRows({data:d,list,contract:{id:'c'}});
 assert.match(html,/class="neg">160,00/);assert.match(html,/акты 150,00 · разница -10,00/);assert.doesNotMatch(html,/kt-ok|data-action="new-doc"/);
});
test('kit title and signing date are the same everywhere',()=>{
 assert.equal(kitTitle({template_code:'claim',contract_number:'21',party:'Трест'}),'Наша процентовка · дог. № 21 · Трест');
 assert.equal(kitTitle({template_code:'sub_claim',contract_number:'21-01/2026',party:'ГеоМонолит'}),'ГеоМонолит · дог. № 21-01/2026');
 const w={id:'w',step_code:'signed',step_label:'Проверено',step_dates:{check:'2026-10-10'}};
 assert.equal(signedOn(w),'2026-10-10');assert.equal(signedOn({...w,step_code:'check'}),null);
 assert.match(kitStatus(w),/подписана 10\.10\.2026/);assert.doesNotMatch(kitStatus(w),/Исправить дату/);
});
test('subcontractor card: view first, documents of the month, fields only by «Изменить»',()=>{
 const d={...data(),documents:list.map(x=>({...x,workflow_id:'w'})),workflows:[{id:'w',template_code:'sub_claim',contract_id:'k',step_code:'tn',step_label:'У технадзора',acts_amount:'150.00'}],
  subMonth:[{period_id:'p',contract_id:'k',expected:true,on_customer:'180.00'}]};
 const html=subMonthCard({data:d,contract:{id:'k',party:'ГеоМонолит',number:'21-01/2026'},period:{id:'p'},canEdit:true});
 assert.match(html,/<b>150,00<\/b><span>руб\. в их ценах/);assert.match(html,/<dt>Генуслуги<\/dt><dd>30,00/);
 assert.ok(html.indexOf('С-3а № 04/2026')<html.indexOf('С-2б № 1'));
 assert.match(html,/data-action="sub-month" data-id="k">Изменить/);assert.doesNotMatch(html,/<input|<select/);
});
