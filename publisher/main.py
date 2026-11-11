"""Lemvori Control: native publisher console. No patient data is requested."""
import datetime as dt
import json
import sys
import os
import tkinter as tk
from tkinter import ttk,filedialog,messagebox,simpledialog
from pathlib import Path
from license_core import CATALOG,create_keys,issue_license,write_new,resolve_modules,calendar_expiry

class Publisher(tk.Tk):
    def __init__(self):
        super().__init__();self.title('Lemvori Control · 1.0.0 preview1');self.geometry('1000x700');self.minsize(900,680);self.configure(bg='#EDF0F0')
        font_family='Segoe UI' if sys.platform=='win32' else 'DejaVu Sans'
        style=ttk.Style(self);style.theme_use('clam');style.configure('.',font=(font_family,11),background='#EDF0F0',foreground='#11212D');style.configure('TButton',padding=10);style.configure('TEntry',padding=4);style.configure('Title.TLabel',font=(font_family,23,'bold'))
        self.registry_path=Path(os.environ.get('LEMVORI_CONTROL_HOME',str(Path.home()/'.lemvori-control')))/'centers.json';self.records=[];self.key_path=tk.StringVar();self.key_label=tk.StringVar();self.vars={};self.modules={};self.workflow_vars={};self.apply_workflow=tk.BooleanVar(value=False)
        try:
            self.records=json.loads(self.registry_path.read_text(encoding='utf-8'))
            if not isinstance(self.records,list) or any(not isinstance(record,dict) or not isinstance(record.get('center'),str) or not isinstance(record.get('server_id'),str) for record in self.records):raise ValueError('Invalid center registry')
        except FileNotFoundError:pass
        except (ValueError,OSError):messagebox.showerror('Реєстр','Не вдалося прочитати реєстр центрів. Збережіть його копію перед подальшою роботою.');self.registry_path=None
        body=ttk.Frame(self,padding=20);body.pack(fill='both',expand=True)
        ttk.Label(body,text='Lemvori Control',style='Title.TLabel').pack(anchor='w');ttk.Label(body,text='Центри, підписані ліцензії та доступні модулі').pack(anchor='w',pady=(3,15))
        keys=ttk.Frame(body);keys.pack(fill='x');ttk.Button(keys,text='Новий ключ видавця',command=self.create_key).pack(side='left');ttk.Button(keys,text='Вибрати ключ',command=self.pick_key).pack(side='left',padx=8);ttk.Button(keys,text='Запит центру',command=self.import_center).pack(side='left');ttk.Label(keys,textvariable=self.key_label,wraplength=220).pack(side='left')
        tabs=ttk.Notebook(body);tabs.pack(fill='both',expand=True,pady=10)
        center_panel=ttk.Frame(tabs,padding=10);module_panel=ttk.Frame(tabs,padding=12);workflow_panel=ttk.Frame(tabs,padding=12)
        tabs.add(center_panel,text='Центр і ліцензія');tabs.add(module_panel,text='Модулі');tabs.add(workflow_panel,text='Правила роботи')
        center_panel.columnconfigure(1,weight=1)
        for row,(key,label,initial) in enumerate([('center','Назва центру',''),('server_id','Ідентифікатор сервера',''),('center_id','Постійний ID центру',''),('max_users','Активних працівників','40'),('max_devices','Android-пристроїв','40'),('expires','Строк до: РРРР-ММ-ДД; порожньо — безстроково',''),('support','Підтримка до: РРРР-ММ-ДД','')]):
            ttk.Label(center_panel,text=label,wraplength=300).grid(row=row,column=0,sticky='w',padx=(0,16),pady=3)
            variable=tk.StringVar(value=initial);self.vars[key]=variable;ttk.Entry(center_panel,textvariable=variable).grid(row=row,column=1,sticky='ew',pady=3)
        ttk.Label(module_panel,text='Доступні функції центру',font=(font_family,14,'bold')).pack(anchor='w',pady=(0,8))
        for module in CATALOG:
            value=tk.BooleanVar(value=True);self.modules[module['id']]=value
            item=ttk.Checkbutton(module_panel,text=module['name']+(' · базовий' if module['core'] else ''),variable=value,command=lambda name=module['id']:self.toggle_module(name));item.pack(anchor='w',pady=3)
            if module['core']:item.state(['disabled'])
        ttk.Label(module_panel,text='Залежності додаються автоматично. Вимкнення функції зберігає дані центру.',wraplength=800).pack(anchor='w',pady=10)
        ttk.Checkbutton(workflow_panel,text='Застосувати ці правила при активації ключа',variable=self.apply_workflow).grid(row=0,column=0,columnspan=2,sticky='w',pady=(0,10))
        workflow_panel.columnconfigure(1,weight=1)
        for row,(key,label,value) in enumerate([('opening_time','Початок роботи','08:00'),('closing_time','Завершення роботи','20:00'),('working_days','Дні: 1–7 без розділювачів','1234567'),('slot_step_minutes','Крок запису: 15, 30 або 60 хв','60'),('default_duration_minutes','Прийом за замовчуванням, хв','60'),('session_hours','Час сеансу входу, год','8')],start=1):
            ttk.Label(workflow_panel,text=label).grid(row=row,column=0,sticky='w',padx=(0,16),pady=4)
            variable=tk.StringVar(value=value);self.workflow_vars[key]=variable;ttk.Entry(workflow_panel,textvariable=variable).grid(row=row,column=1,sticky='ew',pady=4)
        actions=ttk.Frame(body);actions.pack(fill='x',pady=(0,10))
        ttk.Button(actions,text='Видати файл ліцензії',command=self.issue).pack(side='left')
        ttk.Label(actions,text='Приватний ключ зашифрований. Пароль не зберігається. Медичні картки залишаються в центрі.',wraplength=620).pack(side='left',padx=20)
        self.list=ttk.Treeview(body,columns=('center','server','support'),show='headings',height=3)
        for name,title in [('center','Центр'),('server','Сервер'),('support','Підтримка до')]:self.list.heading(name,text=title)
        self.list.pack(fill='x');self.list.bind('<<TreeviewSelect>>',self.load_center);self.refresh()
    def toggle_module(self,name):
        if self.modules[name].get():
            effective=resolve_modules([key for key,value in self.modules.items() if value.get()])
            for key,value in self.modules.items():value.set(key in effective)
        else:
            disabled={name}
            while True:
                dependent=disabled | {m['id'] for m in CATALOG if any(d in disabled for d in m['depends'])}
                if dependent==disabled:break
                disabled=dependent
            for module in CATALOG:
                if module['id'] in disabled and not module['core']:self.modules[module['id']].set(False)
    def refresh(self):
        self.list.delete(*self.list.get_children())
        for i,record in enumerate(self.records):
            support=dt.datetime.fromtimestamp(record['support_until'],dt.timezone.utc).date().isoformat() if record.get('support_until') else '—'
            self.list.insert('',tk.END,iid=str(i),values=(record['center'],record['server_id'][:16]+'…',support))
    def load_center(self,_):
        selected=self.list.selection()
        if not selected:return
        record=self.records[int(selected[0])]
        for key in ['center','server_id','center_id','max_users','max_devices']:self.vars[key].set(record.get(key,''))
        for key,field in [('expires','expires_at'),('support','support_until')]:self.vars[key].set(dt.datetime.fromtimestamp(record[field],dt.timezone.utc).date().isoformat() if record.get(field) else '')
        for key,value in self.modules.items():value.set(key in record.get('modules',[]))
        self.apply_workflow.set(bool(record.get('workflow')))
        for key,value in self.workflow_vars.items():
            if key in record.get('workflow',{}):value.set(record['workflow'][key])
    def import_center(self):
        path=filedialog.askopenfilename(title='Запит центру',filetypes=[('JSON','*.json')])
        if not path:return
        try:
            if Path(path).stat().st_size>65536:raise ValueError('Файл завеликий')
            request=json.loads(Path(path).read_text(encoding='utf-8'))
            if request.get('format')!='lemvori.center-request' or request.get('version')!=1:raise ValueError('Це не запит центру Lemvori Care')
            import re
            if not re.fullmatch('[a-f0-9]{64}',request.get('server_id','')):raise ValueError('Некоректний ID сервера')
            self.vars['server_id'].set(request['server_id']);self.vars['center'].set(request.get('center',''))
            previous=next((r for r in self.records if r['server_id']==request['server_id']),{})
            self.vars['center_id'].set(previous.get('center_id',''))
            for module in CATALOG:self.modules[module['id']].set(module['core'] or module['id'] in request.get('requested_modules',[]))
        except Exception as error:messagebox.showerror('Запит центру',str(error))
    def pick_key(self):
        path=filedialog.askopenfilename(title='Приватний ключ видавця',filetypes=[('PEM','*.pem')]);self.key_path.set(path or self.key_path.get());self.key_label.set(Path(self.key_path.get()).name if self.key_path.get() else '')
    def create_key(self):
        password=simpledialog.askstring('Захист ключа','Новий пароль приватного ключа (від 12 символів):',show='*',parent=self)
        if password is None:return
        again=simpledialog.askstring('Підтвердження','Повторіть пароль:',show='*',parent=self)
        if password!=again:return messagebox.showerror('Пароль','Паролі не збігаються')
        folder=filedialog.askdirectory(title='Папка для нового ключа видавця')
        if not folder:return
        try:
            private,public=create_keys(password);path=Path(folder)/'lemvori-publisher-private.pem';public_path=Path(folder)/'lemvori-publisher-public.pem'
            if path.exists() or public_path.exists():raise ValueError('У цій папці вже є ключі. Виберіть іншу папку.')
            write_new(path,private,private=True);write_new(public_path,public);self.key_path.set(str(path));self.key_label.set(path.name);messagebox.showinfo('Ключ створено','Збережіть резервну копію приватного ключа та його пароль. На сервери центрів передається лише публічний ключ.')
        except Exception as error:messagebox.showerror('Ключ',str(error))
    def issue(self):
        if not self.registry_path:return messagebox.showerror('Реєстр','Спочатку відновіть пошкоджений реєстр центрів.')
        password=simpledialog.askstring('Підпис ліцензії','Пароль приватного ключа:',show='*',parent=self)
        if password is None:return
        try:
            def stamp(key):
                value=self.vars[key].get().strip()
                return calendar_expiry(value)
            envelope,grant=issue_license(Path(self.key_path.get()).read_bytes(),password,
                center=self.vars['center'].get(),server_id=self.vars['server_id'].get().strip(),center_id=self.vars['center_id'].get().strip() or None,
                workflow={name:(int(value.get()) if name in ['slot_step_minutes','default_duration_minutes','session_hours'] else value.get().strip()) for name,value in self.workflow_vars.items()} if self.apply_workflow.get() else None,
                modules=[name for name,value in self.modules.items() if value.get()],max_users=int(self.vars['max_users'].get()),max_devices=int(self.vars['max_devices'].get()),expires_at=stamp('expires'),support_until=stamp('support'))
            path=filedialog.asksaveasfilename(title='Файл ліцензії для центру',defaultextension='.lemvori-license',initialfile='Lemvori-Care.lemvori-license')
            if not path:return
            write_new(path,json.dumps(envelope,ensure_ascii=False,indent=2).encode())
            self.records=[r for r in self.records if r['server_id']!=grant['server_id']]+[grant]
            self.registry_path.parent.mkdir(mode=0o700,parents=True,exist_ok=True);temporary=self.registry_path.with_suffix('.tmp');temporary.write_text(json.dumps(self.records,ensure_ascii=False,indent=2),encoding='utf-8');temporary.chmod(0o600);temporary.replace(self.registry_path)
            self.vars['center_id'].set(grant['center_id']);self.refresh();messagebox.showinfo('Ліцензія готова','Передайте центру створений файл. Приватний ключ залишається у вас.')
        except Exception as error:messagebox.showerror('Не вдалося видати ліцензію',str(error))

if __name__=='__main__':
    app=Publisher()
    if '--smoke' in sys.argv:app.after(900,app.destroy)
    app.mainloop()
