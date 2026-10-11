import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('C-2b is the default manual act form and generic fields are removed',()=>{
 const src=fs.readFileSync(new URL('../src/c2-form-options.js',import.meta.url),'utf8');
 assert.match(src,/kind\.value='c2b'/);
 assert.match(src,/removeField\(form,'due_date'\)/);
 assert.match(src,/removeField\(form,'note'\)/);
 assert.match(src,/label\.hidden=!checkbox\.checked/);
});
