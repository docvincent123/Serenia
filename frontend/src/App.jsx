import React, { useEffect, useMemo, useState } from 'react';

const roleLabels = {
  admin: 'Адміністратор',
  reception: 'Реєстратура',
  psychologist: 'Психолог',
  director: 'Керівник центру'
};

const riskFlagOptions = [
  ['anxiety', 'Тривога'],
  ['depression', 'Депресивні прояви'],
  ['ptsd', 'ПТСР / флешбеки'],
  ['sleep', 'Порушення сну'],
  ['panic', 'Панічні прояви'],
  ['aggression', 'Агресія / дратівливість'],
  ['family_conflict', 'Сімейний конфлікт'],
  ['burnout', 'Емоційне виснаження'],
  ['suicide', 'Суїцидальний ризик'],
  ['harm_others', 'Ризик для оточення'],
  ['urgent_followup', 'Терміновий повторний контакт'],
  ['doctor_referral', 'Скерування до лікаря / психіатра'],
  ['family_work', 'Потреба у сімейній роботі'],
  ['group_work', 'Потреба у груповій терапії']
];

const categoryTone = {
  'Військовий/військова': 'olive',
  'Ветеран/ветеранка': 'forest',
  'Партнер/партнерка': 'sand',
  'Дитина': 'sky',
  'Інше': 'stone'
};

const icons = {
  dashboard: '◈',
  calendar: '▣',
  patients: '◉',
  families: '⌘',
  team: '♢',
  rooms: '▦',
  reports: '▤',
  audit: '☷',
  settings: '⚙'
};

