import {createClient} from '@supabase/supabase-js';

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

function simplifyC3aFields(form){
 const vat=form.querySelector('input[name="smr_vat"]');
 if(vat)vat.closest('label')?.remove();
 const hint=[...form.querySelectorAll('p.muted')].find(p=>p.textContent.includes('СМР с НДС за период не вводится'));
 if(hint)hint.textContent='СМР с НДС и НДС в составе СМР считаются автоматически по актам С-2 этого договора за месяц (текущие версии). После изменения акта создайте новую версию справки. «К оплате» и накопительные колонки считаются автоматически.';
}

async function enhanceC3aContractSelect(){
 if(!dialog?.open)return;
 const form=dialog.querySelector('#modal-form');
 const title=form?.querySelector('.cp-drawer-head h2')?.textContent?.trim();
 if(title!=='Справка С-3а')return;
 simplifyC3aFields(form);
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
