package com.quremed.solvia

import org.junit.Assert.*
import org.junit.Test

class VisitStateTest {
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
