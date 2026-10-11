// Вкладка «Документы»: согласованное оформление без MutationObserver.
// Важно: модуль не наблюдает DOM и не перерисовывает приложение циклически — он запускает
// идемпотентное оформление после пользовательских действий и открытия боковой панели.
import {createClient} from '@supabase/supabase-js';
import './documents-ui.css';

const app=document.querySelector('#app');
const dialog=document.querySelector('#dialog');
const client=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const partCache=new Map();
let timer=0;

const txt=x=>String(x||'').replace(/\s+/g,' ').trim();
const button=(label,action,cls='link')=>{const b=document.createElement('button');b.type='button';b.className=cls;b.dataset.action=action;b.textContent=label;return b;};

function queueEnhance(delay=0){
 clearTimeout(timer);
 timer=setTimeout(()=>{void enhance();},delay);
}

function root(){
 const x=app?.querySelector('.ob');
 return x?.querySelector('.tabs button[data-id="documents"].on')?x:null;
}

function kitMeta(header){
 const copy=header?.cloneNode(true);copy?.querySelector('.ob-st')?.remove();
 const raw=txt(copy?.textContent||header?.textContent);
 if(/С-29/i.test(raw))return {kind:'c29',party:'',contract:''};
 if(/Без комплекта/i.test(raw))return {kind:'loose',party:'',contract:''};
 if(/Процентовка СУ-22 заказчику/i.test(raw))return {kind:'ours',party:'',contract:txt(raw.match(/дог\.\s*№\s*(.+)$/i)?.[1]||'')};
 if(/Процентовка субподрядчика/i.test(raw)){
  const m=raw.match(/Процентовка субподрядчика\s*·\s*(.*?)\s*·\s*дог\.\s*№\s*(.+)$/i);
  return {kind:'sub',party:txt(m?.[1]||''),contract:txt(m?.[2]||'')};
 }
 return {kind:'other',party:'',contract:''};
}

function createRow(kind,{party='',contract='',label=''}={}){
 const tr=document.createElement('tr');
 tr.className=`dt-create ${kind==='c3a'?'dt-top dt-c3a':'dt-in dt-act'}`;
 const td=document.createElement('td');td.colSpan=6;
 const lead=document.createElement('span');lead.className='dt-create-label';lead.textContent=label||(kind==='c3a'?'Справка С-3а':'Акт С-2');td.append(lead);
 if(party){const p=document.createElement('span');p.className='dt-party';p.textContent=` · ${party}`;td.append(p);}
 if(contract){const c=document.createElement('span');c.className='dt-contract';c.textContent=` · дог. № ${contract}`;td.append(c);}
 const b=button(kind==='c3a'?'+ Создать справку':'+ Создать акт',kind==='c3a'?'new-c3a':'new-doc');b.classList.add('dt-create-btn');td.append(b);
 tr.append(td);return tr;
}

function fillEmpty(container,canCreate){
 if(container.dataset.docsEmpty)return;
 container.dataset.docsEmpty='1';container.className='dt-empty';container.textContent='';
 const block=(title,sub=false)=>{
  const s=document.createElement('section');s.className=`dt-empty-block${sub?' sub':''}`;
  const h=document.createElement('h3');h.textContent=title;s.append(h);
  const c3=document.createElement('div');c3.className='dt-empty-line';c3.append(document.createTextNode('Справка С-3а'));
  const c2=document.createElement('div');c2.className='dt-empty-line';c2.append(document.createTextNode('Акты С-2'));
  if(canCreate){c3.append(button('+ Создать','new-c3a'));c2.append(button('+ Создать','new-doc'));}
  s.append(c3,c2);return s;
 };
 container.append(block('Процентовка СУ-22 заказчику'),block('Субподрядчики',true));
}

function toolbar(r){
 const actions=r.querySelector('.ob-bar .actions');if(!actions)return false;
 const canCreate=!!actions.querySelector('[data-action="new-doc"]')||actions.dataset.canCreate==='1';
 actions.dataset.canCreate=canCreate?'1':'0';
 actions.querySelectorAll('[data-action="new-doc"],[data-action="new-c3a"],[data-action="new-c29"]').forEach(x=>x.remove());
 const excel=actions.querySelector('[data-action="excel-acts"]');
 if(excel&&excel.textContent!=='Импорт Excel')excel.textContent='Импорт Excel';
 actions.classList.add('dt-import-actions');
 return canCreate;
}

