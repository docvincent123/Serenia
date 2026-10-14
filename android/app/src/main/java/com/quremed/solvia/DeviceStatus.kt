package com.quremed.solvia

import android.content.Context
import org.json.JSONObject

/** Counts only: never sends clinical text or error strings to the monitoring panel. */
object DeviceStatus {
    fun payload(context: Context, base: String, uid: Long): JSONObject {
        val store = OfflineStore(context, base, uid)
        val queue = store.queue()
        var pending = 0; var blocked = 0
        for(i in 0 until queue.length()) when(queue.getJSONObject(i).optString("state")) {
            "pending" -> pending++
            "blocked" -> blocked++
        }
        val drafts = DraftStore(context, base, uid)
        for(pid in drafts.patients()) {
            val draft = drafts.read(pid) ?: continue
            if(!DraftSync.transferred(draft)) {
                if(draft.optBoolean("sync_blocked")) blocked++ else pending++
            }
        }
        val sync = (store.cache("/local/sync-status") as? JSONObject)?.optString("server_time").orEmpty()
        return JSONObject().put("version_code", BuildConfig.VERSION_CODE).put("version_name", BuildConfig.VERSION_NAME)
            .put("pending_count", pending).put("blocked_count", blocked).put("last_sync", sync)
            .put("error_code", if(blocked>0) "conflict" else if(pending>0) "pending" else "")
    }
    fun acknowledge(context: Context, base: String, uid: Long, payload: JSONObject, response: JSONObject) {
        if(payload.optInt("pending_count")==0 && payload.optInt("blocked_count")==0)
            OfflineStore(context, base, uid).saveCache("/local/sync-status", response)
    }
}
