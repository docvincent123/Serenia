#!/usr/bin/python3
"""Real WebKitGTK smoke test after tests/linux-install.sh, under Xvfb.
Tests trusted HTTPS React rendering, native reconnect UI and untrusted TLS refusal.
"""
import importlib.util
import json
import os
from pathlib import Path
import ssl
import socket
import subprocess
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, WebKit2

failures = []
# WebKit/Mesa helpers can finish writing shader caches after Gtk.Application quits.
# Cleanup of disposable cache files must not hide the assertions below.
with tempfile.TemporaryDirectory(prefix='solvia-native-test-', ignore_cleanup_errors=True) as directory:
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
    offline_socket = socket.socket()
    offline_socket.bind(('127.0.0.1', 0))  # Reserved but not listening: real connection refusal.
    phase = 'login'
    trusted_origin = 'https://localhost:8443'
    with urllib.request.urlopen(trusted_origin+'/api/health', timeout=10) as response:
        server_health=json.load(response)
    connection_profile={'format':'quremed.solvia.mobile','version':2,
                        'server_id':server_health['server_id'],'center':'Native test center',
                        'https_url':trusted_origin,'api_url':trusted_origin}
    provisioned=False
    busy = False
    printed = False
    app = None
    console_process = None

    def failed(message):
        failures.append(message)
        app.quit()

    def ready(application):
        global app
        app = application
        # Native GTK window and dedicated WebKit widget, not a subprocess browser.
        assert app.window.get_title() == 'SOLVIA 3.1.0'
        assert isinstance(app.view, WebKit2.WebView)
        assert app.view.get_website_data_manager().get_tls_errors_policy() == WebKit2.TLSErrorsPolicy.FAIL
        app.view.connect('print', printing)
        GLib.timeout_add(250, poll)
        GLib.timeout_add_seconds(55, lambda: failed(
            f'Native client timed out: phase={phase}, uri={app.view.get_uri()}, '
            f'loading={app.view.is_loading()}, screen={app.stack.get_visible_child_name()}'))
        return False

    def printing(view, operation):
        global printed
        assert isinstance(operation, WebKit2.PrintOperation)
        printed = True
        return True  # Test print availability without opening a blocking system dialog.

    def poll():
        global busy, phase
        if phase == 'print' and printed:
            app.origin = f'https://127.0.0.1:{offline_socket.getsockname()[1]}'
            phase = 'offline'
            app.load(force=True)
            return True
        if phase == 'console':
            other = app.application.controllers.get('server')
            if not other or other.view.is_loading() or busy:
                return True
            assert other.view.get_context() == app.view.get_context()
            assert other.window.get_title() == 'SOLVIA Server Console 3.1.0'
            busy = True
            def console_rendered(view, result, _):
                global busy, phase
                busy = False
                try:
                    data = json.loads(view.evaluate_javascript_finish(result).to_string())
                    if 'Вхід до Server Console' not in data['text'] or data['shared'] != 'same-context':
                        return
                    assert 'mode=server' in view.get_uri()
                    phase = 'done'
                    app.quit()
                except Exception as error:
                    failed(str(error))
            other.view.evaluate_javascript("JSON.stringify({text:document.body.innerText,shared:localStorage.getItem('solvia-native-shared-test')})", -1, None, None, None, console_rendered, None)
            return True
        if busy or app.view.is_loading() or phase == 'print':
            return True
        if app.stack.get_visible_child_name() == 'error':
            failed('Local login failed: ' + app.message.get_text())
            return False
        busy = True
        def rendered(view, result, _):
            global busy, phase, provisioned
            busy = False
            try:
                text = view.evaluate_javascript_finish(result).to_string()
                if 'Вхід до SOLVIA' not in text:
                    return
                assert view.get_uri().startswith('solvia://app/')
                if phase == 'login' and not provisioned:
                    # A genuinely new native workstation must import its center file.
                    # Exercise the same DOM change event as the native file picker.
                    provisioned=True
                    script="""(()=>{
                      const input=document.querySelector('.login-card input[type=file]');
                      if(!input)throw new Error('Center profile input is missing');
                      const transfer=new DataTransfer();
                      transfer.items.add(new File([PROFILE],'Native-Center.solvia',{type:'application/json'}));
                      input.files=transfer.files;
                      input.dispatchEvent(new Event('change',{bubbles:true}));
                      return true;
                    })()""".replace('PROFILE',json.dumps(json.dumps(connection_profile)))
                    def imported(widget, result, _):
                        try: widget.evaluate_javascript_finish(result)
                        except Exception as error: failed('Profile import failed: '+str(error))
                    view.evaluate_javascript(script, -1, None, None, None, imported, None)
                    return
                if phase == 'login' and 'Сервер доступний. Можна увійти.' in text:
                    phase = 'print'
                    view.evaluate_javascript('window.print()', -1, None, None, None, None, None)
                elif phase == 'offline' and 'Сервер недоступний. Зверніться до системного адміністратора.' in text:
                    app.origin = trusted_origin
                    phase = 'recovery'
                    app.load(force=True)
                elif phase == 'recovery' and 'Сервер доступний. Можна увійти.' in text:
                    app.origin = f'https://localhost:{server.server_port}'
                    phase = 'tls'
                    app.load(force=True)
                elif phase == 'tls' and 'Сервер недоступний. Зверніться до системного адміністратора.' in text:
                    assert 'UNTRUSTED SERVER MUST NOT RENDER' not in text
                    global console_process
                    view.evaluate_javascript("localStorage.setItem('solvia-native-shared-test','same-context')", -1, None, None, None, None, None)
                    phase = 'console'
                    console_process = subprocess.Popen(['/usr/bin/python3', '/usr/local/lib/solvia/solvia-linux-app.py', '--server-console'])
            except Exception as error:
                failed(str(error))
        app.view.evaluate_javascript('document.body.innerText', -1, None, None, None, rendered, None)
        return True

    try:
        module.run(ready)
    finally:
        if console_process:
            try: console_process.wait(timeout=5)
            except subprocess.TimeoutExpired: console_process.terminate(); console_process.wait(timeout=5)
        offline_socket.close()
        server.shutdown()
    assert provisioned, 'First native workstation must import its profile'
    assert phase == 'done', (phase, failures)
    assert not failures, failures
print('PASS: real GTK/WebKit window, local React login, trusted HTTPS API, offline recovery, strict TLS and separate Server Console sharing native storage')
