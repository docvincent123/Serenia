// The shipped TV page, with synthetic data and an API stub (no real patient data).
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('frontend/dist');
const server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const path=resolve(root,pathname==='/tv'?'tv/index.html':'.'+pathname);
  if(!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');
  res.end(await readFile(path));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE}:{})});
try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage();
  let paired=false,offline=false,revoked=false;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const entries=Array.from({length:14},(_,i)=>({appointment_id:i+1,patient_id:i+10,patient:`Тестовий пацієнт ${i+1}`,psychologist:'Тестова Олена Василівна',room:'Кабінет 12',start:'2026-10-18T14:30',end:'2026-10-18T15:30',state:i===0?'called':'scheduled',called_at:i===0?1:0}));
  await context.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(offline){await route.abort();return;}
    if(path==='/api/tv/pair'){await route.fulfill({json:{token:'a'.repeat(64),code:'123456',expires_in:600}});return;}
    assert.equal(request.headers().authorization,'Bearer '+'a'.repeat(64));
    if(revoked){await route.fulfill({status:401,json:{error:'Доступ відкликано'}});return;}
    if(path==='/api/tv/pairing'){await route.fulfill({json:{paired}});return;}
    assert.equal(path,'/api/tv/schedule');
    await route.fulfill({json:{server_time:'2026-10-18T14:30:00',server_epoch:1792323000,date:'2026-10-18',center:'Тестовий центр SOLVIA',display_name:'Хол',message:'Останні новини центру\nНова група підтримки щоп’ятниці',page_seconds:6,entries}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tv`);
  await page.getByRole('button',{name:'Отримати код підключення'}).click();
  await page.getByText('123456',{exact:true}).waitFor();
  paired=true;
  await page.locator('.tv-call').getByText('Тестовий пацієнт 1',{exact:true}).waitFor();
  assert.equal(await page.locator('.tv-ticker-track').evaluate(el=>getComputedStyle(el).animationName),'news-scroll');
  await page.getByRole('heading',{name:'Записи до психологів'}).waitFor();
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(200);
    const last=await page.locator('.tv-row').last().boundingBox(),footer=await page.locator('.tv-footer').boundingBox();
    assert(last.y+last.height<=footer.y,'All rows must fit above the news ticker');
    assert(footer.y+footer.height<=viewport.height,'News ticker fits the TV viewport');
  }
  const before=await page.locator('.tv-row').first().textContent();
  await page.waitForFunction(text=>document.querySelector('.tv-row')?.textContent!==text,before);
  await mkdir('out/design',{recursive:true});await page.screenshot({path:'out/design/solvia-tv-720p.png'});
  offline=true;
  await page.getByText('З’єднання із сервером втрачено',{exact:true}).waitFor();
  assert.equal(await page.locator('.tv-row').count(),0,'No stale patient names during outages');
  offline=false;await page.locator('.tv-row').first().waitFor();
  revoked=true;
  await page.getByRole('button',{name:'Отримати код підключення'}).waitFor();
  assert.equal(await page.locator('.tv-row').count(),0);
  assert.deepEqual(errors,[]);
  await context.close();console.log('PASS: TV pairing, API authorization, live calls, news ticker, 720p/1080p pagination, outages and revoked access');
}finally{await browser.close();await new Promise(r=>server.close(r));}
