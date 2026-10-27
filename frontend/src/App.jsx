import TvSettings,{TvCallPanel} from './TvSettings.jsx';
import './tv-control.css';
import pkg from '../package.json';
import {readPcSession,savePcSession,clearPcSession} from './pc-session.mjs';
import {DesktopReleaseSettings,DesktopUpdateNotice} from './DesktopUpdates.jsx';
import StaffMessages from './StaffMessages.jsx';
import {backupNeedsAttention} from './backup-status.mjs';
import {DeviceHealth,ShiftReadiness,Addenda,PatientProgress} from './Operations.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cleanBase, connectionProfile, verifyProfile } from './connection.mjs';
import CenterLicense from './CenterLicense.jsx';
import { lightweightMode } from './performance.mjs';
import { draftIdentity, readDraft, writeDraft, removeDraft, DraftWriter } from './drafts.mjs';
import WaitingList from './WaitingList.jsx';
import ShiftWorkspace from './ShiftWorkspace.jsx';
import DailyReport from './DailyReport.jsx';
import AppointmentBooking from './AppointmentBooking.jsx';
import PatientDirectory, {ViewSwitch} from './PatientDirectory.jsx';
import usePatientDirectory from './usePatientDirectory.jsx';
import RehabilitationPlan,{PatientJourney} from './RehabilitationPlan.jsx';
import CenterHome from './CenterHome.jsx';
import DocumentTemplateSettings from './DocumentTemplateSettings.jsx';
import {navFor,navigationGroups} from './workspace-model.mjs';
import {focusNavigation} from './focus-workspace.mjs';
import {ModuleDirectory,PeriodActivity,DayTimeline} from './MotionWorkspace.jsx';
import WorkflowEvents from './WorkflowEvents.jsx';
import RecentCenterEvents from './RecentCenterEvents.jsx';
import {feedbackFor} from './workflow-events.mjs';

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
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    'waiting-list': <><rect x="3" y="4" width="12" height="17" rx="2"/><path d="M6 8h6M6 12h5M6 16h3"/><circle cx="17" cy="16" r="5"/><path d="M17 13v3l2 1"/></>,
    documents: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/></>,
    preferences: <><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2M18 3l1 1 2-2"/></>,
    'module-directory': <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    'shift-workspace': <><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 3h6v3H9zM8 11h8M8 16h4M15 16l2 2 4-4"/></>,
    patients: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    families: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M13.5 20a5 5 0 0 1 7.5-4.3"/></>,
    team: <><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    rooms: <><path d="M4 21V4a1 1 0 0 1 1-1h11v18"/><path d="M16 8h4v13M8 7h4M8 11h4M8 15h4"/><path d="M3 21h18"/></>,
    discharges: <><path d="M6 3h9l5 5v13H4V3zM14 3v6h6M8 13h8M8 17h5"/></>,
    reports: <><path d="M6 3h12a2 2 0 0 1 2 2v16H4V5a2 2 0 0 1 2-2z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    'staff-messages': <><rect x="3" y="4" width="18" height="14" rx="3"/><path d="M7 18v3l4-3M7 9h10M7 13h6"/></>,
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
  @page { size: A4 portrait; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #172f27; font-family: "Segoe UI", Arial, sans-serif; }
  body { width: auto; }
  .consent-print, .discharge-print {
    width: 100% !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
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
  .discharge-print section { margin-top: 5mm; }
  .discharge-print section h3 { break-after: avoid; margin: 0 0 1.5mm; color: #436a59; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; }
  .discharge-print section p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; orphans: 3; widows: 3; line-height: 1.5; font-size: 9.5pt; }
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
    throw Object.assign(new Error('Немає зв’язку із сервером. Перевірте адресу Linux/Windows-сервера, мережу центру та довіру до його CA-сертифіката.'), { status: 0 });
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

function WorkspaceNavigation({ navigation, role, page, locked, onNavigate }) {
  const active = page === 'patient-card' ? 'patients' : page;
  // The sidebar contains only four day-to-day destinations. Other allowed
  // features are discoverable from the home page, never removed from the API.
  const preferred = role === 'admin'
    ? [['dashboard','Головна'],['shift-workspace','Прийоми'],['calendar','Календар'],['patients','Пацієнти']]
    : role === 'reception'
    ? [['reception-home','Головна'],['shift-workspace','Прийоми'],['calendar','Календар'],['patients','Пацієнти']]
    : role === 'director'
    ? [['dashboard','Головна'],['workload','Навантаження'],['discharges','Виписки']]
    : [['calendar','Мої прийоми'],['patients','Пацієнти'],['reports','Звіти']];
  const available=new Set(navigation.map(([key])=>key));
  return <nav aria-label="Робочі розділи" className={`focus-navigation solvia-minimal-navigation ${locked ? 'nav-locked' : ''}`}>
    <div className="focus-nav-primary" aria-label="Головна навігація">
      {preferred.filter(([key])=>available.has(key)).map(([key,label])=><button key={key}
        type="button" disabled={locked && key !== 'staff-messages'} aria-current={active===key?'page':undefined}
        className={`nav-item ${active===key?'active':''}`} onClick={()=>onNavigate(key)}>
        <span className="nav-icon"><AppIcon name={key==='reception-home'?'dashboard':key}/></span><span>{label}</span>
      </button>)}
    </div>
  </nav>;
}

function defaultPage(role) {
  return role === 'admin' || role === 'director' ? 'dashboard' : role === 'reception' ? 'reception-home' : 'calendar';
}

function displayStatus(value) {
  return ({ active:'Активний', completed:'Завершено', archived:'Архів', signed:'Підписано', refused:'Відмова',
    scheduled:'Заплановано', cancelled:'Скасовано', recommended:'Рекомендовано', sent:'Направлено',
    normal:'Звичайний', important:'Важливо', urgent:'Терміново', low:'Низький', moderate:'Помірний',
    high:'Високий', critical:'Критичний' })[value] || value || '—';
}

function riskFlagsText(value) {
  try {
    const flags = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(flags) ? flags.map(flag => riskFlagOptions.find(([key]) => key === flag)?.[1] || 'Інша позначка').join(', ') || '—' : '—';
  } catch { return '—'; }
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

function Dialog({ title, subtitle, onClose, children, wide = false, error = '', className = '' }) {
  const panel = useRef(null), dirty = useRef(false), closeRef = useRef(onClose);
  closeRef.current = onClose;
  function close() {
    if(dirty.current && title !== 'Підсумок консультації' && title !== 'Підсумок дня' && !window.confirm('Залишити форму? Незбережені зміни буде втрачено.')) return;
    closeRef.current();
  }
  useEffect(() => {
    const previous = document.activeElement, oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.body.style.overflow = oldOverflow; if(previous?.isConnected) previous.focus(); };
  }, []);
  function keyDown(e) {
    if(e.key === 'Escape') { e.preventDefault(); close(); }
    if(e.key !== 'Tab') return;
    const focusable = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
    if(!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0], last = focusable.at(-1), focused = document.activeElement;
    if(e.shiftKey && (focused === first || focused === panel.current)) { e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && (focused === last || focused === panel.current)) { e.preventDefault(); first.focus(); }
  }
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`dialog ${wide ? 'wide' : ''} ${className}`}
        onKeyDown={keyDown} onChangeCapture={() => { dirty.current = true; }} onMouseDown={e => e.stopPropagation()}>
        <div className="dialog-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <IconButton onClick={close} aria-label="Закрити"><AppIcon name="close" /></IconButton></div>
        <div className="dialog-body">{error && <div className="alert error" role="alert">{error}</div>}{children}</div>
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

function Login({ initialBase, onLogin, consoleMode = false }) {
  const [server, setServer] = useState(initialBase);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showServer, setShowServer] = useState(!initialBase);
  const [connection, setConnection] = useState('');
  const [checking, setChecking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [availability, setAvailability] = useState({ state: 'checking', message: 'Перевіряємо з’єднання із сервером…' });
  useEffect(() => {
    let cancelled = false, timer;
    async function probe() {
      let base;
      try { base = cleanBase(server); }
      catch (e) { setAvailability({ state: 'invalid', message: e.message }); return; }
      try {
        const health = await request(base, '', 'GET', '/api/health');
        if (health.ok !== true || !health.version) throw new Error('За цією адресою немає SOLVIA API.');
        if (!cancelled) setAvailability({ state: 'online', message: 'Сервер доступний. Можна увійти.' });
      } catch (e) {
        if (!cancelled) setAvailability({ state: 'offline', message: e.status === 0 || e.status >= 500 ? 'Сервер недоступний. Зверніться до системного адміністратора.' : e.message });
      }
      if (!cancelled) timer = setTimeout(probe, 5000);
    }
    setAvailability({ state: 'checking', message: 'Перевіряємо з’єднання із сервером…' });
    void probe();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [server]);

  async function importConnection(file) {
    if (!file) return;
    setChecking(true); setError('');
    try {
      if (file.size > 65536) throw new Error('Файл підключення завеликий.');
      const profile = connectionProfile(await file.text());
      verifyProfile(profile, await request(profile.base, '', 'GET', '/api/health'));
      localStorage.setItem('solvia_profile:' + profile.base, JSON.stringify(profile));
      localStorage.setItem('solvia_api', profile.base);
      setServer(profile.base); setConnection('Підключено: ' + profile.center); setShowServer(false);
    } catch(e) { setError(e.message); } finally { setChecking(false); }
  }
  async function checkConnection() {
    setChecking(true); setConnection(''); setError('');
    try {
      const base = cleanBase(server);
      const health = await request(base, '', 'GET', '/api/health');
      if (health.ok !== true || !health.version) throw new Error('За цією адресою немає SOLVIA API.');
      localStorage.setItem('solvia_api', base);
      setConnection(`Сервер SOLVIA ${health.version} доступний · ${health.platform || 'HTTPS'}`);
    } catch (e) { setError(e.status === 0 || e.status >= 500 ? 'Сервер недоступний. Зверніться до системного адміністратора.' : e.message); }
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
      const profileText = localStorage.getItem('solvia_profile:' + base);
      if (profileText) verifyProfile(JSON.parse(profileText), await request(base, '', 'GET', '/api/health'));
      const result = await request(base, '', 'POST', '/api/login', { login, password, ...deviceIdentity() });
      await onLogin(base, result, password);
    } catch (e) {
      setError(e.status === 0 || e.status >= 500 ? 'Сервер недоступний. Зверніться до системного адміністратора.' : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen login-refined">
      <section className="login-brand">
        <div className="brand-orbit">
          <img className="brand-logo" src="/solvia-icon.png" alt="SOLVIA" />
        </div>
        <div className="login-brand-copy">
          <div className="eyebrow light">ПРОСТІР ЦЕНТРУ</div>
          <h1>Менше рутини.<br />Більше уваги людині.</h1>
          <p>Один простір для записів, консультацій і злагодженої роботи команди.</p><div className="login-capabilities"><span>01 · Прийоми та пацієнти</span><span>02 · Кабінети й команда</span><span>03 · Документи та рекомендації</span></div>
        </div>

      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="product">
            <div className="product-mark"><img className="product-logo" src="/solvia-icon.png" alt="SOLVIA" /></div>
            <div>
              <strong>SOLVIA</strong>
              <span>by QureMed</span>
            </div>
          </div>

          <div className="login-copy">
            <h2>{consoleMode?"Вхід до Server Console":"Вхід до SOLVIA"}</h2><small>Версія {pkg.version}</small>
            <p>Використайте персональний обліковий запис працівника.</p>
          </div>

          <div className={`alert ${availability.state === 'offline' ? 'error' : ''}`} role="status" aria-live="polite" data-testid="login-server-status">{availability.message}</div>
          {error && <div className="alert error" role="alert">{error}</div>}

          <Field label="Логін" full>
            <input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus autoComplete="username" placeholder="Ваш логін" required />
          </Field>

          <div className="field full"><label htmlFor="login-password">Пароль</label>
            <div className="password-control"><input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Введіть пароль" required /><button type="button" aria-pressed={showPassword} onClick={()=>setShowPassword(v=>!v)}>{showPassword ? "Сховати" : "Показати"}</button></div>
          </div>

          <Button type="submit" className="login-submit" disabled={busy || !server.trim()}>
            {busy ? 'Підключення…' : 'Увійти до SOLVIA'}
          </Button>

          <label className="field full">Підключити центр із файла
            <input type="file" accept=".solvia,.json" disabled={checking||busy} onChange={e=>{importConnection(e.target.files?.[0]);e.target.value='';}} />
          </label>
          <button type="button" className="server-toggle" onClick={() => setShowServer((v) => !v)}>
            {showServer ? 'Сховати підключення' : 'Підключення до центру'}
          </button>

          {showServer && (
            <>
              <Field label="Адреса сервера центру" hint="Linux-сервер: https://192.168.1.105:8443. Адресу покаже інсталятор сервера." full>
                <input value={server} onChange={(e) => { setServer(e.target.value); setConnection(''); }} spellCheck="false" placeholder="https://192.168.1.105:8443" />
              </Field>
              <Button type="button" variant="secondary" onClick={checkConnection} disabled={checking}>{checking ? 'Перевіряємо…' : 'Перевірити та зберегти адресу'}</Button>
              <p>Перед підключенням установіть CA-сертифікат, отриманий від адміністратора вашого Linux-сервера.</p>
              {connection && <div className="alert" role="status">{connection}</div>}
            </>
          )}

          <div className="login-foot">SOLVIA · QureMed</div>
        </form>
      </section>
    </div>
  );
}

function RoleActions({ role, onNavigate }) {
  const actions = role === 'admin'
    ? [['shift-workspace','Сьогоднішні прийоми','Прибуття та робота реєстратури'], ['patients','Картки пацієнтів','Історія та курси супроводу'], ['team','Працівники і доступ','Команда центру'], ['calendar','Календар','Психологи та кабінети']]
    : [['workload','Навантаження','Зайнятість спеціалістів'], ['supervisions','Супервізії','Професійна підтримка команди'], ['discharges','Виписки','Підсумки та рекомендації'], ['staff-messages','Повідомлення','Зв’язок із командою']];
  return <section className="role-actions" aria-label="Швидкі дії">{actions.map(([page,title,description]) =>
    <button key={page} onClick={() => onNavigate(page)}><span className="role-action-icon"><AppIcon name={page} /></span><span><strong>{title}</strong><small>{description}</small></span><span aria-hidden="true">↗</span></button>)}</section>;
}

function Dashboard({ api, role, onNavigate, access }) {
  const [system,setSystem]=useState(null);
  const [stats, setStats] = useState(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDate());
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [data,status]=await Promise.all([api('GET', `/api/stats?from=${from}&to=${to}`),role==='admin'?api('GET','/api/admin/system').catch(()=>null):Promise.resolve(null)]);
      setStats(data);setSystem(status);
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
        eyebrow={role==='admin'?'АДМІНІСТРАТОР':'КЕРІВНИК ЦЕНТРУ'}
        title="Огляд центру"
        subtitle={role==='admin'?'Пацієнти, команда та щоденна робота центру.':'Результати роботи центру та завантаження спеціалістів.'}
        actions={
          <div className="date-range">
            <input aria-label="Початок періоду" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>—</span>
            <input aria-label="Кінець періоду" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button variant="secondary" onClick={load}>Оновити</Button>
          </div>
        }
      />

      {error && <div className="alert error">{error}</div>}
      {!stats ? <Spinner /> : (
        <>
          <section className="focus-dashboard-head" aria-label="Швидкий початок роботи">
            <div><span className="eyebrow">{role==='admin'?'РОБОЧИЙ СТАН ЦЕНТРУ':'ОГЛЯД РОБОТИ КОМАНДИ'}</span>
              <h2>{role==='admin'?'Що відбувається в центрі':'Робота команди'}</h2>
              <p>Показники за обраний період. Для деталей оберіть потрібний розділ.</p></div>
            <div className="focus-dashboard-actions">
              <Button onClick={()=>onNavigate(role==='admin'?'shift-workspace':'workload')}>{role==='admin'?'Перейти до прийомів':'Навантаження'}</Button>
              <Button variant="secondary" onClick={()=>onNavigate('module-directory')}>Усі розділи</Button>
            </div>
          </section>
          <div className="motion-quick-strip"><RoleActions role={role} onNavigate={onNavigate}/></div>
          <div className="overview-primary" aria-label="Основні показники">
            {[cards[1],cards[4],cards[6],cards[3]].map(([label,value,hint],i)=><article className="overview-kpi" key={label}><span className="overview-kpi-icon"><AppIcon name={['patients','calendar','reports','families'][i]} /></span><span>{label}</span><strong>{value ?? '—'}</strong><small>{hint}</small></article>)}
          </div>
          <div className="overview-workbench">
            <PeriodActivity stats={stats} onNavigate={onNavigate}/>
            <section className="surface overview-status"><div className="section-head"><h2>{role==='admin'?'Що потребує уваги':'Документи та команда'}</h2></div>
              {role==='admin'?<><div className="overview-status-row"><span>Реєстратура</span><strong className={access?.allowed?'status-positive':'status-pending'}>{access?.allowed?'Доступ надано':'Очікує дозволу'}</strong></div>
                <button className="button secondary" onClick={()=>onNavigate('shift-workspace')}>Переглянути прийоми</button>
                <details className="focus-technical"><summary>Технічний стан і резервні копії</summary>
                  <div className="overview-status-row"><span>База даних</span><strong>{system?.database?.name || 'Стан не завантажено'}</strong></div>
                  <div className="overview-status-row"><span>Резервна копія</span><strong>{!system?.backups?.length?'Немає даних':system.backups[0].status==='success'?system.backups[0].created?.slice(0,16).replace('T',' '):'Потребує перевірки'}</strong></div>
                  <button className="button secondary" onClick={()=>onNavigate('devices')}>Стан пристроїв</button>
                </details></>:<><button className="overview-section-link" onClick={()=>onNavigate('discharges')}><AppIcon name="documents"/><span><strong>Виписки</strong><small>Перевірка підсумків і рекомендацій</small></span><span>→</span></button><button className="overview-section-link" onClick={()=>onNavigate('supervisions')}><AppIcon name="supervisions"/><span><strong>Супервізії</strong><small>Планування та підтримка спеціалістів</small></span><span>→</span></button></>}
            </section>
          </div>
          {role==='admin'&&<RecentCenterEvents api={api}/>}
          <details className="surface overview-more"><summary>Усі показники за період</summary><div className="overview-secondary">{cards.map(([label,value,hint])=><div key={label}><span>{label}</span><strong>{value ?? '—'}</strong><small>{hint}</small></div>)}</div></details>

          <details className="surface motion-analysis-more"><summary>Структура звернень та джерела направлень</summary>
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
          </details>
        </>
      )}
    </>
  );
}

function Calendar({ api, role, openPatient, onBook, initialDate }) {
  const [date, setDate] = useState(initialDate || localDate());
  const [view,setView]=useState('grid'),[psychologists,setPsychologists]=useState([]),[psychologistFilter,setPsychologistFilter]=useState('');
  function moveDate(days){const next=new Date(date+'T12:00:00');next.setDate(next.getDate()+days);setDate(localDate(next));}
  const [appointments, setAppointments] = useState([]);
  const [loading,setLoading]=useState(true);
  const generation=useRef(0);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const canSchedule = role === 'admin' || role === 'reception';
  const visibleAppointments=useMemo(()=>appointments.filter(a=>!psychologistFilter||String(a.psychologist_id)===psychologistFilter),[appointments,psychologistFilter]);

  async function load(targetDate = date,silent=false) {
    const request=++generation.current;if(!silent)setLoading(true);setError('');
    try {
      const [result,meta]=await Promise.all([api('GET', `/api/appointments?date=${targetDate}`),api('GET','/api/meta').catch(()=>({psychologists:[]}))]);
      if(request===generation.current){setAppointments(result);setPsychologists(role==='psychologist'?[]:(meta.psychologists||[]));setSelected(previous=>previous?result.find(item=>item.id===previous.id)||null:null);}
    } catch(e){if(request===generation.current)setError(e.message);}
    finally{if(request===generation.current)setLoading(false);}
  }

  useEffect(() => {
    void load(date);const refresh=()=>{if(!document.hidden&&!document.querySelector('[role=dialog]'))void load(date,true);};
    const timer=setInterval(refresh,10000);window.addEventListener('solvia:workflow-updated',refresh);
    return()=>{++generation.current;clearInterval(timer);window.removeEventListener('solvia:workflow-updated',refresh);};
  },[date]);

  function openNew() { onBook({date}); }
  function openEdit() { if(selected) onBook({date:(selected.start?.slice(0,10)||date),appointmentId:selected.id}); }

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
            {canSchedule && <Button onClick={openNew}><AppIcon name="plus" /> Записати пацієнта</Button>}
          </>
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className="motion-calendar-toolbar"><div className="motion-calendar-date-nav"><button className="button secondary" aria-label="Попередній день" onClick={()=>moveDate(-1)}>‹</button><button className="button secondary" onClick={()=>setDate(localDate())}>Сьогодні</button><button className="button secondary" aria-label="Наступний день" onClick={()=>moveDate(1)}>›</button></div><div className="motion-calendar-options">{role!=='psychologist'&&<select aria-label="Психолог у календарі" value={psychologistFilter} onChange={e=>{setPsychologistFilter(e.target.value);setSelected(null);}}><option value="">Усі психологи</option>{psychologists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}<div className="motion-calendar-views" role="group" aria-label="Вигляд календаря"><button aria-pressed={view==='grid'} onClick={()=>setView('grid')}>Сітка часу</button><button aria-pressed={view==='list'} onClick={()=>setView('list')}>Список</button></div></div></div>
      <div className={`calendar-layout motion-calendar-layout ${selected?'has-selection':''}`}>
        <section className="surface calendar-surface">
          <div className="section-head compact">
            <div>
              <div className="eyebrow">ДЕНЬ</div>
              <h2>{date}</h2>
            </div>
            <Badge tone="stone">{visibleAppointments.length} подій</Badge>
          </div>

          {loading?<div className="directory-loading" role="status"><Spinner/><span>Завантажуємо розклад…</span></div>:error&&!appointments.length?<Button variant="secondary" onClick={()=>load(date)}>Повторити завантаження</Button>:view==='grid'?<DayTimeline appointments={visibleAppointments} psychologists={psychologists.filter(p=>!psychologistFilter||String(p.id)===psychologistFilter)} selected={selected} onSelect={setSelected} canSchedule={canSchedule} onEmptySlot={options=>onBook({date,...options})}/>:!visibleAppointments.length ? <Empty title="Вільний день" text="На цю дату записів ще немає." /> : (
            <div className="appointment-list">
              {visibleAppointments.map((item) => (
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
          <div className="eyebrow">ДЕТАЛІ ЗУСТРІЧІ</div>
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
                <div><dt>Час</dt><dd>{(selected.start?.slice(11,16)||'—')} — {(selected.end?.slice(11,16)||'—')}</dd></div>
                <div><dt>Психолог</dt><dd>{selected.psychologist}</dd></div>
                <div><dt>Кабінет</dt><dd>{selected.room}</dd></div>
                <div><dt>Статус</dt><dd>{statusLabel(selected.status)}</dd></div>
              </dl>
              <div className="context-people">
                <span>Учасники</span>
                {(selected.patients||[]).map((p) => <strong key={p.id}>{p.name}</strong>)}
              </div>
              <div className="motion-patient-actions">{(selected.patients||[]).map(p=><button className="button secondary" key={p.id} onClick={()=>openPatient(p.id)}>Картка пацієнта · {p.name}</button>)}</div>
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


    </>
  );
}

function Patients({ api, role, openPatient, onBook, createRequest, onCreateRequestConsumed }) {
  const [families, setFamilies] = useState([]);
  const [meta, setMeta] = useState({ psychologists: [], categories: [] });
  const [view,setView]=useState(role==='psychologist'?'cards':'table');
  const [search, setSearch] = useState('');
  const [page,setPage]=useState(1),[status,setStatus]=useState('current');
  const directory=usePatientDirectory(api,{search,page,status});
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

  const [creating,setCreating]=useState(false);
  const [registrationDate,setRegistrationDate]=useState(localDate());
  const createLock=useRef(false), consumedCreate=useRef(null);
  const canCreate = role === 'admin' || role === 'reception';

  async function load() {
    setError('');
    try {
      const tasks = [api('GET', '/api/meta')];
      if (canCreate) tasks.push(api('GET', '/api/families'));
      const [m, f = []] = await Promise.all(tasks);
      setMeta(m);
      setFamilies(f);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);


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

  useEffect(()=>{
    if(createRequest && meta.psychologists?.length && consumedCreate.current!==createRequest.key){
      consumedCreate.current=createRequest.key;setRegistrationDate(createRequest.date || localDate());openCreate();onCreateRequestConsumed();
    }
  },[createRequest,meta]);

  async function createPatient(e) {
    e.preventDefault();
    if(createLock.current)return;
    createLock.current=true;setCreating(true);setError('');
    const bookAfter=e.nativeEvent.submitter?.value==='book';
    try {
      const created=await api('POST', '/api/patients', {
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
      setSearch('');setPage(1);setStatus('current');
      directory.reload();
      if(bookAfter)onBook({patientId:created.id,date:registrationDate});
    } catch (e) {
      setError(e.message);
    } finally {createLock.current=false;setCreating(false);}
  }

  return (
    <>
      <PageHead
        eyebrow={role === 'psychologist' ? 'МОЇ ПАЦІЄНТИ' : 'РЕЄСТРАТУРА'}
        title={role === 'psychologist' ? 'Мої пацієнти' : 'Пацієнти'}
        subtitle={role === 'psychologist' ? 'Тільки пацієнти, закріплені за вашим обліковим записом.' : 'Реєстраційні дані, сімейні зв’язки та призначений психолог.'}
        actions={canCreate && <Button onClick={openCreate}>+ Додати пацієнта</Button>}
      />

      {(error||directory.error) && <div role="alert" className="alert error">{error||directory.error} <Button variant="secondary" onClick={()=>{load();directory.reload();}}>Повторити</Button></div>}

      <section className="surface">
        <div className="toolbar patient-directory-toolbar">
          <div className="search-box">
            <span><AppIcon name="search" /></span>
            <input value={search} aria-label="Пошук пацієнтів" onChange={(e) => {setSearch(e.target.value);setPage(1);}} placeholder="Пошук за №, ПІБ, телефоном, категорією…" />
          </div>
          <select aria-label="Статус пацієнтів" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="current">Поточні пацієнти</option><option value="active">Активні</option><option value="completed">Курс завершено</option><option value="archived">Архів</option></select>
          <span className="directory-total" role="status">{directory.loading?'Завантаження…':`Знайдено: ${directory.total}`}</span><ViewSwitch value={view} onChange={setView} />
        </div>

        {directory.loading ? <p role="status">Шукаємо пацієнтів…</p> : directory.error ? null : !directory.items.length ? <Empty title="Нічого не знайдено" text="Спробуйте змінити запит або створіть нового пацієнта." /> : (
          <PatientDirectory rows={directory.items} view={view} onOpen={openPatient} onBook={canCreate?onBook:null} archived={status==='archived'} />
        )}
        <nav className="directory-pagination" aria-label="Сторінки реєстру">
          <Button variant="secondary" disabled={directory.loading||page<=1} onClick={()=>setPage(n=>n-1)}>Попередня</Button>
          <span>Сторінка {page} з {Math.max(1,Math.ceil(directory.total/25))}</span>
          <Button variant="secondary" disabled={directory.loading||page*25>=directory.total} onClick={()=>setPage(n=>n+1)}>Наступна</Button>
        </nav>
      </section>

      {dialog && (
        <Dialog title="Новий пацієнт" subtitle="Реєстраційна картка" onClose={() => {if(!createLock.current)setDialog(false);}} wide>
          <form className="form-grid" onSubmit={createPatient}>
            {error && <div className="alert error full-span" role="alert">{error}</div>}
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
            <details className="registration-extra full-span"><summary>Додаткові відомості про пацієнта</summary><div className="form-grid">
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
            </div></details>
            <div className="form-actions full-span">
              <Button type="button" variant="ghost" onClick={() => setDialog(false)}>Скасувати</Button>
              <Button type="submit" variant="secondary" disabled={creating} value="save">Зареєструвати</Button>
              <Button type="submit" disabled={creating} value="book">{creating?'Зберігаємо…':'Зареєструвати й записати'}</Button>
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
  const [editingDischarge, setEditingDischarge] = useState(null);
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
  const [centerDocumentTemplates,setCenterDocumentTemplates] = useState([]);
  const [referralForm, setReferralForm] = useState({ destination_type: 'Психіатр', destination_name: '', reason: '', status: 'recommended' });
  const [courseForm, setCourseForm] = useState({ started_at: localDate(), reason: '' });
  const [courseClose, setCourseClose] = useState({ ended_at: localDate(), outcome: '' });
  const [cardSection, setCardSection] = useState('overview');
  const [consultStage, setConsultStage] = useState(0);

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
    setDayAppointments([]); setConsultStage(0);
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
    if(!eligibleAppointments.some(a => String(a.id) === String(consultation.appointment_id))) { setConsultStage(0); setError('Оберіть доступний запис у календарі.'); return; }
    if(!consultation.note.trim()) { setConsultStage(2); setError('Заповніть нотатку консультації.'); return; }
    if(!Number.isInteger(Number(consultation.duration_minutes)) || Number(consultation.duration_minutes) < 10 || Number(consultation.duration_minutes) > 480) { setConsultStage(0); setError('Тривалість: від 10 до 480 хвилин.'); return; }
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
    setCenterDocumentTemplates([]);
    void api('GET','/api/document-templates').then(setCenterDocumentTemplates).catch(()=>{});
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
    const d=documentPreview;
    if(!d?.title?.trim()||!d?.patient_name?.trim()||!d?.content?.trim()||!d?.signed_at||(d.status==='signed'&&(!d.signed_by_name?.trim()||!d.signature_data))){setError('Документ не готовий до друку: перевірте назву, текст, пацієнта, дату та підпис.');return;}
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
          <div className="page-actions patient-minimal-actions">
            {isPsychologist && card.status === 'active' && <Button onClick={openConsultation}>+ Консультація</Button>}
            {(isAdmin || isReception) && <Button onClick={openPatientEdit}>Редагувати дані</Button>}
            {canManageCourse && !activeCourse && <Button onClick={() => setDialog('new-course')}>+ Новий курс</Button>}
            {(isPsychologist || isAdmin || (canManageCourse && activeCourse)) && <details className="patient-secondary-actions">
              <summary>Додаткові дії</summary>
              <div>
                {isPsychologist && <Button variant="secondary" onClick={assignAssessment}>Призначити анкету</Button>}
                {isAdmin && <Button variant="secondary" onClick={() => setDialog('admin-note')}>Службова нотатка</Button>}
                {(isAdmin || isPsychologist) && <Button variant="secondary" onClick={() => setDialog('discharge')}>Сформувати виписку</Button>}
                {canManageCourse && activeCourse && <Button variant="secondary" onClick={() => setDialog('archive-course')}>Завершити курс</Button>}
              </div>
            </details>}
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      <nav className="patient-section-tabs" aria-label="Розділи картки">
        {[[ 'overview','Огляд' ], ...(canReadConsultations ? [['records','Записи']] : []), ['documents','Документи'], ['followup','Супровід']].map(([key,label]) =>
          <button key={key} aria-pressed={cardSection === key} className={cardSection === key ? 'active' : ''} onClick={() => setCardSection(key)}>{label}</button>)}
      </nav>
      <div className="patient-card-grid patient-registration-full" hidden={cardSection !== 'overview'}>
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

      </div>

      {cardSection === 'overview' && <PatientJourney card={card} canReadClinical={canReadConsultations} />}
      {canReadConsultations && cardSection === 'followup' && <RehabilitationPlan api={api} patientId={patientId} patientName={card.name} patientNumber={card.patient_no} activeCourse={activeCourse} role={role} onPrint={printStandaloneNode} />}
      {canReadConsultations && cardSection === 'followup' && <PatientProgress api={api} patientId={patientId} canWrite={isPsychologist} history={card.consultations||[]} />}
      <section className="surface" hidden={cardSection !== 'followup'}>
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
                  <Badge tone={c.status === 'active' ? 'forest' : 'stone'}>{displayStatus(c.status)}</Badge>
                  {c.reason && <p><b>Причина:</b> {c.reason}</p>}
                  {c.outcome && <p><b>Підсумок:</b> {c.outcome}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="patient-card-grid patient-module-grid">
        <section className="surface" hidden={cardSection !== 'documents'}>
          <div className="section-head">
            <div><div className="eyebrow">ДОКУМЕНТИ ТА ЗГОДИ</div><h2>Підписані документи</h2></div>
            {canManageDocuments && <Button variant="secondary" onClick={() => openDocumentDialog()}>+ Документ</Button>}
          </div>
          {!card.documents?.length ? <Empty title="Документів ще немає" text="Додайте згоду, правила центру або відмову від послуги." /> : (
            <div className="assessment-list">
              {card.documents.map((d) => (
                <div className="assessment-row" key={d.id}>
                  <div><strong>{d.title}</strong><span>{d.signed_at?.replace('T',' ')} · {d.signed_by_name || 'без підписанта'}</span></div>
                  <div className="row-actions"><Badge tone={d.status === 'signed' ? 'forest' : 'rose'}>{displayStatus(d.status)}</Badge><Button variant="secondary" onClick={() => previewDocument(d.id)}>Перегляд / PDF</Button></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="surface" hidden={cardSection !== 'followup'}>
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
          <section className="surface" hidden={cardSection !== 'records'}>
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
                    <details className="consultation-record">
                      <summary>Повний запис консультації</summary>
                      <dl className="profile-list">
                        {[[ 'request_text','Запит' ],['state_text','Поточний стан'],['work_done','Проведена робота'],['result_text','Результат / динаміка'],['recommendations','Рекомендації'],['duration_minutes','Тривалість, хв']].map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{c[key] || '—'}</dd></div>)}
                        <div><dt>Рівень ризику</dt><dd>{displayStatus(c.risk_level)}</dd></div>
                        <div><dt>Оцінені ризики</dt><dd>{riskFlagsText(c.risk_flags)}</dd></div>
                      </dl>
                    </details>
                    <Addenda api={api} record={c} canWrite={isPsychologist} onSaved={load} />
                  </article>
                ))}
              </div>
            )}
          </section>

          {isPsychologist && (
          <section className="surface" hidden={cardSection !== 'records'}>
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
        <section className="surface" hidden={cardSection !== 'overview'}>
          <div className="section-head">
            <div><div className="eyebrow">АДМІНІСТРАТИВНИЙ КОНТРОЛЬ</div><h2>Службові нотатки</h2></div>
            <Badge tone="stone">{card.admin_notes?.length || 0}</Badge>
          </div>
          {!card.admin_notes?.length ? <Empty title="Нотаток немає" text="Службові позначки адміністратора з’являться тут." /> : (
            <div className="consultation-list">
              {card.admin_notes.map((n) => (
                <article className="consultation-card" key={n.id}>
                  <div className="consultation-date">{n.created?.replace('T',' ')} · {n.author}</div>
                  <Badge tone={n.priority === 'urgent' ? 'rose' : n.priority === 'important' ? 'sand' : 'stone'}>{displayStatus(n.priority)}</Badge>
                  <p>{n.note}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {(isAdmin || isPsychologist) && (
        <section className="surface" hidden={cardSection !== 'documents'}>
          <div className="section-head">
            <div><div className="eyebrow">ДОКУМЕНТИ</div><h2>Виписки</h2></div>
            <Badge tone="sky">{card.discharges?.length || 0}</Badge>
          </div>
          {!card.discharges?.length ? <Empty title="Виписок ще немає" text="Сформуйте підсумкову виписку за обраний період." /> : (
            <div className="assessment-list">
              {card.discharges.map((d) => (
                <div className="assessment-row" key={d.id}>
                  <div><strong>{d.date_from} — {d.date_to}</strong><span>{d.consultation_count} консультацій · {d.author}</span></div>
                  <div className="page-actions"><Button variant="secondary" onClick={() => openDischargePrint(d)}>Перегляд / PDF</Button>
                  {(isAdmin || isPsychologist) && <Button variant="secondary" onClick={() => setEditingDischarge(d)}>Редагувати</Button>}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}


      {dialog === 'document' && canManageDocuments && (
        <Dialog title="Документ / згода" subtitle={card.name} onClose={() => setDialog('')} wide>
          <form className="form-grid" onSubmit={saveDocument}>
            {!!centerDocumentTemplates.length && <Field label="Шаблон центру" full>
              <select defaultValue="" onChange={(e)=>{
                const selected=centerDocumentTemplates.find(t=>String(t.id)===e.target.value);
                if(!selected)return;
                const values={patient_name:card.name,patient_no:card.patient_no||'',today:localDate()};
                const expanded=selected.content.replace(/{{\s*(patient_name|patient_no|today)\s*}}/g,(_,key)=>values[key]||'');
                setDocumentForm(current=>({...current,document_type:'other',title:selected.title,content:expanded,signature_data:''}));
              }}>
                <option value="">Вибрати шаблон</option>
                {centerDocumentTemplates.map(t=><option value={t.id} key={t.id}>{t.title}</option>)}
              </select>
            </Field>}
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
          <div className="consult-step-nav" aria-label="Етапи консультації">{['Прийом','Запит і стан','Робота','План','Ризики'].map((label,index) =>
            <button type="button" key={label} aria-pressed={consultStage === index} onClick={() => setConsultStage(index)}>{index + 1}. {label}</button>)}</div>
          <form className="form-grid" noValidate onSubmit={saveConsultation}>
            <fieldset className="form-contents" disabled={consultBusy}>
            <section className="consult-stage form-grid full-span" hidden={consultStage !== 0}><Field label="Дата запису">
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
            </section>
            <section className="consult-stage form-grid full-span" hidden={consultStage !== 1}><Field label="Основний запит" full>
              <textarea rows="3" value={consultation.request_text} onChange={(e) => setConsultation({ ...consultation, request_text: e.target.value })} />
            </Field>
            <Field label="Поточний стан" full>
              <textarea rows="3" value={consultation.state_text} onChange={(e) => setConsultation({ ...consultation, state_text: e.target.value })} />
            </Field>
            </section>
            <section className="consult-stage form-grid full-span" hidden={consultStage !== 2}><Field label="Виконана робота" full>
              <textarea rows="3" value={consultation.work_done} onChange={(e) => setConsultation({ ...consultation, work_done: e.target.value })} />
            </Field>
            <Field label="Приватна нотатка" full>
              <textarea rows="6" value={consultation.note} onChange={(e) => setConsultation({ ...consultation, note: e.target.value })} required />
            </Field>
            </section>
            <section className="consult-stage form-grid full-span" hidden={consultStage !== 3}><Field label="Цілі роботи" full>
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
</section>
            <section className="consult-stage form-grid full-span" hidden={consultStage !== 4}><Field label="Рівень ризику">
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
            </section>
            <div className="form-actions full-span">
              <Button type="button" variant="ghost" disabled={consultBusy} onClick={closeConsultation}>Закрити · залишити чернетку</Button>
              {consultStage > 0 && <Button type="button" variant="secondary" disabled={consultBusy} onClick={() => setConsultStage(v => v - 1)}>Назад</Button>}
              {consultStage < 4 && <Button type="button" disabled={consultBusy} onClick={() => setConsultStage(v => v + 1)}>Далі</Button>}
              <Button type="submit" hidden={consultStage !== 4} disabled={consultBusy || draftStatus === 'conflict'}>{consultBusy ? 'Зберігаємо…' : 'Зберегти консультацію'}</Button>
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

      {editingDischarge && <DischargeEditor api={api} item={editingDischarge} onClose={() => setEditingDischarge(null)} onSaved={async () => { setEditingDischarge(null); await load(); }} />}
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

function Families({ api, openPatient }) {
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
                {members.length ? members.map((m) => <button className="family-member-link" key={m.id} onClick={()=>openPatient(m.id)}>{m.name}<small>{m.family_role || m.category}</small></button>) : <small>Ще немає учасників</small>}
              </div>
            </article>
          );
        })}
      </div>
      {!families.length && <section className="surface"><Empty title="Сімей ще немає" text="Створіть сім’ю, а потім оберіть її в картці нового пацієнта." /></section>}

      {dialog && (
        <Dialog error={error} title="Нова сім’я" onClose={() => setDialog(false)}>
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
  const [query,setQuery]=useState(''),[roleFilter,setRoleFilter]=useState('');
  const visible=users.filter(u=>(!roleFilter||u.role===roleFilter)&&[u.name,u.login,u.phone].some(v=>String(v||'').toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk'))));
  const emptyForm = { name: '', login: '', phone: '', password: '', role: 'psychologist', active: true };
  const [form, setForm] = useState(emptyForm);

  async function load() {
    try { setUsers(await api('GET', '/api/users')); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setError('');
    setForm(emptyForm);
    setEditing(null);
    setDialog('create');
  }

  function openEdit(user) {
    setError('');
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
        subtitle="Контакти, ролі, платформи входу та активні сесії працівників."
        actions={<Button onClick={openCreate}>+ Додати працівника</Button>}
      />
      {error && <div className="alert error">{error}</div>}
      <section className="surface">
        <div className="toolbar"><div className="search-box"><AppIcon name="search"/><input aria-label="Пошук працівника" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ім’я, логін або телефон" /></div><select className="toolbar-select" aria-label="Роль працівника" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="">Усі ролі</option>{Object.entries(roleLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select><span className="directory-total">Знайдено: {visible.length}</span></div>
        <div className="team-grid">
          {visible.map((u) => (
            <article className="team-card" key={u.id}>
              <button className="team-card-main" onClick={() => openEdit(u)}>
                <div className="avatar">{u.name.slice(0, 1).toUpperCase()}</div>
                <div className="team-card-copy">
                  <strong>{u.name}</strong>
                  <span>@{u.login}</span>
                  <small>{u.phone || 'Телефон не вказано'}</small>
                </div>
              </button>
              <div className="team-state"><Button variant="secondary" onClick={()=>openEdit(u)}>Редагувати</Button>
                <Badge tone="stone">{roleLabels[u.role] || u.role}</Badge><Badge tone={u.active?'forest':'stone'}>{u.active?'Активний':'Вимкнений'}</Badge>
                <small>{Number(u.active_sessions || 0) ? `${u.active_sessions} активн. сес. · ${u.platforms || 'Unknown'}` : 'Немає активної сесії'}</small>
                {Number(u.active_sessions || 0) > 0 && Number(u.id) !== Number(currentUser?.id) && (
                  <Button variant="danger" onClick={() => terminateSessions(u)}>Завершити сесію</Button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!visible.length && <Empty title="Працівників не знайдено" text="Змініть пошук або додайте працівника." />}
      </section>

      {dialog && (
        <Dialog error={error} title={dialog === 'create' ? 'Новий працівник' : 'Керування працівником'} subtitle={dialog === 'edit' ? `@${editing?.login}` : 'Створення облікового запису'} onClose={() => setDialog('')}>
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
            <Field label={dialog === 'create' ? 'Пароль' : 'Новий пароль'} hint={dialog === 'edit' ? 'Залиште порожнім, якщо пароль не змінюється.' : 'Від одного символу; можна використовувати цифру.'} full>
              <input type="password" minLength={dialog === 'create' ? 1 : undefined} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={dialog === 'create'} />
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
  const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('');
  const visible=rooms.filter(r=>(!statusFilter||(statusFilter==='active'?r.active:!r.active))&&[r.name,r.code,r.description].some(v=>String(v||'').toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk'))));
  const emptyForm = { name: '', code: '', type: 'individual', capacity: 1, description: '', active: true };
  const [form, setForm] = useState(emptyForm);

  async function load() {
    try { setRooms(await api('GET', '/api/rooms')); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setError('');
    setEditing(null);
    setForm(emptyForm);
    setDialog('create');
  }
  function openEdit(room) {
    setError('');
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
      <section className="surface directory-toolbar-surface"><div className="toolbar"><div className="search-box"><AppIcon name="search"/><input aria-label="Пошук кабінету" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Назва, номер або опис кабінету"/></div><select className="toolbar-select" aria-label="Статус кабінету" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">Усі кабінети</option><option value="active">Активні</option><option value="inactive">Неактивні</option></select><span className="directory-total">Знайдено: {visible.length}</span></div></section>
      <div className="room-grid">
        {visible.map((r, i) => (
          <article className={`room-card ${r.active ? '' : 'room-inactive'}`} key={r.id}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <div className="room-card-main">
              <strong>{r.name}</strong>
              <small>{r.code ? `${r.code} · ` : ''}{typeLabel(r.type)} · до {r.capacity} ос.</small>
              {r.description && <p>{r.description}</p>}
            </div>
            <div className="room-actions">
              <Badge tone={r.active ? 'forest' : 'stone'}>{r.active ? 'Активний' : 'Неактивний'}</Badge>
              <IconButton onClick={() => openEdit(r)} title="Редагувати" aria-label={`Редагувати ${r.name}`}><AppIcon name="edit" /></IconButton>
              <IconButton onClick={() => removeRoom(r)} title="Видалити" aria-label={`Видалити ${r.name}`}><AppIcon name="delete" /></IconButton>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && <section className="surface"><Empty title={rooms.length?'Кабінетів не знайдено':'Приміщень немає'} text={rooms.length?'Змініть пошук або фільтр.':'Додайте перший кабінет або зал.'} /></section>}

      {dialog && (
        <Dialog error={error} title={dialog === 'create' ? 'Нове приміщення' : 'Редагування приміщення'} onClose={() => setDialog('')} wide>
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

function Devices({ api, onMessage }) {
  return <><PageHead eyebrow="КОНСУЛЬТАЦІЇ" title="Синхронізація консультацій" subtitle="Стан передавання записів із телефонів та звірка проблемних консультацій." /><DeviceHealth api={api} onMessage={onMessage} Modal={Dialog} /></>;
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
      setSystem(await api('GET', '/api/admin/system'));
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
      {system && backupNeedsAttention(system.backups) && <div className="alert error" role="alert">Резервна копія потребує перевірки: немає свіжої успішної копії або остання операція завершилася помилкою.</div>}
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
  const [page,setPage]=useState('overview'),[sessions,setSessions]=useState([]),[center,setCenter]=useState(null),[health,setHealth]=useState(null),[error,setError]=useState('');
  async function load(){if(user.role!=='admin')return;try{const [devices,settings,serverHealth]=await Promise.all([api('GET','/api/admin/sessions'),api('GET','/api/settings/center'),api('GET','/api/health')]);setSessions(devices);setCenter(settings);setHealth(serverHealth);setError('');}catch(e){setHealth(null);setError(e.message);}}
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer);},[]);
  async function terminate(session){if(!window.confirm(`Завершити сесію ${session.name} на ${session.device_name||session.platform}?`))return;try{await api('DELETE',`/api/admin/sessions/${session.session_id}`,{});await load();}catch(e){setError(e.message);}}
  if(user.role!=='admin')return <div className="server-console"><div className="alert error">Server Console доступна тільки адміністратору.</div><Button onClick={onLogout}>Вийти</Button></div>;
  return <div className="server-console" tabIndex={0} role="region" aria-label="SOLVIA Server Console">
    <header className="server-console-head"><div className="product"><div className="product-mark"><img className="product-logo" src="/solvia-icon.png" alt="SOLVIA" /></div><div><strong>SOLVIA Server Console {pkg.version}</strong><span>{center?.center_name||'Керування сервером центру'}</span></div></div><div className="page-actions"><Button variant="secondary" onClick={load}>Оновити</Button><Button variant="ghost" onClick={onLogout}>Вийти</Button></div></header>
    <nav className="page-actions" aria-label="Розділи Server Console">{[['overview','Сервер'],['settings','Налаштування сервера'],['pc','Оновлення ПК'],['mobile','Оновлення Android'],['tv','TV-табло'],['sessions','Сеанси пристроїв'],['account','Мій обліковий запис']].map(([key,label])=><Button key={key} variant={page===key?'primary':'secondary'} onClick={()=>setPage(key)}>{label}</Button>)}</nav>
    {error&&<div className="alert error">{error}</div>}
    {page==='overview'&&<><div className="server-status-grid"><article className="stat-card"><strong>SOLVIA SERVER</strong><h3>Сервер центру {health?.version || '—'}</h3><p>{apiBase}</p></article><article className="stat-card"><strong>{sessions.filter(x=>x.online).length}</strong><h3>Пристроїв онлайн</h3><p>{sessions.length} активних сеансів</p></article></div><section className="surface"><h2>Обслуговування сервера</h2><ServerMaintenance api={api} apiBase={apiBase} /></section></>}
    {page==='settings'&&<Settings api={api} apiBase={apiBase} onSwitchApi={onSwitchApi} technical />}
    {page==='pc'&&<DesktopReleaseSettings api={api} />}
    {page==='mobile'&&<MobileReleaseSettings api={api} />}
    {page==='tv'&&<TvSettings api={api} apiBase={apiBase} />}
    {page==='account'&&<AccountSettings api={api} apiBase={apiBase} onLogout={onLogout} user={user} />}
    {page==='sessions'&&<section className="surface"><h2>Сеанси пристроїв</h2><p>Якщо працівник не може ввійти після зміни ПК, завершіть його попередній сеанс тут.</p><div className="device-list">{sessions.map(s=><article className="device-card" key={s.session_id}><div className={`device-status ${s.online?'online':''}`} /><div className="device-main"><strong>{s.device_name||s.platform}</strong><span>{s.name} · {roleLabels[s.role]}</span><small>{s.ip_address||'—'} · {s.last_seen?.replace('T',' ')}</small></div><Button variant="danger" onClick={()=>terminate(s)}>Завершити</Button></article>)}</div></section>}
  </div>;
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
  const [prefs, setPrefs] = useState(() => { try { return JSON.parse(localStorage.getItem('solvia_preferences') || '{}'); } catch { return {}; } });
  const [password, setPassword] = useState({current_password:'',new_password:'',confirm:''});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthError,setHealthError] = useState('');
  const passwordSaving = useRef(false);
  useEffect(() => { api('GET','/api/health').then(setHealth).catch(e=>setHealthError(e.message)); }, []);
  function change(key,value) {
    const next={...prefs,[key]:value}; setPrefs(next);
    localStorage.setItem('solvia_preferences',JSON.stringify(next));
    document.documentElement.dataset.reducedMotion=next.reducedMotion ? 'true':'false';
    document.documentElement.dataset.compact=next.compact ? 'true':'false';
    document.documentElement.dataset.lightweight=lightweightMode(next,navigator.platform,navigator.userAgent)?'true':'false';
  }
  async function changePassword(e) {
    e.preventDefault(); if(passwordSaving.current)return; setMessage('');
    if(password.new_password!==password.confirm){setMessage('Нові паролі не збігаються.');return;}
    passwordSaving.current=true;setBusy(true);
    try { await api('POST','/api/account/password',{current_password:password.current_password,new_password:password.new_password}); await onLogout(); }
    catch(e){setMessage(e.message);}finally{passwordSaving.current=false;setBusy(false);}
  }
  return <>
    <PageHead eyebrow="ОСОБИСТИЙ ПРОСТІР" title="Налаштування профілю" subtitle="Налаштування цього пристрою та захист облікового запису." />
    <div className="account-layout">
      <aside className="surface account-identity"><span className="account-avatar">{user?.name?.slice(0,1).toUpperCase() || 'S'}</span><h2>{user?.name || 'Працівник центру'}</h2><span className="badge sand">{roleLabels[user?.role] || 'Обліковий запис'}</span><dl><div><dt>Логін</dt><dd>{user?.login || 'Визначений адміністратором'}</dd></div><div><dt>Доступ</dt><dd>Відповідно до вашої ролі</dd></div></dl><p>Ім’я, роль і доступ змінює адміністратор центру.</p></aside>
      <div className="account-sections">
        <section className="surface account-section"><header><h2>Вигляд робочого простору</h2><p>Зміни зберігаються автоматично на цьому ПК.</p></header>
          <label className="account-preference"><span><strong>Полегшений режим</strong><small>Без розмиття та важких тіней. Рекомендовано для слабких ПК.</small></span><input type="checkbox" checked={lightweightMode(prefs,navigator.platform,navigator.userAgent)} onChange={e=>change('lightweight',e.target.checked)} /></label>
          <label className="account-preference"><span><strong>Зменшити анімації</strong><small>Спокійні переходи без зайвого руху</small></span><input type="checkbox" checked={!!prefs.reducedMotion} onChange={e=>change('reducedMotion',e.target.checked)} /></label>
          <label className="account-preference"><span><strong>Компактні списки</strong><small>Більше рядків у робочих таблицях</small></span><input type="checkbox" checked={!!prefs.compact} onChange={e=>change('compact',e.target.checked)} /></label>
        </section>
        <section className="surface account-section"><header><h2>Безпека облікового запису</h2><p>Після зміни пароля потрібно повторно увійти на всіх пристроях.</p></header><form className="account-password" onSubmit={changePassword}>
          {message && <div className="alert error" role="alert">{message}</div>}
          <Field label="Поточний пароль"><input type="password" autoComplete="current-password" disabled={busy} value={password.current_password} onChange={e=>setPassword({...password,current_password:e.target.value})} required /></Field>
          <div className="form-grid"><Field label="Новий пароль"><input type="password" minLength="1" autoComplete="new-password" disabled={busy} value={password.new_password} onChange={e=>setPassword({...password,new_password:e.target.value})} required /></Field>
          <Field label="Повторіть новий пароль"><input type="password" minLength="1" autoComplete="new-password" disabled={busy} value={password.confirm} onChange={e=>setPassword({...password,confirm:e.target.value})} required /></Field></div>
          <Button type="submit" disabled={busy}>{busy ? 'Змінюємо пароль…' : 'Змінити пароль'}</Button>
        </form></section>
        <section className="surface account-section account-version"><header><h2>Про SOLVIA {pkg.version}</h2><p>Сервер {health?.version || '…'} {health?.platform ? `· ${health.platform}` : ''}</p></header>{healthError&&<div className="alert error" role="alert">{healthError}</div>}<p className="account-address">{apiBase}</p><div className="page-actions"><Button variant="secondary" onClick={openProductUpdates}>Офіційні випуски</Button><a href="mailto:quremedindastriessupport@gmail.com">Підтримка QureMed</a></div><small>Оновлення встановлює адміністратор центру.</small></section>
      </div>
    </div>
  </>;
}

function MobileReleaseSettings({ api }) {
  const [release,setRelease] = useState(null), [apk,setApk] = useState(null), [busy,setBusy] = useState(false), [message,setMessage] = useState(''), [current,setCurrent] = useState(null);
  const [pilot,setPilot]=useState([]),[people,setPeople]=useState([]);
  useEffect(()=>{api('GET','/api/mobile-update').then(x=>{setCurrent(x);setPilot(x.rollout_user_ids||[]);}).catch(e=>setMessage(e.message));api('GET','/api/users').then(x=>setPeople(x.filter(p=>p.role==='psychologist'&&p.active))).catch(e=>setMessage(e.message));},[]);
  async function publish(e) {
    e.preventDefault(); if(busy) return; setBusy(true); setMessage('');
    try {
      if(!release || !apk) throw new Error('Оберіть release.json і підписаний APK.');
      const info=JSON.parse(await release.text()); if(apk.size>8*1024*1024) throw new Error('APK: максимум 8 МБ.');
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(apk);});
      await api('POST','/api/mobile-update',{...info,apk_base64:encoded,rollout_user_ids:pilot});
      setCurrent(await api('GET','/api/mobile-update')); setMessage('Оновлення опубліковано на сервері центру. Телефони побачать його після входу або наступної перевірки.');
    } catch(e) {setMessage(e.message);} finally {setBusy(false);}
  }
  return <section className="surface settings-panel"><h2>Оновлення Android</h2><p>{current?.available ? `На сервері: SOLVIA ${current.version_name}` : 'Підписаний APK ще не завантажено.'}</p>
    <p>Встановлення поза Play Market. Наступні APK мають використовувати той самий постійний підпис.</p>
    <form className="form-grid" onSubmit={publish}>
      <Field label="Опис випуску — release.json"><input type="file" accept=".json" disabled={busy} onChange={e=>setRelease(e.target.files[0]||null)} /></Field>
      <Field label="Підписаний APK"><input type="file" accept=".apk" disabled={busy} onChange={e=>setApk(e.target.files[0]||null)} /></Field>
      <Field label="Пробне встановлення — оберіть психологів" hint="Порожній список — оновлення доступне всім. Після перевірки повторно опублікуйте ті самі файли без обмеження групи."><select multiple value={pilot.map(String)} disabled={busy} onChange={e=>setPilot([...e.target.selectedOptions].map(x=>Number(x.value)))}>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <button type="button" className="button secondary" disabled={busy} onClick={()=>setPilot([])}>Зробити доступним усім</button>
      <div className="form-actions full-span"><Button disabled={busy}>{busy?'Завантажуємо…':'Опублікувати оновлення телефона'}</Button></div>
    </form>{message && <p role="status">{message}</p>}
  </section>;
}

function Settings({ api, apiBase, onSwitchApi, technical = false }) {
  const empty = {
    server_name: 'Основний', center_name: '', short_name: '', address: '', phone: '', email: '', website: '', city: '',
    director_name: '', admin_name: '', work_hours: '', document_footer: '', discharge_signatory: '',
    head_name: '', head_title: 'Завідувач центру', logo_data: '', appointment_reminder_minutes: 30,
    connection_mode: 'local', local_api_url: '', vps_api_url: '', vps_name: ''
  };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [connectionTest, setConnectionTest] = useState({ state: 'idle', message: '' });
  const [activeSection, setActiveSection] = useState(technical?'connection':'center');

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
      const connectionFields=new Set(['server_name','connection_mode','local_api_url','vps_api_url','vps_name']);
      const changes=Object.fromEntries(Object.entries(form).filter(([key])=>technical?connectionFields.has(key):!connectionFields.has(key)&&!['id','updated'].includes(key)));
      await api('PATCH', '/api/settings/center', changes);
      setSaved(technical?'Налаштування сервера збережено.':'Налаштування центру збережено.');
      setTimeout(() => setSaved(''), 2500);
    } catch (e) { setError(e.message); }
  }

  async function downloadMobileConfig() {
    try {
      const config = await api('GET', '/api/mobile-config?stable=1');
      if (config.format !== 'quremed.solvia.mobile' || !config.api_url) throw new Error('Сервер не створив файл підключення.');
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/vnd.solvia.connection+json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href; link.download = 'SOLVIA-Mobile.solvia';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setConnectionTest({ state: 'ok', message: 'Файл створено сервером зі збережених налаштувань. Відкрийте його на телефоні у SOLVIA.' });
    } catch (e) { setConnectionTest({ state: 'error', message: e.message }); }
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
      setConnectionTest({ state: 'ok', message: `SOLVIA ${result.version || '—'} доступна · ${endpoint}` });
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
        title={technical?"Налаштування сервера":"Налаштування SOLVIA"}
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
            ['mobile','Оновлення Android','APK для телефонів'],
            ['desktop','Оновлення ПК','Windows та Linux'],
            ['workflow','Правила роботи','Розклад і безпека'],
            ['license','Право користування','Активація центру'],
            ['maintenance','Backup','Резервні копії']
          ].filter(([key])=>technical?['connection','license','maintenance'].includes(key):['center','documents','workflow'].includes(key)).map(([key,title,text]) => (
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
                <Badge tone="forest">SOLVIA {pkg.version}</Badge>
              </div>

              <form className="form-grid" onSubmit={save}>
                {activeSection === 'center' ? <>
                  <Field label="Назва сервера на телефонах" full><input maxLength={120} value={form.server_name} onChange={e=>setForm({...form,server_name:e.target.value})} required placeholder="Основний / Додатковий" /></Field>
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

          {activeSection === 'documents' && <DocumentTemplateSettings api={api} />}
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
                <Field label="Local API URL" full hint="Постійне DNS-ім’я, наприклад https://solvia.center.example:8443. DNS має працювати в мережі центру, а сертифікат — відповідати імені.">
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
                    <Button type="button" variant="secondary" onClick={downloadMobileConfig}>Файл для Android / ПК</Button>
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

          {activeSection === 'license' && <CenterLicense api={api} />}
          {activeSection === 'workflow' && <WorkflowSettings api={api} />}
          {activeSection === 'mobile' && <MobileReleaseSettings api={api} />}
          {activeSection === 'desktop' && <DesktopReleaseSettings api={api} />}
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

function GlobalSearch({ api, onPatient, onNavigate }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error,setError]=useState('');
  const apiRef=useRef(api);apiRef.current=api;

  useEffect(() => {
    let current=true;
    setResult(null);setError('');setBusy(false);
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const data=await apiRef.current('GET', `/api/search?q=${encodeURIComponent(query.trim())}`);
        if(current)setResult(data);
      } catch (e) { if(current)setError(e.message); }
      finally { if(current)setBusy(false); }
    }, 250);
    return () => { current=false;clearTimeout(timer); };
  }, [query]);

  const total = result ? Object.values(result).reduce((n, arr) => n + (arr?.length || 0), 0) : 0;
  return (
    <div className="global-search-wrap">
      <div className="global-search">
        <span><AppIcon name="search" /></span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Пошук у центрі" placeholder="Пошук пацієнта, сім’ї, працівника, кабінету…" />
        {busy && <small>Пошук…</small>}
      </div>
      {error && <div className="search-popover" role="alert">Не вдалося виконати пошук: {error}</div>}
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

function Reports({ api, role, shiftDate }) {
  const reportDay = shiftDate || localDate();
  const reportLock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [from, setFrom] = useState(reportDay.slice(0, 7) + '-01');
  const [to, setTo] = useState(reportDay);
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
        const todayReport = r.find((x) => x.shift_date === reportDay);
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
    if (reportLock.current) return;
    reportLock.current = true; setSubmitting(true);
    setError(''); setSaved('');
    try {
      const result = await api('POST', '/api/shift-reports', {
        shift_date: reportDay,
        summary: form.summary,
        incidents: form.incidents,
        handover: form.handover,
        critical_cases: form.critical_cases,
        notify_admin: form.notify_admin,
        notify_director: form.notify_director
      });
      setSaved(`Звіт за зміну збережено. Консультацій за зміну: ${result.consultations_count}.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally { reportLock.current = false; setSubmitting(false); }
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
            <div><div className="eyebrow">ЗМІНА · {reportDay}</div><h2>Підсумок зміни</h2></div>
            <Badge tone={reports.some((r) => r.shift_date === reportDay) ? 'forest' : 'sand'}>{reports.some((r) => r.shift_date === reportDay) ? 'Звіт подано' : 'Очікує звіту'}</Badge>
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
            <div className="form-actions full-span"><Button type="submit" disabled={submitting}>{submitting ? 'Зберігаємо…' : 'Зберегти звіт за зміну'}</Button></div>
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
                  <Badge tone={x.status === 'completed' ? 'forest' : x.status === 'cancelled' ? 'rose' : 'sand'}>{displayStatus(x.status)}</Badge>
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
        <Dialog error={error} title="Нова супервізія" subtitle="Планування зустрічі" onClose={() => setDialog('')}>
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
        <Dialog error={error} title="Супервізія" subtitle={selected.psychologist + ' · ' + (selected.scheduled_at || '').replace('T',' ')} onClose={() => setDialog('')} wide>
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
  const [query,setQuery]=useState(''),[view,setView]=useState('table');
  const visible=rows.filter(p=>[p.name,p.patient_no,p.phone,p.category,p.psychologist].some(v=>String(v || '').toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk'))));
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
        <div className="toolbar"><div className="search-box"><AppIcon name="search"/><input aria-label="Пошук в архіві" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ПІБ, номер картки або телефон" /></div><span className="directory-total">Знайдено: {visible.length}</span><ViewSwitch value={view} onChange={setView}/></div>
        {!visible.length?<Empty title={rows.length?'Нічого не знайдено':'Архів порожній'} text={rows.length?'Змініть пошук.':'Після завершення курсу картка пацієнта з’явиться тут.'}/>:<PatientDirectory rows={visible} view={view} onOpen={openPatient} archived />}

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

function DischargeEditor({ api, item, onClose, onSaved }) {
  const [form, setForm] = useState({ summary:item.summary || '', dynamics:item.dynamics || '', recommendations:item.recommendations || '', followup:item.followup || '', reason:'' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [history, setHistory] = useState(null);
  const fields = [['summary','Підсумок психологічного супроводу'],['dynamics','Динаміка'],['recommendations','Рекомендації'],['followup','Подальший супровід']];
  async function save(e) {
    e.preventDefault(); if(busy) return; setBusy(true); setError('');
    try { await api('PATCH', `/api/discharges/${item.id}`, {...form,revision:item.revision || 1}); await onSaved(); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function loadHistory() {
    try { setHistory(await api('GET', `/api/discharges/${item.id}/history`)); } catch(e) { setError(e.message); }
  }
  return <Dialog title="Редагування виписки" subtitle={`${item.patient_name || 'Пацієнт'} · № ${item.document_no || item.id} · версія ${item.revision || 1}`} onClose={() => { if(!busy) onClose(); }} wide>
    <form className="form-grid" onSubmit={save}>
      {error && <div className="alert error full-span" role="alert">{error}</div>}
      {fields.map(([key,label]) => <Field key={key} label={label} full><textarea rows={4} maxLength={7000} required={key==='summary'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} /></Field>)}
      <Field label="Причина редагування" hint="Попередній текст залишається в історії документа." full><input required maxLength={500} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} /></Field>
      <div className="form-actions full-span"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Скасувати</Button><Button type="button" variant="secondary" onClick={loadHistory}>Історія змін</Button><Button disabled={busy}>{busy?'Зберігаємо…':'Зберегти зміни'}</Button></div>
    </form>
    {history && <section aria-label="Історія виписки"><h3>Історія змін</h3>{!history.length && <p>Виписку ще не редагували.</p>}{history.map(row=>{let old;try{old=JSON.parse(row.snapshot);}catch{old={};}return <details key={row.revision}><summary>Версія {row.revision} · {row.author} · {row.created} · {row.reason}</summary>{fields.map(([key,label])=><div key={key}><strong>{label}</strong><p style={{whiteSpace:'pre-wrap'}}>{old[key] || '—'}</p></div>)}</details>;})}</section>}
  </Dialog>;
}

function Discharges({ api }) {
  const [items,setItems]=useState(null),[error,setError]=useState(''),[editing,setEditing]=useState(null),[query,setQuery]=useState('');
  async function load(){try{setItems(await api('GET','/api/discharges'));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  const visible=(items || []).filter(x=>`${x.patient_name} ${x.document_no}`.toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk')));
  return <><PageHead eyebrow="ДОКУМЕНТИ" title="Виписки" subtitle="Підсумки супроводу, динаміка, рекомендації та історія редагувань." />
    {error && <div className="alert error" role="alert">{error}</div>}
    <section className="surface"><Field label="Пошук виписки"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пацієнт або номер документа" /></Field>
    {items===null ? <Spinner /> : !visible.length ? <Empty title="Виписок немає" text="Створені в картках пацієнтів виписки з’являться тут." /> : <div className="assessment-list">{visible.map(item=><div className="assessment-row" key={item.id}><div><strong>{item.patient_name} · № {item.document_no || item.id}</strong><span>{item.date_from} — {item.date_to} · {item.author} · версія {item.revision || 1}</span></div><Button variant="secondary" onClick={()=>setEditing(item)}>Редагувати</Button></div>)}</div>}</section>
    {editing && <DischargeEditor key={editing.id} api={api} item={editing} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);await load();}} />}</>;
}

function ReceptionAccess({ api, onChanged, onClose, access }) {
  const [date,setDate]=useState(access?.access_date || localDate()),[time,setTime]=useState(access?.starts_at?.slice(11,16) || '08:00'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e,enabled=true){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api('POST','/api/reception-access',{access_date:date,start_time:time,enabled});await onChanged();onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <Dialog title="Доступ реєстратури" subtitle="Зміна залишається відкритою. Дозвіл діє для реєстратури в обраний день за часом сервера." onClose={()=>{if(!busy)onClose();}}>
    <form className="form-grid" onSubmit={save}>
      {error && <div className="alert error full-span" role="alert">{error}</div>}
      <Field label="Дата доступу"><input type="date" required value={date} onChange={e=>setDate(e.target.value)} /></Field>
      <Field label="Доступ з"><input type="time" step="60" required value={time} onChange={e=>setTime(e.target.value)} /></Field>
      <p className="full-span">Дозволяє реєструвати пацієнтів, створювати й переносити записи та відмічати прибуття. Час консультації обирається окремо в календарі.</p>
      <div className="form-actions full-span"><Button type="button" variant="ghost" disabled={busy} onClick={e=>save(e,false)}>Відкликати доступ</Button><Button disabled={busy}>{busy?'Зберігаємо…':'Надати доступ'}</Button></div>
    </form>
  </Dialog>;
}

function Shell({ api, user, onLogout, apiBase, onSwitchApi, draftSession }) {
  const [page, setPage] = useState(defaultPage(user.role));
  useEffect(() => { document.querySelector('.workspace')?.scrollTo(0, 0); window.scrollTo(0, 0); }, [page]);
  const [bookingIntent,setBookingIntent]=useState(null);
  const [bookingResult,setBookingResult]=useState(null);
  const [bookingVersion,setBookingVersion]=useState(0);
  const [calendarFocus,setCalendarFocus]=useState(null);
  const [createRequest,setCreateRequest]=useState(null);
  function startBooking(options){setBookingIntent({...options,date:options.date || receptionAccess?.access_date || localDate()});}
  function registerPatient(date,bookAfter=false){setBookingIntent(null);setCreateRequest({key:Date.now(),date:date || receptionAccess?.access_date || localDate(),bookAfter});navigate('patients');}
  function booked(result){setBookingIntent(null);setBookingResult(result);setCalendarFocus(result.date);setBookingVersion(v=>v+1);}
  const [patientId, setPatientId] = useState(null);
  const [patientOrigin, setPatientOrigin] = useState('patients');
  const [shift, setShift] = useState(null);
  const [shiftError, setShiftError] = useState('');
  const [receptionAccess,setReceptionAccess]=useState(null);
  const [dailyReport,setDailyReport]=useState(false);
  const [accessDialog,setAccessDialog]=useState(false);
  const [messageTarget,setMessageTarget]=useState(null);
  const [health, setHealth] = useState({ online: true, version: '' });
  const navigation = [['module-directory','Усі розділи'],...(user.role==='reception'?[['reception-home','Головна']]:[]),...navFor(user.role), ...(['admin','reception','psychologist'].includes(user.role)?[['tv-calls','TV-виклики']]:[]), ['preferences', 'Налаштування профілю']];
  const [menuOpen, setMenuOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(() => window.matchMedia('(max-width:760px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width:760px)');
    const update = () => { setCompactNav(media.matches); if(!media.matches) setMenuOpen(false); };
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if(!compactNav) return;
    if(menuOpen) document.querySelector('.sidebar button:not(:disabled)')?.focus();
    else document.querySelector('.mobile-menu-button')?.focus();
  }, [compactNav, menuOpen]);
  const activePageLabel = page === 'patient-card' ? 'Картка пацієнта' : (navigation.find(([key]) => key === page)?.[1] || 'SOLVIA');
  const connectionKind = /^https:\/\//i.test(apiBase || '') && !/127\.0\.0\.1|localhost|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./.test(apiBase || '') ? 'VPS' : 'LOCAL';

  function openPatient(id) { if(page !== 'patient-card') setPatientOrigin(page); setPatientId(id); setPage('patient-card'); setMenuOpen(false); }
  function navigate(target) { if(target !== 'staff-messages') setMessageTarget(null); setPatientId(null); setPage(target); setMenuOpen(false); }

  async function loadShift() {
    try {
      const [currentShift,access] = await Promise.all([api('GET','/api/shift-day'), ['admin','reception','director'].includes(user.role)?api('GET','/api/reception-access'):Promise.resolve(null)]);
      setShift(previous=>JSON.stringify(previous)===JSON.stringify(currentShift)?previous:currentShift);
      setReceptionAccess(previous=>JSON.stringify(previous)===JSON.stringify(access)?previous:access);
      setShiftError('');
    } catch (e) { setShiftError(e.message); }
  }

  useEffect(() => { loadShift(); const timer = setInterval(()=>{if(!document.hidden)void loadShift();}, 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let alive = true;
    async function ping() {
      try {
        const result = await api('GET', '/api/health');
        if (alive) setHealth(previous=>{const next={online:Boolean(result.ok),version:result.version||''};return previous.online===next.online&&previous.version===next.version?previous:next;});
      } catch {
        if (alive) setHealth(previous=>previous.online===false&&previous.version===''?previous:{online:false,version:''});
      }
    }
    ping();
    const timer = setInterval(()=>{if(!document.hidden)void ping();}, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [apiBase]);

  const content = (() => {
    if (page === 'patient-card' && patientId) return <PatientCard key={patientId} api={api} role={user.role} patientId={patientId} back={() => navigate(patientOrigin)} draftSession={draftSession} />;
    if (page === 'shift-workspace' && shift && ['admin','reception'].includes(user.role)) return <ShiftWorkspace api={api} shift={{...shift,shift_date:receptionAccess?.access_date || shift.shift_date}} openPatient={openPatient} openCalendar={() => navigate('calendar')} onBook={startBooking} onCreatePatient={registerPatient} refreshVersion={bookingVersion} savedDate={bookingResult?.date} />;
    if (page === 'module-directory') return <ModuleDirectory role={user.role} onNavigate={navigate} Icon={AppIcon}/>;
    if (page === 'waiting-list') return <WaitingList api={api} openPatient={openPatient} Modal={Dialog} />;
    if (page === 'dashboard' && user.role==='admin') return <CenterHome api={api} role="admin" onNavigate={navigate} onRegister={()=>registerPatient()} onBook={()=>startBooking({})} onOpenPatient={openPatient}/>;
    if (page === 'reception-home' && user.role==='reception') return <CenterHome api={api} role="reception" onNavigate={navigate} onRegister={()=>registerPatient()} onBook={()=>startBooking({})} onOpenPatient={openPatient}/>;
    if (page === 'dashboard') return <Dashboard api={api} role={user.role} onNavigate={navigate} access={receptionAccess} />;
    if (page === 'tv-calls') return <TvCallPanel api={api} />;
    if (page === 'calendar') return <Calendar key={`${bookingVersion}:${calendarFocus||''}`} api={api} role={user.role} openPatient={openPatient} onBook={startBooking} initialDate={calendarFocus||bookingResult?.date} />;
    if (page === 'patients') return <Patients api={api} role={user.role} openPatient={openPatient} onBook={startBooking} createRequest={createRequest} onCreateRequestConsumed={()=>setCreateRequest(null)} />;
    if (page === 'families') return <Families api={api} openPatient={openPatient} />;
    if (page === 'team') return <Team api={api} currentUser={user} />;
    if (page === 'rooms') return <Rooms api={api} />;
    if (page === 'reports') return <Reports key={shift?.shift_date} api={api} role={user.role} shiftDate={shift?.shift_date} />;
    if (page === 'discharges') return <Discharges api={api} />;
    if (page === 'workload') return <Workload api={api} />;
    if (page === 'supervisions') return <Supervisions api={api} role={user.role} user={user} />;
    if (page === 'archive') return <Archive api={api} openPatient={openPatient} />;
    if (page === 'staff-messages' && ['admin','director'].includes(user.role)) return <StaffMessages api={api} initialRecipient={messageTarget?.user_id} initialDevice={messageTarget?.device_id} />;
    if (page === 'devices') return <Devices api={api} onMessage={target=>{setMessageTarget(target);navigate('staff-messages');}} />;
    if (page === 'settings') return <Settings api={api} apiBase={apiBase} onSwitchApi={onSwitchApi} />;
    if (page === 'preferences') return <AccountSettings api={api} apiBase={apiBase} onLogout={onLogout} user={user} />;
    if (page === 'audit') return <Audit api={api} />;
    return null;
  })();

  const locked = user.role === 'admin' ? false : shift && (!shift.open || (user.role === 'reception' && !receptionAccess?.allowed));

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`} data-role={user.role}>
      {menuOpen && <button className="nav-scrim" aria-label="Закрити меню" onClick={() => setMenuOpen(false)} />}
      <aside className="sidebar" id="workspace-navigation" inert={compactNav && !menuOpen} aria-hidden={compactNav && !menuOpen ? true : undefined} onKeyDown={e => {
        if(e.key === 'Escape') { e.preventDefault(); setMenuOpen(false); }
        if(e.key === 'Tab' && compactNav && menuOpen) {
          const controls = [...e.currentTarget.querySelectorAll('button:not(:disabled),a[href]')].filter(el => el.getClientRects().length);
          const first = controls[0], last = controls.at(-1);
          if(e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if(!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="sidebar-brand">
          <div className="product-mark inverse motion-brand-mark" aria-hidden="true"><svg width="30" height="38" viewBox="0 0 30 38"><g fill="currentColor" transform="rotate(-15 15 19)"><rect x="3" y="10" width="5" height="23" rx="2.5"/><rect x="12" y="2" width="5" height="34" rx="2.5"/><rect x="21" y="15" width="5" height="17" rx="2.5"/></g></svg></div>
          <div><strong>SOLVIA</strong><span>Психологічний центр</span><small className="motion-sidebar-version">{pkg.version} · QureMed</small></div>
        </div>

        <WorkspaceNavigation navigation={navigation} role={user.role} page={page} locked={locked} onNavigate={navigate} />

        <div className="sidebar-spacer" />
        <div className="sidebar-actions" aria-label="Налаштування та обліковий запис">
          {user.role === 'admin' && <button aria-label="Налаштування центру" className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><AppIcon name="settings" /><span className="desktop-label">Налаштування центру</span><span className="mobile-label" aria-hidden="true">Система</span></button>}
          <button aria-label="Налаштування профілю" className={`nav-item ${page === 'preferences' ? 'active' : ''}`} onClick={() => navigate('preferences')}><AppIcon name="preferences" /><span className="desktop-label">Налаштування профілю</span><span className="mobile-label" aria-hidden="true">Профіль</span></button>
          <button className="nav-item" onClick={onLogout}><AppIcon name="logout" /><span>Вийти</span></button>
        </div>
        <div className="sidebar-support">
          <div className="sidebar-support-head">
            <span className="support-dot" />
            <div><strong>QureMed Industries</strong><small>Підтримка центру</small></div>
          </div>
          <a href="mailto:quremedindastriessupport@gmail.com">quremedindastriessupport@gmail.com</a>
        </div>
        <div className="user-card">
          <div className="avatar inverse">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="user-copy"><strong>{user.name}</strong><span>{roleLabels[user.role]}</span></div>
        </div>
      </aside>

      <main className="workspace" data-page={page}>
        <header className="mobile-app-header"><button className="mobile-menu-button" aria-label="Відкрити меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><AppIcon name="menu" /><span>Меню</span></button><strong>{activePageLabel}</strong></header>
        {shift?.open && (
          <div className="shift-bar">
            <div><span className="shift-dot" /> Зміна відкрита · {shift.shift_date} · {shift.opened_by_name || 'Адміністратор'}</div>
            <span className="reception-access-status">{receptionAccess?.allowed ? `Реєстратура: доступ з ${receptionAccess.starts_at?.slice(11,16) || '08:00'}` : 'Реєстратура: очікує дозволу'}</span>
            {['admin','reception'].includes(user.role) && !locked && <Button variant="secondary" onClick={()=>setDailyReport(true)}>Підсумок дня</Button>}
            {user.role === 'admin' && <Button variant="secondary" onClick={()=>setAccessDialog(true)}>Керувати доступом</Button>}
          </div>
        )}
        {!shift?.open && user.role==='admin' && <div className="shift-bar"><span>Надайте доступ для початку роботи центру</span><Button onClick={()=>setAccessDialog(true)}>Надати доступ</Button></div>}
        {!locked && <>
          <ReminderBar api={api} role={user.role} />
          <div className="workspace-topbar">
            <div className="topbar-context">
              <div className="workspace-breadcrumb"><small>{roleLabels[user.role]}</small><strong>{activePageLabel}</strong></div>
              <div className={`connection-pill ${health.online ? 'online' : 'offline'}`} title={apiBase}>
                <span className="connection-led" />
                <div><strong>{health.online ? 'Підключено' : 'Немає зв’язку'}</strong><small>{connectionKind === 'VPS' ? 'Віддалений центр' : 'Сервер центру'}</small></div>
              </div>
            </div>
            {user.role==='director' && <Button variant="secondary" onClick={()=>navigate('staff-messages')}>Повідомлення</Button>}
            {user.role !== 'director' && <GlobalSearch api={api} onPatient={openPatient} onNavigate={navigate} />}
            <WorkflowEvents api={api} user={user} apiBase={apiBase} onNavigate={(target,date)=>{if(date)setCalendarFocus(date);navigate(target);}}/>
            <button className="workspace-profile" aria-label="Мій профіль" onClick={()=>navigate('preferences')}><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></span><AppIcon name="preferences"/></button>
          </div>
        </>}
        {bookingIntent && !locked && <AppointmentBooking api={api} initial={bookingIntent} Modal={Dialog} onClose={()=>setBookingIntent(null)} onSaved={booked} onCreatePatient={date=>registerPatient(date,true)} />}
        {dailyReport && !locked && <DailyReport api={api} Modal={Dialog} initialDate={receptionAccess?.access_date || localDate()} onClose={()=>setDailyReport(false)} />}
        {accessDialog && <ReceptionAccess api={api} access={receptionAccess} onChanged={loadShift} onClose={()=>setAccessDialog(false)} />}
        <div className="workspace-inner">
          {bookingResult && <div className="booking-success" role="status"><span>✓ {bookingResult.editing?'Прийом перенесено':'Пацієнта записано'} · {bookingResult.patient} · {bookingResult.date} о {bookingResult.start}</span><button type="button" aria-label="Приховати повідомлення про запис" onClick={()=>setBookingResult(null)}>×</button></div>}
          {shiftError && <div className="alert error">{shiftError}</div>}
          {!shift && page !== 'preferences' && page !== 'staff-messages' && !(user.role === 'admin' && page === 'settings') ? (shiftError ? <Button variant="secondary" onClick={loadShift}>Повторити завантаження зміни</Button> : <Spinner />) : locked && page !== 'preferences' && page !== 'staff-messages' && !(user.role === 'admin' && page === 'settings') ? (
            <section className="shift-gate surface">
              <img src="/solvia-icon.png" alt="SOLVIA" />
              <div className="eyebrow">ДОСТУП ДО РОБОТИ</div>
              <h1>Очікуємо дозволу адміністратора</h1>
              <p>{receptionAccess?.starts_at && receptionAccess.enabled ? `Доступ заплановано з ${receptionAccess.starts_at.replace('T',' ')} за часом сервера.` : 'Адміністратор має надати доступ на сьогодні. Зміна залишається відкритою.'}</p>
              <Button variant="ghost" onClick={loadShift}>Перевірити ще раз</Button>
            </section>
          ) : content}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    try { const p=JSON.parse(localStorage.getItem('solvia_preferences') || '{}');document.documentElement.dataset.reducedMotion=p.reducedMotion?'true':'false';document.documentElement.dataset.compact=p.compact?'true':'false';document.documentElement.dataset.lightweight=lightweightMode(p,navigator.platform,navigator.userAgent)?'true':'false'; } catch {}
  }, []);
  const params = new URLSearchParams(window.location.search);
  const queryBase = params.get('api');
  const appMode = params.get('mode') || 'center';
  const runtimeBase = (window.location.hostname === 'app.solvia.invalid' || window.location.protocol === 'solvia:') ? (appMode === 'server' ? 'http://127.0.0.1:8765' : '') : window.location.origin;
  const [apiBase, setApiBase] = useState(() => queryBase || localStorage.getItem('solvia_api') || params.get('default_api') || runtimeBase);
  const [token, setToken] = useState(() => readPcSession(apiBase));
  const activeToken = useRef(token);
  const [draftSession, setDraftSession] = useState(null);
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
    if (!token) { setBooting(false); return; }
    let cancelled = false, timer;
    async function restoreSession() {
      try {
        const me = await request(apiBase, token, 'GET', '/api/me');
        if (!cancelled && activeToken.current === token) { savePcSession(apiBase,token); setUser(me); }
      } catch (e) {
        if (cancelled || activeToken.current !== token) return;
        if (e.status === 401) {
          clearPcSession();
          activeToken.current = '';
          setToken(''); setUser(null);
        } else {
          // A stopped server does not revoke the employee's existing session.
          timer = setTimeout(restoreSession, 5000);
        }
      } finally { if (!cancelled) setBooting(false); }
    }
    void restoreSession();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [apiBase, token]);

  useEffect(()=>{
    function sharedSession(event){
      if(event.key!=='solvia_pc_session')return;
      if(event.newValue){try{const saved=JSON.parse(event.newValue);if(cleanBase(saved.base)!==cleanBase(apiBase))return;sessionStorage.setItem('solvia_token',saved.token);activeToken.current=saved.token;setToken(saved.token);setUser(null);setDraftSession(null);setBooting(true);}catch{}}
      else{sessionStorage.removeItem('solvia_token');activeToken.current='';setToken('');setUser(null);setDraftSession(null);setBooting(false);}
    }
    window.addEventListener('storage',sharedSession);return()=>window.removeEventListener('storage',sharedSession);
  },[apiBase]);

  async function login(base, result, password) {
    const identity = await draftIdentity(base, result.user, password).catch(() => null);
    setDraftSession(identity);
    localStorage.setItem('solvia_api', base);
    savePcSession(base,result.token);
    activeToken.current = result.token;
    setApiBase(base);
    setToken(result.token);
    setUser(result.user);
  }

  function logout() {
    const previousBase = apiBase;
    const previousToken = token;
    clearPcSession();
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
      const result=await request(apiBase, token, method, path, body);
      const feedback=feedbackFor(method,path,body||{});
      if(feedback&&activeToken.current===token)window.dispatchEvent(new CustomEvent('solvia:feedback',{detail:feedback}));
      return result;
    } catch (e) {
      if (e.status === 401 && activeToken.current === token) {
        clearPcSession();
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
    clearPcSession();
    activeToken.current = '';
    setApiBase(clean);
    setToken('');
    setUser(null);
    setDraftSession(null);
  }

  if (booting) {
    return <div className="boot-screen"><div className="product-mark"><img className="product-logo" src="/solvia-icon.png" alt="SOLVIA" /></div><Spinner /><span>Відкриваємо SOLVIA…</span></div>;
  }

  if (!user) return <Login initialBase={apiBase} onLogin={login} consoleMode={appMode==='server'} />;
  if (appMode === 'server') return <><DesktopUpdateNotice api={api} base={apiBase} token={token} /><ServerConsole api={api} user={user} onLogout={logout} apiBase={apiBase} onSwitchApi={switchApi} /></>;
  return <><DesktopUpdateNotice api={api} base={apiBase} token={token} /><Shell api={api} user={user} onLogout={logout} apiBase={apiBase} onSwitchApi={switchApi} draftSession={draftSession} /></>;
}

