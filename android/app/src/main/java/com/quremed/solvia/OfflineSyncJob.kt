package com.quremed.solvia

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import org.json.JSONArray
import java.time.LocalDate
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Android runs the network-constrained queue even when the activity is no longer open. */
class OfflineSyncJob : JobService() {
    private val active = java.util.concurrent.ConcurrentHashMap<Int, AtomicBoolean>()
    private val executor = Executors.newSingleThreadExecutor()
    override fun onStartJob(params: JobParameters): Boolean {
        val cancelled = AtomicBoolean(false)
        active.put(params.jobId, cancelled)?.set(true)
        executor.execute {
            var retry = false
            try {
                val base = params.extras.getString("server") ?: return@execute
                val uid = params.extras.getLong("user")
                val store = OfflineStore(this, base, uid)
                val session = store.session() ?: return@execute
                val auth = session.getString("token")
                val drafts = DraftStore(this, base, uid)
                val recovery=RecoverySync(drafts,store) { data ->
                    if(cancelled.get() || store.session()?.optString("token")!=auth) throw SyncFailure(401,"Потрібен повторний вхід")
                    send(base,auth,data,"/api/mobile-recovery")
                }
                val recovered=recovery.run()
                val draftsAuthorized = recovered && DraftSync(drafts, store) { method, path, body ->
                    if(cancelled.get() || store.session()?.optString("token") != auth) throw SyncFailure(401, "Потрібен повторний вхід")
                    if(method == "GET") get(base, auth, path) as JSONObject else send(base, auth, body!!, path, method)
                }.run()
                val consultationsAuthorized = draftsAuthorized && ConsultationSync(store) { payload ->
                    if(cancelled.get() || store.session()?.optString("token") != auth) throw SyncFailure(401, "Потрібен повторний вхід")
                    send(base, auth, payload)
                }.run()
                val authorized=consultationsAuthorized && recovery.run()
                if(!authorized) { store.revokeSession(); AppointmentReminders.restore(this) }
                if(authorized && !cancelled.get()) {
                    val snapshot=AppointmentInbox.receive(store,session.optJSONObject("user")?.optString("shift_date")) { path ->
                        if(cancelled.get() || store.session()?.optString("token")!=auth) throw SyncFailure(401,"Сесію змінено")
                        get(base,auth,path)
                    }
                    if(!snapshot.shift.optBoolean("open")) { AppointmentReminders.cancelScope(this,base,uid);ShiftNotifications.refresh(this,base,uid) }
                    else if(!cancelled.get() && store.session()?.optString("token")==auth) {
                        AppointmentReminders.refreshFromCache(this,base,uid)
                        runCatching { WorkflowNotifications.receive(this,base,uid) { path ->
                            if(cancelled.get() || store.session()?.optString("token")!=auth)throw SyncFailure(401,"Сесію змінено")
                            get(base,auth,path)
                        } }
                        AppointmentInbox.cacheMissingCards(store,snapshot.entries) { path ->
                            if(cancelled.get() || store.session()?.optString("token")!=auth) throw SyncFailure(401,"Сесію змінено")
                            get(base,auth,path)
                        }
                        for(day in listOf(LocalDate.now().toString(),LocalDate.now().plusDays(1).toString()).distinct().filter { it!=snapshot.day }) {
                            if(cancelled.get()) break
                            try { val path="/api/appointments?date=$day";store.saveCache(path,get(base,auth,path)) }
                            catch(e:Exception) { if(e is SyncFailure && e.status==401) throw e }
                        }
                        if(!cancelled.get() && store.session()?.optString("token")==auth) AppointmentReminders.refreshFromCache(this,base,uid)
                    }
                }
                if(authorized && !cancelled.get()) {
                    val report = DeviceStatus.payload(this, base, uid)
                    val response = send(base, auth, report, "/api/mobile-status")
                    DeviceStatus.acknowledge(this, base, uid, report, response)
                    val messages = get(base, auth, "/api/staff/messages") as JSONArray
                    if(!cancelled.get() && store.session()?.optString("token") == auth) {
                        val unread = (0 until messages.length()).map { messages.getJSONObject(it) }.filter { it.isNull("read_at") }
                        for(message in unread.filter { it.isNull("delivered_at") }) {
                            if(cancelled.get() || store.session()?.optString("token") != auth) break
                            send(base, auth, JSONObject(), "/api/staff/messages/${message.optLong("id")}/delivered")
                        }
                        if(unread.isNotEmpty()) StaffMessageNotifications.show(this, unread.size, store, unread.maxOf { it.optLong("id") })
                        else StaffMessageNotifications.clear(this)
                    }

                }
                val queue = store.queue()
                retry = authorized && ((0 until queue.length()).any { queue.getJSONObject(it).optString("state") == "pending" } ||
                    drafts.patients().any { drafts.read(it)?.let { value -> !DraftSync.transferred(value) && !value.optBoolean("sync_blocked") } ?: false })
            } catch(e: Exception) {
                if(e is SyncFailure && e.status == 401) {
                    val base = params.extras.getString("server").orEmpty(); val uid = params.extras.getLong("user")
                    OfflineStore(this, base, uid).revokeSession(); AppointmentReminders.restore(this); ShiftNotifications.restore(this)
                } else retry = true
            }
            finally { active.remove(params.jobId, cancelled); if(!cancelled.get()) jobFinished(params, retry) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { active[params.jobId]?.set(true); return true }
    override fun onDestroy() { active.values.forEach { it.set(true) }; executor.shutdownNow(); super.onDestroy() }
    private fun send(base: String, auth: String, payload: JSONObject, path: String = "/api/consultations", method: String = "POST"): JSONObject {
        PhoneNetworkStats.sent(this,base)
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.requestMethod = method
            connection.connectTimeout = 6000; connection.readTimeout = 12000; connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $auth")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode; PhoneNetworkStats.received(this,base)
            val stream = if(status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = if(text.isBlank()) JSONObject() else JSONTokener(text).nextValue() as JSONObject
            if(status !in 200..299) throw SyncFailure(status, response.optString("error", "Помилка сервера $status"))
            return response
        } catch(e: Exception) { PhoneNetworkStats.failed(this,base);throw e } finally { connection.disconnect() }
    }
    private fun get(base: String, auth: String, path: String): Any {
        PhoneNetworkStats.sent(this,base)
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.instanceFollowRedirects = false; c.connectTimeout = 6000; c.readTimeout = 12000
            c.setRequestProperty("Authorization", "Bearer $auth"); c.setRequestProperty("Accept", "application/json")
            val status = c.responseCode; PhoneNetworkStats.received(this,base)
            if(status !in 200..299) throw SyncFailure(status, "Не вдалося оновити розклад")
            return JSONTokener(c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }).nextValue()
        } catch(e: Exception) { PhoneNetworkStats.failed(this,base);throw e } finally { c.disconnect() }
    }
    companion object {
        fun schedule(context: Context, server: String, user: Long) {
            val extras = android.os.PersistableBundle().apply { putString("server", server); putLong("user", user) }
            val id = ("$server|$user".hashCode() and 0x3fffffff) + 1000
            val info = JobInfo.Builder(id, ComponentName(context, OfflineSyncJob::class.java))
                .setExtras(extras).setPersisted(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(1000)
                .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build()
            val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            scheduler.schedule(info)
            // One periodic job per installed app, replaced on account/server switch.
            scheduler.schedule(JobInfo.Builder(42, ComponentName(context, OfflineSyncJob::class.java))
                .setExtras(extras).setPersisted(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L).build())
        }
    }
}
