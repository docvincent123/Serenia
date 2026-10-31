const {chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
execFileSync(process.execPath,['frontend/scripts/materialize-ocr.cjs']);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173'],{stdio:'ignore',cwd:process.cwd()+'/frontend'});
(async()=>{
for(let i=0;i<80;i++){try{await fetch('http://127.0.0.1:5173/test-fixtures/document-photo.html');break;}catch{await new Promise(r=>setTimeout(r,100));}}
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
await page.route('**/ocr/**',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'"}});});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5173')&&!r.url().startsWith('data:'))external.push(r.url());});
await page.goto('http://127.0.0.1:5173/test-fixtures/document-photo.html');
await page.getByRole('table').waitFor();
assert.equal(await page.locator('tbody tr').count(),3);
await page.getByRole('combobox').first().selectOption('arrived');
assert.equal(await page.locator('tbody tr').count(),1);
assert.match(await page.locator('tbody').innerText(),/20 хв/);
await page.getByRole('combobox').first().selectOption('');
await page.getByRole('button',{name:'Прибув',exact:true}).click();
assert((await page.evaluate(()=>window.calls)).some(c=>c.path.endsWith('/arrival')));
const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=700;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#151515';x.font='64px Arial';x.fillText('SOLVIA 12345',90,180);x.fillText('ІНФОРМОВАНА ЗГОДА',90,300);return c.toDataURL('image/png').split(',')[1]});
await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
await page.waitForFunction(()=>document.querySelector('textarea').value.includes('12345'),{},{timeout:60000});
const text=await page.getByRole('textbox',{name:'Розпізнаний текст'}).inputValue();
assert.match(text,/ЗГОДА/);
assert.equal(await page.locator('#error').innerText(),'');
await page.getByRole('checkbox').check();
assert(JSON.parse(await page.locator('#scan-state').innerText()).paper_signed);
await page.getByRole('button',{name:'Повернути ↻'}).click();
assert.equal(JSON.parse(await page.locator('#scan-state').innerText()).paper_signed,false);
await page.setViewportSize({width:390,height:844});
assert(await page.getByRole('table').isVisible());
assert(await page.locator('.reception-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth));
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
console.log('PASS: React table filters, arrival action, waiting timer, photo processing, Ukrainian/English OCR under CSP, signature reset, zero external requests');

await browser.close();server.kill();
})().catch(e=>{console.error(e);server.kill();process.exit(1)});
