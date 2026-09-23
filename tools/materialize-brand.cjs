const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const encoded = fs.readFileSync(path.join(root, 'assets', 'solvia-icon.png.b64'), 'utf8').trim();
const png = Buffer.from(encoded, 'base64');

function ensure(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

ensure(path.join(root, 'assets', 'solvia-icon.png'), png);
ensure(path.join(root, 'frontend', 'public', 'solvia-icon.png'), png);
ensure(path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable', 'solvia_icon.png'), png);

// ICO with one PNG-compressed 64x64 image.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(64, 6);
header.writeUInt8(64, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
ensure(path.join(root, 'assets', 'solvia.ico'), Buffer.concat([header, png]));

console.log('SOLVIA 2.0 brand assets materialized.');
