import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/c3a-contract-options.js',import.meta.url),'utf8');

test('C-3a form removes generic document fields',()=>{
  assert.match(source,/\['smr_vat','due_date','note'\]/);
  assert.match(source,/СМР считается автоматически/);
  assert.match(source,/Оборудование/);
  assert.match(source,/Зачёт авансов/);
});
