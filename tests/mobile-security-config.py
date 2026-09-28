"""Guard SOLVIA's Android installer and enrollment flow against plaintext HTTP."""
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
manifest = ET.parse(root / 'android/app/src/main/AndroidManifest.xml').getroot()
android = '{http://schemas.android.com/apk/res/android}'
assert manifest.find('application').get(android + 'usesCleartextTraffic') == 'false'
network = ET.parse(root / 'android/app/src/main/res/xml/network_security_config.xml').getroot()
assert network.find('base-config').get('cleartextTrafficPermitted') == 'false'

kotlin = (root / 'android/app/src/main/java/com/quremed/solvia/MainActivity.kt').read_text()
assert 'require(scheme == "https")' in kotlin
assert 'json.optString("https_url").ifBlank { json.optString("api_url") }' in kotlin
assert 'server.startsWith("http://", ignoreCase = true)' in kotlin

for file in ('installer/Setup-Server.ps1', 'installer/Repair-Network.ps1'):
    source = (root / file).read_text(encoding='utf-8-sig')
    assert "preferred = 'https'" in source
    assert "http://' + $serverIp + ':8765" not in source
    assert "http://' + $ip + ':8765" not in source
    assert not any('New-NetFirewallRule' in line and '8765' in line for line in source.splitlines())
print('Android and generated mobile config are HTTPS-only')
