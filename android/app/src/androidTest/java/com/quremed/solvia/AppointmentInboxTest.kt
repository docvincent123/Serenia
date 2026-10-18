package com.quremed.solvia

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class AppointmentInboxTest {
    private fun store()=OfflineStore(InstrumentationRegistry.getInstrumentation().targetContext,"https://${UUID.randomUUID()}.invalid",42)
    private fun entry()=JSONObject().put("id",12).put("status","scheduled").put("patients",JSONArray().put(JSONObject().put("id",7).put("name","Синтетичний пацієнт")))
    @Test fun newServerShiftReplacesStaleProfileWithoutRequestingOtherDays() {
        val store=store();val paths=mutableListOf<String>()
        val result=AppointmentInbox.receive(store,"2026-09-30") { path ->
            paths.add(path)
            when(path) {
                "/api/shift-day" -> JSONObject().put("open",true).put("shift_date","2026-10-01")
                "/api/appointments?date=2026-10-01" -> JSONArray().put(entry())
                else -> throw java.io.IOException("Other days and card download are unavailable")
            }
        }
        assertEquals("2026-10-01",result.day);assertEquals(1,result.entries.length())
        assertEquals(listOf("/api/shift-day","/api/appointments?date=2026-10-01"),paths)
        assertEquals(1,(store.cache("/api/appointments?date=2026-10-01") as JSONArray).length())
    }
    @Test fun failedCardDownloadDoesNotDiscardDeliveredAppointmentsAndCanRetry() {
        val store=store();val rows=JSONArray().put(entry())
        store.saveCache("/api/appointments?date=2026-10-01",rows)
        try { AppointmentInbox.cacheMissingCards(store,rows) { throw java.io.IOException("Disconnected") };fail() }
        catch(_:java.io.IOException) { }
        assertEquals(1,(store.cache("/api/appointments?date=2026-10-01") as JSONArray).length())
        AppointmentInbox.cacheMissingCards(store,rows) { JSONObject().put("id",7).put("name","Синтетичний пацієнт") }
        assertEquals(7,(store.cache("/api/patients/7") as JSONObject).getInt("id"))
        AppointmentInbox.cacheMissingCards(store,rows) { fail("A cached card is not downloaded again");JSONObject() }
    }
    @Test fun closedShiftDoesNotRequestAppointments() {
        val result=AppointmentInbox.receive(store(),"2026-10-01") { path ->
            assertEquals("/api/shift-day",path);JSONObject().put("open",false)
        }
        assertEquals(0,result.entries.length())
    }
}
