package com.quremed.solvia

import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

interface MobileApi {
    fun call(method: String, path: String, body: JSONObject? = null, success: (Any) -> Unit, failure: (String) -> Unit)
}

/** Native patient workspace. All authorization and final validation remain on the server. */
class PatientWorkspace(
    private val activity: Activity, private val api: MobileApi, private val role: String, private val server: String,
    private val show: (View, () -> Unit) -> Unit, private val back: () -> Unit,
    private val consult: (Long, String) -> Unit,
    private val preview: (NativeDocument, () -> Unit) -> Unit
) {
    private val teal = Color.rgb(16, 111, 117)
    private val ink = Color.rgb(25, 48, 62)
    private var patient = JSONObject()
    private var selected = "summary"
    private val clinical get() = role == "admin" || role == "psychologist"
    init { require(role == "psychologist") { "Мобільний кабінет доступний лише психологу" } }
    private fun dp(n: Int) = (activity.resources.displayMetrics.density * n).toInt()
    private fun box(): LinearLayout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(12), dp(16), dp(16))
        background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(18).toFloat() }
    }
    private fun text(value: String, size: Float = 15f, bold: Boolean = false): TextView = TextView(activity).apply {
        text = value; textSize = size; setTextColor(ink); setPadding(0, dp(6), 0, dp(8))
        setTextIsSelectable(true); if (bold) setTypeface(typeface, Typeface.BOLD)
    }
    private fun button(label: String, action: () -> Unit): Button = Button(activity).apply {
        text = label; isAllCaps = false; textSize = 14f; setTextColor(teal); minHeight = dp(48)
        setOnClickListener { action() }
    }
    private fun input(label: String, value: String = "", lines: Int = 1): EditText = EditText(activity).apply {
        hint = label; setText(value); textSize = 16f; setTextColor(ink); minLines = lines
        inputType = InputType.TYPE_CLASS_TEXT or if (lines > 1) InputType.TYPE_TEXT_FLAG_MULTI_LINE else InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        gravity = Gravity.TOP; setPadding(dp(12), dp(12), dp(12), dp(12)); maxLengthHint(this, if (lines > 1) 30000 else 200)
    }
    private fun maxLengthHint(field: EditText, length: Int) { field.filters = arrayOf(android.text.InputFilter.LengthFilter(length)) }
    private fun select(labels: List<String>): Spinner = Spinner(activity).apply {
        adapter = ArrayAdapter(activity, android.R.layout.simple_spinner_dropdown_item, labels)
        minimumHeight = dp(48)
    }
    private fun section(parent: LinearLayout, label: String, value: String) {
        parent.addView(text(label, 12f, true)); parent.addView(text(value.ifBlank { "—" }))
    }
    private fun error(message: String) = AlertDialog.Builder(activity).setTitle("Не вдалося зберегти").setMessage(message).setPositiveButton("Зрозуміло", null).show()
    private fun date(label: String, initial: String): Button = button(initial) {}.apply {
        contentDescription = label
        setOnClickListener {
            val value = runCatching { LocalDate.parse(text.toString()) }.getOrDefault(LocalDate.now())
            DatePickerDialog(activity, { _, y, m, d -> text = LocalDate.of(y, m + 1, d).toString() }, value.year, value.monthValue - 1, value.dayOfMonth).show()
        }
    }
    private fun empty(parent: LinearLayout, value: String) { parent.addView(text(value)) }
    private fun rows(value: JSONArray?, action: (JSONObject) -> Unit) { if (value != null) for (i in 0 until value.length()) action(value.getJSONObject(i)) }
    private fun displayStatus(value: String) = when(value) {
        "signed" -> "Підписано"; "refused" -> "Відмова"; "active" -> "Триває"; "completed" -> "Завершено"
        "archived" -> "Архів"; "recommended" -> "Рекомендовано"; "sent" -> "Направлено"; "cancelled" -> "Скасовано"; else -> value
    }
    fun open(id: Long, tab: String = "summary") {
        selected = tab
        val loading = box(); loading.addView(button("Назад", back)); loading.addView(text("Завантаження картки…")); show(loading, back)
        api.call("GET", "/api/patients/$id", success = { patient = it as JSONObject; render() }, failure = { message ->
            loading.addView(text(message)); loading.addView(button("Повторити") { open(id, tab) })
        })
    }
    private fun render() {
        val id = patient.getLong("id")
        val body = box(); body.setBackgroundColor(Color.rgb(240, 246, 249))
        body.addView(button("Усі пацієнти", back))
        body.addView(text(patient.optString("name"), 25f, true))
        body.addView(text("№ ${patient.optString("patient_no")} · ${displayStatus(patient.optString("status"))}", 13f))
        val chips = LinearLayout(activity)
        val tabs = mutableListOf("summary" to "Профіль", "documents" to "Документи", "courses" to "Курси", "referrals" to "Направлення")
        if (clinical) { tabs.add(1, "history" to "Консультації"); tabs.add("discharges" to "Виписки") }
        tabs.forEach { (key, label) -> chips.addView(button(label) { selected = key; render() }.apply {
            if (selected == key) { setTextColor(Color.WHITE); backgroundTintList = android.content.res.ColorStateList.valueOf(teal) }
        }) }
        body.addView(HorizontalScrollView(activity).apply { isHorizontalScrollBarEnabled = false; addView(chips) })
        val content = box(); body.addView(content)
        show(body, back)
        when(selected) {
            "documents" -> documents(content, id)
            "history" -> history(content, id)
            "discharges" -> discharges(content, id)
            "courses" -> courses(content, id)
            "referrals" -> referrals(content, id)
            else -> summary(content, id)
        }
    }
    private fun summary(content: LinearLayout, id: Long) {
        if (role == "psychologist") content.addView(button("Нова консультація") { consult(id, patient.optString("name")) })
        listOf("phone" to "Телефон", "dob" to "Дата народження", "category" to "Категорія", "psychologist" to "Психолог",
            "family" to "Сім’я", "family_role" to "Роль у сім’ї", "address" to "Адреса", "referral_source" to "Джерело направлення",
            "referral_source_details" to "Деталі направлення").forEach { (key, label) -> section(content, label, patient.optString(key)) }
        if (clinical) {
            content.addView(text("Анкети та оцінювання", 19f, true))
            val assessments = patient.optJSONArray("assessments")
            if (assessments == null || assessments.length() == 0) empty(content, "Анкет поки немає")
            rows(assessments) { row -> section(content, row.optString("created"), if (row.isNull("score")) "Очікує проходження" else "Результат: ${row.optString("score")}") }
            if (role == "psychologist") content.addView(button("Призначити анкету") {
                api.call("POST", "/api/assessments", JSONObject().put("patient_id", id), { value ->
                    val response = value as JSONObject
                    AlertDialog.Builder(activity).setTitle("Анкету призначено")
                        .setMessage("Посилання для пацієнта:\n" + server + response.optString("link"))
                        .setNeutralButton("Скопіювати посилання") { _, _ ->
                            val clipboard = activity.getSystemService(Activity.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Анкета SOLVIA", server + response.optString("link")))
                            open(id)
                        }
                        .setPositiveButton("Готово") { _, _ -> open(id) }.show()
                }, { error(it) })
            })
        }
    }
    private fun history(content: LinearLayout, id: Long) {
        if (role == "psychologist") content.addView(button("Нова консультація") { consult(id, patient.optString("name")) })
        val entries = patient.optJSONArray("consultations")
        if (entries == null || entries.length() == 0) empty(content, "Після першої збереженої консультації тут з’явиться її повний запис.")
        rows(entries) { entry ->
            val card = box(); card.addView(text(entry.optString("created").replace('T', ' '), 18f, true))
            card.addView(text(entry.optString("psychologist") + " · ${entry.optInt("duration_minutes")} хв", 13f))
            if(entry.optString("sync_status").isNotBlank()) card.addView(text(entry.optString("sync_status"), 13f, true))
            card.addView(text(entry.optString("request_text").ifBlank { entry.optString("note") }.take(180)))
            card.addView(button("Повний запис") {
                val detail = box(); detail.addView(button("Назад до історії") { render() })
                consultationSections(entry).forEach { section(detail, it.label, it.value) }
                detail.addView(button("Перегляд PDF / друк") { document("Запис консультації", consultationSections(entry)) })
                show(detail) { render() }
            }); content.addView(card)
        }
    }
    private fun consultationSections(entry: JSONObject): List<DocumentSection> = listOf(
        "created" to "Дата", "sync_status" to "Синхронізація", "psychologist" to "Психолог", "consultation_type" to "Тип консультації", "duration_minutes" to "Тривалість, хв",
        "request_text" to "Запит", "state_text" to "Стан", "work_done" to "Проведена робота", "note" to "Приватна нотатка",
        "goals" to "Цілі", "result_text" to "Результат / динаміка", "next_plan" to "Подальший план", "homework" to "Домашнє завдання",
        "recommendations" to "Рекомендації", "risk_level" to "Рівень ризику", "risk_flags" to "Оцінені ризики"
    ).map { (key, label) -> DocumentSection(label, entry.optString(key)) }

    private val documentKinds = listOf("informed_consent", "data_processing", "center_rules", "family_consent", "service_refusal", "other")
    private val documentLabels = listOf("Інформована згода", "Обробка персональних даних", "Правила центру", "Сімейна консультація", "Відмова від послуги", "Інший документ")
    private fun documents(content: LinearLayout, id: Long) {
        content.addView(button("Оформити документ") { newDocument(id) })
        content.addView(text("Згоди, правила й підписані документи з картки пацієнта", 13f))
        api.call("GET", "/api/patients/$id/documents", success = { result ->
            val entries = result as JSONArray
            if (entries.length() == 0) empty(content, "Документів поки немає. Натисніть «Оформити документ».")
            rows(entries) { entry ->
                val row = box(); row.addView(text(entry.optString("title"), 18f, true))
                row.addView(text("${displayStatus(entry.optString("status"))} · ${entry.optString("signed_at")}", 13f))
                row.addView(button("Відкрити документ") {
                    document(entry.optString("title"), listOf(DocumentSection("Текст документа", entry.optString("content")),
                        DocumentSection("Статус", displayStatus(entry.optString("status"))), DocumentSection("Підписант", entry.optString("signed_by_name")),
                        DocumentSection("Дата підпису", entry.optString("signed_at"))), entry.optString("signature_data"), entry)
                }); content.addView(row)
            }
        }, failure = { content.addView(text(it)); content.addView(button("Повторити") { render() }) })
    }
    private fun newDocument(id: Long) {
        form("Оформлення документа") { fields, submit ->
            val type = select(documentLabels); fields.addView(type)
            fields.addView(text("Внесіть затверджений центром текст документа перед підписанням.", 13f))
            val name = input("Назва документа"); val body = input("Повний текст документа", lines = 8)
            val signer = input("ПІБ підписанта", patient.optString("name"))
            val refused = CheckBox(activity).apply { text = "Зафіксувати відмову від підписання" }
            val signature = SignatureView(activity)
            listOf(name, body, signer, refused).forEach { fields.addView(it) }
            fields.addView(text("Підпис пальцем або стилусом", 14f, true))
            fields.addView(signature, LinearLayout.LayoutParams(-1, dp(180)))
            fields.addView(button("Очистити підпис") { signature.clear() })
            fields.addView(text("Рукописний підпис не є кваліфікованим електронним підписом.", 12f))
            val templates = listOf(
                "Я підтверджую, що отримав(ла) зрозумілу інформацію про формат психологічної допомоги, її добровільність, межі конфіденційності та право припинити участь.",
                "Я надаю згоду центру на обробку персональних даних у межах надання послуг, ведення документації та виконання законних організаційних обов’язків центру.",
                "Підтверджую, що ознайомився(лась) із правилами центру, порядком запису, перенесення та скасування консультацій і правилами безпечної поведінки.",
                "Надаю добровільну згоду на участь у сімейній консультації та розумію формат спільної роботи й межі конфіденційності.",
                "Підтверджую, що мені було запропоновано відповідну послугу/направлення, однак я добровільно відмовляюся від неї після отримання пояснень.", "")
            type.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, itemId: Long) {
                    name.setText(documentLabels[position])
                    if (body.text.isBlank() || templates.contains(body.text.toString())) body.setText(templates[position])
                }
            }
            submit { done ->
                if (name.text.isBlank() || body.text.isBlank() || (!refused.isChecked && (signer.text.isBlank() || !signature.hasSignature))) {
                    error("Заповніть назву, текст, ПІБ підписанта й підпис або позначте відмову."); done(false)
                } else {
                    val payload = JSONObject().put("document_type", documentKinds[type.selectedItemPosition]).put("title", name.text.toString())
                        .put("content", body.text.toString()).put("signed_by_name", signer.text.toString()).put("status", if (refused.isChecked) "refused" else "signed")
                        .put("signature_data", if (refused.isChecked) "" else signature.dataUrl())
                    api.call("POST", "/api/patients/$id/documents", payload, { done(true); open(id, "documents") }, { error(it); done(false) })
                }
            }
        }
    }
    private fun discharges(content: LinearLayout, id: Long) {
        content.addView(button("Сформувати виписку") {
            form("Період психологічного супроводу") { fields, submit ->
                val from = date("Початок", LocalDate.now().withDayOfMonth(1).toString()); val to = date("Завершення", LocalDate.now().toString())
                fields.addView(text("Від")); fields.addView(from); fields.addView(text("До")); fields.addView(to)
                fields.addView(text("Виписка створюється з завершених консультацій. Перед друком перегляньте підсумок, динаміку та рекомендації."))
                submit { done ->
                    if (from.text.toString() > to.text.toString()) { error("Дата початку пізніше завершення"); done(false) }
                    else api.call("POST", "/api/discharges", JSONObject().put("patient_id", id).put("date_from", from.text.toString()).put("date_to", to.text.toString()),
                        { done(true); open(id, "discharges") }, { error(it); done(false) })
                }
            }
        })
        val entries = patient.optJSONArray("discharges")
        if (entries == null || entries.length() == 0) empty(content, "Виписок поки немає")
        rows(entries) { entry ->
            val row = box(); row.addView(text("Виписка № ${entry.optString("document_no")}", 18f, true))
            row.addView(text("${entry.optString("date_from")} — ${entry.optString("date_to")} · ${entry.optInt("consultation_count")} консультацій"))
            row.addView(button("Відкрити виписку") {
                document("Підсумок психологічного супроводу", listOf(DocumentSection("Номер документа", entry.optString("document_no")),
                    DocumentSection("Період", "${entry.optString("date_from")} — ${entry.optString("date_to")}"),
                    DocumentSection("Підсумок супроводу", entry.optString("summary")), DocumentSection("Динаміка", entry.optString("dynamics")),
                    DocumentSection("Рекомендації", entry.optString("recommendations")), DocumentSection("Подальший супровід", entry.optString("followup")),
                    DocumentSection("Психолог", entry.optString("psychologist_name", entry.optString("psychologist"))),
                    DocumentSection("Підпис психолога", "____________________"), DocumentSection("Підпис керівника", "____________________")), snapshot = entry)
            }); content.addView(row)
        }
    }
    private fun courses(content: LinearLayout, id: Long) {
        val entries = patient.optJSONArray("courses")
        if (entries == null || entries.length() == 0) empty(content, "Курсів поки немає")
        rows(entries) { entry ->
            val row = box(); row.addView(text("Курс № ${entry.optInt("course_no")}", 19f, true))
            section(row, "Статус", displayStatus(entry.optString("status")))
            section(row, "Період", entry.optString("started_at") + " — " + entry.optString("ended_at").replace("null", "триває"))
            section(row, "Мета курсу", entry.optString("reason")); section(row, "Підсумок", entry.optString("outcome"))
            content.addView(row)
        }
    }
    private fun referrals(content: LinearLayout, id: Long) {
        content.addView(button("Додати направлення") {
            form("Нове направлення") { fields, submit ->
                val destination = select(listOf("Психіатр", "Невролог", "Сімейний лікар", "Реабілітація", "Соціальний працівник", "Інший спеціаліст"))
                val name = input("Заклад або фахівець"); val reason = input("Причина направлення", lines = 4)
                fields.addView(destination); fields.addView(name); fields.addView(reason)
                submit { done -> api.call("POST", "/api/patients/$id/referrals", JSONObject().put("destination_type", destination.selectedItem.toString())
                    .put("destination_name", name.text.toString()).put("reason", reason.text.toString()).put("status", "recommended"),
                    { done(true); open(id, "referrals") }, { error(it); done(false) }) }
            }
        })
        val entries = patient.optJSONArray("referrals")
        if (entries == null || entries.length() == 0) empty(content, "Направлень поки немає")
        rows(entries) { entry ->
            val row = box(); row.addView(text(entry.optString("destination_type"), 18f, true))
            section(row, "Куди", entry.optString("destination_name")); section(row, "Причина", entry.optString("reason")); section(row, "Статус", displayStatus(entry.optString("status")))
            row.addView(button("Змінити статус") {
                val statuses = listOf("recommended", "sent", "completed", "cancelled")
                AlertDialog.Builder(activity).setTitle("Статус направлення").setItems(statuses.map { displayStatus(it) }.toTypedArray()) { _, index ->
                    api.call("PATCH", "/api/referrals/${entry.getLong("id")}", JSONObject().put("status", statuses[index]), { open(id, "referrals") }, { error(it) })
                }.show()
            })
            row.addView(button("Перегляд PDF") { document("Направлення", listOf(DocumentSection("Куди", entry.optString("destination_type") + " · " + entry.optString("destination_name")),
                DocumentSection("Причина", entry.optString("reason")), DocumentSection("Статус", displayStatus(entry.optString("status"))), DocumentSection("Дата", entry.optString("created")))) })
            content.addView(row)
        }
    }
    private fun document(title: String, sections: List<DocumentSection>, signature: String = "", snapshot: JSONObject = JSONObject()) {
        api.call("GET", "/api/settings/center", success = { value ->
            val center = value as JSONObject
            val name = snapshot.optString("center_name_snapshot").ifBlank { center.optString("center_name", "SOLVIA") }
            val identity = listOf(DocumentSection("Пацієнт", snapshot.optString("patient_name").ifBlank { patient.optString("name") }),
                DocumentSection("Номер картки", snapshot.optString("patient_no_snapshot").ifBlank { patient.optString("patient_no") }),
                DocumentSection("Дата народження", snapshot.optString("patient_dob").ifBlank { patient.optString("dob") }))
            preview(NativeDocument(title, name, identity + sections + listOf(DocumentSection("Контакти центру",
                snapshot.optString("center_address_snapshot").ifBlank { center.optString("address") } + "\n" + snapshot.optString("center_phone_snapshot").ifBlank { center.optString("phone") })), signature)) { render() }
        }, failure = { error(it) })
    }
    /** Forms stay open on server/network errors and block duplicate taps. */
    private fun form(title: String, build: (LinearLayout, (( ((Boolean) -> Unit) -> Unit) -> Unit)) -> Unit) {
        val body = box(); body.tag = "unsaved_form"; body.addView(text(title, 24f, true)); val fields = box(); body.addView(fields)
        val save = button("Зберегти") {}; body.addView(save)
        body.addView(button("Скасувати") {
            AlertDialog.Builder(activity).setTitle("Закрити форму?").setMessage("Незбережені зміни цієї форми буде втрачено.")
                .setNegativeButton("Продовжити", null).setPositiveButton("Закрити") { _, _ -> render() }.show()
        })
        build(fields) { action -> save.setOnClickListener {
            save.isEnabled = false
            try { action { success -> if (!success) save.isEnabled = true } }
            catch (exception: Exception) { save.isEnabled = true; error(exception.message ?: "Перевірте поля") }
        } }
        show(body) { AlertDialog.Builder(activity).setTitle("Залишити форму?").setMessage("Незбережені зміни буде втрачено.")
            .setNegativeButton("Продовжити", null).setPositiveButton("Залишити") { _, _ -> render() }.show() }
    }
}
