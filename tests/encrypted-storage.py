"""Do not confuse a plain or unknown volume with a verified LUKS device chain."""
from pathlib import Path
import importlib.util,tempfile,subprocess
spec=importlib.util.spec_from_file_location('storage',Path(__file__).resolve().parents[1]/'tools/check-encrypted-storage.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder);plain=root/'plain';plain.mkdir();assert module.encrypted_device(plain) is False
 luks=root/'luks';(luks/'dm').mkdir(parents=True);(luks/'dm/uuid').write_text('CRYPT-LUKS2-synthetic-device')
 assert module.encrypted_device(luks) is True
 lvm=root/'lvm';(lvm/'slaves').mkdir(parents=True);(lvm/'slaves/luks').symlink_to(luks,target_is_directory=True)
 assert module.encrypted_device(lvm) is True
 (plain/'slaves').mkdir();(plain/'slaves/cycle').symlink_to(plain,target_is_directory=True)
 assert module.encrypted_device(plain) is False
 assert module.inspect(root)['state']=='unverified'
subprocess.run(['bash','-n','deployment/create-encrypted-storage.sh'],check=True)
print('PASS: direct LUKS, LVM over LUKS, unknown volumes, cycle handling and provisioning syntax')
