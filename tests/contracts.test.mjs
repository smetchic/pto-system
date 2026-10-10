import test from 'node:test';
import assert from 'node:assert/strict';
import {contractsList,contractCard,newContractCard,newContractPayload,addendumStatusCard,contractFinished,contractGroup,partCard} from '../src/contracts.js';

const today='2026-10-09';
function fixture(role='engineer'){
 const profile={id:'u1',display_name:'Надя',role};
 const data={
  projects:[{id:'p1',name:'Пружаны'},{id:'p2',name:'Паркинг <b>'}],
  profiles:[profile,{id:'u2',display_name:'Вика',role:'engineer'}],
  memberships:[{project_id:'p1',user_id:'u1'},{project_id:'p2',user_id:'u2'}],
  parties:[{id:'cp1',short_name:'ОАО «Трест №1»',unp:'100000001'},{id:'cp2',short_name:'ООО «Мегалит»',unp:'200000002'}],
  contracts:[
   {id:'c1',project_id:'p1',number:'21',contract_date:'2026-02-01',party:'ОАО «Трест №1»',counterparty_id:'cp1',direction:'outgoing',our_role:'subcontractor',counterparty_role:'general_contractor',
    initial_amount:'12410000.00',vat_amount:'1836000.00',vat_rate:'20',current_amount:'13166000.00',current_vat_amount:'1836000.00',amount_addendum_number:'4',amount_addendum_date:'2026-08-12',
    work_start_date:'2026-02-15',work_end_date:'2026-11-30',current_end_date:'2026-12-30',term_addendum_number:'3',subject:'Жилой дом'},
   {id:'c2',project_id:'p1',number:'17-С',contract_date:'2026-03-01',party:'ООО «Мегалит»',counterparty_id:'cp2',direction:'incoming',our_role:'customer',counterparty_role:'subcontractor',
    current_amount:'3120000.00',work_start_date:'2026-03-05',current_end_date:'2026-09-30'},
   {id:'c3',project_id:'p2',number:'9',party:'Старый заказчик',direction:'outgoing',our_role:'contractor',counterparty_role:'customer',current_amount:'100.00',current_end_date:'2025-06-30'},
   {id:'c4',project_id:'p2',number:'П-1',party:'Поставщик',direction:'incoming',our_role:'buyer',counterparty_role:'supplier',current_amount:null},
  ],
  addenda:[{id:'a5',contract_id:'c1',number:'5',agreement_date:'2026-10-01',status:'draft',amount_after:'13940000.00'},
   {id:'a4',contract_id:'c1',number:'4',agreement_date:'2026-08-12',status:'signed',amount_after:'13166000.00'}],
  workflows:[{id:'w1',template_code:'sub_claim',contract_id:'c2',project_id:'p1',step_code:'tn',step_label:'У технадзора',open_notes:[]}],
  skips:[],
 };
 return {data,profile,ui:{month:'2026-10'}};
}

test('contracts: groups, finished vs active, filters by kind and object, search keeps state',()=>{
 const {data,profile,ui}=fixture();
 assert.equal(contractGroup(data.contracts[0]),'out');assert.equal(contractGroup(data.contracts[1]),'in');assert.equal(contractGroup(data.contracts[3]),'other');
 assert.equal(contractFinished(data,data.contracts[2],today),true,'срок прошёл, комплекта нет');
 assert.equal(contractFinished(data,data.contracts[1],today),false,'срок истёк, но комплект месяца идёт');
 let html=contractsList({data,ui,profile,today});
 assert.match(html,/С заказчиком<span>1/);assert.match(html,/Субподряда<span>1/);assert.match(html,/Поставка и услуги/);
 assert.doesNotMatch(html,/data-id="c3"/,'по умолчанию только действующие');
 assert.match(html,/ДС № 5 в работе/);assert.match(html,/Истёк 30\.09\.2026/);assert.match(html,/У технадзора/);
 assert.match(html,/Паркинг &lt;b&gt;/);assert.match(html,/data-action="new-contract"/);
 assert.match(html,/13[\s ]166[\s ]000,00/);
 html=contractsList({data,ui:{...ui,contractState:'done'},profile,today});assert.match(html,/data-id="c3"/);assert.doesNotMatch(html,/data-id="c1"/);
 html=contractsList({data,ui:{...ui,contractKind:'in'},profile,today});assert.doesNotMatch(html,/data-id="c1"/);assert.match(html,/data-id="c2"/);
 html=contractsList({data,ui:{...ui,contractObject:'p2'},profile,today});assert.doesNotMatch(html,/data-id="c1"/);
 html=contractsList({data,ui:{...ui,contractQuery:'мегалит'},profile,today});
 assert.match(html,/hidden data-action="contract" data-id="c1"/);assert.doesNotMatch(html,/hidden data-action="contract" data-id="c2"/);assert.match(html,/value="мегалит"/);
 assert.doesNotMatch(contractsList({data,ui,profile:{...profile,role:'director'},today}),/data-action="new-contract"/,'руководитель не добавляет');
});

