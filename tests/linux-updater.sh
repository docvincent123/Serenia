#!/usr/bin/env bash
# Uses a fake release server on the disposable Linux installer CI machine.
set -Eeuo pipefail
mock=$(mktemp -d)
trap 'rm -rf "$mock"' EXIT
cat > "$mock/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
while (($#)); do
  if [[ $1 == -o ]]; then output=$2; shift 2; else shift; fi
done
printf '%s' "$MOCK_BODY" > "$output"
printf '%s' "$MOCK_STATUS"
MOCK
chmod +x "$mock/curl"
export PATH="$mock:$PATH" MOCK_STATUS=404 MOCK_BODY='{}'
result=$(/usr/local/sbin/solvia-updater check)
[[ $result == *'Опублікованих випусків'* ]]
export MOCK_STATUS=429
if /usr/local/sbin/solvia-updater check; then echo 'Rate-limited release server was accepted'; exit 1; fi
export MOCK_STATUS=200 MOCK_BODY='{"tag_name":"invalid","assets":[]}'
if /usr/local/sbin/solvia-updater check; then echo 'Invalid release version was accepted'; exit 1; fi
export MOCK_BODY='{"tag_name":"v999.0.0","assets":[{"name":"SOLVIA-999.0.0-Linux-x64.tar.gz","browser_download_url":"https://github.com/docvincent123/Serenia/releases/download/v999.0.0/SOLVIA-999.0.0-Linux-x64.tar.gz"},{"name":"SOLVIA-999.0.0-Linux-x64.tar.gz.sha256","browser_download_url":"https://github.com/docvincent123/Serenia/releases/download/v999.0.0/SOLVIA-999.0.0-Linux-x64.tar.gz.sha256"}]}'
result=$(/usr/local/sbin/solvia-updater check)
[[ $result == *'Update available:'* ]]
printf 'n\n' | /usr/local/sbin/solvia-updater apply > "$mock/cancelled"
[[ $(cat "$mock/cancelled") == *Cancelled* ]]
echo 'Linux updater error, new-release and cancellation scenarios passed'
