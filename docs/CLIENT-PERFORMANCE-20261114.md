# Lemvori Care: desktop and Android refresh reliability

Based on `feature/lemvori-3-13-build-182046` (Qt Native).

## Desktop

A refresh in progress retains its generation until every request in that batch
finishes. Repeated timer, navigation and post-mutation triggers request a single
follow-up batch. Slow replies therefore remain usable, and requests do not pile
up across refresh generations. Network errors release the batch just like success;
logout clears the queue and makes old completions inert.

Shift, overview, visits, appointments, roster and system models emit `dataChanged`
only when their payload changes. The last-refresh clock still updates after a
successful overview response.

## Android

The home list indexes the encrypted consultation queue once per snapshot, keyed
by appointment and participant. Completion checks use map lookups instead of
rebuilding and scanning the entire queue for each row and tab count.

A successful appointment poll compares both server entries and local queue states.
A locally finished consultation moves to the shift archive even if the server
entries are unchanged. The sent indicator updates after acknowledgement. Identical
snapshots retain the existing views and scroll position.

## Verification

- `tests/native-qt-refresh.py` exercises the compiled bridge against a slow HTTPS
  fixture: repeated triggers, unchanged model signals, a failed request, logout
  during refresh and a subsequent login. Run with
  `python3 tests/native-qt-refresh.py build/native-linux/lemvori-native-refresh-check`.
- Existing native workflow, UI and settings suites remain in the Linux CI job.
- Android `VisitStateTest` covers participant/appointment separation, last actionable
  queue state and local completion before server acknowledgement.
- Android `HomeRefreshTest` exercises the actual cached home view, unchanged-view
  identity, active-to-archive transition and acknowledgement indicator on an emulator.

This is a targeted refresh optimization, not a measured end-to-end speed claim.
Device performance and deployment to the center require validation with the real
server and representative synthetic workloads.
