# Android: first launch and reinstall without repeated SOLVIA connection files

This feature extends `feature/rehab-center-readiness`. It does **not** silently
back up clinical data or preserve employee login after deleting the app.

## Current ordinary phone

1. Server Console → Settings → Connection → export `SOLVIA-Mobile.solvia`.
2. Open it once from the Android app. The profile contains the HTTPS URL,
   center name and `server_id` (64 hex characters), but no password/token.
3. Android verifies HTTPS and `GET /api/health` server_id, saves connection
   settings and shows the psychologist login. App restarts and signed APK updates
   preserve settings. The login remains separate and is checked every shift.
4. **Uninstalling** generally removes the stored app settings; the file must be
   imported again. `android:allowBackup=false` is preserved because the app
   contains sensitive offline patient data. Avoid enabling blanket Android
   backup solely to retain the endpoint.

## Managed Android phones / work profiles (new)

Android Enterprise / EMM/MDM can keep the organization policy outside app data
and supply the center settings again after an app reinstall.

Provision these managed app configuration keys for `com.quremed.solvia`:

| Key | Example | Details |
| --- | --- | --- |
| `solvia_https_url` | `https://solvia.center.example:8443` | Stable FQDN, HTTPS only; no username, path, query or fragment |
| `solvia_server_id` | 64 lowercase hex characters from Server Console | Corresponds to `/api/health.server_id` |

The app registers `res/xml/app_restrictions.xml`, reads
`RestrictionsManager.applicationRestrictions`, validates both settings,
connects to the provided HTTPS server **with TLS verification**, confirms
`server_id`, saves the endpoint locally, then shows the **psychologist login**.
Without an EMM profile the original file workflow remains in place.

The app does not save a password or authorization token through MDM, does
not disable TLS verification, and does not import clinical data from managed
settings. A changed managed hostname is **not** silently substituted for an
already configured one: unsent drafts might still belong to the old server;
the administrator must ensure synchronization and a safe transition first.

### On-premises prerequisites

- Configure DNS usable from every phone (including the expected VPN route).
- Deploy a trusted, hostname-matching CA/certificate to managed devices.
- Keep the HTTPS hostname stable when changing the LAN IP or moving to VPS.
- Configure devices with an Android Enterprise-compatible management provider.
  Managed configuration is **not** persistent magically on unmanaged Android.
- Install the production APK with the same permanent signing key on upgrades;
  the debug/test package differs and must not replace real center devices.
- Admins configure the phones, **psychologists** sign into the current Android app.
  Admin desktop account cannot use the psychology-only Android login.

### Acceptance checklist

- Fresh MDM-managed phone → app starts without file, verifies server identity,
  then asks for psychologist login.
- Remove and reinstall managed app → policy is reapplied by EMM → same center,
  no password or session silently restored.
- Normal unmanaged phone → file import once per installation.
- Signed APK update in place → remembered center and encrypted drafts intact.
- Missing managed keys, invalid URL, wrong server ID or untrusted TLS →
  failure with explanation, never fallback to unencrypted HTTP.
- MDM policy with changed endpoint → old server drafts are not silently
  abandoned; requires operator-led cutover.
- Reconnect after outage, revoke lost device, refuse unauthorized role,
  verify no patient details leak in logs/notifications.

## Additional startup features for future work

1. Device register/approve/revoke workflow with operational status in
   Server Console, auditable and suitable for lost phones.
2. Check for required app/server/API version and show a genuine compatibility
   error instead of proceeding with an incompatible upgrade.
3. Guided first-run health checklist: server, TLS, shift open, role permission,
   battery/notification policy, offline storage readiness, sync queue.
4. Fast admin recovery: show saved center / identity without exposing patient
   information; allow re-import or re-provision only when outstanding data is
   reconciled.
5. Add automatic managed-config change handling and EMM feedback / app states;
   current support reads on launch and allows a manual retry from setup.
6. Validate device enrollment/reinstall with a real Android Enterprise MDM,
   not only Android emulator tests. MDM provisioning requires actual policy
   deployment by an administrator; this PR does not configure an EMM.

Never promise indefinite authentication on a medical device or automatic transfer
of unsent records across app uninstallation; neither is safe or guaranteed.
