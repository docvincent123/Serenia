// Actual bundled React UI: cold offline launch, recovery and rejected duplicate login.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('frontend/dist');
const server=createServer(async(req,res)=>{try{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  const file=path===root?resolve(root,'index.html'):path;
  res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try{
  const page=await browser.newPage();let online=false,loginCalls=0;
  await page.route('**/api/**',async route=>{
    if(!online){await route.abort('connectionrefused');return;}
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/health'){await route.fulfill({json:{ok:true,version:'2.5.0'}});return;}
    if(path==='/api/login'){
      loginCalls++;
      await route.fulfill({status:409,json:{error:'Цей обліковий запис уже використовується на іншому пристрої. Спочатку завершіть попередній сеанс або зверніться до системного адміністратора.'}});return;
    }
    await route.fulfill({json:{}});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('solvia_navigation','all'));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'Вхід до SOLVIA'}).waitFor();
  await page.getByTestId('login-server-status').filter({hasText:'Сервер недоступний. Зверніться до системного адміністратора.'}).waitFor({timeout:22000});
  await page.getByPlaceholder('Ваш логін').fill('synthetic-user');
  await page.getByPlaceholder('Введіть пароль').fill('synthetic-password');
  await page.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Сервер недоступний.'}).waitFor();
  online=true;
  await page.getByTestId('login-server-status').filter({hasText:'Сервер доступний. Можна увійти.'}).waitFor({timeout:22000});
  assert.equal(await page.getByPlaceholder('Ваш логін').inputValue(),'synthetic-user');
  await page.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'обліковий запис уже використовується'}).waitFor();
  assert.equal(loginCalls,1);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('solvia_token')),null);
  assert.equal(await page.getByRole('heading',{name:'Вхід до SOLVIA'}).count(),1);
  // Starting while the API is down must not discard a still-valid saved token.
  const restored=await browser.newPage();let restoredOnline=false;
  await restored.addInitScript(()=>sessionStorage.setItem('solvia_token','saved-session-token'));
  await restored.route('**/api/**',async route=>{
    if(!restoredOnline){await route.abort('connectionrefused');return;}
    const path=new URL(route.request().url()).pathname;
    let data=[];
    if(path==='/api/me')data={id:4,name:'Чинний керівник',role:'director'};
    else if(path==='/api/health')data={ok:true,version:'2.5.0'};
    else if(path==='/api/stats')data={load:[],total_patients:0};
    else if(path==='/api/shift-day')data={open:false,shift_date:'2026-10-17'};
    else if(path==='/api/reception-access')data={allowed:false};
    else if(path==='/api/settings/center')data={center_name:'SOLVIA'};
    await route.fulfill({json:data});
  });
  await restored.goto(`http://127.0.0.1:${server.address().port}`);
  await restored.getByRole('heading',{name:'Вхід до SOLVIA'}).waitFor();
  assert.equal(await restored.evaluate(()=>sessionStorage.getItem('solvia_token')),'saved-session-token');
  restoredOnline=true;
  await restored.getByRole('button',{name:'Вийти',exact:true}).waitFor({timeout:22000});
  assert.equal(await restored.evaluate(()=>sessionStorage.getItem('solvia_token')),'saved-session-token');
  await restored.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: local login while offline, recovery without reload, duplicate login stays unauthenticated');
}finally{await browser.close();await new Promise(r=>server.close(r));}