function classify(rows){
 for(const row of rows){
  const t=txt(row.cells?.[0]?.textContent);
  if(/С-3а/i.test(t)){row.classList.add('dt-c3a');row.classList.remove('dt-act');}
  else if(/С-2[абab]/i.test(t))row.classList.add('dt-act');
 }
}

function decorateSubC3a(row,meta,status){
 const cell=row?.cells?.[0];if(!cell||cell.dataset.subDecorated)return;cell.dataset.subDecorated='1';
 if(meta.party&&!txt(cell.textContent).includes(meta.party)){const p=document.createElement('span');p.className='dt-party';p.textContent=` · ${meta.party}`;cell.append(p);}
 if(meta.contract&&!txt(cell.textContent).includes(`дог. № ${meta.contract}`)){const c=document.createElement('span');c.className='dt-contract';c.textContent=` · дог. № ${meta.contract}`;cell.append(c);}
 if(status){const s=status.cloneNode(true);s.classList.add('dt-sub-status');cell.append(s);}
}

function enhanceTable(r,canCreate){
 const table=r.querySelector('.dt-table');
 if(!table){const empty=r.querySelector('.ob-bar')?.nextElementSibling;if(empty?.classList.contains('empty'))fillEmpty(empty,canCreate);return;}
 const tbody=table.tBodies[0];if(!tbody||tbody.dataset.docsEnhanced)return;
 tbody.dataset.docsEnhanced='1';
 const sections=[];let current=null;
 for(const row of [...tbody.children]){
  if(row.classList.contains('ob-grp')){current={header:row,rows:[],meta:kitMeta(row)};sections.push(current);}
  else if(current)current.rows.push(row);
 }
 const ours=sections.filter(s=>s.meta.kind==='ours');
 const subs=sections.filter(s=>s.meta.kind==='sub');
 const loose=sections.filter(s=>s.meta.kind==='loose'||s.meta.kind==='other');
 const frag=document.createDocumentFragment();

 for(const s of ours){
  classify(s.rows);frag.append(s.header);
  const missing=s.rows.find(x=>/Справки С-3а нет/i.test(txt(x.textContent)));
  if(missing&&canCreate){const i=s.rows.indexOf(missing);s.rows[i]=createRow('c3a',{contract:s.meta.contract});}
  if(!s.rows.some(x=>x.classList.contains('dt-c3a'))&&canCreate)s.rows.unshift(createRow('c3a',{contract:s.meta.contract}));
  s.rows.forEach(x=>frag.append(x));
  if(canCreate)frag.append(createRow('act',{contract:s.meta.contract,label:s.rows.some(x=>x.classList.contains('dt-act'))?'':'Акты С-2'}));
 }

 if(subs.length){
  const h=document.createElement('tr');h.className='ob-grp dt-subs-head';const td=document.createElement('td');td.colSpan=6;td.textContent='Субподрядчики';h.append(td);frag.append(h);
  subs.forEach((s,i)=>{
   classify(s.rows);const status=s.header.querySelector('.ob-st');
   const missing=s.rows.find(x=>/Справки С-3а нет/i.test(txt(x.textContent)));
   if(missing&&canCreate){const ix=s.rows.indexOf(missing);s.rows[ix]=createRow('c3a',{party:s.meta.party,contract:s.meta.contract});}
   let c3=s.rows.find(x=>x.classList.contains('dt-c3a'));
   if(!c3&&canCreate){c3=createRow('c3a',{party:s.meta.party,contract:s.meta.contract});s.rows.unshift(c3);}
   if(c3){c3.classList.add('dt-sub-start');if(i===0)c3.classList.add('first');decorateSubC3a(c3,s.meta,status);}
   s.rows.forEach(x=>frag.append(x));
  });
  if(canCreate){const add=document.createElement('tr');add.className='dt-sub-add';const cell=document.createElement('td');cell.colSpan=6;cell.append(button('+ Справка С-3а','new-c3a'),button('+ Акт С-2','new-doc'));add.append(cell);frag.append(add);}
 }

 for(const s of loose){classify(s.rows);frag.append(s.header,...s.rows);}
 if(!ours.length&&!subs.length&&!loose.length){
  const wrap=table.closest('.table-wrap');if(wrap){const empty=document.createElement('div');empty.className='empty';wrap.replaceWith(empty);fillEmpty(empty,canCreate);}return;
 }
 tbody.replaceChildren(frag);
 void decorateParts(table);
}

