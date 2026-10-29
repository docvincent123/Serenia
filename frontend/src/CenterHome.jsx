import React,{useCallback,useEffect,useRef,useState} from 'react';
import './center-home.css';
import AppIcon from './AppIcon.jsx';

const quickByRole={
 admin:[
  ['shift-workspace','Прийоми сьогодні','Прибуття, виклик на TV','shift-workspace'],
  ['patients','Пацієнти','Знайти картку та історію','patients'],
  ['calendar','Календар','Записи, графіки й кабінети','calendar'],
  ['team','Команда','Працівники та ролі','team']
 ],
 reception:[
  ['new-patient','Новий пацієнт','Створити реєстраційну картку','new-patient'],
  ['new-booking','Записати на прийом','Обрати психолога й час','new-booking'],
  ['shift-workspace','Прийоми сьогодні','Відмітити прибуття, викликати на TV','shift-workspace'],
  ['calendar','Календар','Вільні години та кабінети','calendar']
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
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false),[lastSync,setLastSync]=useState(null);
 const apiRef=useRef(api),sequence=useRef(0);apiRef.current=api;
 const reload=useCallback(async()=>{
  const request=++sequence.current;
  setRefreshing(true);
  try{
   const data=await apiRef.current('GET','/api/workday/home');
   if(!data?.counts||!Array.isArray(data.next))throw new Error('Некоректна відповідь сервера для головного екрана.');
   if(request===sequence.current){setSnapshot(data);setError('');setLastSync(new Date());}
  }catch(e){if(request===sequence.current){setError(e.message);setSnapshot(null);}}
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
 const actions=quickByRole[role]||quickByRole.admin;
 const nextVisits=[...(snapshot?.next||[])].sort((a,b)=>String(a.start||'').localeCompare(String(b.start||'')));
 const syncMessage=error?'Немає зв’язку із сервером':refreshing?'Оновлюємо дані…':lastSync?'Оновлено о '+lastSync.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):'Завантажуємо дані…';
 return <div className="center-home">
  <header className="center-home-intro">
   <div className="center-home-intro-copy"><span className="eyebrow">SOLVIA · РОБОЧИЙ ПРОСТІР</span><h1>{role==='reception'?'Реєстратура':'Головна центру'}</h1>
    <p>{snapshot?fmtDate(snapshot.date):'Сьогодні'} · {role==='reception'?'Пацієнти, записи та прийоми в одному місці':'Усе важливе про роботу центру сьогодні'}</p>
   </div>
   <div className="center-home-intro-controls">
    <span role="status" aria-live="polite" className={'center-home-sync'+(error?' is-error':'')+(refreshing?' is-loading':'')}>{syncMessage}</span>
    <button className="button secondary center-home-refresh" type="button" onClick={reload} disabled={refreshing} aria-label="Оновити дані головної сторінки"><AppIcon name="refresh" size={17}/> Оновити</button>
    <button className="button center-home-primary" type="button" onClick={()=>role==='reception'?onBook():onNavigate('shift-workspace')}><AppIcon name={role==='reception'?'new-booking':'shift-workspace'} size={18}/>{role==='reception'?'Записати на прийом':'Прийоми сьогодні'}</button>
   </div>
  </header>
  {error&&<div role="alert" className="alert error">Не вдалося отримати дані з сервера: {error} <button type="button" className="button secondary" onClick={reload}>Повторити</button></div>}
  <section className="center-home-actions" aria-label="Основні дії">
   <div className="center-section-caption"><h2>Швидкі дії</h2><span>Один клік до потрібної роботи</span></div>
   <div className="center-home-action-grid">{actions.map(([key,title,subtitle,icon],index)=><button type="button" className={'center-home-action'+(index===0?' is-highlight':'')} key={key} onClick={()=>act(key)}><span className="center-home-action-icon"><AppIcon name={icon} size={23}/></span><span className="center-home-action-copy"><strong>{title}</strong><small>{subtitle}</small></span><AppIcon name="arrow-right" size={17}/></button>)}</div>
  </section>
  <section aria-label="Стан прийомів сьогодні" className="center-home-today">
   <div className="center-section-caption"><h2>Сьогодні</h2><button type="button" onClick={()=>onNavigate('shift-workspace')}>Відкрити прийоми <span aria-hidden="true">→</span></button></div>
   <div className="center-home-metrics">{stats.map(([title,value,subtitle],index)=><div className="center-home-metric" key={title} data-tone={['waiting','arrived','completed'][index]}><span>{title}</span><strong>{error?'—':value}</strong><small>{subtitle}</small></div>)}</div>
  </section>
  <section className="center-home-upcoming" aria-label="Найближчі прийоми">
   <div className="center-section-caption"><h2>Найближчі прийоми</h2><span>Список на сьогодні · до 6 записів</span></div>
   {!snapshot&&error?<div className="center-home-empty">Записи недоступні. Повторіть завантаження після відновлення зв’язку.</div>:
    !snapshot?<div className="center-home-empty">Завантажуємо записи…</div>:
    !nextVisits.length?<div className="center-home-empty"><AppIcon name="calendar" size={24}/><div><strong>Прийомів поки немає</strong><span>Нові записи автоматично з’являться тут.</span></div></div>:
    <div className="center-home-visits">{nextVisits.map(v=><button key={v.appointment_id+':'+v.patient_id} type="button" className="center-home-visit" onClick={()=>onOpenPatient(v.patient_id)} aria-label={'Відкрити картку '+v.patient+', прийом о '+(v.start?.slice(11,16)||'невідомий час')}>
     <time dateTime={v.start||undefined}>{v.start?.slice(11,16)||'—'}</time><span className="center-home-visit-person"><strong>{v.patient}</strong><small>№{v.patient_no||'—'} · {v.psychologist||'Психолог не вказаний'} · {v.room||'Кабінет не вказаний'}</small></span>
     <span className={v.arrived_at?'center-home-visit-state arrived':'center-home-visit-state'}>{v.arrived_at?'Прибув':'Очікується'}</span><AppIcon name="arrow-right" size={17}/>
    </button>)}</div>}
  </section>
  <div className="center-home-footer"><span>Активних пацієнтів: <b>{snapshot?.active_patients??'—'}</b> · Лист очікування: <b>{snapshot?.waiting_list??'—'}</b></span>
   <button type="button" className="center-home-more" onClick={()=>onNavigate('module-directory')}>Інші функції центру <span aria-hidden="true">→</span></button>
  </div>
 {role==='admin'&&<AdminServerStatus api={api}/>}
 </div>;
}
