import React,{useCallback,useEffect,useRef,useState} from 'react';
import './center-home.css';
import AppIcon from './AppIcon.jsx';

const formatDay=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return 'Сьогодні';
  return new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
};
const formatTime=value=>typeof value==='string'?value.slice(11,16)||'—':'—';
const administratorLinks=[
  ['team','Працівники','Ролі й доступ'],
  ['psychologist-roster','Психологи на зміні','Хто зараз вільний'],
  ['rooms','Кабінети','Розміщення прийомів'],
  ['reports','Звіти','Підсумки роботи'],
  ['devices','Пристрої','Підключені робочі місця'],
  ['settings','Налаштування','Параметри центру']
];
const receptionLinks=[
  ['shift-workspace','Прийоми за зміну','Прибуття та виклики'],
  ['psychologist-roster','Психологи на зміні','Доступні спеціалісти'],
  ['calendar','Календар','Час і кабінети'],
  ['patients','Пацієнти й документи','Картки, сканування, підписи']
];

export default function CenterHome({api,role,onNavigate,onRegister,onBook,onOpenPatient}){
  const isReception=role==='reception';
  const [snapshot,setSnapshot]=useState(null);
  const [error,setError]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const [lastSync,setLastSync]=useState(null);
  const requestId=useRef(0),apiRef=useRef(api);
  apiRef.current=api;
  const reload=useCallback(async()=>{
    const id=++requestId.current;
    setRefreshing(true);
    try{
      const data=await apiRef.current('GET','/api/workday/home');
      if(!data?.counts||!Array.isArray(data.next))throw new Error('Некоректна відповідь сервера.');
      if(id===requestId.current){setSnapshot(data);setError('');setLastSync(new Date());}
    }catch(e){
      if(id===requestId.current){setError(e.message);setSnapshot(null);}
    }finally{if(id===requestId.current)setRefreshing(false);}
  },[]);
  useEffect(()=>{
    void reload();
    const timer=setInterval(()=>{if(!document.hidden)void reload();},30000);
    const changed=()=>{if(!document.hidden)void reload();};
    window.addEventListener('solvia:workflow-updated',changed);
    return()=>{++requestId.current;clearInterval(timer);window.removeEventListener('solvia:workflow-updated',changed);};
  },[reload]);

  const counts=snapshot?.counts||{};
  const stats=[
    ['Очікують прибуття',counts.waiting,'Ще не відмічені','waiting'],
    ['У центрі',counts.arrived,'Прибули або на консультації','arrived'],
    ['Завершено',counts.completed,'Проведені прийоми','completed']
  ];
  const links=isReception?receptionLinks:administratorLinks;
  const upcoming=[...(snapshot?.next||[])].sort((a,b)=>String(a.start||'').localeCompare(String(b.start||''))).slice(0,6);
  const syncLabel=error?'Немає зв’язку з сервером':refreshing?'Оновлюємо дані…':lastSync?'Оновлено о '+lastSync.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):'Підключаємося…';

  return <div className="center-home flow-desk" data-flow-role={role}>
    <header className="flow-desk-hero">
      <div className="flow-desk-title">
        <div className="flow-desk-overline"><span className="flow-desk-overline-mark"/> SOLVIA <span className="flow-desk-overline-divider">/</span> {isReception?'РОБОЧЕ МІСЦЕ РЕЄСТРАТОРА':'АДМІНІСТРУВАННЯ'}</div>
        <h1>{isReception?'Реєстратура':'Керування центром'}</h1>
        <p>{formatDay(snapshot?.date)} <span aria-hidden="true">·</span> {isReception?'Записи, прибуття та пацієнти без зайвих переходів':'Головні показники та інструменти адміністратора'}</p>
      </div>
      <div className="flow-desk-hero-actions">
        <span role="status" aria-live="polite" className={'flow-desk-sync'+(error?' is-error':'')}>{syncLabel}</span>
        <button className="flow-desk-reload" type="button" onClick={reload} disabled={refreshing} aria-label="Оновити дані"><AppIcon name="refresh" size={17}/> Оновити</button>
        <button className="flow-desk-create" type="button" onClick={isReception?onBook:()=>onNavigate('shift-workspace')}>
          <AppIcon name={isReception?'new-booking':'shift-workspace'} size={18}/>{isReception?'Записати на прийом':'Список прийомів'}
        </button>
      </div>
    </header>

    {error&&<div role="alert" className="alert error flow-desk-error"><div><strong>З’єднання втрачено</strong><p>{error}. Дані прийомів приховано, щоб не показувати застарілий список. {lastSync?'Остання успішна перевірка: '+lastSync.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):''}</p></div><button type="button" className="button secondary" onClick={reload} disabled={refreshing}>{refreshing?'Перевіряємо…':'Повторити перевірку'}</button></div>}

    <section className="flow-desk-today" aria-label="Показники за сьогодні">
      <div className="flow-desk-section-head"><div><span className="flow-desk-section-label">ОГЛЯД</span><h2>Сьогодні в центрі</h2></div><button className="flow-desk-text-link" onClick={()=>onNavigate('shift-workspace')} type="button">Усі прийоми <AppIcon name="arrow-right" size={16}/></button></div>
      <div className="flow-desk-metrics">{stats.map(([label,value,caption,tone])=><button type="button" key={tone} className="flow-desk-metric" data-tone={tone} onClick={()=>onNavigate('shift-workspace')} aria-label={label+': '+(error||!snapshot?'дані недоступні':value)+'. Відкрити прийоми'}>
        <span className="flow-desk-metric-header"><span className="flow-desk-metric-bullet"/>{label}</span>
        <strong>{error||!snapshot?'—':value??0}</strong>
        <span className="flow-desk-metric-caption">{caption}</span>
      </button>)}</div>
    </section>

    <div className="flow-desk-columns">
      <section className="flow-desk-visits" aria-label="Найближчі прийоми">
        <div className="flow-desk-section-head"><div><span className="flow-desk-section-label">РОБОЧИЙ СПИСОК</span><h2>Найближчі прийоми</h2></div><button type="button" className="flow-desk-text-link" onClick={()=>onNavigate('shift-workspace')}>Відкрити список <AppIcon name="arrow-right" size={16}/></button></div>
        <div className="flow-desk-table-wrap">
          <div className="flow-desk-table-head" aria-hidden="true"><span>Час</span><span>Пацієнт</span><span>Психолог / кабінет</span><span>Статус</span></div>
          {!snapshot ? <div className="flow-desk-empty" role="status">{error?'Немає зв’язку із сервером.':'Завантажуємо записи…'}</div>
            : !upcoming.length ? <div className="flow-desk-empty"><AppIcon name="calendar" size={24}/><strong>Прийомів на сьогодні немає</strong><span>Нові записи з’являтимуться тут автоматично.</span></div>
            : upcoming.map(v=><button type="button" className="flow-desk-visit" key={String(v.appointment_id)+':'+String(v.patient_id)} onClick={()=>onOpenPatient(v.patient_id)} aria-label={'Відкрити картку '+v.patient+', '+formatTime(v.start)}>
              <time dateTime={v.start||undefined}>{formatTime(v.start)}</time>
              <span className="flow-desk-visit-patient"><strong>{v.patient||'Пацієнт'}</strong><small>№ {v.patient_no||'—'}</small></span>
              <span className="flow-desk-visit-psychologist"><strong>{v.psychologist||'Не призначено'}</strong><small>{v.room||'Кабінет не вказано'}</small></span>
              <span className={'flow-desk-visit-badge'+(v.arrived_at?' arrived':'')}>{v.arrived_at?'Прибув':'Очікується'}</span>
            </button>)}
        </div>
        <footer className="flow-desk-visits-footer">
          <span>Активні пацієнти: <strong>{snapshot?.active_patients??'—'}</strong></span>
          <button type="button" onClick={()=>onNavigate('waiting-list')}>Лист очікування <strong>{snapshot?.waiting_list??'—'}</strong><AppIcon name="arrow-right" size={15}/></button>
        </footer>
      </section>

      <aside className="flow-desk-panel" aria-label={isReception?'Швидкі дії реєстратури':'Інструменти адміністратора'}>
        <div className="flow-desk-section-head"><div><span className="flow-desk-section-label">{isReception?'ДІЇ':'АДМІНІСТРУВАННЯ'}</span><h2>{isReception?'Швидкий початок':'Панель керування'}</h2></div></div>
        {isReception&&<div className="flow-desk-primary-actions">
          <button type="button" onClick={onRegister}><span><AppIcon name="new-patient" size={20}/></span><strong>Новий пацієнт</strong><small>Створити картку</small></button>
          <button type="button" onClick={onBook}><span><AppIcon name="new-booking" size={20}/></span><strong>Новий запис</strong><small>Обрати час</small></button>
        </div>}
        <div className="flow-desk-shortcuts">{links.map(([key,title,subtitle])=><button className="flow-desk-shortcut" key={key} onClick={()=>onNavigate(key)} type="button">
          <span className="flow-desk-shortcut-icon"><AppIcon name={key} size={18}/></span>
          <span className="flow-desk-shortcut-copy"><strong>{title}</strong><small>{subtitle}</small></span>
          <AppIcon name="arrow-right" size={16}/>
        </button>)}</div>
        <div className="flow-desk-panel-note"><AppIcon name="check" size={16}/><span>Статуси й прийоми надходять із сервера. Для оновлення натисніть «Оновити».</span></div>
      </aside>
    </div>
  </div>;
}
