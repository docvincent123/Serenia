// Bundle OCR runtime and language data with SOLVIA: no CDN or patient uploads.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const dest=path.join(root,'public','ocr');
fs.mkdirSync(path.join(dest,'core'),{recursive:true});
fs.mkdirSync(path.join(dest,'lang'),{recursive:true});
fs.copyFileSync(require.resolve('tesseract.js/dist/worker.min.js'),path.join(dest,'worker.min.js'));
const core=path.dirname(require.resolve('tesseract.js-core/package.json'));
for(const file of fs.readdirSync(core).filter(f=>f.endsWith('.wasm.js')||f.endsWith('.wasm')))
  fs.copyFileSync(path.join(core,file),path.join(dest,'core',file));
for(const lang of ['ukr','eng']) {
  const source=require('@tesseract.js-data/'+lang);
  fs.copyFileSync(path.join(source.langPath,lang+'.traineddata.gz'),path.join(dest,'lang',lang+'.traineddata.gz'));
}
console.log('Local Ukrainian/English OCR assets prepared.');
