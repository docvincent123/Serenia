import {cleanBase} from './connection.mjs';

// Bound both headers and body reads. A successful HTML/error page is not API data.
export async function request(base, token, method, path, body) {
  const payload = body === undefined && !['GET','HEAD'].includes(method) ? {} : body;
  const headers = {Accept: 'application/json'};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  let response, text;
  try {
    // Tauri calls Rust so LAN HTTPS uses the OS certificate trust store,
    // without depending on CORS or weakening TLS verification.
    if (globalThis.__TAURI__?.core?.invoke) {
      const result = await globalThis.__TAURI__.core.invoke('solvia_api_request', {
        base: cleanBase(base), token: token || null, method, path,
        body: payload === undefined ? null : payload,
      });
      response = { ok: result.status >= 200 && result.status < 300, status: result.status };
      text = result.body;
    } else {
      response = await fetch(`${cleanBase(base)}${path}`, {
        method, headers, redirect: 'error', cache: 'no-store',
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      text = await response.text();
    }
  } catch {
    throw Object.assign(new Error('Немає зв’язку із сервером. Перевірте адресу Linux/Windows-сервера, мережу центру та довіру до його CA-сертифіката.'), {status: 0});
  }
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch {
    throw Object.assign(new Error('Сервер повернув некоректну відповідь. Перевірте адресу SOLVIA та повторіть запит.'), {status: response.ok ? 502 : response.status});
  }
  if (!response.ok) throw Object.assign(new Error(data?.error || `Помилка сервера ${response.status}`), {status: response.status});
  if (!text && response.status !== 204) throw Object.assign(new Error('Сервер повернув порожню відповідь. Повторіть запит.'), {status: 502});
  return data;
}