async function decorateParts(table){
 const rows=[...table.querySelectorAll('tr.dt-act[data-id]')].filter(r=>!r.dataset.partDone);if(!rows.length)return;
 const ids=[...new Set(rows.map(r=>r.dataset.id).filter(Boolean))],need=ids.filter(id=>!partCache.has(id));
 if(need.length){
  try{
   const [{data:marks,error:me},{data:docs,error:de}]=await Promise.all([
    client.from('pto_document_marks_current').select('document_id,part,part_id').in('document_id',need),
    client.from('pto_document_list').select('id,current_version').in('id',need)
   ]);if(me)throw me;if(de)throw de;
   const partIds=[...new Set((marks||[]).map(x=>x.part_id).filter(Boolean))],versionIds=[...new Set((docs||[]).map(x=>x.current_version).filter(Boolean))];
   const [{data:parts,error:pe},{data:versions,error:ve}]=await Promise.all([
    partIds.length?client.from('pto_contract_parts').select('id,name').in('id',partIds):Promise.resolve({data:[],error:null}),
    versionIds.length?client.from('pto_versions').select('id,note').in('id',versionIds):Promise.resolve({data:[],error:null})
   ]);if(pe)throw pe;if(ve)throw ve;
   const pById=new Map((parts||[]).map(x=>[x.id,x.name])),mByDoc=new Map((marks||[]).map(x=>[x.document_id,x])),dById=new Map((docs||[]).map(x=>[x.id,x])),nByVer=new Map((versions||[]).map(x=>[x.id,x.note||'']));
   for(const id of need){const m=mByDoc.get(id),d=dById.get(id),note=nByVer.get(d?.current_version)||'',fromNote=(note.match(/^Часть объекта:\s*(.+?)\.\s*(?=Из файла|$)/)||[])[1]||'';partCache.set(id,txt((m?.part_id&&pById.get(m.part_id))||m?.part||fromNote));}
  }catch{need.forEach(id=>partCache.set(id,''));}
 }
 for(const row of rows){row.dataset.partDone='1';const part=partCache.get(row.dataset.id),cell=row.cells?.[0];if(!part||!cell||cell.querySelector('.dt-part'))continue;const s=document.createElement('span');s.className='dt-part';s.textContent=` · ${part}`;cell.append(s);}
}

function parseCard(sub){
 if(!sub)return {object:'',contract:'',party:'',month:''};
 const copy=sub.cloneNode(true);copy.querySelector('.ob-st')?.remove();const bits=txt(copy.textContent).split(/\s*·\s*/).filter(Boolean);
 const object=bits[0]||'',month=bits.at(-1)||'',contractBit=bits.find(x=>/^дог\./i.test(x))||'',m=contractBit.match(/^дог\.\s*№\s*([^,]+)(?:,\s*(.*))?$/i);
 return {object,contract:txt(m?.[1]||''),party:txt(m?.[2]||''),month};
}

