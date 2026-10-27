import React,{useCallback,useEffect,useState} from 'react';
import {navFor} from './workspace-model.mjs';
import './center-home.css';

const quickByRole={
 admin:[
  ['shift-workspace','Прийоми сьогодні','Відмітити прибуття, викликати на TV','calendar-check'],
  ['patients','Пацієнти','Картки, історія, курси','users'],
  ['calendar','Календар','Записи та зайнятість','calendar-days'],
  ['team','Команда','Працівники та права','users-round']
 ],
 reception:[
  ['new-patient','Новий пацієнт','Зареєструвати у центрі','user-round-plus'],
  ['new-booking','Записати на прийом','Обрати час і психолога','calendar-plus'],
  ['shift-workspace','Прийоми сьогодні','Прибуття та виклики','clipboard-list'],
  ['calendar','Календар','Вільні години й кабінети','calendar-days']
 ]
};
function ActionIcon({type}){
 const paths={
  'calendar-check':<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18m-13 5 2 2 5-5"/></>,
  'users':<><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
  'calendar-days':<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18m5 5h3m-3 3h5"/></>,
  'users-round':<><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 21a7 7 0 0 1 14 0m0-6a6 6 0 0 1 6 6"/></>,
  'user-round-plus':<><circle cx="9" cy="8" r="3"/><path d="M2 21v-2a7 7 0 0 1 14 0v2m3-16v8m-4-4h8"/></>,
  'calendar-plus':<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18m-6-3v6m-3-3h6"/></>,
  'clipboard-list':<><rect x="5" y="5" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6m-6 4h6"/></>
 };
 return <svg viewBox="0 0 24 24" width="23" height="23" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}
const fmtDate=value=>value?new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'long'}).format(new Date(value+'T12:00:00')):'Сьогодні';
function AdminServerStatus({api}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function load(){
  setLoading(true);
  try{setData(await api('GET','/api/admin/system'));setError('');}
  catch(e){setError(e.message);}
  finally{setLoading(false);}
 }
 return <details className="center-home-extras center-server-status" onToggle={e=>{if(e.currentTarget.open&&!data&&!loading)void load();}}>
  <summary>Сервер і резервні копії</summary>
  {error&&<p role="alert">Помилка отримання стану: {error} <button type="button" className="button secondary" onClick={load}>Повторити</button></p>}
  {loading&&<p>Перевіряємо стан сервера…</p>}
  {data&&<div className="center-server-facts">
   <div><span>PostgreSQL</span><strong>{data.database?.name||'Невідомо'} · {data.database?.size||'—'}</strong></div>
   <div><span>Остання резервна операція</span><strong>{data.backups?.[0]?.created?.replace('T',' ').slice(0,16)||'Немає даних'}</strong></div>
   <div><span>Результат</span><strong>{data.backups?.[0]?.status==='success'?'Успішно':'Потребує перевірки'}</strong></div>
  </div>}
  <button className="button secondary" type="button" disabled={loading} onClick={load}>Оновити стан</button>
 </details>;
}

