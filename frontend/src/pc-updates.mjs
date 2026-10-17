export const PC_PACKAGE_LIMIT=32*1024*1024;
export function newerVersion(candidate,current){
  const parse=v=>/^\d+\.\d+\.\d+$/.test(v||'')?v.split('.').map(Number):null;
  const a=parse(candidate),b=parse(current);if(!a||!b)return false;
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
export function pcPlatform(navigator,webview=false){
  if(webview)return 'windows';
  const os=navigator.userAgentData?.platform||navigator.platform||'';
  return /win/i.test(os)?'windows':/linux/i.test(os)?'linux':'';
}
export async function packageHash(bytes){
  if(!globalThis.crypto?.subtle)throw new Error('Для перевірки пакета потрібне захищене вікно SOLVIA.');
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function checkedPackage(response,release){
  if(!response.ok)throw new Error('Не вдалося завантажити пакет. Перевірте підключення або ввійдіть знову.');
  if(!Number.isInteger(release.size_bytes)||release.size_bytes<4||release.size_bytes>PC_PACKAGE_LIMIT)throw new Error('Некоректний розмір пакета.');
  const chunks=[];let size=0;const reader=response.body.getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>release.size_bytes||size>PC_PACKAGE_LIMIT)throw new Error('Розмір завантаження не збігається.');chunks.push(value);}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(size!==release.size_bytes||await packageHash(bytes)!==release.sha256)throw new Error('Перевірка пакета не пройшла. Завантажте його ще раз.');
  return bytes;
}
