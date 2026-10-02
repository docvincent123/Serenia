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
const browser = await chromium.launch({ headless: true });
await mkdir('out/design', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let open = true, waiting = [], currentUser = { id:1,name:'Адміністратор · тест',role:'admin' };
  let draft = { version:0,payload:null }, draftOffline = false, loseConsultationResponse = true;
  const consultations = [];
  await page.addInitScript(() => sessionStorage.setItem('solvia_token', 'synthetic-admin-token'));
  const patient = { id: 10, name: 'Тестовий пацієнт', patient_no: '12345', phone: '+380000000000', dob: '1995-01-01', category: 'Інше', status: 'active', psychologist_id: 3 };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    let data = [];
    if (path === '/api/me') data = currentUser;
    else if (path === '/api/login') data = { token:'synthetic-psychologist-token',user:currentUser };
    else if (path === '/api/health') data = { ok:true,version:'2.2.0',platform:'linux' };
    else if (path === '/api/shift-day') data = { open,shift_date:'2026-10-02' };
    else if (path === '/api/stats') data = { total_patients: 24,active_patients:18,archived_patients:6,new_patients:4,consultations:42,avg_duration_minutes:60,active_courses:18,completed_courses:6,signed_documents:24,outgoing_referrals:3,supervisions_completed:2,load:[] };
    else if (path === '/api/settings/center') data = { center_name:'SOLVIA · демонстрація', connection_mode:'local' };
    else if (path === '/api/settings/workflow') data = { opening_time:'09:00',closing_time:'18:00',working_days:'1234567',slot_step_minutes:60,default_duration_minutes:60,session_hours:8 };
    else if (path === '/api/admin/system') data = { database:{name:'solvia',size:'8 MB',version:'16'},counts:{patients:24,consultations:42},backups:[{id:1,action:'verify',status:'success',created:'2026-10-02T10:00',details:'isolated restore checked'}] };
    else if (path === '/api/meta') data = { rooms:[{id:2,name:'Кабінет 1'}],psychologists:[{id:3,name:'Тестовий психолог'}],categories:['Інше'],workflow:{default_duration_minutes:60} };
    else if (path === '/api/patients') data = [patient];
    else if (path === '/api/patients/10') data = { ...patient,courses:[],documents:[],referrals:[],discharges:[],assessments:[],consultations };
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
  await page.goto(base); await page.getByRole('heading',{name:'Огляд центру',exact:true}).waitFor();
  const systemSettings = page.getByRole('button',{name:'Налаштування системи',exact:true});
  const exit = page.getByRole('button',{name:'Вийти',exact:true});
  for (const target of [systemSettings, exit]) {
    const box = await target.boundingBox(); assert(box && box.y >= 0 && box.y+box.height <= 600, 'Account actions must be in the visible viewport');
  }
  await page.screenshot({ path:'out/design/desktop-dashboard.png',fullPage:true });
  await systemSettings.click(); await page.getByRole('heading',{name:'Налаштування SOLVIA',exact:true}).waitFor();
  await page.screenshot({ path:'out/design/desktop-settings.png',fullPage:true });
  // Settings remain accessible even with the shift closed.
  open = false; await page.reload(); await systemSettings.click(); await page.getByRole('heading',{name:'Налаштування SOLVIA',exact:true}).waitFor();
  open = true; await page.reload();
  await page.getByRole('button',{name:'Лист очікування',exact:true}).click();
  await page.getByRole('button',{name:'Додати пацієнта',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Нове очікування'});
  await dialog.locator('select').first().selectOption('10');
  await dialog.getByRole('button',{name:'Додати в очікування',exact:true}).click();
  await page.getByRole('button',{name:patient.name,exact:true}).waitFor();
  await page.screenshot({ path:'out/design/desktop-waiting-list.png',fullPage:true });
  await page.setViewportSize({ width:390,height:844 });
  await page.screenshot({ path:'out/design/mobile-waiting-list.png',fullPage:true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow,false,'No page-wide horizontal overflow at mobile width');
  await exit.click(); await page.locator('input[autocomplete="username"]').waitFor({timeout:1500});
  assert.equal(await page.evaluate(() => sessionStorage.getItem('solvia_token')),null);
  await page.setViewportSize({width:1280,height:800}); currentUser = {id:3,name:'Тестовий психолог',role:'psychologist'};
  await page.locator('input[autocomplete="username"]').fill('synthetic-psychologist');
  await page.locator('input[autocomplete="current-password"]').fill('synthetic-password-long');
  await page.locator('.login-submit').click();
  await page.getByRole('button',{name:'Мої пацієнти',exact:true}).click();
  await page.locator('.patient-list-card').first().click();
  await page.getByRole('button',{name:'+ Консультація',exact:true}).click();
  let consultationDialog = page.getByRole('dialog',{name:'Підсумок консультації',exact:true});
  await consultationDialog.getByLabel('Запис у календарі', {exact:true}).selectOption('7');
  draftOffline = true;
  await consultationDialog.getByLabel('Приватна нотатка',{exact:true}).fill('Синтетична чернетка: тест відновлення після обриву Wi-Fi');
  await page.locator('.draft-status.offline').waitFor();
  await page.screenshot({path:'out/design/desktop-offline-draft.png',fullPage:true});
  await consultationDialog.getByRole('button',{name:'Закрити · залишити чернетку',exact:true}).click();
  draftOffline = false;
  await page.getByRole('button',{name:'+ Консультація',exact:true}).click();
  consultationDialog = page.getByRole('dialog',{name:'Підсумок консультації',exact:true});
  assert.match(await consultationDialog.getByLabel('Приватна нотатка',{exact:true}).inputValue(), /Синтетична чернетка/);
  await page.locator('.draft-status.saved').waitFor();
  await consultationDialog.getByRole('button',{name:'Зберегти консультацію',exact:true}).click();
  await consultationDialog.getByText('Немає зв’язку із сервером.',{exact:false}).waitFor();
  await consultationDialog.getByRole('button',{name:'Зберегти консультацію',exact:true}).click();
  await consultationDialog.waitFor({state:'detached'});
  assert.equal(consultations.length,1,'Lost response retry must not duplicate the consultation');
  assert.deepEqual(errors,[],'No uncaught React runtime errors');
  console.log('PASS: short-screen actions, settings with closed shift, waiting list create, mobile layout, offline logout, encrypted draft recovery and consultation retry');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
