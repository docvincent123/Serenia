package com.quremed.solvia

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class VisitStateTest {
    private fun record(appointment: Long, patient: Long, state: String) = JSONObject()
        .put("payload", JSONObject().put("appointment_id", appointment).put("patient_id", patient))
        .put("state", state)

    @Test fun queueIndexKeepsParticipantsAndAppointmentsSeparate() {
        val queue = JSONArray().put(record(4, 19, "pending")).put(record(4, 20, "blocked"))
            .put(record(5, 19, "sent")).put(record(4, 19, "sent"))
            .put(record(4, 19, "reviewed"))
        assertEquals(mapOf((4L to 19L) to "sent", (4L to 20L) to "blocked", (5L to 19L) to "sent"),
            VisitState.localStates(queue))
    }

    @Test fun localQueueChangeIsVisibleWithoutServerAppointmentChange() {
        val queue = JSONArray()
        val before = VisitState.localStates(queue)
        queue.put(record(4, 19, "pending"))
        val after = VisitState.localStates(queue)
        assertNotEquals(before, after)
        assertTrue(VisitState.completed("", "confirmed", after[4L to 19L].orEmpty()))
        assertTrue(VisitState.localStates(JSONArray()).isEmpty())
    }

    @Test fun locallyFinishedVisitMovesToArchiveBeforeServerAcknowledgement() {
        for(state in listOf("pending", "blocked", "sent")) assertTrue(VisitState.completed("", "confirmed", state))
        assertFalse(VisitState.completed("", "confirmed", "reviewed"))
    }
    @Test fun partialGroupCompletionIsPerParticipant() {
        assertTrue(VisitState.completed("2026-10-13T10:00", "scheduled"))
        assertFalse(VisitState.completed("", "scheduled"))
        assertFalse(VisitState.completed("", "confirmed"))
        assertFalse(VisitState.completed("", "cancelled"))
        assertTrue(VisitState.completed("", "completed"))
    }
}
