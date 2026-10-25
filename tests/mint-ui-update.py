import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
spec=importlib.util.spec_from_file_location('mint_update','tools/update-mint-ui.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);package=root/'package';package.mkdir();(package/'ui').mkdir()
    (package/'ui/index.html').write_text('new interface')
    (package/'solvia-linux-app.py').write_text('new wrapper SOLVIA 3.0.0')
    manifest={'requires_version':'3.0.0','sha256':{str(p.relative_to(package)):hashlib.sha256(p.read_bytes()).hexdigest() for p in package.rglob('*') if p.is_file()}}
    (package/'manifest.json').write_text(json.dumps(manifest))
    prefix=root/'machine'
    for base in ['opt/solvia','usr/local/lib/solvia']:
        path=prefix/base;(path/'ui').mkdir(parents=True);(path/'ui/index.html').write_text('old interface')
    (prefix/'opt/solvia/VERSION').write_text('3.0.0')
    wrapper=prefix/'usr/local/lib/solvia/solvia-linux-app.py';wrapper.write_text('old wrapper SOLVIA 3.0.0')
    database=prefix/'opt/solvia/data.db';database.write_bytes(b'untouched patient data sentinel')
    backups=module.apply(package,prefix)
    assert len(backups)==2 and all((Path(p)/'index.html').read_text()=='old interface' for p in backups)
    assert database.read_bytes()==b'untouched patient data sentinel'
    assert wrapper.read_text()=='new wrapper SOLVIA 3.0.0'
    (package/'ui/index.html').write_text('corrupted')
    try: module.apply(package,prefix);raise AssertionError('Corrupt payload accepted')
    except ValueError: pass
    assert (prefix/'opt/solvia/ui/index.html').read_text()=='new interface'
    (package/'ui/index.html').write_text('new interface');wrapper.write_text('old client version 2.4')
    try: module.apply(package,prefix);raise AssertionError('Old client accepted')
    except ValueError: pass
print('PASS: both Linux UI locations updated, old UI preserved, database unchanged, corrupt payload and incompatible versions rejected')
