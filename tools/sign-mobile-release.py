#!/usr/bin/env python3
"""Sign the unsigned CI APK using the owner's permanent keystore, then create a server bundle."""
import argparse, hashlib, json, os, pathlib, re, subprocess, zipfile

def main():
    p=argparse.ArgumentParser()
    p.add_argument('apk',type=pathlib.Path)
    p.add_argument('--keystore',type=pathlib.Path,required=True)
    p.add_argument('--credentials',type=pathlib.Path,required=True)
    p.add_argument('--sdk',type=pathlib.Path,required=True)
    p.add_argument('--output',type=pathlib.Path,required=True)
    p.add_argument('--notes',default='Оновлення SOLVIA')
    a=p.parse_args(); credentials=json.loads(a.credentials.read_text());env=os.environ.copy()
    env['SOLVIA_SIGN_PASSWORD']=credentials['password'];a.output.mkdir(parents=True,exist_ok=True)
    tools=a.sdk/'build-tools'/'34.0.0';aligned=a.output/'aligned.tmp.apk';apk=a.output/'SOLVIA-Android.apk'
    subprocess.run([str(tools/'zipalign'),'-f','-p','4',str(a.apk),str(aligned)],check=True)
    subprocess.run([str(tools/'apksigner'),'sign','--ks',str(a.keystore),'--ks-key-alias',credentials['alias'],'--ks-pass','env:SOLVIA_SIGN_PASSWORD','--key-pass','env:SOLVIA_SIGN_PASSWORD','--out',str(apk),str(aligned)],env=env,check=True)
    result=subprocess.check_output([str(tools/'apksigner'),'verify','--print-certs',str(apk)],text=True)
    cert=re.search(r'certificate SHA-256 digest: ([a-f0-9]+)',result).group(1)
    badging=subprocess.check_output([str(tools/'aapt'),'dump','badging',str(apk)],text=True)
    package,code,name=re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",badging).groups()
    if package!='com.quremed.solvia':raise ValueError('Expected the production SOLVIA package')
    manifest={'package_name':package,'version_code':int(code),'version_name':name,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'size_bytes':apk.stat().st_size,'certificate_sha256':cert,'release_notes':a.notes}
    (a.output/'release.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    with zipfile.ZipFile(a.output/f'SOLVIA-{name}-server-update.zip','w',zipfile.ZIP_DEFLATED) as z:
        z.write(apk,'SOLVIA-Android.apk');z.write(a.output/'release.json','release.json')
    aligned.unlink();print(f'Signed SOLVIA {name} ({code}); server bundle created.')

if __name__=='__main__':main()
