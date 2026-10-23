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

export function connectionProfile(text) {
  if (new TextEncoder().encode(text).length > 65536) throw new Error('Файл підключення завеликий.');
  const profile = JSON.parse(text);
  if (profile.format !== 'quremed.solvia.mobile' || ![1, 2].includes(profile.version)) throw new Error('Непідтримуваний файл SOLVIA.');
  const base = cleanBase(profile.https_url || profile.api_url);
  if (!base.startsWith('https://')) throw new Error('Файл центру має містити HTTPS-адресу.');
  if (profile.version === 2 && !/^[a-f0-9]{64}$/.test(profile.server_id || '')) throw new Error('У файлі відсутній ідентифікатор сервера.');
  return {base, serverId: profile.server_id || '', center: String(profile.center || 'SOLVIA')};
}
export function verifyProfile(profile, health) {
  if (health.ok !== true || !health.version) throw new Error('Сервер SOLVIA недоступний.');
  if (profile.serverId && profile.serverId !== health.server_id) throw new Error('Це інший сервер SOLVIA. Отримайте правильний файл у адміністратора.');
}
