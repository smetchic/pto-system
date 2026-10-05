export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=value=>Number(value||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
export const stateNames={draft:'Подготовка ПТО',sent:'Передан',received:'Получен',signed:'Подписан',accepted:'Принят бухгалтерией'};
export const kindNames={c2a:'С-2а',c2b:'С-2б',c3a:'С-3а',c29:'С-29'};
export const roleNames={head:'Начальник ПТО',engineer:'Инженер ПТО',accountant:'Бухгалтерия',admin:'Администратор'};
export const actionNames={create_project:'Создан объект',member:'Изменён доступ к объекту',profile:'Изменена учётная запись',create_contract:'Создан договор',open_period:'Открыт период',create_document:'Создан документ',revise:'Создана новая версия',attach:'Прикреплён файл',send:'Передан документ',receive:'Подтверждено получение',sign:'Зафиксирована подпись',accept:'Принято бухгалтерией',allocate:'Сопоставлен субподряд',review:'Проверен период',close:'Закрыт период',reopen:'Повторно открыт период'};
export function registerMatrix(rows,projects,contracts,documents,allocations){
 const subs=[...new Set(contracts.filter(c=>c.direction==='incoming').map(c=>c.party))].sort();
 const result=rows.map(row=>{
  const split=Object.fromEntries(subs.map(s=>[s,0]));
  for(const a of allocations.filter(a=>a.period_id===row.period_id)){
   const out=documents.find(d=>d.id===a.outgoing_document);if(out?.contract_id!==row.contract_id)continue;
   const inc=documents.find(d=>d.id===a.incoming_document),c=contracts.find(c=>c.id===inc?.contract_id);if(c)split[c.party]+=Number(a.amount);
  }
  return {...row,object:projects.find(p=>p.id===row.project_id)?.name||'',own:Number(row.total)-Number(row.subcontract),split};
 });return {subs,rows:result};
}
