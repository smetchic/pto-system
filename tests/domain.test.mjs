import {test} from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml,registerMatrix} from '../src/domain.js';
import ExcelJS from 'exceljs';
test('register separates incoming cost and outgoing allocation, and escapes user content',()=>{
 const result=registerMatrix([{period_id:'p',project_id:'o',contract_id:'c',total:'100.10',subcontract:'30.05'}],[{id:'o',name:'Объект'}],[{id:'c',direction:'outgoing',party:'Заказчик'},{id:'s',direction:'incoming',party:'Субподрядчик'}],[{id:'d',contract_id:'c'},{id:'i',contract_id:'s'}],[{period_id:'p',outgoing_document:'d',incoming_document:'i',amount:'30.05'}]);
 assert.equal(result.rows[0].split['Субподрядчик'],30.05);assert.ok(Math.abs(result.rows[0].own-70.05)<0.000001);assert.deepEqual(result.subs,['Субподрядчик']);assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
});
test('XLSX export preserves numbers and does not turn text into formulas',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Реестр');sheet.addRow(['=HYPERLINK("https://example.com")',120.50]);
 const bytes=await book.xlsx.writeBuffer();const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);assert.equal(loaded.worksheets[0].getCell('A1').type,ExcelJS.ValueType.String);assert.equal(loaded.worksheets[0].getCell('B1').value,120.5);
});
