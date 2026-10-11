// Выбор файла в папке ДОГОВОРА (замечание пользователя 11.10.2026): путь от папки подставляется сам, вручную не прописывается.
// Путь хранится от папки ДОГОВОРА без её имени: «ПРУЖАНЫ/05_21-03 БЕЛТОПМЕД/ДС 3.pdf» — как у загруженных договоров (source_key, files).
// Chrome и Edge: папка подключается один раз (File System Access API, ссылка хранится в браузере), окно выбора файла
// открывается сразу в папке договора. Firefox и Safari: папку выбирают один раз за сеанс (<input webkitdirectory>),
// файл — из списка с поиском; файлы не загружаются на сервер, читаются только их пути.
import {escapeHtml as e} from './domain.js';

export const nativePick=()=>typeof window!=='undefined'&&'showDirectoryPicker' in window&&'showOpenFilePicker' in window;

// Список путей из выбранной папки: первая часть пути — имя самой папки, она отбрасывается.
export const folderPaths=files=>[...files].map(f=>String(f.webkitRelativePath||f.name).split('/').slice(1).join('/')).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}));
const low=s=>String(s).toLowerCase().replace(/ё/g,'е');
// Сначала файлы папки договора, потом остальные; поиск по словам в любом порядке.
export function matchPaths(paths,base,query,limit=40){
 const words=low(query).split(/\s+/).filter(Boolean),inBase=p=>!!base&&p.startsWith(base+'/');
 return paths.filter(p=>words.every(w=>low(p).includes(w))).sort((a,b)=>inBase(b)-inBase(a)).slice(0,limit);
}
export function pickListHtml(paths,base,query){
 const list=matchPaths(paths,base,query);
 return `<div class="fp-box"><input type="search" class="fp-q" placeholder="Поиск по имени файла или папке" value="${e(query)}" autocomplete="off">
  <div class="fp-list">${list.length?list.map(p=>`<button type="button" class="fp-item" data-action="pick-path" data-id="${e(p)}">${base&&p.startsWith(base+'/')?`<span class="muted">${e(base)}/</span>${e(p.slice(base.length+1))}`:e(p)}</button>`).join(''):'<small class="muted">Ничего не найдено</small>'}</div>
  <small class="muted">Файлов в папке: ${paths.length}. <button type="button" class="link" data-action="pick-folder">Выбрать другую папку</button></small></div>`;
}

// Подключённая папка Chrome/Edge хранится в IndexedDB браузера (только ссылка на папку, не файлы).
const store=mode=>new Promise((ok,fail)=>{const r=indexedDB.open('pto-folder',1);r.onupgradeneeded=()=>r.result.createObjectStore('h');r.onerror=()=>fail(r.error);r.onsuccess=()=>ok(r.result.transaction('h',mode).objectStore('h'));});
const req=r=>new Promise((ok,fail)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});
async function savedRoot(){try{return await req((await store('readonly')).get('root'))||null;}catch{return null;}}
async function saveRoot(h){try{await req((await store('readwrite')).put(h,'root'));}catch{}}
let root=null;
export async function forgetRoot(){root=null;try{await req((await store('readwrite')).delete('root'));}catch{}}

// Chrome/Edge: путь выбранного файла от подключённой папки.
export async function pickNative(base){
 root??=await savedRoot();
 if(root&&(await root.queryPermission({mode:'read'}))!=='granted'&&(await root.requestPermission({mode:'read'}))!=='granted')root=null;
 if(!root){root=await window.showDirectoryPicker({id:'dogovora',mode:'read'});await saveRoot(root);}
 let start=root;
 for(const part of String(base||'').split('/').filter(Boolean)){try{start=await start.getDirectoryHandle(part);}catch{break;}}
 const [file]=await window.showOpenFilePicker({startIn:start});
 const rel=await root.resolve(file);
 if(!rel){const name=root.name;await forgetRoot();throw Error(`Файл «${file.name}» не в папке «${name}». Выберите файл внутри папки ДОГОВОРА; в следующий раз папка будет запрошена заново.`);}
 return rel.join('/');
}
