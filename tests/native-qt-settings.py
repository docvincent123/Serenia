"""Actual Qt settings migration: retain center identity and prefer existing new settings."""
import configparser,os,pathlib,subprocess,sys,tempfile
binary=str(pathlib.Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp);old=root/'QureMed/SOLVIA.conf';new=root/'LemvoriLab/SOLVIA.conf'
    old.parent.mkdir();old.write_text('[server]\nurl=https://127.0.0.1:9\nidentity='+('a'*64)+'\n')
    env=dict(os.environ,XDG_CONFIG_HOME=tmp,QT_QPA_PLATFORM='offscreen',QT_QUICK_BACKEND='software')
    subprocess.run([binary,'--smoke'],env=env,check=True,timeout=15)
    config=configparser.ConfigParser();config.read(new)
    assert config['server']['url']=='https://127.0.0.1:9'
    assert config['server']['identity']=='a'*64
    new.write_text('[server]\nurl=https://127.0.0.1:10\nidentity='+('b'*64)+'\n')
    subprocess.run([binary,'--smoke'],env=env,check=True,timeout=15)
    config.read(new);assert config['server']['url']=='https://127.0.0.1:10';assert config['server']['identity']=='b'*64
print('PASS: native company settings migration preserves center pin and respects configured destination')
