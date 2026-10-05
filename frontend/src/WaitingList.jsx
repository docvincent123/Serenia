import React, { useEffect, useState } from 'react';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const statuses = { waiting: 'Очікує', offered: 'Слот запропоновано', booked: 'Записано', cancelled: 'Закрито' };

export default function WaitingList({ api, openPatient }) {
  const [rows, setRows] = useState([]), [patients, setPatients] = useState([]), [meta, setMeta] = useState({ rooms: [] });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [filter, setFilter] = useState('active');
  const [create, setCreate] = useState(false), [selected, setSelected] = useState(null), [slots, setSlots] = useState([]);
  const [form, setForm] = useState({ patient_id: '', date_from: today(), date_to: today(), time_from: '09:00', time_to: '18:00', priority: 'normal', contact_note: '' });
  const [booking, setBooking] = useState({ date: today(), room_id: '', duration: 60 });
  async function load() {
    try { const [r, p, m] = await Promise.all([api('GET', '/api/waiting-list'), api('GET', '/api/patients'), api('GET', '/api/meta')]); setRows(r); setPatients(p); setMeta(m); setError(''); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let alive = true; setSlots([]);
    if (selected && booking.room_id) api('GET', `/api/slots?date=${booking.date}&psychologist_id=${selected.psychologist_id}&room_id=${booking.room_id}&duration_minutes=${booking.duration}`)
      .then(r => { if (alive) setSlots(r.map(time => { const [h,m] = time.split(':').map(Number); const end = h*60+m+Number(booking.duration); return { start: `${booking.date}T${time}`, end: `${booking.date}T${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}` }; }).filter(s => s.start.slice(11) >= selected.time_from && s.end.slice(11) <= selected.time_to)); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [selected, booking]);
  async function add(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const p = patients.find(p => Number(p.id) === Number(form.patient_id));
      await api('POST', '/api/waiting-list', { ...form, patient_id: Number(form.patient_id), psychologist_id: Number(p?.psychologist_id) });
      setCreate(false); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function change(row, status) {
    if (status === 'cancelled' && !window.confirm(`Закрити очікування для ${row.patient}?`)) return;
    if (busy) return; setBusy(true); setError('');
    try { await api('PATCH', `/api/waiting-list/${row.id}`, { status, version: row.version }); await load(); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function book(slot) {
    if (busy) return;
    if (!window.confirm(`Підтверджено згоду ${selected.patient} на ${slot.start.replace('T', ' ')}?`)) return;
    setBusy(true); setError('');
    try {
      await api('POST', `/api/waiting-list/${selected.id}/book`, { version: selected.version, room_id: Number(booking.room_id), start: slot.start, end: slot.end });
      setSelected(null); await load();
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  const active = rows.filter(r => ['waiting', 'offered'].includes(r.status));
  const shown = filter === 'active' ? active : rows;
  return <>
    <div className="page-head"><div><div className="eyebrow">РЕЄСТРАТУРА · КООРДИНАЦІЯ</div><h1>Лист очікування</h1><p>Звільнений час — нова можливість допомогти. Запис лише після згоди пацієнта.</p></div><button className="button primary" onClick={() => { setCreate(true); setError(''); }}>Додати пацієнта</button></div>
    <div className="waiting-summary"><article><span>Очікують зустрічі</span><strong>{active.length}</strong></article><article><span>Слот запропоновано</span><strong>{active.filter(r => r.status === 'offered').length}</strong></article><article><span>Записано</span><strong>{rows.filter(r => r.status === 'booked').length}</strong></article></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="waiting-toolbar"><div className="segmented"><button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Активні</button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Історія</button></div><button className="button secondary" onClick={load}>Оновити</button></div>
    <section className="waiting-grid">
      {!shown.length && <div className="surface empty"><h3>Ніхто не очікує</h3><p>Додайте пацієнта, якщо відповідного слота поки немає.</p></div>}
      {shown.map(row => <article className="surface waiting-card" key={row.id}>
        <div className="section-head"><span className={`badge ${row.priority === 'high' ? 'amber' : 'stone'}`}>{row.priority === 'high' ? 'Підвищений пріоритет' : 'Звичайний пріоритет'}</span><span className="badge forest">{statuses[row.status]}</span></div>
        <button className="waiting-patient" onClick={() => openPatient(row.patient_id)}>{row.patient}</button><p>№ {row.patient_no} · {row.psychologist}</p>
        <div className="waiting-details"><span>{row.date_from} — {row.date_to}</span><span>{row.time_from}–{row.time_to}</span><a href={`tel:${row.phone}`}>{row.phone || 'Телефон не вказано'}</a></div>
        {row.contact_note && <p className="waiting-note">{row.contact_note}</p>}
        {['waiting','offered'].includes(row.status) && <div className="page-actions"><button className="button primary" disabled={busy} onClick={() => { setSelected(row); setBooking({ date: row.date_from, room_id: '', duration: meta.workflow?.default_duration_minutes || 60 }); setError(''); }}>Знайти слот</button><button className="button secondary" disabled={busy} onClick={() => change(row, row.status === 'waiting' ? 'offered' : 'waiting')}>{row.status === 'waiting' ? 'Слот запропоновано' : 'Повернути в очікування'}</button><button className="button ghost" disabled={busy} onClick={() => change(row, 'cancelled')}>Закрити</button></div>}
      </article>)}
    </section>
    {(create || selected) && <div className="dialog-backdrop"><section className="dialog wide" role="dialog" aria-modal="true" aria-label={create ? 'Нове очікування' : 'Вибрати слот'}>
      <div className="dialog-head"><div><h2>{create ? 'Нове очікування' : selected.patient}</h2><p>{create ? 'Контактні побажання, без психологічних нотаток.' : 'Слоти перевіряються повторно під час запису.'}</p></div><button className="button ghost" disabled={busy} onClick={() => { setCreate(false); setSelected(null); }}>Закрити</button></div>
      {error && <div className="alert error">{error}</div>}
      {create ? <form className="form-grid" onSubmit={add}>
        <label className="field full"><span>Пацієнт</span><select required value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })}><option value="">Оберіть пацієнта</option>{patients.filter(p => p.status === 'active' && p.psychologist_id).map(p => <option key={p.id} value={p.id}>{p.name} · № {p.patient_no}</option>)}</select></label>
        {[['date_from','З дати','date'],['date_to','До дати','date'],['time_from','Не раніше','time'],['time_to','Не пізніше','time']].map(([key,label,type]) => <label className="field" key={key}><span>{label}</span><input required type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
        <label className="field"><span>Пріоритет</span><select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option value="normal">Звичайний</option><option value="high">Підвищений · визначає працівник</option></select></label>
        <label className="field full"><span>Як зв’язатися / побажання</span><textarea maxLength={1000} value={form.contact_note} onChange={e => setForm({ ...form, contact_note: e.target.value })} placeholder="Наприклад: телефонувати після 15:00" /></label>
        <div className="form-actions full-span"><button className="button primary" disabled={busy}>{busy ? 'Зберігаємо…' : 'Додати в очікування'}</button></div>
      </form> : <>
        <div className="form-grid"><label className="field"><span>Дата</span><input type="date" min={selected.date_from} max={selected.date_to} value={booking.date} onChange={e => setBooking({ ...booking, date: e.target.value })} /></label><label className="field"><span>Кабінет</span><select value={booking.room_id} onChange={e => setBooking({ ...booking, room_id: e.target.value })}><option value="">Оберіть кабінет</option>{meta.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className="field"><span>Тривалість, хв</span><input type="number" min={15} max={240} value={booking.duration} onChange={e => setBooking({ ...booking, duration: e.target.value })} /></label></div>
        <div className="waiting-slots">{slots.map(s => <button className="button secondary" disabled={busy} key={s.start} onClick={() => book(s)}>{s.start.slice(11)} — {s.end.slice(11)}</button>)}</div>
        {!slots.length && <p className="muted">Оберіть дату й кабінет. Якщо слотів немає, спробуйте інший день.</p>}
      </>}
    </section></div>}
  </>;
}
