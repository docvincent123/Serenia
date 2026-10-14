package com.quremed.solvia

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.UUID

class AppointmentRemindersTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun appointment(at: String) = JSONObject().put("id", 91).put("start", at).put("status", "confirmed")
        .put("patients", JSONArray().put(JSONObject().put("id", 7).put("name", "Секретне тестове ім’я")))
    private fun awaitNotification(condition: () -> Boolean) {
        val end = android.os.SystemClock.elapsedRealtime() + 3000
        while(!condition() && android.os.SystemClock.elapsedRealtime() < end) Thread.sleep(50)
        assertTrue("Android notification state did not settle", condition())
    }
    private fun allowNotifications() {
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS").use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        }
    }
    @Test fun shiftStatusSurvivesRestoreAndNewAppointmentsAreNotRepeated() {
        allowNotifications()
        val base = "https://${UUID.randomUUID()}.invalid"; val uid = 778L
        val store = OfflineStore(context, base, uid); val day = LocalDate.now().toString()
        val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        try {
            store.saveSession(JSONObject().put("id", uid), "synthetic")
            store.saveCache("/api/shift-day", JSONObject().put("shift_date", day).put("open", true))
            val rows = JSONArray().put(appointment(day + "T23:50"))
            store.saveCache("/api/appointments?date=$day", rows)
            ShiftNotifications.refresh(context, base, uid)
            assertFalse(manager.activeNotifications.any { it.id == ShiftNotifications.NEW_ID && it.tag == null })
            ShiftNotifications.restore(context)
            awaitNotification { manager.activeNotifications.any { it.id == ShiftNotifications.SHIFT_ID } }
            val status = manager.activeNotifications.first { it.id == ShiftNotifications.SHIFT_ID }
            assertTrue(status.notification.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
            assertFalse(status.notification.extras.toString().contains("Секретне"))
            rows.put(appointment(day + "T23:55").put("id", 92))
            store.saveCache("/api/appointments?date=$day", rows)
            ShiftNotifications.refresh(context, base, uid)
            awaitNotification { manager.activeNotifications.any { it.id == ShiftNotifications.NEW_ID && it.tag == null } }
            manager.cancel(ShiftNotifications.NEW_ID)
            awaitNotification { manager.activeNotifications.none { it.id == ShiftNotifications.NEW_ID && it.tag == null } }
            ShiftNotifications.restore(context)
            assertFalse(manager.activeNotifications.any { it.id == ShiftNotifications.NEW_ID && it.tag == null })
            store.saveCache("/api/shift-day", JSONObject().put("shift_date", day).put("open", false))
            ShiftNotifications.restore(context)
            awaitNotification { manager.activeNotifications.none { it.id == ShiftNotifications.SHIFT_ID } }
        } finally { ShiftNotifications.clear(context); store.revokeSession() }
    }
    @Test fun connectionFilesResolveToInstalledAppAndTestRingStops() {
        allowNotifications()
        val explicitMime = android.content.Intent(android.content.Intent.ACTION_VIEW)
            .setDataAndType(android.net.Uri.parse("content://test/download/123"), "application/vnd.solvia.connection+json")
            .setPackage(context.packageName)
        assertNotNull(context.packageManager.resolveActivity(explicitMime, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY))
        val byExtension = android.content.Intent(android.content.Intent.ACTION_VIEW)
            .setDataAndType(android.net.Uri.parse("content://test/download/SOLVIA-Mobile.solvia"), "application/octet-stream")
            .setPackage(context.packageName)
        assertNotNull(context.packageManager.resolveActivity(byExtension, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY))
        AppointmentReminders.test(context)
        val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        awaitNotification { manager.activeNotifications.any { it.tag == "test" && it.id == 1 } }
        AppointmentReminders.stopTest(context)
        awaitNotification { manager.activeNotifications.none { it.tag == "test" && it.id == 1 } }
    }
    @Test fun originalToneResourceIsValidAndUsedByTheChannel() {
        context.resources.openRawResource(R.raw.solvia_consultation).use { stream ->
            val header = ByteArray(44); assertEquals(44, stream.read(header))
            assertEquals("RIFF", String(header, 0, 4, Charsets.US_ASCII))
            assertEquals("WAVE", String(header, 8, 4, Charsets.US_ASCII))
            val values = java.nio.ByteBuffer.wrap(header).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            assertEquals(24000, values.getInt(24)); assertEquals(1, values.getShort(22).toInt())
            assertEquals(16, values.getShort(34).toInt()); assertEquals(278400, values.getInt(40))
        }
        AppointmentReminders.channel(context)
        val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channel = manager.getNotificationChannel(AppointmentReminders.CHANNEL)
        assertTrue(channel.sound.toString().contains("/raw/solvia_consultation"))
    }
    @Test fun cancellationAndLocalCompletionRemoveScheduledAlarm() {
        val base = "https://${UUID.randomUUID()}.invalid"; val store = OfflineStore(context, base, 771)
        store.saveSession(JSONObject().put("id", 771), "synthetic")
        val at = LocalDateTime.now().plusHours(1).withSecond(0).withNano(0).toString()
        val rows = JSONArray().put(appointment(at))
        val prefs = context.getSharedPreferences("solvia_reminders", 0)
        try {
            AppointmentReminders.update(context, base, 771, rows)
            assertEquals(1, prefs.getStringSet("keys", emptySet())!!.size)
            val expected = LocalDateTime.parse(at).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() - AppointmentReminders.LEAD_MS
            assertEquals(expected, prefs.getLong(prefs.getStringSet("keys", emptySet())!!.first(),0))
            assertFalse(prefs.all.values.any { it.toString().contains("Секретне тестове ім’я") })
            store.enqueue(JSONObject().put("client_key", "test").put("appointment_id", 91).put("patient_id", 7), "Тест")
            AppointmentReminders.update(context, base, 771, rows)
            assertTrue(prefs.getStringSet("keys", emptySet())!!.isEmpty())
        } finally { AppointmentReminders.cancel(context); store.revokeSession() }
    }
    @Test fun dueReminderSurvivesCacheRecheckButCancelledVisitDoesNot() {
        val base = "https://${UUID.randomUUID()}.invalid"; val store = OfflineStore(context, base, 772)
        store.saveSession(JSONObject().put("id", 772), "synthetic")
        val prefs = context.getSharedPreferences("solvia_reminders", 0)
        val at = LocalDateTime.now().minusMinutes(1).withSecond(0).withNano(0)
        val time = at.atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() - AppointmentReminders.LEAD_MS
        val key = "91_$time"
        try {
            AppointmentReminders.cancel(context)
            prefs.edit().putString("server", base).putLong("user", 772).putLong(key, time).putStringSet("keys", setOf(key)).commit()
            val rows = JSONArray().put(appointment(at.toString()))
            store.saveCache("/api/appointments?date=" + LocalDate.now(), rows)
            AppointmentReminders.refreshFromCache(context, base, 772)
            assertTrue(key in prefs.getStringSet("keys", emptySet())!!)
            AppointmentReminders.deliver(context, key)
            assertTrue(prefs.getBoolean("fired:$key", false))
            AppointmentReminders.deliver(context, key)
            assertTrue(prefs.getBoolean("fired:$key", false))
            rows.getJSONObject(0).put("status", "cancelled")
            store.saveCache("/api/appointments?date=" + LocalDate.now(), rows)
            AppointmentReminders.refreshFromCache(context, base, 772)
            assertTrue(prefs.getStringSet("keys", emptySet())!!.isEmpty())
        } finally { AppointmentReminders.cancel(context); store.revokeSession() }
    }
    @Test fun reportDraftIsEncryptedAndScoped() {
        val base = "https://${UUID.randomUUID()}.invalid"
        val store = OfflineStore(context, base, 773); val other = OfflineStore(context, base, 774)
        store.saveReportDraft("2026-10-13", JSONObject().put("summary", "Приватний підсумок зміни"))
        assertEquals("Приватний підсумок зміни", store.reportDraft("2026-10-13")!!.getString("summary"))
        assertNull(other.reportDraft("2026-10-13"))
        assertFalse(context.getSharedPreferences("solvia_offline_v1", 0).all.values.any { it.toString().contains("Приватний підсумок зміни") })
        val original = store.reportDraft("2026-10-13")!!
        store.saveReportDraft("2026-10-13", JSONObject().put("summary", "Новий текст під час передавання"))
        store.clearReportDraft("2026-10-13", original)
        assertEquals("Новий текст під час передавання", store.reportDraft("2026-10-13")!!.getString("summary"))
        store.clearReportDraft("2026-10-13"); assertNull(store.reportDraft("2026-10-13"))
    }
}
