// Only encrypted consultation data is persisted. Passwords and AES keys stay in memory.
export async function draftIdentity(base, user, password) {
  const scope = `${new URL(base).origin}|${user.id}`;
  if (!globalThis.crypto?.subtle) return { scope, key: null };
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode(`SOLVIA-drafts-v1|${scope}`), iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { scope, key };
}

export async function seal(key, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(data)) };
}
export async function unseal(key, value, context) {
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv), additionalData: new TextEncoder().encode(context) }, key, new Uint8Array(value.data));
  return JSON.parse(new TextDecoder().decode(data));
}

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('solvia-encrypted-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storage(mode, id, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      const store = tx.objectStore('drafts');
      const request = mode === 'readonly' ? store.get(id) : value === null ? store.delete(id) : store.put(value, id);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Сховище недоступне'));
    });
  } finally { db.close(); }
}
export async function readDraft(identity, patientId) {
  if (!identity?.key) return null;
  const id = `${identity.scope}|${patientId}`;
  const value = await storage('readonly', id);
  return value ? unseal(identity.key, value, id) : null;
}
export async function writeDraft(identity, patientId, value) {
  if (!identity?.key) throw new Error('Для локальних чернеток увійдіть повторно через HTTPS.');
  const id = `${identity.scope}|${patientId}`;
  await storage('readwrite', id, await seal(identity.key, value, id));
}
export async function removeDraft(identity, patientId) {
  if (identity) await storage('readwrite', `${identity.scope}|${patientId}`, null);
}

// Serializes writes and flushes: edits made while a request is in flight remain dirty.
export class DraftWriter {
  constructor({ identity, patientId, api, version = 0, status = () => {} }) {
    Object.assign(this, { identity, patientId, api, version, status });
    this.queue = Promise.resolve(); this.generation = 0; this.synced = 0; this.conflict = false; this.stopped = false;
  }
  edit(payload) {
    this.payload = structuredClone(payload); const generation = ++this.generation;
    const copy = this.payload;
    this.queue = this.queue.catch(() => {}).then(async () => {
      try { await writeDraft(this.identity, this.patientId, { payload: copy, version: this.version, dirty: true }); this.localSaved = generation; this.status(this.conflict ? 'conflict' : 'local'); }
      catch { this.status(this.conflict ? 'conflict' : 'memory'); }
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 700);
    return generation;
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.flushing) { await this.flushing; if (!this.stopped && !this.conflict && this.synced < this.generation) return this.flush(); return; }
    await this.queue;
    if (this.stopped || this.conflict || !this.payload || this.synced === this.generation) return;
    const generation = this.generation, payload = structuredClone(this.payload);
    this.status('saving');
    this.flushing = (async () => {
      try {
        const result = await this.api('PATCH', `/api/patients/${this.patientId}/draft`, { version: this.version, payload });
        this.version = result.version; this.synced = generation;
        // Serialize against edits so a late acknowledgement cannot overwrite newer text.
        this.queue = this.queue.catch(() => {}).then(async () => {
          try { await writeDraft(this.identity, this.patientId, { payload: this.payload, version: this.version, dirty: this.generation !== generation }); }
          catch { /* Server acknowledgement is authoritative. */ }
        });
        await this.queue;
        this.status(this.synced === this.generation ? 'saved' : 'local');
      } catch (error) {
        if (error.status === 409) { this.conflict = true; this.status('conflict'); }
        else this.status(this.localSaved === this.generation ? 'offline' : 'memory');
      }
    })();
    try { await this.flushing; } finally { this.flushing = null; }
  }
  async stop() {
    clearTimeout(this.timer);
    await this.queue; this.stopped = true; if (this.flushing) await this.flushing;
  }
}
