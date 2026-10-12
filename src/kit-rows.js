// Комплект документов одной процентовки — одинаково во вкладках «Месяц» и «Документы» (замечания 12.10.2026:
// однотипные блоки выглядят одинаково). Справка С-3а сверху, акты под ней по номеру; часть объекта — отдельной колонкой;
// суммы актов зелёные и галочка у справки, если акты сходятся со справкой; «добавить» — узкая строка ссылок.
import {escapeHtml as e,money,kindNames} from './domain.js';

// Колонка документа узкая, часть объекта забирает остальное место и стоит сразу за номером (пользователь 12.10.2026).
export const KIT_COLS='<colgroup><col style="width:250px"><col><col style="width:140px"><col style="width:120px"><col style="width:120px"><col style="width:140px"><col style="width:56px"></colgroup>';
export const KIT_HEAD='<thead><tr><th>Документ</th><th>Часть объекта</th><th class="num">СМР с НДС</th><th class="num">Оборудование</th><th class="num">Зачёт авансов</th><th class="num">К оплате</th><th>Скан</th></tr></thead>';
const byNo=(a,b)=>String(a.number||'').localeCompare(String(b.number||''),'ru',{numeric:true});
const dash='<span class="muted">—</span>';
const day=x=>x?new Date(String(x).slice(0,10)+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Europe/Minsk'}):'';
const SIGNED=['signed','accepted','closed'];

// Дата подписания процентовки — дата перехода «На проверке → Проверено», введённая пользователем (не дата ввода в базу).
export const signedOn=w=>w&&SIGNED.includes(w.step_code)?w.step_dates?.check||null:null;

// Заголовок комплекта: одно название во всех разделах.
export function kitTitle(w,c){
 const sub=w?.template_code==='sub_claim'||c?.direction==='incoming';
 const party=w?.party||c?.party||'',no=w?.contract_number||c?.number||'';
 return sub?`${party}${no?` · дог. № ${no}`:''}`:`Наша процентовка${no?` · дог. № ${no}`:''}${party?` · ${party}`:''}`;
}
// Дата подписания исправляется в «Изменить» карточки любого документа комплекта (12.10.2026).
export function kitStatus(w){
 if(!w)return '';
 const on=signedOn(w);
 return `<span class="ob-st ${w.step_code==='accepted'?'ok':w.step_code==='signed'?'b':'w'}">${e(w.step_label||'В работе')}</span>${on?` <span class="kt-signed">подписана ${e(day(on))}</span>`:''}`;
}

// Строки комплекта. list — документы комплекта; contract — договор (для ссылок «добавить»).
export function kitRows({data,list,contract,canEdit=false,tn=null}){
 const ver=d=>(data.versions||[]).find(v=>v.id===d.current_version)||{};
 const report=d=>(data.c3aReports||[]).find(r=>r.version_id===d.current_version)||(data.c3aReports||[]).find(r=>r.document_id===d.id&&r.is_current);
 const mark=d=>(data.docMarks||[]).find(x=>x.document_id===d.id)||{};
 // Часть объекта: отметка акта, иначе — из примечания версии, куда её пишет загрузка из Excel («Часть объекта: …. Из файла …»).
 const fromNote=d=>(String(ver(d).note||'').match(/^Часть объекта:\s*(.+?)\.\s*(?=Из файла|$)/)||[])[1]||'';
 const part=d=>{const m=mark(d);return (m.part_id?(data.contractParts||[]).find(x=>x.id===m.part_id)?.name:'')||m.part||fromNote(d);};
 const scan=d=>(data.files||[]).some(f=>f.version_id===d.current_version)?'<span class="mo-ok" title="Скан загружен">✓</span>':dash;
 const c3as=list.filter(d=>d.kind==='c3a').sort(byNo),acts=list.filter(d=>d.kind==='c2a'||d.kind==='c2b').sort(byNo),rest=list.filter(d=>!['c3a','c2a','c2b','c29'].includes(d.kind)).sort(byNo);
 const sum=acts.reduce((t,d)=>t+Number(ver(d).amount||0),0);
 const r0=c3as.length?report(c3as[0]):null,smr=r0?Number(r0.smr):null;
 const ok=r0&&acts.length?Math.abs(sum-smr)<0.005:null;
 const name=d=>`${e(kindNames[d.kind]||'Документ')} № ${e(d.number)}${ver(d).version>1?` <span class="dt-v">в${ver(d).version}</span>`:''}${d.correction?` <span class="pill w" title="${e(d.corrects?'Исправляет '+d.corrects:'Корректировка')}">корр.</span>`:''}`;
 const c3aRow=d=>{const r=report(d),v=ver(d),off=(Number(r?.target_offset)||0)+(Number(r?.current_offset)||0);
  const smrCell=r?`<span class="${ok===true?'kt-ok':ok===false?'neg':''}">${money(r.smr)}<i class="kt-chk">${ok===true?'✓':''}</i></span>${ok===false?`<small class="neg">акты ${money(sum)} · разница ${money(sum-Number(r.smr))}</small>`:''}`:`${money(v.amount)}<i class="kt-chk"></i>`;
  return `<tr class="ob-row kt-c3a" data-action="doc" data-id="${e(d.id)}" tabindex="0" role="button"><td><span class="kt-name">${name(d)}</span></td><td></td>
   <td class="num">${smrCell}</td><td class="num">${r&&Number(r.equipment)?money(r.equipment):dash}</td><td class="num">${r&&off?money(off):dash}</td><td class="num"><b>${r?money(r.to_pay):''}</b></td><td class="dt-scan">${scan(d)}</td></tr>`;};
 const actRow=d=>{const v=ver(d),t=tn?tn(d):'';
  return `<tr class="ob-row kt-act" data-action="doc" data-id="${e(d.id)}" tabindex="0" role="button"><td><span class="kt-name">${name(d)}</span>${t?' '+t:''}</td><td class="kt-part" title="${e(part(d))}">${e(part(d))}</td>
   <td class="num"><span class="${ok===true?'kt-ok':''}">${money(v.amount)}<i class="kt-chk"></i></span></td><td></td><td></td><td></td><td class="dt-scan">${scan(d)}</td></tr>`;};
 const cid=e(contract?.id||'');
 const links=canEdit?[`<button type="button" class="link" data-action="new-doc" data-id="${cid}">+ акт</button>`,
   c3as.length?'':`<button type="button" class="link" data-action="new-c3a" data-id="${cid}">+ справка С-3а</button>`,
   '<button type="button" class="link" data-action="excel-acts" data-id="">Загрузить из файла</button>'].filter(Boolean):[];
 const add=links.length||!c3as.length?`<tr class="kt-add"><td colspan="7">${c3as.length?'':'<span class="muted">Справки С-3а нет</span>'}${links.join('')}</td></tr>`:'';
 return c3as.map(c3aRow).join('')+acts.map(actRow).join('')+rest.map(actRow).join('')+add;
}
