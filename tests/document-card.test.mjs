import test from 'node:test';
import assert from 'node:assert/strict';
import {documentCard,scanName,sourceOf,docTitle} from '../src/document-card.js';

const data={projects:[{id:'p',name:'Пружаны'}],periods:[{id:'per',month:'2026-08-01',revision:4}],
 contracts:[{id:'c',number:'21',party:'Трест',direction:'outgoing'},{id:'s',number:'21-03/2026',party:'БЕЛТОПМЕД',direction:'incoming'}],
 profiles:[{id:'u',display_name:'Игорь'}],
 documents:[{id:'a22',kind:'c2b',number:'22',contract_id:'c',project_id:'p',period_id:'per',workflow_id:'w',current_version:'v22',step_code:'accepted',step_label:'В бухгалтерии'},
  {id:'a23',kind:'c2b',number:'23',contract_id:'c',project_id:'p',period_id:'per',workflow_id:'w',current_version:'v23',step_code:'accepted',step_label:'В бухгалтерии'},
  {id:'sp',kind:'c3a',number:'08/2026',contract_id:'c',project_id:'p',period_id:'per',workflow_id:'w',current_version:'vs',step_code:'accepted',step_label:'В бухгалтерии'}],
 versions:[{id:'v22',document_id:'a22',version:1,amount:'366768.39',smr_vat:'61128.07',created_by:'u',created_at:'2026-10-11T18:26:26Z',note:'Часть объекта: ЦЕХ (ПРИСТРОЙКА). Из файла Акт С-2б.xlsx, лист «Акт С-2б»'},
  {id:'v23',document_id:'a23',version:1,amount:'1600000.00',note:''},
  {id:'vs',document_id:'sp',version:1,amount:'1973259.89',note:'Из файла Справка.xlsx, лист «Справка С-3а»'}],
 docMarks:[{document_id:'a22',tn_status:'ok',original:'accounting',note:'Передан оригинал'}],
 c3aReports:[{version_id:'vs',document_id:'sp',is_current:true,smr:'1973259.89',smr_vat:'328876.65',equipment:'731538.30',equipment_vat:'121923.06',target_offset:'553974.13',current_offset:'600000.00',to_pay:'1550824.06',
  total_smr:'10803040.16',ytd_smr:'10803040.16',total_to_pay:'7509429.32',ytd_to_pay:'7509429.32'}]};

