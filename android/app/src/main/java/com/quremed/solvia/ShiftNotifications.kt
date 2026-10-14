package com.quremed.solvia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/** No patient names or clinical text are displayed or stored in notification metadata. */
object ShiftNotifications {
    const val SHIFT_CHANNEL = "solvia_shift_v1"
    const val NEW_CHANNEL = "solvia_new_visits_v1"
    const val SHIFT_ID = 200
    const val NEW_ID = 201
    private fun manager(c: Context) = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private fun prefs(c: Context) = c.getSharedPreferences("solvia_shift_notifications", 0)
    private fun open(c: Context) = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun channels(c: Context) {
        manager(c).createNotificationChannel(NotificationChannel(SHIFT_CHANNEL, "Активна зміна", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Стан зміни та кількість активних прийомів"; setSound(null, null); lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
        manager(c).createNotificationChannel(NotificationChannel(NEW_CHANNEL, "Нові консультації", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Нові записи у вашому списку прийомів"; lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
    }
    fun clear(c: Context) { manager(c).cancel(SHIFT_ID); manager(c).cancel(NEW_ID) }
    @Synchronized fun refresh(c: Context, base: String, uid: Long) {
        val p = prefs(c); p.edit().putString("server", base).putLong("user", uid).apply()
        val store = OfflineStore(c, base, uid); val session = store.session()
        val today = LocalDate.now().toString()
        val shift = store.cache("/api/shift-day") as? JSONObject
        if(session == null || shift == null || !shift.optBoolean("open") || shift.optString("shift_date") != today) { clear(c); return }
        val rows = store.cache("/api/appointments?date=$today") as? JSONArray ?: return
        val settings = c.getSharedPreferences("solvia_settings", 0)
        val scope = "$base|$uid|$today"
        val same = p.getString("seen_scope", "") == scope
        if(!same) manager(c).cancel(NEW_ID)
        val seen = if(same) p.getStringSet("seen", emptySet())!!.toSet() else emptySet()
        val ids = mutableSetOf<String>(); val queue = store.queue(); var count = 0; var next = ""
        for(i in 0 until rows.length()) {
            val a = rows.getJSONObject(i)
            if(a.optString("status") !in listOf("scheduled", "confirmed")) continue
            val id = a.optLong("id"); ids.add(id.toString())
            val patients = a.optJSONArray("patients") ?: JSONArray(); var remaining = 0
            for(n in 0 until patients.length()) {
                val patient = patients.getJSONObject(n)
                val finished = (0 until queue.length()).any { j ->
                    val row = queue.getJSONObject(j); val payload = row.getJSONObject("payload")
                    row.optString("state") in listOf("pending", "blocked", "sent") &&
                        payload.optLong("appointment_id") == id && payload.optLong("patient_id") == patient.optLong("id")
                }
                if(patient.optString("visit_status").isBlank() && patient.optString("completed_at").isBlank() && !finished) remaining++
            }
            count += remaining
            val start = a.optString("start")
            if(remaining > 0 && start.length >= 16 && (next.isBlank() || start < next)) next = start
        }
        val added = ids - seen
        p.edit().putString("seen_scope", scope).putStringSet("seen", seen + ids).commit()
        if(!AppointmentReminders.allowed(c)) return
        channels(c)
        val expires = minOf(session.optLong("expires"), LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli())
        if(settings.getBoolean("shift_notification", true)) {
            val text = "Активних пацієнтів: $count" + if(next.isNotBlank()) " · прийом ${next.substring(11,16)}" else " · усі прийоми завершені"
            manager(c).notify(SHIFT_ID, Notification.Builder(c, SHIFT_CHANNEL).setSmallIcon(R.drawable.ic_solvia_notification)
                .setContentTitle("SOLVIA · активна зміна $today").setContentText(text).setContentIntent(open(c))
                .setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setTimeoutAfter((expires - System.currentTimeMillis()).coerceAtLeast(1)).build())
        } else manager(c).cancel(SHIFT_ID)
        if(same && added.isNotEmpty() && settings.getBoolean("new_visit_notifications", true)) {
            manager(c).notify(NEW_ID, Notification.Builder(c, NEW_CHANNEL).setSmallIcon(R.drawable.ic_solvia_notification)
                .setContentTitle("Нова консультація").setContentText("Додано прийомів: ${added.size}. Перевірте активний список у SOLVIA.")
                .setContentIntent(open(c)).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setTimeoutAfter((expires-System.currentTimeMillis()).coerceAtLeast(1)).build())
        }
    }
    fun restore(c: Context) {
        val p = prefs(c); val base = p.getString("server", "").orEmpty(); val uid = p.getLong("user", 0)
        if(base.isNotBlank() && uid > 0) refresh(c, base, uid) else clear(c)
    }
    fun testMessage(c: Context) {
        if(!AppointmentReminders.allowed(c)) return
        channels(c)
        manager(c).notify("test", NEW_ID, Notification.Builder(c, NEW_CHANNEL).setSmallIcon(R.drawable.ic_solvia_notification)
            .setContentTitle("SOLVIA · тестове повідомлення").setContentText("Оповіщення про нову консультацію працюють.")
            .setContentIntent(open(c)).setAutoCancel(true).setTimeoutAfter(15000).build())
    }
}
