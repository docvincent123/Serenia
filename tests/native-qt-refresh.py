"""Slow HTTPS server: refresh storms, unchanged models, errors and session reset."""
import collections
import json
import os
import pathlib
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Center(BaseHTTPRequestHandler):
    counts = collections.Counter()
    lock = threading.Lock()
    active = 0
    peak = 0

    def log_message(self, *_):
        pass

    def respond(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.respond({"token": "reception"} if self.path == "/api/login" else {"ok": True})

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        with self.lock:
            self.counts[path] += 1
            count = self.counts[path]
        if path == "/api/shift-day":
            with self.lock:
                Center.active += 1
                Center.peak = max(Center.peak, Center.active)
            try:
                time.sleep(0.2)
                return self.respond({"error": "Temporary server error"} if count == 3 else
                                    {"open": True, "shift_date": "2026-11-14"}, 503 if count == 3 else 200)
            finally:
                with self.lock:
                    Center.active -= 1
        responses = {
            "/api/health": {"ok": True, "server_id": "b" * 64},
            "/api/me": {"role": "reception", "name": "Synthetic account"},
            "/api/my-module-permissions": {"blocked_modules": []},
            "/api/center/modules": {"modules": [{"id": "patients", "enabled": True}]},
            "/api/appointments": [{"id": 1}],
            "/api/shift-workspace": [{"id": 1}],
            "/api/workday/home": {"total": 1},
            "/api/meta": {"psychologists": [], "rooms": []},
            "/api/shift-psychologists": {"configured": True, "shift_open": True,
                                         "date": "2026-11-14", "psychologists": []},
        }
        self.respond(responses.get(path, {}))


with tempfile.TemporaryDirectory() as temporary:
    tmp = pathlib.Path(temporary)
    cert, key = tmp / "cert.pem", tmp / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
                    "-keyout", str(key), "-out", str(cert)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with ThreadingHTTPServer(("127.0.0.1", 0), Center) as server:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            subprocess.run([sys.argv[1], f"https://127.0.0.1:{server.server_port}", str(cert)],
                           check=True, timeout=20, env=os.environ.copy())
        finally:
            server.shutdown()
            thread.join()
assert Center.counts["/api/shift-day"] == 6, Center.counts
assert Center.peak == 1, f"Overlapping refresh batches: {Center.peak}"
print("PASS: 200 duplicate refresh triggers coalesced, no unchanged redraws, failure recovery and logout isolation")