test('document card: act — identity, amount/status, relation and scan before service fields; one inline edit action',()=>{
 const html=documentCard({data,doc:data.documents[0],canEdit:true});
 assert.match(html,/<div class="dc-party">Трест<\/div>/);
 assert.match(html,/<div class="dc-object">Пружаны<\/div>/);
 assert.match(html,/dc-part">ЦЕХ \(ПРИСТРОЙКА\)<\/div>/);
 assert.match(html,/<div class="dc-contract">Договор № 21<\/div>/);
 assert.match(html,/<h2>Акт С-2б № 22<\/h2>/);
 assert.match(html,/<div class="dc-month">август 2026<\/div>/);
 assert.match(html,/class="dc-amount-row">[\s\S]*366[\s ]768,39<\/b>[\s\S]*<span class="ob-st ok">В бухгалтерии<\/span>/,'статус стоит напротив суммы');
 assert.match(html,/в т\. ч\. НДС 61[\s ]128,07/);
 assert.match(html,/<dt>Технадзор<\/dt><dd>подписал<\/dd>/);assert.match(html,/<dt>Оригинал<\/dt><dd>передан в бухгалтерию<\/dd>/);assert.match(html,/<dt>Комментарий<\/dt><dd>Передан оригинал<\/dd>/);
 assert.match(html,/Входит в <button[^>]*data-id="sp">Справка С-3а № 08\/2026/);
 assert.ok(html.indexOf('Входит в')<html.indexOf('<h3>Скан</h3>'),'связь со справкой сразу после суммы');
 assert.ok(html.indexOf('<h3>Скан</h3>')<html.indexOf('<dt>Технадзор</dt>'),'служебные поля идут после скана');
 const meta=html.match(/<p class="dc-meta">[\s\S]*?<\/p>/)?.[0]||'';
 assert.match(meta,/из файла Акт С-2б\.xlsx/);assert.doesNotMatch(meta,/Часть объекта:/,'часть объекта не повторяется в видимой подписи источника');
 assert.match(html,/Загрузить скан/,'скан загружается и в бухгалтерии');
 assert.match(html,/data-action="doc-edit"[^>]*>Изменить/);assert.doesNotMatch(html,/data-action="revise"|Новая версия/);
 assert.match(html,/class="dc-edit-only">[\s\S]*Часть объекта/,'часть редактируется в этой же карточке');
 assert.match(html,/name="tn_status"/);assert.match(html,/name="original"/);assert.match(html,/name="mark_note"/);
 assert.doesNotMatch(html,/Материалы заказчика|name="materials"|>Отметки</,'материалы и отдельные «Отметки» из карточки убраны');
 assert.doesNotMatch(html,/Версии<\/h3>/,'одна версия — без истории');
});

test('document card: C-3a — «к оплате» big, sections of the form, month column, cumulative and one edit action',()=>{
 let html=documentCard({data,doc:data.documents[2],canEdit:true});
 assert.match(html,/1[\s ]550[\s ]824,06<\/b><span>руб\. к оплате/);
 assert.match(html,/class="dc-amount-row">[\s\S]*<span class="ob-st ok">В бухгалтерии<\/span>/);
 for(const l of ['СМР с НДС','Оборудование с НДС','Зачёт целевого аванса','Зачёт текущего аванса','К оплате'])assert.match(html,new RegExp(l));
 assert.doesNotMatch(html,/С начала работ/);assert.match(html,/За август/);assert.match(html,/>С накоплением</);
 assert.match(html,/class="dc-check neg">СМР ≠ акты № 22, 23/,'акты 22 и 23 не сходятся со справкой');
 assert.match(html,/data-action="doc-edit"[^>]*>Изменить/);assert.doesNotMatch(html,/Новая версия/);
 assert.match(html,/name="equipment_amount"/);assert.match(html,/name="advance_target_offset"/,'поля справки редактируются той же кнопкой');
 html=documentCard({data,doc:data.documents[2],cum:true});
 assert.match(html,/С начала работ/);assert.doesNotMatch(html,/С начала года/,'с начала года совпадает — колонка не нужна');
 assert.match(html,/10[\s ]803[\s ]040,16/);assert.match(html,/>Без накопления</);
 const ok={...data,versions:data.versions.map(v=>v.id==='v23'?{...v,amount:'1606491.50'}:v),c3aReports:[{...data.c3aReports[0],smr:'1973259.89'}]};
 assert.match(documentCard({data:ok,doc:data.documents[2]}),/СМР = акты № 22, 23 на 1[\s ]973[\s ]259,89 ✓/);
});

test('scan name: object, document, month; subcontractor at the end, version and second file marked; printer name gone',()=>{
 const [a,,c3a]=data.documents;
 assert.equal(scanName({project:'Пружаны',contract:data.contracts[0],doc:a,month:'2026-08-01'}),'Пружаны Акт С-2б №22 за 08.2026.pdf');
 assert.equal(scanName({project:'Пружаны',contract:data.contracts[1],doc:{kind:'c2b',number:'5'},month:'2026-08-01',version:2,index:2,ext:'PDF'}),'Пружаны Акт С-2б №5 за 08.2026 БЕЛТОПМЕД в2 (2).pdf');
 assert.equal(scanName({project:'Пружаны',contract:data.contracts[0],doc:c3a,month:'2026-08-01'}),'Пружаны Справка С-3а №08-2026 за 08.2026.pdf');
 assert.equal(docTitle(c3a),'Справка С-3а № 08/2026');
 assert.deepEqual(sourceOf('Часть объекта: ЦЕХ. Из файла А.xlsx, лист «1»'),{part:'ЦЕХ',from:'из файла А.xlsx, лист «1»',rest:''});
 assert.deepEqual(sourceOf('исправлен объём'),{part:'',from:'',rest:'исправлен объём'});
});
