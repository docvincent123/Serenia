# SOLVIA Android 3.2 / Server and PC 2.4

Update the server/PC first, then publish the permanently signed Android APK and release.json.
Existing records, accounts and the signing identity are retained. SQL upgrades are additive.

## Delivered behaviour
- Shared yellow brand and labelled success/problem/pending statuses.
- Active consultations remain visible after scheduled time passes.
- Arrival and actual start are separate, idempotent, per participant.
- Participant cancellation/no-show does not erase another participant’s completed record.
- A single scrolling consultation form preserves edits and its saved scroll position.
- Automatic schedule refresh and pull-down refresh; no separate refresh button on phone.
- Completed notes remain immutable. Only their psychologist may append a dated, reasoned clarification; admin may read it, reception/director cannot.
- Goal progress is an append-only timeline; psychologist sees their own records, administrator sees authorized records.
- Admin device panel uses heartbeat epoch, counts and version, without clinical text. Stale reports mean unknown current state, never an empty queue guarantee.
- Shift closure checks unfinished visits, pending/blocked queues, missing and stale reports. Resolve visits and connect today’s phones before closing; no automatic finalization of notes.
- PC document printing checks patient, document text/date and signed-document signatures.
- Backup warning appears when no successful copy is known within 36 hours or the latest operation failed.
- Android updates may first be offered to selected psychologists, then to everyone using the same release/APK.

## Automated verification
CI builds native Windows/server and Android packages, runs PostgreSQL integration/privacy checks, browser UI regressions, native Android instrumentation and install-over preference preservation.
The integration suite contains a 40-account concurrent write scenario: booking, arrival, start, schedule authorization, completion, same-key retry and queue heartbeat. It reports request count, errors, duplicates and p95/max latency.
These measurements describe CI hardware, not the center’s server or Wi-Fi.

## Physical-phone acceptance — requires the center’s devices
Use synthetic patients and a test appointment. Do not use real clinical data.
1. Grant notifications and exact-alarm access where offered. Use Settings → test ring and test notification.
2. Book a visit at least five minutes ahead; keep the screen locked. Verify one alert two minutes before its start, dismiss/silence it and verify it does not repeat.
3. Repeat with the activity swiped away and after reboot. Force-stop is a separate Android restriction: relaunch is required; do not promise alerts while force-stopped.
4. Repeat with the manufacturer’s battery saving modes. Record phone model, Android version, permissions, battery mode, scheduled and actual alert times.
5. Load the assigned visit, disconnect Wi-Fi, type and finish a synthetic consultation. Confirm pending marker and readable local archive; reconnect and verify exactly one server record and disappearing pending marker.
6. Cancel a cached upcoming visit while the phone is disconnected, then reconnect. Verify the cancellation is fetched and its reminder removed. An offline phone cannot know a new server-side cancellation immediately.
7. Install the new APK over the existing signed production app; verify server configuration, encrypted notes and pending queue remain. Test the pilot update group before widening availability.
8. Test 40 devices on the center’s actual Wi-Fi: simultaneous booking/arrival, reminder receipt and network reconnection. Record latency and missing alerts; CI cannot measure delivery on physical phones.

## Known operational boundaries
Background refresh is Android-scheduled and can be delayed; it is not instantaneous push. Preloaded reminders use Android alarms. Server monitoring is the last self-reported device state. Different server/client clocks do not affect heartbeat freshness, which uses server epoch.
No production rollout, public release or real-device pass is implied by CI results.
