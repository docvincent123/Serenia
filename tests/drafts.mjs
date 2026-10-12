import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { draftIdentity, seal, unseal, DraftWriter, readDraft, removeDraft } from '../frontend/src/drafts.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const records = new Map();
globalThis.indexedDB = {
  open() {
    const request = {};
    request.result = {
      close() {},
      transaction() {
        const tx = { objectStore() { return {
          get(id) { const r = { result: records.get(id) }; setImmediate(() => tx.oncomplete()); return r; },
          put(value, id) { records.set(id, value); const r = {}; setImmediate(() => tx.oncomplete()); return r; },
          delete(id) { records.delete(id); const r = {}; setImmediate(() => tx.oncomplete()); return r; }
        }; } };
        return tx;
      }
    };
    setImmediate(() => request.onsuccess()); return request;
  }
};
const identity = await draftIdentity('https://server.example', { id: 11 }, 'test-password-long');
const context = `${identity.scope}|3`;
const sealed = await seal(identity.key, { note: 'private synthetic note' }, context);
assert(!JSON.stringify(sealed).includes('private synthetic note'));
assert.equal((await unseal(identity.key, sealed, context)).note, 'private synthetic note');
await assert.rejects(unseal(identity.key, sealed, `${identity.scope}|4`));
const other = await draftIdentity('https://server.example', { id: 12 }, 'test-password-long');
await assert.rejects(unseal(other.key, sealed, context));

const calls = [], statuses = [];
let fail = true;
const writer = new DraftWriter({ identity, patientId: 3, status: s => statuses.push(s), api: async (...args) => { calls.push(args); if (fail) throw Object.assign(new Error('offline'), { status: 0 }); return { version: 1 }; } });
writer.edit({ note: 'Recovered offline text' });
await writer.flush();
assert.equal(statuses.at(-1), 'offline');
assert.equal((await readDraft(identity, 3)).payload.note, 'Recovered offline text');
fail = false; await writer.flush();
assert.equal(writer.version, 1); assert.equal((await readDraft(identity, 3)).dirty, false);
assert.equal(statuses.at(-1), 'saved');
await writer.stop();

let release;
const racing = new DraftWriter({ identity, patientId: 4, api: () => new Promise(resolve => { release = resolve; }) });
racing.edit({ note: 'first' }); const first = racing.flush();
while (!release) await new Promise(resolve => setImmediate(resolve));
racing.edit({ note: 'newer text typed during request' });
release({ version: 2 }); await first;
assert.equal((await readDraft(identity, 4)).payload.note, 'newer text typed during request');
assert.equal((await readDraft(identity, 4)).dirty, true);
await racing.stop();
const conflict = new DraftWriter({ identity, patientId: 5, status: s => statuses.push(s), api: async () => { throw { status: 409 }; } });
conflict.edit({ note: 'Keep this conflicting text' }); await conflict.flush();
assert.equal(conflict.conflict, true); assert.equal(statuses.at(-1), 'conflict');
assert.equal((await readDraft(identity, 5)).payload.note, 'Keep this conflicting text');
await conflict.stop(); await removeDraft(identity, 3); assert.equal(await readDraft(identity, 3), null);
console.log('PASS: AES-GCM isolation, offline recovery, retry, in-flight edit preservation, conflict protection');
