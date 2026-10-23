import assert from 'node:assert/strict';
import { cleanBase } from '../frontend/src/connection.mjs';
assert.equal(cleanBase(' https://192.168.1.105:8443/ '), 'https://192.168.1.105:8443');
assert.equal(cleanBase('http://127.0.0.1:8765'), 'http://127.0.0.1:8765');
for (const value of ['', 'http://192.168.1.105:8765', 'https://user:secret@host', 'https://host/api', 'https://host?api=evil', 'file:///tmp/ui', 'https://host/#secret']) {
  assert.throws(() => cleanBase(value), undefined, value);
}
console.log('Connection validation passed');

const {connectionProfile,verifyProfile}=await import('../frontend/src/connection.mjs');
const profile={format:'quremed.solvia.mobile',version:2,api_url:'https://solvia.example.org',server_id:'a'.repeat(64),center:'Центр'};
const parsed=connectionProfile(JSON.stringify(profile));
assert.equal(parsed.base,'https://solvia.example.org');
verifyProfile(parsed,{ok:true,version:'3.0.0',server_id:profile.server_id});
assert.throws(()=>verifyProfile(parsed,{ok:true,version:'3.0.0',server_id:'b'.repeat(64)}));
for(const change of [{version:3},{server_id:''},{api_url:'http://127.0.0.1:8765'},{api_url:'https://user:pass@host'}])assert.throws(()=>connectionProfile(JSON.stringify({...profile,...change})));
assert.throws(()=>connectionProfile(' '.repeat(65537)));
assert.equal(connectionProfile(JSON.stringify({...profile,version:1,server_id:undefined})).serverId,'');
console.log('Connection profiles: identity, legacy compatibility and unsafe inputs passed');
