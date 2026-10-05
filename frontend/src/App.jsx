import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanBase } from './connection.mjs';
import { draftIdentity, readDraft, writeDraft, removeDraft, DraftWriter } from './drafts.mjs';
import WaitingList from './WaitingList.jsx';
import { navigationFor, flatNavigation } from './navigation.mjs';
import { preferencesKey, readPreferences, applyPreferences } from './preferences.mjs';

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

const referralSourceOptions = [
  'Самозвернення',
  'Військова частина',
  'Сімейний лікар',
  'Психіатр',
  'Невролог',
  'Ветеранський простір',
  'Соціальна служба',
  'Інший заклад',
  'Інше'
];

const referralDestinationOptions = [
  'Психіатр',
  'Невролог',
  'Сімейний лікар',
  'Реабілітація',
  'Соціальний працівник',
  'Юрист',
  'Ветеранський простір',
  'Інший спеціаліст'
];

const documentTemplates = {
  informed_consent: {
    title: 'Інформована згода на психологічну допомогу',
    content: 'Я підтверджую, що отримав(ла) зрозумілу інформацію про формат психологічної допомоги, її добровільність, межі конфіденційності та право припинити участь.'
  },
  data_processing: {
    title: 'Згода на обробку персональних даних',
    content: 'Я надаю згоду центру на обробку персональних даних у межах надання послуг, ведення документації та виконання законних організаційних обов’язків центру.'
  },
  center_rules: {
    title: 'Ознайомлення з правилами центру',
    content: 'Підтверджую, що ознайомився(лась) із правилами центру, порядком запису, перенесення та скасування консультацій і правилами безпечної поведінки.'
  },
  family_consent: {
    title: 'Згода на сімейну консультацію',
    content: 'Надаю добровільну згоду на участь у сімейній консультації та розумію формат спільної роботи й межі конфіденційності.'
  },
  service_refusal: {
    title: 'Відмова від запропонованої послуги',
    content: 'Підтверджую, що мені було запропоновано відповідну послугу/направлення, однак я добровільно відмовляюся від неї після отримання пояснень.'
  },
  other: {
    title: 'Інший документ',
    content: ''
  }
};


const categoryTone = {
  'Військовий/військова': 'olive',
  'Ветеран/ветеранка': 'forest',
  'Партнер/партнерка': 'sand',
  'Дитина': 'sky',
  'Інше': 'stone'
};

function AppIcon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    'waiting-list': <><rect x="3" y="4" width="12" height="17" rx="2"/><path d="M6 8h6M6 12h5M6 16h3"/><circle cx="17" cy="16" r="5"/><path d="M17 13v3l2 1"/></>,
    documents: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/></>,
    preferences: <><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2M18 3l1 1 2-2"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    patients: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    families: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M13.5 20a5 5 0 0 1 7.5-4.3"/></>,
    team: <><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    rooms: <><path d="M4 21V4a1 1 0 0 1 1-1h11v18"/><path d="M16 8h4v13M8 7h4M8 11h4M8 15h4"/><path d="M3 21h18"/></>,
    reports: <><path d="M6 3h12a2 2 0 0 1 2 2v16H4V5a2 2 0 0 1 2-2z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    devices: <><rect x="3" y="4" width="13" height="10" rx="2"/><path d="M8 20h3M9.5 14v6"/><rect x="17" y="8" width="4" height="9" rx="1"/></>,
    workload: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="M2 21h22"/></>,
    supervisions: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 21a6 6 0 0 1 12 0M13 21a5 5 0 0 1 9 0"/><path d="M14 4l2 2 4-4"/></>,
    archive: <><path d="M4 7h16v14H4z"/><path d="M3 3h18v4H3zM9 12h6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H10v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V10h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3H14v.1a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.37.34.71.6 1 .28.3.67.46 1.1.46h.1V14h-.1a1.7 1.7 0 0 0-1.7 1z"/></>,
    preferences: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface,white)"/><circle cx="15" cy="17" r="3" fill="var(--surface,white)"/></>,
    close: <path d="M6 6l12 12M18 6L6 18"/>,
    edit: <><path d="M16 3l5 5-12 12H4v-5zM14 5l5 5"/></>,
    delete: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
    logout: <><path d="M9 3H4v18h5M9 12h12M17 8l4 4-4 4"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="M16 16l5 5"/></>,
    check: <path d="M5 12l4 4L19 6"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,
    audit: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>
  };
  return <svg {...common}>{paths[name] || paths.dashboard}</svg>;
}

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
function printStandaloneNode(node, title = 'SOLVIA Document') {
  if (!node) throw new Error('Не знайдено документ для друку.');

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    border: '0',
    pointerEvents: 'none'
  });
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error('Не вдалося підготувати друк.');
  }

  const safeTitle = String(title).replace(/[<>]/g, '');
  doc.open();
  doc.write(`<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #172f27; font-family: "Segoe UI", Arial, sans-serif; }
  body { width: 210mm; min-height: 297mm; }
  .consent-print, .discharge-print {
    width: 210mm !important;
    min-height: 297mm !important;
    margin: 0 !important;
    padding: 14mm 16mm !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #fff !important;
    color: #172f27 !important;
    font-size: 10.5pt;
  }
  header, .discharge-header {
    display: flex;
    align-items: center;
    gap: 5mm;
    padding-bottom: 5mm;
    margin-bottom: 6mm;
    border-bottom: 1.4pt solid #24684f;
  }
  header img, .discharge-logo {
    width: 18mm !important;
    height: 18mm !important;
    object-fit: contain;
    border-radius: 3mm;
  }
  header > div, .discharge-center-copy { display: grid; gap: 1mm; flex: 1; }
  header strong, .discharge-center-copy strong { font-size: 14pt; color: #173f30; }
  header span, header p, .discharge-center-copy p { margin: 0; color: #64766d; font-size: 8.5pt; }
  .eyebrow {
    color: #49705f !important;
    font-size: 7.5pt !important;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .consent-title, .discharge-title { margin: 6mm 0 5mm; }
  .consent-title h1, .discharge-title h1 {
    margin: 1.5mm 0 0 !important;
    color: #111 !important;
    font-size: 19pt !important;
    line-height: 1.15;
    letter-spacing: 0 !important;
  }
  .discharge-title { text-align: center; }
  .discharge-title p { margin: 1.5mm 0 0; color: #65776e; font-size: 8.5pt; }
  .consent-body {
    min-height: 0 !important;
    margin: 0 0 7mm;
    white-space: pre-wrap;
    line-height: 1.55;
    font-size: 11pt;
  }
  .profile-list {
    display: grid;
    margin: 0;
    padding: 0;
  }
  .profile-list > div {
    display: grid;
    grid-template-columns: 42mm 1fr;
    gap: 5mm;
    align-items: baseline;
    padding: 2.7mm 0;
    border-bottom: .5pt solid #e0e7e2;
  }
  .profile-list dt { color: #61736a; font-size: 8.5pt; }
  .profile-list dd { margin: 0; text-align: right; font-size: 9pt; font-weight: 650; overflow-wrap: anywhere; }
  .saved-signature {
    width: 72mm !important;
    margin: 9mm 0 5mm auto !important;
    display: grid;
    gap: 1mm;
    text-align: center;
    border-bottom: .7pt solid #39473f !important;
    break-inside: avoid;
  }
  .saved-signature img {
    width: 100% !important;
    height: 24mm !important;
    object-fit: contain;
  }
  .saved-signature span { color: #66766e; font-size: 7.5pt; }
  .consent-print footer,
  .discharge-footer {
    margin-top: 7mm !important;
    padding-top: 3mm !important;
    border-top: .5pt solid #dce4df !important;
    color: #6d7d75 !important;
    font-size: 7.5pt !important;
    break-inside: avoid;
  }
  .discharge-doc-number { margin-left: auto; color: #1d5e47; font-size: 9pt; font-weight: 700; white-space: nowrap; }
  .discharge-profile {
    margin: 0 0 6mm !important;
    padding: 4mm !important;
    border: .5pt solid #dfe8e2;
    border-radius: 3mm;
    background: #f8faf9 !important;
  }
  .discharge-print section { margin-top: 5mm; break-inside: avoid; }
  .discharge-print section h3 { margin: 0 0 1.5mm; color: #436a59; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; }
  .discharge-print section p { margin: 0; white-space: pre-wrap; line-height: 1.5; font-size: 9.5pt; }
  .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; margin-top: 10mm; break-inside: avoid; }
  .signature-block { display: grid; gap: 2mm; }
  .signature-block strong { color: #526b60; font-size: 8pt; }
  .signature-block span { min-height: 6mm; font-size: 9pt; font-weight: 650; }
  .signature-line { border-top: .6pt solid #647a70; padding-top: 1.5mm; text-align: center; color: #7b8a83; font-size: 7pt; }
  .no-print, button { display: none !important; }
</style>
</head>
<body>${node.outerHTML}</body>
</html>`);
  doc.close();

  const cleanup = () => {
    try { frame.remove(); } catch {}
  };

  const runPrint = async () => {
    const images = [...doc.images];
    await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    })));
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        setTimeout(cleanup, 1500);
      }
    }, 80);
  };
  void runPrint();
}

