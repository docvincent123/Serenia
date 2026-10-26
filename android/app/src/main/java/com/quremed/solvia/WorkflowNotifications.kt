package com.quremed.solvia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import org.json.JSONArray
import org.json.JSONObject

/** Operational events only. History/cursor use the existing encrypted, per-user store. */
object WorkflowNotifications {
    private const val CHANNEL="solvia_workflow_v1"
    private const val CURSOR="/local/workflow-cursor"
    private const val HISTORY="/local/workflow-history"
    private val titles=mapOf("appointment.created" to "Запис створено", "appointment.updated" to "Запис оновлено",
        "appointment.cancelled" to "Запис скасовано", "appointment.no_show" to "Відмічено неявку",
        "patient.arrived" to "Пацієнт прибув", "patient.called" to "Пацієнта запрошено до кабінету",
        "consultation.started" to "Консультацію розпочато", "consultation.completed" to "Консультацію завершено")
    fun title(kind:String)=titles[kind] ?: "Оновлення прийому"
    fun history(store:OfflineStore)=store.cache(HISTORY) as? JSONArray ?: JSONArray()
    @Synchronized fun receive(context:Context,base:String,user:Long,get:(String)->Any) {
        val store=OfflineStore(context,base,user)
        val cursor=(store.cache(CURSOR) as? JSONObject)?.optLong("cursor",-1L) ?: -1L
        val response=get(if(cursor<0) "/api/workflow-events" else "/api/workflow-events?after=$cursor") as? JSONObject ?: return
        if(!response.has("cursor"))return
        val incoming=response.optJSONArray("events") ?: return
        val initial=cursor<0 || response.optBoolean("initial")
        val known=linkedMapOf<Long,JSONObject>()
        val previous=history(store)
        for(i in 0 until previous.length()){val row=previous.getJSONObject(i);known[row.optLong("id")]=row}
        var alert:JSONObject?=null
        for(i in 0 until incoming.length()){
            val row=incoming.getJSONObject(i);val id=row.optLong("id");val kind=row.optString("kind")
            if(id<=0 || kind !in titles)continue
            if(!initial && !known.containsKey(id) && row.optLong("actor_id")!=user && kind!="appointment.created")alert=row
            known[id]=row
        }
        val saved=JSONArray();known.values.sortedByDescending { it.optLong("id") }.take(40).forEach { saved.put(it) }
        store.saveCache(HISTORY,saved)
        store.saveCache(CURSOR,JSONObject().put("cursor",response.optLong("cursor")))
        if(alert!=null && context.getSharedPreferences("solvia_settings",0).getBoolean("workflow_notifications",true))show(context,alert!!)
    }
    private fun show(context:Context,event:JSONObject) {
        if(!AppointmentReminders.allowed(context))return
        val manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL,"Події прийомів",NotificationManager.IMPORTANCE_DEFAULT).apply {
            description="Прибуття, зміни розкладу та виклики пацієнтів"
            lockscreenVisibility=Notification.VISIBILITY_PRIVATE
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
            enableVibration(true)
        })
        val intent=PendingIntent.getActivity(context,208,Intent(context,MainActivity::class.java).putExtra("staff_messages",true)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val public=Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_solvia_notification).setContentTitle("SOLVIA").setContentText("Є оновлення прийомів").build()
        val notice=Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_solvia_notification)
            .setContentTitle("SOLVIA · "+title(event.optString("kind"))).setContentText("Відкрийте застосунок, щоб переглянути події.")
            .setPublicVersion(public).setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(intent).setAutoCancel(true).build()
        runCatching { manager.notify("workflow",208,notice) }
    }
}
