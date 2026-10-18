#!/usr/bin/python3
"""SOLVIA Linux client: GTK3 window with WebKitGTK 4.1, no Chrome process."""
import sys
from pathlib import Path
from urllib.parse import urlsplit, unquote, urlencode
import mimetypes
import subprocess


def server_url(value):
    """Only HTTPS server origins; never accept credentials, script or file URLs."""
    value = value.strip()
    if any(c.isspace() or ord(c) < 32 for c in value) or '\\' in value:
        raise ValueError('Адреса сервера не може містити пробіли або службові символи.')
    url = urlsplit(value)
    if (url.scheme != 'https' or not url.hostname or url.username is not None or url.password is not None
            or url.path not in ('', '/') or url.query or url.fragment):
        raise ValueError('Вкажіть HTTPS-адресу сервера, наприклад https://192.168.1.10:8443')
    try:
        url.port
    except ValueError:
        raise ValueError('Некоректний порт сервера.') from None
    host = url.hostname.lower()
    host = f'[{host}]' if ':' in host else host.encode('idna').decode('ascii')
    authority = host + (f':{url.port}' if url.port not in (None, 443) else '')
    return url._replace(netloc=authority).geturl().rstrip('/')


def local_asset(root, uri):
    parsed = urlsplit(uri)
    if parsed.scheme != 'solvia' or parsed.netloc != 'app':
        raise ValueError('Невідома адреса локального інтерфейсу.')
    root = Path(root).resolve()
    path = (root / unquote(parsed.path).lstrip('/')).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Файл локального інтерфейсу не знайдено.')
    mime = {'.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html'}.get(
        path.suffix, mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
    return path.read_bytes(), mime


def run(on_ready=None):
    try:
        import gi
        gi.require_version('Gtk', '3.0')
        gi.require_version('WebKit2', '4.1')
        from gi.repository import Gtk, Gdk, Gio, GLib, WebKit2
    except (ImportError, ValueError):
        print('Потрібні python3-gi, gir1.2-gtk-3.0 та gir1.2-webkit2-4.1. '
              'Встановіть їх через install-client.sh.', file=sys.stderr)
        return 1

    config = Path(GLib.get_user_config_dir()) / 'solvia' / 'server-url'
    ui_root = next((root for root in (Path(__file__).resolve().parent / 'ui', Path('/usr/local/lib/solvia/ui'), Path('/opt/solvia/ui')) if (root / 'index.html').is_file()), None)
    if ui_root is None:
        print('Не знайдено локальний інтерфейс SOLVIA. Повторно встановіть повний пакет клієнта.', file=sys.stderr)
        return 1

    class WindowController:
        def __init__(self, application, console=False):
            self.application = application
            self.console = console
            self.window = None
            self.origin = ''
            self.window = Gtk.ApplicationWindow(application=application, title='SOLVIA Server Console 3.0.0' if console else 'SOLVIA 3.0.0')
            display = Gdk.Display.get_default()
            monitor = display.get_primary_monitor() or display.get_monitor(0)
            area = monitor.get_workarea()
            self.window.set_default_size(min(1200, max(480, area.width - 40)),
                                         min(800, max(360, area.height - 60)))
            self.window.set_wmclass('SOLVIAServerConsole' if console else 'SOLVIAAdmin', 'SOLVIAAdmin')
            self.window.set_icon_name('solvia-admin')
            header = Gtk.HeaderBar(title='SOLVIA Server Console 3.0.0' if console else 'SOLVIA 3.0.0', show_close_button=True)
            self.window.set_titlebar(header)
            self.spinner = Gtk.Spinner()
            header.pack_start(self.spinner)
            for label, callback in [('Оновити', lambda *_: self.load()),
                                    ('Сервер', lambda *_: self.connection())]:
                button = Gtk.Button(label=label)
                button.connect('clicked', callback)
                header.pack_end(button)
            if console:
                services = Gtk.Button(label='Служби сервера')
                services.set_sensitive(Path('/usr/local/bin/solvia-server-control').is_file())
                services.set_tooltip_text('Керування службами доступне на серверному ПК.')
                services.connect('clicked', lambda *_: subprocess.Popen(['/usr/local/bin/solvia-server-control', '--terminal']))
                header.pack_end(services)
            self.stack = Gtk.Stack()
            self.window.add(self.stack)
            if application.context is None:
                data_dir = Path(GLib.get_user_data_dir()) / 'solvia-desktop'
                cache_dir = Path(GLib.get_user_cache_dir()) / 'solvia-desktop'
                for directory in (data_dir, cache_dir):
                    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
                manager = WebKit2.WebsiteDataManager(base_data_directory=str(data_dir),
                                                    base_cache_directory=str(cache_dir))
                manager.set_tls_errors_policy(WebKit2.TLSErrorsPolicy.FAIL)
                context = WebKit2.WebContext.new_with_website_data_manager(manager)
                security = context.get_security_manager()
                security.register_uri_scheme_as_secure('solvia')
                security.register_uri_scheme_as_cors_enabled('solvia')
                def asset(request):
                    try:
                        data, mime = local_asset(ui_root, request.get_uri())
                        stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(data))
                        request.finish(stream, len(data), mime)
                    except (OSError, ValueError):
                        request.finish_error(GLib.Error('Файл локального інтерфейсу SOLVIA недоступний.'))
                context.register_uri_scheme('solvia', asset)
                # Local LAN connections must not be sent to a desktop HTTP proxy.
                manager.set_network_proxy_settings(WebKit2.NetworkProxyMode.NO_PROXY, None)
                application.context = context
            context = application.context
            self.view = WebKit2.WebView(web_context=context)
            self.view.get_settings().set_enable_developer_extras(False)
            self.view.connect('load-changed', self.changed)
            self.view.connect('load-failed', self.failed)
            self.view.connect('load-failed-with-tls-errors', self.tls_failed)
            self.view.connect('web-process-terminated', lambda *_: self.show_error(
                'Робоче вікно SOLVIA перервало роботу. Натисніть «Повторити підключення».'))
            self.view.connect('decide-policy', self.policy)
            self.view.connect('permission-request', lambda _, request: (request.deny(), True)[1])
            self.view.connect('close', lambda *_: self.window.destroy())
            self.window.connect('delete-event', self.close)
            self.download_handler = context.connect('download-started', self.download)
            self.window.connect('destroy', self.destroyed)
            self.stack.add_named(self.view, 'app')
            error_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16,
                                margin=40, halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER)
            self.message = Gtk.Label(wrap=True, max_width_chars=65, selectable=True)
            error_box.pack_start(self.message, False, False, 0)
            retry = Gtk.Button(label='Повторити підключення')
            retry.connect('clicked', lambda *_: self.load())
            error_box.pack_start(retry, False, False, 0)
            change = Gtk.Button(label='Змінити адресу сервера')
            change.connect('clicked', lambda *_: self.connection())
            error_box.pack_start(change, False, False, 0)
            self.stack.add_named(error_box, 'error')
            self.window.show_all()
            try:
                self.origin = server_url(config.read_text() if config.exists() else 'https://localhost:8443')
                self.load()
            except (OSError, ValueError) as error:
                self.show_error(str(error))
            if on_ready and not console:
                GLib.idle_add(on_ready, self)

        def load(self, force=False):
            if not self.origin:
                self.connection()
                return
            self.stack.set_visible_child_name('app')
            params = {'api' if force else 'default_api': self.origin}
            if self.console:
                params['mode'] = 'server'
            self.view.load_uri('solvia://app/index.html?' + urlencode(params))

        def show_error(self, message):
            self.spinner.stop()
            self.message.set_text(message)
            self.stack.set_visible_child_name('error')

        def changed(self, view, event):
            if event == WebKit2.LoadEvent.STARTED:
                self.spinner.start()
            elif event == WebKit2.LoadEvent.FINISHED:
                self.spinner.stop()

        def failed(self, view, event, uri, error):
            if error.matches(WebKit2.network_error_quark(), WebKit2.NetworkError.CANCELLED):
                return False
            self.show_error('Не вдалося відкрити локальний інтерфейс SOLVIA. Повторно встановіть повний пакет клієнта.')
            return True

        def tls_failed(self, view, uri, certificate, errors):
            self.show_error('Сертифікат сервера не пройшов перевірку. '
                            'Установіть довірений сертифікат центру та перевірте адресу. '
                            'Перевірка HTTPS залишається увімкненою.')
            return True

        def policy(self, view, decision, kind):
            if kind not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
                            WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
                return False
            action = decision.get_navigation_action()
            uri = action.get_request().get_uri()
            parsed = urlsplit(uri)
            target = urlsplit(self.origin)
            if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION and (
                    uri == 'about:blank' or uri.startswith('blob:solvia://app/') or (parsed.scheme, parsed.netloc) == ('solvia', 'app')
                    or uri.startswith('blob:' + self.origin + '/')
                    or (parsed.scheme, parsed.netloc) == (target.scheme, target.netloc)):
                return False
            decision.ignore()
            # External links are opened only after the employee clicks them.
            if parsed.scheme in ('https', 'mailto') and action.is_user_gesture():
                try:
                    Gio.AppInfo.launch_default_for_uri(uri, None)
                except GLib.Error:
                    self.show_error('Не вдалося відкрити зовнішнє посилання.')
            return True

        def connection(self):
            dialog = Gtk.Dialog(title='Сервер SOLVIA', transient_for=self.window, modal=True)
            dialog.add_buttons('Скасувати', Gtk.ResponseType.CANCEL, 'Підключитися', Gtk.ResponseType.OK)
            box = dialog.get_content_area()
            box.set_spacing(12)
            box.set_border_width(20)
            box.add(Gtk.Label(label='HTTPS-адреса сервера центру', xalign=0))
            entry = Gtk.Entry(text=self.origin or 'https://localhost:8443', width_chars=42)
            box.add(entry)
            error_label = Gtk.Label(wrap=True)
            box.add(error_label)
            dialog.show_all()
            while dialog.run() == Gtk.ResponseType.OK:
                try:
                    new_origin = server_url(entry.get_text())
                    config.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    temporary = config.with_suffix('.tmp')
                    temporary.write_text(new_origin + '\n')
                    temporary.chmod(0o600)
                    temporary.replace(config)
                    self.origin = new_origin
                    self.load(force=True)
                    break
                except (OSError, ValueError) as error:
                    error_label.set_text(str(error))
            dialog.destroy()

        def quit(self):
            self.application.quit()

        def destroyed(self, *_):
            self.application.controllers.pop('server' if self.console else 'center', None)
            self.application.context.disconnect(self.download_handler)

        def close(self, *_):
            # WebKit runs beforeunload handlers, preserving existing draft warnings.
            self.view.try_close()
            return True

        def download(self, context, download):
            if download.get_web_view() != self.view:
                return
            def destination(item, suggested):
                dialog = Gtk.FileChooserDialog(title='Зберегти файл SOLVIA', parent=self.window,
                                              action=Gtk.FileChooserAction.SAVE)
                dialog.add_buttons('Скасувати', Gtk.ResponseType.CANCEL, 'Зберегти', Gtk.ResponseType.OK)
                dialog.set_do_overwrite_confirmation(True)
                dialog.set_current_name(Path(suggested).name)
                if dialog.run() == Gtk.ResponseType.OK:
                    item.set_destination(Path(dialog.get_filename()).as_uri())
                    item.set_allow_overwrite(True)
                else:
                    item.cancel()
                dialog.destroy()
                return True
            download.connect('decide-destination', destination)

    class Solvia(Gtk.Application):
        def __init__(self):
            super().__init__(application_id='com.quremed.solvia.desktop', flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
            self.add_main_option('server-console', 0, GLib.OptionFlags.NONE, GLib.OptionArg.NONE, 'Open Server Console', None)
            self.controllers = {}
            self.context = None

        def do_command_line(self, command_line):
            args = command_line.get_arguments()[1:]
            if any(arg != '--server-console' for arg in args):
                print('Використання: solvia-admin-app [--server-console]', file=sys.stderr)
                return 2
            mode = 'server' if command_line.get_options_dict().contains('server-console') or '--server-console' in args else 'center'
            if mode in self.controllers:
                self.controllers[mode].window.present()
            else:
                self.controllers[mode] = WindowController(self, mode == 'server')
            return 0

    return Solvia().run([sys.argv[0]] + (sys.argv[1:] if on_ready is None else []))


if __name__ == '__main__':
    raise SystemExit(run())
