package com.quremed.solvia

/** Optional clinician selections; no choice silently implies a clinical assessment. */
object ConsultationChoices {
    val emotionalStates = listOf("Не обрано", "Спокійний", "Тривожний", "Пригнічений", "Дратівливий", "Емоційно виснажений", "Змішаний стан")
    val followupPlans = listOf("Не обрано", "Продовжити психологічний супровід", "Повторна консультація", "Обговорити направлення до іншого фахівця", "Завершити супровід", "План визначити після додаткової оцінки")
    fun include(text: String, label: String, choices: List<String>, index: Int): String {
        if(index !in 1 until choices.size) return text
        return listOf(text.trim(), "$label: ${choices[index]}").filter { it.isNotBlank() }.joinToString("\n")
    }
}
