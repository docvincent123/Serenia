import React, { useEffect, useMemo, useRef, useState } from 'react';
import { filterVisits, visitKey, visitState, waitingMinutes } from './shift-workspace.mjs';

const stateLabels = {expected:'Очікуємо прибуття',arrived:'Пацієнт прибув',in_progress:'Консультація триває',completed:'Завершена',excluded:'Не проведено',draft:'Чернетка'};
const kindLabels = {individual:'Індивідуальна',group:'Групова',family:'Сімейна',child:'Дитяча',crisis:'Кризова'};
const time = value => value?.slice(11,16) || '—';

export default function ShiftWorkspace({ api, shift, openPatient, openCalendar, onBook, onCreatePatient, refreshVersion, savedDate }) {
  const date = shift.shift_date;
  const [day, setDay] = useState(date);
  useEffect(()=>{if(savedDate)setDay(savedDate);},[savedDate]);
  const [rows, setRows] = useState([]);
  const [status,setStatus]=useState('');
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),30000);return()=>clearInterval(timer);},[]);
  const [tab, setTab] = useState('active');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [psychologist, setPsychologist] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState('');
  const [success,setSuccess]=useState('');
  const generation = useRef(0);
  const previousShiftDate = useRef(date);
  useEffect(() => {
    if (day === previousShiftDate.current) setDay(date);
    previousShiftDate.current = date;
  }, [date, day]);
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
    const timer = setInterval(() => { if(!document.hidden && !actionLock.current) loadRef.current(); }, 10000);
    const refresh=()=>{if(!document.hidden&&!actionLock.current)loadRef.current();};window.addEventListener('solvia:workflow-updated',refresh);
    return () => { ++generation.current; clearInterval(timer);window.removeEventListener('solvia:workflow-updated',refresh); };
  }, [day,refreshVersion]);
  const counts = useMemo(() => ({active:rows.filter(r=>['expected','arrived','in_progress'].includes(visitState(r))).length,
    expected:rows.filter(r=>visitState(r)==='expected').length,
    onsite:rows.filter(r=>['arrived','in_progress'].includes(visitState(r))).length,
    waiting:rows.filter(r=>visitState(r)==='arrived').length,
    inProgress:rows.filter(r=>visitState(r)==='in_progress').length,
    completed:rows.filter(r=>visitState(r)==='completed').length,
    excluded:rows.filter(r=>visitState(r)==='excluded').length}), [rows]);
  const visible = filterVisits(rows,{tab,psychologist,query,status});
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
  async function callOnTv(row){
    if(actionLock.current)return;actionLock.current=true;setBusy(true);setError('');setSuccess('');
    try{await api('POST','/api/tv/call',{appointment_id:row.appointment_id,patient_id:row.patient_id});setSuccess('Виклик передано на TV-табло.');await loadRef.current();}
    catch(e){setError(e.message);}finally{actionLock.current=false;setBusy(false);}
  }
  async function exclude(row,status) {
    const reason=window.prompt(status==='no_show'?'Причина неявки / коментар':'Причина скасування');
    if(!reason?.trim() || actionLock.current) return;
    actionLock.current=true;setBusy(true);setError('');
    try {await api('PATCH',`/api/appointments/${row.appointment_id}/attendance`,{patient_id:row.patient_id,status,reason});await loadRef.current();}
    catch(e){setError(e.message);}finally{actionLock.current=false;setBusy(false);}
  }
  return <div className="shift-workspace">
    <header className="page-head"><div><div className="eyebrow">РОБОЧИЙ СПИСОК ЦЕНТРУ</div><h1>Прийоми за зміну</h1>
      <p>Запис, прибуття та перебіг прийомів.</p></div>
      <div className="page-actions focus-reception-actions">
        <button className="button secondary" onClick={()=>onCreatePatient(day)}>+ Новий пацієнт</button>
        <button className="button primary" onClick={()=>onBook({date:day})}>+ Записати на прийом</button>
      </div></header>
    <div className="shift-summary focus-shift-summary" aria-label="Підсумок зміни">
      <article><span>Очікуємо прибуття</span><strong>{counts.expected}</strong></article>
      <article><span>Очікують у центрі</span><strong>{counts.waiting}</strong></article>
      <article><span>На консультації</span><strong>{counts.inProgress}</strong></article>
      <article><span>Проконсультовано</span><strong>{counts.completed}</strong></article>
    </div>
    {success&&<div className="alert" role="status">{success}</div>}
    {error && <div className="alert error" role="alert">{error} <button className="button ghost" onClick={load}>Повторити</button></div>}
    <section className="surface shift-controls">
      <div className="shift-tabs" role="group" aria-label="Статус прийомів">{[['active','Активні'],['completed','Проконсультовані'],['excluded','Не проведені']].map(([key,label])=>
        <button key={key} aria-pressed={tab===key} className={tab===key?'active':''} onClick={()=>{setTab(key);setStatus('');setSelected('');}}>{label}</button>)}</div>
      <div className="focus-shift-search">
        {tab==='active'&&<label className="shift-search">Стан прийому<select value={status} onChange={e=>{setStatus(e.target.value);setSelected('');}}><option value="">Усі активні</option><option value="expected">Очікуємо прибуття</option><option value="arrived">Очікують у центрі</option><option value="in_progress">На консультації</option></select></label>}
        <label className="shift-search">Знайти пацієнта
          <input type="search" value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="ПІБ, номер картки або телефон" />
        </label>
        <button className="button secondary focus-filter-toggle" type="button" aria-expanded={filtersOpen}
          aria-controls="focus-visit-filters" onClick={()=>setFiltersOpen(v=>!v)}>
          Дата і психолог {psychologist || day !== date ? '• Застосовано' : ''}
        </button>
      </div>
      {filtersOpen && <div className="shift-filters focus-visit-filters" id="focus-visit-filters">
        <label>Дата зміни<input type="date" value={day} disabled={busy} onChange={e=>{if(e.target.value)setDay(e.target.value);}} /></label>
        <label>Психолог<select aria-label="Психолог" value={psychologist} onChange={e=>setPsychologist(e.target.value)}>
          <option value="">Усі психологи</option>
          {psychologists.map(([id,name])=><option key={id} value={id}>{name}</option>)}
        </select></label>
        {(query || psychologist) && <button className="button ghost" onClick={() => {setQuery('');setPsychologist('');setSelected('');}}>Скинути фільтри</button>}
        <button className="button secondary" onClick={openCalendar}>Відкрити календар</button>
      </div>}
    </section>
    <div className="shift-columns">
      <section className="surface shift-roster"><div className="section-head"><h2>{tab==='completed'?'Завершені консультації':tab==='excluded'?'Не проведені прийоми':'Активні пацієнти'}</h2><small>{updated ? `Оновлено о ${updated}` : 'Завантаження…'}</small></div>
        <p className="shift-explanation">{tab==='completed'?'Це завершені прийоми за обрану дату. Пацієнти залишаються на супроводі; завершення курсу оформлюється окремо.':'Один рядок — один пацієнт у прийомі. Учасники групи обліковуються окремо.'}</p>
        {!loaded && !error ? <p role="status">Завантажуємо прийоми…</p> : visible.length===0 ? <div className="shift-empty"><strong>{query||psychologist||status?'Немає збігів':tab==='completed'?'Завершених консультацій ще немає':tab==='excluded'?'Непроведених прийомів немає':counts.completed>0?'Усі консультації завершено':'На обрану дату консультацій немає'}</strong><p>{query||psychologist||status?'Змініть пошук або скиньте фільтри.':tab==='active'?'Натисніть «Записати на прийом», щоб додати консультацію.':'Список оновиться після зміни статусу прийомів.'}</p></div> :
          <div className="reception-table-scroll"><table className="reception-table">
            <caption className="sr-only">Прийоми за {day}. Оберіть пацієнта для доступних дій.</caption>
            <thead><tr><th scope="col">Час</th><th scope="col">Пацієнт</th><th scope="col">Психолог / кабінет</th><th scope="col">Статус</th><th scope="col">Очікування</th><th scope="col">Дії</th></tr></thead>
            <tbody>{visible.map(row=>{const waiting=waitingMinutes(row,clock);const state=visitState(row);return <tr key={visitKey(row)} className={selected===visitKey(row)?'selected':''}>
              <td className="shift-time"><strong>{time(row.start)}</strong><small>{time(row.end)}</small></td>
              <td><button className="visit-patient-link" onClick={()=>setSelected(visitKey(row))} aria-pressed={selected===visitKey(row)}>{row.patient}</button><small>№ {row.patient_no||'—'}</small></td>
              <td><strong>{row.psychologist}</strong><small>{row.room||'—'} · {kindLabels[row.kind]||row.kind}</small></td>
              <td><span className={`visit-status ${state}`}>{stateLabels[state]}</span>{state==='expected'&&Date.parse(row.start)<clock&&<small className="visit-attention">Час прийому минув</small>}</td>
              <td><span className={waiting>=15?'visit-attention':''}>{waiting===null?'—':`${waiting} хв`}</span></td>
              <td>{state==='expected'&&day===date?<button className="button secondary" disabled={busy} onClick={()=>arrive(row)}>Прибув</button>:state==='arrived'?<button className="button secondary" disabled={busy} onClick={()=>callOnTv(row)}>На TV</button>:<button className="button ghost" onClick={()=>setSelected(visitKey(row))}>Деталі</button>}</td>
            </tr>})}</tbody>
          </table></div>}

      </section>
      <aside className="surface shift-detail"><div className="eyebrow">КАРТКА ПРИЙОМУ</div>{!detail ? <div className="shift-empty"><strong>Оберіть пацієнта</strong><p>Контактні дані, час і доступні дії з’являться тут.</p></div> : <>
        <h2>{detail.patient}</h2><span className={`visit-status ${visitState(detail)}`}>{stateLabels[visitState(detail)]}</span>
        <div className="reception-detail-actions">        {visitState(detail)==='expected' && day===date && <button className="button primary" disabled={busy} onClick={()=>arrive(detail)}>{busy?'Зберігаємо…':'Пацієнт прибув'}</button>}
        {visitState(detail)==='arrived'&&<button className="button primary" disabled={busy} onClick={()=>callOnTv(detail)}>Запросити на TV</button>}
        {['expected','arrived'].includes(visitState(detail)) && <button className="button secondary" disabled={busy} onClick={()=>onBook({date:detail.start.slice(0,10),appointmentId:detail.appointment_id})}>Перенести прийом</button>}
        <button className="button secondary" onClick={()=>openPatient(detail.patient_id)}>Відкрити картку пацієнта</button>
</div>
        <dl className="focus-visit-essential">{[['Психолог',detail.psychologist],['Кабінет',detail.room],['Час',`${time(detail.start)} — ${time(detail.end)}`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
        <details className="focus-visit-more"><summary>Контакти й додаткові відомості</summary>
          <dl>{[['Номер картки',detail.patient_no],['Телефон',detail.phone],['Категорія',detail.category],['Прибув / прибула',detail.arrived_at ? time(detail.arrived_at):'Ще не відмічено'],['Початок консультації',detail.started_at ? time(detail.started_at):'Ще не розпочато'],['Проконсультовано',detail.completed_at ? time(detail.completed_at):'Ще не завершено']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
        </details>
<details className="reception-exceptions"><summary>Неявка або скасування</summary>        {['expected','arrived'].includes(visitState(detail)) && <div className="page-actions">
          <button className="button secondary" disabled={busy} onClick={()=>exclude(detail,'no_show')}>Неявка</button>
          <button className="button danger" disabled={busy} onClick={()=>exclude(detail,'cancelled')}>Скасувати</button>
        </div>}
</details>        <small>Консультацію завершує психолог у своєму застосунку. Зміст консультації в цьому списку не показується.</small>
      </>}</aside>
    </div>
  </div>;
}
