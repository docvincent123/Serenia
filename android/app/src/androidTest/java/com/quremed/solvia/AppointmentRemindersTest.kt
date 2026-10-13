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
    @Test fun cancellationAndLocalCompletionRemoveScheduledAlarm() {
        val base = "https://${UUID.randomUUID()}.invalid"; val store = OfflineStore(context, base, 771)
        store.saveSession(JSONObject().put("id", 771), "synthetic")
        val at = LocalDateTime.now().plusHours(1).withSecond(0).withNano(0).toString()
        val rows = JSONArray().put(appointment(at))
        val prefs = context.getSharedPreferences("solvia_reminders", 0)
        try {
            AppointmentReminders.update(context, base, 771, rows)
            assertEquals(1, prefs.getStringSet("keys", emptySet())!!.size)
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
        val time = at.atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
        val key = "91_$time"
        try {
            AppointmentReminders.cancel(context)
            prefs.edit().putString("server", base).putLong("user", 772).putLong(key, time).putStringSet("keys", setOf(key)).commit()
            val rows = JSONArray().put(appointment(at.toString()))
            store.saveCache("/api/appointments?date=" + LocalDate.now(), rows)
            AppointmentReminders.refreshFromCache(context, base, 772)
            assertTrue(key in prefs.getStringSet("keys", emptySet())!!)
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
        store.clearReportDraft("2026-10-13"); assertNull(store.reportDraft("2026-10-13"))
    }
}
