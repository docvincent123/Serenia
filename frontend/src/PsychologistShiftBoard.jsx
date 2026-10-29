import React,{useCallback,useEffect,useRef,useState} from 'react';
import './psychologist-shift-board.css';

const label={busy:'Проводить консультацію',waiting:'Пацієнт очікує',available:'Вільний',off_shift:'Поза зміною'};
const showTime=value=>value?String(value).slice(11,16):'—';
export default function PsychologistShiftBoard({api,role}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busyId,setBusyId]=useState(null);
 const apiRef=useRef(api);apiRef.current=api;
 const refresh=useCallback(async()=>{
  try{const value=await apiRef.current('GET','/api/shift-psychologists');setData(value);setError('');}
  catch(e){setError(e.message);setData(null);}finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();const t=setInterval(()=>{if(!document.hidden)void refresh();},10000);const cb=()=>void refresh();window.addEventListener('solvia:workflow-updated',cb);return()=>{clearInterval(t);window.removeEventListener('solvia:workflow-updated',cb);};},[refresh]);
 async function change(person){
  if(busyId!==null||role!=='admin')return;
  if(person.on_shift&&!window.confirm(`Завершити зміну психолога «${person.name}»? Якщо є незавершені прийоми, сервер відхилить дію.`))return;
  setBusyId(person.id);setError('');
  try{await apiRef.current('POST','/api/shift-psychologists',{psychologist_id:Number(person.id),on_shift:!person.on_shift});await refresh();window.dispatchEvent(new Event('solvia:workflow-updated'));}
  catch(e){setError(e.message);}finally{setBusyId(null);}
 }
 const list=[...(data?.psychologists||[])].sort((a,b)=>Number(b.on_shift)-Number(a.on_shift)||['busy','waiting','available','off_shift'].indexOf(a.status)-['busy','waiting','available','off_shift'].indexOf(b.status)||String(a.name).localeCompare(String(b.name),'uk'));
 const active=list.filter(p=>p.on_shift);
 const counts={busy:active.filter(p=>p.status==='busy').length,waiting:active.filter(p=>p.status==='waiting').length,available:active.filter(p=>p.status==='available').length};
 return <section className="psy-roster">
  <header className="page-head"><div><div className="eyebrow">ОПЕРАТИВНА ЗМІНА</div><h1>Психологи на зміні</h1><p>Живий стан консультацій без медичних нотаток і персональних даних пацієнтів. Оновлюється кожні 10 секунд.</p></div>
   <button type="button" className="button secondary" onClick={refresh} disabled={loading}>Оновити стан</button></header>
  {error&&<div className="alert error" role="alert">{error}</div>}
  {loading&&<p role="status">Отримуємо список психологів…</p>}
  {data&&<>
   {!data.shift_open&&<p className="psy-roster-notice">Робоча зміна не відкрита. Адміністратор повинен її відкрити.</p>}
   {data.shift_open&&!data.configured&&<p className="psy-roster-notice">Склад зміни ще не затверджено. Адміністратор має додати психологів до зміни. До першого налаштування діє сумісний зі старим розкладом режим запису.</p>}
   <div className="psy-roster-counts" role="status">
     <div><strong>{active.length}</strong><span>На зміні</span></div>
     <div><strong>{counts.busy}</strong><span>На консультації</span></div>
     <div><strong>{counts.waiting}</strong><span>Очікують пацієнтів</span></div>
     <div><strong>{counts.available}</strong><span>Вільні</span></div>
   </div>
   <div className="psy-roster-grid">{list.map(person=><article className={`psy-roster-card ${person.on_shift?'on-shift':'off-shift'}`} key={person.id}>
    <div className="psy-roster-top"><div><strong>{person.name}</strong><small>{person.on_shift?'У складі зміни':'Не у складі зміни'}</small></div><span className={`psy-roster-status ${person.status}`}>{label[person.status]||'Невідомий стан'}</span></div>
    {person.on_shift&&<><div className="psy-roster-facts">
      <div><b>{person.busy_count||0}</b><small>У роботі</small></div><div><b>{person.waiting_count||0}</b><small>Очікують</small></div><div><b>{person.upcoming_count||0}</b><small>Попереду</small></div>
     </div><p className="psy-roster-next">Наступний прийом: <strong>{showTime(person.next_at)}</strong>{person.room?` · ${person.room}`:''}</p><small className="psy-roster-device">{person.connected?'● Телефон на зв’язку':'○ Телефон не підтвердив зв’язок'} — не визначає присутність на зміні</small></>}
    {role==='admin'&&data.shift_open&&<button type="button" className="button secondary psy-roster-toggle" disabled={busyId!==null} onClick={()=>change(person)}>{busyId===person.id?'Зберігаємо…':person.on_shift?'Зняти зі зміни':'+ Додати до зміни'}</button>}
   </article>)}</div>
   {!list.length&&<p>Немає активних психологів. Додайте їх у розділі «Команда».</p>}
  </>}
 </section>;
}
