import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMoney,moneyText,moneyLive,plainMoney,vatInfo} from '../src/domain.js';
import {folderPaths,matchPaths,pickListHtml} from '../src/folder-pick.js';

test('money fields: thousands separator when typing and showing; plain number to the server',()=>{
 assert.equal(moneyText('53958885.69'),'53 958 885,69');assert.equal(moneyText(-22361.2),'-22 361,20');assert.equal(moneyText(''),'');
 assert.equal(parseMoney('53 958 885,69'),53958885.69);assert.equal(parseMoney('1 000.5'),1000.5);assert.equal(parseMoney('abc'),null);
 assert.equal(moneyLive('1234567,8'),'1 234 567,8');assert.equal(moneyLive('12345.'),'12 345,');
 assert.equal(plainMoney('1 000,50'),'1000.5');
});

test('VAT rate is computed from the amount and VAT; not 20 % is flagged',()=>{
 assert.deepEqual(vatInfo('53 958 885,69','8993147.62'),{rate:20,text:'20 %',ok:true});
 assert.deepEqual(vatInfo('1000','0'),{rate:0,text:'без НДС',ok:true});
 assert.equal(vatInfo('1000','100').ok,false);assert.equal(vatInfo('',''),null);
});

test('file pick: paths from the chosen folder, contract folder first',()=>{
 const paths=folderPaths([{webkitRelativePath:'ДОГОВОРА/ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД/ДС 3.pdf'},{webkitRelativePath:'ДОГОВОРА/ПАРКИНГ/ДС 3.pdf'},{webkitRelativePath:'ДОГОВОРА/ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД/Договор.pdf'}]);
 assert.deepEqual([...paths].sort(),['ПАРКИНГ/ДС 3.pdf','ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД/ДС 3.pdf','ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД/Договор.pdf'].sort(),'имя выбранной папки отброшено');
 assert.deepEqual(matchPaths(paths,'ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД','дс'),['ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД/ДС 3.pdf','ПАРКИНГ/ДС 3.pdf']);
 assert.match(pickListHtml(paths,'',''),/data-action="pick-path" data-id="ПАРКИНГ\/ДС 3.pdf"/);
});
