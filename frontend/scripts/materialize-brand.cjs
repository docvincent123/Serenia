const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(root, 'assets', 'solvia-icon.png.b64');
const targetDir = path.join(root, 'frontend', 'public');
const target = path.join(targetDir, 'solvia-icon.png');

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(target, Buffer.from(fs.readFileSync(source, 'utf8').trim(), 'base64'));
console.log('SOLVIA emblem materialized:', target);
