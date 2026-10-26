package com.quremed.solvia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONObject

object StaffMessageNotifications {
    private const val CHANNEL = "solvia_staff_messages_v1"
    private const val ID = 205
    @Synchronized fun show(context: Context, count: Int, store: OfflineStore, newest: Long) {
        if(!AppointmentReminders.allowed(context)) return
        val previous=(store.cache("/local/staff-notification") as? JSONObject)?.optLong("newest",0L) ?: 0L
        val fresh=newest>previous
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Повідомлення команди", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = PendingIntent.getActivity(context, ID, Intent(context, MainActivity::class.java).putExtra("staff_messages", true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_solvia_notification)
            .setContentTitle("SOLVIA · Повідомлення команди").setContentText("Непрочитаних повідомлень: $count")
            .setContentIntent(intent).setAutoCancel(true).setOnlyAlertOnce(!fresh).setVisibility(Notification.VISIBILITY_SECRET).build()
        runCatching { manager.notify(ID, notification); store.saveCache("/local/staff-notification",JSONObject().put("newest",maxOf(previous,newest))) }
    }
    fun clear(context: Context) = (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ID)
}
