// Рабочий экран «Документы»: компактная иерархия комплектов, карточка документа и просмотр PDF.
// Этот слой работает поверх существующего object-page/document-card без изменения бизнес-команд main.js.
import {createClient} from '@supabase/supabase-js';
import './documents-ui.css';

const app=document.querySelector('#app');
const dialog=document.querySelector('#dialog');
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client=createClient(url,key);
const partCache=new Map();
let scheduled=false;

const txt=x=>String(x||'').replace(/\s+/g,' ').trim();
const button=(label,action,cls='link')=>{const b=document.createElement('button');b.type='button';b.className=cls;b.dataset.action=action;b.textContent=label;return b;};

function schedule(){
 if(scheduled)return;scheduled=true;
 queueMicrotask(()=>{scheduled=false;void enhance();});
}

function activeDocumentsRoot(){
 const root=app?.querySelector('.ob');
 if(!root?.querySelector('.tabs button[data-id="documents"].on'))return null;
 return root;
}

function kitMeta(header){
 const copy=header?.cloneNode(true);copy?.querySelector('.ob-st')?.remove();
 const raw=txt(copy?.textContent||header?.textContent);
 if(/С-29/i.test(raw))return {kind:'c29',party:'',contract:''};
 if(/Без комплекта/i.test(raw))return {kind:'loose',party:'',contract:''};
 if(/Процентовка СУ-22 заказчику/i.test(raw)){
  const m=raw.match(/дог\.\s*№\s*(.+)$/i);
  return {kind:'ours',party:'',contract:txt(m?.[1]||'')};
 }
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
 const lead=document.createElement('span');lead.className='dt-create-label';
 lead.textContent=label||(kind==='c3a'?'Справка С-3а':'Акт С-2');
 td.append(lead);
 if(party){const p=document.createElement('span');p.className='dt-party';p.textContent=` · ${party}`;td.append(p);}
 if(contract){const c=document.createElement('span');c.className='dt-contract';c.textContent=` · дог. № ${contract}`;td.append(c);}
 const b=button(kind==='c3a'?'+ Создать справку':'+ Создать акт',kind==='c3a'?'new-c3a':'new-doc');
 b.classList.add('dt-create-btn');td.append(b);tr.append(td);return tr;
}

function emptyDocuments(root,canCreate){
 const bar=root.querySelector('.ob-bar');
 const empty=bar?.nextElementSibling;
 if(!empty?.classList.contains('empty')||empty.dataset.docsEmpty)return;
 empty.dataset.docsEmpty='1';empty.className='dt-empty';empty.textContent='';
 const makeBlock=(title,sub=false)=>{
  const section=document.createElement('section');section.className=`dt-empty-block${sub?' sub':''}`;
  const h=document.createElement('h3');h.textContent=title;section.append(h);
  const c3=document.createElement('div');c3.className='dt-empty-line';c3.append(document.createTextNode('Справка С-3а'));
  const c2=document.createElement('div');c2.className='dt-empty-line';c2.append(document.createTextNode('Акты С-2'));
  if(canCreate){c3.append(button('+ Создать','new-c3a'));c2.append(button('+ Создать','new-doc'));}
  section.append(c3,c2);return section;
 };
 empty.append(makeBlock('Процентовка СУ-22 заказчику'),makeBlock('Субподрядчики',true));
}

function classifyRows(rows){
 for(const row of rows){
  if(row.classList.contains('ob-grp'))continue;
  const t=txt(row.cells?.[0]?.textContent);
  if(/С-3а/i.test(t)){row.classList.add('dt-c3a');row.classList.remove('dt-act');}
  else if(/С-2[абab]/i.test(t)){row.classList.add('dt-act');}
 }
}

