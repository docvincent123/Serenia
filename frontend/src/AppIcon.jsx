import React from 'react';

export default function AppIcon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    'new-patient': <><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v8M15 12h8"/></>,
    'new-booking': <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 16l2.5 2.5L16 13"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 9a7 7 0 0 1 12-2l1.8 5M4 12l1.8 5a7 7 0 0 0 12-2"/></>,
    'arrow-right': <path d="M4 12h16M14 6l6 6-6 6"/>,
    handover: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 9h10M7 13h6M7 17h5M16 15l2 2 3-3"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    'waiting-list': <><rect x="3" y="4" width="12" height="17" rx="2"/><path d="M6 8h6M6 12h5M6 16h3"/><circle cx="17" cy="16" r="5"/><path d="M17 13v3l2 1"/></>,
    documents: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/></>,
    'module-directory': <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    'shift-workspace': <><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 3h6v3H9zM8 11h8M8 16h4M15 16l2 2 4-4"/></>,
    patients: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    families: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M13.5 20a5 5 0 0 1 7.5-4.3"/></>,
    'psychologist-roster': <><circle cx="8" cy="7" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2M16 6h6M16 11h6M16 16h4"/></>,
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
