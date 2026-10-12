# SOLVIA 2.2: installation, updates and product delivery

## Supported clients

- Linux server and Linux Admin: Ubuntu 24.04 compatible x64 distributions, PostgreSQL and systemd.
- Windows client: Windows 10/11 x64 and Microsoft WebView2.
- Mobile: Android 8+; the native app provides calendar, patients, consultation notes, reports, device management, account settings, director statistics and supervision. Courses, document signing and the full administration interface remain available in the HTTPS browser interface. No iOS native build is included.

Operational settings are stored on the server. Hours, weekdays, slot step, standard duration and session lifetime therefore apply to all clients. Display preferences stay on the current device. Changing a password revokes all account sessions.

## Producing an update

The `SOLVIA verified product release` workflow builds and tests Linux, Windows and Android before creating a **draft** GitHub release. It calls the same integration, installer and Android workflows used by pull requests. Published release assets are immutable; fixes require a new version.

1. Update CMake, Inno Setup, frontend and Android versions together; Android versionCode must increase.
2. Configure the permanent Android production signing secrets below. Keep a separate, secure backup of the signing key; do not commit it to this repository.
3. Run the release workflow on the intended branch or push the matching `vX.Y.Z` tag.
4. Review the generated draft and test it on the center's actual Windows PC and Android device, including LAN certificate trust.
5. Publish the draft when approved. Only published releases appear in GitHub `/releases/latest`, which the Linux updater uses.

A release includes the Linux tar.gz, Windows setup EXE, signed production Android APK and a SHA-256 file for each package. Ordinary PR builds create a **test** APK using package `com.quremed.solvia.test`; it is separate from the production app and is not an update channel for paying customers.

## Android signing secrets

GitHub Actions secrets required for a production release:

- `SOLVIA_ANDROID_KEYSTORE_BASE64`: base64 encoding of the production JKS keystore.
- `SOLVIA_ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `SOLVIA_ANDROID_KEY_ALIAS`: signing key alias.
- `SOLVIA_ANDROID_KEY_PASSWORD`: key password.

Generate a key locally with `keytool -genkeypair -keystore solvia-production.jks -alias solvia -keyalg RSA -keysize 3072 -validity 10000`. Enter passwords interactively. Save the same key for every later APK. Production publishing fails early when signing configuration is absent; an unsigned APK is never substituted for it.

## Customer updates

Linux: `sudo solvia-admin check-update`, then `sudo solvia-admin update`. The updater downloads only the official repository release, verifies SHA-256, takes a pre-update database backup and uses the existing install/upgrade procedure. If no public release exists, it explains that fact and leaves the installed application running. Database snapshots remain in `/var/backups/solvia`.

Windows: open **My settings → Official releases**, download the setup matching the release, and install over the current client. Select **Workstation — connection to Linux server**. The database stays on the Linux server.

Android: open **Settings → SOLVIA updates** and install the production APK with the same signing key. The saved HTTPS server address remains. The OS asks the user to approve APK installation.

All versions require the center's CA certificate to be trusted. A server-address change may require a new server certificate and a new `.solvia` connection file. The browser and Android app never disable certificate verification.

## Product scope and remaining launch work

Included operational modules: registration, appointments, consultation cards, family links, self-observation questionnaire, reports, courses/archive, referrals, consents, supervision, workload/statistics, session administration, database backup/restore and audited operational settings.

Payments, paid feature entitlements, SMS/Telegram delivery, RehaFlow integration and an iOS native app are not implemented payment or integration products. They must be delivered as tested modules with their own migrations, role checks and release notes before being offered to customers. The repository does not claim that a placeholder enables a paid feature.

Before the first production sale, configure Android signing and publish the reviewed release, perform the real-device acceptance scenario, and agree support and backup procedures with the center. The CI results cover synthetic data on clean build machines; they do not substitute for this center's network and devices.
