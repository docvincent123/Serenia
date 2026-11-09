#!/usr/bin/python3
"""SOLVIA Linux client: GTK3 window with WebKitGTK 4.1, no Chrome process."""
import sys
from pathlib import Path
from urllib.parse import urlsplit, unquote, urlencode
import mimetypes
import subprocess
import json
import threading


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
            self.admin_busy = False
            self.window = None
            self.origin = ''
            self.window = Gtk.ApplicationWindow(application=application, title='Lemvori Care Server Console 3.1.1' if console else 'Lemvori Care 3.1.1')
            display = Gdk.Display.get_default()
            monitor = display.get_primary_monitor() or display.get_monitor(0)
            area = monitor.get_workarea()
            self.window.set_default_size(min(1200, max(480, area.width - 40)),
                                         min(800, max(360, area.height - 60)))
            self.window.get_style_context().add_class('solvia-native')
            provider = Gtk.CssProvider()
            provider.load_from_data(b'''
                .solvia-native { background-color: #9BA8AB; color: #11212D; }
                .solvia-native headerbar { background: #4A5C6A; color: #CCD0CF;
                    border-color: #253745; box-shadow: none; }
                .solvia-native headerbar button { background: #253745; color: #CCD0CF;
                    border-color: #9BA8AB; border-radius: 24px; box-shadow: none; }
                .solvia-native headerbar button:hover { background: #11212D; }
                .solvia-native headerbar button:focus { border-color: #CCD0CF; }
            ''')
            Gtk.StyleContext.add_provider_for_screen(self.window.get_screen(), provider,
                                                     Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            self.window.set_wmclass('SOLVIAServerConsole' if console else 'SOLVIAAdmin', 'SOLVIAAdmin')
            self.window.set_icon_name('solvia-admin')
            header = Gtk.HeaderBar(title='Lemvori Care Server Console 3.1.1' if console else 'Lemvori Care 3.1.1', show_close_button=True)
            self.window.set_titlebar(header)
            self.spinner = Gtk.Spinner()
            header.pack_start(self.spinner)
            # The employee program has no update / server administration icons.
            # The dedicated Server Console can change the server endpoint.
            if console:
                connection = Gtk.Button(label='Підключення до сервера')
                connection.connect('clicked', lambda *_: self.connection())
                header.pack_end(connection)
            if console:
                # Critical database operations exist only in the separately
                # launched, local Server Console, never in the staff workspace.
                local_admin = Path('/usr/local/sbin/solvia-admin').is_file()
                for label, action in [('Резервна копія', self.backup_database),
                                      ('Відновити БД з файлу', self.restore_database)]:
                    item = Gtk.Button(label=label)
                    item.set_sensitive(local_admin)
                    item.set_tooltip_text('Операція з локальною БД цього комп’ютера; потрібне підтвердження адміністратора ОС.')
                    item.connect('clicked', lambda _, handler=action: handler())
                    header.pack_end(item)
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
            manager = self.view.get_user_content_manager()
            manager.register_script_message_handler('solviaEvents')
            manager.connect('script-message-received::solviaEvents', self.workflow_notification)
            if console:
                manager.register_script_message_handler('solviaAdmin')
                manager.connect('script-message-received::solviaAdmin', self.admin_message)
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

        def admin_message(self, manager, message):
            if not self.console or not (self.view.get_uri() or '').startswith('solvia://app/'):
                return
            action = message.get_js_value().to_string()
            if action == 'backup':
                self.backup_database()
            elif action == 'restore':
                self.restore_database()

        def admin_notice(self, title, text, success=True):
            kind = Gtk.MessageType.INFO if success else Gtk.MessageType.ERROR
            notice = Gtk.MessageDialog(transient_for=self.window, modal=True,
                                       message_type=kind, buttons=Gtk.ButtonsType.OK,
                                       text=title)
            notice.format_secondary_text(text)
            notice.run()
            notice.destroy()

        def run_admin_job(self, args, title):
            if self.admin_busy:
                return
            if not Path('/usr/local/sbin/solvia-admin').is_file():
                self.admin_notice('Операція недоступна',
                                  'Керування базою доступне лише з локальної Server Console.', False)
                return
            self.admin_busy = True
            self.spinner.start()

            def worker():
                try:
                    proc = subprocess.run(['pkexec', '/usr/local/sbin/solvia-admin', *args],
                                          capture_output=True, text=True, timeout=5400, check=False)
                    ok = proc.returncode == 0
                    output = (proc.stdout if ok else proc.stderr or proc.stdout).strip()
                    if ok and args[0] == 'backup':
                        output = 'Перевірену копію збережено: ' + (output.splitlines()[-1] if output else '/var/backups/solvia/')
                    elif ok:
                        output = 'Базу відновлено. Повторно увійдіть до програми та перевірте дані центру.'
                    else:
                        output = ('Код: ' + str(proc.returncode) +
                                  '. Перевірте журнал solvia-admin на локальному сервері. '
                                  'Дані не слід перезаписувати повторно без діагностики.')
                except (OSError, subprocess.TimeoutExpired) as error:
                    ok = False
                    output = 'Не вдалося виконати команду: ' + type(error).__name__
                def done():
                    self.spinner.stop()
                    self.admin_busy = False
                    self.admin_notice(title + (' — готово' if ok else ' — помилка'), output[:1000], ok)
                    if ok and args[0] == 'restore-ui':
                        self.load(force=True)
                    return False
                GLib.idle_add(done)
            threading.Thread(target=worker, daemon=True).start()

        def backup_database(self):
            if not self.console:
                return
            self.run_admin_job(['backup'], 'Резервна копія PostgreSQL')

        def restore_database(self):
            if not self.console or self.admin_busy:
                return
            picker = Gtk.FileChooserDialog(title='Оберіть PostgreSQL backup (.dump) з цього комп’ютера',
                                            parent=self.window, action=Gtk.FileChooserAction.OPEN)
            picker.add_buttons('Скасувати', Gtk.ResponseType.CANCEL,
                               'Перевірити файл', Gtk.ResponseType.OK)
            filter_dump = Gtk.FileFilter()
            filter_dump.set_name('Резервна копія PostgreSQL (*.dump)')
            filter_dump.add_pattern('*.dump')
            picker.add_filter(filter_dump)
            selected = picker.get_filename() if picker.run() == Gtk.ResponseType.OK else None
            picker.destroy()
            if not selected:
                return
            source = Path(selected)
            if not source.is_file() or source.is_symlink():
                self.admin_notice('Непридатний файл', 'Оберіть звичайний файл резервної копії.', False)
                return
            confirmation = Gtk.Dialog(title='Підтвердження відновлення',
                                      transient_for=self.window, modal=True)
            confirmation.add_buttons('Скасувати', Gtk.ResponseType.CANCEL,
                                     'Відновити базу', Gtk.ResponseType.OK)
            box = confirmation.get_content_area()
            box.set_border_width(22)
            box.set_spacing(14)
            note = Gtk.Label(
                label='УВАГА! Це замінить УСІ дані поточної БД на цьому серверному ПК.\n'
                      'Робота персоналу буде перервана, а активні сеанси можуть завершитися.\n'
                      'Файл спочатку перевіриться на ізольованій БД, а поточна БД\n'
                      'буде збережена як окрема захисна копія.\n'
                      'Щоб підтвердити, введіть ВІДНОВИТИ:', xalign=0)
            note.set_line_wrap(True)
            box.pack_start(note, False, False, 0)
            field = Gtk.Entry()
            field.set_placeholder_text('ВІДНОВИТИ')
            box.pack_start(field, False, False, 0)
            confirmation.show_all()
            confirmed = confirmation.run() == Gtk.ResponseType.OK and field.get_text() == 'ВІДНОВИТИ'
            confirmation.destroy()
            if confirmed:
                self.run_admin_job(['restore-ui', str(source)], 'Відновлення PostgreSQL')

        def workflow_notification(self, manager, message):
            if not (self.view.get_uri() or '').startswith('solvia://app/'):
                return
            titles = {'appointment.created':'Новий запис', 'appointment.updated':'Запис оновлено',
                      'appointment.cancelled':'Запис скасовано', 'appointment.no_show':'Відмічено неявку',
                      'patient.arrived':'Пацієнт прибув', 'patient.called':'Пацієнта запрошено до кабінету',
                      'consultation.started':'Консультацію розпочато', 'consultation.completed':'Консультацію завершено'}
            try:
                raw = message.get_js_value().to_string()
                if len(raw) > 1000: return
                event = json.loads(raw)
                if not isinstance(event, dict): return
                if event.get('kind') not in titles or not isinstance(event.get('id'), int): return
                notice = Gio.Notification.new('Lemvori Care · '+titles[event['kind']])
                notice.set_body('Відкрийте робочий простір Lemvori Care для перегляду.')
                notice.set_default_action('app.open-workspace')
                notice.set_priority(Gio.NotificationPriority.NORMAL)
                self.application.send_notification('workflow-'+str(event['id']), notice)
            except (ValueError, TypeError, GLib.Error):
                pass

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
            action = Gio.SimpleAction.new('open-workspace', None)
            action.connect('activate', self.open_workspace)
            self.add_action(action)

        def open_workspace(self, *_):
            if 'center' not in self.controllers:
                self.controllers['center'] = WindowController(self)
            self.controllers['center'].window.present()

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