test('contract card: amount by addendum, marks, party link; edit only for the object engineer and keeps all terms',()=>{
 const {data}=fixture();const c=data.contracts[0];
 let html=contractCard({data,contract:c,canEdit:true,today});
 assert.match(html,/Закрыть ×/);assert.match(html,/по ДС № 4 от 12\.08\.2026/);assert.match(html,/Действует до 30\.12\.2026/);
 assert.match(html,/ДС № 5 в работе, в цене не учтено/);assert.match(html,/data-action="party" data-id="cp1"/);
 assert.match(html,/data-action="sign-addendum" data-id="a5"/);assert.match(html,/data-action="edit-contract"/);assert.match(html,/Надя/);
 assert.doesNotMatch(html,/data-editing/,'просмотр закрывается кликом мимо');
 const ro=contractCard({data,contract:c,canEdit:false,today});
 assert.doesNotMatch(ro,/edit-contract|sign-addendum|new-addendum/);
 html=contractCard({data,contract:c,canEdit:true,editing:true,today});
 for(const k of ['number','contract_date','subject','parent_contract_id','initial_amount','vat_rate','vat_amount','smr_amount','smr_vat_amount','pnr_amount','pnr_vat_amount','equipment_amount','equipment_vat_amount','work_start_date','work_end_date','contract_id'])
  assert.match(html,new RegExp(`name="${k}"`),k);
 assert.match(html,/data-editing/);assert.match(html,/value="12410000\.00"/);
 assert.match(contractCard({data,contract:data.contracts[1],canEdit:true,today}),/Срок истёк 30\.09\.2026, работы продолжаются/);
 assert.match(contractCard({data,contract:data.contracts[3],canEdit:true,today}),/Цена не указана/);
});

test('new contract and addendum status forms',()=>{
 const {data,profile}=fixture();
 const html=newContractCard({data,profile,projectId:'p1'});
 assert.match(html,/<option value="p1" selected>Пружаны/);assert.doesNotMatch(html,/value="p2"/,'инженер создаёт только на своём объекте');
 const f=new FormData();for(const [k,v] of Object.entries({project_id:'p1',kind:'customer:subcontractor',counterparty_id:'cp2',number:' 30-С ',contract_date:'',subject:''}))f.append(k,v);
 assert.deepEqual(newContractPayload(f),{op:'create_contract',project_id:'p1',counterparty_id:'cp2',number:' 30-С ',contract_date:'',subject:'',our_role:'customer',counterparty_role:'subcontractor'});
 const cancel=addendumStatusCard({data,contract:data.contracts[0],addendum:data.addenda[0],status:'cancelled'});
 assert.match(cancel,/name="reason"/);assert.match(cancel,/name="status" value="cancelled"/);
});

test('contract card: parts of the contract with their own VAT; adding and editing only for those who edit',()=>{
 const {data}=fixture();const c=data.contracts[0];
 assert.match(contractCard({data,contract:c,canEdit:true,today}),/data-action="new-part"[^]*Одна часть: акты и справка С-3а на весь договор/);
 assert.doesNotMatch(contractCard({data,contract:c,canEdit:false,today}),/Части договора/,'без частей руководитель блок не видит');
 data.contractParts=[{id:'pt2',contract_id:c.id,name:'Встроенные помещения',vat_rate:'0.00',amount:null,ordinal:2,active:true},{id:'pt1',contract_id:c.id,name:'Жилая часть',vat_rate:'20.00',amount:'1000000.00',ordinal:1,active:true}];
 const html=contractCard({data,contract:c,canEdit:true,today});
 assert.match(html,/Жилая часть<\/span><span class="ct-line-r ct-one"><small>НДС 20 %<\/small>1[\s ]000[\s ]000,00[^]*Встроенные помещения<\/span><span class="ct-line-r ct-one"><small>без НДС/);
 assert.match(html,/data-action="edit-part" data-id="pt1"/);
 assert.doesNotMatch(contractCard({data,contract:c,canEdit:false,today}),/edit-part|new-part/);
 const form=partCard({data,contract:c,part:data.contractParts[1]});
 assert.match(form,/name="part_id" value="pt1"/);assert.match(form,/name="vat_rate"[^>]*value="20.00"/);assert.match(form,/data-editing/);
});
