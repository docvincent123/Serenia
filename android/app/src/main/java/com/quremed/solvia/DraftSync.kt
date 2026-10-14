package com.quremed.solvia

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Sync only the captured clinical text. Acknowledgements never replace newer local edits. */
class DraftSync(private val drafts: DraftStore, private val journal: OfflineStore,
                private val request: (String, String, JSONObject?) -> JSONObject) {
    fun run(): Boolean = synchronized(lock) {
        for(patient in drafts.patients()) {
            val snapshot = drafts.read(patient) ?: continue
            if(transferred(snapshot) || snapshot.optBoolean("sync_blocked")) continue
            val queue = journal.queue()
            if((0 until queue.length()).any {
                val row = queue.getJSONObject(it)
                row.getJSONObject("payload").optLong("patient_id") == patient && row.getJSONObject("payload").optLong("appointment_id") == snapshot.optLong("appointment_id") && row.optString("state") in listOf("pending", "blocked", "sent")
            }) continue
            val key = snapshot.optString("client_key")
            if(key.isBlank() || snapshot.optLong("appointment_id") <= 0) continue
            val hash = fingerprint(snapshot)
            val path = "/api/patients/$patient/draft"
            try {
                val remote = request("GET", path, null)
                val revision = remote.optInt("version")
                val remotePayload = remote.optJSONObject("payload")
                if(remotePayload != null && remotePayload.optString("client_key") == key && fingerprint(remotePayload) == hash) {
                    // Retry after a lost PATCH response: acknowledge its already saved text.
                    drafts.acknowledge(patient, key, hash, revision)
                    continue
                }
                val recoveredAttempt = remotePayload != null && remotePayload.optString("client_key") == key &&
                    snapshot.optString("attempt_hash").isNotBlank() && fingerprint(remotePayload) == snapshot.optString("attempt_hash")
                if(revision != snapshot.optInt("server_version") && !recoveredAttempt && !(remotePayload == null && snapshot.optInt("server_version") == 0))
                    throw SyncFailure(409, "Запис змінено на іншому пристрої. Перевірте серверну версію в інструментах консультації.")
                drafts.prepareTransfer(patient, key, hash)
                val response = request("PATCH", path, JSONObject().put("version", revision).put("payload", snapshot))
                drafts.acknowledge(patient, key, hash, response.getInt("version"))
            } catch(e: SyncFailure) {
                if(e.status == 401) return@synchronized false
                drafts.transferError(patient, key, e.message.orEmpty(), e.status in 400..499 && e.status !in listOf(408,429))
                if(e.status !in 400..499 || e.status in listOf(408,429)) break
            } catch(e: Exception) {
                drafts.transferError(patient, key, e.message.orEmpty(), false); break
            }
        }
        true
    }
    companion object {
        val lock = Any()
        fun fingerprint(value: JSONObject): String {
            val canonical = JSONObject()
            for(key in listOf("note","goals","next_plan","homework","request_text","state_text","work_done","recommendations","result_text",
                "consultation_type","risk_level","consult_date","client_key","appointment_id","duration_minutes")) canonical.put(key, value.optString(key))
            canonical.put("risk_flags", value.optJSONArray("risk_flags") ?: JSONArray())
            return MessageDigest.getInstance("SHA-256").digest(canonical.toString().toByteArray()).joinToString("") { "%02x".format(it) }
        }
        fun transferred(value: JSONObject) = value.optString("synced_hash").isNotBlank() && value.optString("synced_hash") == fingerprint(value)
    }
}
