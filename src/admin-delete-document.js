import {createClient} from '@supabase/supabase-js';
import './admin-delete-document.css';

const dialog=document.querySelector('#dialog');
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client=createClient(url,key);
let roleCache;

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function currentRole(){
 if(roleCache!==undefined)return roleCache;
 const {data:{session}}=await client.auth.getSession();
 if(!session)return roleCache=null;
 const {data,error}=await client.from('pto_profiles').select('role').eq('id',session.user.id).maybeSingle();
 if(error)return roleCache=null;
 return roleCache=data?.role||null;
}
client.auth.onAuthStateChange(()=>{roleCache=undefined;});

async function injectDeleteButton(){
 if(!dialog?.open)return;
 const shell=dialog.querySelector('.dc');
 if(!shell||shell.querySelector('[data-admin-delete-document]'))return;
 if(await currentRole()!=='head')return;
 const revise=shell.querySelector('[data-action="revise"][data-id]');
 if(!revise)return; // закрытый месяц или документ без права редактирования
 const id=revise.dataset.id;
 const {data:doc,error}=await client.from('pto_documents').select('id,kind,number,period_id').eq('id',id).maybeSingle();
 if(error||!doc||!['c2a','c2b','c3a'].includes(doc.kind))return;
 const {data:period}=await client.from('pto_periods').select('status').eq('id',doc.period_id).maybeSingle();
 if(period?.status!=='open')return;
 const foot=shell.querySelector('.cp-drawer-foot');
 if(!foot||foot.querySelector('[data-admin-delete-document]'))return;
 const button=document.createElement('button');
 button.type='button';
 button.className='adm-delete-document';
 button.dataset.adminDeleteDocument=id;
 button.textContent='Удалить документ';
 button.title='Только для начальника ПТО: удалить ошибочно внесённый документ';
 button.addEventListener('click',()=>openDeleteForm(doc));
 foot.append(button);
}

function openDeleteForm(doc){
 const title=doc.kind==='c3a'?'Справка С-3а':doc.kind==='c2a'?'Акт С-2а':'Акт С-2б';
 dialog.className='cp-drawer';
 dialog.innerHTML=`<form id="admin-delete-document-form" class="cp-drawer-shell ob" autocomplete="off">
  <div class="cp-drawer-head"><button type="button" class="cp-drawer-close" data-action="dismiss">Закрыть ×</button><h2>Удалить ${esc(title)} № ${esc(doc.number)}</h2></div>
  <div class="cp-drawer-content md-body">
   <div class="adm-delete-warning"><b>Удаление только для ошибочно внесённого документа.</b><p>Документ исчезнет из комплекта и расчётов. Месяц потребует повторной проверки. В журнале останутся причина удаления и снимок удалённых данных.</p></div>
   <label>Причина удаления<textarea name="reason" required minlength="5" autofocus placeholder="Например: загружен не тот акт"></textarea></label>
   <p id="admin-delete-error" class="error" role="alert"></p>
  </div>
  <div class="cp-drawer-foot"><button type="button" data-action="dismiss">Отмена</button><button class="adm-delete-confirm" type="submit">Удалить документ</button></div>
 </form>`;
 const form=dialog.querySelector('#admin-delete-document-form');
 form.onsubmit=async ev=>{
  ev.preventDefault();
  const submit=ev.submitter,reason=new FormData(form).get('reason')?.trim()||'';
  if(reason.length<5)return;
  submit.disabled=true;
  const out=dialog.querySelector('#admin-delete-error');out.textContent='';
  try{
   const {error}=await client.rpc('pto_delete_document',{document_id:doc.id,reason});
   if(error)throw error;
   dialog.close();
   location.reload();
  }catch(err){
   out.textContent=err?.message||String(err);
   submit.disabled=false;
  }
 };
}

const observer=new MutationObserver(()=>{void injectDeleteButton();});
if(dialog){observer.observe(dialog,{childList:true,subtree:true});dialog.addEventListener('toggle',()=>{void injectDeleteButton();});}
