import React,{useEffect,useRef,useState} from 'react';
const fields=[['note','Підсумок консультації'],['request_text','Запит / скарги'],['state_text','Стан пацієнта'],['work_done','Проведена робота'],['goals','Цілі'],['result_text','Результат і динаміка'],['recommendations','Рекомендації'],['homework','Домашнє завдання'],['next_plan','Подальший план']];
const stateLabel={open:'Потребує обробки',completed:'Проведено',linked:'Звірено з проведеною'};
const typeLabels={primary:'Первинна',repeat:'Повторна',crisis:'Кризова',individual:'Індивідуальна',family:'Сімейна',child:'Дитяча',group:'Групова'};
const riskLabels={low:'Низький',moderate:'Помірний',high:'Високий',critical:'Критичний'};
const flagLabels={anxiety:'Тривога',depression:'Депресивні прояви',ptsd:'ПТСР / флешбеки',sleep:'Порушення сну',panic:'Панічні прояви',aggression:'Агресія / дратівливість',family_conflict:'Сімейний конфлікт',burnout:'Емоційне виснаження',suicide:'Суїцидальний ризик',harm_others:'Ризик для оточення',urgent_followup:'Терміновий повторний контакт',doctor_referral:'Направлення до лікаря',family_work:'Сімейна робота',group_work:'Групова терапія'};
function clinical(value){return JSON.stringify([...fields.map(([key])=>value[key]||''),value.consultation_type||'repeat',Number(value.duration_minutes??60),value.risk_level||'low',value.risk_flags||[]]);}
function ClinicalMeta({value}){let flags=value.risk_flags||[];if(typeof flags==='string'){try{flags=JSON.parse(flags);}catch{flags=[];}}return <p>Тип: {typeLabels[value.consultation_type||'repeat']||value.consultation_type} · Тривалість: {value.duration_minutes??60} хв · Ризик: {riskLabels[value.risk_level||'low']||value.risk_level}{flags.length>0&&<> · Позначки: {flags.map(f=>flagLabels[f]||f).join(', ')}</>}</p>;}