function enhanceCard(){
 const shell=dialog?.querySelector('.cp-drawer-shell.dc');if(!shell)return;
 if(!shell.dataset.docsCard){
  shell.dataset.docsCard='1';const head=shell.querySelector('.cp-drawer-head'),title=head?.querySelector('h2'),sub=head?.querySelector('.ct-sub'),part=head?.querySelector('.cp-full-name');
  if(head&&title&&sub){
   const status=sub.querySelector('.ob-st'),meta=parseCard(sub),doc=txt(title.textContent),partText=txt(part?.textContent),ident=document.createElement('div');ident.className='dc-ident';
   const line=(cls,text)=>{const x=document.createElement('div');x.className=cls;x.textContent=text;return x;};
   ident.append(line(`dc-party${meta.party?'':' muted'}`,meta.party||'Контрагент не указан'),line('dc-object',meta.object),line(`dc-part${partText?'':' muted'}`,partText||'Часть объекта не указана'),line('dc-contract',meta.contract?`Договор № ${meta.contract}`:'Договор не указан'),line('dc-docno',doc),line('dc-month',meta.month));
   title.remove();sub.remove();part?.remove();head.append(ident);
   const total=shell.querySelector('.cp-total');if(status&&total){status.classList.add('dc-status-at-total');total.append(status);}
  }
 }
 const files=[...shell.querySelectorAll('.dc-file')];
 files.forEach((row,i)=>{
  const open=row.querySelector('[data-action="download"]');if(!open||open.dataset.docsFile)return;open.dataset.docsFile='1';
  const path=open.dataset.id||'',pdf=/\.pdf$/i.test(path);open.textContent=pdf?'Открыть PDF':'Открыть скан';open.title='Открыть отдельно';
  if(pdf){const preview=button('Просмотр PDF','preview-file','cp-small');preview.dataset.id=path;row.insertBefore(preview,open);}
  if(files.length>1){const n=document.createElement('span');n.className='dc-file-no';n.textContent=String(i+1);row.prepend(n);}
 });
}

function safeExcelDefault(){
 const select=dialog?.querySelector('#excel-import-form select[name="to_step"]');if(!select||select.dataset.safeDefault)return;select.dataset.safeDefault='1';select.value='';
}

function showError(err){console.error(err);const t=document.querySelector('#toast');if(!t)return;t.textContent=err?.message||String(err);t.hidden=false;setTimeout(()=>{t.hidden=true;},6000);}
async function signedUrl(path){const {data,error}=await client.storage.from('pto-documents').createSignedUrl(path,600);if(error)throw error;return data.signedUrl;}
async function previewFile(path){
 try{
  const href=await signedUrl(path);if(window.innerWidth<1100){window.open(href,'_blank','noopener');return;}
  const shell=dialog?.querySelector('.cp-drawer-shell.dc');if(!shell)return;dialog.querySelector('.dc-preview-pane')?.remove();
  const pane=document.createElement('aside');pane.className='dc-preview-pane';const bar=document.createElement('div');bar.className='dc-preview-bar';const title=document.createElement('b');title.textContent='Просмотр PDF';
  const actions=document.createElement('div');actions.className='dc-preview-actions';const external=button('Открыть отдельно','download','link');external.dataset.id=path;const close=button('Закрыть просмотр','close-preview','link');actions.append(external,close);bar.append(title,actions);
  const frame=document.createElement('iframe');frame.className='dc-preview-frame';frame.title='Просмотр PDF';frame.src=href;pane.append(bar,frame);dialog.insertBefore(pane,shell);dialog.classList.add('dc-preview-open');
 }catch(err){showError(err);}
}
function closePreview(){dialog?.querySelector('.dc-preview-pane')?.remove();dialog?.classList.remove('dc-preview-open');}

async function enhance(){const r=root();if(r){const canCreate=toolbar(r);enhanceTable(r,canCreate);}enhanceCard();safeExcelDefault();}

// PDF-предпросмотр перехватываем раньше общего обработчика main.js; остальные действия остаются штатными.
document.addEventListener('click',ev=>{
 const el=ev.target.closest?.('[data-action]');if(!el)return;
 if(el.dataset.action==='preview-file'){ev.preventDefault();ev.stopPropagation();void previewFile(el.dataset.id||'');return;}
 if(el.dataset.action==='close-preview'){ev.preventDefault();ev.stopPropagation();closePreview();return;}
 queueEnhance(0);setTimeout(()=>queueEnhance(0),250);
},true);

document.addEventListener('change',()=>{queueEnhance(0);setTimeout(()=>queueEnhance(0),500);},true);
dialog?.addEventListener('toggle',()=>{queueEnhance(0);setTimeout(()=>queueEnhance(0),80);});
window.addEventListener('pageshow',()=>queueEnhance(0));
queueEnhance(0);
