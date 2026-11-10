"""Exercise the compiled Qt bridge against an isolated HTTPS fixture."""
import json
import pathlib
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVER_ID = "b" * 64


class FixtureServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        if not isinstance(sys.exception(), (BrokenPipeError, ConnectionResetError)):
            super().handle_error(request, client_address)


class Center(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *_):
        pass

    def respond(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        role = self.headers.get("Authorization", "").removeprefix("Bearer ")
        path = self.path.split("?", 1)[0]
        responses = {
            "/api/health": {"ok": True, "server_id": SERVER_ID},
            "/api/me": {"role": role, "name": "Synthetic account"},
            "/api/slots": ["10:15", "14:15"],
            "/api/users": [{"id": 4, "name": "Synthetic staff", "active": True}],
            "/api/services": [{"id": 2, "code": "art", "name": "Арттерапія", "category": "creative", "active": True}],
            "/api/discharges": [{"id": 9, "revision": 2, "workflow_status": "review"}],
            "/api/stats": {"total_patients": 15},
            "/api/mobile-config": {
                "format": "quremed.solvia.mobile", "version": 2, "server_id": SERVER_ID,
                "api_url": f"https://127.0.0.1:{self.server.server_port}",
            },
        }
        if path == "/api/patient-directory":
            from urllib.parse import parse_qs, urlsplit
            params = parse_qs(urlsplit(self.path).query)
            page = int(params.get("page", ["1"])[0])
            if page not in (1, 2):
                return self.respond({"error": "Unexpected register page"}, 400)
            return self.respond({
                "items": [{"id": page, "name": "Пацієнт " + str(page), "patient_no": "TEST" + str(page)}],
                "total": 41, "page": page, "page_size": 25,
            })
        if path in {"/api/users", "/api/mobile-config"} and role != "admin":
            return self.respond({"error": "Forbidden"}, 403)
        self.respond(responses.get(path, {}))

    def body(self):
        return json.loads(self.rfile.read(int(self.headers["Content-Length"])))

    def do_POST(self):
        body = self.body()
        if self.path == "/api/login":
            return self.respond({"token": body["login"]})
        self.requests.append((self.path, body))
        self.respond({"ok": True, "id": 21})

    def do_PATCH(self):
        self.requests.append((self.path, self.body()))
        self.respond({"ok": True})


with tempfile.TemporaryDirectory() as temporary:
    tmp = pathlib.Path(temporary)
    cert, key = tmp / "cert.pem", tmp / "key.pem"
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
        "-keyout", str(key), "-out", str(cert),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with FixtureServer(("127.0.0.1", 0), Center) as server:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            subprocess.run([sys.argv[1], f"https://127.0.0.1:{server.server_port}", str(cert)],
                           check=True, timeout=30)
        finally:
            server.shutdown()
            worker.join()

bookings = [body for path, body in Center.requests if path == "/api/appointments"]
assert len(bookings) == 1, "Double submit must create only one booking"
assert bookings[0]["patient_ids"] == [19] and bookings[0]["client_key"]
assert bookings[0]["start"] == "2026-11-11T10:15" and bookings[0]["end"] == "2026-11-11T11:00"
assert ("/api/discharges/9/workflow", {"action": "return", "revision": 2, "reason": "Уточнити рекомендації"}) in Center.requests
assert ("/api/users/4", {"name": "Test Staff", "role": "reception", "active": True, "primary_service_code": "art"}) in Center.requests
print("PASS: native HTTPS and profile binding, distinct staff/admin roles, slot booking with duplicate-submit protection, director review, and team editing")
