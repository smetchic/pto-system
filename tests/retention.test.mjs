import test from 'node:test';
import assert from 'node:assert/strict';
import {documentCard,retentionNote} from '../src/document-card.js';
import {retentionBlock} from '../src/contracts.js';
import {retentionReturns} from '../src/today.js';
import {retentionText} from '../src/sub-card.js';
import {genRows} from '../src/registers.js';

const report={version_id:'vs',document_id:'sp',project_id:'p',contract_id:'c',is_current:true,smr:'1200.00',smr_vat:'200.00',equipment:'100.00',equipment_vat:'0',target_offset:'0',current_offset:'50.00',
 retention_calc:'50.00',retention_manual:null,retention:'50.00',to_pay:'1200.00'};
const data={projects:[{id:'p',name:'Объект',commissioned_on:'2027-06-30'}],periods:[{id:'per',project_id:'p',month:'2027-02-01'}],
 contracts:[{id:'c',number:'У-1',party:'Заказчик',direction:'outgoing',project_id:'p'},{id:'s',number:'УС-1',party:'Кровля',direction:'incoming',project_id:'p'}],
 documents:[{id:'sp',kind:'c3a',number:'1',contract_id:'c',project_id:'p',period_id:'per',current_version:'vs'}],
 versions:[{id:'vs',document_id:'sp',version:1,amount:'1200.00'}],c3aReports:[report],
 retentionSummary:[{contract_id:'c',project_id:'p',direction:'outgoing',percent:'5.00',base:'net',first_share:'50.00',first_years:1,final_years:2,retained:'50.00',commissioned_on:'2027-06-30',first_due:'2028-06-30',final_due:'2029-06-30',first_amount:'25.00',final_amount:'25.00'},
  {contract_id:'s',project_id:'p',direction:'incoming',percent:'5.00',base:'gross',first_share:'50.00',first_years:1,final_years:2,retained:'12.00',commissioned_on:'2027-06-30',first_due:'2028-06-30',final_due:'2029-06-30',first_amount:'6.00',final_amount:'6.00'}],
 retention:[{side:'sub',contract_id:'s',period_id:'per',percent:'5.00',base:'gross',calc:'12.00',manual:null,amount:'12.00'}]};

test('C-3a card: retention row before «к оплате» with the contract percent; manual value differing from the calculation is a warning',()=>{
 const html=documentCard({data,doc:data.documents[0]});
 assert.match(html,/Гарантийное удержание 5 %<\/td>[\s\S]*50,00[\s\S]*К оплате/);
 assert.equal(retentionNote(report,data.retentionSummary[0]),'');
 const manual={...report,retention_manual:'48.00',retention:'48.00'};
 assert.match(retentionNote(manual,data.retentionSummary[0]),/dc-warn[^>]*>Удержание введено вручную: 48,00, по расчёту 50,00 \(5 % от СМР без НДС\) — проверьте/);
 assert.match(retentionNote({...report,retention_manual:'50.00'},null),/совпадает с расчётом ✓/);
 // Договор без удержания — строки нет.
 const none=documentCard({data:{...data,retentionSummary:[],c3aReports:[{...report,retention:'0.00',retention_calc:'0.00'}]},doc:data.documents[0]});
 assert.doesNotMatch(none,/Гарантийное удержание/);
});

test('contract card: retention terms, retained amount and return dates from commissioning',()=>{
 const html=retentionBlock(data,data.contracts[0],data.retentionSummary[0]);
 assert.match(html,/5 % от СМР без НДС · удерживает заказчик/);
 assert.match(html,/Удержано[\s\S]*<b>50,00<\/b>/);
 assert.match(html,/Возврат 50 % через 1 г\.[\s\S]*до 30\.06\.2028[\s\S]*25,00/);
 assert.match(html,/Остаток через 2 г\.[\s\S]*до 30\.06\.2029/);
 assert.match(retentionBlock(data,data.contracts[1],data.retentionSummary[1]),/удерживаем мы у субподрядчика/);
 const noDate={...data,projects:[{id:'p',name:'Объект'}]};
 assert.match(retentionBlock(noDate,data.contracts[0],{...data.retentionSummary[0],first_due:null,final_due:null}),/после ввода объекта[\s\S]*Дата ввода объекта не указана/);
 assert.equal(retentionBlock(data,data.contracts[0],null),'','без процента и без удержанного блока нет');
});

test('deadlines: a row per return, sorted by date; sub card shows the sub retention; register deducts it',()=>{
 const r=retentionReturns(data);
 assert.deepEqual(r.map(x=>[x.date,x.amount]),[['2028-06-30','25.00'],['2028-06-30','6.00'],['2029-06-30','25.00'],['2029-06-30','6.00']]);
 assert.match(r[1].what,/вернуть субподрядчику/);assert.match(r[0].what,/вернёт заказчик/);
 assert.equal(retentionText(data,data.contracts[1],{id:'per'}),'12,00 · 5 % от СМР с НДС');
 assert.match(retentionText({...data,retention:[{...data.retention[0],manual:'11.00',amount:'11.00'}]},data.contracts[1],{id:'per'}),/11,00 · вручную, по расчёту 12,00/);
 const g=genRows({...data,matrix:{rows:[]},workflows:[],subMonth:[]},'p','2027-02');
 assert.deepEqual([g.our.month.off,g.our.month.pay],[100,1200],'вычеты = зачёт 50 + удержание 50; к оплате 1200');
});
