# Lemvori Care 3.13 · build 182046

Package version: `3.13.0`. Native application / Debian package: `3.13.0+182046`.
Android versionName: `3.13.0`; versionCode: `182046`.

## Native workplace and administration

- Input text, placeholders and selections use explicit colors on light form surfaces, including when the operating system uses a dark theme. The admin editor uses the shared dropdown delegate so selected options remain readable.
- “Вітаємо в Lemvori Care!” is a home-page element, rather than a persistent global status message shown in every section. Operational success and error messages remain available.

- Consistent rounded selectors with clipped, scrollable option lists and full-text tooltips across registration, appointments, documents, rehabilitation and administrative editors.
- Staff and permissions editors use the overlay dimensions and actual scroll viewport; staff fields adapt to one or two columns.
- Administrative record actions move below the record on narrow screens.
- Registration columns share available space and align at the top; the empty birth date no longer displays an invalid-date error from an input mask.
- Profile has an explicit bounded height and scrollable content. Discharge review and printable form content use their scroll viewport widths.
- The existing reception, director and administrator workflows continue to use server-side role and module restrictions.

## Distribution of updates

Open **Lemvori Care Admin → Адміністрування → Оновлення пристроїв**.
Choose an installable package, enter its semantic version and release notes, then publish:

| Platform | Package | Maximum size | Installation |
| --- | --- | --- | --- |
| Android | Production APK, same package name and signing certificate | 8 MiB | Device checks the center server; Android asks the employee to approve installation |
| Windows | Complete EXE installer, including Qt dependencies | 32 MiB | Download and run installer after saving work and closing the program |
| Linux | Native DEB, or existing tar.gz client installer | 32 MiB | Install DEB with the system package manager, or run install-client.sh from the archive |

For Android, the build number must match the APK's versionCode. Optional comma-separated IDs restrict the rollout to active psychologists. Empty pilot IDs publish to all compatible mobile accounts. The inventory shows the installed version and freshness of the latest Android heartbeat; it does not claim an installation succeeded until the device reports its version.

On native PCs, open **Профіль → Оновлення програми** to obtain the package published for the current operating system. The client bounds the download, rejects redirects, checks SHA-256 and package magic, then atomically saves the installer. No installer is executed automatically. Rejected downloads preserve an existing destination file.

Package publication is restricted to authenticated administrators in the separate admin edition. Packages remain on the center server. This uses the existing server update APIs; deploying DEB support requires updating the server as well as the native client.

This release does not implement MDM or silent remote installation. Android signatures and installation approvals remain enforced by the device. Windows CI currently supplies the portable Qt application directory; wrap that directory in a complete EXE installer before publishing it through the update center. Do not publish a bare portable executable as an installer.

## Validation

The native HTTPS and UI tests exercise registration and paper consents, patient records, referrals, booking, waiting lists, handovers, supervision, documents, recovery, module permissions and administrative forms. Update tests cover publication, platform mismatch, inventory, a verified DEB download and rejection of a corrupt checksum without overwriting a file. The real server integration suite covers DEB distribution alongside EXE and tar.gz.
