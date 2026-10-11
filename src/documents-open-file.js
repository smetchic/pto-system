// Открытие скана/PDF из карточки как просмотра, а не принудительной загрузки.
import {createClient} from '@supabase/supabase-js';
const client=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

document.addEventListener('click',async ev=>{
 const b=ev.target.closest?.('.dc-file [data-action="download"],.dc-preview-actions [data-action="download"]');
 if(!b)return;
 ev.preventDefault();ev.stopImmediatePropagation();
 const path=b.dataset.id;if(!path)return;
 const popup=window.open('about:blank','_blank');
 try{
  const {data,error}=await client.storage.from('pto-documents').createSignedUrl(path,600);if(error)throw error;
  if(popup){popup.opener=null;popup.location.href=data.signedUrl;}
  else{const a=document.createElement('a');a.href=data.signedUrl;a.target='_blank';a.rel='noopener';a.click();}
 }catch(err){popup?.close();const t=document.querySelector('#toast');if(t){t.textContent=err?.message||String(err);t.hidden=false;setTimeout(()=>t.hidden=true,6000);}}
},true);
