"""Real public-key validation and preview/install fingerprint agreement, without root writes."""
import hashlib
import os
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
helper = root / "deploy/lemvori-care/install-publisher-key.sh"
subprocess.run(["bash", "-n", str(helper)], check=True)
with tempfile.TemporaryDirectory() as folder:
    tmp = pathlib.Path(folder)
    private, public, der = tmp / "private.pem", tmp / "public.pem", tmp / "public.der"
    subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(private)], check=True)
    subprocess.run(["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)], check=True)
    subprocess.run(["openssl", "pkey", "-pubin", "-in", str(public), "-outform", "DER", "-out", str(der)], check=True)
    expected = hashlib.sha256(der.read_bytes()).hexdigest()
    def check(file, fingerprint=None):
        args = ["bash", str(helper), "--check", str(file)]
        if fingerprint is not None:
            args.append(fingerprint)
        return subprocess.run(args, capture_output=True, text=True)
    result = check(public, expected)
    assert result.returncode == 0 and result.stdout.strip() == expected, result.stderr
    assert check(public, "0" * 64).returncode != 0
    assert check(private).returncode != 0
    wrong = tmp / "wrong.pem"
    wrong.write_text("-----BEGIN PUBLIC KEY-----\ninvalid\n-----END PUBLIC KEY-----\n")
    assert check(wrong).returncode != 0
    alias = tmp / "alias.pem"
    alias.symlink_to(public)
    assert check(alias).returncode != 0
    rsa = tmp / "rsa.pem"
    subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(tmp / "rsa-private.pem")], check=True, stderr=subprocess.DEVNULL)
    subprocess.run(["openssl", "pkey", "-in", str(tmp / "rsa-private.pem"), "-pubout", "-out", str(rsa)], check=True)
    assert check(rsa).returncode != 0
    wrong.write_bytes(b"x" * 16385)
    assert check(wrong).returncode != 0
    # Exercise provisioning against an isolated filesystem and a fake service
    # manager. Only OS paths/identity are substituted; validation and writes use
    # the production helper, OpenSSL, install, flock and atomic rename.
    config = tmp / "server-config"
    config.mkdir()
    env_file = config / "server.env"
    env_file.write_text('LEMVORI_DATABASE_URL="dbname=synthetic"\nUNRELATED="preserve-me"\n')
    env_file.chmod(0o640)
    binaries = tmp / "bin"
    binaries.mkdir()
    calls = tmp / "service-calls"
    (binaries / "systemctl").write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "'+str(calls)+'"\n')
    (binaries / "systemctl").chmod(0o755)
    sandboxed = tmp / "provision.sh"
    script = helper.read_text().replace('[[ $EUID -eq 0 ]]', '[[ $EUID -eq '+str(os.geteuid())+' ]]')
    script = script.replace('config=/etc/lemvori-care', 'config="'+str(config)+'"')
    script = script.replace('/run/lemvori-care', str(tmp / "run"))
    script = script.replace('-o root -g root', '-o '+str(os.geteuid())+' -g '+str(os.getegid()))
    script = script.replace('-o root -g lemvori-care', '-o '+str(os.geteuid())+' -g '+str(os.getegid()))
    sandboxed.write_text(script)
    def provision(file, fp):
        return subprocess.run(["bash",str(sandboxed),str(file),fp],env={**os.environ,"PATH":str(binaries)+os.pathsep+os.environ["PATH"]},capture_output=True,text=True)
    applied = provision(public, expected)
    assert applied.returncode == 0, applied.stderr
    configured = env_file.read_text()
    assert 'UNRELATED="preserve-me"' in configured and 'dbname=synthetic' in configured
    assert 'LEMVORI_LICENSE_REQUIRED=1' in configured
    assert 'LEMVORI_LICENSE_PUBLIC_KEY='+str(config / "license/publisher.pem") in configured
    assert env_file.stat().st_mode & 0o777 == 0o640
    assert calls.read_text().strip() == 'restart lemvori-care.service'
    assert provision(public, expected).returncode == 0, 'Reinstalling the same key should be safe'
    original = (config / "license/publisher.pem").read_bytes()
    other_private, other_public = tmp / "other-private.pem", tmp / "other-public.pem"
    subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(other_private)],check=True)
    subprocess.run(["openssl","pkey","-in",str(other_private),"-pubout","-out",str(other_public)],check=True)
    other_fp = check(other_public).stdout.strip()
    assert provision(other_public,other_fp).returncode != 0
    assert (config / "license/publisher.pem").read_bytes() == original and env_file.read_text() == configured
print("PASS: Ed25519 validation, pinned fingerprint, private-key rejection, preserved settings and modes, idempotent setup and refusal of key replacement")
