"""Verify HTTPS-default enrollment with explicit private-LAN HTTP fallback."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
manifest = ET.parse(root / 'android/app/src/main/AndroidManifest.xml').getroot()
android = '{http://schemas.android.com/apk/res/android}'
assert manifest.find('application').get(android + 'usesCleartextTraffic') == 'true'

network = ET.parse(root / 'android/app/src/main/res/xml/network_security_config.xml').getroot()
assert network.find('base-config').get('cleartextTrafficPermitted') == 'true'

kotlin = (root / 'android/app/src/main/java/com/quremed/solvia/MainActivity.kt').read_text()
assert 'if (scheme == "http")' in kotlin
assert 'require(isPrivateIpv4(host))' in kotlin
assert 'scheme == "http" && isPrivateIpv4(host) -> 8765' in kotlin
assert 'scheme == "https" && isPrivateIpv4(host) -> 8443' in kotlin
assert 'json.optString("http_url")' in kotlin
assert 'json.optString("https_url")' in kotlin
assert 'Підключити локально' in kotlin
assert 'Для VPS та інтернету використовуйте HTTPS' in kotlin

for file in ('installer/Setup-Server.ps1', 'installer/Repair-Network.ps1'):
    source = (root / file).read_text(encoding='utf-8-sig')
    assert "preferred = 'https'" in source
    assert "http_url" in source
    http_rules = [
        line for line in source.splitlines()
        if 'New-NetFirewallRule' in line and 'SOLVIA Local HTTP API' in line
    ]
    assert http_rules, f'Missing LocalSubnet HTTP firewall rule in {file}'
    assert all('-LocalPort 8765' in line for line in http_rules)
    assert all('-RemoteAddress LocalSubnet' in line for line in http_rules)
    assert all('-Profile Private' in line for line in http_rules)

linux_service = (root / 'installer/linux/solvia-http.service').read_text()
assert '--host ${SOLVIA_LAN_IP}' in linux_service
assert '--port 8765' in linux_service

linux_install = (root / 'installer/linux/install.sh').read_text()
assert '"preferred":"https"' in linux_install or '"preferred": "https"' in linux_install
assert 'http://{ip}:8765' in linux_install
assert 'HTTP 8765 не відкривайте в інтернет' in linux_install

print('HTTPS remains preferred; HTTP fallback is restricted to private LAN by application and installer policy')
