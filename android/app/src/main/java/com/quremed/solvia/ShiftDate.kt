package com.quremed.solvia

import java.time.LocalDate

/** Use the server-bound shift across midnight; fall back only when no valid binding exists. */
object ShiftDate {
    fun resolve(value: String?, today: LocalDate = LocalDate.now()): String =
        runCatching { LocalDate.parse(value).toString() }.getOrDefault(today.toString())

    fun active(profileDate: String?, serverDate: String?, open: Boolean, today: LocalDate = LocalDate.now()): String {
        if(open) runCatching { LocalDate.parse(serverDate).toString() }.getOrNull()?.let { return it }
        return resolve(profileDate, today)
    }
}
