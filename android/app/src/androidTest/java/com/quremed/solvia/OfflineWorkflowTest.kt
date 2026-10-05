package com.quremed.solvia

import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.UUID

class OfflineWorkflowTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun store(user: Long = 42, server: String = "https://" + UUID.randomUUID() + ".invalid") = OfflineStore(context, server, user)
    private fun payload(key: String = UUID.randomUUID().toString()) = JSONObject().put("client_key", key).put("patient_id", 7)
        .put("appointment_id", 12).put("note", "Повний незмінний запис українською").put("duration_minutes", 60)
    @Test fun cacheIsEncryptedScopedAndExpires() {
        val server = "https://" + UUID.randomUUID() + ".invalid"
        val first = store(1, server); val other = store(2, server)
        first.saveCache("/api/patients/7", JSONObject().put("name", "Секретне ім’я"), 1000)
        assertEquals("Секретне ім’я", (first.cache("/api/patients/7", 2000) as JSONObject).getString("name"))
        assertNull(other.cache("/api/patients/7", 2000))
        assertNull(first.cache("/api/patients/7", 1001 + OfflineStore.CACHE_TTL))
        assertFalse(context.getSharedPreferences("solvia_offline_v1", 0).all.values.any { it.toString().contains("Секретне ім’я") })
        first.forgetCache("/api/patients/7"); assertNull(first.cache("/api/patients/7", 2000))
    }
    @Test fun offlineSessionExpiresAndLogoutRevokesIt() {
        val cache = store(); cache.saveSession(JSONObject().put("id", 42).put("role", "psychologist"), "synthetic-token", 1000)
        assertNotNull(cache.session(2000)); assertNull(cache.session(1000 + OfflineStore.SESSION_TTL))
        cache.revokeSession(); assertNull(cache.session(2000))
    }
    @Test fun lostAcknowledgementRetriesSamePayloadAfterRestartWithoutDuplicate() {
        val server = "https://" + UUID.randomUUID() + ".invalid"; val cache = store(42, server)
        val original = payload(); cache.enqueue(original, "Тест")
        val committed = mutableMapOf<String, String>(); var dropResponse = true
        val transport: (JSONObject) -> JSONObject = { request ->
            val key = request.getString("client_key")
            if(committed.containsKey(key)) assertEquals(committed[key], request.toString()) else committed[key] = request.toString()
            if(dropResponse) { dropResponse = false; throw IOException("Відповідь втрачено") }
            JSONObject().put("id", 77)
        }
        ConsultationSync(cache, transport).run()
        assertEquals("pending", cache.queue().getJSONObject(0).getString("state"))
        val reopened = store(42, server); ConsultationSync(reopened, transport).run()
        assertEquals(1, committed.size)
        assertEquals("sent", reopened.queue().getJSONObject(0).getString("state"))
        assertEquals(77, reopened.queue().getJSONObject(0).getLong("server_id"))
        ConsultationSync(reopened) { fail("Acknowledged requests must not be resent"); JSONObject() }.run()
    }
    @Test fun pendingPayloadCannotChangeAndDuplicateTapIsIdempotent() {
        val cache = store(); val original = payload(); cache.enqueue(original, "Тест"); cache.enqueue(original, "Тест")
        assertEquals(1, cache.queue().length())
        try { cache.enqueue(JSONObject(original.toString()).put("note", "Інший текст"), "Тест"); fail("Must reject mutation") } catch(_: IllegalStateException) { }
        assertEquals(original.getString("note"), cache.queue().getJSONObject(0).getJSONObject("payload").getString("note"))
    }
    @Test fun conflictIsVisibleAndDoesNotPreventIndependentConsultation() {
        val cache = store(); val first = payload(); val second = payload().put("patient_id", 8)
        cache.enqueue(first, "Перший"); cache.enqueue(second, "Другий")
        ConsultationSync(cache) { request ->
            if(request.getLong("patient_id") == 7L) throw SyncFailure(409, "Чернетку змінено на іншому пристрої")
            JSONObject().put("id", 99)
        }.run()
        assertEquals("blocked", cache.queue().getJSONObject(0).getString("state"))
        assertTrue(cache.queue().getJSONObject(0).getString("error").contains("іншому пристрої"))
        assertEquals("sent", cache.queue().getJSONObject(1).getString("state"))
        assertEquals(first.getString("note"), cache.queue().getJSONObject(0).getJSONObject("payload").getString("note"))
    }
    @Test fun expiredAuthorizationRetainsQueueAndStopsTransmission() {
        val cache = store(); cache.enqueue(payload(), "Тест"); cache.enqueue(payload().put("patient_id", 8), "Тест 2")
        var count = 0
        assertFalse(ConsultationSync(cache) { count++; throw SyncFailure(401, "Сесію завершено") }.run())
        assertEquals(1, count); assertEquals(2, cache.queue().length())
        assertEquals("pending", cache.queue().getJSONObject(0).getString("state"))
    }
    private fun views(view: View): List<View> = listOf(view) + if(view is ViewGroup) (0 until view.childCount).flatMap { views(view.getChildAt(it)) } else emptyList()
    @Test fun consultationCanOpenFromCachedCalendarAndFinishWithoutWifi() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            val server = "https://" + UUID.randomUUID() + ".invalid"
            val cache = OfflineStore(activity, server, 42)
            cache.saveSession(JSONObject().put("id", 42).put("role", "psychologist"), "synthetic-token")
            val day = java.time.LocalDate.now().toString()
            cache.saveCache("/api/appointments?date=$day", JSONArray().put(JSONObject().put("id", 12).put("status", "confirmed")
                .put("start", "$day" + "T09:00").put("patients", JSONArray().put(JSONObject().put("id", 7).put("name", "Тест")))))
            for((name,value) in listOf("server" to server, "token" to "synthetic-token", "role" to "psychologist", "userId" to 42L, "workspaceReady" to true, "offlineMode" to true))
                MainActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.set(activity, value)
            MainActivity::class.java.getDeclaredMethod("consultationDialog", Long::class.javaPrimitiveType, String::class.java).apply { isAccessible = true }.invoke(activity, 7L, "Тест")
        }
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            // apiAsync posts cached result from its serial worker.
            val deadline = System.currentTimeMillis() + 5000
            var opened = false
            while(!opened && System.currentTimeMillis() < deadline) {
                scenario.onActivity { activity -> opened = MainActivity::class.java.getDeclaredField("consultationWindow").apply { isAccessible = true }.get(activity) != null }
                if(!opened) Thread.sleep(50)
            }
            assertTrue("Cached consultation form must open", opened)
            scenario.onActivity { activity ->
                val dialog = MainActivity::class.java.getDeclaredField("consultationWindow").apply { isAccessible = true }.get(activity) as android.app.AlertDialog
                views(dialog.window!!.decorView).filterIsInstance<EditText>().first { it.hint.toString().contains("Приватна нотатка") }.setText("Консультація завершена без Wi-Fi")
                dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
                val server = MainActivity::class.java.getDeclaredField("server").apply { isAccessible = true }.get(activity) as String
                val row = OfflineStore(activity, server, 42).queue().getJSONObject(0)
                assertEquals("Консультація завершена без Wi-Fi", row.getJSONObject("payload").getString("note"))
                assertEquals("pending", row.getString("state")); assertFalse(dialog.isShowing)
                assertNull(DraftStore(activity, server, 42).read(7))
            }
        }
    }
}
