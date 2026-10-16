#!/usr/bin/python3
"""Real WebKitGTK smoke test after tests/linux-install.sh, under Xvfb.
Tests trusted HTTPS React rendering, native reconnect UI and untrusted TLS refusal.
"""
import importlib.util
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, WebKit2

failures = []
with tempfile.TemporaryDirectory(prefix='solvia-native-test-') as directory:
    root = Path(directory)
    for key in ('XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'):
        os.environ[key] = str(root/key)
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-keyout', str(root/'key.pem'), '-out', str(root/'cert.pem'),
                    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'<html><body>UNTRUSTED SERVER MUST NOT RENDER</body></html>')
        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(root/'cert.pem'), str(root/'key.pem'))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    spec = importlib.util.spec_from_file_location('solvia_native', 'installer/linux/solvia-linux-app.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    phase = 'login'
    busy = False
    printed = False
    app = None

    def failed(message):
        failures.append(message)
        app.quit()

    def ready(application):
        global app
        app = application
        # Native GTK window and dedicated WebKit widget, not a subprocess browser.
        assert app.window.get_title() == 'SOLVIA'
        assert isinstance(app.view, WebKit2.WebView)
        assert app.view.get_website_data_manager().get_tls_errors_policy() == WebKit2.TLSErrorsPolicy.FAIL
        app.view.connect('print', printing)
        GLib.timeout_add(250, poll)
        GLib.timeout_add_seconds(45, lambda: failed('Native client smoke test timed out'))
        return False

    def printing(view, operation):
        global printed
        assert isinstance(operation, WebKit2.PrintOperation)
        printed = True
        return True  # Test print availability without opening a blocking system dialog.

    def poll():
        global busy, phase
        if phase == 'login' and not busy and not app.view.is_loading():
            if app.stack.get_visible_child_name() == 'error':
                failed('Trusted localhost certificate rejected: ' + app.message.get_text())
                return False
            busy = True
            def rendered(view, result, _):
                global busy, phase
                try:
                    text = view.evaluate_javascript_finish(result).to_string()
                    if 'Вхід до SOLVIA' not in text:
                        busy = False
                        return
                    phase = 'print'
                    view.evaluate_javascript('window.print()', -1, None, None, None, None, None)
                except Exception as error:
                    failed(str(error))
            app.view.evaluate_javascript('document.body.innerText', -1, None, None, None, rendered, None)
        elif phase == 'print' and printed:
            app.origin = 'https://127.0.0.1:1'
            phase = 'offline'
            app.load()
        elif phase == 'offline' and app.stack.get_visible_child_name() == 'error':
            assert 'Не вдалося підключитися' in app.message.get_text()
            app.origin = f'https://localhost:{server.server_port}'
            phase = 'tls'
            app.load()
        elif phase == 'tls' and app.stack.get_visible_child_name() == 'error':
            if 'Сертифікат' not in app.message.get_text():
                failed('Untrusted TLS did not show certificate error')
            else:
                phase = 'done'
                app.quit()
            return False
        return True

    try:
        module.run(ready)
    finally:
        server.shutdown()
    assert phase == 'done', (phase, failures)
    assert not failures, failures
print('PASS: real GTK/WebKit window, trusted HTTPS React login, offline recovery and self-signed TLS rejection')
