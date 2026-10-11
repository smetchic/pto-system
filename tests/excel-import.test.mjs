import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSheets,matchContract,importCard,importPlan,createPayload,correctsOf,cyr,monthOf} from '../src/excel-import.js';

// Лист как в книге исполнителя: подписи и значения в соседних ячейках, латинские H и C в словах, корректировка в заголовке.
const sheet=({no,title='',month='за СЕHТЯБРЬ 2026',total,vat})=>{const g=[];
 g[0]=[null,'Форма С-2б'];
 g[1]=['Заказчик','ОАО «Молочный комбинат»',null,'УНП','200027027'];
 g[3]=['Генподрядчик','Трест',null,'УНП',193913288];
 g[5]=['Субподрядчик','СУ-22',null,'УНП','191426884'];
 g[7]=['Исполнитель','ООО "БЕЛТОПМЕД"',null,'УНП','190510032'];
 g[11]=['Часть объекта','Часть объекта','2 ЦЕХ (ПРИСТРОЙКА)'];
 g[13]=['Договор субподряда','от 07.05.2026 № 21-03/2026'];
 g[18]=[`СДАЧИ - ПРИЕМКИ ВЫПОЛНЕННЫХ СТРОИТЕЛЬНЫХ РАБОТ № ${no}${title}`];
 g[19]=[month];
 g[23]=['№пп','Обоснование','Наименование работ','Ед.изм.','Количество','Стоимость','Стоимость','Стоимость'];
 g[40]=['Всего стоимость работ по неизменой договорной цене','Всего стоимость работ по неизменой договорной цене',null,null,null,'Х',0,total];
 g[44]=['Сумма HДC по ставке 20 %',null,null,null,null,'Х',0,vat];
 for(let r=0;r<g.length;r++)g[r]=g[r]||[];return g;};

test('excel: every sheet is an act; Latin letters inside Russian words; a minus act is a correction with what it corrects',()=>{
 assert.equal(cyr('СЕHТЯБРЬ HДC USD'),'СЕНТЯБРЬ НДС USD');
 assert.equal(monthOf('за СЕHТЯБРЬ месяц 2026'),'2026-09');
 assert.equal(correctsOf('№ 4.1 (корректировка акта сдачи-приемки выполненных строительных работ №1 формы С-2б за ИЮНЬ 2026 г.)'),'акт №1 за июнь 2026');
 const docs=parseSheets([
  {name:'на минус акт 1_июнь 26',grid:sheet({no:'4.1',title:' (корректировка акта сдачи-приемки №1 формы С-2б за ИЮНЬ 2026 г.)',total:-22361.21,vat:-3726.87})},
  {name:'Акт С2б №4.4',grid:sheet({no:'4.4',month:'за СЕHТЯБРЬ месяц 2026',total:480878.34,vat:80146.39})},
  {name:'Ведомость',grid:[['что-то другое']]},
  {name:'Без пометки',grid:sheet({no:'4.9',total:0,vat:0})}]);
 assert.equal(docs.length,3,'лист без формы пропускается');
 const [a,b,c]=docs;
 assert.deepEqual([a.sheet,a.number,a.month,a.amount,a.vat,a.correction,a.corrects,a.contract,a.part],
  ['на минус акт 1_июнь 26','4.1','2026-09',-22361.21,-3726.87,true,'акт №1 за июнь 2026','21-03/2026','2 ЦЕХ (ПРИСТРОЙКА)']);
 assert.deepEqual([b.number,b.month,b.amount,b.vat,b.correction,b.problems],['4.4','2026-09',480878.34,80146.39,false,[]]);
 assert.deepEqual([c.correction,c.corrects],[true,'корректировка'],'ноль — тоже корректировка, даже без слова в заголовке');
});

test('excel: contract by number from the file, then by UNP; the import card and payloads carry the correction mark',()=>{
 const data={contracts:[{id:'out',project_id:'p',direction:'outgoing',number:'21',party:'Трест'},{id:'sub',project_id:'p',direction:'incoming',number:'21-03/2026',party:'БЕЛТОПМЕД',counterparty_id:'bt'},
  {id:'sub2',project_id:'p',direction:'incoming',number:'5',party:'БЕЛТОПМЕД кладка',counterparty_id:'bt'}],parties:[{id:'bt',unp:'190510032'}]};
 const docs=parseSheets([{name:'k',grid:sheet({no:'4.1',title:' (корректировка акта №1 за ИЮНЬ 2026 г.)',total:-10,vat:-1.67})},{name:'p',grid:sheet({no:'4.4',total:100,vat:16.67})}]);
 assert.equal(matchContract(data,'p',docs[0]),'sub','номер договора из файла');
 assert.equal(matchContract(data,'p',{...docs[0],contract:''}),'','у контрагента два договора — выбирает пользователь');
 const files=docs.map(doc=>({name:'книга.xlsx',doc,contract:'sub'}));
 const existing=[{contract_id:'sub',month:'2026-09-01',kind:'c2b',number:'4.4'}];
 const html=importCard({data,projectId:'p',files,existing,canJump:true});
 assert.match(html,/Корректировка/);assert.match(html,/Уже внесён/);assert.match(html,/name="to_step"/);
 assert.doesNotMatch(importCard({data,projectId:'p',files}),/name="to_step"/,'шаг сразу — только начальнику ПТО за прошлые месяцы');
 const form=new FormData();form.append('pick','0');form.append('pick','1');
 for(const i of [0,1]){form.append('number-'+i,docs[i].number);form.append('contract-'+i,'sub');}
 form.append('corrects-0','акт №1 за июнь 2026');
 const plan=importPlan(files,form,existing);
 assert.deepEqual(plan.map(f=>f.number),['4.1'],'уже внесённый пропускается');
 assert.deepEqual(createPayload(plan[0]),{op:'create_document',contract_id:'sub',kind:'c2b',number:'4.1',amount:'-10',correction:true,corrects:'акт №1 за июнь 2026',
  note:'Часть объекта: 2 ЦЕХ (ПРИСТРОЙКА). Из файла книга.xlsx, лист «k»'});
 assert.equal(createPayload({...files[1],number:'4.4'}).correction,undefined);
});