export default function DeviceRecovery({api,device,Modal,onClose}) {
 const [rows,setRows]=useState(null),[item,setItem]=useState(null),[payload,setPayload]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[restore,setRestore]=useState(false),[serverConflict,setServerConflict]=useState(false),[saved,setSaved]=useState('');
 const lock=useRef(false),generation=useRef(0);
 async function load(){setError('');try{setRows(await api('GET',`/api/admin/recovery?user_id=${device.user_id}&device_id=${encodeURIComponent(device.device_id)}`));}catch(e){setError(e.message);}}
 useEffect(()=>{load();return()=>{++generation.current;};},[device.user_id,device.device_id]);
 async function select(id){const request=++generation.current;setLoading(true);setError('');setItem(null);setPayload(null);setConfirmed(false);setRestore(false);setServerConflict(false);setReason('');try{const d=await api('GET',`/api/admin/recovery/${id}`);if(request===generation.current){setItem(d);setPayload({...d.payload});}}catch(e){if(request===generation.current)setError(e.message);}finally{if(request===generation.current)setLoading(false);}}
 async function resolve(action,consultationId){
  if(lock.current)return;
  if(!reason.trim()||!confirmed){setError('Вкажіть причину та підтвердьте перевірку запису.');return;}
  lock.current=true;setBusy(true);setError('');
  try{const result=await api('POST',`/api/admin/recovery/${item.id}`,{action,revision:item.revision,draft_version:item.draft_version,payload,reason,confirmed,restore_attendance:restore,confirm_server_conflict:serverConflict,...(consultationId?{consultation_id:consultationId}:{})});setSaved(`Консультація №${result.consultation_id} збережена на сервері. Телефон оновить чергу під час наступної синхронізації.`);await load();await select(item.id);}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
 }
 const excluded=item?.appointment&&(item.appointment.visit_status||['cancelled','no_show'].includes(item.appointment.status));
 function open(id){if(item?.state==='open'&&(reason||confirmed||JSON.stringify(payload)!==JSON.stringify(item.payload))&&!window.confirm('Змінити запис? Введені тут правки буде скинуто.'))return;select(id);}
 const conflict=item?.server_draft && item.server_draft.client_key===item.client_key && String(item.server_draft.appointment_id)===String(item.appointment_id) && clinical(item.server_draft)!==clinical(item.payload);
 return <Modal key={saved} title="Проблемні записи телефона" subtitle={`${device.name} · ${device.device_name || device.device_id}`} onClose={()=>{if(!busy)onClose();}} wide>
  <div className="recovery-workspace">
   {saved&&<p className="alert info" role="status">{saved}</p>}
   {error&&<div className="alert error" role="alert">{error}</div>}
   <p>Збережений текст із телефона можна провести або звірити з уже проведеною консультацією. Початковий текст зберігається; автором залишається психолог.</p>
   <button className="button secondary" disabled={busy||loading} onClick={load}>Оновити список</button>
   {rows===null?<p role="status">Завантажуємо проблемні записи…</p>:!rows.length?<div className="recovery-empty"><h3>Текст проблемних записів ще не переданий</h3><p>На старих версіях телефон передає лише лічильник. Оновіть додаток до SOLVIA 3.0.0 (код 42) або новішого, підключіть його до сервера та запустіть синхронізацію. Локальні записи залишаються на телефоні.</p></div>:<div className="recovery-list">{rows.map(row=><button type="button" key={row.id} disabled={busy||loading} className={`recovery-entry ${item?.id===row.id?'selected':''}`} onClick={()=>open(row.id)}><strong>{row.patient} · № {row.patient_no}</strong><span>{stateLabel[row.state]} · {row.kind==='draft'?'Чернетка':'Завершений на телефоні запис'}</span><small>{row.error}</small></button>)}</div>}
   {loading&&<p role="status">Завантажуємо текст…</p>}
   {item&&payload&&<section className="recovery-editor" aria-label="Відновлення консультації">
    <h3>{item.patient} · {item.psychologist}</h3>
    <p>Прийом: {item.appointment?.start?.replace('T',' ') || 'Відомості недоступні'} · {stateLabel[item.state]} · версія {item.revision}</p>
    <details><summary>Початковий текст із телефона</summary><ClinicalMeta value={item.payload}/>{fields.map(([key,label])=>item.payload[key]&&<div key={key}><strong>{label}</strong><p className="preserve-lines">{item.payload[key]}</p></div>)}</details>
    {item.server_draft&&<details><summary>Актуальна чернетка на сервері · версія {item.draft_version}</summary><ClinicalMeta value={item.server_draft}/>{fields.map(([key,label])=>item.server_draft[key]&&<div key={key}><strong>{label}</strong><p className="preserve-lines">{item.server_draft[key]}</p></div>)}</details>}
    {item.state!=='open'?<p className="alert info">Запис оброблений · консультація № {item.consultation_id}. Причина: {item.resolution_reason}</p>:<>
     {item.existing.length>0&&<section className="recovery-existing"><h4>У базі вже є консультація цього прийому</h4>{item.existing.map(c=><article key={c.id}><strong>№ {c.id} · {c.psychologist}</strong><ClinicalMeta value={c}/>{fields.map(([key,label])=>c[key]&&<p key={key} className="preserve-lines"><b>{label}:</b> {c[key]}</p>)}</article>)}<p>Звірте тексти. Підтвердження наявного запису не змінює його й не створює дубль.</p></section>}
     <form onSubmit={e=>{e.preventDefault();resolve('complete');}} className="form-grid"><fieldset disabled={busy} className="form-grid recovery-fields">
      {!item.existing.length&&<>{fields.map(([key,label])=><label className="field full" key={key}><span>{label}</span><textarea aria-label={label} required={key==='note'} maxLength={10000} rows={key==='note'?5:3} value={payload[key]||''} onChange={e=>setPayload({...payload,[key]:e.target.value})}/></label>)}
       <label className="field"><span>Тривалість, хв</span><input aria-label="Тривалість, хв" type="number" min="10" max="480" required value={payload.duration_minutes??60} onChange={e=>setPayload({...payload,duration_minutes:Number(e.target.value)})}/></label>
       <label className="field"><span>Тип консультації</span><select value={payload.consultation_type||'repeat'} onChange={e=>setPayload({...payload,consultation_type:e.target.value})}>{[['primary','Первинна'],['repeat','Повторна'],['crisis','Кризова'],['individual','Індивідуальна'],['family','Сімейна'],['child','Дитяча'],['group','Групова']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
       <label className="field"><span>Рівень ризику</span><select value={payload.risk_level||'low'} onChange={e=>setPayload({...payload,risk_level:e.target.value})}>{[['low','Низький'],['moderate','Помірний'],['high','Високий'],['critical','Критичний']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></>}
      <label className="field full"><span>Причина обробки</span><textarea aria-label="Причина обробки" required maxLength={1000} rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <label className="check-chip full-span"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{item.existing.length?'Я звірив / звірила тексти з проведеною консультацією':'Підтверджую, що консультація фактично проведена й текст перевірений'}</span></label>
      {excluded&&!item.existing.length&&<label className="check-chip full-span"><input type="checkbox" checked={restore} onChange={e=>setRestore(e.target.checked)}/><span>Відновити помилкову неявку або скасування цього пацієнта</span></label>}
      {conflict&&!item.existing.length&&<label className="check-chip full-span"><input type="checkbox" checked={serverConflict} onChange={e=>setServerConflict(e.target.checked)}/><span>Я звірив / звірила відмінну серверну чернетку та підтверджую обраний текст</span></label>}
      <div className="form-actions full-span"><button type="button" className="button secondary" disabled={busy} onClick={()=>{if(window.confirm('Завантажити актуальний запис? Введені тут правки буде скинуто.'))select(item.id);}}>Завантажити актуальну версію</button>
       {!item.existing.length?<button className="button primary" disabled={busy||!confirmed||!reason.trim()||(excluded&&!restore)||(conflict&&!serverConflict)}>{busy?'Зберігаємо…':'Провести консультацію'}</button>:item.existing.filter(c=>c.psychologist_id===item.user_id).map(c=><button key={c.id} type="button" className="button primary" disabled={busy||!confirmed||!reason.trim()} onClick={()=>resolve('link',c.id)}>{busy?'Зберігаємо…':`Підтвердити проведену № ${c.id}`}</button>)}
      </div>
     </fieldset></form>
    </>}
   </section>}
  </div>
 </Modal>;
}
