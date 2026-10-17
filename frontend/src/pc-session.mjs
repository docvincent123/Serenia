import {cleanBase} from './connection.mjs';
const key='solvia_pc_session';
export function readPcSession(base, local=localStorage, session=sessionStorage) {
  try { const saved=JSON.parse(local.getItem(key)||'null'); if(saved) return cleanBase(saved.base)===cleanBase(base) && typeof saved.token==='string'?saved.token:''; } catch {}
  return session.getItem('solvia_token')||'';
}
export function savePcSession(base,token,local=localStorage,session=sessionStorage) {
  local.setItem(key,JSON.stringify({base:cleanBase(base),token}));session.setItem('solvia_token',token);
}
export function clearPcSession(local=localStorage,session=sessionStorage) {
  local.removeItem(key);session.removeItem('solvia_token');
}