function decorateSubC3a(row,meta,status){
 if(!row)return;
 const cell=row.cells?.[0];if(!cell||cell.dataset.subDecorated)return;
 cell.dataset.subDecorated='1';
 if(meta.party&&!txt(cell.textContent).includes(meta.party)){const p=document.createElement('span');p.className='dt-party';p.textContent=` · ${meta.party}`;cell.append(p);}
 if(meta.contract&&!txt(cell.textContent).includes(`дог. № ${meta.contract}`)){const c=document.createElement('span');c.className='dt-contract';c.textContent=` · дог. № ${meta.contract}`;cell.append(c);}
 if(status){const s=status.cloneNode(true);s.classList.add('dt-sub-status');cell.append(s);}
}

function toolbar(root){
 const actions=root.querySelector('.ob-bar .actions');
 if(!actions)return false;
 const canCreate=!!actions.querySelector('[data-action="new-doc"]');
 for(const el of actions.querySelectorAll('[data-action="new-doc"],[data-action="new-c3a"],[data-action="new-c29"]'))el.remove();
 const excel=actions.querySelector('[data-action="excel-acts"]');
 if(excel){excel.textContent='Импорт Excel';actions.classList.add('dt-import-actions');}
 return canCreate;
}

function enhanceTable(root,canCreate){
 const table=root.querySelector('.dt-table');
 if(!table){emptyDocuments(root,canCreate);return;}
 const tbody=table.tBodies[0];if(!tbody)return;
 if(tbody.dataset.docsEnhanced){void decorateParts(table);return;}
 tbody.dataset.docsEnhanced='1';
 const nodes=[...tbody.children],sections=[];let current=null;
 for(const row of nodes){
  if(row.classList.contains('ob-grp')){current={header:row,rows:[],meta:kitMeta(row)};sections.push(current);}
  else if(current)current.rows.push(row);
 }
 const ours=sections.filter(s=>s.meta.kind==='ours');
 const subs=sections.filter(s=>s.meta.kind==='sub');
 const loose=sections.filter(s=>s.meta.kind==='loose'||s.meta.kind==='other');
 const frag=document.createDocumentFragment();

 for(const section of ours){
  classifyRows(section.rows);frag.append(section.header);
  let c3=section.rows.find(r=>r.classList.contains('dt-c3a')&&!r.classList.contains('dt-create'));
  const missing=section.rows.find(r=>/Справки С-3а нет/i.test(txt(r.textContent)));
  if(missing){const repl=canCreate?createRow('c3a',{contract:section.meta.contract}):missing;const i=section.rows.indexOf(missing);section.rows[i]=repl;c3=repl;}
  if(!c3&&canCreate)section.rows.unshift(createRow('c3a',{contract:section.meta.contract}));
  section.rows.forEach(r=>frag.append(r));
  const acts=section.rows.filter(r=>r.classList.contains('dt-act')&&!r.classList.contains('dt-create'));
  if(canCreate)frag.append(createRow('act',{contract:section.meta.contract,label:acts.length?'':'Акты С-2'}));
 }

 if(subs.length){
  const head=document.createElement('tr');head.className='ob-grp dt-subs-head';const td=document.createElement('td');td.colSpan=6;td.textContent='Субподрядчики';head.append(td);frag.append(head);
  subs.forEach((section,index)=>{
   classifyRows(section.rows);
   const status=section.header.querySelector('.ob-st');
   let c3=section.rows.find(r=>r.classList.contains('dt-c3a')&&!/Справки С-3а нет/i.test(txt(r.textContent)));
   const missing=section.rows.find(r=>/Справки С-3а нет/i.test(txt(r.textContent)));
   if(missing){const repl=canCreate?createRow('c3a',{party:section.meta.party,contract:section.meta.contract}):missing;const i=section.rows.indexOf(missing);section.rows[i]=repl;c3=repl;}
   if(!c3&&canCreate){c3=createRow('c3a',{party:section.meta.party,contract:section.meta.contract});section.rows.unshift(c3);}
   if(c3){c3.classList.add('dt-sub-start');if(index===0)c3.classList.add('first');decorateSubC3a(c3,section.meta,status);}
   section.rows.forEach(r=>frag.append(r));
  });
  if(canCreate){
   const add=document.createElement('tr');add.className='dt-sub-add';const cell=document.createElement('td');cell.colSpan=6;
   cell.append(button('+ Справка С-3а','new-c3a'),button('+ Акт С-2','new-doc'));add.append(cell);frag.append(add);
  }
 }

 for(const section of loose){classifyRows(section.rows);frag.append(section.header,...section.rows);}
 tbody.replaceChildren(frag);
 void decorateParts(table);
}

