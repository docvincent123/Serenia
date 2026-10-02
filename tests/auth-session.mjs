import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../frontend/src/App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function login(base, result, password) {');
assert(start >= 0, 'Login implementation must be found');
const functions = source.slice(start, source.indexOf('\n  if (booting) {'));
const calls = [];
const pending = [];
const context = vm.createContext({
  apiBase: 'https://server.example', token: 'old-session', activeToken: { current: 'old-session' },
  localStorage: { setItem() {} },
  sessionStorage: { setItem() {}, removeItem(key) { calls.push(['remove', key]); } },
  setApiBase(value) { calls.push(['base', value]); },
  setToken(value) { calls.push(['token', value]); },
  setUser(value) { calls.push(['user', value]); },
  setBooting(value) { calls.push(['booting', value]); },
  draftIdentity: async () => null,
  setDraftSession() {},
  request(...args) { calls.push(['request', ...args]); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  cleanBase: value => value,
});
vm.runInContext(functions, context);
// An offline server must not delay returning to login or clearing the local session.
context.logout();
assert(calls.some(([kind, value]) => kind === 'token' && value === ''));
assert(calls.some(([kind, value]) => kind === 'user' && value === null));
assert.equal(context.activeToken.current, '');
assert.equal(calls.find(([kind]) => kind === 'request')[2], 'old-session');
pending.shift().reject(new Error('offline'));
await new Promise(resolve => setImmediate(resolve));

// A late 401 from the previous account cannot sign out the newly logged-in account.
const staleRequest = context.api('GET', '/api/shift-day').catch(error => error);
await context.login('https://server.example', { token: 'new-session', user: { name: 'New user' } }, 'test-password');
calls.length = 0;
pending.shift().reject({ status: 401 });
await staleRequest;
assert.equal(context.activeToken.current, 'new-session');
assert.equal(calls.length, 0);

// A 401 belonging to the current account does return that account to login.
context.token = 'new-session';
const currentRequest = context.api('GET', '/api/shift-day').catch(error => error);
pending.shift().reject({ status: 401 });
await currentRequest;
assert.equal(context.activeToken.current, '');
assert(calls.some(([kind, value]) => kind === 'user' && value === null));
console.log('PASS: immediate offline logout, original session revocation, stale/current 401 isolation');