function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthStart() {
  const d = new Date();
  return localDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function cleanBase(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Адреса сервера має починатися з http:// або https://');
  return text;
}

async function request(base, token, method, path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${cleanBase(base)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw Object.assign(new Error('Немає зв’язку із сервером. Перевірте адресу та чи запущений SolviaServer.exe.'), { status: 0 });
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw Object.assign(new Error(data.error || `Помилка сервера ${response.status}`), { status: response.status });
  }
  return data;
}

function navFor(role) {
  if (role === 'admin') {
    return [
      ['dashboard', 'Огляд центру'],
      ['calendar', 'Календар'],
      ['patients', 'Пацієнти'],
      ['families', 'Сім’ї'],
      ['team', 'Команда'],
      ['rooms', 'Кабінети'],
      ['reports', 'Звіти психологів'],
      ['settings', 'Налаштування'],
      ['audit', 'Журнал дій']
    ];
  }
  if (role === 'reception') return [['calendar', 'Календар'], ['patients', 'Пацієнти'], ['families', 'Сім’ї']];
  if (role === 'psychologist') return [['calendar', 'Мій календар'], ['patients', 'Мої пацієнти'], ['reports', 'Звіт за зміну']];
  return [['dashboard', 'Огляд центру']];
}

function defaultPage(role) {
  return role === 'admin' || role === 'director' ? 'dashboard' : 'calendar';
}

function Button({ children, variant = 'primary', className = '', ...props }) {
  return <button className={`button ${variant} ${className}`} {...props}>{children}</button>;
}

function IconButton({ children, ...props }) {
  return <button className="icon-button" {...props}>{children}</button>;
}

function Badge({ children, tone = 'stone' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Empty({ title, text }) {
  return (
    <div className="empty">
      <div className="empty-mark">○</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Spinner() {
  return <div className="spinner" aria-label="Завантаження" />;
}

function Dialog({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className={`dialog ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} aria-label="Закрити">×</IconButton>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children, full = false }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function PageHead({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

function Login({ initialBase, onLogin }) {
  const [server, setServer] = useState(initialBase);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const base = cleanBase(server);
      const result = await request(base, '', 'POST', '/api/login', { login, password });
      onLogin(base, result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <section className="login-brand">
        <div className="brand-orbit">
          <div className="brand-core">S</div>
        </div>
        <div className="login-brand-copy">
          <div className="eyebrow light">PSYCHOLOGICAL CARE PLATFORM</div>
          <h1>Простір, де допомога має структуру.</h1>
          <p>SOLVIA об’єднує реєстратуру, психологів і керівника центру, не змішуючи приватні записи з адміністративними даними.</p>
        </div>
        <div className="privacy-note">
          <span>●</span>
          <div>
            <strong>Privacy by role</strong>
            <small>Кожна роль бачить лише той обсяг інформації, який потрібен для роботи.</small>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="product">
            <div className="product-mark">S</div>
            <div>
              <strong>SOLVIA</strong>
              <span>by QureMed</span>
            </div>
          </div>

          <div className="login-copy">
            <h2>Вхід до центру</h2>
            <p>Використайте персональний обліковий запис працівника.</p>
          </div>

          {error && <div className="alert error">{error}</div>}

          <Field label="Логін" full>
            <input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus autoComplete="username" placeholder="Ваш логін" required />
          </Field>

          <Field label="Пароль" full>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••••••" required />
          </Field>

          <Button type="submit" className="login-submit" disabled={busy}>
            {busy ? 'Підключення…' : 'Увійти до SOLVIA'}
          </Button>

          <button type="button" className="server-toggle" onClick={() => setShowServer((v) => !v)}>
            {showServer ? 'Сховати адресу сервера' : 'Налаштувати адресу сервера'}
          </button>

          {showServer && (
            <Field label="Адреса SolviaServer" hint="На цьому ПК: http://127.0.0.1:8765" full>
              <input value={server} onChange={(e) => setServer(e.target.value)} spellCheck="false" />
            </Field>
          )}

          <div className="login-foot">Версія 1.1 • by QureMed</div>
        </form>
      </section>
    </div>
  );
}

function Dashboard({ api }) {
  const [stats, setStats] = useState(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDate());
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setStats(await api('GET', `/api/stats?from=${from}&to=${to}`));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  const cards = stats ? [
    ['Усього пацієнтів', stats.total_patients, 'У базі центру'],
    ['Нові звернення', stats.new_patients, 'За обраний період'],
    ['Консультації', stats.consultations, 'Збережені психологами'],
    ['Повторні прийоми', stats.repeat_visits, 'Пацієнти з попередньою історією'],
    ['Скасовані записи', stats.appointments?.cancelled || 0, 'У календарі']
  ] : [];

  return (
    <>
      <PageHead
        eyebrow="КЕРІВНИЦТВО"
        title="Огляд центру"
        subtitle="Операційна статистика без доступу до приватних нотаток психологів."
        actions={
          <div className="date-range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>—</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button variant="secondary" onClick={load}>Оновити</Button>
          </div>
        }
      />

      {error && <div className="alert error">{error}</div>}
      {!stats ? <Spinner /> : (
        <>
          <div className="stat-grid">
            {cards.map(([label, value, hint], index) => (
              <article className="stat-card" key={label}>
                <div className="stat-index">0{index + 1}</div>
                <strong>{value}</strong>
                <h3>{label}</h3>
                <p>{hint}</p>
              </article>
            ))}
          </div>

          <section className="surface">
            <div className="section-head">
              <div>
                <div className="eyebrow">НАВАНТАЖЕННЯ КОМАНДИ</div>
                <h2>Психологи</h2>
              </div>
              <Badge tone="forest">{stats.load?.length || 0} спеціалістів</Badge>
            </div>

            {!stats.load?.length ? <Empty title="Немає даних" text="Додайте психологів і записи в календар." /> : (
              <div className="load-list">
                {stats.load.map((item) => {
                  const hours = Number(item.hours || 0);
                  const width = Math.min(100, hours * 5);
                  return (
                    <div className="load-row" key={item.name}>
                      <div className="avatar">{String(item.name || '?').slice(0, 1).toUpperCase()}</div>
                      <div className="load-main">
                        <div className="load-label">
                          <strong>{item.name}</strong>
                          <span>{item.appointments} записів · {hours} год</span>
                        </div>
                        <div className="progress"><span style={{ width: `${width}%` }} /></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Calendar({ api, role, openPatient }) {
  const [date, setDate] = useState(localDate());
  const [appointments, setAppointments] = useState([]);
  const [meta, setMeta] = useState({ psychologists: [], rooms: [] });
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState('');
  const [error, setError] = useState('');
  const [slots, setSlots] = useState([]);
  const [booking, setBooking] = useState({
    psychologist_id: '',
    room_id: '',
    start: '09:00',
    end: '10:00',
    kind: 'individual',
    status: 'scheduled',
    note: '',
    patient_ids: []
  });
  const [slotForm, setSlotForm] = useState({ psychologist_id: '', room_id: '' });

  const canSchedule = role === 'admin' || role === 'reception';

  async function load(targetDate = date) {
    setError('');
    try {
      const tasks = [api('GET', '/api/meta'), api('GET', `/api/appointments?date=${targetDate}`)];
      if (canSchedule) tasks.push(api('GET', '/api/patients'));
      const [m, a, p = []] = await Promise.all(tasks);
      setMeta(m);
      setAppointments(a);
      setPatients(p);
      setSelected(null);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(date); }, [date]);

  function openNew() {
    setBooking({
      psychologist_id: meta.psychologists?.[0]?.id || '',
      room_id: meta.rooms?.[0]?.id || '',
      start: '09:00',
      end: '10:00',
      kind: 'individual',
      status: 'scheduled',
      note: '',
      patient_ids: []
    });
    setDialog('booking');
  }

  function openEdit() {
    if (!selected) return;
    setBooking({
      psychologist_id: selected.psychologist_id,
      room_id: selected.room_id,
      start: selected.start.slice(11, 16),
      end: selected.end.slice(11, 16),
      kind: selected.kind,
      status: selected.status,
      note: selected.note || '',
      patient_ids: selected.patients.map((p) => p.id)
    });
    setDialog('edit');
  }

  async function saveBooking(e) {
    e.preventDefault();
    try {
      const edit = dialog === 'edit';
      let ids = booking.patient_ids.map(Number).filter(Boolean);
      if (booking.kind === 'individual') ids = ids.slice(0, 1);
      if (!ids.length) throw new Error('Оберіть хоча б одного пацієнта.');

      const body = {
        psychologist_id: Number(booking.psychologist_id),
        room_id: Number(booking.room_id),
        start: `${date}T${booking.start}`,
        end: `${date}T${booking.end}`,
        kind: booking.kind,
        status: booking.status,
        note: booking.note,
        patient_ids: ids
      };

      await api(edit ? 'PATCH' : 'POST', edit ? `/api/appointments/${selected.id}` : '/api/appointments', body);
      setDialog('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function cancelAppointment() {
    if (!selected) return;
    const reason = window.prompt('Причина скасування (необов’язково):', '') ?? null;
    if (reason === null) return;
    try {
      await api('PATCH', `/api/appointments/${selected.id}`, { status: 'cancelled', cancellation_reason: reason });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function markNoShow() {
    if (!selected || !window.confirm('Позначити, що пацієнт не з’явився?')) return;
    try {
      await api('PATCH', `/api/appointments/${selected.id}`, { status: 'no_show', cancellation_reason: 'Пацієнт не з’явився' });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function findSlots(e) {
    e.preventDefault();
    try {
      const result = await api(
        'GET',
        `/api/slots?date=${date}&psychologist_id=${slotForm.psychologist_id}&room_id=${slotForm.room_id}`
      );
      setSlots(result);
    } catch (e) {
      setError(e.message);
    }
  }

  const statusLabel = (status) => ({
    draft: 'Чернетка', scheduled: 'Заплановано', confirmed: 'Підтверджено',
    completed: 'Проведено', cancelled: 'Скасовано', no_show: 'Не з’явився', rescheduled: 'Перенесено'
  }[status] || status);
  const statusTone = (status) => status === 'completed' || status === 'confirmed' ? 'forest' : status === 'cancelled' || status === 'no_show' ? 'rose' : status === 'draft' ? 'sand' : 'sky';

  return (
    <>
      <PageHead
        eyebrow={role === 'psychologist' ? 'МОЯ РОБОТА' : 'РОЗКЛАД ЦЕНТРУ'}
        title={role === 'psychologist' ? 'Мій календар' : 'Календар центру'}
        subtitle="Один простір для індивідуальних консультацій, групових занять, кабінетів і змін."
        actions={
          <>
            <input className="date-control" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {canSchedule && <Button variant="secondary" onClick={() => { setSlots([]); setSlotForm({ psychologist_id: meta.psychologists?.[0]?.id || '', room_id: meta.rooms?.[0]?.id || '' }); setDialog('slots'); }}>Вільні години</Button>}
            {canSchedule && <Button onClick={openNew}>+ Новий запис</Button>}
          </>
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className="calendar-layout">
        <section className="surface calendar-surface">
          <div className="section-head compact">
            <div>
              <div className="eyebrow">ДЕНЬ</div>
              <h2>{date}</h2>
            </div>
            <Badge tone="stone">{appointments.length} подій</Badge>
          </div>

          {!appointments.length ? <Empty title="Вільний день" text="На цю дату записів ще немає." /> : (
            <div className="appointment-list">
              {appointments.map((item) => (
                <button
                  key={item.id}
                  className={`appointment ${selected?.id === item.id ? 'selected' : ''} ${item.status}`}
                  onClick={() => setSelected(item)}
                >
                  <div className="appointment-time">
                    <strong>{item.start.slice(11, 16)}</strong>
                    <span>{item.end.slice(11, 16)}</span>
                  </div>
                  <div className="appointment-main">
                    <div className="appointment-top">
                      <strong>{item.kind === 'group' ? 'Групове заняття' : item.patients?.[0]?.name || 'Консультація'}</strong>
                      <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                    </div>
                    {item.kind === 'group' && <p>{item.patients.map((p) => p.name).join(', ')}</p>}
                    <div className="appointment-meta">
                      <span>{item.psychologist}</span>
                      <span>•</span>
                      <span>{item.room}</span>
                    </div>
                    {role === 'psychologist' && item.patients?.length > 0 && (
                      <div className="patient-chips">
                        {item.patients.map((p) => (
                          <span
                            key={p.id}
                            className="patient-chip"
                            onClick={(e) => { e.stopPropagation(); openPatient(p.id); }}
                          >
                            {p.name} →
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="surface context-panel">
          <div className="eyebrow">ДЕТАЛІ</div>
          {!selected ? (
            <div className="context-empty">
              <div className="context-symbol">↗</div>
              <h3>Оберіть запис</h3>
              <p>Тут з’являться деталі зустрічі та доступні дії.</p>
            </div>
          ) : (
            <div className="context-content">
              <h2>{selected.kind === 'group' ? 'Групове заняття' : selected.patients?.[0]?.name}</h2>
              <dl>
                <div><dt>Час</dt><dd>{selected.start.slice(11, 16)} — {selected.end.slice(11, 16)}</dd></div>
                <div><dt>Психолог</dt><dd>{selected.psychologist}</dd></div>
                <div><dt>Кабінет</dt><dd>{selected.room}</dd></div>
                <div><dt>Статус</dt><dd>{statusLabel(selected.status)}</dd></div>
              </dl>
              <div className="context-people">
                <span>Учасники</span>
                {selected.patients.map((p) => <strong key={p.id}>{p.name}</strong>)}
              </div>
              {canSchedule && ['draft','scheduled','confirmed'].includes(selected.status) && (
                <div className="context-actions">
                  <Button variant="secondary" onClick={openEdit}>Перенести / змінити</Button>
                  <Button variant="secondary" onClick={markNoShow}>Не з’явився</Button>
                  <Button variant="danger" onClick={cancelAppointment}>Скасувати</Button>
                </div>
              )}
              {selected.cancellation_reason && <div className="alert info">Причина: {selected.cancellation_reason}</div>}
            </div>
          )}
        </aside>
      </div>

      {(dialog === 'booking' || dialog === 'edit') && (
        <Dialog title={dialog === 'edit' ? 'Змінити запис' : 'Новий запис'} subtitle={date} onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={saveBooking}>
            <Field label="Психолог">
              <select value={booking.psychologist_id} onChange={(e) => setBooking({ ...booking, psychologist_id: e.target.value })} required>
                {meta.psychologists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Кабінет">
              <select value={booking.room_id} onChange={(e) => setBooking({ ...booking, room_id: e.target.value })} required>
                {meta.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Початок">
              <input type="time" min="08:00" max="19:00" value={booking.start} onChange={(e) => setBooking({ ...booking, start: e.target.value })} required />
            </Field>
            <Field label="Завершення">
              <input type="time" min="09:00" max="20:00" value={booking.end} onChange={(e) => setBooking({ ...booking, end: e.target.value })} required />
            </Field>
            <Field label="Тип зустрічі" full>
              <select value={booking.kind} onChange={(e) => setBooking({ ...booking, kind: e.target.value })}>
                <option value="individual">Індивідуальна консультація</option>
                <option value="group">Групове заняття</option>
              </select>
            </Field>
            <Field label="Статус запису">
              <select value={booking.status} onChange={(e) => setBooking({ ...booking, status: e.target.value })}>
                <option value="draft">Чернетка</option>
                <option value="scheduled">Заплановано</option>
                <option value="confirmed">Підтверджено</option>
              </select>
            </Field>
            <Field label="Примітка до запису">
              <input value={booking.note} onChange={(e) => setBooking({ ...booking, note: e.target.value })} placeholder="Напр. підтвердити телефоном" />
            </Field>
            <Field label={booking.kind === 'group' ? 'Учасники' : 'Пацієнт'} hint={booking.kind === 'group' ? 'Ctrl + клік для вибору кількох учасників.' : ''} full>
              <select
                multiple={booking.kind === 'group'}
                size={booking.kind === 'group' ? 6 : 1}
                value={booking.kind === 'group' ? booking.patient_ids.map(String) : String(booking.patient_ids[0] || '')}
                onChange={(e) => {
                  const values = booking.kind === 'group'
                    ? [...e.target.selectedOptions].map((o) => Number(o.value))
                    : [Number(e.target.value)];
                  setBooking({ ...booking, patient_ids: values.filter(Boolean) });
                }}
                disabled={dialog === 'edit'}
                required
              >
                {booking.kind !== 'group' && <option value="">Оберіть пацієнта</option>}
                {patients.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.psychologist}</option>)}
              </select>
            </Field>
            {dialog === 'edit' && <div className="alert info full-span">Учасники при перенесенні зберігаються без змін.</div>}
            <div className="form-actions full-span">
              <Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button>
              <Button type="submit">Зберегти запис</Button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === 'slots' && (
        <Dialog title="Вільні години" subtitle={date} onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={findSlots}>
            <Field label="Психолог">
              <select value={slotForm.psychologist_id} onChange={(e) => setSlotForm({ ...slotForm, psychologist_id: e.target.value })} required>
                {meta.psychologists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Кабінет">
              <select value={slotForm.room_id} onChange={(e) => setSlotForm({ ...slotForm, room_id: e.target.value })} required>
                {meta.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <div className="form-actions full-span"><Button type="submit">Показати слоти</Button></div>
          </form>
          {slots.length > 0 && (
            <div className="slot-grid">
              {slots.map((slot) => <button key={slot} className="slot" onClick={() => {
                setBooking({
                  psychologist_id: Number(slotForm.psychologist_id),
                  room_id: Number(slotForm.room_id),
                  start: slot,
                  end: `${String(Number(slot.slice(0, 2)) + 1).padStart(2, '0')}:00`,
                  kind: 'individual',
                  patient_ids: []
                });
                setDialog('booking');
              }}>{slot}</button>)}
            </div>
          )}
          {slots.length === 0 && <p className="muted centered">Оберіть параметри та натисніть «Показати слоти».</p>}
        </Dialog>
      )}
    </>
  );
}

function Patients({ api, role, openPatient }) {
  const [patients, setPatients] = useState([]);
  const [families, setFamilies] = useState([]);
  const [meta, setMeta] = useState({ psychologists: [], categories: [] });
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    dob: '',
    category: '',
    psychologist_id: '',
    family_id: '',
    family_role: '',
    sex: '',
    address: '',
    admin_note: ''
  });

  const canCreate = role === 'admin' || role === 'reception';

  async function load() {
    setError('');
    try {
      const tasks = [api('GET', '/api/patients'), api('GET', '/api/meta')];
      if (canCreate) tasks.push(api('GET', '/api/families'));
      const [p, m, f = []] = await Promise.all(tasks);
      setPatients(p);
      setMeta(m);
      setFamilies(f);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => [p.name, p.phone, p.category, p.psychologist, p.family].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [patients, search]);

  function openCreate() {
    setForm({
      name: '',
      phone: '',
      dob: '',
      category: meta.categories?.[0] || '',
      psychologist_id: meta.psychologists?.[0]?.id || '',
      family_id: '',
      family_role: '',
      sex: '',
      address: '',
      admin_note: ''
    });
    setDialog(true);
  }

  async function createPatient(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/patients', {
        name: form.name,
        phone: form.phone,
        dob: form.dob,
        category: form.category,
        psychologist_id: Number(form.psychologist_id),
        family_id: form.family_id ? Number(form.family_id) : null,
        family_role: form.family_role,
        sex: form.sex,
        address: form.address,
        admin_note: form.admin_note
      });
      setDialog(false);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHead
        eyebrow={role === 'psychologist' ? 'МОЇ ПАЦІЄНТИ' : 'РЕЄСТРАТУРА'}
        title={role === 'psychologist' ? 'Мої пацієнти' : 'Пацієнти'}
        subtitle={role === 'psychologist' ? 'Тільки пацієнти, закріплені за вашим обліковим записом.' : 'Реєстраційні дані, сімейні зв’язки та призначений психолог.'}
        actions={canCreate && <Button onClick={openCreate}>+ Додати пацієнта</Button>}
      />

      {error && <div className="alert error">{error}</div>}

      <section className="surface">
        <div className="toolbar">
          <div className="search-box">
            <span>⌕</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Пошук за ПІБ, телефоном, категорією…" />
          </div>
          <Badge tone="stone">{filtered.length} записів</Badge>
        </div>

        {!filtered.length ? <Empty title="Нічого не знайдено" text="Спробуйте змінити запит або створіть нового пацієнта." /> : (
          <div className="patient-table">
            <div className="patient-table-head">
              <span>Пацієнт</span>
              <span>Категорія</span>
              <span>Психолог</span>
              <span>Сім’я</span>
              <span />
            </div>
            {filtered.map((p) => (
              <button className="patient-row" key={p.id} onClick={() => openPatient(p.id)}>
                <span className="patient-identity">
                  <span className="avatar small">{p.name.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{p.name}</strong><small>{p.phone}</small></span>
                </span>
                <span><Badge tone={categoryTone[p.category] || 'stone'}>{p.category}</Badge></span>
                <span>{p.psychologist}</span>
                <span>{p.family || '—'}</span>
                <span className="row-arrow">→</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {dialog && (
        <Dialog title="Новий пацієнт" subtitle="Реєстраційна картка" onClose={() => setDialog(false)} wide>
          <form className="form-grid" onSubmit={createPatient}>
            <Field label="ПІБ" full>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={150} />
            </Field>
            <Field label="Телефон">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+380…" required />
            </Field>
            <Field label="Дата народження">
              <input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} required />
            </Field>
            <Field label="Категорія">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                {meta.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Психолог">
              <select value={form.psychologist_id} onChange={(e) => setForm({ ...form, psychologist_id: e.target.value })} required>
                {meta.psychologists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Сім’я">
              <select value={form.family_id} onChange={(e) => setForm({ ...form, family_id: e.target.value })}>
                <option value="">Без сімейного зв’язку</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
            <Field label="Роль у сім’ї" hint="Напр.: військовий, партнерка, дитина.">
              <input value={form.family_role} onChange={(e) => setForm({ ...form, family_role: e.target.value })} />
            </Field>
            <Field label="Стать">
              <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
                <option value="">Не вказано</option>
                <option value="female">Жіноча</option>
                <option value="male">Чоловіча</option>
                <option value="other">Інше</option>
              </select>
            </Field>
            <Field label="Адреса">
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Населений пункт / адреса" />
            </Field>
            {role === 'admin' && (
              <Field label="Службова примітка адміністратора" full>
                <textarea rows="3" value={form.admin_note} onChange={(e) => setForm({ ...form, admin_note: e.target.value })} />
              </Field>
            )}
            <div className="form-actions full-span">
              <Button type="button" variant="ghost" onClick={() => setDialog(false)}>Скасувати</Button>
              <Button type="submit">Створити пацієнта</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function PatientCard({ api, role, patientId, back }) {
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState('');
  const [consultDate, setConsultDate] = useState(localDate());
  const [dayAppointments, setDayAppointments] = useState([]);
  const [consultation, setConsultation] = useState({
    appointment_id: '', consultation_type: 'repeat', duration_minutes: 60,
    request_text: '', state_text: '', work_done: '', note: '', goals: '',
    next_plan: '', homework: '', recommendations: '', result_text: '',
    risk_level: 'low', risk_flags: []
  });
  const [assessmentLink, setAssessmentLink] = useState('');
  const [adminNote, setAdminNote] = useState({ note: '', priority: 'normal' });
  const [discharge, setDischarge] = useState({ date_from: monthStart(), date_to: localDate(), summary: '', dynamics: '', recommendations: '', followup: '' });

  const isPsychologist = role === 'psychologist';
  const isAdmin = role === 'admin';
  const canReadConsultations = isPsychologist || isAdmin;

  async function load() {
    setError('');
    try {
      setCard(await api('GET', `/api/patients/${patientId}`));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, [patientId]);

  async function loadConsultationsForDay(date) {
    try {
      const apps = await api('GET', `/api/appointments?date=${date}`);
      setDayAppointments(apps);
    } catch (e) {
      setError(e.message);
    }
  }

  function openConsultation() {
    setConsultDate(localDate());
    setConsultation({
      appointment_id: '', consultation_type: 'repeat', duration_minutes: 60,
      request_text: '', state_text: '', work_done: '', note: '', goals: '',
      next_plan: '', homework: '', recommendations: '', result_text: '',
      risk_level: 'low', risk_flags: []
    });
    setDayAppointments([]);
    setDialog('consultation');
    loadConsultationsForDay(localDate());
  }

  const eligibleAppointments = useMemo(() => {
    if (!card) return [];
    const completed = new Set((card.consultations || []).map((c) => Number(c.appointment_id)));
    return dayAppointments.filter((a) =>
      a.status === 'scheduled' &&
      !completed.has(Number(a.id)) &&
      a.patients?.some((p) => Number(p.id) === Number(patientId))
    );
  }, [dayAppointments, card, patientId]);

  async function saveConsultation(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/consultations', {
        patient_id: Number(patientId),
        appointment_id: Number(consultation.appointment_id),
        note: consultation.note,
        goals: consultation.goals,
        next_plan: consultation.next_plan,
        homework: consultation.homework,
        consultation_type: consultation.consultation_type,
        duration_minutes: Number(consultation.duration_minutes),
        request_text: consultation.request_text,
        state_text: consultation.state_text,
        work_done: consultation.work_done,
        recommendations: consultation.recommendations,
        result_text: consultation.result_text,
        risk_level: consultation.risk_level,
        risk_flags: consultation.risk_flags
      });
      setDialog('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  function toggleRiskFlag(value) {
    setConsultation((current) => ({
      ...current,
      risk_flags: current.risk_flags.includes(value)
        ? current.risk_flags.filter((x) => x !== value)
        : [...current.risk_flags, value]
    }));
  }

  async function saveAdminNote(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/admin-notes', { patient_id: Number(patientId), ...adminNote });
      setAdminNote({ note: '', priority: 'normal' });
      setDialog('');
      await load();
    } catch (e) { setError(e.message); }
  }

  async function saveDischarge(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/discharges', { patient_id: Number(patientId), ...discharge });
      setDialog('');
      await load();
    } catch (e) { setError(e.message); }
  }

  async function assignAssessment() {
    try {
      const result = await api('POST', '/api/assessments', { patient_id: Number(patientId) });
      const base = localStorage.getItem('solvia_api') || '';
      const link = `${base}${result.link}`;
      setAssessmentLink(link);
      setDialog('assessment');
      try { await navigator.clipboard.writeText(link); } catch {}
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !card) {
    return <>
      <Button variant="ghost" onClick={back}>← Назад</Button>
      <div className="alert error">{error}</div>
    </>;
  }
  if (!card) return <Spinner />;

  const assessments = card.assessments || [];
  const completedAssessments = assessments.filter((a) => a.completed !== null && a.score !== null);

  return (
    <>
      <div className="patient-card-top">
        <button className="back-link" onClick={back}>← До списку</button>
        <div className="patient-title">
          <div className="avatar large">{card.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <div className="eyebrow">КАРТКА ПАЦІЄНТА</div>
            <h1>{card.name}</h1>
            <div className="patient-subline">
              <Badge tone={categoryTone[card.category] || 'stone'}>{card.category}</Badge>
              <span>{card.phone}</span>
              <span>Народження: {card.dob}</span>
            </div>
          </div>
        </div>
        {(isPsychologist || isAdmin) && (
          <div className="page-actions">
            {isPsychologist && <Button variant="secondary" onClick={assignAssessment}>Призначити анкету</Button>}
            {isPsychologist && <Button onClick={openConsultation}>+ Консультація</Button>}
            {isAdmin && <Button variant="secondary" onClick={() => setDialog('admin-note')}>+ Службова нотатка</Button>}
            <Button variant="secondary" onClick={() => setDialog('discharge')}>Сформувати виписку</Button>
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="patient-card-grid">
        <section className="surface">
          <div className="section-head compact">
            <div>
              <div className="eyebrow">РЕЄСТРАЦІЙНІ ДАНІ</div>
              <h2>Профіль</h2>
            </div>
          </div>
          <dl className="profile-list">
            <div><dt>Телефон</dt><dd>{card.phone}</dd></div>
            <div><dt>Дата народження</dt><dd>{card.dob}</dd></div>
            <div><dt>Категорія</dt><dd>{card.category}</dd></div>
            <div><dt>Сім’я</dt><dd>{card.family || 'Не вказано'}</dd></div>
            <div><dt>Роль у сім’ї</dt><dd>{card.family_role || '—'}</dd></div>
            <div><dt>Адреса</dt><dd>{card.address || '—'}</dd></div>
            <div><dt>Стать</dt><dd>{card.sex || '—'}</dd></div>
            <div><dt>Статус</dt><dd>{card.status || 'active'}</dd></div>
          </dl>
        </section>

        <section className="surface">
          <div className="section-head compact">
            <div>
              <div className="eyebrow">ПРИВАТНІСТЬ</div>
              <h2>{isPsychologist ? 'Доступ психолога' : isAdmin ? 'Контроль адміністратора' : 'Захищений розділ'}</h2>
            </div>
          </div>
          <div className={`privacy-card ${canReadConsultations ? 'allowed' : 'locked'}`}>
            <div className="privacy-icon">{canReadConsultations ? '✓' : '⌁'}</div>
            <div>
              <strong>{isPsychologist ? 'Приватні записи доступні' : isAdmin ? 'Записи доступні для контролю' : 'Нотатки психолога приховані'}</strong>
              <p>{isPsychologist ? 'Ви бачите записи лише цього пацієнта, який закріплений за вашим профілем.' : isAdmin ? 'Адміністратор має доступ до записів психологів у режимі перегляду. Зміни вносить тільки психолог.' : 'Реєстратура та керівник центру не отримують текст консультацій.'}</p>
            </div>
          </div>
        </section>
      </div>

      {canReadConsultations && (
        <>
          <section className="surface">
            <div className="section-head">
              <div>
                <div className="eyebrow">КЛІНІЧНИЙ ЩОДЕННИК</div>
                <h2>Історія консультацій</h2>
              </div>
              <Badge tone="forest">{card.consultations?.length || 0} записів</Badge>
            </div>

            {!card.consultations?.length ? <Empty title="Ще немає консультацій" text="Після проведеної зустрічі додайте приватну нотатку, цілі та наступний план." /> : (
              <div className="consultation-list">
                {card.consultations.map((c) => (
                  <article className="consultation-card" key={c.id}>
                    <div className="consultation-date">{c.created?.replace('T', ' ')}</div>
                    <div className="consultation-note">
                      <div className="eyebrow">ПРИВАТНА НОТАТКА</div>
                      <p>{c.note}</p>
                    </div>
                    <div className="consultation-grid">
                      <div><span>Цілі роботи</span><p>{c.goals || '—'}</p></div>
                      <div><span>Наступна консультація</span><p>{c.next_plan || '—'}</p></div>
                      <div><span>Домашнє завдання</span><p>{c.homework || '—'}</p></div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {isPsychologist && (
          <section className="surface">
            <div className="section-head">
              <div>
                <div className="eyebrow">САМОСПОСТЕРЕЖЕННЯ</div>
                <h2>Динаміка анкет</h2>
              </div>
              <Badge tone="sky">{completedAssessments.length} завершено</Badge>
            </div>

            {!assessments.length ? <Empty title="Анкет ще немає" text="Призначте пацієнту коротку анкету самопочуття." /> : (
              <div className="assessment-list">
                {assessments.map((a, index) => {
                  const previous = [...completedAssessments].filter((x) => x.id < a.id).at(-1);
                  const diff = a.score !== null && previous?.score !== null ? Number(a.score) - Number(previous.score) : null;
                  return (
                    <div className="assessment-row" key={a.id}>
                      <div>
                        <strong>{a.completed ? 'Заповнено' : 'Очікує відповіді'}</strong>
                        <span>{a.created?.replace('T', ' ')}</span>
                      </div>
                      <div className="assessment-score">
                        {a.completed ? <><strong>{a.score}<small>/30</small></strong>{diff !== null && <Badge tone={diff >= 0 ? 'forest' : 'rose'}>{diff >= 0 ? '+' : ''}{diff}</Badge>}</> : <Badge tone="sand">Посилання активне</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="legal-note">«Самопочуття сьогодні» — авторський інструмент самоспостереження, а не валідована діагностична шкала.</p>
          </section>
          )}
        </>
      )}

      {isAdmin && (
        <section className="surface">
          <div className="section-head">
            <div><div className="eyebrow">АДМІНІСТРАТИВНИЙ КОНТРОЛЬ</div><h2>Службові нотатки</h2></div>
            <Badge tone="stone">{card.admin_notes?.length || 0}</Badge>
          </div>
          {!card.admin_notes?.length ? <Empty title="Нотаток немає" text="Службові позначки адміністратора з’являться тут." /> : (
            <div className="consultation-list">
              {card.admin_notes.map((n) => (
                <article className="consultation-card" key={n.id}>
                  <div className="consultation-date">{n.created?.replace('T',' ')} · {n.author}</div>
                  <Badge tone={n.priority === 'urgent' ? 'rose' : n.priority === 'important' ? 'sand' : 'stone'}>{n.priority}</Badge>
                  <p>{n.note}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {(isAdmin || isPsychologist) && (
        <section className="surface">
          <div className="section-head">
            <div><div className="eyebrow">ДОКУМЕНТИ</div><h2>Виписки</h2></div>
            <Badge tone="sky">{card.discharges?.length || 0}</Badge>
          </div>
          {!card.discharges?.length ? <Empty title="Виписок ще немає" text="Сформуйте підсумкову виписку за обраний період." /> : (
            <div className="assessment-list">
              {card.discharges.map((d) => (
                <div className="assessment-row" key={d.id}>
                  <div><strong>{d.date_from} — {d.date_to}</strong><span>{d.consultation_count} консультацій · {d.author}</span></div>
                  <Badge tone="forest">Збережено</Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {dialog === 'consultation' && (
        <Dialog title="Підсумок консультації" subtitle={card.name} onClose={() => setDialog('')} wide>
          <form className="form-grid" onSubmit={saveConsultation}>
            <Field label="Дата запису">
              <input type="date" value={consultDate} onChange={(e) => { setConsultDate(e.target.value); setConsultation({ ...consultation, appointment_id: '' }); loadConsultationsForDay(e.target.value); }} />
            </Field>
            <Field label="Запис у календарі">
              <select value={consultation.appointment_id} onChange={(e) => setConsultation({ ...consultation, appointment_id: e.target.value })} required>
                <option value="">Оберіть проведений/поточний запис</option>
                {eligibleAppointments.map((a) => <option key={a.id} value={a.id}>{a.start.slice(11, 16)} — {a.room}</option>)}
              </select>
            </Field>
            {!eligibleAppointments.length && <div className="alert info full-span">На цю дату немає незавершеного запису цього пацієнта. Майбутню консультацію сервер не дозволить завершити достроково.</div>}
            <Field label="Тип консультації">
              <select value={consultation.consultation_type} onChange={(e) => setConsultation({ ...consultation, consultation_type: e.target.value })}>
                <option value="primary">Первинна</option>
                <option value="repeat">Повторна</option>
                <option value="crisis">Кризова</option>
                <option value="individual">Індивідуальна</option>
                <option value="family">Сімейна</option>
                <option value="child">Дитяча</option>
                <option value="group">Групова</option>
              </select>
            </Field>
            <Field label="Тривалість, хв">
              <input type="number" min="10" max="480" value={consultation.duration_minutes} onChange={(e) => setConsultation({ ...consultation, duration_minutes: e.target.value })} />
            </Field>
            <Field label="Основний запит" full>
              <textarea rows="3" value={consultation.request_text} onChange={(e) => setConsultation({ ...consultation, request_text: e.target.value })} />
            </Field>
            <Field label="Поточний стан" full>
              <textarea rows="3" value={consultation.state_text} onChange={(e) => setConsultation({ ...consultation, state_text: e.target.value })} />
            </Field>
            <Field label="Виконана робота" full>
              <textarea rows="3" value={consultation.work_done} onChange={(e) => setConsultation({ ...consultation, work_done: e.target.value })} />
            </Field>
            <Field label="Приватна нотатка" full>
              <textarea rows="6" value={consultation.note} onChange={(e) => setConsultation({ ...consultation, note: e.target.value })} required />
            </Field>
            <Field label="Рівень ризику">
              <select value={consultation.risk_level} onChange={(e) => setConsultation({ ...consultation, risk_level: e.target.value })}>
                <option value="low">Низький</option>
                <option value="moderate">Помірний</option>
                <option value="high">Високий</option>
                <option value="critical">Критичний</option>
              </select>
            </Field>
            <div className="field full">
              <span>Важливі позначки</span>
              <div className="check-grid">
                {riskFlagOptions.map(([value, label]) => (
                  <label className="check-chip" key={value}>
                    <input type="checkbox" checked={consultation.risk_flags.includes(value)} onChange={() => toggleRiskFlag(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <Field label="Цілі роботи" full>
              <textarea rows="3" value={consultation.goals} onChange={(e) => setConsultation({ ...consultation, goals: e.target.value })} />
            </Field>
            <Field label="План наступної консультації" full>
              <textarea rows="3" value={consultation.next_plan} onChange={(e) => setConsultation({ ...consultation, next_plan: e.target.value })} />
            </Field>
            <Field label="Домашнє завдання" full>
              <textarea rows="3" value={consultation.homework} onChange={(e) => setConsultation({ ...consultation, homework: e.target.value })} />
            </Field>
            <Field label="Рекомендації" full>
              <textarea rows="3" value={consultation.recommendations} onChange={(e) => setConsultation({ ...consultation, recommendations: e.target.value })} />
            </Field>
            <Field label="Результат / динаміка" full>
              <textarea rows="3" value={consultation.result_text} onChange={(e) => setConsultation({ ...consultation, result_text: e.target.value })} />
            </Field>
            <div className="form-actions full-span">
              <Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button>
              <Button type="submit">Зберегти консультацію</Button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === 'admin-note' && (
        <Dialog title="Службова нотатка" subtitle={card.name} onClose={() => setDialog('')}>
          <form onSubmit={saveAdminNote}>
            <Field label="Пріоритет" full>
              <select value={adminNote.priority} onChange={(e) => setAdminNote({ ...adminNote, priority: e.target.value })}>
                <option value="normal">Звичайна</option>
                <option value="important">Важлива</option>
                <option value="urgent">Терміново</option>
              </select>
            </Field>
            <Field label="Нотатка" full><textarea rows="6" value={adminNote.note} onChange={(e) => setAdminNote({ ...adminNote, note: e.target.value })} required /></Field>
            <div className="form-actions"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Зберегти</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'discharge' && (
        <Dialog title="Сформувати виписку" subtitle={card.name} onClose={() => setDialog('')} wide>
          <form className="form-grid" onSubmit={saveDischarge}>
            <Field label="Початок періоду"><input type="date" value={discharge.date_from} onChange={(e) => setDischarge({ ...discharge, date_from: e.target.value })} /></Field>
            <Field label="Кінець періоду"><input type="date" value={discharge.date_to} onChange={(e) => setDischarge({ ...discharge, date_to: e.target.value })} /></Field>
            <Field label="Підсумок психологічного супроводу" full><textarea rows="6" value={discharge.summary} onChange={(e) => setDischarge({ ...discharge, summary: e.target.value })} required /></Field>
            <Field label="Динаміка" full><textarea rows="4" value={discharge.dynamics} onChange={(e) => setDischarge({ ...discharge, dynamics: e.target.value })} /></Field>
            <Field label="Рекомендації" full><textarea rows="4" value={discharge.recommendations} onChange={(e) => setDischarge({ ...discharge, recommendations: e.target.value })} /></Field>
            <Field label="Подальший супровід" full><textarea rows="4" value={discharge.followup} onChange={(e) => setDischarge({ ...discharge, followup: e.target.value })} /></Field>
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Зберегти виписку</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'assessment' && (
        <Dialog title="Анкету призначено" subtitle="Посилання діє 7 днів і приймає одну відповідь." onClose={() => setDialog('')}>
          <div className="link-box">{assessmentLink}</div>
          <div className="form-actions">
            <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(assessmentLink); } catch {} }}>Скопіювати посилання</Button>
            <Button onClick={() => setDialog('')}>Готово</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function Families({ api }) {
  const [families, setFamilies] = useState([]);
  const [patients, setPatients] = useState([]);
  const [name, setName] = useState('');
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [f, p] = await Promise.all([api('GET', '/api/families'), api('GET', '/api/patients')]);
      setFamilies(f);
      setPatients(p);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function createFamily(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/families', { name });
      setName('');
      setDialog(false);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHead eyebrow="СІМЕЙНА СИСТЕМА" title="Сім’ї" subtitle="Одна сім’я в системі, але приватні психологічні записи кожного учасника залишаються окремими." actions={<Button onClick={() => setDialog(true)}>+ Нова сім’я</Button>} />
      {error && <div className="alert error">{error}</div>}
      <div className="family-grid">
        {families.map((f) => {
          const members = patients.filter((p) => Number(p.family_id) === Number(f.id));
          return (
            <article className="family-card" key={f.id}>
              <div className="family-symbol">⌂</div>
              <h3>{f.name}</h3>
              <p>{members.length} учасників</p>
              <div className="family-members">
                {members.length ? members.map((m) => <span key={m.id}>{m.name}<small>{m.family_role || m.category}</small></span>) : <small>Ще немає учасників</small>}
              </div>
            </article>
          );
        })}
      </div>
      {!families.length && <section className="surface"><Empty title="Сімей ще немає" text="Створіть сім’ю, а потім оберіть її в картці нового пацієнта." /></section>}

      {dialog && (
        <Dialog title="Нова сім’я" onClose={() => setDialog(false)}>
          <form onSubmit={createFamily}>
            <Field label="Назва сім’ї" full><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр. Родина Коваленків" required /></Field>
            <div className="form-actions"><Button type="button" variant="ghost" onClick={() => setDialog(false)}>Скасувати</Button><Button type="submit">Створити</Button></div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function Team({ api }) {
  const [users, setUsers] = useState([]);
  const [dialog, setDialog] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', login: '', password: '', role: 'psychologist', active: true });

  async function load() {
    try { setUsers(await api('GET', '/api/users')); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ name: '', login: '', password: '', role: 'psychologist', active: true });
    setEditing(null);
    setDialog('create');
  }

  function openEdit(user) {
    setEditing(user);
    setForm({ name: user.name, login: user.login, password: '', role: user.role, active: Boolean(user.active) });
    setDialog('edit');
  }

  async function saveUser(e) {
    e.preventDefault();
    try {
      if (dialog === 'create') {
        await api('POST', '/api/users', {
          name: form.name,
          login: form.login,
          password: form.password,
          role: form.role
        });
      } else {
        const payload = { name: form.name, role: form.role, active: form.active };
        if (form.password) payload.password = form.password;
        await api('PATCH', `/api/users/${editing.id}`, payload);
      }
      setDialog('');
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <PageHead
        eyebrow="АДМІНІСТРУВАННЯ"
        title="Команда центру"
        subtitle="Адміністратор створює працівників, призначає ролі, змінює доступ і за потреби скидає пароль."
        actions={<Button onClick={openCreate}>+ Додати працівника</Button>}
      />
      {error && <div className="alert error">{error}</div>}
      <section className="surface">
        <div className="team-grid">
          {users.map((u) => (
            <button className="team-card team-card-button" key={u.id} onClick={() => openEdit(u)}>
              <div className="avatar">{u.name.slice(0, 1).toUpperCase()}</div>
              <div><strong>{u.name}</strong><span>@{u.login}</span></div>
              <div className="team-state">
                <Badge tone={u.active ? 'forest' : 'stone'}>{roleLabels[u.role] || u.role}</Badge>
                {!u.active && <small>Доступ вимкнено</small>}
              </div>
            </button>
          ))}
        </div>
      </section>

      {dialog && (
        <Dialog title={dialog === 'create' ? 'Новий працівник' : 'Керування працівником'} subtitle={dialog === 'edit' ? `@${editing?.login}` : 'Створення облікового запису'} onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={saveUser}>
            <Field label="ПІБ" full>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            {dialog === 'create' && (
              <Field label="Логін" full>
                <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required />
              </Field>
            )}
            <Field label="Роль">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="psychologist">Психолог</option>
                <option value="reception">Реєстратура</option>
                <option value="director">Керівник центру</option>
                <option value="admin">Адміністратор</option>
              </select>
            </Field>
            {dialog === 'edit' && (
              <Field label="Доступ">
                <select value={form.active ? 'on' : 'off'} onChange={(e) => setForm({ ...form, active: e.target.value === 'on' })}>
                  <option value="on">Активний</option>
                  <option value="off">Вимкнений</option>
                </select>
              </Field>
            )}
            <Field label={dialog === 'create' ? 'Пароль' : 'Новий пароль'} hint={dialog === 'edit' ? 'Залиште порожнім, якщо пароль не змінюється.' : 'Мінімум 12 символів.'} full>
              <input type="password" minLength={dialog === 'create' ? 12 : undefined} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={dialog === 'create'} />
            </Field>
            <div className="form-actions full-span">
              <Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button>
              <Button type="submit">{dialog === 'create' ? 'Створити акаунт' : 'Зберегти зміни'}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function Rooms({ api }) {
  const [rooms, setRooms] = useState([]);
  const [dialog, setDialog] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const emptyForm = { name: '', code: '', type: 'individual', capacity: 1, description: '', active: true };
  const [form, setForm] = useState(emptyForm);

  async function load() {
    try { setRooms(await api('GET', '/api/rooms')); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialog('create');
  }
  function openEdit(room) {
    setEditing(room);
    setForm({
      name: room.name || '',
      code: room.code || '',
      type: room.type || 'individual',
      capacity: Number(room.capacity || 1),
      description: room.description || '',
      active: Boolean(room.active)
    });
    setDialog('edit');
  }
  async function saveRoom(e) {
    e.preventDefault();
    try {
      const payload = { ...form, capacity: Number(form.capacity) };
      if (dialog === 'create') await api('POST', '/api/rooms', payload);
      else await api('PATCH', `/api/rooms/${editing.id}`, payload);
      setDialog('');
      await load();
    } catch (e) { setError(e.message); }
  }
  async function removeRoom(room) {
    if (!window.confirm(`Видалити «${room.name}»? Якщо є активні записи, система не дозволить видалення.`)) return;
    try {
      await api('DELETE', `/api/rooms/${room.id}`, {});
      await load();
    } catch (e) { setError(e.message); }
  }

  const typeLabel = (type) => ({
    individual: 'Індивідуальний',
    family: 'Сімейний',
    group: 'Групова зала',
    child: 'Дитяча кімната',
    sensory: 'Сенсорна кімната'
  }[type] || type);

  return (
    <>
      <PageHead
        eyebrow="ІНФРАСТРУКТУРА"
        title="Кабінети та кімнати"
        subtitle="Створення, редагування, місткість, тип приміщення та виведення з планування."
        actions={<Button onClick={openCreate}>+ Додати приміщення</Button>}
      />
      {error && <div className="alert error">{error}</div>}
      <div className="room-grid">
        {rooms.map((r, i) => (
          <article className={`room-card ${r.active ? '' : 'room-inactive'}`} key={r.id}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <div className="room-card-main">
              <strong>{r.name}</strong>
              <small>{r.code ? `${r.code} · ` : ''}{typeLabel(r.type)} · до {r.capacity} ос.</small>
              {r.description && <p>{r.description}</p>}
            </div>
            <div className="room-actions">
              <Badge tone={r.active ? 'forest' : 'stone'}>{r.active ? 'Активний' : 'Неактивний'}</Badge>
              <IconButton onClick={() => openEdit(r)} title="Редагувати">✎</IconButton>
              <IconButton onClick={() => removeRoom(r)} title="Видалити">×</IconButton>
            </div>
          </article>
        ))}
      </div>
      {!rooms.length && <section className="surface"><Empty title="Приміщень немає" text="Додайте перший кабінет або зал." /></section>}

      {dialog && (
        <Dialog title={dialog === 'create' ? 'Нове приміщення' : 'Редагування приміщення'} onClose={() => setDialog('')} wide>
          <form className="form-grid" onSubmit={saveRoom}>
            <Field label="Назва" full><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Код / номер"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="101 / A-3" /></Field>
            <Field label="Місткість"><input type="number" min="1" max="100" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
            <Field label="Тип">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="individual">Індивідуальний кабінет</option>
                <option value="family">Сімейний кабінет</option>
                <option value="group">Групова зала</option>
                <option value="child">Дитяча кімната</option>
                <option value="sensory">Сенсорна кімната</option>
              </select>
            </Field>
            <Field label="Статус">
              <select value={form.active ? 'active' : 'inactive'} onChange={(e) => setForm({ ...form, active: e.target.value === 'active' })}>
                <option value="active">Активний</option>
                <option value="inactive">Неактивний</option>
              </select>
            </Field>
            <Field label="Опис" full><textarea rows="4" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="form-actions full-span">
              <Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button>
              <Button type="submit">Зберегти</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function Settings({ api }) {
  const empty = {
    center_name: '', short_name: '', address: '', phone: '', email: '', website: '', city: '',
    director_name: '', admin_name: '', work_hours: '', document_footer: '', discharge_signatory: ''
  };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  async function load() {
    try { setForm({ ...empty, ...(await api('GET', '/api/settings/center')) }); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    try {
      await api('PATCH', '/api/settings/center', form);
      setSaved('Налаштування центру збережено.');
      setTimeout(() => setSaved(''), 2500);
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <PageHead eyebrow="СИСТЕМА" title="Налаштування центру" subtitle="Ці дані використовуються у виписках, документах і шапці центру." />
      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert info">{saved}</div>}
      <section className="surface">
        <div className="section-head"><div><div className="eyebrow">РЕКВІЗИТИ</div><h2>Центр</h2></div><Badge tone="forest">SOLVIA 2.0</Badge></div>
        <form className="form-grid" onSubmit={save}>
          <Field label="Повна назва центру" full><input value={form.center_name} onChange={(e) => setForm({ ...form, center_name: e.target.value })} required /></Field>
          <Field label="Коротка назва"><input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} /></Field>
          <Field label="Місто"><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="Адреса" full><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="Телефон"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Сайт"><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
          <Field label="Режим роботи"><input value={form.work_hours} onChange={(e) => setForm({ ...form, work_hours: e.target.value })} placeholder="08:00–20:00" /></Field>
          <Field label="Керівник"><input value={form.director_name} onChange={(e) => setForm({ ...form, director_name: e.target.value })} /></Field>
          <Field label="Відповідальний адміністратор"><input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} /></Field>
          <Field label="Підписант виписки"><input value={form.discharge_signatory} onChange={(e) => setForm({ ...form, discharge_signatory: e.target.value })} /></Field>
          <Field label="Футер документів" full><textarea rows="3" value={form.document_footer} onChange={(e) => setForm({ ...form, document_footer: e.target.value })} /></Field>
          <div className="form-actions full-span"><Button type="submit">Зберегти налаштування</Button></div>
        </form>
      </section>
      <section className="surface maintenance-card">
        <div className="section-head"><div><div className="eyebrow">ДАНІ</div><h2>Резервне копіювання</h2></div><Badge tone="sand">Admin only</Badge></div>
        <p className="muted">Резервні копії та відновлення виконуються локально на серверному ПК. Модуль захищає RehaFlow: працює тільки з базою SOLVIA.</p>
        <div className="backup-actions">
          <Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('solvia-native-backup'))}>Створити backup</Button>
          <Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('solvia-native-restore'))}>Відновити з backup</Button>
        </div>
      </section>
    </>
  );
}

function GlobalSearch({ api, onPatient, onNavigate }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setResult(null); return; }
    const timer = setTimeout(async () => {
      setBusy(true);
      try { setResult(await api('GET', `/api/search?q=${encodeURIComponent(query.trim())}`)); }
      catch { setResult(null); }
      finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const total = result ? Object.values(result).reduce((n, arr) => n + (arr?.length || 0), 0) : 0;
  return (
    <div className="global-search-wrap">
      <div className="global-search">
        <span>⌕</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук пацієнта, сім’ї, працівника, кабінету…" />
        {busy && <small>Пошук…</small>}
      </div>
      {result && (
        <div className="search-popover">
          <div className="search-popover-head"><strong>Результати</strong><span>{total}</span></div>
          {result.patients?.map((p) => <button key={`p-${p.id}`} onClick={() => { onPatient(p.id); setQuery(''); setResult(null); }}><span>Пацієнт</span><strong>{p.name}</strong><small>{p.phone} · {p.category}</small></button>)}
          {result.families?.map((x) => <button key={`f-${x.id}`} onClick={() => { onNavigate('families'); setQuery(''); setResult(null); }}><span>Сім’я</span><strong>{x.name}</strong></button>)}
          {result.rooms?.map((x) => <button key={`r-${x.id}`} onClick={() => { onNavigate('rooms'); setQuery(''); setResult(null); }}><span>Кабінет</span><strong>{x.name}</strong><small>{x.code || x.type}</small></button>)}
          {result.users?.map((x) => <button key={`u-${x.id}`} onClick={() => { onNavigate('team'); setQuery(''); setResult(null); }}><span>Працівник</span><strong>{x.name}</strong><small>{roleLabels[x.role] || x.role}</small></button>)}
          {!total && <div className="search-empty">Нічого не знайдено</div>}
        </div>
      )}
    </div>
  );
}

function Reports({ api, role }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDate());
  const [reports, setReports] = useState([]);
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [form, setForm] = useState({ summary: '', incidents: '', handover: '' });
  const isAdmin = role === 'admin';

  async function load() {
    setError('');
    try {
      const reportTask = api('GET', `/api/shift-reports?from=${from}&to=${to}`);
      if (isAdmin) {
        const [r, c] = await Promise.all([reportTask, api('GET', `/api/psychology-records?from=${from}&to=${to}`)]);
        setReports(r);
        setRecords(c);
      } else {
        const r = await reportTask;
        setReports(r);
        const todayReport = r.find((x) => x.shift_date === localDate());
        if (todayReport) setForm({ summary: todayReport.summary || '', incidents: todayReport.incidents || '', handover: todayReport.handover || '' });
      }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitReport(e) {
    e.preventDefault();
    setSaved('');
    try {
      const result = await api('POST', '/api/shift-reports', {
        shift_date: localDate(),
        summary: form.summary,
        incidents: form.incidents,
        handover: form.handover
      });
      setSaved(`Звіт за зміну збережено. Консультацій за сьогодні: ${result.consultations_count}.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHead
        eyebrow={isAdmin ? 'КОНТРОЛЬ РОБОТИ' : 'ЗАВЕРШЕННЯ ЗМІНИ'}
        title={isAdmin ? 'Звіти психологів' : 'Звіт за зміну'}
        subtitle={isAdmin ? 'Записи консультацій та підсумкові звіти психологів зберігаються в PostgreSQL.' : 'Наприкінці зміни зафіксуйте підсумок роботи та інформацію для передачі.'}
        actions={isAdmin && <div className="date-range"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span>—</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /><Button variant="secondary" onClick={load}>Оновити</Button></div>}
      />
      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert info">{saved}</div>}

      {!isAdmin && (
        <section className="surface">
          <div className="section-head">
            <div><div className="eyebrow">СЬОГОДНІ · {localDate()}</div><h2>Підсумок зміни</h2></div>
            <Badge tone={reports.some((r) => r.shift_date === localDate()) ? 'forest' : 'sand'}>{reports.some((r) => r.shift_date === localDate()) ? 'Звіт подано' : 'Очікує звіту'}</Badge>
          </div>
          <form className="form-grid" onSubmit={submitReport}>
            <Field label="Підсумок роботи за зміну" full><textarea rows="6" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Що було виконано за зміну, загальна динаміка роботи…" required /></Field>
            <Field label="Важливі події / ризики" full><textarea rows="4" value={form.incidents} onChange={(e) => setForm({ ...form, incidents: e.target.value })} placeholder="Якщо немає — можна залишити порожнім." /></Field>
            <Field label="Передача / що проконтролювати" full><textarea rows="4" value={form.handover} onChange={(e) => setForm({ ...form, handover: e.target.value })} placeholder="Що потрібно врахувати наступній зміні або адміністратору." /></Field>
            <div className="form-actions full-span"><Button type="submit">Зберегти звіт за зміну</Button></div>
          </form>
        </section>
      )}

      <section className="surface">
        <div className="section-head">
          <div><div className="eyebrow">ЗВІТИ ЗА ЗМІНИ</div><h2>{isAdmin ? 'Історія звітів' : 'Мої попередні звіти'}</h2></div>
          <Badge tone="stone">{reports.length} звітів</Badge>
        </div>
        {!reports.length ? <Empty title="Звітів ще немає" text="Після завершення зміни тут з’явиться збережений звіт." /> : (
          <div className="consultation-list">
            {reports.map((r) => (
              <article className="consultation-card" key={r.id}>
                <div className="consultation-date">{r.shift_date} · {r.psychologist} · {r.consultations_count} консультацій</div>
                <div className="consultation-note"><div className="eyebrow">ПІДСУМОК ЗМІНИ</div><p>{r.summary}</p></div>
                <div className="consultation-grid">
                  <div><span>Важливі події / ризики</span><p>{r.incidents || '—'}</p></div>
                  <div><span>Передача / контроль</span><p>{r.handover || '—'}</p></div>
                  <div><span>Оновлено</span><p>{r.updated?.replace('T', ' ')}</p></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="surface">
          <div className="section-head">
            <div><div className="eyebrow">ЗАПИСИ ПСИХОЛОГІВ</div><h2>Консультації за період</h2></div>
            <Badge tone="forest">{records.length} записів</Badge>
          </div>
          {!records.length ? <Empty title="Записів немає" text="За вибраний період психологи ще не зберігали консультацій." /> : (
            <div className="consultation-list">
              {records.map((c) => (
                <article className="consultation-card" key={c.id}>
                  <div className="consultation-date">{c.created?.replace('T', ' ')} · {c.psychologist} · {c.patient}</div>
                  <div className="consultation-note"><div className="eyebrow">ЗАПИС КОНСУЛЬТАЦІЇ</div><p>{c.note}</p></div>
                  <div className="consultation-grid">
                    <div><span>Цілі роботи</span><p>{c.goals || '—'}</p></div>
                    <div><span>Наступна консультація</span><p>{c.next_plan || '—'}</p></div>
                    <div><span>Домашнє завдання</span><p>{c.homework || '—'}</p></div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Audit({ api }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  async function load() {
    try { setRows(await api('GET', '/api/audit')); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHead eyebrow="БЕЗПЕКА" title="Журнал дій" subtitle="Хто і коли працював із системою. Тексти психологічних нотаток у журнал не записуються." actions={<Button variant="secondary" onClick={load}>Оновити</Button>} />
      {error && <div className="alert error">{error}</div>}
      <section className="surface">
        <div className="audit-table">
          <div className="audit-head"><span>Час</span><span>Працівник</span><span>Дія</span><span>Об’єкт</span><span>ID</span></div>
          {rows.map((r) => <div className="audit-row" key={r.id}><span>{r.created?.replace('T', ' ')}</span><strong>{r.actor || 'Система'}</strong><span>{r.event}</span><span>{r.entity}</span><span>#{r.entity_id}</span></div>)}
        </div>
        {!rows.length && <Empty title="Журнал порожній" text="Події з’являться після роботи користувачів." />}
      </section>
    </>
  );
}

function Shell({ api, user, onLogout }) {
  const [page, setPage] = useState(defaultPage(user.role));
  const [patientId, setPatientId] = useState(null);
  const navigation = navFor(user.role);

  function openPatient(id) { setPatientId(id); setPage('patient-card'); }
  function navigate(target) { setPatientId(null); setPage(target); }

  const content = (() => {
    if (page === 'patient-card' && patientId) return <PatientCard api={api} role={user.role} patientId={patientId} back={() => navigate('patients')} />;
    if (page === 'dashboard') return <Dashboard api={api} />;
    if (page === 'calendar') return <Calendar api={api} role={user.role} openPatient={openPatient} />;
    if (page === 'patients') return <Patients api={api} role={user.role} openPatient={openPatient} />;
    if (page === 'families') return <Families api={api} />;
    if (page === 'team') return <Team api={api} />;
    if (page === 'rooms') return <Rooms api={api} />;
    if (page === 'reports') return <Reports api={api} role={user.role} />;
    if (page === 'settings') return <Settings api={api} />;
    if (page === 'audit') return <Audit api={api} />;
    return null;
  })();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="product-mark inverse"><span className="solvia-glyph">S</span></div>
          <div><strong>SOLVIA</strong><span>by QureMed</span></div>
        </div>

        <nav>
          <div className="nav-label">РОБОЧИЙ ПРОСТІР</div>
          {navigation.map(([key, label]) => (
            <button key={key} className={`nav-item ${(page === key || (page === 'patient-card' && key === 'patients')) ? 'active' : ''}`} onClick={() => navigate(key)}>
              <span className="nav-icon">{icons[key]}</span><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-version">
          <strong>SOLVIA 2.0</strong>
          <a href="mailto:quremedindastriessupport@gmail.com">quremedindastriessupport@gmail.com</a>
          <small>Support 24/7</small>
        </div>
        <div className="user-card">
          <div className="avatar inverse">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="user-copy"><strong>{user.name}</strong><span>{roleLabels[user.role]}</span></div>
          <IconButton onClick={onLogout} title="Вийти">↪</IconButton>
        </div>
      </aside>

      <main className="workspace">
        <div className="workspace-topbar"><GlobalSearch api={api} onPatient={openPatient} onNavigate={navigate} /></div>
        <div className="workspace-inner">{content}</div>
      </main>
    </div>
  );
}

export default function App() {
  const queryBase = new URLSearchParams(window.location.search).get('api');
  const runtimeBase = window.location.hostname === 'app.solvia.local' ? 'http://127.0.0.1:8765' : window.location.origin;
  const [apiBase, setApiBase] = useState(() => queryBase || localStorage.getItem('solvia_api') || runtimeBase);
  const [token, setToken] = useState(() => sessionStorage.getItem('solvia_token') || '');
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(token));

  useEffect(() => {
    if (queryBase) {
      try {
        const base = cleanBase(queryBase);
        localStorage.setItem('solvia_api', base);
        setApiBase(base);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }
    request(apiBase, token, 'GET', '/api/me')
      .then((me) => setUser(me))
      .catch(() => {
        sessionStorage.removeItem('solvia_token');
        setToken('');
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, []);

  function login(base, result) {
    localStorage.setItem('solvia_api', base);
    sessionStorage.setItem('solvia_token', result.token);
    setApiBase(base);
    setToken(result.token);
    setUser(result.user);
  }

  async function logout() {
    try { await request(apiBase, token, 'POST', '/api/logout'); } catch {}
    sessionStorage.removeItem('solvia_token');
    setToken('');
    setUser(null);
  }

  async function api(method, path, body) {
    try {
      return await request(apiBase, token, method, path, body);
    } catch (e) {
      if (e.status === 401) {
        sessionStorage.removeItem('solvia_token');
        setToken('');
        setUser(null);
      }
      throw e;
    }
  }

  if (booting) {
    return <div className="boot-screen"><div className="product-mark">S</div><Spinner /><span>Відкриваємо SOLVIA…</span></div>;
  }

  if (!user) return <Login initialBase={apiBase} onLogin={login} />;
  return <Shell api={api} user={user} onLogout={logout} />;
}

