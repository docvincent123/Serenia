"""Exercise first install and reinstall using the production config writer."""
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
helper = root / "deploy/lemvori-care/configure-env.sh"
subprocess.run(["bash", "-n", str(helper)], check=True)

def configure(path):
    return subprocess.run(["bash", str(helper), str(path)], capture_output=True, text=True)

with tempfile.TemporaryDirectory() as folder:
    directory = pathlib.Path(folder)
    env = directory / "server.env"
    result = configure(env)
    assert result.returncode == 0, result.stderr
    defaults = env.read_bytes()
    assert b"LEMVORI_LICENSE_REQUIRED=1\n" in defaults
    assert b"TZ=Europe/Kyiv\n" in defaults
    assert env.stat().st_mode & 0o777 == 0o640
    # Reinstall must preserve the whole file byte-for-byte, including unknown
    # settings and the publisher's custom public key. Nothing is evaluated.
    custom = (b'# Center configuration\nLEMVORI_LICENSE_REQUIRED=1\n'
              b'LEMVORI_LICENSE_PUBLIC_KEY="/etc/center/trusted-public.pem"\n'
              b'TZ=Europe/Kyiv\nEXTRA_OPTION="retain me"\n'
              b'UNTRUSTED="$(touch should-never-run)"\n')
    env.write_bytes(custom)
    before = env.stat()
    assert configure(env).returncode == 0
    assert env.read_bytes() == custom
    assert env.stat().st_ino == before.st_ino
    assert env.stat().st_mtime_ns == before.st_mtime_ns
    assert not (pathlib.Path.cwd() / "should-never-run").exists()
    # Invalid existing paths must be refused, never replaced or followed.
    env.unlink()
    other = directory / "other.env"
    other.write_bytes(custom)
    env.symlink_to(other)
    assert configure(env).returncode != 0
    assert env.is_symlink() and other.read_bytes() == custom
    env.unlink()
    env.symlink_to(directory / "missing")
    assert configure(env).returncode != 0 and env.is_symlink()
    env.unlink()
    env.mkdir()
    assert configure(env).returncode != 0 and env.is_dir()
    env.rmdir()
    env.touch()
    assert configure(env).returncode != 0 and env.stat().st_size == 0
    assert not list(directory.glob(".server.env.*"))
print("PASS: initial defaults, private mode, exact reinstall preservation and invalid-path rejection")
