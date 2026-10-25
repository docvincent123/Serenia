import React, {useEffect, useMemo, useRef, useState} from 'react';
import {addMinutes, bookingProblem, matchesPatient} from './booking.mjs';

const kindLabels={individual:'Індивідуальна',family:'Сімейна',child:'Дитяча',crisis:'Кризова',group:'Групова'};
const dayLabel=date=> date ? new Date(`${date}T12:00:00`).toLocaleDateString('uk-UA',{day:'numeric',month:'long',year:'numeric'}) : 'Оберіть дату';

export default function AppointmentBooking({api, initial, Modal, onClose, onSaved, onCreatePatient}) {
  const editing=Boolean(initial.appointmentId);
  const [meta,setMeta]=useState(null),[patients,setPatients]=useState([]),[loading,setLoading]=useState(true);
  const [form,setForm]=useState({date:initial.date,patient_ids:[],psychologist_id:'',room_id:'',start:'',duration:60,kind:'individual',status:'scheduled',note:''});
  const [query,setQuery]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [slots,setSlots]=useState(null),[slotError,setSlotError]=useState(''),[refresh,setRefresh]=useState(0),[retryLoad,setRetryLoad]=useState(0);
  const saving=useRef(false),search=useRef(null);
  useEffect(()=>{
    let alive=true;
    async function load(){
      setLoading(true);setError('');
      try {
        const [m,p,appointments]=await Promise.all([api('GET','/api/meta'),api('GET','/api/patients'),editing?api('GET',`/api/appointments?date=${initial.date}`):Promise.resolve([])]);
        const appointment=editing?appointments.find(x=>Number(x.id)===Number(initial.appointmentId)):null;
        if(editing&&!appointment)throw new Error('Прийом не знайдено. Оновіть робочий список.');
        const selected=initial.patientId?p.find(x=>Number(x.id)===Number(initial.patientId)):null;
        if(initial.patientId&&!selected)throw new Error('Пацієнта не знайдено. Оновіть список пацієнтів.');
        if(!alive)return;
        setMeta(m);setPatients(p);
        setForm({date:initial.date,patient_ids:appointment?appointment.patients.map(x=>Number(x.id)):selected?[Number(selected.id)]:[],psychologist_id:String(appointment?.psychologist_id || selected?.psychologist_id || (m.psychologists?.some(p=>String(p.id)===String(initial.psychologistId))?initial.psychologistId:'')),room_id:String(appointment?.room_id || m.rooms?.[0]?.id || ''),start:appointment?.start?.slice(11,16) || initial.start || m.workflow?.opening_time || '08:00',duration:appointment?Math.round((new Date(appointment.end)-new Date(appointment.start))/60000):m.workflow?.default_duration_minutes || 60,kind:appointment?.kind || 'individual',status:appointment?.status || 'scheduled',note:appointment?.note || ''});
      }catch(e){if(alive)setError(e.message);}finally{if(alive)setLoading(false);}
    }
    load();return()=>{alive=false;};
  },[api,initial,editing,retryLoad]);
  useEffect(()=>{if(!loading&&!editing&&!form.patient_ids.length)search.current?.focus();},[loading,editing,form.patient_ids.length]);
  useEffect(()=>{
    let alive=true;setSlots(null);setSlotError('');
    if(!meta||!form.date||!form.psychologist_id||!form.room_id||form.duration<15||form.duration>240)return;
    const timer=setTimeout(async()=>{
      try{const result=await api('GET',`/api/slots?date=${form.date}&psychologist_id=${form.psychologist_id}&room_id=${form.room_id}&duration_minutes=${form.duration}`);if(alive)setSlots(result);}
      catch(e){if(alive)setSlotError(e.message);}
    },150);
    return()=>{alive=false;clearTimeout(timer);};
  },[api,meta,form.date,form.psychologist_id,form.room_id,form.duration,refresh]);
  const selected=patients.filter(p=>form.patient_ids.includes(Number(p.id)));
  const multi=form.kind==='group'||form.kind==='family';
  const results=useMemo(()=>patients.filter(p=>p.status!=='archived'&&matchesPatient(p,query)).slice(0,8),[patients,query]);
  const psychologist=meta?.psychologists?.find(p=>Number(p.id)===Number(form.psychologist_id));
  const room=meta?.rooms?.find(r=>Number(r.id)===Number(form.room_id));
  const end=addMinutes(form.start,form.duration);
  function choose(patient){
    const id=Number(patient.id);
    setForm(current=>{
      const removing=current.patient_ids.includes(id);
      if(!removing&&multi&&current.patient_ids.length&&Number(patient.psychologist_id)!==Number(current.psychologist_id))return current;
      const ids=removing?current.patient_ids.filter(x=>x!==id):multi?[...current.patient_ids,id]:[id];
      return {...current,patient_ids:ids,psychologist_id:ids.length?String(patient.psychologist_id):''};
    });
    setError('');
    if(!multi)setQuery('');
  }
  function changeKind(kind){setForm(current=>({...current,kind,patient_ids:['group','family'].includes(kind)?current.patient_ids:current.patient_ids.slice(0,1)}));}
  async function save(e){
    e.preventDefault();if(saving.current)return;
    const problem=bookingProblem(form,meta?.workflow);
    if(problem){setError(problem);return;}
    saving.current=true;setBusy(true);setError('');
    try{
      const body={psychologist_id:Number(form.psychologist_id),room_id:Number(form.room_id),patient_ids:form.patient_ids,start:`${form.date}T${form.start}`,end:`${form.date}T${end}`,kind:form.kind,status:form.status,note:form.note};
      const result=await api(editing?'PATCH':'POST',editing?`/api/appointments/${initial.appointmentId}`:'/api/appointments',body);
      onSaved({id:result.id || initial.appointmentId,date:form.date,start:form.start,patient:selected.map(p=>p.name).join(', '),editing});
    }catch(e){setError(e.message);setRefresh(x=>x+1);}finally{saving.current=false;setBusy(false);}
  }
  return <Modal title={editing?'Перенести / змінити прийом':'Запис на консультацію'} subtitle={editing?'Пацієнти й дані прийому вже підставлені.':'Оберіть пацієнта й зручний час.'} wide onClose={()=>{if(!saving.current)onClose();}}>
    <form className="booking-form" onSubmit={save}>
      {error&&<div className="alert error" role="alert">{error}{!meta&&!loading&&<button type="button" className="booking-text-action" onClick={()=>setRetryLoad(x=>x+1)}>Повторити завантаження</button>}</div>}
      {loading?<p role="status">Завантажуємо пацієнтів і розклад…</p>:meta&&<div className="booking-layout">
        <div className="booking-main"><section className="booking-section">
          <header><span className="booking-step">1</span><h3>{multi?'Пацієнти':'Пацієнт'}</h3><select className="booking-type-select" aria-label="Тип консультації" value={form.kind} disabled={busy||editing} onChange={e=>changeKind(e.target.value)}>{Object.entries(kindLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{!editing&&onCreatePatient&&<button type="button" className="booking-text-action" onClick={()=>onCreatePatient(form.date)}>+ Новий пацієнт</button>}</header>
          {!!selected.length&&<div className="booking-selected">{selected.map(p=><div key={p.id}><span><strong>{p.name}</strong><small>№ {p.patient_no || '—'} · {p.phone || 'Телефон не вказано'}</small></span>{!editing&&<button type="button" aria-label={`Прибрати ${p.name}`} disabled={busy} onClick={()=>choose(p)}>×</button>}</div>)}</div>}
          {editing?<p className="booking-hint">Учасники цього прийому зберігаються.</p>:<>
            {(multi||!selected.length||query)&&<label className="booking-field"><span>Знайти пацієнта</span><input ref={search} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Прізвище, номер картки або телефон" disabled={busy}/></label>}
            {(multi||!selected.length||query)&&<div className="booking-patient-results" role="group" aria-label="Знайдені пацієнти">{results.map(p=>{const checked=form.patient_ids.includes(Number(p.id));const other=multi&&selected.length>0&&Number(p.psychologist_id)!==Number(form.psychologist_id);return <button type="button" key={p.id} disabled={busy||Boolean(other)} aria-pressed={checked} onClick={()=>choose(p)}><span className={`booking-check ${checked?'checked':''}`} aria-hidden="true">{checked?'✓':'+'}</span><span><strong>{p.name}</strong><small>№ {p.patient_no || '—'} · {p.phone || '—'} · {other?'Інший психолог':p.psychologist || 'Психолог призначений у картці'}</small></span></button>;})}{!results.length&&<p className="booking-hint">Пацієнта не знайдено. Перевірте пошук або зареєструйте нового.</p>}</div>}
            {multi&&<p className="booking-hint">Оберіть учасників кнопками. Усі мають бути призначені одному психологу.</p>}
          </>}
          <label className="booking-field booking-assignment"><span>Психолог</span><select aria-label="Психолог" value={form.psychologist_id} disabled={busy||Boolean(selected.length)} required onChange={e=>setForm({...form,psychologist_id:e.target.value})}><option value="">Спочатку оберіть пацієнта</option>{meta.psychologists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </section>
        <section className="booking-section"><header><span className="booking-step">2</span><h3>Коли й де</h3></header>
          <div className="booking-fields"><label className="booking-field"><span>Дата консультації</span><input type="date" required value={form.date} disabled={busy} onChange={e=>setForm({...form,date:e.target.value})}/></label><label className="booking-field"><span>Кабінет</span><select aria-label="Кабінет" required value={form.room_id} disabled={busy} onChange={e=>setForm({...form,room_id:e.target.value})}><option value="">Оберіть кабінет</option>{meta.rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div>
          <div className="booking-fields"><label className="booking-field"><span>Час початку</span><input type="time" step="60" required value={form.start} disabled={busy} onChange={e=>setForm({...form,start:e.target.value})}/></label><label className="booking-field"><span>Тривалість, хв</span><input type="number" min="15" max="240" required value={form.duration} disabled={busy} onChange={e=>setForm({...form,duration:Number(e.target.value)})}/></label></div>
          <div className="booking-duration" role="group" aria-label="Швидкий вибір тривалості">{[30,45,60,90].map(value=><button type="button" key={value} disabled={busy} aria-pressed={form.duration===value} onClick={()=>setForm({...form,duration:value})}>{value} хв</button>)}</div>
          <div className="booking-free-times"><strong>Вільний час · {form.duration || '—'} хв</strong>{slotError?<p role="status">{slotError} <button type="button" className="booking-text-action" onClick={()=>setRefresh(x=>x+1)}>Повторити</button></p>:!form.psychologist_id?<p>Оберіть пацієнта, щоб побачити вільні години.</p>:slots===null?<p role="status">Перевіряємо розклад…</p>:slots.length?<div className="booking-slots">{slots.map(time=><button type="button" key={time} disabled={busy} aria-pressed={time===form.start} onClick={()=>setForm({...form,start:time})}>{time}</button>)}</div>:<p>Для цієї тривалості немає вільних слотів. Змініть дату або кабінет.</p>}<small>Час можна ввести вручну. Зайнятість буде перевірено під час запису.</small></div>
        </section>
        <details className="booking-extra"><summary>Додатково: статус і примітка</summary><label className="booking-field"><span>Статус запису</span><select aria-label="Статус запису" value={form.status} disabled={busy} onChange={e=>setForm({...form,status:e.target.value})}><option value="scheduled">Заплановано</option><option value="confirmed">Підтверджено</option><option value="draft">Чернетка</option></select></label><label className="booking-field"><span>Примітка до запису</span><textarea rows={2} maxLength={500} value={form.note} disabled={busy} onChange={e=>setForm({...form,note:e.target.value})}/></label></details></div>
        <aside className="booking-summary" aria-label="Підсумок запису"><span className="eyebrow">ВАШ ЗАПИС</span><h3>{selected.length?selected.map(p=>p.name).join(', '):'Оберіть пацієнта'}</h3><p>{kindLabels[form.kind]} консультація</p><dl><div><dt>Дата</dt><dd>{dayLabel(form.date)}</dd></div><div><dt>Час</dt><dd>{form.start || '—'} — {end || '—'}</dd></div><div><dt>Тривалість</dt><dd>{form.duration || '—'} хв</dd></div><div><dt>Психолог</dt><dd>{psychologist?.name || '—'}</dd></div><div><dt>Кабінет</dt><dd>{room?.name || '—'}</dd></div></dl><small>Години роботи: {meta.workflow?.opening_time || '08:00'}–{meta.workflow?.closing_time || '20:00'}</small></aside>
      </div>}
      <div className="booking-footer"><span>{end?`До ${end} · ${form.duration} хв`:'Оберіть час прийому'}</span><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Скасувати</button><button type="submit" className="button primary" disabled={loading||busy||!meta||!form.patient_ids.length}>{busy?'Зберігаємо…':editing?'Зберегти перенесення':multi?'Записати учасників':'Записати пацієнта'}</button></div>
    </form>
  </Modal>;
}
