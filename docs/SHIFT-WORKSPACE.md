# SOLVIA — reception desk and psychologist shift

Desktop remains the center workspace for administrators and reception. Android is psychologist-only. The ODS references inform the blue mobile header, concise menu, large fields and visit cards; SOLVIA keeps its own identity and clinical workflow.

## Reception and administrator desktop

«Прийоми за зміну» uses the server shift date and supports date selection, search by name/card number/phone, psychologist filtering, participant-specific attendance, and patient-card navigation with a return to the originating page. Reception opens this page by default. Administrator keeps the center overview and can open the shift page in the appointments group.

Tabs: active visits (scheduled/confirmed), completed consultations and excluded visits (cancelled/no-show/rescheduled). Draft appointments are excluded from the live desk. Counts represent patient visits, not unique people: the same person in two appointments produces two rows. Each group participant is counted separately. Completion does not archive the patient or finish their course.

The workspace refreshes every 30 seconds when visible. Completion appears only after a psychologist saves the consultation to the server. Attendance can be recorded by reception/admin only for today's scheduled/confirmed attendee with no saved consultation; repeat requests preserve the first timestamp. It is separate from booking confirmation. Moving a booking recreates its attendees and clears attendance for the new visit.

## Android psychologist

«Моя зміна» provides active and completed participant lists, attendance received from reception, and patient cards. Pending/blocked offline submissions are labeled separately and link to synchronization; they are not displayed as completed server consultations. A queued or already completed participant cannot start the same consultation again from the new home list. The existing account-scoped encrypted offline cache, queue, documents, drafts and PDF workflows remain in place.

No reception/admin login is added to Android. A blue header opens the psychologist menu and keeps unsaved-form confirmation. The header is a navigation aid, not an SOS service.

## API / upgrade

- `GET /api/shift-workspace?date=YYYY-MM-DD`: admin/reception only; explicit operational projection, no clinical note or risk fields.
- `POST /api/appointments/:id/arrival`, body `{"patient_id":123}`: admin/reception only, today's eligible attendee.
- `GET /api/appointments`: adds `patient_no`, `arrived_at` and `completed_at` to attendee metadata; existing role filtering remains.
- Schema adds `attendees.arrived_at` and `attendees.arrived_by` idempotently. Existing data stays intact; first startup applies migration through the existing schema flow.

Deploy server and frontend together for the reception page. Updated Android can read older appointments responses but the older server cannot provide attendance or partial group completion metadata. Verify desktop installers and the native APK in CI and on center devices before distributing. This change does not establish 40-user capacity or production readiness for all previously audited concerns.

## Checks

`node tests/shift-workspace.mjs` covers participant classification, filtering and repeated visits. PostgreSQL integration covers arrival permissions, idempotence, date/status restrictions and private-data boundaries during partial group completion. Browser regression covers attendance, tabs, filtering, patient-card return and reception menu. Android instrumentation covers participant completion alongside existing native/offline workflow tests.