export default function CenterHome({api,role,onNavigate,onRegister,onBook,onOpenPatient}){
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false);
 const reload=useCallback(async()=>{
  setRefreshing(true);
  try{
   const data=await api('GET','/api/workday/home');
   if(!data?.counts||!Array.isArray(data.next))throw new Error('Некоректна відповідь сервера для головного екрана.');
   setSnapshot(data);setError('');
  }catch(e){setError(e.message);}
  finally{setRefreshing(false);}
 },[api]);
 useEffect(()=>{
  void reload();
  const timer=setInterval(()=>{if(!document.hidden)void reload();},30000);
  const changed=()=>{if(!document.hidden)void reload();};
  window.addEventListener('solvia:workflow-updated',changed);
  return()=>{clearInterval(timer);window.removeEventListener('solvia:workflow-updated',changed);};
 },[reload]);
 const numbers=snapshot?.counts||{};
 const stats=[
  ['Очікують',numbers.waiting??'—','Ще не прибули'],
  ['У центрі',numbers.arrived??'—','Прибули / на прийомі'],
  ['Завершено',numbers.completed??'—','Проведені консультації']
 ];
 function act(key){if(key==='new-patient')onRegister();else if(key==='new-booking')onBook();else onNavigate(key);}
 const extras=navFor(role).filter(([key])=>!['dashboard','shift-workspace','calendar','patients',...(role==='admin'?['team']:[])].includes(key));
 return <div className="center-home">
  <header className="center-home-intro">
   <div><span className="eyebrow">SOLVIA · РОБОЧИЙ ПРОСТІР</span><h1>{role==='reception'?'Реєстратура':'Головна центру'}</h1>
   <p>{snapshot?fmtDate(snapshot.date):'Сьогодні'} · {role==='reception'?'Запис, прийом і супровід пацієнтів':'Щоденна робота та контроль центру'}</p></div>
   <button className="button secondary" type="button" onClick={reload} disabled={refreshing}>{refreshing?'Оновлення…':'↻ Оновити'}</button>
  </header>
  {error&&<div role="alert" className="alert error">Не вдалося отримати дані з сервера: {error} <button type="button" className="button secondary" onClick={reload}>Повторити</button></div>}
  <section className="center-home-actions" aria-label="Основні дії">
   <div className="center-section-caption"><h2>Що потрібно зробити?</h2><span>Оберіть дію</span></div>
   <div className="center-home-action-grid">{quickByRole[role].map(([key,title,subtitle,icon])=><button type="button" className="center-home-action" key={key} onClick={()=>act(key)}><span className="center-home-action-icon"><ActionIcon type={icon}/></span><span className="center-home-action-copy"><strong>{title}</strong><small>{subtitle}</small></span><span aria-hidden="true">›</span></button>)}</div>
  </section>
  <section aria-label="Стан прийомів сьогодні" className="center-home-today">
   <div className="center-section-caption"><h2>Сьогодні</h2><button type="button" onClick={()=>onNavigate('shift-workspace')}>Відкрити прийоми <span aria-hidden="true">→</span></button></div>
   <div className="center-home-metrics">{stats.map(([title,value,subtitle])=><div className="center-home-metric" key={title}><span>{title}</span><strong>{value}</strong><small>{subtitle}</small></div>)}</div>
  </section>
  <section className="center-home-upcoming" aria-label="Найближчі прийоми">
   <div className="center-section-caption"><h2>Найближчі прийоми</h2><span>До 6 записів на сьогодні</span></div>
   {!snapshot&&!error?<div className="center-home-empty">Завантажуємо записи…</div>:
    !snapshot?.next?.length?<div className="center-home-empty">Немає незавершених прийомів на сьогодні.</div>:
    <div className="center-home-visits">{snapshot.next.map(v=><button key={v.appointment_id+':'+v.patient_id} type="button" className="center-home-visit" onClick={()=>onOpenPatient(v.patient_id)}>
     <time>{v.start?.slice(11,16)||'—'}</time><span className="center-home-visit-person"><strong>{v.patient}</strong><small>№{v.patient_no} · {v.psychologist} · {v.room}</small></span>
     <span className={v.arrived_at?'center-home-visit-state arrived':'center-home-visit-state'}>{v.arrived_at?'Прибув':'Очікуємо'}</span><span aria-hidden="true">›</span>
    </button>)}</div>}
  </section>
  <div className="center-home-footer"><span>Активних пацієнтів: <b>{snapshot?.active_patients??'—'}</b> · Лист очікування: <b>{snapshot?.waiting_list??'—'}</b></span>
   <button type="button" className="center-home-more" onClick={()=>onNavigate('module-directory')}>Інші функції центру <span aria-hidden="true">→</span></button>
  </div>
  {!!extras.length&&<details className="center-home-extras"><summary>Швидкий доступ до додаткових інструментів</summary><div>{extras.map(([key,label])=><button key={key} type="button" onClick={()=>onNavigate(key)}>{label}</button>)}</div></details>}
 {role==='admin'&&<AdminServerStatus api={api}/>}
 </div>;
}
