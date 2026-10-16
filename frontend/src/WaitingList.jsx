import React, { useEffect, useRef, useState } from 'react';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const statuses = { waiting: 'Очікує', offered: 'Час запропоновано', booked: 'Записано', cancelled: 'Закрито' };
const activeRow = row => ['waiting','offered'].includes(row.status);
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('uk-UA',{day:'numeric',month:'short'});
const emptyForm = () => ({ patient_id: '', date_from: today(), date_to: today(), time_from: '09:00', time_to: '18:00', priority: 'normal', contact_note: '' });

export default function WaitingList({ api, openPatient, Modal }) {
  const [rows,setRows]=useState([]),[patients,setPatients]=useState([]),[meta,setMeta]=useState({rooms:[]});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState('');
  const [filter,setFilter]=useState('active'),[query,setQuery]=useState(''),[patientQuery,setPatientQuery]=useState('');
  const [create,setCreate]=useState(false),[selected,setSelected]=useState(null),[slots,setSlots]=useState(null),[slotError,setSlotError]=useState(''),[slot,setSlot]=useState(null),[consent,setConsent]=useState(false),[refresh,setRefresh]=useState(0);
  const [form,setForm]=useState(emptyForm),[booking,setBooking]=useState({date:today(),room_id:'',duration:60});
  const saving=useRef(false);
  async function load() {
    setLoading(true);
    try { const [r,p,m]=await Promise.all([api('GET','/api/waiting-list'),api('GET','/api/patients'),api('GET','/api/meta')]);setRows(r);setPatients(p);setMeta(m); }
    catch(e){setError(e.message);}finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[api]);
  useEffect(()=>{
    let alive=true;setSlots(null);setSlot(null);setConsent(false);setSlotError('');
    if(!selected||!booking.room_id||!booking.date||booking.date<selected.date_from||booking.date>selected.date_to||booking.duration<15||booking.duration>240)return;
    api('GET',`/api/slots?date=${booking.date}&psychologist_id=${selected.psychologist_id}&room_id=${booking.room_id}&duration_minutes=${booking.duration}`)
      .then(times=>{if(alive)setSlots(times.map(time=>{const [h,m]=time.split(':').map(Number),end=h*60+m+Number(booking.duration);return {start:`${booking.date}T${time}`,end:`${booking.date}T${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`};}).filter(s=>s.start.slice(11)>=selected.time_from&&s.end.slice(11)<=selected.time_to));})
      .catch(e=>{if(alive)setSlotError(e.message);});
    return()=>{alive=false;};
  },[api,selected,booking,refresh]);
  function close(){if(saving.current)return;setCreate(false);setSelected(null);setError('');}
  async function add(e){
    e.preventDefault();if(saving.current)return;setError('');
    if(form.date_from>form.date_to||form.time_from>=form.time_to){setError('Перевірте діапазон: початок має бути раніше завершення.');return;}
    saving.current=true;setBusy(true);
    try{const p=patients.find(p=>Number(p.id)===Number(form.patient_id));await api('POST','/api/waiting-list',{...form,patient_id:Number(form.patient_id),psychologist_id:Number(p?.psychologist_id)});setCreate(false);setNotice('Пацієнта додано в лист очікування.');await load();}
    catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}
  }
  async function change(row,status){
    if(saving.current)return;
    if(status==='cancelled'&&!window.confirm(`Закрити очікування для ${row.patient}?`))return;
    saving.current=true;setBusy(true);setError('');
    try{await api('PATCH',`/api/waiting-list/${row.id}`,{status,version:row.version});setNotice(status==='offered'?'Позначено: час запропоновано пацієнту.':'Статус очікування оновлено.');await load();}
    catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}
  }
  async function book(e){
    e.preventDefault();if(saving.current||!slot||!consent)return;
    saving.current=true;setBusy(true);setError('');
    try{await api('POST',`/api/waiting-list/${selected.id}/book`,{version:selected.version,room_id:Number(booking.room_id),start:slot.start,end:slot.end});setNotice(`${selected.patient}: записано на ${dateLabel(booking.date)}, ${slot.start.slice(11)}.`);setSelected(null);await load();}
    catch(e){setError(e.message);setRefresh(x=>x+1);}finally{saving.current=false;setBusy(false);}
  }
  const active=rows.filter(activeRow),normalQuery=query.trim().toLocaleLowerCase('uk');
  const shown=rows.filter(r=>(filter==='active'?activeRow(r):filter==='history'?!activeRow(r):r.status===filter)&&[r.patient,r.patient_no,r.phone,r.psychologist].some(v=>String(v||'').toLocaleLowerCase('uk').includes(normalQuery)));
  const eligible=patients.filter(p=>p.status==='active'&&p.psychologist_id);
  const matching=eligible.filter(p=>[p.name,p.patient_no,p.phone].some(v=>String(v||'').toLocaleLowerCase('uk').includes(patientQuery.trim().toLocaleLowerCase('uk'))));
  const chosenPatient=eligible.find(p=>String(p.id)===String(form.patient_id));
  return <div className="waiting-workspace">
    <div className="page-head"><div><div className="eyebrow">РЕЄСТРАТУРА</div><h1>Лист очікування</h1><p>Побажання пацієнтів і запис на вільний час — в одному місці.</p></div><button className="button primary" onClick={()=>{setForm(emptyForm());setPatientQuery('');setCreate(true);setError('');}}>+ Додати в очікування</button></div>
    <div className="waiting-summary"><article><span>В очікуванні</span><strong>{active.filter(r=>r.status==='waiting').length}</strong></article><article><span>Чекаємо відповіді</span><strong>{active.filter(r=>r.status==='offered').length}</strong></article><article><span>Уже записано</span><strong>{rows.filter(r=>r.status==='booked').length}</strong></article></div>
    {notice&&<div className="booking-success" role="status">{notice}<button aria-label="Сховати сповіщення" onClick={()=>setNotice('')}>×</button></div>}
    {error&&!create&&!selected&&<div className="alert error" role="alert">{error}</div>}
    <section className="surface waiting-queue"><div className="waiting-toolbar"><label className="waiting-search"><span>Пошук у листі очікування</span><input type="search" placeholder="ПІБ, телефон, № картки або психолог" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="waiting-filter"><span>Показати</span><select aria-label="Показати" value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Усі активні</option><option value="waiting">Очікують</option><option value="offered">Час запропоновано</option><option value="history">Завершені</option></select></label><button className="button secondary" disabled={loading||busy} onClick={()=>{setError('');void load();}}>Оновити</button></div>
      <div className="waiting-list-caption"><strong>{shown.length} записів</strong><span>Спершу — підвищений пріоритет, далі — черга звернення</span></div>
      {loading?<p className="empty" role="status">Завантажуємо лист очікування…</p>:!shown.length?<div className="empty"><h3>{query?'Нічого не знайдено':'Тут поки немає записів'}</h3><p>{query?'Спробуйте інше ім’я або номер телефону.':'Додайте пацієнта, якщо потрібний час поки зайнятий.'}</p></div>:<div className="waiting-grid">{shown.map(row=><article className="waiting-card" key={row.id}>
        <div className="waiting-person"><button className="waiting-patient" onClick={()=>openPatient(row.patient_id)}>{row.patient}</button><p>№ {row.patient_no} · {row.psychologist}</p><a href={row.phone?`tel:${row.phone}`:undefined}>{row.phone||'Телефон не вказано'}</a></div>
        <div className="waiting-preferences"><strong>{dateLabel(row.date_from)} — {dateLabel(row.date_to)}</strong><span>{row.time_from}–{row.time_to}</span>{row.contact_note&&<p>{row.contact_note}</p>}</div>
        <div className="waiting-state"><span className={`badge ${row.status==='booked'?'forest':'sand'}`}>{statuses[row.status]}</span>{row.priority==='high'&&<span className="badge rose">Підвищений пріоритет</span>}</div>
        {activeRow(row)&&<div className="waiting-actions"><button className="button primary" disabled={busy} onClick={()=>{setSelected(row);setBooking({date:today()>row.date_from&&today()<=row.date_to?today():row.date_from,room_id:String(meta.rooms.filter(r=>r.active!==false)[0]?.id||''),duration:meta.workflow?.default_duration_minutes||60});setError('');}}>Підібрати час</button><details><summary>Інші дії</summary><button disabled={busy} onClick={()=>change(row,row.status==='waiting'?'offered':'waiting')}>{row.status==='waiting'?'Позначити: час запропоновано':'Повернути в очікування'}</button><button disabled={busy} onClick={()=>change(row,'cancelled')}>Закрити очікування</button></details></div>}
      </article>)}</div>}
    </section>
    {(create||selected)&&<Modal title={create?'Нове очікування':'Підібрати час'} subtitle={create?'Оберіть пацієнта та вкажіть зручний період.':`${selected.patient} · ${selected.psychologist}`} wide className="waiting-dialog" onClose={close}>
      {error&&<div className="alert error" role="alert">{error}</div>}
      {create?<form onSubmit={add}><fieldset disabled={busy}><legend>1. Пацієнт</legend><label className="field"><span>Знайти пацієнта</span><input type="search" value={patientQuery} onChange={e=>setPatientQuery(e.target.value)} placeholder="Прізвище, № картки або телефон"/></label><label className="field"><span>Пацієнт</span><select aria-label="Пацієнт" required value={form.patient_id} onChange={e=>setForm({...form,patient_id:e.target.value})}><option value="">Оберіть пацієнта</option>{eligible.filter(p=>matching.includes(p)||String(p.id)===String(form.patient_id)).map(p=><option key={p.id} value={p.id}>{p.name} · № {p.patient_no}</option>)}</select></label>{chosenPatient&&<p className="waiting-assignment">Психолог: <strong>{chosenPatient.psychologist||'Призначений у картці'}</strong></p>}</fieldset>
        <fieldset disabled={busy}><legend>2. Зручні дні та час</legend><div className="form-grid">{[['date_from','З дати','date'],['date_to','До дати','date'],['time_from','Не раніше','time'],['time_to','Не пізніше','time']].map(([key,label,type])=><label className="field" key={key}><span>{label}</span><input required type={type} min={key==='date_to'?form.date_from:undefined} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}<label className="field"><span>Пріоритет</span><select aria-label="Пріоритет" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="normal">Звичайний</option><option value="high">Підвищений</option></select></label><label className="field full"><span>Як зв’язатися / побажання</span><textarea rows={3} maxLength={1000} value={form.contact_note} onChange={e=>setForm({...form,contact_note:e.target.value})} placeholder="Наприклад: телефонувати після 15:00. Без клінічних нотаток."/></label></div></fieldset><div className="booking-footer"><span>Запис на прийом з’явиться після вибору часу.</span><button type="button" className="button secondary" disabled={busy} onClick={close}>Скасувати</button><button className="button primary" disabled={busy}>{busy?'Зберігаємо…':'Додати в очікування'}</button></div>
      </form>:<form onSubmit={book}><div className="waiting-booking-layout"><div><p className="waiting-range">Побажання: {dateLabel(selected.date_from)} — {dateLabel(selected.date_to)}, {selected.time_from}–{selected.time_to}</p><div className="form-grid"><label className="field"><span>Дата</span><input type="date" required disabled={busy} min={selected.date_from} max={selected.date_to} value={booking.date} onChange={e=>setBooking({...booking,date:e.target.value})}/></label><label className="field"><span>Кабінет</span><select aria-label="Кабінет" required disabled={busy} value={booking.room_id} onChange={e=>setBooking({...booking,room_id:e.target.value})}><option value="">Оберіть кабінет</option>{meta.rooms.filter(r=>r.active!==false).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className="field"><span>Тривалість, хв</span><input required disabled={busy} type="number" min={15} max={240} value={booking.duration} onChange={e=>setBooking({...booking,duration:Number(e.target.value)})}/></label></div><h3>Доступний час</h3>{slotError?<div className="alert error" role="alert">{slotError}<button type="button" className="button secondary" onClick={()=>setRefresh(x=>x+1)}>Повторити пошук</button></div>:!booking.room_id?<p>Оберіть кабінет.</p>:slots===null?<p role="status">{booking.duration<15||booking.duration>240?'Тривалість має бути від 15 до 240 хвилин.':'Перевіряємо розклад…'}</p>:!slots.length?<p className="waiting-no-slots">У цей день відповідного часу немає. Спробуйте іншу дату, кабінет або тривалість.</p>:<div className="waiting-slots" role="group" aria-label="Доступний час">{slots.map(s=><button type="button" className="button secondary" aria-pressed={slot?.start===s.start} disabled={busy} key={s.start} onClick={()=>{setSlot(s);setConsent(false);}}>{s.start.slice(11)} — {s.end.slice(11)}</button>)}</div>}</div><aside className="booking-summary"><span className="eyebrow">ПЕРЕВІРТЕ ЗАПИС</span><h3>{selected.patient}</h3><dl><div><dt>Психолог</dt><dd>{selected.psychologist}</dd></div><div><dt>Дата</dt><dd>{dateLabel(booking.date)}</dd></div><div><dt>Час</dt><dd>{slot?`${slot.start.slice(11)} — ${slot.end.slice(11)}`:'Оберіть час ліворуч'}</dd></div><div><dt>Кабінет</dt><dd>{meta.rooms.find(r=>String(r.id)===booking.room_id)?.name||'—'}</dd></div></dl><label className="waiting-consent"><input type="checkbox" checked={consent} disabled={busy||!slot} onChange={e=>setConsent(e.target.checked)}/><span>Пацієнт погодив дату й час</span></label></aside></div><div className="booking-footer"><span>Зайнятість повторно перевіряється під час запису.</span><button type="button" className="button secondary" disabled={busy} onClick={close}>Скасувати</button><button className="button primary" disabled={busy||!slot||!consent}>{busy?'Записуємо…':'Записати пацієнта'}</button></div></form>}
    </Modal>}
  </div>;
}
