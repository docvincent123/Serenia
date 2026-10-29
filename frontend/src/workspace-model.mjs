export function navFor(role) {
  if (role === 'admin') {
    return [
      ['dashboard', 'Огляд центру'],
      ['shift-workspace', 'Прийоми за зміну'],
      ['handover', 'Передача зміни'],
      ['calendar', 'Календар'],
      ['waiting-list', 'Лист очікування'],
      ['patients', 'Пацієнти'],
      ['families', 'Сім’ї'],
      ['team', 'Команда'],
      ['staff-messages', 'Повідомлення'],
      ['rooms', 'Кабінети'],
      ['reports', 'Звіти психологів'],
      ['discharges', 'Виписки'],
      ['workload', 'Навантаження'],
      ['supervisions', 'Супервізії'],
      ['archive', 'Архів'],
      ['devices', 'Пристрої'],
      ['settings', 'Налаштування'],
      ['audit', 'Журнал дій']
    ];
  }
  if (role === 'reception') return [['shift-workspace', 'Прийоми за зміну'], ['handover', 'Передача зміни'], ['calendar', 'Календар'], ['waiting-list', 'Лист очікування'], ['patients', 'Пацієнти'], ['families', 'Сім’ї'], ['archive', 'Архів']];
  if (role === 'psychologist') return [['calendar', 'Мій календар'], ['patients', 'Мої пацієнти'], ['reports', 'Звіт за зміну'], ['supervisions', 'Мої супервізії']];
  if (role === 'director') return [['dashboard', 'Огляд центру'], ['workload', 'Навантаження'], ['supervisions', 'Супервізії'], ['discharges', 'Виписки'], ['staff-messages', 'Повідомлення']];
  return [];
}


export const navigationGroups = [
  ['overview', 'Огляд', ['dashboard','module-directory']],
  ['appointments', 'Прийоми', ['shift-workspace', 'handover', 'calendar', 'waiting-list', 'tv-calls']],
  ['patients', 'Пацієнти та супровід', ['patients', 'families', 'archive']],
  ['team', 'Команда та кабінети', ['team', 'rooms', 'supervisions', 'staff-messages']],
  ['reports', 'Звіти та аналітика', ['reports', 'workload', 'discharges']],
  ['administration', 'Адміністрування', ['devices', 'audit']]
];
