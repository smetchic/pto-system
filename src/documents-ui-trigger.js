// Одноразовый запуск оформления вкладки «Документы» после фактического асинхронного рендера.
// Наблюдатель отключается ДО запуска оформления, поэтому циклической перерисовки нет.
const app=document.querySelector('#app');
let observer=null,timeout=0;

function ready(){
 return !!app?.querySelector('.ob .tabs button[data-id="documents"].on')&&!!app?.querySelector('.ob .ob-bar .actions');
}

function fire(){
 // documents-ui-v2 уже слушает change и запускает своё идемпотентное оформление.
 document.dispatchEvent(new Event('change',{bubbles:false}));
}

function arm(ms=5000){
 if(!app)return;
 observer?.disconnect();clearTimeout(timeout);
 const run=()=>{
  if(!ready())return false;
  observer?.disconnect();observer=null;
  setTimeout(fire,0);
  return true;
 };
 if(run())return;
 observer=new MutationObserver(()=>run());
 observer.observe(app,{childList:true,subtree:true});
 timeout=setTimeout(()=>{observer?.disconnect();observer=null;},ms);
}

// Первый вход в объект/вкладку после загрузки данных.
arm(8000);
// Перед любым пользовательским действием ждём следующий рендер; если документы уже открыты —
// срабатываем сразу. Никаких повторных наблюдений за изменениями, внесёнными самим оформлением.
document.addEventListener('click',()=>arm(4000),true);
document.addEventListener('change',()=>arm(4000),true);
window.addEventListener('pageshow',()=>arm(8000));
