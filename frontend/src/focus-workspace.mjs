// Role-focused navigation is presentation-only. API permissions and all modules remain unchanged.
export const primaryKeysByRole = Object.freeze({
  admin: ['dashboard','shift-workspace','calendar','patients'],
  reception: ['shift-workspace','calendar','patients'],
  psychologist: ['calendar','patients','reports'],
  director: ['dashboard','workload','discharges'],
});
export function focusNavigation(role, navigation) {
  const primaryKeys = new Set(primaryKeysByRole[role] || []);
  const shown = navigation.filter(([key]) => !['module-directory','settings','preferences'].includes(key));
  return {
    primary: shown.filter(([key]) => primaryKeys.has(key)),
    secondary: shown.filter(([key]) => !primaryKeys.has(key)),
    directory: navigation.find(([key]) => key === 'module-directory') || null,
  };
}
