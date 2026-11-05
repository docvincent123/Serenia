import assert from 'node:assert/strict';
import {request} from '../frontend/src/request.mjs';

const originalFetch = globalThis.fetch;
const originalTauri = globalThis.__TAURI__;
try {
  let calls = [];
  globalThis.fetch = () => { throw Error('Native Tauri transport must not use browser fetch'); };
  globalThis.__TAURI__ = {
    core: { invoke: async (name, args) => {
      calls.push({name, args});
      return {status: 200, body: '{"ok":true,"version":"3.1.1"}'};
    }}
  };
  assert.deepEqual(await request('https://192.168.1.105:8443', '', 'GET', '/api/health'),
    {ok:true,version:'3.1.1'});
  assert.equal(calls[0].name, 'solvia_api_request');
  assert.equal(calls[0].args.body, null);
  assert.equal(calls[0].args.base, 'https://192.168.1.105:8443');

  globalThis.__TAURI__.core.invoke = async () => ({status:401,body:'{"error":"Unauthorized"}'});
  await assert.rejects(() => request('https://localhost:8443','bad','GET','/api/me'),
    error => error.status === 401);

  globalThis.__TAURI__.core.invoke = async () => { throw Error('untrusted TLS'); };
  await assert.rejects(() => request('https://localhost:8443','','GET','/api/me'),
    error => error.status === 0);

  delete globalThis.__TAURI__;
  globalThis.fetch = async (url,options) => {
    assert.equal(url,'http://127.0.0.1:8765/api/health');
    assert.equal(options.redirect,'error');
    return {status:200,ok:true,text:async()=> '{"ok":true}'};
  };
  assert.deepEqual(await request('http://127.0.0.1:8765','','GET','/api/health'),{ok:true});
  console.log('SOLVIA Rust/Tauri transport and browser fallback passed');
} finally {
  globalThis.fetch = originalFetch;
  if(originalTauri === undefined) delete globalThis.__TAURI__;
  else globalThis.__TAURI__ = originalTauri;
}
