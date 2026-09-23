# Приймання SOLVIA 0.3

CI має завершити два незалежні потоки: Windows/PostgreSQL та Android.

## PostgreSQL/API

`tests/integration.py` запускає справжній `SolviaServer` проти PostgreSQL 17 і синтетичних даних.

Перевіряється:
- вхід усіх чотирьох ролей та 401 без сесії;
- створення працівника адміністратором;
- створення сім’ї та пацієнтів;
- ізоляція пацієнтів між психологами;
- заборона director читати пацієнтів і детальний календар;
- заборона reception читати stats або створювати users;
- конфлікти психолога/кабінету/пацієнта;
- приватна consultation тільки для призначеного психолога;
- відсутність приватної нотатки в admin/reception responses;
- агрегована статистика director без приватного тексту;
- group appointment;
- assessment link/result;
- конкурентне бронювання;
- збереження даних і сесій після рестарту сервера.

## Windows

CI:
1. збирає React;
2. збирає `SolviaServer.exe` із libpq і `Solvia.exe` із WebView2;
3. кладе `ui/` поруч з EXE;
4. запускає desktop smoke-test і перевіряє WebView2 child window;
5. формує portable artifact;
6. компілює Inno Setup у `SOLVIA-0.3.0-Setup-EXE`.

Ручне приймання інсталятора на чистому Windows ПК:
- запуск від адміністратора;
- PostgreSQL встановлюється автоматично;
- користувач задає пароль admin;
- IP визначається автоматично;
- показується `https://<LAN-IP>`;
- після restart Windows API та HTTPS запускаються без ручного BAT;
- порт 5432 недоступний з іншого пристрою LAN;
- порт 443 доступний у локальній підмережі.

## Android

CI має створити `SOLVIA-Android-test-APK` та пройти Android lint.

Ручний сценарій:
1. Android підключений до Wi-Fi центру.
2. Встановлений `QureMed-Local-CA.crt`.
3. У SOLVIA введена адреса `https://<server-ip>`.
4. Психолог входить своїм логіном.
5. Бачить власний календар та тільки своїх пацієнтів.
6. Відкриває картку, додає consultation/note/goals/next plan/homework.
7. На desktop керівника змінюється агрегована статистика.
8. Reception/admin/director не отримують приватний текст через API.

Критерій релізу: green Windows build, green PostgreSQL integration tests, green Android build/lint і ручний LAN сценарій на реальному серверному ПК/Android-планшеті.
