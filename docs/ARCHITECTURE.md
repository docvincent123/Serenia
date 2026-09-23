# Архітектура SOLVIA 1.1

## Топологія

`Android / Solvia.exe → HTTPS 8443 (SOLVIA Caddy) → 127.0.0.1:8765 SolviaServer → 127.0.0.1:5432 PostgreSQL`.

На серверному ПК desktop WebView2 може звертатися безпосередньо до loopback API. Android та інші клієнти у локальній мережі заходять тільки через Caddy HTTPS.

PostgreSQL налаштований на `listen_addresses=localhost`; порт 5432 не відкривається у Windows Firewall. SOLVIA Caddy слухає 8443, а firewall rule дозволяє доступ лише з `LocalSubnet` у Private network profile. Це не конфліктує з RehaFlow, який може використовувати HTTPS 443 на тому самому ПК.

## Компоненти

- `SolviaServer.exe`: C++20 API, RBAC, бізнес-правила, PostgreSQL.
- `Solvia.exe`: Win32 + WebView2 оболонка.
- `frontend/`: React/Vite UI для desktop і mobile viewport.
- `android/`: Android WebView container із HTTPS-only політикою.
- `installer/`: PostgreSQL/Caddy/LAN setup, autostart, IP repair, Inno Setup recipe.

## Початкова ініціалізація

Setup запитує логін і пароль першого адміністратора та передає їх серверу тільки через process environment `SOLVIA_ADMIN_LOGIN` і `SOLVIA_ADMIN_PASSWORD` на час `--init`. Сервер хешує пароль PBKDF2-HMAC-SHA256 і зберігає лише hash+salt.

Окремий пароль PostgreSQL ролі `solvia` генерується випадково. Connection string зберігається в `C:\ProgramData\QureMed\SOLVIA\server.env`; файл ACL-обмежений системою, адміністраторами та користувачем, що встановив систему.

## Доступ

| Дані / дія | Адмін | Реєстратура | Психолог | Керівник |
|---|---|---|---|---|
| Працівники та ролі | створення/редагування | ні | ні | ні |
| Кабінети | керування | довідник | довідник | ні |
| Реєстраційні дані пацієнтів | усі | усі | тільки свої | ні |
| Сім’ї | створення/перегляд | створення/перегляд | назва в картці | ні |
| Детальний календар | усі | усі | тільки власний | ні |
| Бронювання/перенесення/скасування | так | так | ні | ні |
| Записи консультацій | перегляд усіх | ні | тільки власні | ні |
| Результати анкет | ні | ні | тільки власні | ні |
| Звіти за зміну | перегляд усіх | ні | створення/свої | ні |
| Агрегована статистика | так | ні | ні | так |
| Audit log | так | ні | ні | ні |

UI не є межею безпеки. Кожен endpoint повторно перевіряє роль на сервері. Для психолога сервер також перевіряє `patient.psychologist_id == currentUser.id`.

Останнього активного адміністратора не можна деактивувати або перевести в іншу роль. Активний адміністратор не може вимкнути власний акаунт.

## Приватність

Сімейний зв’язок не є дозволом читання. Тексти consultations доступні тільки психологу-власнику та адміністратору для контролю якості/роботи. Реєстратура і Director їх не отримують. Director не має endpoint списку пацієнтів або детального календаря.

Audit записує actor/event/entity/id, але не текст психологічної нотатки.

## Android/TLS

Android дозволяє тільки HTTPS, довіряє system + user CA store, не виконує `SslErrorHandler.proceed()` і блокує сторонні origins. Локальний CA Caddy експортується як `QureMed-Local-CA.crt` для встановлення на планшети центру.

## IP сервера

Інсталятор автоматично вибирає IPv4 активного Wi-Fi/Ethernet інтерфейсу з default gateway, ігноруючи Docker/WSL/Virtual/Bluetooth/Loopback. IP записується у server.env і Caddy certificate config.

Якщо DHCP змінює IP, `installer/Repair-Network.ps1` повторно визначає адресу та перебудовує Caddy конфіг. Для стабільної експлуатації рекомендована DHCP reservation для серверного ПК.

## Автозапуск

Windows Task Scheduler task `SOLVIA Local Server` стартує від SYSTEM при завантаженні Windows. Він запускає loopback API і окремий SOLVIA Caddy на 8443. PID цього Caddy зберігається окремо, тому мережевий repair SOLVIA не зупиняє Caddy RehaFlow. Точний шлях до `caddy.exe` зберігається в server.env, тому автозапуск не залежить від user PATH.

## Дані

PostgreSQL таблиці: `users`, `sessions`, `families`, `patients`, `rooms`, `appointments`, `attendees`, `consultations`, `shift_reports`, `assessments`, `audit`, `outbox`, `module_settings`.

Конфлікт бронювання психолога, кабінету й пацієнта перевіряється сервером всередині транзакції. Унікальність consultation для appointment+patient також захищена constraint.

## Резервування

Для production потрібно додати scheduled `pg_dump`, шифроване сховище копій та автоматичний restore-test. PostgreSQL база не повинна копіюватися простим копіюванням data directory під час роботи сервісу.

## Майбутні модулі

`module_settings`: payments, reminders, consents, patient_portal, rehaflow. `outbox` зарезервований для нагадувань та інтеграцій.