async function decorateParts(table){
 const rows=[...table.querySelectorAll('tr.dt-act[data-id]')].filter(r=>!r.dataset.partDone);
 if(!rows.length)return;
 const ids=[...new Set(rows.map(r=>r.dataset.id).filter(Boolean))];
 const need=ids.filter(id=>!partCache.has(id));
 if(need.length){
  try{
   const [{data:marks,error:me},{data:docs,error:de}]=await Promise.all([
    client.from('pto_document_marks_current').select('document_id,part,part_id').in('document_id',need),
    client.from('pto_document_list').select('id,current_version').in('id',need)
   ]);if(me)throw me;if(de)throw de;
   const partIds=[...new Set((marks||[]).map(x=>x.part_id).filter(Boolean))];
   const versionIds=[...new Set((docs||[]).map(x=>x.current_version).filter(Boolean))];
   const [{data:parts,error:pe},{data:versions,error:ve}]=await Promise.all([
    partIds.length?client.from('pto_contract_parts').select('id,name').in('id',partIds):Promise.resolve({data:[],error:null}),
    versionIds.length?client.from('pto_versions').select('id,note').in('id',versionIds):Promise.resolve({data:[],error:null})
   ]);if(pe)throw pe;if(ve)throw ve;
   const partById=new Map((parts||[]).map(x=>[x.id,x.name]));
   const markByDoc=new Map((marks||[]).map(x=>[x.document_id,x]));
   const docById=new Map((docs||[]).map(x=>[x.id,x]));
   const noteByVersion=new Map((versions||[]).map(x=>[x.id,x.note||'']));
   for(const id of need){
    const mark=markByDoc.get(id),doc=docById.get(id),note=noteByVersion.get(doc?.current_version)||'';
    const fromNote=(note.match(/^Часть объекта:\s*(.+?)\.\s*(?=Из файла|$)/)||[])[1]||'';
    partCache.set(id,txt((mark?.part_id&&partById.get(mark.part_id))||mark?.part||fromNote));
   }
  }catch{for(const id of need)partCache.set(id,'');}
 }
 for(const row of rows){
  row.dataset.partDone='1';const part=partCache.get(row.dataset.id);if(!part)continue;
  const cell=row.cells?.[0];if(!cell||cell.querySelector('.dt-part'))continue;
  const span=document.createElement('span');span.className='dt-part';span.textContent=` · ${part}`;cell.append(span);
 }
}

function parseCardSub(sub){
 if(!sub)return {object:'',contract:'',party:'',month:''};
 const copy=sub.cloneNode(true);copy.querySelector('.ob-st')?.remove();
 const bits=txt(copy.textContent).split(/\s*·\s*/).filter(Boolean);
 const object=bits[0]||'',month=bits.at(-1)||'';
 const contractBit=bits.find(x=>/^дог\./i.test(x))||'';
 const m=contractBit.match(/^дог\.\s*№\s*([^,]+)(?:,\s*(.*))?$/i);
 return {object,contract:txt(m?.[1]||''),party:txt(m?.[2]||''),month};
}

