"""Lemvori Control — local native publisher and license manager."""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from zoneinfo import ZoneInfo

from license_core import (
    CATALOG, calendar_expiry, create_keys, issue_license, resolve_modules,
    validate_private_key_file, write_new,
)
from license_store import (
    atomic_json, license_matches_record, load_preferences, load_registry,
    remove_record, save_preferences, upsert,
)

FONT = "Segoe UI" if sys.platform == "win32" else "DejaVu Sans"
HOME = Path(os.environ.get("LEMVORI_CONTROL_HOME", str(Path.home() / ".lemvori-control")))
INITIAL = {
    "center": "", "server_id": "", "center_id": "",
    "max_users": "40", "max_devices": "40", "expires": "", "support": "",
}
WORKFLOW = {
    "opening_time": "08:00", "closing_time": "20:00", "working_days": "1234567",
    "slot_step_minutes": "60", "default_duration_minutes": "60", "session_hours": "8",
}


def local_end_date(timestamp):
    if not timestamp:
        return ""
    # Timestamp is the instant AFTER the last active day in Europe/Kyiv.
    return dt.datetime.fromtimestamp(int(timestamp) - 1, ZoneInfo("Europe/Kyiv")).date().isoformat()


class Publisher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Lemvori Control · 1.1.1")
        self.geometry("1100x820")
        self.minsize(960, 730)
        self.configure(bg="#EFF3F9")
        self.registry_path = HOME / "centers.json"
        self.preferences_path = HOME / "settings.json"
        self.records = []
        self.ready = True
        try:
            self.records = load_registry(self.registry_path)
        except (OSError, ValueError, UnicodeError) as error:
            self.ready = False
            messagebox.showerror(
                "Реєстр центрів",
                f"Не вдалося прочитати {self.registry_path}\n\n{error}\n\n"
                "Реєстр залишено без змін. Відновіть резервну копію перед записом.",
                parent=self,
            )
        try:
            preferences = load_preferences(self.preferences_path)
        except (OSError, ValueError, UnicodeError):
            preferences = {"key_path": "", "license_dir": ""}
        self.key_path = tk.StringVar(value=preferences["key_path"])
        self.license_dir = preferences["license_dir"]
        self.key_label = tk.StringVar()
        self.status = tk.StringVar(value=f"Локальний реєстр: {self.registry_path}")
        self.vars = {}
        self.modules = {}
        self.workflow_vars = {}
        self.apply_workflow = tk.BooleanVar(value=False)
        self.setup_style()
        self.build_ui()
        self.update_key_label()
        self.refresh()

    def setup_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", font=(FONT, 10), background="#EFF3F9", foreground="#182840")
        style.configure("Card.TFrame", background="#FFFFFF")
        style.configure("Card.TLabel", background="#FFFFFF", foreground="#182840")
        style.configure("Hint.TLabel", background="#FFFFFF", foreground="#66758A", font=(FONT, 9))
        style.configure("Section.TLabel", background="#FFFFFF", foreground="#192B46", font=(FONT, 13, "bold"))
        style.configure("TButton", padding=(13, 9), background="#E8EDF7", foreground="#1C3657", borderwidth=0)
        style.map("TButton", background=[("active", "#DCE5F3"), ("disabled", "#EFF1F5")])
        style.configure("Primary.TButton", background="#2966D0", foreground="#FFFFFF", font=(FONT, 10, "bold"))
        style.map("Primary.TButton", background=[("active", "#1F56BA"), ("disabled", "#9FB8DB")])
        style.configure("Danger.TButton", background="#FBE9EA", foreground="#A42839")
        style.map("Danger.TButton", background=[("active", "#F5D7DA")])
        style.configure("TEntry", padding=7, fieldbackground="#F9FBFF", foreground="#182840")
        style.configure("TNotebook", background="#EFF3F9", borderwidth=0)
        style.configure("TNotebook.Tab", padding=(17, 10), background="#E3E9F3", foreground="#384D66")
        style.map("TNotebook.Tab", background=[("selected", "#FFFFFF")], foreground=[("selected", "#1A57B8")])
        style.configure("Treeview", background="#FFFFFF", fieldbackground="#FFFFFF",
                        foreground="#233652", rowheight=30, borderwidth=0)
        style.configure("Treeview.Heading", background="#E7EDF6", foreground="#243B5C",
                        font=(FONT, 10, "bold"), padding=7)
        style.map("Treeview", background=[("selected", "#C9DBF5")],
                  foreground=[("selected", "#15243B")])

    def build_ui(self):
        header = tk.Frame(self, bg="#172B49", padx=26, pady=17)
        header.pack(fill="x")
        tk.Label(header, text="LEMVORI  /  CONTROL", bg="#172B49", fg="#90B7FF",
                 font=(FONT, 10, "bold")).pack(anchor="w")
        tk.Label(header, text="Керування ліцензіями", bg="#172B49", fg="white",
                 font=(FONT, 24, "bold")).pack(anchor="w", pady=(2, 0))
        tk.Label(header, text="Створення, підпис, локальне збереження та облік доступу центрів",
                 bg="#172B49", fg="#CBDAF1", font=(FONT, 10)).pack(anchor="w")

        body = ttk.Frame(self, padding=(20, 16, 20, 10))
        body.pack(fill="both", expand=True)
        key_card = ttk.Frame(body, style="Card.TFrame", padding=14)
        key_card.pack(fill="x", pady=(0, 10))
        key_buttons = ttk.Frame(key_card, style="Card.TFrame")
        key_buttons.pack(fill="x")
        ttk.Button(key_buttons, text="Видати ліцензію (.lemvori-license)",
                   style="Primary.TButton", command=self.issue).pack(side="left")
        ttk.Button(key_buttons, text="Створити ключ підпису (.pem)",
                   command=self.create_key).pack(side="left", padx=(8, 0))
        ttk.Button(key_buttons, text="Вибрати існуючий ключ",
                   command=self.pick_key).pack(side="left", padx=8)
        ttk.Button(key_buttons, text="Імпортувати запит центру", command=self.import_center).pack(side="left")
        ttk.Label(key_card, textvariable=self.key_label, style="Hint.TLabel",
                  wraplength=960).pack(anchor="w", pady=(7, 0))

        tabs = ttk.Notebook(body)
        tabs.pack(fill="both", expand=True)
        center_panel = ttk.Frame(tabs, style="Card.TFrame", padding=18)
        module_panel = ttk.Frame(tabs, style="Card.TFrame", padding=18)
        workflow_panel = ttk.Frame(tabs, style="Card.TFrame", padding=18)
        tabs.add(center_panel, text="Центр та ліцензія")
        tabs.add(module_panel, text="Модулі")
        tabs.add(workflow_panel, text="Правила роботи")

        center_panel.columnconfigure(1, weight=1)
        ttk.Label(center_panel, text="Параметри центру", style="Section.TLabel").grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 9))
        fields = [
            ("center", "Назва центру"),
            ("server_id", "ID сервера (64 символи 0–9, a–f)"),
            ("center_id", "Постійний ID центру (необов’язково)"),
            ("max_users", "Максимум працівників"),
            ("max_devices", "Максимум Android-пристроїв"),
            ("expires", "Діє до (РРРР-ММ-ДД; порожньо — безстроково)"),
            ("support", "Підтримка до (РРРР-ММ-ДД)"),
        ]
        for row, (key, label) in enumerate(fields, start=1):
            ttk.Label(center_panel, text=label, style="Card.TLabel").grid(
                row=row, column=0, sticky="w", padx=(0, 18), pady=5)
            variable = tk.StringVar(value=INITIAL[key])
            self.vars[key] = variable
            ttk.Entry(center_panel, textvariable=variable).grid(
                row=row, column=1, sticky="ew", pady=5)
        ttk.Label(
            center_panel,
            text="Підписана ліцензія не змінюється від редагування полів. "
                 "Щоб застосувати зміни, видайте новий файл.",
            style="Hint.TLabel", wraplength=820,
        ).grid(row=8, column=0, columnspan=2, sticky="w", pady=(12, 0))

        ttk.Label(module_panel, text="Функції, доступні центру", style="Section.TLabel").pack(
            anchor="w", pady=(0, 9))
        for module in CATALOG:
            enabled = tk.BooleanVar(value=True)
            self.modules[module["id"]] = enabled
            checkbox = ttk.Checkbutton(
                module_panel,
                text=module["name"] + ("   •   базовий" if module["core"] else ""),
                variable=enabled,
                command=lambda name=module["id"]: self.toggle_module(name),
            )
            checkbox.pack(anchor="w", pady=4)
            if module["core"]:
                checkbox.state(["disabled"])
        ttk.Label(
            module_panel, text="Залежності вмикаються автоматично. "
            "Вимкнення модуля не видаляє записи центру.", style="Hint.TLabel",
        ).pack(anchor="w", pady=12)

        workflow_panel.columnconfigure(1, weight=1)
        ttk.Checkbutton(
            workflow_panel, text="Застосувати правила при активації нової ліцензії",
            variable=self.apply_workflow,
        ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 15))
        rules = [
            ("opening_time", "Початок роботи"),
            ("closing_time", "Завершення роботи"),
            ("working_days", "Дні роботи (цифри 1–7)"),
            ("slot_step_minutes", "Крок запису (15, 30 або 60 хв)"),
            ("default_duration_minutes", "Тривалість прийому (хв)"),
            ("session_hours", "Тривалість сеансу входу (год)"),
        ]
        for row, (key, label) in enumerate(rules, start=1):
            ttk.Label(workflow_panel, text=label, style="Card.TLabel").grid(
                row=row, column=0, sticky="w", padx=(0, 16), pady=5)
            variable = tk.StringVar(value=WORKFLOW[key])
            self.workflow_vars[key] = variable
            ttk.Entry(workflow_panel, textvariable=variable).grid(
                row=row, column=1, sticky="ew", pady=5)

        buttons = ttk.Frame(body)
        buttons.pack(fill="x", pady=(12, 10))
        ttk.Button(buttons, text="Видати файл .lemvori-license",
                   style="Primary.TButton", command=self.issue).pack(side="left")
        ttk.Button(buttons, text="Зберегти чернетку", command=self.save_draft).pack(side="left", padx=7)
        ttk.Button(buttons, text="Новий центр", command=self.clear_form).pack(side="left")

        registry_card = ttk.Frame(body, style="Card.TFrame", padding=12)
        registry_card.pack(fill="x")
        registry_title = ttk.Frame(registry_card, style="Card.TFrame")
        registry_title.pack(fill="x", pady=(0, 8))
        ttk.Label(registry_title, text="Локальний реєстр ліцензій",
                  style="Section.TLabel").pack(side="left")
        ttk.Button(registry_title, text="Видалити", style="Danger.TButton",
                   command=self.delete_license).pack(side="right")
        ttk.Button(registry_title, text="Показати файл", command=self.reveal_license).pack(
            side="right", padx=7)
        self.list = ttk.Treeview(
            registry_card,
            columns=("center", "server", "expires", "state", "saved"),
            show="headings", height=4, selectmode="browse",
        )
        for key, name, width in [
            ("center", "Центр", 225), ("server", "Сервер", 140),
            ("expires", "Строк", 125), ("state", "Стан", 110),
            ("saved", "Файл", 235),
        ]:
            self.list.heading(key, text=name)
            self.list.column(key, width=width, minwidth=70, stretch=(key in ("center", "saved")))
        self.list.pack(fill="x")
        self.list.bind("<<TreeviewSelect>>", self.load_center)
        ttk.Label(
            registry_card,
            text="Видалення тут не відкликає раніше активовану ліцензію на сервері центру.",
            style="Hint.TLabel",
        ).pack(anchor="w", pady=(8, 0))
        tk.Label(
            self, textvariable=self.status, bg="#E2EAF6", fg="#23466F",
            font=(FONT, 9), anchor="w", padx=20, pady=7,
        ).pack(fill="x")

    def update_key_label(self):
        raw = self.key_path.get().strip()
        self.key_label.set(
            "Файл, який отримає центр: .lemvori-license.  "
            "PEM — лише приватний ключ для підпису: "
            + (raw if raw else "не вибраний")
            + "   •   пароль не зберігається"
        )

    def remember_paths(self):
        save_preferences(self.preferences_path, self.key_path.get(), self.license_dir)

    def toggle_module(self, name):
        if self.modules[name].get():
            enabled = resolve_modules([key for key, value in self.modules.items() if value.get()])
            for key, value in self.modules.items():
                value.set(key in enabled)
        else:
            disabled = {name}
            while True:
                expanded = disabled | {
                    module["id"] for module in CATALOG
                    if any(dependency in disabled for dependency in module["depends"])
                }
                if expanded == disabled:
                    break
                disabled = expanded
            for module in CATALOG:
                if module["id"] in disabled and not module["core"]:
                    self.modules[module["id"]].set(False)

    def selected_record(self):
        selected = self.list.selection()
        if not selected:
            return None
        index = int(selected[0])
        return self.records[index] if index < len(self.records) else None

    def refresh(self, select_server=None):
        self.list.delete(*self.list.get_children())
        for index, record in enumerate(self.records):
            server = record.get("server_id", "")
            filename = record.get("license_path", "")
            self.list.insert("", tk.END, iid=str(index), values=(
                record.get("center", ""), server[:16] + "…",
                local_end_date(record.get("expires_at")) or (
                    "Безстроково" if record.get("license_id") else "—"),
                "Видана" if record.get("license_id") else "Чернетка",
                Path(filename).name if filename else "—",
            ))
            if select_server and server == select_server:
                self.list.selection_set(str(index))
                self.list.see(str(index))

    def load_center(self, _event=None):
        record = self.selected_record()
        if record is None:
            return
        for key in ("center", "server_id", "center_id", "max_users", "max_devices"):
            self.vars[key].set(str(record.get(key, INITIAL[key])))
        for key, field in (("expires", "expires_at"), ("support", "support_until")):
            self.vars[key].set(local_end_date(record.get(field, 0)))
        selected = set(record.get("modules", []))
        for module in CATALOG:
            self.modules[module["id"]].set(module["core"] or module["id"] in selected)
        workflow = record.get("workflow") or {}
        self.apply_workflow.set(bool(workflow))
        for key, value in self.workflow_vars.items():
            value.set(str(workflow.get(key, WORKFLOW[key])))
        self.status.set(
            "Файл: " + record.get("license_path", "не збережено — чернетка"))

    def clear_form(self):
        self.list.selection_remove(*self.list.selection())
        for key, value in self.vars.items():
            value.set(INITIAL[key])
        for module in CATALOG:
            self.modules[module["id"]].set(True)
        self.apply_workflow.set(False)
        for key, value in self.workflow_vars.items():
            value.set(WORKFLOW[key])
        self.status.set("Новий центр: заповніть реквізити або імпортуйте запит.")

    def collect_form(self):
        data = {key: value.get().strip() for key, value in self.vars.items()}
        if not re.fullmatch(r"[a-f0-9]{64}", data["server_id"]):
            raise ValueError("ID сервера: рівно 64 символи 0–9, a–f. "
                             "Зручніше імпортувати запит із Lemvori Care Admin.")
        if not data["center"] or len(data["center"].encode()) > 200:
            raise ValueError("Укажіть назву центру до 200 байтів")
        max_users = int(data["max_users"])
        max_devices = int(data["max_devices"])
        if not (1 <= max_users <= 10000 and 1 <= max_devices <= 10000):
            raise ValueError("Ліміти працівників і пристроїв: 1–10000")
        workflow = None
        if self.apply_workflow.get():
            workflow = {
                key: int(value.get()) if key in (
                    "slot_step_minutes", "default_duration_minutes", "session_hours"
                ) else value.get().strip()
                for key, value in self.workflow_vars.items()
            }
        return {
            "center": data["center"], "server_id": data["server_id"],
            "center_id": data["center_id"],
            "max_users": max_users, "max_devices": max_devices,
            "expires_at": calendar_expiry(data["expires"]),
            "support_until": calendar_expiry(data["support"]),
            "modules": resolve_modules([
                key for key, value in self.modules.items() if value.get()
            ]),
            "workflow": workflow,
        }

    def save_draft(self):
        if not self.ready:
            return messagebox.showerror("Реєстр", "Спочатку відновіть пошкоджений реєстр.")
        try:
            record = self.collect_form()
            old = next((item for item in self.records
                        if item["server_id"] == record["server_id"]), None)
            if old and old.get("license_id"):
                raise ValueError(
                    "Центр уже має видану ліцензію. Щоб змінити умови, "
                    "видайте нову підписану ліцензію.")
            record["status"] = "draft"
            updated = upsert(self.records, record)
            atomic_json(self.registry_path, updated)
            self.records = updated
            self.refresh(record["server_id"])
            self.status.set(f"Чернетку збережено: {self.registry_path}")
        except (ValueError, OSError, TypeError) as error:
            messagebox.showerror("Не вдалося зберегти чернетку", str(error), parent=self)

    def import_center(self):
        path = filedialog.askopenfilename(
            parent=self, title="Запит центру", filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            if Path(path).stat().st_size > 65536:
                raise ValueError("Файл запиту завеликий")
            request = json.loads(Path(path).read_text(encoding="utf-8"))
            if not isinstance(request, dict) or request.get("format") != "lemvori.center-request" or request.get("version") != 1:
                raise ValueError("Це не запит центру Lemvori Care")
            server_id = request.get("server_id", "")
            if not isinstance(server_id, str) or not re.fullmatch(r"[a-f0-9]{64}", server_id):
                raise ValueError("Некоректний ID сервера")
            old = next((r for r in self.records if r["server_id"] == server_id), None)
            self.clear_form()
            if old:
                for key in ("center_id", "max_users", "max_devices"):
                    self.vars[key].set(str(old.get(key, INITIAL[key])))
            self.vars["server_id"].set(server_id)
            self.vars["center"].set(str(request.get("center", "")))
            wanted = request.get("requested_modules", [])
            if not isinstance(wanted, list):
                raise ValueError("Некоректний перелік модулів")
            enabled = resolve_modules(wanted)
            for module in CATALOG:
                self.modules[module["id"]].set(module["id"] in enabled)
            self.status.set(f"Запит центру імпортовано: {path}")
        except (OSError, ValueError, TypeError, UnicodeError) as error:
            messagebox.showerror("Запит центру", str(error), parent=self)

    def pick_key(self):
        initial_dir = str(Path(self.key_path.get()).parent) if self.key_path.get() else str(Path.home())
        path = filedialog.askopenfilename(
            parent=self, title="Приватний ключ видавця",
            initialdir=initial_dir, filetypes=[("PEM", "*.pem")])
        if not path:
            return False
        try:
            validated = validate_private_key_file(path)
            self.key_path.set(str(validated.resolve()))
            self.update_key_label()
            self.remember_paths()
            self.status.set("Ключ підпису вибрано. Результатом видачі буде .lemvori-license.")
            return True
        except (OSError, ValueError) as error:
            messagebox.showerror("Невірний PEM", str(error), parent=self)
            return False

    def create_key(self):
        password = simpledialog.askstring(
            "Захист ключа", "Новий пароль приватного ключа (щонайменше 12 символів):",
            show="*", parent=self)
        if password is None:
            return False
        again = simpledialog.askstring(
            "Підтвердження", "Повторіть пароль:", show="*", parent=self)
        if again is None:
            return False
        if password != again:
            messagebox.showerror("Пароль", "Паролі не збігаються", parent=self)
            return False
        folder = filedialog.askdirectory(parent=self, title="Папка для нової пари ключів")
        if not folder:
            return False
        private_path = Path(folder) / "lemvori-publisher-private.pem"
        public_path = Path(folder) / "lemvori-publisher-public.pem"
        if private_path.exists() or public_path.exists():
            messagebox.showerror("Ключ", "У цій папці вже є ключі. Виберіть нову папку.", parent=self)
            return False
        try:
            private, public = create_keys(password)
            write_new(private_path, private, private=True)
            try:
                write_new(public_path, public)
            except Exception:
                private_path.unlink(missing_ok=True)
                raise
            self.key_path.set(str(private_path.resolve()))
            self.update_key_label()
            self.remember_paths()
            self.status.set(f"Пару ключів створено: {folder}")
            messagebox.showinfo(
                "Ключі створено",
                "Приватний ключ і публічний ключ записано в:\n"
                f"{folder}\n\nЗбережіть резервну копію та пароль окремо. "
                "На сервер центру передається ЛИШЕ публічний ключ.",
                parent=self)
            return True
        except Exception as error:
            messagebox.showerror("Не вдалося створити ключі", str(error), parent=self)
            return False

    def ensure_signing_key(self):
        """Prompt once for a signing key; do not silently rotate trusted keys."""
        current = self.key_path.get().strip()
        if current:
            try:
                return validate_private_key_file(current)
            except (OSError, ValueError):
                pass
        answer = messagebox.askyesnocancel(
            "Потрібен ключ підпису",
            "Для створення файлу .lemvori-license потрібен приватний PEM-ключ.\\n\\n"
            "ТАК — вибрати вже створений приватний PEM.\\n"
            "НІ — створити нову пару ключів видавця.\\n"
            "СКАСУВАТИ — повернутися без змін.\\n\\n"
            "Увага: новий ключ НЕ прийматиметься центрами, "
            "де встановлений старий публічний ключ.",
            icon="warning", parent=self,
        )
        if answer is None:
            return None
        if answer:
            if not self.pick_key():
                return None
        elif not self.create_key():
            return None
        try:
            return validate_private_key_file(self.key_path.get())
        except (OSError, ValueError) as error:
            messagebox.showerror("Невірний ключ підпису", str(error), parent=self)
            return None

    def issue(self):
        if not self.ready:
            return messagebox.showerror("Реєстр", "Спочатку відновіть пошкоджений реєстр.")
        try:
            record = self.collect_form()
        except (ValueError, OSError, TypeError) as error:
            return messagebox.showerror("Перевірте дані центру", str(error), parent=self)
        key_path = self.ensure_signing_key()
        if key_path is None:
            return
        password = simpledialog.askstring(
            "Підпис ліцензії", "Пароль приватного ключа:", show="*", parent=self)
        if password is None:
            return
        try:
            envelope, grant = issue_license(
                key_path.read_bytes(), password,
                center=record["center"], server_id=record["server_id"],
                center_id=record["center_id"] or None, modules=record["modules"],
                max_users=record["max_users"], max_devices=record["max_devices"],
                expires_at=record["expires_at"], support_until=record["support_until"],
                workflow=record["workflow"],
            )
        except Exception as error:
            return messagebox.showerror("Не вдалося підписати", str(error), parent=self)
        initial_dir = self.license_dir
        if not initial_dir or not Path(initial_dir).is_dir():
            initial_dir = str(Path.home() / "Downloads")
            if not Path(initial_dir).is_dir():
                initial_dir = str(Path.home())
        chosen = filedialog.asksaveasfilename(
            parent=self, title="Зберегти підписану ліцензію",
            initialdir=initial_dir,
            initialfile=f"Lemvori-{grant['server_id'][:12]}.lemvori-license",
            defaultextension=".lemvori-license",
            filetypes=[("Lemvori license", "*.lemvori-license")],
        )
        if not chosen:
            return
        path = Path(chosen).expanduser().resolve()
        if path.suffix != ".lemvori-license":
            return messagebox.showerror("Невірний тип файлу", "Потрібне розширення .lemvori-license", parent=self)
        if path.exists():
            return messagebox.showerror(
                "Файл існує", "Цей файл уже існує. Виберіть іншу назву, "
                "щоб не втратити стару підписану ліцензію.", parent=self)
        grant["license_path"] = str(path)
        grant["status"] = "issued"
        updated = upsert(self.records, grant)
        try:
            write_new(path, json.dumps(envelope, ensure_ascii=False, indent=2).encode("utf-8"), private=True)
            if not license_matches_record(path, grant):
                raise ValueError("Не вдалося перевірити щойно записаний файл")
            try:
                atomic_json(self.registry_path, updated)
            except Exception:
                path.unlink(missing_ok=True)
                raise
            self.records = updated
            self.license_dir = str(path.parent)
            try:
                self.remember_paths()
            except OSError as warning:
                messagebox.showwarning(
                    "Налаштування",
                    "Ліцензію збережено, але останню папку не вдалося "
                    f"запам’ятати: {warning}", parent=self)
            self.vars["center_id"].set(grant["center_id"])
            self.refresh(grant["server_id"])
            self.status.set(f"Ліцензію збережено: {path}")
            messagebox.showinfo(
                "Ліцензія створена",
                f"Файл успішно записаний:\n{path}\n\n"
                "Передайте центру цей файл. Приватний ключ залишається у вас.",
                parent=self)
        except Exception as error:
            messagebox.showerror("Не вдалося зберегти ліцензію", str(error), parent=self)

    def reveal_license(self):
        record = self.selected_record()
        if not record:
            return messagebox.showinfo("Ліцензії", "Спочатку виберіть рядок у реєстрі.", parent=self)
        location = record.get("license_path", "")
        if not location or not Path(location).is_file():
            return messagebox.showwarning(
                "Файл не знайдено", f"Для цього запису немає доступного файлу.\n{location}",
                parent=self)
        path = Path(location)
        self.status.set(f"Файл ліцензії: {path}")
        try:
            if sys.platform == "win32":
                os.startfile(str(path.parent))
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(path.parent)])
            else:
                subprocess.Popen(["xdg-open", str(path.parent)])
        except (OSError, AttributeError):
            messagebox.showinfo("Шлях до файлу", str(path), parent=self)

    def delete_license(self):
        if not self.ready:
            return messagebox.showerror("Реєстр", "Спочатку відновіть пошкоджений реєстр.")
        record = self.selected_record()
        if not record:
            return messagebox.showinfo("Ліцензії", "Виберіть запис для видалення.", parent=self)
        confirmed = messagebox.askyesno(
            "Видалити запис?",
            f"Видалити запис «{record['center']}» із реєстру цього комп’ютера?\n\n"
            "Це НЕ відкличе вже активовану ліцензію на сервері центру.",
            icon="warning", parent=self,
        )
        if not confirmed:
            return
        target = record.get("license_path", "")
        remove_file = False
        if target and Path(target).exists():
            if license_matches_record(target, record):
                choice = messagebox.askyesnocancel(
                    "Видалити також файл?",
                    "Видалити локальний файл ліцензії з диска?\n\n"
                    f"{target}\n\n"
                    "Так — видалити файл і запис.\n"
                    "Ні — лише запис із реєстру.\n"
                    "Скасувати — нічого не змінювати.",
                    icon="warning", parent=self,
                )
                if choice is None:
                    return
                remove_file = bool(choice)
            else:
                messagebox.showwarning(
                    "Файл не видалятиметься",
                    "Файл не збігається з ліцензією в реєстрі або є символьним "
                    "посиланням. Буде видалено лише запис.",
                    parent=self,
                )
        try:
            updated = remove_record(self.records, record["server_id"])
            atomic_json(self.registry_path, updated)
            self.records = updated
            self.clear_form()
            self.refresh()
            if remove_file:
                try:
                    Path(target).unlink()
                except OSError as error:
                    messagebox.showwarning(
                        "Реєстр оновлено",
                        f"Запис видалено, але файл не вдалося видалити:\n{error}",
                        parent=self,
                    )
            self.status.set("Запис видалено з локального реєстру. "
                            "Ліцензія, активована на сервері, не відкликана.")
        except (OSError, ValueError) as error:
            messagebox.showerror("Видалення", str(error), parent=self)


if __name__ == "__main__":
    app = Publisher()
    if "--smoke" in sys.argv:
        app.after(900, app.destroy)
    app.mainloop()
