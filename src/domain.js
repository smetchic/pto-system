export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=value=>Number(value||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
// Поля сумм (замечание пользователя 11.10.2026): «53 958 885,69» при вводе и просмотре; в базу уходит «53958885.69».
// Ввод любой: с пробелами или без, через точку или запятую.
export const parseMoney=v=>{const s=String(v??'').replace(/[\s\u00a0\u202f]/g,'').replace(',','.').replace('−','-');return /^-?(\d+\.?\d*|\.\d+)$/.test(s)?Number(s):null;};
const groups=i=>i.replace(/\B(?=(\d{3})+(?!\d))/g,' ');
export const moneyText=v=>{if(v===null||v===undefined||String(v).trim()==='')return '';const n=parseMoney(v);if(n===null)return String(v);const [i,f]=Math.abs(n).toFixed(2).split('.');return `${n<0?'-':''}${groups(i)},${f}`;};
// Пока вводят: только разделитель тысяч в целой части, дробная — как набрана.
export const moneyLive=v=>{const s=String(v??'').replace(/[\s\u00a0\u202f]/g,'').replace('−','-');const m=s.match(/^(-?)(\d*)([.,]\d*)?$/);return m?`${m[1]}${groups(m[2])}${m[3]?','+m[3].slice(1,3):''}`:String(v??'');};
export const plainMoney=v=>{const n=parseMoney(v);return n===null?String(v??'').trim():String(n);};
// Ставка НДС не вводится, а считается: НДС / (цена − НДС). «Не сходится» — НДС отличается от 20 % (или 0) больше чем на рубль.
export function vatInfo(total,vat){
 const t=parseMoney(total),v=parseMoney(vat);if(t===null||v===null||t<=0)return null;
 if(v===0)return {rate:0,text:'без НДС',ok:true};
 const rate=v/(t-v)*100,ok=Math.abs(v-t*20/120)<=1;
 return {rate:Math.round(rate*100)/100,text:`${(Math.round(rate*100)/100).toLocaleString('ru-RU',{maximumFractionDigits:2})} %`,ok};
}
// Состояние документа следует из шага его комплекта (pto_document_list / pto_workflow_list).
// Последний шаг «В бухгалтерии» (код accepted): передача фиксирует принятые версии.
export const isDone=x=>x?.step_code==='accepted';
// Кто отмечает шаг маршрута: все шаги отмечает ПТО; после передачи в бухгалтерию (actor none) шагов нет.
export const actorRoles={pto:['head','engineer'],none:[]};
export const canActOn=(w,role)=>(actorRoles[w?.actor]||[]).includes(role);
// Вносить данные и двигать комплекты: начальник ПТО — по любому объекту, инженер — по закреплённому, руководитель — никогда.
// Это подсказка интерфейсу; решает база (pto_private.can_access).
export const canWrite=(profile,memberships,projectId)=>profile?.role==='head'||(profile?.role==='engineer'&&(memberships||[]).some(m=>m.user_id===profile.id&&m.project_id===projectId));
export const kindNames={c2a:'С-2а',c2b:'С-2б',c3a:'С-3а',c29:'С-29'};
export const roleNames={head:'Начальник ПТО',engineer:'Инженер ПТО',director:'Руководитель'};
export const ourRoleNames={contractor:'Подрядчик',subcontractor:'Субподрядчик',customer:'Заказчик субподрядных работ',buyer:'Покупатель',service_customer:'Заказчик услуг'};
export const addendumStateNames={draft:'Проект',signed:'Подписано',cancelled:'Отменено'};
export const actionNames={workflow_advance:'Комплект передан на следующий шаг',workflow_jump:'Прошлый месяц внесён сразу на шаг',workflow_return:'Комплект возвращён',set_estimate:'Внесена оценка выполнения',update_contract:'Изменены условия договора',create_addendum:'Добавлено допсоглашение',set_addendum_status:'Изменён статус допсоглашения',create_counterparty:'Добавлен контрагент',update_counterparty:'Изменён контрагент',create_project:'Создан объект',update_project:'Объект изменён',member:'Изменён доступ к объекту',profile:'Изменена учётная запись',create_contract:'Создан договор',delete_contract:'Удалён договор',delete_document:'Удалён ошибочно внесённый документ',update_addendum:'Изменено допсоглашение',open_period:'Открыт период',create_document:'Создан документ',revise:'Создана новая версия',attach:'Прикреплён файл',send:'Передан документ',receive:'Подтверждено получение',sign:'Зафиксирована подпись',accept:'Принято бухгалтерией',allocate:'Сопоставлен субподряд',process_transition:'Перемещён комплект процентовки',review:'Проверен период',close:'Закрыт период',reopen:'Повторно открыт период',set_sub_month:'Изменён субподрядчик в месяце',set_month_marks:'Изменены отметки месяца',set_document_mark:'Изменена отметка документа',check_file:'Сверен скан'};
// Реестр за месяц считает база (pto_register_matrix); суммы приходят строками и здесь не складываются.
export const emptyMatrix={columns:[],rows:[],total:{total:'0.00',own:'0.00',subcontract:'0.00',cells:{}}};
export const matrixOf=value=>value&&!Array.isArray(value)&&Array.isArray(value.rows)?value:emptyMatrix;
export const rowLabel=r=>r.kind==='project'?`Итого по объекту ${r.project}`:r.kind==='part'?`${r.project} · ${r.number} · ${r.part}${r.vat_rate===null||r.vat_rate===undefined?'':Number(r.vat_rate)===0?' (без НДС)':` (НДС ${Number(r.vat_rate)} %)`}`:`${r.project} · ${r.number} · Итого по договору`;
// Подписи внизу печатной формы: директор (утверждает), начальник ПТО.
const cellNumber=value=>value===undefined||value===null||value===''?null:Number(value);
export function registerSheetRows(value,month){
 const m=matrixOf(value),line=r=>[cellNumber(r.total),cellNumber(r.own),cellNumber(r.subcontract),...m.columns.map(c=>cellNumber(r.cells?.[c.id]))];
 return [
  {values:['Реестр актов С-15 · '+month],bold:true},
  {values:['Объект / договор','Генподряд всего, с НДС','Собственные силы','Субподряд всего',...m.columns.map(c=>c.label)],bold:true},
  ...m.rows.map(r=>({values:[rowLabel(r),...line(r)],bold:r.kind==='project'})),
  ...(m.rows.length?[{values:['Всего',...line(m.total)],bold:true},{values:[]},{values:['Утверждаю: директор ____________________']},{values:['Начальник ПТО ____________________']}]:[])
 ];
}
// Текущие справки С-3а объекта по нашим договорам. Справки субподрядчиков (входящие договоры) в СМР генподряда не входят.
export const ourReports=(data,pid)=>{const incoming=new Set((data.contracts||[]).filter(c=>c.direction==='incoming').map(c=>c.id));
 return (data.c3aReports||[]).filter(r=>r.project_id===pid&&r.is_current&&!incoming.has(r.contract_id));};
