import assert from 'node:assert/strict';
import { cleanBase } from '../frontend/src/connection.mjs';
assert.equal(cleanBase(' https://192.168.1.105:8443/ '), 'https://192.168.1.105:8443');
assert.equal(cleanBase('http://127.0.0.1:8765'), 'http://127.0.0.1:8765');
for (const value of ['', 'http://192.168.1.105:8765', 'https://user:secret@host', 'https://host/api', 'https://host?api=evil', 'file:///tmp/ui', 'https://host/#secret']) {
  assert.throws(() => cleanBase(value), undefined, value);
}
console.log('Connection validation passed');
