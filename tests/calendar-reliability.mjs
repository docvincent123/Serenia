// Exercise calendar actions after a network failure and out-of-order day loads.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('frontend/dist');
const server=createServer(async(req,res)=>{
 try{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  const file=path===root?resolve(root,'index.html'):path;
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('solvia_token','synthetic-calendar'));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/me')data={id:1,name:'Тестовий адміністратор',role:'admin'};
  else if(url.pathname==='/api/health')data={ok:true,version:'3.1.0'};
  else if(url.pathname==='/api/shift-day')data={open:true,shift_date:'2026-11-01'};
  else if(url.pathname==='/api/reception-access')data={allowed:true};
  else if(url.pathname==='/api/workday/home')data={date:'2026-11-01',counts:{waiting:0,arrived:0,completed:0},next:[]};
  else if(url.pathname==='/api/client-status')data={mode:'ready'};
  else if(url.pathname==='/api/meta')data={rooms:[{id:1,name:'Кабінет'}],psychologists:[{id:3,name:'Психолог'}]};
  else if(url.pathname==='/api/appointments'){
   const day=url.searchParams.get('date');
   if(day==='2026-11-02'){await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Тестова втрата зв’язку"}'});return;}
   if(day==='2026-11-04')await new Promise(r=>setTimeout(r,600));
   data=[{id:7,start:day+'T09:00',end:day+'T10:00',kind:'individual',status:'scheduled',psychologist_id:3,psychologist:'Психолог',room:'Кабінет',patients:[{id:10,name:'Запис '+day}]}];
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('heading',{name:'Головна центру',exact:true}).waitFor();
 await page.locator('.focus-nav-primary').getByRole('button',{name:'Календар',exact:true}).click();
 await page.getByRole('button',{name:'Список',exact:true}).click();
 const date=page.locator('.date-control');
 await date.fill('2026-11-01');
 await page.getByRole('button',{name:/Запис 2026-11-01/}).click();
 await page.getByRole('button',{name:'Перенести / змінити',exact:true}).waitFor();
 await date.fill('2026-11-02');
 await page.getByText('Тестова втрата зв’язку',{exact:true}).waitFor();
 assert.equal(await page.getByText('Запис 2026-11-01',{exact:true}).count(),0,'Failed new day must hide stale appointments');
 assert.equal(await page.getByRole('button',{name:'Перенести / змінити',exact:true}).count(),0,'Stale appointment must not be editable');
 await page.getByRole('button',{name:'Повторити завантаження',exact:true}).waitFor();
 await Promise.all([page.waitForRequest(r=>r.url().includes('/api/appointments?date=2026-11-04')),date.fill('2026-11-04')]);
 await date.fill('2026-11-05');
 await page.getByText('Запис 2026-11-05',{exact:true}).waitFor();
 await page.waitForTimeout(800);
 assert.equal(await page.getByText('Запис 2026-11-04',{exact:true}).count(),0,'Late day cannot replace the current day');
 assert.deepEqual(errors,[]);
 console.log('PASS: calendar failures hide stale actions; late responses cannot replace the selected day');
}finally{await browser.close();await new Promise(r=>server.close(r));}
