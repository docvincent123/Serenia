package com.quremed.solvia

import org.json.JSONArray
import org.json.JSONObject

data class AppointmentSnapshot(val shift: JSONObject, val day: String, val entries: JSONArray)

/** The current shift's delivery must not depend on tomorrow or bulk patient downloads. */
object AppointmentInbox {
    fun receive(store: OfflineStore, profileDay: String?, get: (String) -> Any): AppointmentSnapshot {
        val shift = get("/api/shift-day") as JSONObject
        store.saveCache("/api/shift-day", shift)
        val day = ShiftDate.active(profileDay, shift.optString("shift_date"), shift.optBoolean("open"))
        if(!shift.optBoolean("open")) return AppointmentSnapshot(shift,day,JSONArray())
        val path = "/api/appointments?date=$day"
        val entries = get(path) as JSONArray
        store.saveCache(path,entries)
        return AppointmentSnapshot(shift,day,entries)
    }

    fun cacheMissingCards(store: OfflineStore, entries: JSONArray, get: (String) -> Any) {
        val ids = mutableSetOf<Long>()
        val directory = store.cache("/api/patients") as? JSONArray ?: JSONArray()
        val known = (0 until directory.length()).map { directory.getJSONObject(it).optLong("id") }.toMutableSet()
        for(i in 0 until entries.length()) {
            val patients = entries.getJSONObject(i).optJSONArray("patients") ?: JSONArray()
            for(j in 0 until patients.length()) {
                val patient = patients.getJSONObject(j); val id = patient.optLong("id")
                if(id<=0 || !ids.add(id)) continue
                if(known.add(id)) directory.put(patient)
                val path = "/api/patients/$id"
                if(store.cache(path)==null) store.saveCache(path,get(path))
            }
        }
        store.saveCache("/api/patients",directory)
    }
}
