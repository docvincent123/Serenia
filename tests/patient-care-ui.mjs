// Exercise calendar actions after a network failure and out-of-order day loads.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
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
 const page=await browser.newPage({viewport:{width:1366,height:900}});
 const errors=[],requests=[];let role='admin',fail=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('solvia_token','synthetic-patient-care'));
 const person={id:10,name:'Тестова Людина',patient_no:'50001',phone:'+380501234567',dob:'1990-01-01',category:'Інше',status:'active',psychologist_id:3,psychologist:'Психолог',family_id:1,family:'Тестова сім’я',family_role:'Учасник',courses:[],consultations:[],documents:[],referrals:[],discharges:[]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;requests.push(path+url.search);let data=[];
  if(path==='/api/me')data={id:role==='psychologist'?3:1,name:'Працівник',role};
  else if(path==='/api/health')data={ok:true,version:'3.1.0'};
  else if(path==='/api/shift-day')data={open:true,shift_date:'2026-11-01'};
  else if(path==='/api/reception-access')data={allowed:true};
  else if(path==='/api/workday/home')data={date:'2026-11-01',counts:{waiting:0,arrived:0,completed:0},next:[]};
  else if(path==='/api/client-status')data={mode:'ready'};
  else if(path==='/api/meta')data={rooms:[{id:1,name:'Кабінет'}],psychologists:[{id:3,name:'Психолог'}],categories:['Інше'],workflow:{}};
  else if(path==='/api/patient-directory')data={items:[person],total:1,page:1,page_size:25};
  else if(path==='/api/patients/10')data=person;
  else if(path==='/api/families')data=[{id:1,name:'Тестова сім’я',member_count:1}];
  else if(path==='/api/patients/10/appointments'){
   if(fail){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тестове відключення'})});return;}
   const history=url.searchParams.get('period')==='history';
   if(history)await new Promise(r=>setTimeout(r,400));
   data={items:[{id:7,start:'2026-11-01T09:00',end:'2026-11-01T10:00',status:'scheduled',kind:'individual',psychologist:'Психолог',room:history?'Історичний кабінет':'Наступний кабінет',completed_at:history?'2026-11-01T10:00':'',can_reschedule:!history}],total:11,page:Number(url.searchParams.get('page')),page_size:10};
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await mkdir('out/design',{recursive:true});
 const primary=page.locator('.focus-nav-primary');
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('heading',{name:'Головна центру',exact:true}).waitFor();
 await primary.getByRole('button',{name:'Пацієнти',exact:true}).click();
 await page.getByRole('button',{name:'Картка',exact:true}).click();
 const tabs=page.getByRole('navigation',{name:'Розділи картки'});
 await tabs.getByRole('button',{name:'Прийоми',exact:true}).click();
 await page.getByText('Наступний кабінет · Індивідуальний прийом',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Далі',exact:true}).click();
 await page.getByText('Сторінка 2 з 2 · 11 прийомів',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Історія',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Перенести',exact:true}).count(),0,'Old appointment action disappears while loading another period');
 await page.getByText('Історичний кабінет · Індивідуальний прийом',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Перенести',exact:true}).count(),0);
 fail=true;await page.getByRole('button',{name:'Наступні',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Тестове відключення'}).waitFor();
 assert.equal(await page.locator('.patient-visit-row').count(),0,'Failed request cannot leave stale visit actions');
 fail=false;await page.getByRole('button',{name:'Повторити',exact:true}).click();
 await page.getByRole('button',{name:'Перенести',exact:true}).waitFor();
 await page.screenshot({path:'out/design/solvia-patient-visits.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.getByRole('button',{name:'Записати на прийом',exact:true}).click();
 const booking=page.getByRole('dialog');await booking.waitFor();await booking.getByText('Тестова Людина',{exact:true}).first().waitFor();
 await booking.getByRole('button',{name:'Закрити',exact:true}).click();
 await page.getByRole('button',{name:'Усі функції центру',exact:true}).click();
 await page.getByRole('button',{name:'Відкрити розділ Сім’ї',exact:true}).click();
 await page.getByRole('button',{name:/Тестова сім’я/}).click();
 await page.getByRole('region',{name:'Учасники сім’ї'}).getByRole('button',{name:'Картка',exact:true}).waitFor();
 assert(requests.some(p=>p.includes('/api/patient-directory?')&&p.includes('family_id=1')&&p.includes('status=all')));
 await page.screenshot({path:'out/design/solvia-family-members.png',fullPage:true});
 assert(!requests.includes('/api/patients'),'Families never fetch the unbounded patient registry');
 role='psychologist';await page.reload();await primary.getByRole('button',{name:'Пацієнти',exact:true}).click();
 await page.locator('.patient-list-card').click();
 await tabs.getByRole('button',{name:'Прийоми',exact:true}).click();
 await page.locator('.patient-visit-row').waitFor();
 assert.equal(await page.getByRole('button',{name:'Записати на прийом',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Перенести',exact:true}).count(),0);
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Patient card and visits fit a mobile screen');
 assert.deepEqual(errors,[]);
 console.log('PASS: patient visits pagination, history, failures, retry, booking preselection, bounded family members and psychologist read-only actions');
}finally{await browser.close();await new Promise(r=>server.close(r));}
