import {createClient} from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client=url&&key?createClient(url,key):null;
const formOf=el=>el?.closest?.('#document-card-form');
const clean=v=>String(v??'').trim();
const num=v=>{const s=clean(v).replace(/[\s\u00a0]/g,'').replace(',','.');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;};
const sameNum=(a,b)=>{const x=num(a),y=num(b);return x===null&&y===null||x!==null&&y!==null&&Math.abs(x-y)<0.005;};
const parse=(text,fallback={})=>{try{return JSON.parse(text||'')||fallback;}catch{return fallback;}};
const rpc=async payload=>{if(!client)throw Error('Подключение к базе не настроено');const {data,error}=await client.rpc('pto_command',{request_id:crypto.randomUUID(),payload});if(error)throw error;return data;};
const toast=message=>{const t=document.querySelector('#toast');if(!t)return;t.textContent=message;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,5000);};
const refresh=()=>{const b=document.createElement('button');b.type='button';b.hidden=true;b.dataset.action='refresh';document.body.append(b);b.click();setTimeout(()=>b.remove(),0);};

function editOn(form){
 form.classList.add('is-editing');form.dataset.editing='';
 const dialog=form.closest('dialog');if(dialog)delete dialog.dataset.dirty;
 requestAnimationFrame(()=>form.querySelector('.dc-edit-only input,.dc-edit-only select,.dc-edit-only textarea')?.focus());
}
function editOff(form,reset=true){
 if(reset)form.reset();form.classList.remove('is-editing');delete form.dataset.editing;
 const dialog=form.closest('dialog');if(dialog)delete dialog.dataset.dirty;
}

async function saveCard(form){
 const d=Object.fromEntries(new FormData(form)),kind=form.dataset.kind,id=form.dataset.documentId;
 const periodId=form.dataset.periodId,revision=Number(form.dataset.periodRevision),versionNote=form.dataset.versionNote||'';
 const oldVersion=parse(form.dataset.versionState),oldMark=parse(form.dataset.markState);
 const act=kind==='c2a'||kind==='c2b',c3a=kind==='c3a';
 let versionChanged=false,markChanged=false;

 if(act){
  versionChanged=!sameNum(d.amount,oldVersion.amount);
  if(versionChanged)await rpc({op:'revise',period_id:periodId,expected_revision:revision,document_id:id,amount:clean(d.amount),note:versionNote,reason:'Изменено в карточке'});

  const hasPartId=form.elements.part_id;
  const mark={
   part_id:hasPartId?(clean(d.part_id)||null):null,
   part:hasPartId?null:(clean(d.part)||null),
   tn_status:clean(d.tn_status)||null,
   original:clean(d.original)||null,
   note:clean(d.mark_note)
  };
  markChanged=(hasPartId?clean(mark.part_id)!==clean(oldMark.part_id):clean(mark.part)!==clean(oldMark.part))||
   clean(mark.tn_status)!==clean(oldMark.tn_status)||clean(mark.original)!==clean(oldMark.original)||clean(mark.note)!==clean(oldMark.note);
  if(markChanged)await rpc({op:'set_document_mark',document_id:id,...mark});
 }

 if(c3a){
  const fields=['smr_vat','equipment_amount','equipment_vat','advance_target_offset','advance_current_offset'];
  versionChanged=fields.some(k=>!sameNum(d[k],oldVersion[k]));
  if(versionChanged)await rpc({op:'revise',period_id:periodId,expected_revision:revision,document_id:id,
   ...Object.fromEntries(fields.map(k=>[k,clean(d[k])||null])),note:versionNote,reason:'Изменено в карточке'});
 }

 if(!versionChanged&&!markChanged){editOff(form);return toast('Изменений нет');}
 const dialog=form.closest('dialog');if(dialog){delete dialog.dataset.dirty;dialog.close();}
 refresh();toast('Сохранено');
}

document.addEventListener('click',ev=>{
 const b=ev.target.closest?.('[data-action="doc-edit"],[data-action="doc-edit-cancel"]');if(!b)return;
 const form=formOf(b);if(!form)return;
 ev.preventDefault();ev.stopImmediatePropagation();
 if(b.dataset.action==='doc-edit')editOn(form);else editOff(form);
},true);

document.addEventListener('submit',async ev=>{
 const form=ev.target.closest?.('#document-card-form');if(!form||!form.classList.contains('is-editing'))return;
 ev.preventDefault();ev.stopImmediatePropagation();
 const submit=ev.submitter;const error=form.querySelector('#contract-error');if(error)error.textContent='';if(submit)submit.disabled=true;
 try{await saveCard(form);}catch(err){if(error)error.textContent=err?.message||String(err);else toast(err?.message||String(err));}
 finally{if(submit&&submit.isConnected)submit.disabled=false;}
},true);