function enhanceCard(){
 const shell=dialog?.querySelector('.cp-drawer-shell.dc');if(!shell)return;
 if(!shell.dataset.docsCard){
  shell.dataset.docsCard='1';
  const head=shell.querySelector('.cp-drawer-head'),title=head?.querySelector('h2'),sub=head?.querySelector('.ct-sub'),part=head?.querySelector('.cp-full-name');
  if(head&&title&&sub){
   const status=sub.querySelector('.ob-st');const meta=parseCardSub(sub),kindTitle=txt(title.textContent),partText=txt(part?.textContent);
   const ident=document.createElement('div');ident.className='dc-ident';
   const line=(cls,text)=>{const x=document.createElement('div');x.className=cls;x.textContent=text;return x;};
   ident.append(
    line(`dc-party${meta.party?'':' muted'}`,meta.party||'Контрагент не указан'),
    line('dc-object',meta.object),
    line(`dc-part${partText?'':' muted'}`,partText||'Часть объекта не указана'),
    line('dc-contract',meta.contract?`Договор № ${meta.contract}`:'Договор не указан'),
    line('dc-docno',kindTitle),
    line('dc-month',meta.month)
   );
   title.remove();sub.remove();part?.remove();head.append(ident);
   const total=shell.querySelector('.cp-total');if(status&&total){status.classList.add('dc-status-at-total');total.append(status);}
  }
 }
 const files=[...shell.querySelectorAll('.dc-file')];
 files.forEach((row,i)=>{
  const open=row.querySelector('[data-action="download"]');if(!open||open.dataset.docsFile)return;
  open.dataset.docsFile='1';const path=open.dataset.id||'',pdf=/\.pdf$/i.test(path);
  open.dataset.action='open-file';open.textContent=pdf?'Открыть PDF':'Открыть скан';open.title='Открыть в новой вкладке';
  if(pdf){const preview=button('Просмотр PDF','preview-file','cp-small');preview.dataset.id=path;row.insertBefore(preview,open.nextSibling);}
  if(files.length>1){const n=document.createElement('span');n.className='dc-file-no';n.textContent=String(i+1);row.prepend(n);}
 });
}

function safeExcelDefault(){
 const select=dialog?.querySelector('#excel-import-form select[name="to_step"]');
 if(!select||select.dataset.safeDefault)return;
 select.dataset.safeDefault='1';select.value='';
}

async function signedUrl(path){
 const {data,error}=await client.storage.from('pto-documents').createSignedUrl(path,600);
 if(error)throw error;return data.signedUrl;
}

async function openFile(path){
 const popup=window.open('about:blank','_blank');
 try{const href=await signedUrl(path);if(popup){popup.opener=null;popup.location.href=href;}else window.location.href=href;}
 catch(err){popup?.close();console.error(err);}
}

async function previewFile(path){
 if(window.innerWidth<1100)return openFile(path);
 const href=await signedUrl(path),shell=dialog?.querySelector('.cp-drawer-shell.dc');if(!shell)return;
 dialog.querySelector('.dc-preview-pane')?.remove();
 const pane=document.createElement('aside');pane.className='dc-preview-pane';
 const bar=document.createElement('div');bar.className='dc-preview-bar';
 const title=document.createElement('b');title.textContent='Просмотр PDF';
 const actions=document.createElement('div');actions.className='dc-preview-actions';
 const external=button('Открыть отдельно','open-file','link');external.dataset.id=path;
 const close=button('Закрыть просмотр','close-preview','link');actions.append(external,close);bar.append(title,actions);
 const frame=document.createElement('iframe');frame.className='dc-preview-frame';frame.title='Просмотр PDF';frame.src=href;
 pane.append(bar,frame);dialog.insertBefore(pane,shell);dialog.classList.add('dc-preview-open');
}

function closePreview(){dialog?.querySelector('.dc-preview-pane')?.remove();dialog?.classList.remove('dc-preview-open');}

async function enhance(){
 const root=activeDocumentsRoot();if(root){const canCreate=toolbar(root);enhanceTable(root,canCreate);}
 enhanceCard();safeExcelDefault();
}

document.addEventListener('click',ev=>{
 const el=ev.target.closest?.('[data-action]');if(!el)return;
 const action=el.dataset.action,path=el.dataset.id||'';
 if(!['open-file','preview-file','close-preview'].includes(action))return;
 ev.preventDefault();ev.stopPropagation();
 if(action==='close-preview')return closePreview();
 if(!path)return;
 if(action==='open-file')void openFile(path);else void previewFile(path);
},true);

if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
if(dialog)new MutationObserver(schedule).observe(dialog,{childList:true,subtree:true,attributes:true,attributeFilter:['open','class']});
schedule();
