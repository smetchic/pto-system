import {test} from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml,registerSheetRows,matrixOf,emptyMatrix} from '../src/domain.js';
import ExcelJS from 'exceljs';
test('Excel rows come from the database matrix as is; empty cells stay empty; user content is escaped in HTML',()=>{
 const matrix={columns:[{id:'s',label:'Мегалит · №1',total:'469709.47'}],
  rows:[{kind:'contract',project:'Пружаны',number:'21',total:'1973259.89',own:'1503550.42',subcontract:'469709.47',cells:{s:'469709.47'}},
   {kind:'contract',project:'Пружаны',number:'22',total:'0.10',own:'0.10',subcontract:'0.00',cells:{}},
   {kind:'project',project:'Пружаны',total:'1973259.99',own:'1503550.52',subcontract:'469709.47',cells:{s:'469709.47'}}],
  total:{total:'1973259.99',own:'1503550.52',subcontract:'469709.47',cells:{s:'469709.47'}}};
 const rows=registerSheetRows(matrix,'2026-08');
 assert.deepEqual(rows[1].values,['Объект / договор','Всего, руб.','Своими силами','Субподряд','Мегалит · №1']);
 assert.deepEqual(rows[2].values,['Пружаны · 21 · Итого по договору',1973259.89,1503550.42,469709.47,469709.47]);
 assert.equal(rows[3].values[4],null);
 assert.equal(rows[4].values[0],'Итого по объекту Пружаны');assert.equal(rows[4].bold,true);
 assert.deepEqual(rows.at(-1).values,['Итого',1973259.99,1503550.52,469709.47,469709.47]);
 assert.equal(registerSheetRows([], '2026-08').length,2);assert.equal(matrixOf(null),emptyMatrix);
 assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
});
test('XLSX export preserves numbers and does not turn text into formulas',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Реестр');sheet.addRow(['=HYPERLINK("https://example.com")',120.50]);
 const bytes=await book.xlsx.writeBuffer();const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);assert.equal(loaded.worksheets[0].getCell('A1').type,ExcelJS.ValueType.String);assert.equal(loaded.worksheets[0].getCell('B1').value,120.5);
});
