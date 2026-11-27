"""Lemvori Control — local native publisher and license manager."""
import datetime as dt
import hashlib
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
    CATALOG, LICENSE_PRESETS, calendar_expiry, create_keys, issue_first_admin,
    issue_license, publisher_public_key, read_center_request, resolve_modules,
    validate_private_key_file, write_new,
)
from license_store import (
    atomic_json, license_matches_record, load_preferences, load_registry,
    remove_record, save_preferences, upsert,
)

VERSION = "1.2.1"
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


MODULE_LABELS = {
    "patients": "Картки, сім’ї та загальний архів",
    "documents": "Нумеровані заяви, документи, PDF і друк",
    "consents": "Обов’язкові згоди та підписані скани",
    "appointments": "Реєстратура, календар і лист очікування",
    "clinical": "Кабінет спеціаліста, консультації та архів зміни",
    "rehabilitation": "Курси та план реабілітації",
    "reports": "Аналітика, звіти та супервізії",
    "messages": "Службові повідомлення",
    "roster": "Склад спеціалістів на зміні",
}


def local_end_date(timestamp):
    if not timestamp:
        return ""
    # Timestamp is the instant AFTER the last active day in Europe/Kyiv.
    return dt.datetime.fromtimestamp(int(timestamp) - 1, ZoneInfo("Europe/Kyiv")).date().isoformat()


