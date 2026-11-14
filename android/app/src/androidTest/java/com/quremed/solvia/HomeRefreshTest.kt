package com.quremed.solvia

import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.util.UUID

/** Same server snapshot, changing encrypted local queue: no network required. */
class HomeRefreshTest {
    private fun views(view: View): List<View> = listOf(view) + if (view is ViewGroup)
        (0 until view.childCount).flatMap { views(view.getChildAt(it)) } else emptyList()
    private fun field(activity: MainActivity, name: String, value: Any) {
        MainActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.set(activity, value)
    }

    @Test fun localCompletionRefreshesArchiveAndUnchangedSnapshotKeepsViews() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            val server = "https://${UUID.randomUUID()}.invalid"
            field(activity, "server", server)
            field(activity, "userId", 42L)
            // Avoid foreground network polling and the initial GET; exercise the cached native view.
            field(activity, "token", "")
            field(activity, "role", "director")
            val store = OfflineStore(activity, server, 42)
            val day = LocalDate.now().toString()
            store.saveCache("/api/shift-day", JSONObject().put("open", true).put("shift_date", day))
            val rows = JSONArray().put(JSONObject().put("id", 4).put("status", "confirmed")
                .put("start", "${day}T10:00").put("end", "${day}T11:00")
                .put("patients", JSONArray().put(JSONObject().put("id", 19).put("name", "Тестовий пацієнт"))))
            store.saveCache("/api/appointments?date=$day", rows)
            MainActivity::class.java.getDeclaredMethod("renderHomeScreen", String::class.java)
                .apply { isAccessible = true }.invoke(activity, "active")
            fun nameView() = views(activity.window.decorView).filterIsInstance<TextView>()
                .firstOrNull { it.text.toString() == "Тестовий пацієнт" }
            assertNotNull(nameView())
            @Suppress("UNCHECKED_CAST")
            val refresh = MainActivity::class.java.getDeclaredField("homeAppointmentsRefresh")
                .apply { isAccessible = true }.get(activity) as (JSONArray) -> Unit
            val original = nameView()
            refresh(rows)
            assertSame("Unchanged data rebuilt the patient card", original, nameView())
            val key = UUID.randomUUID().toString()
            store.enqueue(JSONObject().put("client_key", key).put("appointment_id", 4).put("patient_id", 19), "Тестовий пацієнт")
            refresh(rows)
            assertNull("Local completion stayed in the active list", nameView())
            views(activity.window.decorView).filterIsInstance<Button>().first { it.text.toString() == "Архів" }.performClick()
            assertNotNull(nameView())
            fun indicator() = views(activity.window.decorView).first { it.tag == "unsent:19:4" }
            assertEquals(View.VISIBLE, indicator().visibility)
            store.mark(key, "sent", serverId = 1)
            refresh(rows)
            assertEquals(View.GONE, indicator().visibility)
            assertNotNull("Acknowledgement removed the archive entry", nameView())
        } }
    }
}
