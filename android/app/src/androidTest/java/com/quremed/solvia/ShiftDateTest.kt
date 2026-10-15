package com.quremed.solvia

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class ShiftDateTest {
    @Test fun overnightShiftKeepsItsDateAcrossMonthBoundary() {
        assertEquals("2026-09-30", ShiftDate.resolve("2026-09-30", LocalDate.parse("2026-10-01")))
    }
    @Test fun invalidOrMissingBindingUsesDeviceDate() {
        val today = LocalDate.parse("2026-10-15")
        for (value in listOf(null, "", "null", "2026-02-30"))
            assertEquals("2026-10-15", ShiftDate.resolve(value, today))
    }
}
