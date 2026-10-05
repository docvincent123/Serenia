package com.quremed.solvia

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
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
                val authorized = ConsultationSync(store) { payload ->
                    if(cancelled.get() || store.session()?.optString("token") != auth) throw SyncFailure(401, "Потрібен повторний вхід")
                    send(base, auth, payload)
                }.run()
                if(!authorized) store.revokeSession()
                val queue = store.queue()
                retry = authorized && (0 until queue.length()).any { queue.getJSONObject(it).optString("state") == "pending" }
            } catch(_: Exception) { retry = true }
            finally { active.remove(params.jobId, cancelled); if(!cancelled.get()) jobFinished(params, retry) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { active[params.jobId]?.set(true); return true }
    override fun onDestroy() { active.values.forEach { it.set(true) }; executor.shutdownNow(); super.onDestroy() }
    private fun send(base: String, auth: String, payload: JSONObject): JSONObject {
        val connection = URL(base + "/api/consultations").openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.requestMethod = "POST"
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
    companion object {
        fun schedule(context: Context, server: String, user: Long) {
            val extras = android.os.PersistableBundle().apply { putString("server", server); putLong("user", user) }
            val id = ("$server|$user".hashCode() and 0x3fffffff) + 1000
            val info = JobInfo.Builder(id, ComponentName(context, OfflineSyncJob::class.java))
                .setExtras(extras).setPersisted(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(1000)
                .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build()
            (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).schedule(info)
        }
    }
}
