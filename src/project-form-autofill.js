const dialog=document.querySelector('#dialog');

function disableProjectAutofill(){
  if(!dialog?.open)return;
  const title=dialog.querySelector('h2')?.textContent?.trim();
  if(title!=='Новый объект')return;
  const form=dialog.querySelector('#modal-form');
  if(!form||form.dataset.projectAutofillFixed==='true')return;
  form.dataset.projectAutofillFixed='true';
  form.setAttribute('autocomplete','off');

  const fields={
    name:'project_short_name',
    full_name:'project_full_name',
    address:'project_address'
  };

  for(const [originalName,temporaryName] of Object.entries(fields)){
    const input=form.querySelector(`[name="${originalName}"]`);
    if(!input)continue;
    input.name=temporaryName;
    input.setAttribute('autocomplete','off');
    input.setAttribute('autocorrect','off');
    input.setAttribute('spellcheck','false');

    const hidden=document.createElement('input');
    hidden.type='hidden';
    hidden.name=originalName;
    hidden.value=input.value;
    input.addEventListener('input',()=>{hidden.value=input.value;});
    form.appendChild(hidden);
  }
}

const observer=new MutationObserver(disableProjectAutofill);
observer.observe(dialog,{childList:true,subtree:true});
dialog.addEventListener('toggle',disableProjectAutofill);
