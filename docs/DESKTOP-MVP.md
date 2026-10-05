# SOLVIA desktop workspace MVP

The React workspace is shared by the Linux Admin browser window and the Windows
WebView2 client. This redesign keeps the existing API and database schema.
Desktop/server remains 2.2.0; Android remains 2.3.0.

## Navigation

| Role | Sections |
| --- | --- |
| Administrator | Overview; scheduling; patients/families/archive; team/rooms/supervision; reports/workload/devices/audit; system settings |
| Reception | Scheduling/waiting list; patients/families/archive |
| Psychologist | Own calendar; own patients; supervision; shift report |
| Director | Overview; supervision; workload |

Section headers expand and collapse. The current section opens automatically
when a patient card or search result is opened. “Find a menu section” searches
module names locally without loading patient data. Profile settings and logout
stay outside the scrolling module list.

The workspace uses a navy sidebar, white header, consistent surfaces, spacing,
forms and table styling across the existing screens. Narrow browser windows use
a drawer instead of a horizontally scrolling list of modules. Escape closes the
drawer and returns focus to its opener; Tab stays inside it. Resizing to desktop
closes the drawer. Existing dialogs also contain keyboard focus.

## Behavioral fixes

- Delayed search responses cannot replace results for a newer or cleared query.
- Search results link only to screens available to the signed-in role.
- Returning from a patient card preserves its originating screen, including archive.
- A failed shift request offers retry instead of leaving only an indefinite spinner.
- Shift state refreshes every 30 seconds so other clients notice open/close changes.
- Navigation resets the workspace scroll position.

Server authorization is still required for every API operation. Menu visibility
does not grant access. This is an MVP of the shared desktop workspace, not an
independent security audit or a rewrite of the Android app.

## Validation and acceptance

Run the React build, existing connection/session/draft tests and
`tests/ui-regression.mjs` against the built bundle. Browser coverage includes
four role menus, menu filtering, archive return, delayed search, keyboard drawer,
shift request retry and the existing waiting-list/draft/offline-logout flows.
The design-regression job uploads screenshots using synthetic data only.

Before distribution, check the built Windows client and Linux Admin on the
center's screen sizes. Confirm registration/calendar, patient cards and documents,
settings, closing/opening a shift, and a consultation save after a Wi-Fi interruption.
Do not replace a center's existing installation until its data backup is verified.
