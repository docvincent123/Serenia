// Navigation is a presentation of the existing role permissions, never an API grant.
const pages = {
  dashboard: 'Огляд центру', calendar: 'Календар', 'waiting-list': 'Лист очікування',
  patients: 'Пацієнти', families: 'Сім’ї', archive: 'Архів', team: 'Команда',
  rooms: 'Кабінети', reports: 'Звіти психологів', workload: 'Навантаження',
  supervisions: 'Супервізії', devices: 'Пристрої', audit: 'Журнал дій'
};
const permissions = {
  admin: Object.keys(pages),
  reception: ['calendar', 'waiting-list', 'patients', 'families', 'archive'],
  psychologist: ['calendar', 'patients', 'reports', 'supervisions'],
  director: ['dashboard', 'workload', 'supervisions']
};
const sections = [
  { id: 'schedule', label: 'Запис і розклад', icon: 'calendar', pages: ['calendar', 'waiting-list'] },
  { id: 'care', label: 'Пацієнти та супровід', icon: 'patients', pages: ['patients', 'families', 'archive'] },
  { id: 'center', label: 'Організація центру', icon: 'team', pages: ['team', 'rooms', 'supervisions'] },
  { id: 'control', label: 'Звіти та контроль', icon: 'workload', pages: ['reports', 'workload', 'devices', 'audit'] }
];
export function navigationFor(role) {
  const allowed = permissions[role] || [];
  const label = key => role === 'psychologist'
    ? ({ calendar: 'Мій календар', patients: 'Мої пацієнти', reports: 'Звіт за зміну', supervisions: 'Мої супервізії' }[key] || pages[key])
    : pages[key];
  return sections.map(section => ({ ...section,
    label: role === 'psychologist' && section.id === 'center' ? 'Професійна підтримка' : section.label,
    items: section.pages.filter(key => allowed.includes(key)).map(key => [key, label(key)])
  })).filter(section => section.items.length);
}
export function flatNavigation(role) {
  return [...((permissions[role] || []).includes('dashboard') ? [['dashboard', pages.dashboard]] : []),
    ...navigationFor(role).flatMap(section => section.items),
    ...(role === 'admin' ? [['settings', 'Налаштування системи']] : [])];
}
