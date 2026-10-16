package com.quremed.solvia

import org.json.JSONArray
import org.json.JSONObject

/** Separate authenticated backup of blocked text; never sent in device monitoring counters. */
class RecoverySync(private val drafts: DraftStore, private val journal: OfflineStore,
                   private val request: (JSONObject) -> JSONObject) {
    fun run(): Boolean = synchronized(lock) {
        val queue=journal.queue()
        val issues=linkedMapOf<String,JSONObject>()
        for(i in 0 until queue.length()) {
            val row=queue.getJSONObject(i)
            if(row.optString("state")!="blocked") continue
            val payload=row.getJSONObject("payload")
            issues[payload.optString("client_key")]=JSONObject().put("kind","consultation")
                .put("payload",payload).put("error",row.optString("error").take(1000))
        }
        for(pid in drafts.patients()) {
            val value=drafts.read(pid) ?: continue
            val key=value.optString("client_key")
            if(!value.optBoolean("sync_blocked") || key.isBlank() || value.optLong("appointment_id")<=0 || issues.containsKey(key)) continue
            val payload=JSONObject(value.toString()).put("patient_id",pid).put("appointment_id",value.optLong("appointment_id"))
            if(value.has("duration_minutes"))payload.put("duration_minutes",value.optInt("duration_minutes",60))
            issues[key]=JSONObject().put("kind","draft").put("payload",payload).put("error",value.optString("sync_error").take(1000))
        }
        for(batch in issues.values.toList().chunked(5)) {
            try {
                val response=request(JSONObject().put("items",JSONArray(batch)))
                val items=response.optJSONArray("items") ?: continue
                for(i in 0 until items.length()) {
                    val item=items.getJSONObject(i)
                    if(item.optString("state") !in listOf("completed","linked") || item.optLong("consultation_id")<=0) continue
                    val source=item.optJSONObject("source") ?: continue
                    val submitted=batch.firstOrNull {it.getJSONObject("payload").optString("client_key")==item.optString("client_key")} ?: continue
                    val payload=submitted.getJSONObject("payload")
                    if(source.optString("client_key")!=payload.optString("client_key") || source.optLong("patient_id")!=payload.optLong("patient_id") ||
                        source.optLong("appointment_id")!=payload.optLong("appointment_id")) continue
                    val patient=source.optLong("patient_id")
                    if(journal.acknowledgeRecovery(source,"Пацієнт №$patient",item.getLong("consultation_id")))
                        drafts.removeRecovered(patient,source)
                }
            } catch(error: SyncFailure) {
                if(error.status==401) return@synchronized false
                // Old servers keep the encrypted local copy and retain their existing sync behavior.
                if(error.status in listOf(404,405)) return@synchronized true
                return@synchronized true
            } catch(_: Exception) { return@synchronized true }
        }
        true
    }
    companion object {private val lock=Any()}
}
