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
                val draftsAuthorized = DraftSync(drafts, store) { method, path, body ->
                    if(cancelled.get() || store.session()?.optString("token") != auth) throw SyncFailure(401, "Потрібен повторний вхід")
                    if(method == "GET") get(base, auth, path) as JSONObject else send(base, auth, body!!, path, method)
                }.run()
                val authorized = draftsAuthorized && ConsultationSync(store) { payload ->
                    if(cancelled.get() || store.session()?.optString("token") != auth) throw SyncFailure(401, "Потрібен повторний вхід")
                    send(base, auth, payload)
                }.run()
                if(!authorized) { store.revokeSession(); AppointmentReminders.restore(this) }
                if(authorized && !cancelled.get()) {
                    val shift = get(base, auth, "/api/shift-day") as JSONObject
                    store.saveCache("/api/shift-day", shift)
                    if(!shift.optBoolean("open")) { AppointmentReminders.cancelScope(this, base, uid); ShiftNotifications.refresh(this, base, uid) }
                    else {
                        for(day in 0..1) {
                            val path = "/api/appointments?date=" + LocalDate.now().plusDays(day.toLong())
                            val rows = get(base, auth, path) as JSONArray
                            store.saveCache(path, rows)
                        }
                        if(!cancelled.get() && store.session()?.optString("token") == auth) AppointmentReminders.refreshFromCache(this, base, uid)
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
                        if(unread.isNotEmpty()) StaffMessageNotifications.show(this, unread.size())
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
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.requestMethod = method
            connection.connectTimeout = 6000; connection.readTimeout = 12000; connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $auth")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if(status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = if(text.isBlank()) JSONObject() else JSONTokener(text).nextValue() as JSONObject
            if(status !in 200..299) throw SyncFailure(status, response.optString("error", "Помилка сервера $status"))
            return response
        } finally { connection.disconnect() }
    }
    private fun get(base: String, auth: String, path: String): Any {
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.instanceFollowRedirects = false; c.connectTimeout = 6000; c.readTimeout = 12000
            c.setRequestProperty("Authorization", "Bearer $auth"); c.setRequestProperty("Accept", "application/json")
            val status = c.responseCode
            if(status !in 200..299) throw SyncFailure(status, "Не вдалося оновити розклад")
            return JSONTokener(c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }).nextValue()
        } finally { c.disconnect() }
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
