# SOLVIA Android 3.1.0

Android versionCode 33; package com.quremed.solvia.

The connection badge sits next to the emblem and shows green Онлайн, red Офлайн, or amber Перевірка while reconnecting. It indicates center-server reachability, not public Internet access. Network loss changes it immediately when no active network remains; polling verifies server availability. Tapping opens transfer status.

Active and archive lists use one native vertical scroll container with pull-down refresh at the top. Automatic appointment checks remain once a minute and on network recovery, without replacing the screen. Refresh-list/message buttons were removed. Messages preserve their scroll offset during automatic refresh.

Two optional clinician-selected fields: emotional state and follow-up plan. No assessment is chosen by default. Choices persist in encrypted drafts and are included in state/recommendation text when finalizing, including offline. The server draft normalizer retains the two optional bounded fields; deploy the updated server to preserve these choices in remote draft recovery. No SQL migration.

Build and native regression validation run on the PR. Production APK signing uses the permanent owner key from the first signed 3.0.0 release, outside git. Update bundles contain only APK and release.json.
