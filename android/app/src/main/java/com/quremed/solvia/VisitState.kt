package com.quremed.solvia

/** Participant completion takes precedence over the remaining group appointment. */
object VisitState {
    fun completed(completedAt: String, appointmentStatus: String, localState: String = ""): Boolean =
        completedAt.isNotBlank() || appointmentStatus == "completed" || localState in listOf("pending", "blocked", "sent")
}
