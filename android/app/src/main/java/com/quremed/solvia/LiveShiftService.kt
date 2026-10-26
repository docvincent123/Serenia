package com.quremed.solvia

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Visible, user-controllable LAN sync during an active shift; never started from boot. */
class LiveShiftService : Service() {
    private var executor:ScheduledExecutorService?=null
    private val stopped=AtomicBoolean(false)
    @Volatile private var scope=""
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent?.action==STOP){getSharedPreferences("solvia_settings",0).edit().putBoolean("live_shift",false).apply();stopSelf();return START_NOT_STICKY}
        val base=intent?.getStringExtra("server").orEmpty();val uid=intent?.getLongExtra("user",0L) ?: 0L
        if(base.isBlank()||uid<=0){stopSelf();return START_NOT_STICKY}
        val channel=NotificationChannel(CHANNEL,"Зв’язок під час зміни",NotificationManager.IMPORTANCE_LOW).apply {setSound(null,null)}
        val manager=getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager;manager.createNotificationChannel(channel)
        val open=PendingIntent.getActivity(this,209,Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop=PendingIntent.getService(this,210,Intent(this,LiveShiftService::class.java).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notice=Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_solvia_notification).setContentTitle("SOLVIA · зв’язок під час зміни")
            .setContentText("Отримуємо розклад і події центру у фоні").setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open)
            .setVisibility(Notification.VISIBILITY_PRIVATE).addAction(Notification.Action.Builder(null,"Зупинити",stop).build()).build()
        if(Build.VERSION.SDK_INT>=29)startForeground(209,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(209,notice)
        running=true
        val next="$base|$uid";if(scope==next&&executor!=null)return START_NOT_STICKY
        scope=next;executor?.shutdownNow();stopped.set(false)
        executor=Executors.newSingleThreadScheduledExecutor().also { worker ->worker.scheduleWithFixedDelay({
            if(stopped.get())return@scheduleWithFixedDelay
            val store=OfflineStore(this,base,uid);val session=store.session()
            if(session==null||session.optJSONObject("user")?.optString("role")!="psychologist"){stopSelf();return@scheduleWithFixedDelay}
            val auth=session.optString("token")
            try {
                fun get(path:String):Any {
                    check(!stopped.get()&&scope==next&&store.session()?.optString("token")==auth)
                    val result=fetch(base,auth,path)
                    check(!stopped.get()&&scope==next&&store.session()?.optString("token")==auth)
                    return result
                }
                val snapshot=AppointmentInbox.receive(store,session.optJSONObject("user")?.optString("shift_date"),::get)
                if(!snapshot.shift.optBoolean("open")){stopSelf();return@scheduleWithFixedDelay}
                AppointmentReminders.refreshFromCache(this,base,uid)
                runCatching { WorkflowNotifications.receive(this,base,uid,::get) }.onFailure { if(it is SyncFailure&&it.status==401)throw it }
                runCatching {
                    val messages=get("/api/staff/messages") as JSONArray
                    val unread=(0 until messages.length()).map { messages.getJSONObject(it) }.filter { it.isNull("read_at") }
                    if(unread.isNotEmpty())StaffMessageNotifications.show(this,unread.size,store,unread.maxOf { it.optLong("id") })
                    else StaffMessageNotifications.clear(this)
                }.onFailure { if(it is SyncFailure&&it.status==401)throw it }
            }catch(error:Exception){
                if(error is SyncFailure && error.status==401){store.revokeSession();AppointmentReminders.cancelScope(this,base,uid);ShiftNotifications.clear(this);stopSelf()}
                // Other failures keep cached records and retry; scheduled reminders remain active.
            }
        },0,10,TimeUnit.SECONDS) }
        return START_NOT_STICKY
    }
    private fun fetch(base:String,auth:String,path:String):Any {
        val c=URL(base+path).openConnection() as HttpURLConnection
        try{c.instanceFollowRedirects=false;c.connectTimeout=6000;c.readTimeout=10000;c.setRequestProperty("Authorization","Bearer $auth");c.setRequestProperty("Accept","application/json")
            if(c.responseCode==401)throw SyncFailure(401,"Сесію завершено")
            check(c.responseCode in 200..299)
            return JSONTokener(c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }).nextValue()
        }finally{c.disconnect()}
    }
    override fun onTimeout(startId:Int,fgsType:Int){
        // Android 15's dataSync background budget is authoritative. Resume only from the app.
        stopped.set(true);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()
    }
    override fun onDestroy(){stopped.set(true);executor?.shutdownNow();executor=null;running=false;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()}
    companion object {
        private const val CHANNEL="solvia_live_shift_v1"
        private const val STOP="com.quremed.solvia.STOP_LIVE_SHIFT"
        @Volatile var running=false
            private set
        fun start(activity:Activity,base:String,user:Long){
            if(activity.isFinishing||activity.isDestroyed||!AppointmentReminders.allowed(activity)||!activity.getSharedPreferences("solvia_settings",0).getBoolean("live_shift",true))return
            runCatching { activity.startForegroundService(Intent(activity,LiveShiftService::class.java).putExtra("server",base).putExtra("user",user)) }
        }
        fun stop(context:Context){context.stopService(Intent(context,LiveShiftService::class.java))}
    }
}
