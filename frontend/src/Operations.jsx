import React,{useEffect,useState} from 'react';
const progressLabels={planned:'Заплановано',in_progress:'У роботі',achieved:'Досягнуто',paused:'Призупинено'};
export function DeviceHealth({api}) {
 const [rows,setRows]=useState([]),[error,setError]=useState('');
 useEffect(()=>{let alive=true;async function load(){try{const r=await api('GET','/api/admin/devices');if(alive){setRows(r);setError('');}}catch(e){if(alive)setError(e.message);}}load();const timer=setInterval(load,30000);return()=>{alive=false;clearInterval(timer);};},[api]);
 return <section className="surface"><div className="eyebrow">СИНХРОНІЗАЦІЯ</div><h2>Стан телефонів</h2><p>Останні відомості від додатка. Без свіжого з’єднання поточний стан черги невідомий.</p>{error&&<p role="alert">{error}</p>}
 {!rows.length?<p>Телефони з’являться після входу з нової версії додатка.</p>:rows.map(d=><article className="device-card device-health-card" key={`${d.user_id}:${d.device_id}`}>
 <div className="device-main"><strong>{d.name} · {d.device_name}</strong><span>SOLVIA {d.version_name} · код {d.version_code}</span><small>З’єднання: {d.last_seen?.replace('T',' ')} · синхронізація: {d.last_sync?.replace('T',' ')||'Ще не підтверджена'}</small></div>
 <span className={`visit-status ${!d.fresh?'expected':d.blocked_count?'excluded':d.pending_count?'arrived':'completed'}`}>{!d.fresh?'○ Поточний стан невідомий':d.blocked_count?'! Потрібна перевірка':d.pending_count?'↥ Очікує передавання':'✓ Передавання завершено'}</span>
 <span>Остання черга: {d.pending_count} · проблемні: {d.blocked_count}</span></article>)}</section>;
}
export function ShiftReadiness({data}) {
 if(!data)return null;
 return <div className="shift-readiness"><h3>{data.ready?'✓ Зміна готова до закриття':'! Потрібно перевірити перед закриттям'}</h3>
 <p>Незавершених прийомів: {data.unfinished.length}. Телефонів без свіжих відомостей: {data.devices.filter(d=>!d.fresh).length}.</p>
 {data.unfinished.map(v=><p key={`${v.appointment_id}:${v.patient_id}`}>{v.start.slice(11,16)} · {v.patient} · {v.psychologist} · {v.started_at?'консультація триває':v.arrived_at?'прибув':'очікується'}</p>)}
 {data.devices.filter(d=>!d.fresh||d.pending_count||d.blocked_count).map(d=><p key={`${d.user_id}:${d.device_id}`}>{d.name} · {d.fresh?`Очікує: ${d.pending_count}, проблемні: ${d.blocked_count}`:'Стан телефона невідомий — потрібне з’єднання'}</p>)}
 {data.unknown_psychologists.map(p=><p key={p.id}>{p.name} · додаток ще не передав стан синхронізації</p>)}</div>;
}
export function Addenda({api,record,canWrite,onSaved}) {
 const [reason,setReason]=useState(''),[content,setContent]=useState(''),[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[key,setKey]=useState(()=>crypto.randomUUID());
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);try{await api('POST',`/api/consultations/${record.id}/addenda`,{reason,content,client_key:key});setOpen(false);setReason('');setContent('');setKey(crypto.randomUUID());await onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <div className="record-addenda">{record.addenda?.map(a=><blockquote key={a.id}><strong>Доповнення · {a.author} · {a.created.replace('T',' ')}</strong><p>Причина: {a.reason}</p><p className="preserve-lines">{a.content}</p></blockquote>)}
 {canWrite&&!open&&<button className="button secondary" onClick={()=>setOpen(true)}>Додати уточнення</button>}
 {open&&<form onSubmit={save}><p>Початковий запис зберігається без змін. Доповнення залишиться в історії.</p><label>Причина<input required maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setKey(crypto.randomUUID());}}/></label><label>Текст уточнення<textarea required maxLength={10000} value={content} onChange={e=>{setContent(e.target.value);setKey(crypto.randomUUID());}}/></label>{error&&<p role="alert">{error}</p>}<button className="button primary" disabled={busy}>Зберегти доповнення</button><button type="button" className="button secondary" disabled={busy} onClick={()=>setOpen(false)}>Скасувати</button></form>}</div>;
}
export function PatientProgress({api,patientId,canWrite,history=[]}) {
 const [rows,setRows]=useState([]),[goal,setGoal]=useState(''),[status,setStatus]=useState('planned'),[observation,setObservation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{setRows(await api('GET',`/api/patients/${patientId}/progress`));}catch(e){setError(e.message);}}
 useEffect(()=>{load();},[patientId]);
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);try{await api('POST',`/api/patients/${patientId}/progress`,{goal,status,observation});setGoal('');setObservation('');await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="surface"><h2>Цілі та виконання рекомендацій</h2><p>Кожна оцінка зберігається окремо, щоб бачити зміни між зустрічами.</p>{error&&<p role="alert">{error}</p>}
 {history.slice(0,3).map(c=><article className="progress-entry" key={`consultation:${c.id}`}><strong>Рекомендації від {c.created?.replace('T',' ')}</strong>{[['goals','Цілі'],['recommendations','Рекомендації'],['homework','Домашнє завдання'],['next_plan','Подальший план']].map(([k,label])=>c[k]&&<p className="preserve-lines" key={k}><b>{label}:</b> {c[k]}</p>)}</article>)}
 {rows.map(p=><article className="progress-entry" key={p.id}><strong>{p.goal}</strong><span className="badge">{progressLabels[p.status]}</span><p className="preserve-lines">{p.observation}</p><small>{p.author} · {p.created.replace('T',' ')}</small></article>)}{!rows.length&&<p>Оцінок виконання цілей ще немає.</p>}
 {canWrite&&<form className="form-grid" onSubmit={save}><label>Ціль або рекомендація<input required maxLength={1000} value={goal} onChange={e=>setGoal(e.target.value)}/></label><label>Стан<select aria-label="Стан" value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries(progressLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label className="full-span">Спостереження<textarea maxLength={3000} value={observation} onChange={e=>setObservation(e.target.value)}/></label><button className="button primary" disabled={busy}>Зберегти оцінку</button></form>}</section>;
}
