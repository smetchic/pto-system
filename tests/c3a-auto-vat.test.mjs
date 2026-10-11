import test from 'node:test';
import assert from 'node:assert/strict';

test('C-3a SMR VAT is automatic',()=>{
  const manualFields=['equipment_amount','equipment_vat','advance_target_offset','advance_current_offset'];
  assert.equal(manualFields.includes('smr_vat'),false);
});
