import assert from 'node:assert/strict';
import {readPcSession,savePcSession,clearPcSession} from '../frontend/src/pc-session.mjs';

function storage(){const map=new Map();return {
  getItem:k=>map.get(k)||null, setItem:(k,v)=>map.set(k,String(v)),
  removeItem:k=>map.delete(k), map
};}
const local=storage(),session=storage();
const previous=globalThis.__TAURI__;
try{
  globalThis.__TAURI__={core:{invoke:()=>{}}};
  local.setItem('solvia_pc_session',JSON.stringify({base:'https://solvia.test',token:'old-token'}));
  assert.equal(readPcSession('https://solvia.test',local,session),'');
  assert.equal(local.getItem('solvia_pc_session'),null);
  savePcSession('https://solvia.test','transient-token',local,session);
  assert.equal(local.getItem('solvia_pc_session'),null);
  assert.equal(readPcSession('https://solvia.test',local,session),'transient-token');
  clearPcSession(local,session);
  assert.equal(session.getItem('solvia_token'),null);
  delete globalThis.__TAURI__;
  savePcSession('https://solvia.test','legacy-token',local,session);
  assert.equal(JSON.parse(local.getItem('solvia_pc_session')).token,'legacy-token');
  assert.equal(readPcSession('https://solvia.test',local,session),'legacy-token');
  clearPcSession(local,session);
  console.log('Tauri ephemeral session and legacy client compatibility passed');
}finally{
  if(previous===undefined)delete globalThis.__TAURI__;
  else globalThis.__TAURI__=previous;
}
