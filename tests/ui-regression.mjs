// Runs against the actual built React bundle, with synthetic API responses only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SOLVIA_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('frontend/dist');
const server = createServer(async (req,res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/') && path !== root) { res.writeHead(403).end(); return; }
    const file = path === root || path.endsWith('/') ? resolve(root, 'index.html') : path;
    res.setHeader('Content-Type', ({'.js':'application/javascript','.css':'text/css','.png':'image/png','.html':'text/html'})[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.SOLVIA_CHROMIUM_EXECUTABLE ? {executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']} : {}) });
await mkdir('out/design', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let dischargePatchCalls=0;
  let dischargeRecord={id:1,patient_name:'Демонстраційний пацієнт',document_no:'2026-12345',date_from:'2026-10-01',date_to:'2026-10-15',author:'Тестовий психолог',revision:1,summary:'Підсумок супроводу',dynamics:'Динаміка',recommendations:'Попередня рекомендація',followup:'Подальший супровід'};
  let staffMessages = [], staffCalls = 0;
  let accessAllowed = true, accessCalls = 0;
  let serviceMode='ready';
  let open = true, waiting = [], currentUser = { id:1,name:'Адміністратор · тест',role:'admin' };
  let draft = { version:0,payload:null }, draftOffline = false, loseConsultationResponse = true;
  const consultations = [];const progress=[];
  const visit = {appointment_id:7,patient_id:10,patient:'Тестовий пацієнт',patient_no:'12345',phone:'+380000000000',category:'Інше',psychologist_id:3,psychologist:'Тестовий психолог',room:'Кабінет 1',kind:'individual',status:'scheduled',start:'2026-10-02T09:00',end:'2026-10-02T10:00',arrived_at:'',completed_at:''};
  let arrivalCalls = 0, closeCalls = 0, reportCalls = 0;
  let readiness = {ready:false,unfinished:[visit],devices:[],unknown_psychologists:[]};
  await page.addInitScript(() => sessionStorage.setItem('solvia_token', 'synthetic-admin-token'));
  const patient = { id: 10, name: 'Тестовий пацієнт', patient_no: '12345', phone: '+380000000000', dob: '1995-01-01', category: 'Інше', status: 'active', psychologist_id: 3 };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    let data = [];
    if(path==='/api/client-status')data={mode:serviceMode,message:'Тестове оновлення сервера',expected_until:Math.floor(Date.now()/1000)+120};
    else if (path === '/api/me') data = currentUser;
    else if(path==='/api/workflow-events') data={cursor:1,events:[{id:1,kind:'patient.arrived',actor_id:2,actor:'Черговий реєстратури',patient_name:'ЦЕ_ПРИВАТНЕ_ПІБ',created:'2026-10-15T09:00'}]};
    else if (path === '/api/login') data = { token:'synthetic-psychologist-token',user:currentUser };
    else if(path==='/api/search') {
      const q=url.searchParams.get('q');
      if(q==='late-global')await new Promise(resolve=>setTimeout(resolve,900));
      data={patients:[{...patient,name:q==='late-global'?'Застарілий глобальний результат':'Актуальний глобальний результат'}],families:[],rooms:[],users:[]};
    }
    else if (path === '/api/health') data = { ok:true,version:'2.3.0',platform:'linux' };
    else if (path === '/api/shift-day') { if(method === 'POST' && route.request().postDataJSON().action === 'close') { closeCalls++; open = false; } data = { open,shift_date:'2026-10-02' }; }
    else if(path === '/api/reception-access') {if(method==='POST'){accessCalls++;accessAllowed=route.request().postDataJSON().enabled!==false;}data={access_date:'2026-10-15',starts_at:'2026-10-15T08:00',enabled:accessAllowed,allowed:accessAllowed};}
    else if(path==='/api/discharges') data=[dischargeRecord];
    else if(path==='/api/discharges/1/history') data=[];
    else if(path==='/api/discharges/1'&&method==='PATCH') {const body=route.request().postDataJSON();assert.equal(body.revision,1);assert.equal(body.reason,'Уточнення рекомендацій');dischargePatchCalls++;dischargeRecord={...dischargeRecord,...body,revision:2};data=dischargeRecord;}
    else if(path === '/api/workday/home')data={date:'2026-10-02',counts:{waiting:2,arrived:0,completed:1},active_patients:18,waiting_list:0,next:[{appointment_id:7,patient_id:10,patient:'Тестовий пацієнт',patient_no:'12345',start:'2026-10-02T09:00',end:'2026-10-02T10:00',psychologist:'Тестовий психолог',room:'Кабінет 1',arrived_at:''}]};
    else if (path === '/api/stats') data = { total_patients: 24,active_patients:18,archived_patients:6,new_patients:4,consultations:42,avg_duration_minutes:60,active_courses:18,completed_courses:6,signed_documents:24,outgoing_referrals:3,supervisions_completed:2,load:[] };
    else if(path === '/api/shift-readiness') data=readiness;
    else if(path === '/api/shift-reports') { if(method === 'POST') { reportCalls++; const body=route.request().postDataJSON(); assert.equal(body.shift_date,'2026-10-02','Report must use active shift date, not device calendar date'); data={id:1,consultations_count:3}; } }
    else if (path === '/api/mobile-update') data = { available:false };
    else if (path === '/api/mobile-config') data = { format:'quremed.solvia.mobile',version:2,server_id:'a'.repeat(64),api_url:'https://solvia.example.test',https_url:'https://solvia.example.test',preferred:'https' };
    else if (path === '/api/settings/center') data = { center_name:'SOLVIA · демонстрація', connection_mode:'local' };
    else if (path === '/api/settings/workflow') data = { opening_time:'09:00',closing_time:'18:00',working_days:'1234567',slot_step_minutes:60,default_duration_minutes:60,session_hours:8 };
    else if (path === '/api/admin/system') data = { database:{name:'solvia',size:'8 MB',version:'16'},counts:{patients:24,consultations:42},backups:[{id:1,action:'verify',status:'success',created:'2026-10-02T10:00',details:'isolated restore checked'}] };
    else if (path === '/api/meta') data = { rooms:[{id:2,name:'Кабінет 1'}],psychologists:[{id:3,name:'Тестовий психолог'}],categories:['Інше'],workflow:{default_duration_minutes:60} };
    else if (path === '/api/shift-workspace') data = [{...visit}, {...visit,appointment_id:8,patient_id:11,patient:'Учасник групи · завершено',completed_at:'2026-10-02T09:50',kind:'group'}, {...visit,appointment_id:8,patient_id:12,patient:'Учасник групи · очікує',kind:'group'}];
    else if (path === '/api/appointments/7/arrival' && method === 'POST') { ++arrivalCalls; visit.arrived_at='2026-10-02T08:55'; data={ok:true}; }
    else if (path === '/api/patient-directory') {
      const q=url.searchParams.get('q'), page=Number(url.searchParams.get('page'));
      if(q==='network-failure') { await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тестова втрата зв’язку'})});return; }
      if(q==='late-result') await new Promise(resolve=>setTimeout(resolve,900));
      const p=q==='late-result'?{...patient,name:'Застаріла відповідь'}:patient;
      data={items:[p],total:q?1:26,page,page_size:25};
    }
    else if (path === '/api/patients') data = [patient];
    else if (path === '/api/patients/10') data = { ...patient,courses:[],documents:[],referrals:[],discharges:[],assessments:[],consultations };
    else if(path==='/api/patients/10/progress') {
      if(method==='POST'){progress.unshift({...route.request().postDataJSON(),id:1,author:'Тестовий психолог',created:'2026-10-14T10:00'});data={id:1};}else data=progress;
    }
    else if(path==='/api/consultations/44/addenda'&&method==='POST') {const b=route.request().postDataJSON();consultations[0].addenda=[{...b,id:1,author:'Тестовий психолог',created:'2026-10-14T10:00'}];data={id:1};}
    else if(path==='/api/staff/recipients') data=[{id:3,name:'Тестовий психолог',phone:'+380501234567',devices:[{device_id:'synthetic',device_name:'Тестовий телефон',online:true}]}];
    else if(path==='/api/staff/messages') {
      if(method==='POST'){staffCalls++;const b=route.request().postDataJSON();staffMessages.unshift({...b,id:staffCalls,created:'2026-10-14T10:00',delivered_at:null,read_at:null});data={id:staffCalls};} else data=staffMessages;
    }
    else if(path==='/api/admin/devices') data=[{user_id:3,device_id:'synthetic',device_name:'Тестовий телефон',name:'Тестовий психолог',version_code:34,version_name:'3.2.0',last_seen:'2026-10-14T10:00',last_sync:'2026-10-14T09:59',pending_count:2,blocked_count:0,fresh:false}];
    else if(path==='/api/users') data=[{id:3,name:'Тестовий психолог',role:'psychologist',active:true}];
    else if (path === '/api/patients/10/draft') {
      if (method === 'PATCH') {
        if (draftOffline) { await route.abort('failed'); return; }
        const b = route.request().postDataJSON();
        if (b.version !== draft.version) { await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Conflict'})}); return; }
        draft = { version:draft.version+1,payload:b.payload };
      }
      data = draft;
    } else if (path === '/api/appointments') data = [{id:7,start:(url.searchParams.get('date') || '2026-10-02')+'T09:00',end:'2026-10-02T10:00',kind:'individual',status:'confirmed',psychologist:'Тестовий психолог',room:'Кабінет 1',patients:[patient]}];
    else if (path === '/api/consultations' && method === 'POST') {
      const body = route.request().postDataJSON();
      if (!consultations.length) consultations.push({ ...body,id:44,created:'2026-10-02T10:00',psychologist:'Тестовий психолог' });
      assert.equal(body.client_key,consultations[0].client_key);
      if (loseConsultationResponse) { loseConsultationResponse = false; await route.abort('failed'); return; }
      data = { id:44,already_saved:true };
    }
    else if (path === '/api/waiting-list' && method === 'GET') data = waiting;
    else if (path === '/api/waiting-list' && method === 'POST') {
      const body = route.request().postDataJSON(); waiting.push({ ...body,id:1,patient:patient.name,patient_no:patient.patient_no,phone:patient.phone,psychologist:'Тестовий психолог',status:'waiting',version:1 }); data = { id:1 };
    } else if (path === '/api/logout') { await route.abort('timedout'); return; }
    await route.fulfill({ contentType:'application/json',body:JSON.stringify(data) });
  });
  await page.goto(base); await page.getByRole('heading',{name:'Головна центру',exact:true}).waitFor();
  serviceMode='maintenance';
  await page.reload();
  const maintenance=page.getByRole('dialog',{name:'Сервер на оновленні',exact:true});
  await maintenance.waitFor();
  await page.screenshot({path:'out/design/server-maintenance.png',fullPage:true});
  await maintenance.getByRole('button',{name:'Згорнути повідомлення',exact:true}).click();
  await page.getByRole('heading',{name:'Головна центру',exact:true}).waitFor();
  serviceMode='ready';
  await page.reload();
  await page.getByRole('heading',{name:'Головна центру',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Сервер на оновленні',exact:true}).count(),0);
  const studioHeader=page.locator('.studio-header');
  assert.equal(await studioHeader.locator('img.studio-mark[src="/solvia-icon.png"]').count(),1,'The supplied SOLVIA logo appears in the desktop header');
  const shiftStatus=page.locator('.shift-bar').first();
  assert.equal(await page.locator('.studio-tabs').count(),0,'Tabs removed');
  assert.equal(await page.locator('.workspace-topbar').count(),0,'Old toolbar removed');
  assert.equal(await studioHeader.locator('.global-search-wrap').count(),1,'Search in header');
  assert.equal(await studioHeader.locator('.workflow-bell').count(),1,'Bell in header');
  assert.equal(await page.locator('.connection-pill').count(),0,'Status pill removed');
  await page.locator('.focus-nav-primary').getByRole('button',{name:'Календар',exact:true}).click();
  await page.getByRole('heading',{name:'Календар центру',exact:true}).waitFor();
  await page.getByRole('button',{name:'Назад до попереднього розділу'}).click();
  await page.getByRole('heading',{name:'Головна центру',exact:true}).waitFor();
  assert.equal(await page.locator('.studio-back-row').count(),0,'No back button on initial home');
  const globalSearch=page.getByRole('textbox',{name:'Пошук у центрі',exact:true});
  await globalSearch.fill('late-global');
  await page.waitForRequest(req=>new URL(req.url()).pathname==='/api/search');
  await globalSearch.fill('fresh-global');
  await page.getByText('Актуальний глобальний результат',{exact:true}).waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.getByText('Застарілий глобальний результат',{exact:true}).count(),0,'Global search ignores old responses');
  await globalSearch.fill('');
  await page.locator('.search-popover').waitFor({state:'hidden'});
  assert.equal(await page.locator('.focus-nav-primary').getByRole('button',{name:'Прийоми',exact:true}).count(),1,'Shift operations are always one click away');
  assert.equal(await page.locator('.focus-nav-primary button').count(),4,'Minimal desktop navigation');
  assert.equal(await page.getByRole('button',{name:'Інші функції центру',exact:true}).count(),1,'Other functions stay discoverable');
  assert.equal(await page.locator('.center-home').getByText('ЦЕ_ПРИВАТНЕ_ПІБ').count(),0,'Home is not a clinical or audit feed');
  assert.equal(await page.locator('.center-home-metric').count(),3,'Daily status is compact');
  assert.equal(await page.locator('.center-home-action').count(),4,'Four clear quick actions for staff');
  assert.equal(await page.locator('.center-home-intro .center-home-primary').count(),1,'One primary command');
  await page.locator('.center-home-visit').first().waitFor();
  await page.getByText(/Оновлено о/).waitFor();
  await page.route('**/api/workday/home',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Оновити дані головної сторінки'}).click();
  await page.locator('.center-home .alert.error').waitFor();
  assert.equal(await page.locator('.center-home-visit').count(),0,'No stale appointments during disconnection');
  await page.unroute('**/api/workday/home');
  await page.getByRole('button',{name:'Оновити дані головної сторінки'}).click();
  await page.locator('.center-home-visit').first().waitFor();
  assert.equal(await page.locator('.center-home .alert.error').count(),0,'Appointments refresh when server returns');

  const systemSettings = page.getByRole('button',{name:'Налаштування центру',exact:true});
  const exit = page.getByRole('button',{name:'Вийти',exact:true});
  for (const target of [systemSettings, exit]) {
    const box = await target.boundingBox(); assert(box && box.y >= 0 && box.y+box.height <= 600, 'Account actions must be in the visible viewport');
  }
  await page.screenshot({ path:'out/design/desktop-dashboard.png',fullPage:true });
  assert.equal(await page.locator('.sidebar').getByRole('button',{name:'Налаштування профілю',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Завершити зміну',exact:true}).count(),0);
  await page.getByRole('button',{name:'Керувати доступом',exact:true}).click();
  const accessDialog=page.getByRole('dialog',{name:'Доступ реєстратури',exact:true});
  await accessDialog.getByLabel('Доступ з',{exact:true}).fill('08:17');
  await accessDialog.getByRole('button',{name:'Надати доступ',exact:true}).click();
  await accessDialog.waitFor({state:'hidden'});
  assert.equal(accessCalls,1);assert.equal(closeCalls,0,'Reception authorization must never close the clinical shift');

  await page.getByRole('button',{name:'Інші функції центру',exact:true}).click();
  await page.getByRole('button',{name:'Відкрити розділ Повідомлення',exact:true}).click();
  await page.getByRole('heading',{name:'Повідомлення психологам',exact:true}).waitFor();
  await page.getByRole('button',{name:/Тестовий психолог/}).click();
  await page.getByLabel('Куди надіслати',{exact:true}).selectOption('synthetic');
  await page.getByLabel('Повідомлення',{exact:true}).fill('Пацієнт прибув. Зверніться до реєстратури.');
  await page.getByRole('button',{name:'Надіслати повідомлення',exact:true}).click();
  await page.getByText('Очікує отримання',{exact:true}).waitFor();
  assert.equal(staffCalls,1);assert.equal(staffMessages[0].recipient_id,3);assert.equal(staffMessages[0].device_id,'synthetic');
  staffMessages[0].delivered_at='2026-10-14T10:01';staffMessages[0].read_at='2026-10-14T10:02';
  await page.getByText('✓✓ Прочитано',{exact:true}).waitFor();
  await page.setViewportSize({width:1366,height:900});
  await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.workspace')?.scrollTo(0,0);});
  await page.screenshot({path:'out/design/desktop-messages.png',fullPage:true});
  await page.setViewportSize({width:1280,height:600});
    await systemSettings.click(); await page.getByRole('heading',{name:'Налаштування SOLVIA',exact:true}).waitFor();
  await page.screenshot({ path:'out/design/desktop-settings.png',fullPage:true });
  assert.equal(await page.locator('.settings-nav').getByRole('button',{name:/Оновлення Android/}).count(),0);
  await page.goto(base+'/?mode=server');
  await page.getByRole('button',{name:'Оновлення Android',exact:true}).click();
  await page.getByRole('heading',{name:'Оновлення Android',exact:true}).waitFor();
  await page.getByLabel('Опис випуску — release.json',{exact:true}).setInputFiles({name:'release.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version_code:32,version_name:'3.1.0',package_name:'com.quremed.solvia',sha256:'a'.repeat(64)}))});
  await page.getByLabel('Підписаний APK',{exact:true}).setInputFiles({name:'app.apk',mimeType:'application/vnd.android.package-archive',buffer:Buffer.from('PK synthetic')});
  const publication=page.waitForRequest(r=>r.url().endsWith('/api/mobile-update')&&r.method()==='POST');
  await page.getByRole('button',{name:'Опублікувати оновлення телефона',exact:true}).click();
  const published=JSON.parse((await publication).postData());
  assert.equal(published.version_code,32);assert.equal(Buffer.from(published.apk_base64,'base64').toString(),'PK synthetic');
  await page.getByText('Оновлення опубліковано на сервері центру.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Налаштування сервера',exact:true}).click();
  await page.locator('.settings-nav').getByRole('button',{name:/Підключення/}).click();
  const configDownload = page.waitForEvent('download');
  await page.getByRole('button',{name:'Файл для Android / ПК',exact:true}).click();
  const downloaded = await configDownload;
  assert.equal(downloaded.suggestedFilename(),'SOLVIA-Mobile.solvia');
  const config = JSON.parse(await readFile(await downloaded.path(),'utf8'));
  assert.equal(config.api_url,'https://solvia.example.test');
  assert.equal(config.server_id,'a'.repeat(64));
  assert.equal(config.format,'quremed.solvia.mobile');
  // Settings remain accessible even with the shift closed.
  open = false; await page.goto(base); await systemSettings.click(); await page.getByRole('heading',{name:'Налаштування SOLVIA',exact:true}).waitFor();
  open = true; await page.reload();
  await page.locator('.focus-navigation').getByRole('button',{name:'Прийоми',exact:true}).click();
  await page.getByRole('heading',{name:'Прийоми за зміну',exact:true}).waitFor();
  await page.locator('.shift-visit').first().waitFor();
  assert.equal(await page.locator('.shift-visit').count(),2,'Completed group participant must not remain active');
  await page.locator('.shift-visit').first().click();
  await page.getByRole('button',{name:'Пацієнт прибув',exact:true}).click();
  await page.locator('.shift-detail .visit-status.arrived').waitFor();
  assert.equal(arrivalCalls,1);
  await page.getByRole('button',{name:'Проконсультовані',exact:true}).click();
  assert.equal(await page.locator('.shift-visit').count(),1);
  await page.screenshot({path:'out/design/desktop-shift-completed.png',fullPage:true});
  await page.getByRole('button',{name:'Активні',exact:true}).click();
  await page.getByLabel('Знайти пацієнта',{exact:true}).fill('12345');
  assert.equal(await page.locator('.shift-visit').count(),2);
  assert.equal(await page.getByRole('button',{name:/Дата і психолог/}).getAttribute('aria-expanded'),'false');
  await page.getByRole('button',{name:/Дата і психолог/}).click();
  await page.getByLabel('Психолог',{exact:true}).selectOption('3');
  await page.screenshot({path:'out/design/desktop-shift-active.png',fullPage:true});
  await page.locator('.shift-visit').first().click();
  await page.getByRole('button',{name:'Відкрити картку пацієнта',exact:true}).click();
  await page.getByRole('button',{name:'← До списку',exact:true}).click();
  await page.getByRole('heading',{name:'Прийоми за зміну',exact:true}).waitFor();
  await page.locator('.focus-navigation').getByRole('button',{name:'Головна',exact:true}).click();
  await page.getByRole('button',{name:'Інші функції центру',exact:true}).click();
  await page.getByRole('button',{name:'Відкрити розділ Лист очікування',exact:true}).click();
  await page.getByRole('button',{name:'+ Додати в очікування',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Нове очікування'});
  await dialog.locator('select').first().selectOption('10');
  await dialog.getByRole('button',{name:'Додати в очікування',exact:true}).click();
  await page.getByRole('button',{name:patient.name,exact:true}).waitFor();
  await page.screenshot({ path:'out/design/desktop-waiting-list.png',fullPage:true });
  await page.setViewportSize({ width:390,height:844 });
  await page.screenshot({ path:'out/design/mobile-waiting-list.png',fullPage:true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow,false,'No page-wide horizontal overflow at mobile width');
  await page.getByRole('button',{name:'Відкрити меню',exact:true}).click();
  await exit.click(); await page.locator('input[autocomplete="username"]').waitFor({timeout:1500});
  await page.screenshot({path:'out/design/mobile-login.png',fullPage:true});
  assert.equal(await page.evaluate(() => sessionStorage.getItem('solvia_token')),null);
  await page.setViewportSize({width:1280,height:800}); currentUser = {id:3,name:'Тестовий психолог',role:'psychologist'};
  await page.screenshot({path:'out/design/desktop-login.png',fullPage:true});
  await page.locator('input[autocomplete="username"]').fill('synthetic-psychologist');
  await page.locator('input[autocomplete="current-password"]').fill('synthetic-password-long');
  await page.locator('.login-submit').click();
  await page.locator('.focus-navigation').getByRole('button',{name:'Пацієнти',exact:true}).click();
  await page.getByText('Знайдено: 26',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Наступна',exact:true}).click();
  await page.getByText('Сторінка 2 з 2',{exact:true}).waitFor();
  const directorySearch=page.getByRole('textbox',{name:'Пошук пацієнтів',exact:true});
  await directorySearch.fill('network-failure');
  await page.getByRole('alert').filter({hasText:'Тестова втрата зв’язку'}).waitFor();
  assert.equal(await page.locator('.patient-list-card').count(),0,'Failed search cannot leave actionable stale patients');
  await directorySearch.fill('late-result');
  await page.waitForRequest(req=>req.url().includes('/api/patient-directory?')&&new URL(req.url()).searchParams.get('q')==='late-result');
  await directorySearch.fill('Тестовий');
  await page.getByText('Знайдено: 1',{exact:true}).waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.getByText('Застаріла відповідь',{exact:true}).count(),0,'Old network response cannot replace current search');
  await page.getByText('Сторінка 1 з 1',{exact:true}).waitFor();
  await page.screenshot({path:'out/design/desktop-patient-directory.png',fullPage:true});
  await page.locator('.patient-list-card').first().click();
  await page.getByRole('button',{name:'+ Консультація',exact:true}).click();
  let consultationDialog = page.getByRole('dialog',{name:'Підсумок консультації',exact:true});
  await consultationDialog.waitFor({timeout:5000});
  await page.screenshot({path:'out/design/desktop-consultation-form.png',fullPage:true});
  await consultationDialog.getByLabel('Запис у календарі', {exact:true}).selectOption('7');
  await consultationDialog.getByRole('button',{name:'3. Робота',exact:true}).click();
  draftOffline = true;
  await consultationDialog.getByLabel('Приватна нотатка',{exact:true}).fill('Синтетична чернетка: тест відновлення після обриву Wi-Fi');
  await consultationDialog.getByLabel('Виконана робота',{exact:true}).fill('Робота за синтетичним сценарієм');
  await page.locator('.draft-status.offline').waitFor();
  await page.screenshot({path:'out/design/desktop-offline-draft.png',fullPage:true});
  await consultationDialog.getByRole('button',{name:'Закрити · залишити чернетку',exact:true}).click();
  draftOffline = false;
  await page.getByRole('button',{name:'+ Консультація',exact:true}).click();
  consultationDialog = page.getByRole('dialog',{name:'Підсумок консультації',exact:true});
  assert.match(await consultationDialog.getByLabel('Приватна нотатка',{exact:true}).inputValue(), /Синтетична чернетка/);
  await page.locator('.draft-status.saved').waitFor();
  await consultationDialog.getByRole('button',{name:'5. Ризики',exact:true}).click();
  await consultationDialog.getByRole('button',{name:'Зберегти консультацію',exact:true}).click();
  await consultationDialog.getByText('Немає зв’язку із сервером.',{exact:false}).waitFor();
  await consultationDialog.getByRole('button',{name:'Зберегти консультацію',exact:true}).click();
  await consultationDialog.waitFor({state:'detached'});
  assert.equal(consultations.length,1,'Lost response retry must not duplicate the consultation');
  await page.getByRole('button',{name:'Записи',exact:true}).click();
  await page.locator('.consultation-record summary').click();
  await page.getByText('Робота за синтетичним сценарієм',{exact:true}).waitFor();
  await page.screenshot({path:'out/design/desktop-full-consultation.png',fullPage:true});
  const originalNote=consultations[0].note;
  await page.getByRole('button',{name:'Додати уточнення',exact:true}).click();
  await page.getByLabel('Причина',{exact:true}).fill('Уточнення синтетичного запису');
  await page.getByLabel('Текст уточнення',{exact:true}).fill('Додаткове спостереження без зміни оригіналу');
  await page.getByRole('button',{name:'Зберегти доповнення',exact:true}).click();
  await page.locator('.record-addenda blockquote').getByText('Додаткове спостереження без зміни оригіналу',{exact:true}).waitFor();
  assert.equal(consultations[0].note,originalNote);
  await page.screenshot({path:'out/design/desktop-addendum.png',fullPage:true});
  await page.getByRole('button',{name:'Супровід',exact:true}).click();
  await page.getByLabel('Ціль або рекомендація',{exact:true}).fill('Синтетична ціль');
  await page.getByLabel('Стан',{exact:true}).selectOption('achieved');
  await page.getByLabel('Спостереження',{exact:true}).fill('Синтетична оцінка виконання');
  await page.getByRole('button',{name:'Зберегти оцінку',exact:true}).click();
  await page.locator('.progress-entry').getByText('Синтетична оцінка виконання',{exact:true}).waitFor();
  await page.screenshot({path:'out/design/desktop-progress.png',fullPage:true});
  await page.locator('.focus-navigation').getByRole('button',{name:'Звіти',exact:true}).click();
  await page.getByLabel('Підсумок роботи за зміну',{exact:true}).fill('Підсумок зміни, що тривала після опівночі');
  await page.getByRole('button',{name:'Зберегти звіт за зміну',exact:true}).click();
  await page.getByText('Звіт за зміну збережено.',{exact:false}).waitFor();
  assert.equal(reportCalls,1);
  currentUser={id:1,name:'Тестовий адміністратор',role:'admin'};await page.reload();
  await page.locator('.focus-navigation').getByRole('button',{name:'Головна',exact:true}).click();
  await page.getByRole('button',{name:'Інші функції центру',exact:true}).click();
  await page.getByRole('button',{name:'Відкрити розділ Пристрої',exact:true}).click();
  await page.getByRole('heading',{name:'Стан телефонів',exact:true}).waitFor();
  await page.getByText('○ Поточний стан невідомий',{exact:true}).waitFor();
  await page.screenshot({path:'out/design/desktop-device-health.png',fullPage:true});
  for(const role of ['reception','director']) {
    currentUser = {id:role === 'reception' ? 2 : 4,name:'Тестова роль',role};
    await page.reload();
    await page.getByRole('button',{name:'Налаштування профілю',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Налаштування центру',exact:true}).count(),0,'Center administration must not be in other role menus');
    if(role === 'director') {assert.equal(await page.getByRole('button',{name:'Пацієнти',exact:true}).count(),0,'Director must not get patient navigation');assert.equal(await page.getByRole('button',{name:'Відкрити вкладку Пацієнти',exact:true}).count(),0,'Director must not get a clinical workspace tab');}
    if(role === 'reception') {
      await page.getByRole('heading',{name:'Реєстратура',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'+ Консультація',exact:true}).count(),0);
    }
    await page.screenshot({path:`out/design/desktop-${role}.png`,fullPage:true});
    if(role==='director'){
      await page.getByRole('button',{name:'Виписки',exact:true}).click();
      await page.getByRole('button',{name:'Редагувати',exact:true}).click();
      const editor=page.getByRole('dialog',{name:'Редагування виписки',exact:true});
      await editor.getByLabel('Рекомендації',{exact:true}).fill('Уточнена рекомендація');
      await editor.getByLabel('Причина редагування',{exact:true}).fill('Уточнення рекомендацій');
      await page.screenshot({path:'out/design/desktop-discharge-editor.png',fullPage:true});
      await editor.getByRole('button',{name:'Зберегти зміни',exact:true}).click();
      await editor.waitFor({state:'hidden'});
      assert.equal(dischargePatchCalls,1);assert.equal(dischargeRecord.recommendations,'Уточнена рекомендація');
      await page.getByText(/версія 2/).waitFor();
    }

  }
  currentUser={id:1,name:'Тестовий адміністратор',role:'admin'};
  await page.reload();
  accessAllowed=false;currentUser={id:2,name:'Реєстратура',role:'reception'};await page.reload();
  await page.getByRole('heading',{name:'Очікуємо дозволу адміністратора',exact:true}).waitFor();
  assert.equal(closeCalls,0,'Shift remains open while reception waits for permission');
  currentUser={id:1,name:'Тестовий адміністратор',role:'admin'};await page.reload();
  await systemSettings.click();
  await page.getByRole('heading',{name:'Налаштування SOLVIA',exact:true}).waitFor();
  assert.deepEqual(errors,[],'No uncaught React runtime errors');
  const fresh=await browser.newPage();
  await fresh.route('**/api/**',async route=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({ok:true,version:'3.1.0',server_id:'a'.repeat(64),mode:'ready'})}));
  await fresh.goto(base);
  await fresh.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).waitFor();
  assert.equal(await fresh.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).isDisabled(),true,'New workstation requires its center file');
  assert.equal(await fresh.getByLabel('Адреса сервера центру',{exact:true}).count(),0,'No manual API field in employee setup');
  const connectionFile={format:'quremed.solvia.mobile',version:2,server_id:'b'.repeat(64),https_url:'https://synthetic-center.invalid',center:'Тестовий центр'};
  const upload=async()=>fresh.locator('input[type=file]').first().setInputFiles({name:'center.solvia',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(connectionFile))});
  await upload();await fresh.getByRole('alert').filter({hasText:'інший сервер'}).waitFor();
  connectionFile.server_id='a'.repeat(64);await upload();
  await fresh.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).waitFor({state:'visible'});
  await fresh.waitForFunction(()=>localStorage.getItem('solvia_api')==='https://synthetic-center.invalid');
  await fresh.reload();
  await fresh.getByText('Замінити файл підключення',{exact:true}).waitFor();
  assert.equal(await fresh.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).isEnabled(),true,'Imported connection persists after restart');
  await fresh.screenshot({path:'out/design/connection-file-once.png',fullPage:true});await fresh.close();
  console.log('PASS: four role workspaces, daily reception access with persistent shift, shift-bound report date, short-screen actions, settings without reception authorization, waiting list, mobile layout, offline logout, encrypted drafts and consultation retry');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

