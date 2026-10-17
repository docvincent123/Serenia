#!/usr/bin/env python3
"""Client configuration contract; runs without a graphical desktop."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('solvia_linux', 'installer/linux/solvia-linux-app.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for value, expected in [('HTTPS://SOLVIA.CENTER:8443/', 'https://solvia.center:8443'),
                        ('https://SOLVIA.CENTER:443/', 'https://solvia.center'),
                        ('https://localhost:8443/', 'https://localhost:8443'),
                        (' https://192.168.1.10:8443 ', 'https://192.168.1.10:8443'),
                        ('https://[::1]:8443', 'https://[::1]:8443')]:
    assert module.server_url(value) == expected
for value in ['http://localhost:8765', 'file:///etc/passwd', 'javascript:alert(1)',
              'https://user:secret@localhost', 'https://@localhost', 'https://host/path', 'https://host?q=x',
              'https://host/#token', 'https://', 'https://host:bad', 'https://ho st',
              'https://host\\evil', 'https://host\nname']:
    try:
        module.server_url(value)
    except ValueError:
        pass
    else:
        raise AssertionError(f'Unexpected address accepted: {value!r}')
launcher = Path('installer/linux/solvia-admin-app').read_text()
assert 'exec /usr/bin/python3 /usr/local/lib/solvia/solvia-linux-app.py' in launcher
assert not any(name in launcher for name in ['google-chrome', 'chromium', 'xdg-open', 'firefox'])
source = Path('installer/linux/solvia-linux-app.py').read_text()
assert 'TLSErrorsPolicy.FAIL' in source
assert 'allow_tls_certificate_for_host' not in source
print('PASS: HTTPS-only server origins, credential/path rejection, dedicated launcher and strict TLS configuration')

import tempfile
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory)
    (root/'index.html').write_text('local login')
    assert module.local_asset(root, 'solvia://app/index.html?api=ignored') == (b'local login','text/html')
    for uri in ['solvia://app/../outside','solvia://app/%2e%2e/outside','solvia://evil/index.html','file:///etc/passwd']:
        try: module.local_asset(root,uri)
        except ValueError: pass
        else: raise AssertionError(uri)
    (root/'escape').symlink_to('/etc/passwd')
    try: module.local_asset(root,'solvia://app/escape')
    except ValueError: pass
    else: raise AssertionError('symlink escaped UI root')
print('PASS: local UI assets and traversal/symlink rejection')
