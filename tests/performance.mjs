import assert from 'node:assert/strict';
import {lightweightMode} from '../frontend/src/performance.mjs';
assert.equal(lightweightMode({},'Linux x86_64','Mozilla/5.0 (X11; Linux x86_64)'),true);
assert.equal(lightweightMode({},'Linux armv8l','Mozilla/5.0 (Linux; Android 15)'),false);
assert.equal(lightweightMode({},'Win32','Windows'),false);
assert.equal(lightweightMode({lightweight:true},'Win32','Windows'),true);
assert.equal(lightweightMode({lightweight:false},'Linux x86_64','X11'),false);
assert.equal(lightweightMode({lightweight:'false'},'Linux x86_64','X11'),true);
console.log('PASS: Linux desktop default, Android exclusion and explicit per-device performance preference');