function deviceIdentity() {
  let id = localStorage.getItem('solvia_device_id');
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `win-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('solvia_device_id', id);
  }
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Windows';
  return { device_id: id, device_name: `SOLVIA · ${platform}`, platform: window.chrome?.webview ? 'Windows' : platform };
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
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw Object.assign(new Error('Немає зв’язку із сервером. Перевірте підключення до мережі. Якщо проблема повторюється, зверніться до адміністратора центру.'), { status: 0 });
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

const navFor = flatNavigation;

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
  const dialogRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    const controls = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
    (controls()[0] || dialog).focus();
    const keydown = e => {
      if (e.key === 'Tab') {
        const list = controls(), first = list[0], last = list.at(-1);
        if (!first) { e.preventDefault(); dialog.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener('keydown', keydown);
    return () => { dialog.removeEventListener('keydown', keydown); if (opener?.isConnected) opener.focus(); };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`dialog ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} aria-label="Закрити"><AppIcon name="close" /></IconButton>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children, full = false }) {
  const controls = React.Children.map(children, child => React.isValidElement(child) && ['input', 'select', 'textarea'].includes(child.type)
    ? React.cloneElement(child, { 'aria-label': child.props['aria-label'] || label }) : child);
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {controls}
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
  const [showServer, setShowServer] = useState(!initialBase);
  const [showPassword, setShowPassword] = useState(false);
  const [connection, setConnection] = useState('');
  const [checking, setChecking] = useState(false);

  async function checkConnection() {
    setChecking(true); setConnection(''); setError('');
    try {
      const base = cleanBase(server);
      const health = await request(base, '', 'GET', '/api/health');
      if (health.ok !== true || !health.version) throw new Error('Не вдалося підключитися до SOLVIA. Уточніть адресу в адміністратора центру.');
      localStorage.setItem('solvia_api', base);
      setConnection('З’єднання з центром встановлено. Можна входити.');
    } catch (e) { setError(e.message); }
    finally { setChecking(false); }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const base = cleanBase(server);
      const result = await request(base, '', 'POST', '/api/login', { login, password, ...deviceIdentity() });
      await onLogin(base, result, password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen product-login">
      <section className="login-brand">
        <div className="login-wordmark"><img src="/solvia-icon.png" alt="" /><div><strong>SOLVIA</strong><span>QureMed Industries</span></div></div>
        <div className="login-brand-copy">
          <div className="eyebrow light">ПРОСТІР ВАШОГО ЦЕНТРУ</div>
          <h1>Більше уваги людям.<br /><span>Менше зайвої роботи.</span></h1>
          <p>Розклад, картки пацієнтів і документи — в одному зручному просторі для вашої команди.</p>
          <div className="login-features">
            <div><AppIcon name="calendar" /><span>Записи та розклад</span></div>
            <div><AppIcon name="patients" /><span>Супровід пацієнтів</span></div>
            <div><AppIcon name="documents" /><span>Документи та звіти</span></div>
          </div>
        </div>
        <div className="login-brand-footer"><AppIcon name="lock" size={16} /><span>Персональний доступ для кожного працівника</span></div>
      </section>
      <section className="login-panel" aria-label="Вхід до SOLVIA">
        <form className="login-card" onSubmit={submit}>
          <div className="login-mobile-brand"><img src="/solvia-icon.png" alt="" /><strong>SOLVIA</strong></div>
          <div className="login-copy"><div className="eyebrow">ЛАСКАВО ПРОСИМО</div><h2>Вхід до SOLVIA</h2><p>Увійдіть до свого облікового запису, щоб почати роботу.</p></div>
          {error && <div className="alert error" role="alert">{error}</div>}
          <Field label="Логін" full>
            <input value={login} onChange={e => setLogin(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Введіть свій логін" required />
          </Field>
          <Field label="Пароль" full>
            <div className="password-control"><input aria-label="Пароль" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="Введіть пароль" required /><button type="button" aria-label={showPassword ? 'Приховати пароль' : 'Показати пароль'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Приховати' : 'Показати'}</button></div>
          </Field>
          <Button type="submit" className="login-submit" disabled={busy || checking || !server.trim()}>{busy ? 'Входимо…' : 'Увійти до SOLVIA'}<span aria-hidden="true">→</span></Button>
          <p className="login-help">Забули пароль або не маєте доступу?<br />Зверніться до адміністратора вашого центру.</p>
          <button type="button" className="server-toggle" aria-expanded={showServer} aria-controls="login-connection" onClick={() => setShowServer(value => !value)}>Підключення до центру <span aria-hidden="true">{showServer ? '−' : '+'}</span></button>
          {showServer && <div id="login-connection" className="login-connection">
            <Field label="Адреса центру" hint="Адресу для підключення надає адміністратор центру." full><input value={server} onChange={e => { setServer(e.target.value); setConnection(''); }} spellCheck={false} autoCapitalize="none" placeholder="https://…" /></Field>
            <Button type="button" variant="secondary" onClick={checkConnection} disabled={checking || busy || !server.trim()}>{checking ? 'Перевіряємо…' : 'Перевірити підключення'}</Button>
            {connection && <div className="alert info" role="status">{connection}</div>}
          </div>}
          <div className="login-foot">SOLVIA · QureMed Industries</div>
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
    ['Активні пацієнти', stats.active_patients, 'Зараз проходять супровід'],
    ['Архів', stats.archived_patients, 'Завершені та архівовані картки'],
    ['Нові звернення', stats.new_patients, 'За обраний період'],
    ['Консультації', stats.consultations, 'Збережені психологами'],
    ['Середня тривалість', stats.avg_duration_minutes + ' хв', 'Консультації за період'],
    ['Активні курси', stats.active_courses, 'Поточні курси супроводу'],
    ['Завершені курси', stats.completed_courses, 'За обраний період'],
    ['Підписані документи', stats.signed_documents, 'Згоди та документи'],
    ['Направлення', stats.outgoing_referrals, 'Створено за період'],
    ['Супервізії', stats.supervisions_completed, 'Завершено за період'],
    ['Неявки', stats.appointments?.no_show || 0, 'За обраний період']
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

          <div className="analytics-grid">
            <section className="surface">
              <div className="section-head"><div><div className="eyebrow">СТРУКТУРА ЗВЕРНЕНЬ</div><h2>Категорії пацієнтів</h2></div></div>
              <div className="analytics-list">
                {(stats.categories || []).map((x) => <div key={x.category}><span>{x.category}</span><strong>{x.n}</strong></div>)}
                {!stats.categories?.length && <span className="muted">Даних ще немає.</span>}
              </div>
            </section>
            <section className="surface">
              <div className="section-head"><div><div className="eyebrow">НАПРАВЛЕННЯ В ЦЕНТР</div><h2>Звідки приходять пацієнти</h2></div></div>
              <div className="analytics-list">
                {(stats.referral_sources || []).map((x) => <div key={x.source}><span>{x.source}</span><strong>{x.n}</strong></div>)}
                {!stats.referral_sources?.length && <span className="muted">Даних ще немає.</span>}
              </div>
            </section>
          </div>
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
      start: meta.workflow?.opening_time || '08:00',
      end: (() => { const [h,m]=(meta.workflow?.opening_time || '08:00').split(':').map(Number);const n=h*60+m+(meta.workflow?.default_duration_minutes || 60);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); })(),
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
      if (['individual','child','crisis'].includes(booking.kind)) ids = ids.slice(0, 1);
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
                <option value="family">Сімейна консультація</option>
                <option value="child">Дитяча консультація</option>
                <option value="crisis">Кризова консультація</option>
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
                  end: (() => { const [h,m]=slot.split(':').map(Number); const n=h*60+m+(meta.workflow?.default_duration_minutes || 60); return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); })(),
                  status: 'scheduled', note: '',
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
    referral_source: '',
    referral_source_details: '',
    course_reason: '',
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
    return patients.filter((p) => [p.patient_no, p.name, p.phone, p.category, p.psychologist, p.family].some((v) => String(v || '').toLowerCase().includes(q)));
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
      referral_source: '',
      referral_source_details: '',
      course_reason: '',
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
        referral_source: form.referral_source,
        referral_source_details: form.referral_source_details,
        course_reason: form.course_reason,
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
            <span><AppIcon name="search" /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Пошук за №, ПІБ, телефоном, категорією…" />
          </div>
          <Badge tone="stone">{filtered.length} записів</Badge>
        </div>

        {!filtered.length ? <Empty title="Нічого не знайдено" text="Спробуйте змінити запит або створіть нового пацієнта." /> : (
          <div className="patient-card-list">
            {filtered.map((p) => (
              <button className="patient-list-card" key={p.id} onClick={() => openPatient(p.id)}>
                <span className="patient-card-accent" />
                <span className="patient-card-head">
                  <span className="avatar patient-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                  <span className="patient-card-name">
                    <small>ПАЦІЄНТ · №{p.patient_no || '—'}</small>
                    <strong>{p.name}</strong>
                    <span>{p.phone}</span>
                  </span>
                  <span className="patient-card-arrow">↗</span>
                </span>
                <span className="patient-card-tags">
                  <Badge tone={categoryTone[p.category] || 'stone'}>{p.category}</Badge>
                </span>
                <span className="patient-card-meta">
                  <span><small>ПСИХОЛОГ</small><strong>{p.psychologist || 'Не призначено'}</strong></span>
                  <span><small>СІМ’Я</small><strong>{p.family || 'Без сімейного зв’язку'}</strong></span>
                </span>
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
            <Field label="Звідки направлений / звернувся">
              <select value={form.referral_source} onChange={(e) => setForm({ ...form, referral_source: e.target.value })}>
                <option value="">Не вказано</option>
                {referralSourceOptions.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Деталі направлення">
              <input value={form.referral_source_details} onChange={(e) => setForm({ ...form, referral_source_details: e.target.value })} placeholder="Заклад, підрозділ, лікар…" />
            </Field>
            <Field label="Причина початку курсу" full>
              <textarea rows="3" value={form.course_reason} onChange={(e) => setForm({ ...form, course_reason: e.target.value })} placeholder="Коротко: запит / причина звернення" />
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

function PatientCard({ api, role, patientId, back, draftSession }) {
  const draftWriter = useRef(null);
  const [draftStatus, setDraftStatus] = useState('');
  const [consultBusy, setConsultBusy] = useState(false);
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
  const [discharge, setDischarge] = useState({ date_from: monthStart(), date_to: localDate() });
  const [printDoc, setPrintDoc] = useState(null);
  const [patientEdit, setPatientEdit] = useState({ name: '', phone: '', dob: '', category: '', psychologist_id: '', family_id: '', family_role: '', sex: '', address: '', status: 'active', referral_source: '', referral_source_details: '', admin_note: '' });
  const [editMeta, setEditMeta] = useState({ psychologists: [], categories: [] });
  const [editFamilies, setEditFamilies] = useState([]);
  const [documentForm, setDocumentForm] = useState({
    document_type: 'informed_consent',
    title: documentTemplates.informed_consent.title,
    content: documentTemplates.informed_consent.content,
    status: 'signed',
    signed_by_name: '',
    signature_data: ''
  });
  const [documentPreview, setDocumentPreview] = useState(null);
  const [referralForm, setReferralForm] = useState({ destination_type: 'Психіатр', destination_name: '', reason: '', status: 'recommended' });
  const [courseForm, setCourseForm] = useState({ started_at: localDate(), reason: '' });
  const [courseClose, setCourseClose] = useState({ ended_at: localDate(), outcome: '' });

  const isPsychologist = role === 'psychologist';
  const isAdmin = role === 'admin';
  const isReception = role === 'reception';
  const canManageCourse = isAdmin || isReception;
  const canManageDocuments = isAdmin || isReception || isPsychologist;
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

  async function openConsultation(options = {}) {
    const discardLocal = options.discardLocal === true;
    setDraftStatus('loading'); setError('');
    await draftWriter.current?.stop();
    let local = null, remote = null;
    try { local = await readDraft(draftSession, patientId); }
    catch { setError('Локальна чернетка не розшифрувалася. Можливо, пароль змінено. Серверна копія залишається доступною.'); }
    try { remote = await api('GET', `/api/patients/${patientId}/draft`); }
    catch (e) { if (!local) setError(e.message); }
    if (discardLocal && !remote) { setDraftStatus('offline'); return; }
    let restored = !discardLocal && local?.dirty ? local.payload : remote ? remote.payload : local?.payload;
    const alreadySaved = restored?.client_key && card?.consultations?.some(c => c.client_key === restored.client_key);
    if (alreadySaved) {
      await removeDraft(draftSession, patientId).catch(() => {});
      let clearedVersion = remote?.version || 0;
      if (remote?.version) {
        const result = await api('DELETE', `/api/patients/${patientId}/draft`, { version: remote.version }).catch(() => null);
        if (result) clearedVersion = result.version;
      }
      restored = null; remote = { version: clearedVersion, payload: null }; local = null;
    }
    const initial = {
      appointment_id: '', consultation_type: 'repeat', duration_minutes: 60,
      request_text: '', state_text: '', work_done: '', note: '', goals: '',
      next_plan: '', homework: '', recommendations: '', result_text: '',
      risk_level: 'low', risk_flags: [], client_key: crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
      ...restored
    };
    const date = restored?.consult_date || localDate();
    setConsultDate(date); setConsultation(initial);
    const writer = new DraftWriter({ identity: draftSession, patientId, api, version: remote?.version ?? local?.version ?? 0, status: setDraftStatus });
    draftWriter.current = writer;
    if (!discardLocal && local?.dirty && remote && local.version !== remote.version) {
      writer.version = local.version;
      writer.conflict = true; setDraftStatus('conflict');
    } else {
      setDraftStatus(restored ? 'saved' : 'ready');
      if (discardLocal) await writeDraft(draftSession, patientId, { payload: initial, version: writer.version, dirty: false }).catch(() => {});
    }
    setDayAppointments([]);
    setDialog('consultation');
    loadConsultationsForDay(date);
  }

  useEffect(() => {
    if (dialog === 'consultation' && draftWriter.current) draftWriter.current.edit({ ...consultation, consult_date: consultDate });
  }, [consultation, consultDate, dialog]);
  useEffect(() => {
    const flush = () => { void draftWriter.current?.flush(); };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const beforeUnload = (e) => {
      const writer = draftWriter.current;
      if (writer && writer.generation > writer.synced) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('online', flush); document.addEventListener('visibilitychange', visibility); window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('online', flush); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('beforeunload', beforeUnload);
      void draftWriter.current?.stop();
    };
  }, [patientId]);

  async function closeConsultation() {
    await draftWriter.current?.flush();
    setDialog('');
  }

  const eligibleAppointments = useMemo(() => {
    if (!card) return [];
    const completed = new Set((card.consultations || []).map((c) => Number(c.appointment_id)));
    return dayAppointments.filter((a) =>
      (a.status === 'scheduled' || a.status === 'confirmed') &&
      !completed.has(Number(a.id)) &&
      a.patients?.some((p) => Number(p.id) === Number(patientId))
    );
  }, [dayAppointments, card, patientId]);

  async function saveConsultation(e) {
    e.preventDefault();
    if (consultBusy) return;
    setConsultBusy(true);
    try {
      await draftWriter.current?.flush();
      if (draftWriter.current?.conflict) throw new Error('Спочатку вирішіть конфлікт чернеток.');
      await api('POST', '/api/consultations', {
        client_key: consultation.client_key,
        draft_version: draftWriter.current?.version || 0,
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
      await draftWriter.current?.stop();
      draftWriter.current = null;
      await removeDraft(draftSession, patientId).catch(() => {});
      setDialog('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally { setConsultBusy(false); }
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
      const result = await api('POST', '/api/discharges', { patient_id: Number(patientId), ...discharge });
      setPrintDoc({ item: { ...result, date_from: discharge.date_from, date_to: discharge.date_to, created: localDate(), psychologist: result.psychologist }, center: result.center });
      setDialog('print-discharge');
      await load();
    } catch (e) { setError(e.message); }
  }

  async function openDischargePrint(item) {
    try {
      const center = await api('GET', '/api/settings/center');
      setPrintDoc({ item, center });
      setDialog('print-discharge');
    } catch (e) { setError(e.message); }
  }

  function printDischargeDocument() {
    const node = document.querySelector('.discharge-print');
    printStandaloneNode(
      node,
      `Виписка №${printDoc?.item?.document_no || printDoc?.item?.patient_no_snapshot || card.patient_no || '00000'} — ${printDoc?.item?.patient_name || card.name}`
    );
  }

  async function openPatientEdit() {
    try {
      const [meta, families] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/families')]);
      setEditMeta(meta);
      setEditFamilies(families);
      setPatientEdit({
        name: card.name || '',
        phone: card.phone || '',
        dob: card.dob || '',
        category: card.category || '',
        psychologist_id: String(card.psychologist_id || ''),
        family_id: card.family_id ? String(card.family_id) : '',
        family_role: card.family_role || '',
        sex: card.sex || '',
        address: card.address || '',
        status: card.status || 'active',
        referral_source: card.referral_source || '',
        referral_source_details: card.referral_source_details || '',
        admin_note: card.admin_note || ''
      });
      setDialog('edit-patient');
    } catch (e) { setError(e.message); }
  }

  async function savePatientEdit(e) {
    e.preventDefault();
    try {
      await api('PATCH', `/api/patients/${patientId}`, {
        ...patientEdit,
        psychologist_id: Number(patientEdit.psychologist_id),
        family_id: patientEdit.family_id ? Number(patientEdit.family_id) : null
      });
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


  function openDocumentDialog(type = 'informed_consent') {
    const template = documentTemplates[type] || documentTemplates.other;
    setDocumentForm({
      document_type: type,
      title: template.title,
      content: template.content,
      status: 'signed',
      signed_by_name: card?.name || '',
      signature_data: ''
    });
    setDialog('document');
  }

  function changeDocumentType(type) {
    const template = documentTemplates[type] || documentTemplates.other;
    setDocumentForm((current) => ({
      ...current,
      document_type: type,
      title: template.title,
      content: template.content,
      status: 'signed',
      signature_data: ''
    }));
  }

  async function saveDocument(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/patients/' + patientId + '/documents', documentForm);
      setDialog('');
      await load();
    } catch (e) { setError(e.message); }
  }

  async function previewDocument(id) {
    try {
      const [docs, center] = await Promise.all([
        api('GET', '/api/patients/' + patientId + '/documents'),
        api('GET', '/api/settings/center')
      ]);
      const item = docs.find((x) => Number(x.id) === Number(id));
      if (!item) throw new Error('Документ не знайдено');
      setDocumentPreview({ ...item, center });
      setDialog('print-document');
    } catch (e) { setError(e.message); }
  }

  function printDocument() {
    const node = document.querySelector('.consent-print');
    printStandaloneNode(
      node,
      (documentPreview?.title || 'Документ SOLVIA') + ' — ' + (documentPreview?.patient_name || card.name)
    );
  }

  async function saveReferral(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/patients/' + patientId + '/referrals', referralForm);
      setReferralForm({ destination_type: 'Психіатр', destination_name: '', reason: '', status: 'recommended' });
      setDialog('');
      await load();
    } catch (e) { setError(e.message); }
  }

  async function setReferralStatus(id, status) {
    try {
      await api('PATCH', '/api/referrals/' + id, { status });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function startNewCourse(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/patients/' + patientId + '/courses', courseForm);
      setCourseForm({ started_at: localDate(), reason: '' });
      setDialog('');
      await load();
    } catch (e) { setError(e.message); }
  }

  async function archiveActiveCourse(e) {
    e.preventDefault();
    const activeCourse = (card.courses || []).find((x) => x.status === 'active');
    if (!activeCourse) { setError('Активного курсу немає.'); return; }
    try {
      await api('PATCH', '/api/courses/' + activeCourse.id, {
        status: 'archived',
        ended_at: courseClose.ended_at,
        outcome: courseClose.outcome
      });
      setCourseClose({ ended_at: localDate(), outcome: '' });
      setDialog('');
      await load();
    } catch (e) { setError(e.message); }
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
  const activeCourse = (card.courses || []).find((x) => x.status === 'active');

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
              <Badge tone="forest">№{card.patient_no || '—'}</Badge>
              <Badge tone={categoryTone[card.category] || 'stone'}>{card.category}</Badge>
              <span>{card.phone}</span>
              <span>Народження: {card.dob}</span>
            </div>
          </div>
        </div>
        {(isPsychologist || isAdmin || isReception) && (
          <div className="page-actions">
            {isPsychologist && <Button variant="secondary" onClick={assignAssessment}>Призначити анкету</Button>}
            {isPsychologist && card.status === 'active' && <Button onClick={openConsultation}>+ Консультація</Button>}
            {(isAdmin || isReception) && <Button variant="secondary" onClick={openPatientEdit}>Редагувати профіль</Button>}
            {isAdmin && <Button variant="secondary" onClick={() => setDialog('admin-note')}>+ Службова нотатка</Button>}
            {(isAdmin || isPsychologist) && <Button variant="secondary" onClick={() => setDialog('discharge')}>Сформувати виписку</Button>}
            {canManageCourse && activeCourse && <Button variant="secondary" onClick={() => setDialog('archive-course')}>Завершити курс</Button>}
            {canManageCourse && !activeCourse && <Button onClick={() => setDialog('new-course')}>+ Новий курс</Button>}
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
            <div><dt>Звідки звернувся</dt><dd>{card.referral_source || 'Не вказано'}</dd></div>
            <div><dt>Деталі направлення</dt><dd>{card.referral_source_details || '—'}</dd></div>
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
            <div className="privacy-icon"><AppIcon name={canReadConsultations ? "check" : "lock"} size={22} /></div>
            <div>
              <strong>{isPsychologist ? 'Приватні записи доступні' : isAdmin ? 'Записи доступні для контролю' : 'Нотатки психолога приховані'}</strong>
              <p>{isPsychologist ? 'Ви бачите записи лише цього пацієнта, який закріплений за вашим профілем.' : isAdmin ? 'Адміністратор має доступ до записів психологів у режимі перегляду. Зміни вносить тільки психолог.' : 'Реєстратура та керівник центру не отримують текст консультацій.'}</p>
            </div>
          </div>
        </section>
      </div>

      <section className="surface">
        <div className="section-head">
          <div><div className="eyebrow">КУРСИ СУПРОВОДУ</div><h2>Історія курсів</h2></div>
          <Badge tone={activeCourse ? 'forest' : 'stone'}>{activeCourse ? 'Активний курс' : 'Немає активного курсу'}</Badge>
        </div>
        {!card.courses?.length ? <Empty title="Курсів ще немає" text="Створіть перший курс супроводу." /> : (
          <div className="course-list">
            {card.courses.map((c) => (
              <article className="course-card" key={c.id}>
                <div>
                  <div className="eyebrow">КУРС №{c.course_no}</div>
                  <strong>{c.started_at} {c.ended_at ? '— ' + c.ended_at : '— дотепер'}</strong>
                  <span>{c.psychologist}</span>
                </div>
                <div>
                  <Badge tone={c.status === 'active' ? 'forest' : 'stone'}>{c.status}</Badge>
                  {c.reason && <p><b>Причина:</b> {c.reason}</p>}
                  {c.outcome && <p><b>Підсумок:</b> {c.outcome}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="patient-card-grid">
        <section className="surface">
          <div className="section-head">
            <div><div className="eyebrow">ДОКУМЕНТИ ТА ЗГОДИ</div><h2>Підписані документи</h2></div>
            {canManageDocuments && <Button variant="secondary" onClick={() => openDocumentDialog()}>+ Документ</Button>}
          </div>
          {!card.documents?.length ? <Empty title="Документів ще немає" text="Додайте згоду, правила центру або відмову від послуги." /> : (
            <div className="assessment-list">
              {card.documents.map((d) => (
                <div className="assessment-row" key={d.id}>
                  <div><strong>{d.title}</strong><span>{d.signed_at?.replace('T',' ')} · {d.signed_by_name || 'без підписанта'}</span></div>
                  <div className="row-actions"><Badge tone={d.status === 'signed' ? 'forest' : 'rose'}>{d.status}</Badge><Button variant="secondary" onClick={() => previewDocument(d.id)}>Перегляд / PDF</Button></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="surface">
          <div className="section-head">
            <div><div className="eyebrow">НАПРАВЛЕННЯ</div><h2>Подальший маршрут</h2></div>
            <Button variant="secondary" onClick={() => setDialog('referral')}>+ Направлення</Button>
          </div>
          {!card.referrals?.length ? <Empty title="Направлень немає" text="За потреби додайте направлення до іншого спеціаліста або служби." /> : (
            <div className="assessment-list">
              {card.referrals.map((x) => (
                <div className="assessment-row referral-row" key={x.id}>
                  <div><strong>{x.destination_type}{x.destination_name ? ' · ' + x.destination_name : ''}</strong><span>{x.reason || 'Без додаткового коментаря'} · {x.created?.replace('T',' ')}</span></div>
                  <select value={x.status} onChange={(e) => setReferralStatus(x.id, e.target.value)}>
                    <option value="recommended">Рекомендовано</option>
                    <option value="sent">Направлено</option>
                    <option value="completed">Виконано</option>
                    <option value="cancelled">Скасовано</option>
                  </select>
                </div>
              ))}
            </div>
          )}
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
                  <Button variant="secondary" onClick={() => openDischargePrint(d)}>Перегляд / PDF</Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}


      {dialog === 'document' && canManageDocuments && (
        <Dialog title="Документ / згода" subtitle={card.name} onClose={() => setDialog('')} wide>
          <form className="form-grid" onSubmit={saveDocument}>
            <Field label="Тип документа">
              <select value={documentForm.document_type} onChange={(e) => changeDocumentType(e.target.value)}>
                <option value="informed_consent">Інформована згода</option>
                <option value="data_processing">Обробка персональних даних</option>
                <option value="center_rules">Правила центру</option>
                <option value="family_consent">Сімейна консультація</option>
                <option value="service_refusal">Відмова від послуги</option>
                <option value="other">Інший документ</option>
              </select>
            </Field>
            <Field label="Статус">
              <select value={documentForm.status} onChange={(e) => setDocumentForm({ ...documentForm, status: e.target.value })}>
                <option value="signed">Підписано</option>
                <option value="refused">Відмова</option>
              </select>
            </Field>
            <Field label="Назва" full><input value={documentForm.title} onChange={(e) => setDocumentForm({ ...documentForm, title: e.target.value })} required /></Field>
            <Field label="Текст документа" full><textarea rows="8" value={documentForm.content} onChange={(e) => setDocumentForm({ ...documentForm, content: e.target.value })} /></Field>
            <Field label="ПІБ підписанта" full><input value={documentForm.signed_by_name} onChange={(e) => setDocumentForm({ ...documentForm, signed_by_name: e.target.value })} /></Field>
            {documentForm.status === 'signed' && (
              <div className="field full">
                <span>Підпис пацієнта / представника</span>
                <SignaturePad value={documentForm.signature_data} onChange={(signature_data) => setDocumentForm({ ...documentForm, signature_data })} />
              </div>
            )}
            <div className="alert info full-span">Після збереження підпис і текст документа залишаються в картці. Кнопка «Перегляд / PDF» формує друковану версію для збереження у PDF.</div>
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Зберегти документ</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'print-document' && documentPreview && (
        <Dialog title={documentPreview.title} subtitle="Підписаний документ" onClose={() => { setDialog(''); setDocumentPreview(null); }} wide>
          <article className="consent-print">
            <header>
              <img src={documentPreview.center?.logo_data || '/solvia-icon.png'} alt="SOLVIA" />
              <div><strong>{documentPreview.center_name_snapshot || documentPreview.center?.center_name || 'SOLVIA Center'}</strong><span>{documentPreview.center_address_snapshot || documentPreview.center?.address || ''}</span></div>
            </header>
            <div className="consent-title"><div className="eyebrow">ДОКУМЕНТ ПАЦІЄНТА · №{documentPreview.patient_no_snapshot || card.patient_no}</div><h1>{documentPreview.title}</h1></div>
            <p className="consent-body">{documentPreview.content || '—'}</p>
            <dl className="profile-list">
              <div><dt>Пацієнт</dt><dd>{documentPreview.patient_name || card.name}</dd></div>
              <div><dt>№ картки</dt><dd>№{documentPreview.patient_no_snapshot || card.patient_no || '—'}</dd></div>
              <div><dt>Дата народження</dt><dd>{documentPreview.patient_dob || card.dob || '—'}</dd></div>
              <div><dt>Категорія</dt><dd>{documentPreview.patient_category || card.category || '—'}</dd></div>
              <div><dt>Статус</dt><dd>{documentPreview.status === 'signed' ? 'Підписано' : documentPreview.status === 'refused' ? 'Відмова' : documentPreview.status}</dd></div>
              <div><dt>Підписант</dt><dd>{documentPreview.signed_by_name || '—'}</dd></div>
              <div><dt>Дата</dt><dd>{documentPreview.signed_at?.replace('T',' ')}</dd></div>
            </dl>
            {documentPreview.signature_data && <div className="saved-signature"><img src={documentPreview.signature_data} alt="Підпис" /><span>підпис</span></div>}
            <footer>
              <span>{documentPreview.center_name_snapshot || documentPreview.center?.center_name || 'SOLVIA Center'}</span>
              <span>{[documentPreview.center_phone_snapshot || documentPreview.center?.phone, documentPreview.center_email_snapshot || documentPreview.center?.email].filter(Boolean).join(' · ')}</span>
              <span>{documentPreview.center?.document_footer || 'SOLVIA by QureMed'}</span>
            </footer>
          </article>
          <div className="form-actions no-print"><Button variant="ghost" onClick={() => { setDialog(''); setDocumentPreview(null); }}>Закрити</Button><Button onClick={printDocument}>Друк / Зберегти PDF</Button></div>
        </Dialog>
      )}

      {dialog === 'referral' && (
        <Dialog title="Нове направлення" subtitle={card.name} onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={saveReferral}>
            <Field label="Куди направити">
              <select value={referralForm.destination_type} onChange={(e) => setReferralForm({ ...referralForm, destination_type: e.target.value })}>
                {referralDestinationOptions.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Заклад / спеціаліст"><input value={referralForm.destination_name} onChange={(e) => setReferralForm({ ...referralForm, destination_name: e.target.value })} placeholder="Необов’язково" /></Field>
            <Field label="Причина / мета направлення" full><textarea rows="5" value={referralForm.reason} onChange={(e) => setReferralForm({ ...referralForm, reason: e.target.value })} /></Field>
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Створити направлення</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'archive-course' && canManageCourse && activeCourse && (
        <Dialog title="Завершити курс" subtitle={'Курс №' + activeCourse.course_no + ' · ' + card.name} onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={archiveActiveCourse}>
            <Field label="Дата завершення"><input type="date" value={courseClose.ended_at} onChange={(e) => setCourseClose({ ...courseClose, ended_at: e.target.value })} required /></Field>
            <Field label="Підсумок курсу" full><textarea rows="6" value={courseClose.outcome} onChange={(e) => setCourseClose({ ...courseClose, outcome: e.target.value })} placeholder="Організаційний підсумок курсу без дублювання приватних нотаток." /></Field>
            <div className="alert info full-span">Після завершення картка перейде в архів. Консультації, документи, направлення й попередня історія залишаться в базі.</div>
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Завершити й архівувати</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'new-course' && canManageCourse && !activeCourse && (
        <Dialog title="Новий курс" subtitle={'Повторне звернення · ' + card.name} onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={startNewCourse}>
            <Field label="Дата початку"><input type="date" value={courseForm.started_at} onChange={(e) => setCourseForm({ ...courseForm, started_at: e.target.value })} required /></Field>
            <Field label="Причина повторного звернення" full><textarea rows="5" value={courseForm.reason} onChange={(e) => setCourseForm({ ...courseForm, reason: e.target.value })} /></Field>
            <div className="alert info full-span">Створиться наступний курс у цій самій картці. Попередні курси та документи не змінюються.</div>
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Відкрити новий курс</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'consultation' && (
        <Dialog title="Підсумок консультації" subtitle={card.name} onClose={() => { if (!consultBusy) void closeConsultation(); }} wide>
          {error && <div className="alert error">{error}</div>}
          <div className={`draft-status ${draftStatus}`} role="status">
            <AppIcon name="documents" />
            <span>{{ ready: 'Автозбереження увімкнено', loading: 'Відновлюємо чернетку…', local: 'Зашифровано на цьому пристрої', saving: 'Зберігаємо на сервері…', saved: 'Чернетку збережено', offline: 'Немає зв’язку. Локальна копія зашифрована; повторимо при підключенні.', memory: 'Локальне сховище недоступне. Не закривайте вікно до збереження на сервері.', conflict: 'Чернетку змінено на іншому пристрої. Ваш текст не перезаписано.' }[draftStatus]}</span>
            <Button type="button" variant="ghost" onClick={() => draftWriter.current?.flush()}>Повторити</Button>
          </div>
          {!draftSession?.key && <div className="alert info">Після перезавантаження увійдіть повторно для розблокування зашифрованих локальних чернеток. Серверне збереження працює.</div>}
          {draftStatus === 'conflict' && <Button type="button" variant="secondary" onClick={() => { if (window.confirm('Замінити текст у цьому вікні актуальною серверною чернеткою? Локальні незбережені зміни буде втрачено.')) void openConsultation({ discardLocal: true }); }}>Завантажити серверну версію</Button>}
          <form className="form-grid" onSubmit={saveConsultation}>
            <fieldset className="form-contents" disabled={consultBusy}>
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
              <Button type="button" variant="ghost" disabled={consultBusy} onClick={closeConsultation}>Закрити · залишити чернетку</Button>
              <Button type="submit" disabled={consultBusy || draftStatus === 'conflict'}>{consultBusy ? 'Зберігаємо…' : 'Зберегти консультацію'}</Button>
            </div>
            </fieldset>
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
            <Field label="Початок періоду"><input type="date" value={discharge.date_from} onChange={(e) => setDischarge({ ...discharge, date_from: e.target.value })} required /></Field>
            <Field label="Кінець періоду"><input type="date" value={discharge.date_to} onChange={(e) => setDischarge({ ...discharge, date_to: e.target.value })} required /></Field>
            <div className="alert info full-span">SOLVIA сама сформує підсумок, динаміку, рекомендації та подальший супровід із завершених консультацій за цей період. Психолог повторно нічого не переписує.</div>
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Сформувати виписку</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'edit-patient' && (isAdmin || isReception) && (
        <Dialog title="Редагувати профіль пацієнта" subtitle={card.name} onClose={() => setDialog('')} wide>
          <form className="form-grid" onSubmit={savePatientEdit}>
            <Field label="ПІБ" full><input value={patientEdit.name} onChange={(e) => setPatientEdit({ ...patientEdit, name: e.target.value })} required /></Field>
            <Field label="Телефон"><input value={patientEdit.phone} onChange={(e) => setPatientEdit({ ...patientEdit, phone: e.target.value })} required /></Field>
            <Field label="Дата народження"><input type="date" value={patientEdit.dob} onChange={(e) => setPatientEdit({ ...patientEdit, dob: e.target.value })} required /></Field>
            <Field label="Категорія">
              <select value={patientEdit.category} onChange={(e) => setPatientEdit({ ...patientEdit, category: e.target.value })}>
                {(editMeta.categories || []).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Психолог">
              <select value={patientEdit.psychologist_id} onChange={(e) => setPatientEdit({ ...patientEdit, psychologist_id: e.target.value })} required>
                {(editMeta.psychologists || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="Сім’я">
              <select value={patientEdit.family_id} onChange={(e) => setPatientEdit({ ...patientEdit, family_id: e.target.value })}>
                <option value="">Без сімейного зв’язку</option>
                {editFamilies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="Роль у сім’ї"><input value={patientEdit.family_role} onChange={(e) => setPatientEdit({ ...patientEdit, family_role: e.target.value })} /></Field>
            <Field label="Стать">
              <select value={patientEdit.sex} onChange={(e) => setPatientEdit({ ...patientEdit, sex: e.target.value })}>
                <option value="">Не вказано</option><option value="female">Жіноча</option><option value="male">Чоловіча</option><option value="other">Інше</option>
              </select>
            </Field>
            <Field label="Статус" hint="Статус змінюється через «Завершити курс» або «Новий курс».">
              <input value={patientEdit.status} disabled />
            </Field>
            <Field label="Адреса" full><input value={patientEdit.address} onChange={(e) => setPatientEdit({ ...patientEdit, address: e.target.value })} /></Field>
            <Field label="Звідки звернувся / направлений">
              <select value={patientEdit.referral_source} onChange={(e) => setPatientEdit({ ...patientEdit, referral_source: e.target.value })}>
                <option value="">Не вказано</option>
                {referralSourceOptions.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Деталі направлення">
              <input value={patientEdit.referral_source_details} onChange={(e) => setPatientEdit({ ...patientEdit, referral_source_details: e.target.value })} />
            </Field>
            {isAdmin && <Field label="Службова примітка" full><textarea rows="4" value={patientEdit.admin_note} onChange={(e) => setPatientEdit({ ...patientEdit, admin_note: e.target.value })} /></Field>}
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Зберегти зміни</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'print-discharge' && printDoc && (
        <Dialog title="Виписка пацієнта" subtitle="Попередній перегляд документа" onClose={() => { setDialog(''); setPrintDoc(null); }} wide>
          <article className="discharge-print">
            <header className="discharge-header">
              <img className="discharge-logo" src={printDoc.center.logo_data || '/solvia-icon.png'} alt="Емблема" />
              <div className="discharge-center-copy">
                <strong>{printDoc.center.center_name || 'SOLVIA'}</strong>
                {printDoc.center.address && <p>{printDoc.center.address}</p>}
                <p>{[printDoc.center.phone, printDoc.center.email, printDoc.center.website].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="discharge-doc-number">Виписка № {printDoc.item.document_no || printDoc.item.patient_no_snapshot || card.patient_no || '00000'}</div>
            </header>
            <div className="discharge-title">
              <div className="eyebrow">ПСИХОЛОГІЧНИЙ СУПРОВІД</div>
              <h1>ВИПИСКА</h1>
              <p>Дата формування: {printDoc.item.created?.slice(0, 10) || localDate()}</p>
            </div>
            <dl className="profile-list discharge-profile">
              <div><dt>Номер пацієнта</dt><dd>№{printDoc.item.patient_no_snapshot || card.patient_no || '00000'}</dd></div>
              <div><dt>Пацієнт</dt><dd>{printDoc.item.patient_name || card.name}</dd></div>
              <div><dt>Дата народження</dt><dd>{printDoc.item.patient_dob || card.dob}</dd></div>
              <div><dt>Категорія</dt><dd>{printDoc.item.patient_category || card.category}</dd></div>
              <div><dt>Період супроводу</dt><dd>{printDoc.item.date_from} — {printDoc.item.date_to}</dd></div>
              <div><dt>Кількість консультацій</dt><dd>{printDoc.item.consultation_count}</dd></div>
            </dl>
            <section><h3>Підсумок психологічного супроводу</h3><p>{printDoc.item.summary}</p></section>
            <section><h3>Динаміка</h3><p>{printDoc.item.dynamics || '—'}</p></section>
            <section><h3>Рекомендації</h3><p>{printDoc.item.recommendations || '—'}</p></section>
            <section><h3>Подальший супровід</h3><p>{printDoc.item.followup || '—'}</p></section>

            <div className="signature-grid">
              <div className="signature-block">
                <strong>{printDoc.center.discharge_signatory || 'Психолог'}</strong>
                <span>{printDoc.item.psychologist_name || printDoc.item.psychologist || card.psychologist || '________________________'}</span>
                <div className="signature-line">підпис / дата</div>
              </div>
              <div className="signature-block">
                <strong>{printDoc.center.head_title || 'Завідувач центру'}</strong>
                <span>{printDoc.center.head_name || printDoc.center.director_name || '________________________'}</span>
                <div className="signature-line">підпис / дата</div>
              </div>
            </div>

            <footer className="discharge-footer">
              <span>{printDoc.center.center_name || 'SOLVIA'}</span>
              <span>{printDoc.center.document_footer || ''}</span>
            </footer>
          </article>
          <div className="form-actions no-print">
            <Button type="button" variant="ghost" onClick={() => { setDialog(''); setPrintDoc(null); }}>Закрити</Button>
            <Button type="button" onClick={printDischargeDocument}>Друк / Зберегти PDF</Button>
          </div>
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

function Team({ api, currentUser }) {
  const [users, setUsers] = useState([]);
  const [dialog, setDialog] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const emptyForm = { name: '', login: '', phone: '', password: '', role: 'psychologist', active: true };
  const [form, setForm] = useState(emptyForm);

  async function load() {
    try { setUsers(await api('GET', '/api/users')); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm(emptyForm);
    setEditing(null);
    setDialog('create');
  }

  function openEdit(user) {
    setEditing(user);
    setForm({
      name: user.name || '',
      login: user.login || '',
      phone: user.phone || '',
      password: '',
      role: user.role,
      active: Boolean(user.active)
    });
    setDialog('edit');
  }

  async function saveUser(e) {
    e.preventDefault();
    try {
      if (dialog === 'create') {
        await api('POST', '/api/users', {
          name: form.name,
          login: form.login,
          phone: form.phone,
          password: form.password,
          role: form.role
        });
      } else {
        const payload = { name: form.name, phone: form.phone, role: form.role, active: form.active };
        if (form.password) payload.password = form.password;
        await api('PATCH', `/api/users/${editing.id}`, payload);
      }
      setDialog('');
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
  }

  async function terminateSessions(user) {
    if (!Number(user.active_sessions || 0)) return;
    if (!window.confirm(`Завершити всі активні сесії «${user.name}»? На його пристроях буде потрібен повторний вхід.`)) return;
    try {
      await api('DELETE', `/api/users/${user.id}/sessions`, {});
      await load();
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <PageHead
        eyebrow="АДМІНІСТРУВАННЯ"
        title="Команда центру"
        subtitle="Працівники центру, їхні ролі та доступ до програми."
        actions={<Button onClick={openCreate}>+ Додати працівника</Button>}
      />
      {error && <div className="alert error">{error}</div>}
      <section className="surface">
        <div className="team-grid">
          {users.map((u) => (
            <article className="team-card" key={u.id}>
              <button className="team-card-main" onClick={() => openEdit(u)}>
                <div className="avatar">{u.name.slice(0, 1).toUpperCase()}</div>
                <div className="team-card-copy">
                  <strong>{u.name}</strong>
                  <span>@{u.login}</span>
                  <small>{u.phone || 'Телефон не вказано'}</small>
                </div>
              </button>
              <div className="team-state">
                <Badge tone={u.active ? 'forest' : 'stone'}>{roleLabels[u.role] || u.role}</Badge>
                <small>{Number(u.active_sessions || 0) ? `${u.active_sessions} активн. сес. · ${u.platforms || 'Unknown'}` : 'Немає активної сесії'}</small>
                {Number(u.active_sessions || 0) > 0 && Number(u.id) !== Number(currentUser?.id) && (
                  <Button variant="danger" onClick={() => terminateSessions(u)}>Завершити сесію</Button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {dialog && (
        <Dialog title={dialog === 'create' ? 'Новий працівник' : 'Керування працівником'} subtitle={dialog === 'edit' ? `@${editing?.login}` : 'Створення облікового запису'} onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={saveUser}>
            <Field label="ПІБ" full>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Телефон" full>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+380…" />
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
              <IconButton onClick={() => openEdit(r)} title="Редагувати"><AppIcon name="edit" /></IconButton>
              <IconButton onClick={() => removeRoom(r)} title="Видалити"><AppIcon name="delete" /></IconButton>
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

function Devices({ api }) {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try { setSessions(await api('GET', '/api/admin/sessions')); setError(''); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  async function terminate(session) {
    if (!window.confirm(`Завершити сесію «${session.name}» на пристрої «${session.device_name || session.platform}»?`)) return;
    try {
      await api('DELETE', `/api/admin/sessions/${session.session_id}`, {});
      await load();
    } catch (e) { setError(e.message); }
  }

  const online = sessions.filter((x) => x.online).length;
  return (
    <>
      <PageHead
        eyebrow="БЕЗПЕКА ТА ПРИСТРОЇ"
        title="Активні пристрої"
        subtitle="Телефони, планшети та ПК, на яких зараз є активний вхід у SOLVIA."
        actions={<Button variant="secondary" onClick={load}>Оновити</Button>}
      />
      {error && <div className="alert error">{error}</div>}
      <div className="stat-grid">
        <article className="stat-card"><strong>{sessions.length}</strong><h3>Активних сесій</h3><p>До завершення входу або 8 годин</p></article>
        <article className="stat-card"><strong>{online}</strong><h3>Онлайн зараз</h3><p>Активність протягом останніх 2 хвилин</p></article>
        <article className="stat-card"><strong>{sessions.filter((x) => x.platform === 'Android').length}</strong><h3>Телефони / планшети</h3><p>Android-клієнти</p></article>
        <article className="stat-card"><strong>{sessions.filter((x) => x.platform === 'Windows').length}</strong><h3>ПК</h3><p>Windows-клієнти</p></article>
      </div>
      <section className="surface">
        <div className="device-list">
          {sessions.map((s) => (
            <article className="device-card" key={s.session_id}>
              <div className={`device-status ${s.online ? 'online' : ''}`} />
              <div className="device-main">
                <strong>{s.device_name || s.platform || 'Невідомий пристрій'}</strong>
                <span>{s.name} · {roleLabels[s.role] || s.role}</span>
                <small>{s.platform} · IP {s.ip_address || '—'} · остання активність {s.last_seen?.replace('T',' ') || '—'}</small>
              </div>
              <Badge tone={s.online ? 'forest' : 'stone'}>{s.online ? 'Онлайн' : 'Неактивний'}</Badge>
              <Button variant="danger" onClick={() => terminate(s)}>Завершити сесію</Button>
            </article>
          ))}
        </div>
        {!sessions.length && <Empty title="Активних пристроїв немає" text="Після входу працівника його ПК, телефон або планшет з’явиться тут." />}
      </section>
    </>
  );
}

function ReminderBar({ api, role }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!['admin','psychologist'].includes(role)) return undefined;
    let alive = true;
    async function load() {
      try {
        const value = await api('GET', '/api/reminders');
        if (alive) setItems(value);
      } catch {}
    }
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [role]);

  if (!items.length) return null;
  return (
    <div className="reminder-strip">
      <strong>Найближчі записи:</strong>
      {items.slice(0,3).map((x) => (
        <span key={x.id}>{x.start?.slice(11,16)} · {x.patients} · {x.psychologist}</span>
      ))}
      {items.length > 3 && <small>+{items.length - 3}</small>}
    </div>
  );
}

function ServerMaintenance({ api, apiBase }) {
  const [platform, setPlatform] = useState('');
  const [serverVersion, setServerVersion] = useState('');
  const [system, setSystem] = useState(null);
  const [systemError, setSystemError] = useState('');

  async function loadSystem() {
    try {
      const health = await api('GET', '/api/health');
      setPlatform(health.platform || 'unknown');
      setServerVersion(health.version || '');
      if (health.platform === 'linux') {
        setSystem(await api('GET', '/api/admin/system'));
      }
      setSystemError('');
    } catch (e) {
      setPlatform('offline');
      setSystemError(e.message);
    }
  }

  useEffect(() => { loadSystem(); }, [apiBase]);

  let localWindows = false;
  try { localWindows = platform === 'windows' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(apiBase).hostname) && !!window.chrome?.webview; } catch {}

  if (!localWindows) return <div className="maintenance-grid">
    <article>
      <strong>Сервер {platform === 'linux' ? 'Linux' : 'центру'}</strong>
      <p>{system?.lan_url || apiBase}</p>
      <p>{platform === 'linux' ? 'systemd + PostgreSQL + HTTPS. Критичні root-операції виконуються локально на сервері.' : 'Обслуговування виконує адміністратор на сервері.'}</p>
      <Button variant="secondary" onClick={loadSystem}>Оновити діагностику</Button>
      {systemError && <p className="danger-text">{systemError}</p>}
    </article>

    {platform === 'linux' && <>
      <article>
        <strong>PostgreSQL</strong>
        <p>{system?.database?.name || 'solvia'} · {system?.database?.size || '—'}</p>
        <p>PostgreSQL {system?.database?.version || '—'}</p>
        <small>
          {system ? `${system.counts?.patients ?? 0} пацієнтів · ${system.counts?.consultations ?? 0} консультацій · ${system.counts?.discharges ?? 0} виписок` : 'Завантаження статистики…'}
        </small>
      </article>
      <article>
        <strong>Оновлення SOLVIA</strong>
        <p>Встановлена версія: <b>{serverVersion || '—'}</b></p>
        <p><code>sudo solvia-admin check-update</code></p>
        <p><code>sudo solvia-admin update</code></p>
        <small>Або скористайтесь дією «Оновити SOLVIA» у меню програми Linux.</small>
      </article>
      <article>
        <strong>Резервні копії</strong>
        <p>Автоматично щодня о 02:00. Для ручної перевіреної копії:</p>
        <code>sudo solvia-admin backup</code>
        <p><code>sudo solvia-admin backups</code></p>
        <p><code>sudo solvia-admin verify-backup /path/backup.dump</code></p>
        <small>Кожна нова копія проходить справжнє відновлення в окрему тимчасову БД. Робочі дані не замінюються.</small>
        <small>{system?.backups?.[0] ? `Остання подія: ${system.backups[0].status} · ${String(system.backups[0].created || '').replace('T',' ')}` : 'Історії backup ще немає.'}</small>
        <div className="backup-history">{system?.backups?.slice(0, 6).map(event => <div key={event.id}><span className={`badge ${event.status === 'success' ? 'forest' : 'rose'}`}>{event.status === 'success' ? 'Успішно' : 'Помилка'}</span><strong>{event.action === 'verify' ? 'Перевірка відновлення' : event.action === 'backup' ? 'Резервна копія' : 'Відновлення'}</strong><small>{event.created?.replace('T',' ')} · {event.details}</small></div>)}</div>
      </article>
      <article>
        <strong>Діагностика / відновлення</strong>
        <p><code>sudo solvia-admin doctor</code></p>
        <p><code>sudo solvia-admin restore /path/backup.dump</code></p>
        <small>Restore навмисно вимагає sudo та ручне підтвердження на Linux-сервері.</small>
      </article>
    </>}
  </div>;

  return <div className="backup-actions">
    <Button onClick={() => window.chrome.webview.postMessage('backup')}>Створити backup</Button>
    <Button variant="secondary" onClick={() => window.chrome.webview.postMessage('restore')}>Відновити БД</Button>
    <Button variant="secondary" onClick={() => window.chrome.webview.postMessage('restart-server')}>Перезапустити сервер</Button>
  </div>;
}

function ServerConsole({ api, user, onLogout, apiBase, onSwitchApi }) {
  const [showSettings, setShowSettings] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [shift, setShift] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [center, setCenter] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [s, sh, r, ce] = await Promise.all([
        api('GET','/api/admin/sessions'),
        api('GET','/api/shift-day'),
        api('GET','/api/reminders'),
        api('GET','/api/settings/center')
      ]);
      setSessions(s); setShift(sh); setReminders(r); setCenter(ce); setError('');
    } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    load();
    const timer=setInterval(load,30000);
    return ()=>clearInterval(timer);
  }, []);

  async function terminate(session) {
    if (!window.confirm(`Завершити сесію ${session.name} на ${session.device_name || session.platform}?`)) return;
    try { await api('DELETE', `/api/admin/sessions/${session.session_id}`, {}); await load(); }
    catch(e){ setError(e.message); }
  }

  if (user.role !== 'admin') {
    return <div className="server-console"><div className="alert error">Server Console доступна тільки адміністратору.</div><Button onClick={onLogout}>Вийти</Button></div>;
  }

  return (
    <div className="server-console">
      <header className="server-console-head">
        <div className="product"><div className="product-mark"><img className="product-logo" src="/solvia-icon.png" alt="SOLVIA" /></div><div><strong>SOLVIA Server Console</strong><span>{center?.center_name || 'QureMed'}</span></div></div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Закрити налаштування' : 'Налаштування системи'}</Button>
          <Button variant="secondary" onClick={load}>Оновити</Button>
          <Button variant="ghost" onClick={onLogout}>Вийти</Button>
        </div>
      </header>
      {error && <div className="alert error">{error}</div>}
      {showSettings && <Settings api={api} apiBase={apiBase} onSwitchApi={onSwitchApi} />}
      <div className="server-status-grid">
        <article className="stat-card"><strong>ONLINE</strong><h3>Local API</h3><p>{apiBase} · SOLVIA 2.2</p></article>
        <article className="stat-card"><strong>{shift?.open ? 'OPEN' : 'CLOSED'}</strong><h3>Робоча зміна</h3><p>{shift?.shift_date || localDate()}</p></article>
        <article className="stat-card"><strong>{sessions.filter(x=>x.online).length}</strong><h3>Онлайн пристроїв</h3><p>{sessions.length} активних сесій</p></article>
        <article className="stat-card"><strong>{reminders.length}</strong><h3>Найближчих записів</h3><p>Нагадування психологам і адміну</p></article>
      </div>
      <section className="surface">
        <div className="section-head"><div><div className="eyebrow">ОБСЛУГОВУВАННЯ</div><h2>Сервер центру</h2></div><Badge tone="forest">Local</Badge></div>
        <ServerMaintenance api={api} apiBase={apiBase} />
      </section>
      <WorkflowSettings api={api} />
      <AccountSettings api={api} apiBase={apiBase} onLogout={onLogout} user={user} />
      <section className="surface">
        <div className="section-head"><div><div className="eyebrow">ПІДКЛЮЧЕННЯ</div><h2>Телефони, планшети та ПК</h2></div><Badge tone="stone">{sessions.length}</Badge></div>
        <div className="device-list">
          {sessions.map((s) => <article className="device-card" key={s.session_id}>
            <div className={`device-status ${s.online ? 'online':''}`} />
            <div className="device-main"><strong>{s.device_name || s.platform}</strong><span>{s.name} · {roleLabels[s.role]}</span><small>{s.ip_address || '—'} · {s.last_seen?.replace('T',' ')}</small></div>
            <Badge tone={s.online?'forest':'stone'}>{s.online?'Онлайн':'Очікує'}</Badge>
            <Button variant="danger" onClick={() => terminate(s)}>Завершити</Button>
          </article>)}
        </div>
      </section>
    </div>
  );
}

function WorkflowSettings({ api }) {
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('GET', '/api/settings/workflow').then(setForm).catch(e => setMessage(e.message)); }, []);
  async function save(e) {
    e.preventDefault(); setBusy(true); setMessage('');
    try { setForm(await api('PATCH', '/api/settings/workflow', form)); setMessage('Правила роботи збережено. Вони застосовуються до нового запису на всіх пристроях.'); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  }
  return <section className="surface settings-panel">
    <h2>Розклад і безпека</h2>
    {message && <div className="alert info" role="status">{message}</div>}
    {!form ? <Spinner /> : <form className="form-grid" onSubmit={save}>
      <Field label="Початок роботи"><input type="time" value={form.opening_time} onChange={e => setForm({...form, opening_time:e.target.value})} required /></Field>
      <Field label="Завершення роботи"><input type="time" value={form.closing_time} onChange={e => setForm({...form, closing_time:e.target.value})} required /></Field>
      <div className="field full"><span>Робочі дні</span><div className="weekday-options">{['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map((label,i) => <label key={label}><input type="checkbox" checked={form.working_days.includes(String(i+1))} onChange={e => setForm({...form,working_days:e.target.checked ? [...form.working_days,String(i+1)].sort().join('') : form.working_days.replace(String(i+1),'')})} /> {label}</label>)}</div></div>
      <Field label="Крок вільних слотів"><select value={form.slot_step_minutes} onChange={e => setForm({...form,slot_step_minutes:Number(e.target.value)})}>{[15,30,60].map(n => <option key={n} value={n}>{n} хв</option>)}</select></Field>
      <Field label="Стандартна тривалість, хв"><input type="number" min="15" max="240" value={form.default_duration_minutes} onChange={e => setForm({...form,default_duration_minutes:Number(e.target.value)})} required /></Field>
      <Field label="Тривалість сесії входу, год" hint="Скорочення ліміту також скорочує чинні сесії."><input type="number" min="1" max="24" value={form.session_hours} onChange={e => setForm({...form,session_hours:Number(e.target.value)})} required /></Field>
      <div className="form-actions full-span"><Button disabled={busy}>{busy ? 'Зберігаємо…' : 'Зберегти правила'}</Button></div>
    </form>}
  </section>;
}

function openProductUpdates() {
  if (window.chrome?.webview) window.chrome.webview.postMessage('product-updates');
  else window.open('https://github.com/docvincent123/Serenia/releases', '_blank', 'noopener,noreferrer');
}

function AccountSettings({ api, apiBase, onLogout, user }) {
  const [prefs, setPrefs] = useState(() => readPreferences(apiBase, user));
  const [password, setPassword] = useState({ current_password: '', new_password: '', confirm: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let alive = true;
    api('GET', '/api/health').then(value => { if (alive) setHealth(value); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  function change(key, value) {
    const next = { ...prefs, [key]: value };
    try { localStorage.setItem(preferencesKey(apiBase, user), JSON.stringify(next)); }
    catch { setMessage('Не вдалося зберегти вигляд програми на цьому пристрої.'); return; }
    setPrefs(next); applyPreferences(next);
  }
  async function changePassword(e) {
    e.preventDefault(); if (busy) return; setMessage('');
    if (password.new_password !== password.confirm) { setMessage('Нові паролі не збігаються. Перевірте їх і спробуйте ще раз.'); return; }
    setBusy(true);
    try { await api('POST', '/api/account/password', { current_password: password.current_password, new_password: password.new_password }); onLogout(); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  }
  return <>
    <PageHead eyebrow="ОСОБИСТИЙ КАБІНЕТ" title="Профіль і налаштування" subtitle="Ваш обліковий запис, пароль і зручний вигляд програми." />
    <section className="account-identity surface">
      <div className="avatar">{user.name?.slice(0, 1).toUpperCase()}</div>
      <div><small>ВИ УВІЙШЛИ ЯК</small><h2>{user.name}</h2><span>{roleLabels[user.role]}</span></div>
      <Badge tone="forest">Особистий обліковий запис</Badge>
    </section>
    {message && <div className="alert error" role="alert">{message}</div>}
    <div className="account-layout">
      <div className="account-stack">
        <section className="surface account-panel"><div className="account-panel-heading"><AppIcon name="preferences" /><h2>Вигляд програми</h2></div><p>Оберіть, як вам зручніше працювати. Зміни зберігаються автоматично для вашого акаунта на цьому пристрої.</p>
          <label className="preference-option"><span><strong>Компактні списки</strong><small>Більше записів на екрані.</small></span><input role="switch" type="checkbox" checked={!!prefs.compact} onChange={e => change('compact', e.target.checked)} /></label>
          <label className="preference-option"><span><strong>Менше анімацій</strong><small>Спокійні переходи між екранами.</small></span><input role="switch" type="checkbox" checked={!!prefs.reducedMotion} onChange={e => change('reducedMotion', e.target.checked)} /></label>
        </section>
        <section className="surface account-panel"><div className="account-panel-heading"><AppIcon name="documents" /><h2>Про SOLVIA</h2></div><p>Програма для щоденної роботи вашого центру.</p><div className="account-version"><strong>SOLVIA</strong><span>{health?.version ? `Версія ${health.version}` : 'QureMed Industries'}</span></div><p className="account-support-copy">Потрібна допомога з доступом або оновленням? Зверніться до адміністратора центру.</p><a className="account-support-link" href="mailto:quremedindastriessupport@gmail.com">Написати в підтримку QureMed <span aria-hidden="true">↗</span></a></section>
      </div>
      <section className="surface account-panel password-panel"><div className="account-panel-heading"><AppIcon name="lock" /><h2>Безпека облікового запису</h2></div><p>Після зміни пароля потрібно повторно увійти на всіх пристроях.</p><form onSubmit={changePassword} className="account-password-form">
        <Field label="Поточний пароль"><input type="password" autoComplete="current-password" value={password.current_password} onChange={e => setPassword({ ...password, current_password: e.target.value })} required /></Field>
        <Field label="Новий пароль" hint="Щонайменше 12 символів."><input type="password" minLength="12" autoComplete="new-password" value={password.new_password} onChange={e => setPassword({ ...password, new_password: e.target.value })} required /></Field>
        <Field label="Повторіть новий пароль"><input type="password" minLength="12" autoComplete="new-password" value={password.confirm} onChange={e => setPassword({ ...password, confirm: e.target.value })} required /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Змінюємо пароль…' : 'Змінити пароль'}</Button>
      </form></section>
    </div>
  </>;
}

function Settings({ api, apiBase, onSwitchApi }) {
  const empty = {
    center_name: '', short_name: '', address: '', phone: '', email: '', website: '', city: '',
    director_name: '', admin_name: '', work_hours: '', document_footer: '', discharge_signatory: '',
    head_name: '', head_title: 'Завідувач центру', logo_data: '', appointment_reminder_minutes: 30,
    connection_mode: 'local', local_api_url: '', vps_api_url: '', vps_name: ''
  };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [connectionTest, setConnectionTest] = useState({ state: 'idle', message: '' });
  const [activeSection, setActiveSection] = useState('center');

  async function load() {
    try { setForm({ ...empty, ...(await api('GET', '/api/settings/center')) }); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function chooseLogo(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Емблема має бути PNG або JPEG.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setError('Емблема має бути не більше 1 МБ.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, logo_data: String(reader.result || '') }));
    reader.readAsDataURL(file);
  }

  async function save(e) {
    e.preventDefault();
    try {
      await api('PATCH', '/api/settings/center', form);
      setSaved('Налаштування центру збережено.');
      setTimeout(() => setSaved(''), 2500);
    } catch (e) { setError(e.message); }
  }

  function downloadMobileConfig() {
    try {
      const preferred = form.connection_mode === 'vps' ? 'vps' : 'local';
      const apiUrl = preferred === 'vps'
        ? cleanBase(form.vps_api_url)
        : cleanBase(form.local_api_url || apiBase);
      if (!apiUrl.startsWith('https://')) throw new Error('Для телефону потрібне HTTPS-підключення.');
      if (/127\.0\.0\.1|localhost/i.test(apiUrl)) {
        throw new Error('Для телефона потрібна LAN-адреса серверного ПК, а не 127.0.0.1. Вкажіть Local API URL, наприклад https://192.168.1.100:8443.');
      }
      const config = {
        format: 'quremed.solvia.mobile',
        version: 1,
        center: form.center_name || 'SOLVIA',
        preferred,
        api_url: apiUrl,
        https_url: apiUrl.startsWith('https://') ? apiUrl : '',
        generated: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'SOLVIA-Mobile.solvia';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      setConnectionTest({ state: 'error', message: e.message });
    }
  }

  function selectedEndpoint() {
    if (form.connection_mode === 'vps') return cleanBase(form.vps_api_url);
    return cleanBase(form.local_api_url || apiBase);
  }

  async function testConnection() {
    setConnectionTest({ state: 'busy', message: 'Перевіряємо з’єднання…' });
    try {
      const endpoint = selectedEndpoint();
      const result = await request(endpoint, '', 'GET', '/api/health');
      if (!result.ok) throw new Error('API відповів без статусу OK');
      setConnectionTest({ state: 'ok', message: `SOLVIA ${result.version || '2.0'} доступна · ${endpoint}` });
    } catch (e) {
      setConnectionTest({ state: 'error', message: e.message });
    }
  }

  function applyConnection() {
    try {
      const endpoint = selectedEndpoint();
      if (!window.confirm(`Підключити цей ПК до ${endpoint}? Поточний сеанс буде завершено.`)) return;
      onSwitchApi(endpoint);
    } catch (e) {
      setConnectionTest({ state: 'error', message: e.message });
    }
  }

  return (
    <>
      <PageHead
        eyebrow="СИСТЕМА"
        title="Налаштування SOLVIA"
        subtitle="Центр, документи, підключення до локального сервера або VPS і технічне обслуговування."
      />
      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert info">{saved}</div>}

      <div className="settings-shell">
        <aside className="settings-nav">
          {[
            ['center','Центр','Реквізити та бренд'],
            ['documents','Документи','Виписки та підписи'],
            ['connection','Підключення','Local / VPS'],
            ['workflow','Правила роботи','Розклад і безпека'],
            ['maintenance','Backup','Резервні копії']
          ].map(([key,title,text]) => (
            <button key={key} className={activeSection === key ? 'active' : ''} onClick={() => setActiveSection(key)}>
              <span><AppIcon name={key === "center" ? "rooms" : key === "documents" ? "reports" : key === "connection" ? "devices" : "preferences"} /></span>
              <div><strong>{title}</strong><small>{text}</small></div>
            </button>
          ))}
        </aside>

        <div className="settings-content">
          {(activeSection === 'center' || activeSection === 'documents') && (
            <section className="surface settings-panel">
              <div className="section-head">
                <div>
                  <div className="eyebrow">{activeSection === 'center' ? 'ПРОФІЛЬ ЦЕНТРУ' : 'ДОКУМЕНТИ'}</div>
                  <h2>{activeSection === 'center' ? 'Реквізити та оформлення' : 'Виписки та підписи'}</h2>
                </div>
                <Badge tone="forest">SOLVIA 2.2</Badge>
              </div>

              <form className="form-grid" onSubmit={save}>
                {activeSection === 'center' ? <>
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
                  <Field label="Нагадування про запис, хв"><input type="number" min="5" max="240" value={form.appointment_reminder_minutes} onChange={(e) => setForm({ ...form, appointment_reminder_minutes: Number(e.target.value) })} /></Field>
                  <div className="field full">
                    <span>Емблема центру</span>
                    <div className="logo-settings">
                      <img src={form.logo_data || '/solvia-icon.png'} alt="Емблема центру" />
                      <div>
                        <input type="file" accept="image/png,image/jpeg" onChange={(e) => chooseLogo(e.target.files?.[0])} />
                        <small>PNG/JPEG до 1 МБ. Використовується у виписках і документах.</small>
                        {form.logo_data && <Button type="button" variant="ghost" onClick={() => setForm({ ...form, logo_data: '' })}>Повернути емблему SOLVIA</Button>}
                      </div>
                    </div>
                  </div>
                </> : <>
                  <Field label="ПІБ завідувача"><input value={form.head_name} onChange={(e) => setForm({ ...form, head_name: e.target.value })} placeholder="ПІБ для підпису" /></Field>
                  <Field label="Посада завідувача"><input value={form.head_title} onChange={(e) => setForm({ ...form, head_title: e.target.value })} placeholder="Завідувач центру" /></Field>
                  <Field label="Посада психолога у виписці"><input value={form.discharge_signatory} onChange={(e) => setForm({ ...form, discharge_signatory: e.target.value })} placeholder="Психолог" /></Field>
                  <Field label="Футер документів" full><textarea rows="5" value={form.document_footer} onChange={(e) => setForm({ ...form, document_footer: e.target.value })} placeholder="Ліцензія, юридична інформація, контакти або примітка для друкованих документів." /></Field>
                  <div className="document-preview full-span">
                    <div className="document-preview-mark"><img src={form.logo_data || '/solvia-icon.png'} alt="" /></div>
                    <div><small>ПОПЕРЕДНІЙ ВИГЛЯД</small><strong>{form.center_name || 'SOLVIA Center'}</strong><span>{form.head_title || 'Завідувач центру'} · {form.head_name || 'ПІБ'}</span></div>
                  </div>
                </>}
                <div className="form-actions full-span"><Button type="submit">Зберегти зміни</Button></div>
              </form>
            </section>
          )}

          {activeSection === 'connection' && (
            <section className="surface settings-panel">
              <div className="section-head">
                <div><div className="eyebrow">МЕРЕЖА</div><h2>Local / VPS підключення</h2></div>
                <Badge tone={form.connection_mode === 'vps' ? 'sky' : 'forest'}>{form.connection_mode === 'vps' ? 'VPS' : 'LOCAL'}</Badge>
              </div>

              <div className="connection-mode-grid">
                <button className={form.connection_mode === 'local' ? 'active' : ''} onClick={() => setForm({ ...form, connection_mode: 'local' })}>
                  <span className="mode-icon"><AppIcon name="devices" /></span><div><strong>Локальний сервер</strong><small>Сервер у мережі центру або на цьому ПК</small></div>
                </button>
                <button className={form.connection_mode === 'vps' ? 'active' : ''} onClick={() => setForm({ ...form, connection_mode: 'vps' })}>
                  <span className="mode-icon"><AppIcon name="devices" /></span><div><strong>VPS сервер</strong><small>Захищене HTTPS-підключення через інтернет</small></div>
                </button>
              </div>

              <form className="form-grid" onSubmit={save}>
                <Field label="Local API URL" full hint="Наприклад: https://192.168.1.100:8443">
                  <input value={form.local_api_url} onChange={(e) => setForm({ ...form, local_api_url: e.target.value })} placeholder={apiBase || 'https://192.168.1.100:8443'} />
                </Field>
                <Field label="Назва VPS"><input value={form.vps_name} onChange={(e) => setForm({ ...form, vps_name: e.target.value })} placeholder="Напр. QureMed Cloud 1" /></Field>
                <Field label="VPS API URL" hint="Тільки HTTPS">
                  <input value={form.vps_api_url} onChange={(e) => setForm({ ...form, vps_api_url: e.target.value })} placeholder="https://solvia.example.com" />
                </Field>

                <div className="connection-current full-span">
                  <div><span className="connection-led online" /><div><small>ЦЕЙ ПК ЗАРАЗ ПІДКЛЮЧЕНИЙ ДО</small><strong>{apiBase}</strong></div></div>
                  <Badge tone={apiBase?.startsWith('https://') ? 'forest' : 'sand'}>{apiBase?.startsWith('https://') ? 'HTTPS' : 'HTTP'}</Badge>
                </div>

                {connectionTest.state !== 'idle' && (
                  <div className={`connection-test full-span ${connectionTest.state}`}>
                    <span className="connection-led" />
                    <strong>{connectionTest.message}</strong>
                  </div>
                )}

                <div className="form-actions full-span split-actions">
                  <Button type="button" variant="secondary" onClick={testConnection} disabled={connectionTest.state === 'busy'}>Перевірити з’єднання</Button>
                  <div>
                    <Button type="button" variant="secondary" onClick={downloadMobileConfig}>Файл для телефону</Button>
                    <Button type="submit" variant="secondary">Зберегти профіль</Button>
                    <Button type="button" onClick={applyConnection}>Підключити цей ПК</Button>
                  </div>
                </div>
              </form>

              <div className="security-callout">
                <strong>VPS працює тільки через HTTPS</strong>
                <p>SOLVIA не зберігає пароль від VPS. У налаштуваннях зберігається лише адреса API. Авторизація користувачів залишається через персональні облікові записи SOLVIA.</p>
              </div>
            </section>
          )}

          {activeSection === 'workflow' && <WorkflowSettings api={api} />}
          {activeSection === 'maintenance' && (
            <section className="surface settings-panel">
              <div className="section-head"><div><div className="eyebrow">ОБСЛУГОВУВАННЯ</div><h2>Backup / Restore</h2></div><Badge tone="sand">Admin only</Badge></div>
              <ServerMaintenance api={api} apiBase={apiBase} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function GlobalSearch({ api, onPatient, onNavigate, role }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const allowed = new Set(flatNavigation(role).map(([key]) => key));
  useEffect(() => {
    let alive = true;
    setResult(null); setBusy(false);
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const found = await api('GET', `/api/search?q=${encodeURIComponent(query.trim())}`);
        if (alive) setResult({ ...found,
          families: allowed.has('families') ? found.families : [],
          rooms: allowed.has('rooms') ? found.rooms : [],
          users: allowed.has('team') ? found.users : [] });
      } catch { if (alive) setResult(null); }
      finally { if (alive) setBusy(false); }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, role]);
  useEffect(() => {
    const keydown = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault(); inputRef.current?.focus();
      }
      if (e.key === 'Escape') { setQuery(''); setResult(null); }
    };
    const outside = e => { if (!wrapRef.current?.contains(e.target)) { setQuery(''); setResult(null); } };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', outside); };
  }, []);

  const total = result ? Object.values(result).reduce((n, arr) => n + (arr?.length || 0), 0) : 0;
  return (
    <div className="global-search-wrap" ref={wrapRef}>
      <div className="global-search">
        <span><AppIcon name="search" /></span>
        <input ref={inputRef} aria-label="Пошук у центрі" maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={role === 'psychologist' ? 'Пошук моїх пацієнтів…' : 'Пошук пацієнта, номеру, телефону…'} /><kbd>Ctrl K</kbd>
        {busy && <small>Пошук…</small>}
      </div>
      {result && (
        <div className="search-popover">
          <div className="search-popover-head"><strong>Результати</strong><span>{total}</span></div>
          {result.patients?.map((p) => <button key={`p-${p.id}`} onClick={() => { onPatient(p.id); setQuery(''); setResult(null); }}><span>Пацієнт</span><strong>{p.name}</strong><small>№{p.patient_no || '—'} · {p.phone} · {p.category}</small></button>)}
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
  const [form, setForm] = useState({ summary: '', incidents: '', handover: '', critical_cases: false, notify_admin: false, notify_director: false });
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
        if (todayReport) setForm({
          summary: todayReport.summary || '',
          incidents: todayReport.incidents || '',
          handover: todayReport.handover || '',
          critical_cases: Boolean(todayReport.critical_cases),
          notify_admin: Boolean(todayReport.notify_admin),
          notify_director: Boolean(todayReport.notify_director)
        });
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
        handover: form.handover,
        critical_cases: form.critical_cases,
        notify_admin: form.notify_admin,
        notify_director: form.notify_director
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
            <div className="field full">
              <span>Контроль зміни</span>
              <div className="check-grid">
                <label className="check-chip"><input type="checkbox" checked={form.critical_cases} onChange={(e) => setForm({ ...form, critical_cases: e.target.checked })} /><span>Були критичні випадки</span></label>
                <label className="check-chip"><input type="checkbox" checked={form.notify_admin} onChange={(e) => setForm({ ...form, notify_admin: e.target.checked })} /><span>Потрібен контроль адміністратора</span></label>
                <label className="check-chip"><input type="checkbox" checked={form.notify_director} onChange={(e) => setForm({ ...form, notify_director: e.target.checked })} /><span>Потрібно повідомити керівника</span></label>
              </div>
            </div>
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
                <div className="risk-strip">
                  {r.critical_cases && <Badge tone="rose">Критичні випадки</Badge>}
                  {r.notify_admin && <Badge tone="sand">Контроль адміністратора</Badge>}
                  {r.notify_director && <Badge tone="sky">Повідомити керівника</Badge>}
                </div>
                <div className="consultation-grid">
                  <div><span>Первинні</span><p>{r.primary_count || 0}</p></div>
                  <div><span>Повторні</span><p>{r.repeat_count || 0}</p></div>
                  <div><span>Кризові</span><p>{r.crisis_count || 0}</p></div>
                  <div><span>Групові</span><p>{r.group_count || 0}</p></div>
                  <div><span>Сімейні</span><p>{r.family_count || 0}</p></div>
                  <div><span>Скасовані</span><p>{r.cancelled_count || 0}</p></div>
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


function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = value;
  }, []);

  function position(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(e) {
    e.preventDefault();
    const canvas = canvasRef.current;
    canvas.setPointerCapture?.(e.pointerId);
    const ctx = canvas.getContext('2d');
    const p = position(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawing.current = true;
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = position(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end(e) {
    if (!drawing.current) return;
    drawing.current = false;
    e.preventDefault();
    onChange(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  }

  return (
    <div className="signature-pad-wrap">
      <canvas
        ref={canvasRef}
        width="900"
        height="240"
        className="signature-pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="signature-pad-foot">
        <small>Підпис пальцем або стилусом</small>
        <Button type="button" variant="ghost" onClick={clear}>Очистити</Button>
      </div>
    </div>
  );
}

function Workload({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try { setData(await api('GET', '/api/workload')); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHead
        eyebrow="КОМАНДА"
        title="Контроль завантаження психологів"
        subtitle="Активні пацієнти, консультації, відміни, середня тривалість і вільний час на сьогодні."
        actions={<Button variant="secondary" onClick={load}>Оновити</Button>}
      />
      {error && <div className="alert error">{error}</div>}
      {!data ? <Spinner /> : (
        <section className="surface">
          <div className="section-head">
            <div><div className="eyebrow">ПОТОЧНИЙ ТИЖДЕНЬ</div><h2>Навантаження команди</h2></div>
            <Badge tone="forest">{data.items?.length || 0} психологів</Badge>
          </div>
          {!data.items?.length ? <Empty title="Немає психологів" text="Додайте активних психологів у команду центру." /> : (
            <div className="workload-grid">
              {data.items.map((x) => (
                <article className="workload-card" key={x.id}>
                  <div className="workload-card-head">
                    <div className="avatar">{String(x.name || '?').slice(0,1).toUpperCase()}</div>
                    <div><strong>{x.name}</strong><small>Тиждень від {data.week_start}</small></div>
                  </div>
                  <div className="metric-grid">
                    <div><strong>{x.active_patients}</strong><span>активних пацієнтів</span></div>
                    <div><strong>{x.consultations_today}</strong><span>консультацій сьогодні</span></div>
                    <div><strong>{x.consultations_week}</strong><span>консультацій за тиждень</span></div>
                    <div><strong>{x.free_hours_today}</strong><span>вільних годин сьогодні</span></div>
                    <div><strong>{x.cancellations_week}</strong><span>відмін за тиждень</span></div>
                    <div><strong>{x.avg_duration_minutes}</strong><span>середня тривалість, хв</span></div>
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

function Supervisions({ api, role, user }) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ psychologists: [] });
  const [dialog, setDialog] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ psychologist_id: '', scheduled_at: localDate() + 'T10:00', duration_minutes: 60, topic: '' });
  const [edit, setEdit] = useState({ case_summary: '', recommendations: '', status: 'scheduled' });
  const leader = role === 'admin' || role === 'director';

  async function load() {
    setError('');
    try {
      const tasks = [api('GET', '/api/supervisions')];
      if (leader) tasks.push(api('GET', '/api/meta'));
      const [rows, m = { psychologists: [] }] = await Promise.all(tasks);
      setItems(rows); setMeta(m);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ psychologist_id: meta.psychologists?.[0]?.id || '', scheduled_at: localDate() + 'T10:00', duration_minutes: 60, topic: '' });
    setDialog('create');
  }

  async function create(e) {
    e.preventDefault();
    try {
      await api('POST', '/api/supervisions', {
        psychologist_id: Number(form.psychologist_id),
        supervisor_id: Number(user.id),
        scheduled_at: form.scheduled_at,
        duration_minutes: Number(form.duration_minutes),
        topic: form.topic
      });
      setDialog(''); await load();
    } catch (e) { setError(e.message); }
  }

  function openEdit(item) {
    setSelected(item);
    setEdit({ case_summary: item.case_summary || '', recommendations: item.recommendations || '', status: item.status || 'scheduled' });
    setDialog('edit');
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      const body = role === 'psychologist'
        ? { case_summary: edit.case_summary }
        : { case_summary: edit.case_summary, recommendations: edit.recommendations, status: edit.status };
      await api('PATCH', '/api/supervisions/' + selected.id, body);
      setDialog(''); setSelected(null); await load();
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <PageHead
        eyebrow="ПРОФЕСІЙНА ПІДТРИМКА"
        title={leader ? 'Супервізії психологів' : 'Мої супервізії'}
        subtitle={leader ? 'Планування супервізій і фіксація рекомендацій без персональних даних пацієнта.' : 'Додавайте лише деідентифікований опис випадку — без ПІБ, телефону, адреси чи номера картки.'}
        actions={leader && <Button onClick={openCreate}>+ Запланувати</Button>}
      />
      {error && <div className="alert error">{error}</div>}
      <section className="surface">
        {!items.length ? <Empty title="Супервізій ще немає" text="Заплановані зустрічі з’являться тут." /> : (
          <div className="consultation-list">
            {items.map((x) => (
              <article className="consultation-card" key={x.id}>
                <div className="section-head compact">
                  <div>
                    <div className="eyebrow">{x.scheduled_at?.replace('T',' ')} · {x.duration_minutes} хв</div>
                    <h3>{x.psychologist}</h3>
                  </div>
                  <Badge tone={x.status === 'completed' ? 'forest' : x.status === 'cancelled' ? 'rose' : 'sand'}>{x.status}</Badge>
                </div>
                <p><strong>Тема:</strong> {x.topic || '—'}</p>
                <p><strong>Супервізор:</strong> {x.supervisor}</p>
                {x.case_summary && <p><strong>Деідентифікований випадок:</strong> {x.case_summary}</p>}
                {x.recommendations && <p><strong>Рекомендації:</strong> {x.recommendations}</p>}
                <div className="form-actions"><Button variant="secondary" onClick={() => openEdit(x)}>{role === 'psychologist' ? 'Додати випадок' : 'Відкрити / завершити'}</Button></div>
              </article>
            ))}
          </div>
        )}
      </section>

      {dialog === 'create' && leader && (
        <Dialog title="Нова супервізія" subtitle="Планування зустрічі" onClose={() => setDialog('')}>
          <form className="form-grid" onSubmit={create}>
            <Field label="Психолог" full>
              <select value={form.psychologist_id} onChange={(e) => setForm({ ...form, psychologist_id: e.target.value })} required>
                {(meta.psychologists || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Дата і час"><input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} required /></Field>
            <Field label="Тривалість, хв"><input type="number" min="30" max="240" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></Field>
            <Field label="Тема" full><input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Напрям супервізії" /></Field>
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Запланувати</Button></div>
          </form>
        </Dialog>
      )}

      {dialog === 'edit' && selected && (
        <Dialog title="Супервізія" subtitle={selected.psychologist + ' · ' + (selected.scheduled_at || '').replace('T',' ')} onClose={() => setDialog('')} wide>
          <form className="form-grid" onSubmit={saveEdit}>
            <Field label="Деідентифікований опис випадку" hint="Не вказуйте ПІБ, телефон, адресу, номер картки або інші прямі ідентифікатори." full>
              <textarea rows="7" value={edit.case_summary} onChange={(e) => setEdit({ ...edit, case_summary: e.target.value })} />
            </Field>
            {leader && <>
              <Field label="Рекомендації супервізора" full><textarea rows="6" value={edit.recommendations} onChange={(e) => setEdit({ ...edit, recommendations: e.target.value })} /></Field>
              <Field label="Статус">
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option value="scheduled">Заплановано</option>
                  <option value="completed">Завершено</option>
                  <option value="cancelled">Скасовано</option>
                </select>
              </Field>
            </>}
            <div className="form-actions full-span"><Button type="button" variant="ghost" onClick={() => setDialog('')}>Скасувати</Button><Button type="submit">Зберегти</Button></div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function Archive({ api, openPatient }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  async function load() {
    try { setRows(await api('GET', '/api/patients?status=archived')); setError(''); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHead eyebrow="ІСТОРІЯ ЦЕНТРУ" title="Архів пацієнтів" subtitle="Завершені курси не видаляються. При повторному зверненні відкривається новий курс у тій самій картці." actions={<Button variant="secondary" onClick={load}>Оновити</Button>} />
      {error && <div className="alert error">{error}</div>}
      <section className="surface">
        {!rows.length ? <Empty title="Архів порожній" text="Після завершення курсу картка пацієнта з’явиться тут." /> : (
          <div className="patient-card-list">
            {rows.map((p) => (
              <button className="patient-list-card" key={p.id} onClick={() => openPatient(p.id)}>
                <span className="patient-card-accent" />
                <span className="patient-card-head">
                  <span className="avatar patient-avatar">{p.name.slice(0,1).toUpperCase()}</span>
                  <span className="patient-card-name"><small>АРХІВ · №{p.patient_no}</small><strong>{p.name}</strong><span>{p.phone}</span></span>
                  <span className="patient-card-arrow">↗</span>
                </span>
                <span className="patient-card-meta">
                  <span><small>КАТЕГОРІЯ</small><strong>{p.category}</strong></span>
                  <span><small>ПСИХОЛОГ</small><strong>{p.psychologist}</strong></span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
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

function WorkspaceNavigation({ role, page, origin, locked, navigate }) {
  const sections = navigationFor(role);
  const active = page === 'patient-card' ? origin : page;
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(() => Object.fromEntries(sections.map(section => [section.id, section.items.some(([key]) => key === active)])));
  useEffect(() => {
    const section = navigationFor(role).find(group => group.items.some(([key]) => key === active));
    if (section) setExpanded(previous => ({ ...previous, [section.id]: true }));
  }, [active, role]);
  const query = filter.trim().toLocaleLowerCase('uk');
  const matching = sections.map(section => ({ ...section,
    items: section.label.toLocaleLowerCase('uk').includes(query) ? section.items : section.items.filter(([, label]) => label.toLocaleLowerCase('uk').includes(query))
  })).filter(section => section.items.length);
  const item = ([key, label]) => <button key={key} disabled={locked} aria-current={active === key ? 'page' : undefined} className={`nav-item ${active === key ? 'active' : ''}`} onClick={() => navigate(key)}><span className="nav-icon"><AppIcon name={key} /></span><span>{label}</span></button>;
  return <nav aria-label="Головне меню">
    <label className="menu-filter"><AppIcon name="search" size={16} /><input aria-label="Знайти розділ меню" placeholder="Знайти розділ…" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    {(role === 'admin' || role === 'director') && (!query || 'огляд центру'.includes(query)) && item(['dashboard', 'Огляд центру'])}
    {matching.map(section => {
      const open = Boolean(query) || expanded[section.id];
      return <section className="nav-section" key={section.id}>
        <button className={`nav-group ${section.items.some(([key]) => key === active) ? 'current-group' : ''}`} aria-expanded={open} aria-controls={`menu-${section.id}`} onClick={() => setExpanded(previous => ({ ...previous, [section.id]: !previous[section.id] }))}>
          <AppIcon name={section.icon} /><span>{section.label}</span><svg className="nav-chevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <div className="nav-children" id={`menu-${section.id}`} hidden={!open}>{section.items.map(item)}</div>
      </section>;
    })}
    {query && !matching.length && !((role === 'admin' || role === 'director') && 'огляд центру'.includes(query)) && <p className="menu-empty" role="status">Розділ не знайдено</p>}
  </nav>;
}

function Shell({ api, user, onLogout, apiBase, onSwitchApi, draftSession }) {
  const [page, setPage] = useState(defaultPage(user.role));
  const [patientId, setPatientId] = useState(null);
  const [patientOrigin, setPatientOrigin] = useState('patients');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggleRef = useRef(null);
  const sidebarRef = useRef(null);
  const workspaceRef = useRef(null);
  const [shift, setShift] = useState(null);
  const [shiftError, setShiftError] = useState('');
  const [shiftBusy, setShiftBusy] = useState(false);
  const [health, setHealth] = useState({ online: true, version: '2.2.0' });
  const navigation = [...navFor(user.role), ['preferences', 'Профіль і налаштування']];
  const activePageLabel = page === 'patient-card' ? 'Картка пацієнта' : (navigation.find(([key]) => key === page)?.[1] || 'SOLVIA');

  function openPatient(id) {
    if (user.role === 'director') return;
    setPatientOrigin(page === 'patient-card' ? patientOrigin : page);
    setPatientId(id); setPage('patient-card'); setMenuOpen(false);
    workspaceRef.current?.scrollTo({ top: 0 });
  }
  function navigate(target) {
    if (!navigation.some(([key]) => key === target)) return;
    setPatientId(null); setPage(target); setMenuOpen(false);
    workspaceRef.current?.scrollTo({ top: 0 });
  }
  useEffect(() => {
    if (!menuOpen) return;
    const opener = document.activeElement;
    const sidebar = sidebarRef.current;
    const controls = () => [...sidebar.querySelectorAll('button:not(:disabled), input, a[href]')].filter(el => el.getClientRects().length);
    controls()[0]?.focus();
    const keyboard = e => {
      if (e.key === 'Escape') { e.preventDefault(); setMenuOpen(false); }
      if (e.key === 'Tab') {
        const list = controls(), first = list[0], last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); if (opener?.isConnected) opener.focus(); };
  }, [menuOpen]);
  useEffect(() => {
    const resize = () => { if (window.innerWidth > 760) setMenuOpen(false); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const contextPage = page === 'patient-card' ? patientOrigin : page;
  const sectionLabel = navigationFor(user.role).find(section => section.items.some(([key]) => key === contextPage))?.label || roleLabels[user.role];


  async function loadShift() {
    try {
      setShift(await api('GET', '/api/shift-day'));
      setShiftError('');
    } catch (e) { setShiftError(e.message); }
  }

  async function changeShift(action) {
    if (action === 'close' && !window.confirm('Закрити робочу зміну SOLVIA на сьогодні?')) return;
    setShiftBusy(true);
    try {
      await api('POST', '/api/shift-day', { action });
      await loadShift();
    } catch (e) { setShiftError(e.message); }
    finally { setShiftBusy(false); }
  }

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try { const next = await api('GET', '/api/shift-day'); if (alive) { setShift(next); setShiftError(''); } }
      catch (e) { if (alive) setShiftError(e.message); }
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let alive = true;
    async function ping() {
      try {
        const result = await api('GET', '/api/health');
        if (alive) setHealth({ online: Boolean(result.ok), version: result.version || '2.2.0' });
      } catch {
        if (alive) setHealth({ online: false, version: '' });
      }
    }
    ping();
    const timer = setInterval(ping, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [apiBase]);

  const content = (() => {
    if (page === 'patient-card' && patientId) return <PatientCard key={patientId} api={api} role={user.role} patientId={patientId} back={() => navigate(patientOrigin)} draftSession={draftSession} />;
    if (page === 'waiting-list') return <WaitingList api={api} openPatient={openPatient} />;
    if (page === 'dashboard') return <Dashboard api={api} />;
    if (page === 'calendar') return <Calendar api={api} role={user.role} openPatient={openPatient} />;
    if (page === 'patients') return <Patients api={api} role={user.role} openPatient={openPatient} />;
    if (page === 'families') return <Families api={api} />;
    if (page === 'team') return <Team api={api} currentUser={user} />;
    if (page === 'rooms') return <Rooms api={api} />;
    if (page === 'reports') return <Reports api={api} role={user.role} />;
    if (page === 'workload') return <Workload api={api} />;
    if (page === 'supervisions') return <Supervisions api={api} role={user.role} user={user} />;
    if (page === 'archive') return <Archive api={api} openPatient={openPatient} />;
    if (page === 'devices') return <Devices api={api} />;
    if (page === 'settings') return <Settings api={api} apiBase={apiBase} onSwitchApi={onSwitchApi} />;
    if (page === 'preferences') return <AccountSettings api={api} apiBase={apiBase} onLogout={onLogout} user={user} />;
    if (page === 'audit') return <Audit api={api} />;
    return null;
  })();

  const locked = shift && !shift.open;

  return (
    <div className={`app-shell desktop-mvp ${menuOpen ? 'menu-open' : ''}`}>
      {menuOpen && <button className="menu-backdrop" aria-label="Закрити меню" onClick={() => setMenuOpen(false)} />}
      <aside ref={sidebarRef} id="workspace-menu" className="sidebar" aria-label="Меню SOLVIA">
        <div className="sidebar-brand">
          <div className="product-mark inverse"><img className="product-logo" src="/solvia-icon.png" alt="SOLVIA" /></div>
          <div><strong>SOLVIA</strong><span>Простір центру</span></div>
          <button className="menu-close icon-button" aria-label="Згорнути меню" onClick={() => setMenuOpen(false)}><AppIcon name="close" /></button>
        </div>

        <WorkspaceNavigation role={user.role} page={page} origin={patientOrigin} locked={locked} navigate={navigate} />

        <div className="sidebar-spacer" />
        <div className="sidebar-actions" aria-label="Налаштування та обліковий запис">
          {user.role === 'admin' && <button aria-label="Налаштування системи" className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><AppIcon name="settings" /><span className="desktop-label">Налаштування системи</span><span className="mobile-label" aria-hidden="true">Система</span></button>}
          <button aria-label="Профіль і налаштування" className={`nav-item ${page === 'preferences' ? 'active' : ''}`} onClick={() => navigate('preferences')}><AppIcon name="preferences" /><span className="desktop-label">Профіль і налаштування</span><span className="mobile-label" aria-hidden="true">Профіль</span></button>
          <button className="nav-item" onClick={onLogout}><AppIcon name="logout" /><span>Вийти</span></button>
        </div>
        <div className="sidebar-support">
          <div className="sidebar-support-head">
            <span className="support-dot" />
            <div><strong>QureMed Support</strong><small>24/7 · SOLVIA 2.2</small></div>
          </div>
          <a href="mailto:quremedindastriessupport@gmail.com">quremedindastriessupport@gmail.com</a>
        </div>
        <div className="user-card">
          <div className="avatar inverse">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="user-copy"><strong>{user.name}</strong><span>{roleLabels[user.role]}</span></div>
        </div>
      </aside>

      <main className="workspace" ref={workspaceRef} inert={menuOpen || undefined}>
        {shift?.open && (
          <div className="shift-bar">
            <div><span className="shift-dot" /> Зміна відкрита · {shift.shift_date} · {shift.opened_by_name || 'Адміністратор'}</div>
            {user.role === 'admin' && <Button variant="ghost" disabled={shiftBusy} onClick={() => changeShift('close')}>Завершити зміну</Button>}
          </div>
        )}
        <div className="workspace-topbar">
          <div className="topbar-context">
            <button ref={menuToggleRef} className="menu-toggle icon-button" aria-label="Відкрити меню" aria-expanded={menuOpen} aria-controls="workspace-menu" onClick={() => setMenuOpen(true)}><AppIcon name="audit" /></button>
            <div className="workspace-breadcrumb"><small>{sectionLabel}</small><strong>{activePageLabel}</strong></div>
          </div>
          {!locked && user.role !== 'director' && <GlobalSearch api={api} role={user.role} onPatient={openPatient} onNavigate={navigate} />}
          <div className={`connection-pill ${health.online ? 'online' : 'offline'}`} title={apiBase} role="status">
            <span className="connection-led" /><div><strong>{health.online ? 'Сервер доступний' : 'Немає зв’язку'}</strong><small>{health.online ? 'Можна працювати' : 'Перевірте підключення'}</small></div>
          </div>
        </div>
        {!locked && <ReminderBar api={api} role={user.role} />}
        <div className="workspace-inner">
          {shiftError && <div className="alert error" role="alert">{shiftError} <Button variant="secondary" onClick={loadShift}>Повторити підключення</Button></div>}
          {!shift && page !== 'preferences' && !(user.role === 'admin' && page === 'settings') ? <Spinner /> : locked && page !== 'preferences' && !(user.role === 'admin' && page === 'settings') ? (
            <section className="shift-gate surface">
              <img src="/solvia-icon.png" alt="SOLVIA" />
              <div className="eyebrow">ЩОДЕННЕ ВІДКРИТТЯ ЦЕНТРУ</div>
              <h1>Зміна {shift.shift_date} ще не відкрита</h1>
              {user.role === 'admin' ? (
                <>
                  <p>Підтвердіть відкриття робочої зміни. Після підтвердження календар, пацієнти та робочі модулі стануть доступними для команди.</p>
                  <Button disabled={shiftBusy} onClick={() => changeShift('open')}>{shiftBusy ? 'Відкриваємо…' : 'Підтвердити відкриття зміни'}</Button>
                </>
              ) : (
                <p>Адміністратор має підтвердити відкриття зміни на сьогодні. Після цього робочий простір відкриється.</p>
              )}
              {shift.closed_at && <small>Попереднє закриття: {shift.closed_at.replace('T',' ')}</small>}
              <Button variant="ghost" onClick={loadShift}>Перевірити ще раз</Button>
            </section>
          ) : content}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const queryBase = params.get('api');
  const appMode = params.get('mode') || 'center';
  const runtimeBase = window.location.hostname === 'app.solvia.invalid' ? (appMode === 'server' ? 'http://127.0.0.1:8765' : '') : window.location.origin;
  const [apiBase, setApiBase] = useState(() => queryBase || localStorage.getItem('solvia_api') || params.get('default_api') || runtimeBase);
  const [token, setToken] = useState(() => sessionStorage.getItem('solvia_token') || '');
  const activeToken = useRef(token);
  const [draftSession, setDraftSession] = useState(null);
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(token));
  useEffect(() => { applyPreferences(user ? readPreferences(apiBase, user) : {}); }, [user, apiBase]);

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

  async function login(base, result, password) {
    const identity = await draftIdentity(base, result.user, password).catch(() => null);
    setDraftSession(identity);
    localStorage.setItem('solvia_api', base);
    sessionStorage.setItem('solvia_token', result.token);
    activeToken.current = result.token;
    setApiBase(base);
    setToken(result.token);
    setUser(result.user);
  }

  function logout() {
    const previousBase = apiBase;
    const previousToken = token;
    sessionStorage.removeItem('solvia_token');
    activeToken.current = '';
    setToken('');
    setUser(null);
    setBooting(false);
    setDraftSession(null);
    // Return to login immediately; revoke the original session in the background.
    if (previousToken) void request(previousBase, previousToken, 'POST', '/api/logout').catch(() => {});
  }

  async function api(method, path, body) {
    try {
      return await request(apiBase, token, method, path, body);
    } catch (e) {
      if (e.status === 401 && activeToken.current === token) {
        sessionStorage.removeItem('solvia_token');
        activeToken.current = '';
        setToken('');
        setUser(null);
        setDraftSession(null);
      }
      throw e;
    }
  }

  function switchApi(nextBase) {
    const clean = cleanBase(nextBase);
    localStorage.setItem('solvia_api', clean);
    sessionStorage.removeItem('solvia_token');
    activeToken.current = '';
    setApiBase(clean);
    setToken('');
    setUser(null);
    setDraftSession(null);
  }

  if (booting) {
    return <div className="boot-screen"><div className="product-mark"><img className="product-logo" src="/solvia-icon.png" alt="SOLVIA" /></div><Spinner /><span>Відкриваємо SOLVIA…</span></div>;
  }

  if (!user) return <Login initialBase={apiBase} onLogin={login} />;
  if (appMode === 'server') return <ServerConsole api={api} user={user} onLogout={logout} apiBase={apiBase} onSwitchApi={switchApi} />;
  return <Shell api={api} user={user} onLogout={logout} apiBase={apiBase} onSwitchApi={switchApi} draftSession={draftSession} />;
}
