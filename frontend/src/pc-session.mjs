import {cleanBase} from './connection.mjs';

const key='solvia_pc_session';
const sessionKey='solvia_token';
const nativeDesktop=()=>Boolean(globalThis.__TAURI__?.core?.invoke);

// Never persist a medical session token in localStorage on Tauri.
// Tauri uses a per-window ephemeral session, requiring fresh login after app exit.
// Legacy WebView2 behaviour remains unchanged pending its separate replacement.
export function readPcSession(base, local=localStorage, session=sessionStorage) {
  if(nativeDesktop()) {
    local.removeItem(key); // purge any previous persistent native session
    return session.getItem(sessionKey)||'';
  }
  try {
    const saved=JSON.parse(local.getItem(key)||'null');
    if(saved)return cleanBase(saved.base)===cleanBase(base)&&typeof saved.token==='string'?saved.token:'';
  } catch {}
  return session.getItem(sessionKey)||'';
}
export function savePcSession(base,token,local=localStorage,session=sessionStorage) {
  const validated=cleanBase(base);
  if(nativeDesktop()){
    local.removeItem(key);
  }else{
    local.setItem(key,JSON.stringify({base:validated,token}));
  }
  session.setItem(sessionKey,token);
}
export function clearPcSession(local=localStorage,session=sessionStorage) {
  local.removeItem(key);
  session.removeItem(sessionKey);
}
