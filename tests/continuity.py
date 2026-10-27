"""Exercise durable retry and checksum behavior without contacting a real VPS."""
import hashlib
import importlib.machinery
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

loader=importlib.machinery.SourceFileLoader('continuity',str(Path(__file__).resolve().parents[1]/'installer/linux/solvia-continuity'))
spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)

class Continuity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);m.STATE=self.root/'state';m.STATE.mkdir();m.CONFIG=self.root/'offsite.json'
        self.archive=self.root/'verified.dump';self.archive.write_bytes(b'PGDMP synthetic verified data')
        self.digest=hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.events=[]
        self.patch=patch.object(m,'event',side_effect=lambda *a:self.events.append(a));self.patch.start();self.addCleanup(self.patch.stop)
    def config(self):
        password=self.root/'password';password.write_text('synthetic-secret');password.chmod(0o600)
        m.CONFIG.write_text(json.dumps({'repository':'sftp:backup@example.test:/srv/backups','password_file':str(password)}));m.CONFIG.chmod(0o600)
    def job(self):return json.loads(next(m.STATE.glob('*.json')).read_text())
    def test_missing_remote_preserves_local_pending_archive(self):
        m.enqueue(self.archive,self.digest);m.send_pending()
        self.assertTrue(self.archive.exists());self.assertEqual(self.job()['state'],'pending')
        self.assertEqual(self.events[-1][2],'failed')
    def test_failed_transfer_retries_and_records_remote_confirmation(self):
        self.config();m.enqueue(self.archive,self.digest)
        with patch.object(m,'run',side_effect=RuntimeError('offline')):m.send_pending()
        self.assertEqual(self.job()['attempts'],1);self.assertEqual(self.job()['state'],'pending')
        path=next(m.STATE.glob('*.json'));job=self.job();job['retry_at']=0;m.write_json(path,job)
        with patch.object(m,'run',return_value='{"message_type":"summary","snapshot_id":"verified-snapshot"}') as run:
            m.send_pending();self.assertEqual(run.call_args.args[0][0:2],['restic','backup'])
        self.assertEqual(self.job()['state'],'success');self.assertEqual(self.job()['snapshot_id'],'verified-snapshot')
        with patch.object(m,'run') as run:m.send_pending();run.assert_not_called()
        self.assertTrue(self.archive.exists())
    def test_changed_archive_cannot_be_uploaded(self):
        self.config();m.enqueue(self.archive,self.digest);self.archive.write_bytes(b'corrupted')
        with patch.object(m,'run') as run:m.send_pending();run.assert_not_called()
        self.assertEqual(self.job()['state'],'pending');self.assertEqual(self.events[-1][2],'failed')
    def test_insecure_secret_permissions_rejected(self):
        self.config();m.CONFIG.chmod(0o644)
        with self.assertRaises(RuntimeError):m.configuration()
    def test_nightly_schedule_is_explicit_kyiv_midnight(self):
        timer=(Path(__file__).resolve().parents[1]/'installer/linux/solvia-nightly.timer').read_text()
        self.assertIn('OnCalendar=*-*-* 00:00:00 Europe/Kyiv',timer);self.assertIn('Persistent=true',timer)
    def profile_generator(self):
        source=(Path(__file__).resolve().parents[1]/'installer/linux/install.sh').read_text()
        return re.search(r"<<'PYCONFIG'\n(.*?)\nPYCONFIG",source,re.S).group(1)
    def test_profile_generation_pins_identity(self):
        target=self.root/'center.solvia';identity='a'*64
        subprocess.run([sys.executable,'-','192.168.1.50',str(target),identity],input=self.profile_generator(),text=True,check=True)
        profile=json.loads(target.read_text())
        self.assertEqual(profile['version'],2);self.assertEqual(profile['server_id'],identity)
        self.assertEqual(profile['https_url'],'https://192.168.1.50:8443')
    def test_upgrade_preserves_stable_dns_but_refreshes_literal_lan_ip(self):
        target=self.root/'center.solvia';identity='a'*64
        target.write_text(json.dumps({'format':'quremed.solvia.mobile','version':2,'server_id':identity,'https_url':'https://center.example.test'}))
        subprocess.run([sys.executable,'-','192.168.1.99',str(target),identity],input=self.profile_generator(),text=True,check=True)
        self.assertEqual(json.loads(target.read_text())['https_url'],'https://center.example.test')
        target.write_text(json.dumps({'format':'quremed.solvia.mobile','version':2,'server_id':identity,'https_url':'https://192.168.1.20:8443'}))
        subprocess.run([sys.executable,'-','192.168.1.99',str(target),identity],input=self.profile_generator(),text=True,check=True)
        self.assertEqual(json.loads(target.read_text())['https_url'],'https://192.168.1.99:8443')

    def test_running_shift_recovered_only_after_archive_queued(self):
        statements=[]
        def query(statement,**kw):
            statements.append(statement)
            return '[{"id":7,"archive_path":""}]' if statement.startswith('SELECT') else ''
        with patch.object(m,'sql',side_effect=query),patch.object(m,'snapshot',return_value=(self.archive,self.digest)):
            m.shift_jobs()
        self.assertEqual(self.job()['state'],'pending')
        self.assertIn("state IN ('pending','running','failed')",statements[0])
        self.assertIn("state='success'",statements[-1])
    def test_backup_failure_keeps_shift_retryable(self):
        statements=[]
        def query(statement,**kw):
            statements.append(statement);return '[{"id":7,"archive_path":""}]' if statement.startswith('SELECT') else ''
        with patch.object(m,'sql',side_effect=query),patch.object(m,'snapshot',side_effect=RuntimeError('disk full')):m.shift_jobs()
        self.assertIn("state='failed'",statements[-1]);self.assertFalse(list(m.STATE.glob('*.json')))

if __name__=='__main__':unittest.main()
