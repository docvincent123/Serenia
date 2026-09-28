export function cleanBase(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Вкажіть адресу сервера: https://192.168.1.105:8443'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Для мережевого сервера потрібен HTTPS. HTTP дозволено лише на цьому ПК.');
  }
  if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new Error('Вкажіть лише адресу та порт сервера, без пароля, шляху чи параметрів.');
  }
  return url.origin;
}
