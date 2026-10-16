#!/usr/bin/env python3
"""Client configuration contract; runs without a graphical desktop."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('solvia_linux', 'installer/linux/solvia-linux-app.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for value, expected in [('https://localhost:8443/', 'https://localhost:8443'),
                        (' https://192.168.1.10:8443 ', 'https://192.168.1.10:8443'),
                        ('https://[::1]:8443', 'https://[::1]:8443')]:
    assert module.server_url(value) == expected
for value in ['http://localhost:8765', 'file:///etc/passwd', 'javascript:alert(1)',
              'https://user:secret@localhost', 'https://host/path', 'https://host?q=x',
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
