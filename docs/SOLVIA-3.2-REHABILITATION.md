# SOLVIA 3.2 · Patient & Rehabilitation (stacked development PR)

## Architecture / users
- Linux/PostgreSQL is the source of truth; Windows/Linux Center remains for admin, reception and director.
- **Psychologists use the existing native Kotlin Android app**: Patients → patient card → Rehabilitation plan. There is no new web app or administrative menu on their phones.
- All new patient-linked clinical endpoints require an authenticated assigned psychologist or an admin; reception cannot read clinical rehabilitation goals.
- No new staff roles are introduced here. Interdisciplinary therapists, cross-specialist assignments and signed approvals need a separate access/clinical governance design before rollout.

## Delivered in this branch

1. Additive PostgreSQL migration: rehabilitation_goals, rehabilitation_goal_updates, center_document_templates. Existing patient courses/consultations/documents remain unchanged.
2. Plan goals linked to active patient courses, planned/in-progress/achieved/paused statuses, date and measurement targets, recorded updates and revision conflicts (409). Only the assigned psychologist may create/change goals. Administrator can read but not write clinical goals.
3. Desktop patient card: role-scoped longitudinal activity timeline, clinical goals under Follow-up, progress updates and standalone A4 plan print/PDF via browser print. Printout has unsigned signature placeholders; not a qualified electronic signature.
4. Android PatientWorkspace: single native route to a patient's plan from their summary, goal creation and progress updates. **Goal updates require connectivity**; existing offline consultation drafts and notifications are not changed.
5. Admin document-template composer in Settings → Documents. Plain-text templates can be activated/deactivated without modifying previously signed documents. Staff choose an active template in desktop and Android patient document creation. Supported placeholders: {{patient_name}}, {{patient_no}}, {{today}}. Staff reviews each filled form before collecting handwritten signature or recording refusal.
6. Role-specific desktop quick actions retain access to all secondary existing modules.

## Dependencies and release path
This branch is based on \`ux/solvia-focus-workspaces\` (PR #22), which depends on the SOLVIA 3.1 PR #21, in turn stacked over earlier centre integration and Android-delivery branches. The default \`main\` branch is still the old Windows MVP.

**Do not deploy or merge into main by skipping the stacked history.** Merge/rebase the parent chain after checks pass and migration ordering is confirmed. Install matching server and clients together. A phone production APK requires signing with the same existing production key; GitHub test packages are not production updates.

## Test checklist before physical rollout
- Backend CI/PostgreSQL: run \`tests/integration.py\` with the real server and disposable DB. New cases \`test_z_rehabilitation_goal_workflow\` and \`test_zz_centre_document_templates\` validate role isolation, update revision, archived courses and template activation.
- React build plus Playwright regressions on Windows WebView2 and Linux GTK/WebKit.
- Android CI build and emulator tests, then physical Android test: patient list, new consultation, encrypted draft recovery, rehabilitation goal, form template and signature, notifications and reminders.
- Verify reception receives no rehabilitation text from endpoints and TV never receives clinical plan contents.
- Print A4 with long goals and Ukrainian characters; preview and test PDF export. Do not call printed names a signed document without signature.
- Perform a real backup + isolated restore and test reconnect/shift-close while 30–40 staff simulate load. No physical testing or deployment is claimed in this PR.

## Planned, not yet delivered
- Complete arbitrary file attachments (malware scanning, storage quota, MIME validation, encryption and authorized download).
- Full multidisciplinary therapy roles and goal assignment beyond the currently assigned psychologist.
- Versioned legally approved consent templates, true electronic signatures or eHealth/ЕСОЗ interoperability.
- Offline modification/merge of rehabilitation goals on Android (only consultation drafts support offline writing today).
- Physical center acceptance and finished Stable 3.1 release packaging.
