import {createClient} from '@supabase/supabase-js';
import './c3a-card.css';

const dialog=document.querySelector('#dialog');
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client=createClient(url,key);

const byNumber=(a,b)=>String(a.number||'').localeCompare(String(b.number||''),'ru',{numeric:true});

function addGroup(select,label,rows){
 if(!rows.length)return;
 const group=document.createElement('optgroup');
 group.label=label;
 for(const contract of rows){
  const option=document.createElement('option');
  option.value=contract.id;
  option.textContent=`№ ${contract.number||'—'} · ${contract.party||'Без контрагента'}`;
  group.append(option);
 }
 select.append(group);
}

const labelOf=(form,name)=>form.querySelector(`[name="${name}"]`)?.closest('label')||null;

function setLabelText(label,text){
 if(!label)return;
 const node=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);
 if(node)node.nodeValue=text;
}

function section(title,labels){
 const box=document.createElement('section');
 box.className='c3a-section';
 const h=document.createElement('h3');
 h.textContent=title;
 const grid=document.createElement('div');
 grid.className='c3a-field-grid';
 labels.filter(Boolean).forEach(label=>grid.append(label));
 box.append(h,grid);
 return box;
}

function prepareC3aCard(form){
 if(form.dataset.c3aLayout)return;
 form.dataset.c3aLayout='ready';
 form.classList.add('c3a-form');

 // Служебные поля общей формы документа здесь не нужны: справка создаётся по договору и месяцу.
 ['smr_vat','due_date','note'].forEach(name=>labelOf(form,name)?.remove());

 const content=form.querySelector('.cp-drawer-content');
 const contract=labelOf(form,'contract_id');
 const number=labelOf(form,'number');
 if(content&&contract&&number){
  const main=document.createElement('div');
  main.className='c3a-main-grid';
  main.append(contract,number);
  content.prepend(main);
 }

 const hint=[...form.querySelectorAll('p.muted')].find(p=>p.textContent.includes('СМР с НДС за период не вводится'));
 if(hint){
  hint.className='c3a-auto-box';
  hint.innerHTML='<strong>СМР считается автоматически</strong><span>Сумма СМР и НДС в составе СМР берутся из актов С-2 выбранного договора за этот месяц. После изменения акта создайте новую версию справки.</span>';
 }

 const equipmentAmount=labelOf(form,'equipment_amount');
 const equipmentVat=labelOf(form,'equipment_vat');
 setLabelText(equipmentAmount,'Оборудование с НДС, руб.');
 setLabelText(equipmentVat,'в т.ч. НДС, руб.');
 const equipment=section('Оборудование',[equipmentAmount,equipmentVat]);

 const target=labelOf(form,'advance_target_offset');
 const current=labelOf(form,'advance_current_offset');
 setLabelText(target,'Целевой аванс — зачёт, руб.');
 setLabelText(current,'Текущий аванс — зачёт, руб.');
 const advances=section('Зачёт авансов',[target,current]);

 if(hint){hint.after(equipment);equipment.after(advances);}
 else if(content){content.append(equipment,advances);}
}

async function enhanceC3aContractSelect(){
 if(!dialog?.open)return;
 const form=dialog.querySelector('#modal-form');
 const title=form?.querySelector('.cp-drawer-head h2')?.textContent?.trim();
 if(title!=='Справка С-3а')return;
 prepareC3aCard(form);
 const select=form.querySelector('select[name="contract_id"]');
 if(!select||select.dataset.c3aContracts)return;
 select.dataset.c3aContracts='loading';
 const selected=select.value;
 try{
  const {data:base,error:baseError}=await client.from('pto_contract_list').select('id,project_id').eq('id',selected).maybeSingle();
  if(baseError)throw baseError;
  if(!base?.project_id)throw new Error('Не найден объект договора');
  const {data:contracts,error}=await client.from('pto_contract_list').select('id,project_id,number,party,direction').eq('project_id',base.project_id);
  if(error)throw error;
  if(!select.isConnected||dialog.querySelector('#modal-form')!==form)return;
  const outgoing=(contracts||[]).filter(c=>c.direction==='outgoing').sort(byNumber);
  const incoming=(contracts||[]).filter(c=>c.direction==='incoming').sort(byNumber);
  select.replaceChildren();
  addGroup(select,'Справка СУ-22 заказчику',outgoing);
  addGroup(select,'Справка субподрядчика',incoming);
  if([...select.options].some(o=>o.value===selected))select.value=selected;
  const label=select.closest('label');
  if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.nodeValue='Чья справка / договор';
  select.dataset.c3aContracts='ready';
 }catch{
  if(select.isConnected)delete select.dataset.c3aContracts;
 }
}

const observer=new MutationObserver(()=>{void enhanceC3aContractSelect();});
if(dialog){
 observer.observe(dialog,{childList:true,subtree:true});
 dialog.addEventListener('toggle',()=>{void enhanceC3aContractSelect();});
}