class Publisher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"Lemvori Control · {VERSION}")
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
        self.admin_vars = {}
        self.apply_workflow = tk.BooleanVar(value=False)
        self.exit_dialog = None
        self.protocol("WM_DELETE_WINDOW", self.request_exit)
        self.bind("<Control-q>", self.request_exit)
        self.setup_style()
        self.build_ui()
        self.admin_server = ""
        self.vars["server_id"].trace_add("write", self.on_server_changed)
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
        tk.Label(header, text=f"LEMVORI CONTROL  {VERSION}", bg="#172B49", fg="#90B7FF",
                 font=(FONT, 10, "bold")).pack(anchor="w")
        tk.Label(header, text="Керування ліцензіями", bg="#172B49", fg="white",
                 font=(FONT, 24, "bold")).pack(anchor="w", pady=(2, 0))
        tk.Label(header, text="Ліцензії закладів і підготовка першого адміністратора",
                 bg="#172B49", fg="#CBDAF1", font=(FONT, 10)).pack(anchor="w")

        body = ttk.Frame(self, padding=(20, 16, 20, 10))
        body.pack(fill="both", expand=True)
        key_card = ttk.Frame(body, style="Card.TFrame", padding=14)
        key_card.pack(fill="x", pady=(0, 10))
        key_buttons = ttk.Frame(key_card, style="Card.TFrame")
        key_buttons.pack(fill="x")
        ttk.Button(key_buttons, text="Імпортувати запит закладу",
                   style="Primary.TButton", command=self.import_center).pack(side="left")
        ttk.Button(key_buttons, text="Створити ключ підпису",
                   command=self.create_key).pack(side="left", padx=(8, 0))
        ttk.Button(key_buttons, text="Вибрати приватний PEM",
                   command=self.pick_key).pack(side="left", padx=8)
        ttk.Button(key_buttons, text="Експортувати публічний ключ",
                   command=self.export_public_key).pack(side="left")
        ttk.Label(key_card, textvariable=self.key_label, style="Hint.TLabel",
                  wraplength=960).pack(anchor="w", pady=(7, 0))

        tabs = ttk.Notebook(body)
        tabs.pack(fill="both", expand=True)
        center_panel = ttk.Frame(tabs, style="Card.TFrame", padding=18)
        module_panel = ttk.Frame(tabs, style="Card.TFrame", padding=18)
        workflow_panel = ttk.Frame(tabs, style="Card.TFrame", padding=18)
        admin_panel = ttk.Frame(tabs, style="Card.TFrame", padding=18)
        tabs.add(center_panel, text="Заклад і ліцензія")
        tabs.add(module_panel, text="Модулі")
        tabs.add(admin_panel, text="Перший адміністратор")
        tabs.add(workflow_panel, text="Правила роботи")

        center_panel.columnconfigure(1, weight=1)
        ttk.Label(center_panel, text="Параметри закладу", style="Section.TLabel").grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 9))
        fields = [
            ("center", "Назва закладу"),
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

        presets = ttk.Frame(module_panel, style="Card.TFrame")
        presets.pack(fill="x", pady=(0, 7))
        ttk.Label(presets, text="Набір модулів", style="Card.TLabel").pack(side="left", padx=(0, 14))
        for title in LICENSE_PRESETS:
            ttk.Button(presets, text=title, command=lambda selected=title: self.apply_preset(selected)).pack(
                side="left", padx=(0, 6))
        for module in CATALOG:
            enabled = tk.BooleanVar(value=True)
            self.modules[module["id"]] = enabled
            checkbox = ttk.Checkbutton(
                module_panel,
                text=MODULE_LABELS[module["id"]] + (" · базовий" if module["core"] else ""),
                variable=enabled,
                command=lambda name=module["id"]: self.toggle_module(name),
            )
            checkbox.pack(anchor="w", pady=3)
            if module["core"]:
                checkbox.state(["disabled"])
        ttk.Label(
            module_panel, text="Залежності додаються автоматично. Адміністратор закладу призначає ПК "
            "спеціалістам і надає медичному директору доступ до архіву зміни у Lemvori Care Admin.",
            style="Hint.TLabel", wraplength=860,
        ).pack(anchor="w", pady=(8, 0))

        self.build_first_admin(admin_panel)

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
        footer = tk.Frame(self, bg="#E2EAF6", padx=20, pady=5)
        footer.pack(fill="x")
        ttk.Button(footer, text="Вийти", command=self.request_exit).pack(side="right")
        tk.Label(
            footer, textvariable=self.status, bg="#E2EAF6", fg="#23466F",
            font=(FONT, 9), anchor="w", padx=0, pady=7,
        ).pack(side="left", fill="x", expand=True)

    def request_exit(self, _event=None):
        if self.exit_dialog is not None:
            self.exit_dialog.lift()
            return "break"

        previous_focus = self.focus_get()
        previous_grab = self.grab_current()
        dialog = tk.Toplevel(self, name="exit_confirmation")
        self.exit_dialog = dialog
        dialog.title("Вихід із Lemvori Control")
        dialog.transient(self)
        dialog.resizable(False, False)

        def stay(_event=None):
            self.exit_dialog = None
            dialog.destroy()
            if previous_grab is not None and previous_grab.winfo_exists():
                previous_grab.grab_set()
            if previous_focus is not None and previous_focus.winfo_exists():
                previous_focus.focus_set()
            return "break"

        dialog.protocol("WM_DELETE_WINDOW", stay)
        dialog.bind("<Escape>", stay)
        content = ttk.Frame(dialog, style="Card.TFrame", padding=20)
        content.pack(fill="both", expand=True)
        ttk.Label(content, text="Завершити роботу Lemvori Control?", style="Section.TLabel").pack(anchor="w")
        ttk.Label(content, text="Після виходу незбережені зміни у формі буде втрачено.",
                  style="Card.TLabel", wraplength=370).pack(anchor="w", pady=(8, 16))
        actions = ttk.Frame(dialog, name="actions", style="Card.TFrame", padding=(20, 0, 20, 16))
        actions.pack(fill="x")
        ttk.Button(actions, name="finish", text="Завершити вихід",
                   style="Danger.TButton", command=self.destroy).pack(side="right")
        stay_button = ttk.Button(actions, name="stay", text="Залишитися",
                                 style="Primary.TButton", command=stay)
        stay_button.pack(side="right", padx=(0, 8))
        stay_button.bind("<Return>", stay)
        dialog.wait_visibility()
        dialog.grab_set()
        stay_button.focus_set()
        return "break"

    def build_first_admin(self, panel):
        panel.columnconfigure(1, weight=1)
        ttk.Label(panel, text="Обліковий запис для нового сервера", style="Section.TLabel").grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 8))
        ttk.Label(panel, text="ID сервера", style="Card.TLabel").grid(
            row=1, column=0, sticky="w", padx=(0, 16))
        ttk.Entry(panel, textvariable=self.vars["server_id"]).grid(row=1, column=1, sticky="ew", pady=4)
        for row, (key, label) in enumerate((
            ("name", "Ім’я адміністратора"), ("login", "Логін"),
            ("password", "Пароль адміністратора"), ("confirm", "Повторіть пароль"),
        ), start=2):
            value = tk.StringVar()
            self.admin_vars[key] = value
            ttk.Label(panel, text=label, style="Card.TLabel").grid(
                row=row, column=0, sticky="w", padx=(0, 16), pady=4)
            masked = "*" if key in {"password", "confirm"} else ""
            ttk.Entry(panel, textvariable=value, show=masked).grid(row=row, column=1, sticky="ew", pady=4)
        ttk.Button(panel, text="Підписати файл .lemvori-admin", style="Primary.TButton",
                   command=self.export_first_admin).grid(row=6, column=1, sticky="w", pady=(10, 4))
        ttk.Label(
            panel, text="Для нового сервера отримайте ID командою install.sh --prepare-center. "
            "Файл діє 24 години. Підпишіть ліцензію та підготовку адміністратора тим самим ключем видавця.",
            style="Hint.TLabel", wraplength=800,
        ).grid(row=7, column=0, columnspan=2, sticky="w", pady=(6, 0))

    def on_server_changed(self, *_args):
        server = self.vars["server_id"].get().strip()
        if server != self.admin_server:
            self.admin_server = server
            self.clear_first_admin()

    def clear_first_admin(self):
        for value in self.admin_vars.values():
            value.set("")

    def apply_preset(self, preset):
        enabled = resolve_modules(LICENSE_PRESETS[preset])
        for name, value in self.modules.items():
            value.set(name in enabled)
        self.status.set(f"Вибрано набір модулів «{preset}»")

    def update_key_label(self):
        raw = self.key_path.get().strip()
        self.key_label.set("Приватний ключ підпису: " + (raw or "виберіть файл PEM"))

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
        if record is not None:
            self.load_record(record)

    def load_record(self, record):
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
        self.clear_first_admin()
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
            server_id, center, enabled = read_center_request(path)
            self.clear_form()
            old = next((record for record in self.records if record["server_id"] == server_id), None)
            if old:
                self.load_record(old)
            self.vars["server_id"].set(server_id)
            if center:
                self.vars["center"].set(center)
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
            "Для підпису потрібен приватний PEM-ключ видавця.\n\n"
            "ТАК — вибрати вже створений приватний PEM.\n"
            "НІ — створити нову пару ключів видавця.\n"
            "СКАСУВАТИ — повернутися без змін.\n\n"
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

    def signing_material(self):
        key_path = self.ensure_signing_key()
        if key_path is None:
            return None
        with key_path.open("rb") as source:
            material = source.read(16385)
        if len(material) > 16384:
            raise ValueError("Завеликий PEM-файл приватного ключа")
        password = ""
        if material.lstrip().startswith(b"-----BEGIN ENCRYPTED PRIVATE KEY-----"):
            password = simpledialog.askstring(
                "Ключ видавця", "Пароль приватного ключа:", show="*", parent=self)
            if password is None:
                return None
        return material, password

    def export_public_key(self):
        try:
            signing = self.signing_material()
            if signing is None:
                return
            public, fingerprint = publisher_public_key(*signing)
            path = filedialog.asksaveasfilename(parent=self, title="Експортувати публічний ключ",
                defaultextension=".pem", initialfile="lemvori-publisher-public.pem",
                filetypes=[("Публічний PEM", "*.pem")])
            if path:
                if Path(path).suffix.lower() != ".pem":
                    raise ValueError("Потрібне розширення .pem")
                write_new(path, public)
                self.status.set(f"SHA-256 публічного ключа: {fingerprint}")
                messagebox.showinfo("Публічний ключ закладу", f"SHA-256\n{fingerprint}", parent=self)
        except (ValueError, OSError) as error:
            messagebox.showerror("Експорт публічного ключа", str(error), parent=self)

    def export_first_admin(self):
        values = {name: value.get() for name, value in self.admin_vars.items()}
        if values["password"] != values.pop("confirm"):
            return messagebox.showerror("Перший адміністратор", "Паролі не збігаються", parent=self)
        server_id = self.vars["server_id"].get().strip()
        if not re.fullmatch(r"[a-f0-9]{64}", server_id):
            return messagebox.showerror("Перший адміністратор", "Перевірте ID нового сервера", parent=self)
        values["login"] = values["login"].strip()
        try:
            path = filedialog.asksaveasfilename(
                parent=self, title="Файл першого адміністратора", defaultextension=".lemvori-admin",
                initialfile=f"Lemvori-{server_id[:12]}.lemvori-admin",
                filetypes=[("Lemvori Admin", "*.lemvori-admin")])
            if not path:
                return
            if Path(path).suffix != ".lemvori-admin":
                raise ValueError("Потрібне розширення .lemvori-admin")
            signing = self.signing_material()
            if signing is None:
                return
            envelope = issue_first_admin(*signing, server_id=server_id, **values)
            write_new(path, json.dumps(envelope, indent=2).encode("utf-8"), private=True)
            self.clear_first_admin()
            self.status.set(f"Файл першого адміністратора збережено: {path}")
            messagebox.showinfo("Перший адміністратор",
                "Файл підписано. Передайте його відповідальному за встановлення сервера закладу.",
                parent=self)
        except (ValueError, OSError) as error:
            messagebox.showerror("Перший адміністратор", str(error), parent=self)

    def issue(self):
        if not self.ready:
            return messagebox.showerror("Реєстр", "Спочатку відновіть пошкоджений реєстр.")
        try:
            record = self.collect_form()
        except (ValueError, OSError, TypeError) as error:
            return messagebox.showerror("Перевірте дані центру", str(error), parent=self)
        try:
            signing = self.signing_material()
            if signing is None:
                return
            envelope, grant = issue_license(
                *signing,
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
        path = Path(chosen).expanduser().absolute()
        if path.suffix != ".lemvori-license":
            return messagebox.showerror("Невірний тип файлу", "Потрібне розширення .lemvori-license", parent=self)
        if path.exists():
            return messagebox.showerror(
                "Файл існує", "Цей файл уже існує. Виберіть іншу назву, "
                "щоб не втратити стару підписану ліцензію.", parent=self)
        content = json.dumps(envelope, ensure_ascii=False, indent=2).encode("utf-8")
        grant["license_path"] = str(path)
        grant["license_sha256"] = hashlib.sha256(content).hexdigest()
        grant["status"] = "issued"
        updated = upsert(self.records, grant)
        try:
            write_new(path, content, private=True)
            try:
                if not license_matches_record(path, grant):
                    raise ValueError("Не вдалося перевірити щойно записаний файл")
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


def verify_exit_confirmation(app):
    app.update()
    app.vars["center"].set("Тестова чернетка")
    app.tk.call(app.protocol("WM_DELETE_WINDOW"))
    dialog = app.exit_dialog
    if dialog is None or dialog.grab_current() is not dialog:
        raise RuntimeError("Window close did not open a modal confirmation")
    app.request_exit()
    if app.exit_dialog is not dialog:
        raise RuntimeError("Repeated close opened a second confirmation")
    dialog.nametowidget("actions.stay").invoke()
    if app.exit_dialog is not None or app.vars["center"].get() != "Тестова чернетка":
        raise RuntimeError("Cancel lost unsaved work or left the dialog open")
    app.request_exit()
    app.tk.call(app.exit_dialog.protocol("WM_DELETE_WINDOW"))
    if app.exit_dialog is not None:
        raise RuntimeError("Closing the confirmation did not return to the editor")
    app.request_exit()
    app.exit_dialog.nametowidget("actions.finish").invoke()
    if app.tk.call("info", "commands", "."):
        raise RuntimeError("Confirm did not close the application")


if __name__ == "__main__":
    app = Publisher()
    if "--smoke" in sys.argv:
        verify_exit_confirmation(app)
    else:
        app.mainloop()
