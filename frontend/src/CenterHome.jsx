import React,{useCallback,useEffect,useRef,useState} from 'react';
import {navFor} from './workspace-model.mjs';
import './center-home.css';
import AppIcon from './AppIcon.jsx';

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
 const apiRef=useRef(api),sequence=useRef(0);apiRef.current=api;
 const reload=useCallback(async()=>{
  const request=++sequence.current;
  setRefreshing(true);
  try{
   const data=await apiRef.current('GET','/api/workday/home');
   if(!data?.counts||!Array.isArray(data.next))throw new Error('Некоректна відповідь сервера для головного екрана.');
   if(request===sequence.current){setSnapshot(data);setError('');}
  }catch(e){if(request===sequence.current)setError(e.message);}
  finally{if(request===sequence.current)setRefreshing(false);}
 },[]);
 useEffect(()=>{
  void reload();
  const timer=setInterval(()=>{if(!document.hidden)void reload();},30000);
  const changed=()=>{if(!document.hidden)void reload();};
  window.addEventListener('solvia:workflow-updated',changed);
  return()=>{++sequence.current;clearInterval(timer);window.removeEventListener('solvia:workflow-updated',changed);};
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
   <div className="center-home-action-grid">{quickByRole[role].map(([key,title,subtitle,icon])=><button type="button" className="center-home-action" key={key} onClick={()=>act(key)}><span className="center-home-action-icon"><AppIcon name={({"calendar-check":"shift-workspace","users":"patients","calendar-days":"calendar","users-round":"team","user-round-plus":"patients","calendar-plus":"calendar","clipboard-list":"shift-workspace"})[icon]} size={23}/></span><span className="center-home-action-copy"><strong>{title}</strong><small>{subtitle}</small></span><span aria-hidden="true">›</span></button>)}</div>
  </section>
  <section aria-label="Стан прийомів сьогодні" className="center-home-today">
   <div className="center-section-caption"><h2>Сьогодні</h2><button type="button" onClick={()=>onNavigate('shift-workspace')}>Відкрити прийоми <span aria-hidden="true">→</span></button></div>
   <div className="center-home-metrics">{stats.map(([title,value,subtitle])=><div className="center-home-metric" key={title}><span>{title}</span><strong>{value}</strong><small>{subtitle}</small></div>)}</div>
  </section>
  <section className="center-home-upcoming" aria-label="Найближчі прийоми">
   <div className="center-section-caption"><h2>Найближчі прийоми</h2><span>До 6 записів на сьогодні</span></div>
   {!snapshot&&error?<div className="center-home-empty">Записи недоступні. Повторіть завантаження після відновлення зв’язку.</div>:
    !snapshot?<div className="center-home-empty">Завантажуємо записи…</div>:
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
