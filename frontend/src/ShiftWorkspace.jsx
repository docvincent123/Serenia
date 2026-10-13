import React, { useEffect, useMemo, useRef, useState } from 'react';
import { filterVisits, visitKey, visitState } from './shift-workspace.mjs';

const stateLabels = {expected:'Очікуємо',arrived:'У центрі',completed:'Проконсультовано',excluded:'Не проведено',draft:'Чернетка'};
const kindLabels = {individual:'Індивідуальна',group:'Групова',family:'Сімейна',child:'Дитяча',crisis:'Кризова'};
const time = value => value?.slice(11,16) || '—';

export default function ShiftWorkspace({ api, shift, openPatient, openCalendar }) {
  const date = shift.shift_date;
  const [day, setDay] = useState(date);
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [psychologist, setPsychologist] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState('');
  const generation = useRef(0);
  const loadRef = useRef();
  const actionLock = useRef(false);
  async function load() {
    const request = ++generation.current;
    try {
      const data = await api('GET', `/api/shift-workspace?date=${day}`);
      if(request !== generation.current) return;
      if(!Array.isArray(data)) throw new Error('Не вдалося отримати список прийомів.');
      setRows(data); setLoaded(true); setError('');
      setUpdated(new Date().toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) { if(request === generation.current) setError(e.message); }
  }
  loadRef.current = load;
  useEffect(() => {
    setRows([]); setSelected(''); setLoaded(false); setError(''); loadRef.current();
    const timer = setInterval(() => { if(!document.hidden && !actionLock.current) loadRef.current(); }, 30000);
    return () => { ++generation.current; clearInterval(timer); };
  }, [day]);
  const counts = useMemo(() => ({active:rows.filter(r=>['expected','arrived'].includes(visitState(r))).length,
    arrived:rows.filter(r=>visitState(r)==='arrived').length, completed:rows.filter(r=>visitState(r)==='completed').length,
    excluded:rows.filter(r=>visitState(r)==='excluded').length}), [rows]);
  const visible = filterVisits(rows,{tab,psychologist,query});
  const detail = visible.find(r=>visitKey(r)===selected);
  const psychologists = [...new Map(rows.map(row=>[row.psychologist_id,row.psychologist])).entries()];
  async function arrive(row) {
    if(actionLock.current) return;
    actionLock.current=true; setBusy(true); setError('');
    try {
      await api('POST', `/api/appointments/${row.appointment_id}/arrival`, {patient_id:row.patient_id});
      await loadRef.current();
    } catch(e) { setError(e.message); }
    finally {actionLock.current=false;setBusy(false);}
  }
  return <div className="shift-workspace">
    <header className="page-head"><div><div className="eyebrow">РОБОЧИЙ СПИСОК ЦЕНТРУ</div><h1>Прийоми за зміну</h1>
      <p>Прибуття, психолог і результат прийому — в одному робочому списку.</p></div>
      <div className="page-actions"><button className="button secondary" disabled={busy} onClick={load}>Оновити список</button>
        <button className="button primary" onClick={openCalendar}>Записати на прийом</button></div></header>
    <div className="shift-summary" aria-label="Підсумок зміни">
      <article><span>Активні прийоми</span><strong>{counts.active}</strong></article>
      <article><span>У центрі</span><strong>{counts.arrived}</strong></article>
      <article><span>Проконсультовано</span><strong>{counts.completed}</strong></article>
      <article><span>Не проведено</span><strong>{counts.excluded}</strong></article>
    </div>
    {error && <div className="alert error" role="alert">{error} <button className="button ghost" onClick={load}>Повторити</button></div>}
    <section className="surface shift-controls">
      <div className="shift-tabs" role="group" aria-label="Статус прийомів">{[['active','Активні'],['completed','Проконсультовані'],['excluded','Не проведені']].map(([key,label])=>
        <button key={key} aria-pressed={tab===key} className={tab===key?'active':''} onClick={()=>{setTab(key);setSelected('');}}>{label} <span>{counts[key]}</span></button>)}</div>
      <div className="shift-filters"><label>Дата зміни<input type="date" value={day} disabled={busy} onChange={e=>{if(e.target.value)setDay(e.target.value);}} /></label>
        <label>Психолог<select value={psychologist} onChange={e=>setPsychologist(e.target.value)}><option value="">Усі психологи</option>
          {psychologists.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label className="shift-search">Знайти пацієнта<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ПІБ, номер картки або телефон" /></label></div>
    </section>
    <div className="shift-columns">
      <section className="surface shift-roster"><div className="section-head"><h2>{tab==='completed'?'Завершені консультації':tab==='excluded'?'Не проведені прийоми':'Активні пацієнти'}</h2><small>{updated ? `Оновлено о ${updated}` : 'Завантаження…'}</small></div>
        <p className="shift-explanation">{tab==='completed'?'Це завершені прийоми за обрану дату. Пацієнти залишаються на супроводі; завершення курсу оформлюється окремо.':'Один рядок — один пацієнт у прийомі. Учасники групи обліковуються окремо.'}</p>
        {!loaded && !error ? <p role="status">Завантажуємо прийоми…</p> : visible.length===0 ? <div className="shift-empty"><strong>{query||psychologist?'Немає збігів':'У цьому списку поки немає пацієнтів'}</strong><p>{tab==='active'?'Нові прийоми створюються у календарі.':'Список оновиться після зміни статусу прийомів.'}</p></div> :
          <div className="shift-visit-list">{visible.map(row=><button key={visitKey(row)} className={`shift-visit ${selected===visitKey(row)?'selected':''}`} aria-pressed={selected===visitKey(row)} onClick={()=>setSelected(visitKey(row))}>
            <span className="shift-time"><strong>{time(row.start)}</strong><small>{time(row.end)}</small></span>
            <span className="shift-person"><strong>{row.patient}</strong><span>№ {row.patient_no || '—'} · {row.psychologist}</span><small>{row.room} · {kindLabels[row.kind] || row.kind}</small></span>
            <span className={`visit-status ${visitState(row)}`}>{stateLabels[visitState(row)]}</span>
          </button>)}</div>}
      </section>
      <aside className="surface shift-detail"><div className="eyebrow">КАРТКА ПРИЙОМУ</div>{!detail ? <div className="shift-empty"><strong>Оберіть пацієнта</strong><p>Контактні дані, час і доступні дії з’являться тут.</p></div> : <>
        <h2>{detail.patient}</h2><span className={`visit-status ${visitState(detail)}`}>{stateLabels[visitState(detail)]}</span>
        <dl>{[['Номер картки',detail.patient_no],['Телефон',detail.phone],['Категорія',detail.category],['Психолог',detail.psychologist],['Кабінет',detail.room],['Прийом',`${time(detail.start)} — ${time(detail.end)}`],['Прибув / прибула',detail.arrived_at ? time(detail.arrived_at):'Ще не відмічено'],['Проконсультовано',detail.completed_at ? time(detail.completed_at):'Ще не завершено']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
        {visitState(detail)==='expected' && day===date && <button className="button primary" disabled={busy} onClick={()=>arrive(detail)}>{busy?'Зберігаємо…':'Пацієнт прибув'}</button>}
        <button className="button secondary" onClick={()=>openPatient(detail.patient_id)}>Відкрити картку пацієнта</button>
        <small>Консультацію завершує психолог у своєму застосунку. Зміст консультації в цьому списку не показується.</small>
      </>}</aside>
    </div>
  </div>;
}
