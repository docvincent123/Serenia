package com.quremed.solvia

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** Only schedule identifiers are plaintext. Names and clinical text stay in encrypted OfflineStore. */
object AppointmentReminders {
    const val CHANNEL = "solvia_consultations_v1"
    private fun prefs(c: Context) = c.getSharedPreferences("solvia_reminders", Context.MODE_PRIVATE)
    private fun alarm(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    fun exact(c: Context) = Build.VERSION.SDK_INT < 31 || alarm(c).canScheduleExactAlarms()
    fun allowed(c: Context) = (Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
    fun channel(c: Context) {
        val manager = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Час консультації", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Звукове нагадування про початок прийому"
            enableVibration(true); vibrationPattern = longArrayOf(0, 700, 300, 700)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        })
    }
    private fun pending(c: Context, key: String) = PendingIntent.getBroadcast(c, 0,
        Intent(c, ConsultationReminderReceiver::class.java).setAction("com.quremed.solvia.REMIND")
            .setData(Uri.parse("solvia://reminder/$key")).putExtra("key", key), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Synchronized fun cancel(c: Context) {
        val p = prefs(c)
        p.getStringSet("keys", emptySet())!!.forEach { key -> alarm(c).cancel(pending(c, key)) }
        p.edit().clear().commit()
        (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancelAll()
    }
    @Synchronized fun cancelScope(c: Context, server: String, user: Long) {
        if(prefs(c).getString("server", "") == server && prefs(c).getLong("user", 0) == user) cancel(c)
    }
    @Synchronized fun update(c: Context, server: String, user: Long, entries: JSONArray) {
        val p = prefs(c)
        val store = OfflineStore(c, server, user)
        if(store.session() == null) { cancelScope(c, server, user); return }
        if(p.getString("server", "") != server || p.getLong("user", 0) != user) cancel(c)
        val previous = p.getStringSet("keys", emptySet())!!.toSet()
        val keys = mutableSetOf<String>(); val edit = p.edit().putString("server", server).putLong("user", user)
        val queue = store.queue(); val now = System.currentTimeMillis()
        if(!c.getSharedPreferences("solvia_settings", 0).getBoolean("reminders_enabled", true) || store.session() == null) { cancel(c); return }
        for(i in 0 until entries.length()) {
            val a = entries.getJSONObject(i); val id = a.optLong("id")
            if(a.optString("status") !in listOf("scheduled", "confirmed")) continue
            val patients = a.optJSONArray("patients") ?: JSONArray()
            val unfinished = (0 until patients.length()).any { n ->
                val patient = patients.getJSONObject(n)
                patient.optString("completed_at").isBlank() && !(0 until queue.length()).any { j ->
                    val row = queue.getJSONObject(j); val payload = row.getJSONObject("payload")
                    payload.optLong("appointment_id") == id && payload.optLong("patient_id") == patient.optLong("id") &&
                        row.optString("state") in listOf("pending", "blocked", "sent")
                }
            }
            if(!unfinished) continue
            val at = runCatching { LocalDateTime.parse(a.getString("start")).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull() ?: continue
            if(at <= now && ("${id}_$at" !in previous || now - at > 15 * 60 * 1000L)) continue
            val key = "${id}_$at"; keys.add(key); edit.putLong(key, at)
            // A fired reminder must not be rearmed by the next refresh.
            if(p.getBoolean("fired:$key", false) || at <= now) continue
            try {
                if(exact(c)) alarm(c).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c, key))
                else alarm(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c, key))
            } catch(_: SecurityException) { alarm(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c, key)) }
        }
        (previous - keys).forEach { key ->
            alarm(c).cancel(pending(c, key)); edit.remove(key).remove("fired:$key")
            (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(key, 1)
        }
        edit.putStringSet("keys", keys).commit()
    }
    fun refreshFromCache(c: Context, server: String, user: Long) {
        val store = OfflineStore(c, server, user)
        val all = JSONArray()
        for(day in 0..1) {
            val rows = store.cache("/api/appointments?date=" + LocalDate.now().plusDays(day.toLong())) as? JSONArray ?: continue
            for(i in 0 until rows.length()) all.put(rows.getJSONObject(i))
        }
        update(c, server, user, all)
    }
    @Synchronized fun restore(c: Context) {
        val p = prefs(c); val base = p.getString("server", "").orEmpty(); val uid = p.getLong("user", 0)
        if(base.isNotBlank() && uid > 0) refreshFromCache(c, base, uid)
    }
    @Synchronized fun deliver(c: Context, key: String) {
        val p = prefs(c)
        if(key !in p.getStringSet("keys", emptySet())!! || p.getBoolean("fired:$key", false)) return
        val at = p.getLong(key, 0)
        if(System.currentTimeMillis() - at !in 0..(15 * 60 * 1000L)) return
        val base = p.getString("server", "").orEmpty(); val uid = p.getLong("user", 0)
        val store = OfflineStore(c, base, uid)
        if(store.session() == null) return
        // Recheck cached cancellations and locally completed visits immediately before ringing.
        refreshFromCache(c, base, uid)
        if(key !in p.getStringSet("keys", emptySet())!!) return
        p.edit().putBoolean("fired:$key", true).commit()
        if(!allowed(c)) return
        channel(c)
        val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val dismiss = PendingIntent.getBroadcast(c, 0, Intent(c, ConsultationReminderReceiver::class.java)
            .setAction("com.quremed.solvia.SILENCE").setData(Uri.parse("solvia://silence/$key")).putExtra("key", key), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_calendar)
            .setContentTitle("Час консультації").setContentText("Відкрийте SOLVIA та перевірте активні прийоми.")
            .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(open).setAutoCancel(true).setTimeoutAfter(60000)
            .addAction(Notification.Action.Builder(null, "Вимкнути звук", dismiss).build()).build()
        notification.flags = notification.flags or Notification.FLAG_INSISTENT
        (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(key, 1, notification)
    }
}

class ConsultationReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Keystore/cache access runs off the receiver's main thread and finishes its pending result.
        val result = goAsync()
        Thread {
            try {
                when(intent.action) {
                    "com.quremed.solvia.SILENCE" -> (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(intent.getStringExtra("key"), 1)
                    "com.quremed.solvia.REMIND" -> AppointmentReminders.deliver(context, intent.getStringExtra("key").orEmpty())
                    else -> AppointmentReminders.restore(context)
                }
            } catch(_: Exception) { /* Preserve cached records if Keystore is temporarily unavailable. */ }
            finally { result.finish() }
        }.start()
    }
}
