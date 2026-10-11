const dialog=document.querySelector('#dialog');

function setLabelText(control,text){
 const label=control?.closest('label');
 if(!label)return;
 const node=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
 if(node)node.nodeValue=text;
}

function removeField(form,name){
 const el=form.querySelector(`[name="${name}"]`);
 el?.closest('label')?.remove();
}

function setupCorrection(form){
 const checkbox=form.querySelector('input[name="correction"]');
 const corrects=form.querySelector('input[name="corrects"]');
 const label=corrects?.closest('label');
 if(!checkbox||!label)return;
 label.hidden=!checkbox.checked;
 checkbox.addEventListener('change',()=>{
  label.hidden=!checkbox.checked;
  if(!checkbox.checked)corrects.value='';
 });
}

function simplifyActForm(){
 if(!dialog?.open)return;
 const form=dialog.querySelector('#modal-form');
 const title=form?.querySelector('.cp-drawer-head h2')?.textContent?.trim();
 if(title!=='Новый акт'||form.dataset.c2Ready)return;
 const kind=form.querySelector('select[name="kind"]');
 if(!kind)return;
 form.dataset.c2Ready='1';

 // С-2б — основной способ ручного ввода. С-2а остаётся дополнительным вариантом.
 const c2b=[...kind.options].find(o=>o.value==='c2b');
 const c2a=[...kind.options].find(o=>o.value==='c2a');
 if(c2b&&c2a){
  kind.replaceChildren(c2b,c2a);
  kind.value='c2b';
 }
 setLabelText(kind,'Форма акта');

 const contract=form.querySelector('select[name="contract_id"]');
 setLabelText(contract,'Чей акт / договор');

 // Срок и свободное «Содержание / основание» относятся к маршруту/карточке,
 // а не к первичному вводу акта.
 removeField(form,'due_date');
 removeField(form,'note');

 setupCorrection(form);
}

const observer=new MutationObserver(simplifyActForm);
if(dialog){
 observer.observe(dialog,{childList:true,subtree:true});
 dialog.addEventListener('toggle',simplifyActForm);
}
