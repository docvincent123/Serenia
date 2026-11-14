package com.quremed.solvia

import org.json.JSONArray

/** Participant completion takes precedence over the remaining group appointment. */
object VisitState {
    /** One pass per queue snapshot; the last actionable record wins per participant. */
    fun localStates(queue: JSONArray): Map<Pair<Long, Long>, String> {
        val states = mutableMapOf<Pair<Long, Long>, String>()
        for (i in 0 until queue.length()) {
            val row = queue.getJSONObject(i)
            val state = row.optString("state")
            if (state !in listOf("pending", "blocked", "sent")) continue
            val payload = row.getJSONObject("payload")
            states[payload.optLong("appointment_id") to payload.optLong("patient_id")] = state
        }
        return states
    }

    fun completed(completedAt: String, appointmentStatus: String, localState: String = ""): Boolean =
        completedAt.isNotBlank() || appointmentStatus == "completed" || localState in listOf("pending", "blocked", "sent")
}
