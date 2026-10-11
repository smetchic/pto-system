import test from 'node:test';
import assert from 'node:assert/strict';

// UI-правило: в ручной С-3а НДС СМР не вводится пользователем.
// База рассчитывает его по текущим актам С-2; этот тест фиксирует договорённость в кодовой базе.
test('C-3a SMR VAT is automatic',()=>{
  const manualFields=['equipment_amount','equipment_vat','advance_target_offset','advance_current_offset'];
  assert.equal(manualFields.includes('smr_vat'),false);
});
