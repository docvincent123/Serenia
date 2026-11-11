"""Real Ed25519 signatures: tampering, wrong centre, expiry and configuration."""
import base64,json,os,pathlib,subprocess,sys,tempfile,time
binary=str(pathlib.Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp);key=p/'private.pem';public=p/'public.pem';doc=p/'license.json'
 subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(key)],check=True)
 subprocess.run(['openssl','pkey','-in',str(key),'-pubout','-out',str(public)],check=True)
 env={**os.environ,'SOLVIA_LICENSE_PUBLIC_KEY':str(public)}
 def status(*args,config=env):return json.loads(subprocess.check_output([binary,*map(str,args)],env=config))
 assert status(config={**env,'SOLVIA_LICENSE_PUBLIC_KEY':'','SOLVIA_LICENSE_REQUIRED':''})['status']=='unmanaged'
 assert status(config={**env,'SOLVIA_LICENSE_PUBLIC_KEY':'','SOLVIA_LICENSE_REQUIRED':'1'})['status']=='publisher_key_required'
 assert status()['status']=='activation_required'
 def sign(expires):
  payload=json.dumps(dict(server_id='a'*64,center='Тестовий центр',license_id='test',expires_at=expires)).encode();(p/'data').write_bytes(payload)
  subprocess.run(['openssl','pkeyutl','-sign','-rawin','-inkey',str(key),'-in',str(p/'data'),'-out',str(p/'sig')],check=True)
  result=dict(format='quremed.solvia.license',payload=base64.b64encode(payload).decode(),signature=base64.b64encode((p/'sig').read_bytes()).decode());doc.write_text(json.dumps(result));return result
 active=sign(int(time.time())+3600)
 assert status(doc)['write_allowed'] is True
 assert status(doc,config={**env,'SOLVIA_LICENSE_PUBLIC_KEY':'','SOLVIA_LICENSE_REQUIRED':''})['write_allowed'] is False
 assert status(doc,'b'*64)['status']=='invalid'
 changed={**active,'payload':base64.b64encode(b'{}').decode()};doc.write_text(json.dumps(changed));assert status(doc)['status']=='invalid'
 changed={**active,'signature':'!!!!'};doc.write_text(json.dumps(changed));assert status(doc)['status']=='invalid'
 sign(int(time.time())-1);assert status(doc)['status']=='expired';assert status(doc)['write_allowed'] is False
 assert status(doc,config={**env,'SOLVIA_LICENSE_PUBLIC_KEY':str(p/'missing')})['status']=='invalid'
print('Centre licensing: cryptographic and access-policy checks passed')

# The publisher GUI and server share the same existing envelope format.
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'publisher'))
from license_core import CATALOG,create_keys,issue_license,calendar_expiry
assert calendar_expiry('')==0
assert calendar_expiry('2027-01-31')==1801432800
catalog=pathlib.Path(__file__).resolve().parents[1]/'src/server/module_catalog.h'
assert json.loads(catalog.read_text().split('R"LEMVORI(',1)[1].split(')LEMVORI"',1)[0])==CATALOG
with tempfile.TemporaryDirectory() as folder:
 p=pathlib.Path(folder);private,public=create_keys('a long test password')
 (p/'public.pem').write_bytes(public)
 envelope,grant=issue_license(private,'a long test password',server_id='a'*64,center='Synthetic center',modules=['clinical'],max_users=35,max_devices=30)
 assert grant['perpetual'] and {'patients','documents','consents','appointments','clinical'} <= set(grant['modules'])
 (p/'license.json').write_text(json.dumps(envelope))
 result=json.loads(subprocess.check_output([binary,str(p/'license.json')],env={**os.environ,'SOLVIA_LICENSE_PUBLIC_KEY':str(p/'public.pem')}))
 assert result['status']=='active' and result['write_allowed'] and result['max_users']==35
 try:issue_license(private,'wrong password',server_id='a'*64,center='Test',modules=[])
 except ValueError:pass
 else:raise AssertionError('Encrypted private key accepted the wrong password')
print('PASS: publisher encrypted private key, perpetual signed entitlement, quotas, dependencies, and real C++ verification')
