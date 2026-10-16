// Linux desktop defaults to inexpensive compositing; users can override per device.
export function lightweightMode(preferences, platform = '', userAgent = '') {
  if (typeof preferences?.lightweight === 'boolean') return preferences.lightweight;
  return /linux/i.test(platform) && !/android/i.test(userAgent);
}
