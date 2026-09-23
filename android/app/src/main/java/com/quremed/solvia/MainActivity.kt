package com.quremed.solvia

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.Space
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.LocalDate
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("solvia_settings", MODE_PRIVATE) }
    private val io = Executors.newSingleThreadExecutor()

    private val bg = Color.rgb(244, 247, 243)
    private val ink = Color.rgb(21, 58, 48)
    private val muted = Color.rgb(103, 123, 114)
    private val forest = Color.rgb(31, 101, 77)

    private var server = ""
    private var token = ""
    private var role = ""
    private var userName = ""
    private var backAction: (() -> Unit)? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        server = prefs.getString("server", "") ?: ""
        if (server.isBlank()) setupScreen() else loginScreen()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun root(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(bg)
        setPadding(dp(18), dp(18), dp(18), dp(24))
    }

    private fun logo(size: Int = 82): ImageView = ImageView(this).apply {
        setImageResource(R.drawable.solvia_icon)
        adjustViewBounds = true
        scaleType = ImageView.ScaleType.CENTER_CROP
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size)).apply { bottomMargin = dp(12) }
    }

    private fun title(value: String, size: Float = 28f): TextView = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(ink)
        setPadding(0, dp(8), 0, dp(10))
    }

    private fun caption(value: String): TextView = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(muted)
        setPadding(0, 0, 0, dp(12))
    }

    private fun edit(hintText: String, password: Boolean = false): EditText = EditText(this).apply {
        hint = hintText
        textSize = 16f
        setTextColor(ink)
        setHintTextColor(Color.GRAY)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        if (password) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        backgroundTintList = android.content.res.ColorStateList.valueOf(forest)
    }

    private fun primary(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14f
        setTextColor(Color.WHITE)
        setBackgroundColor(forest)
        setOnClickListener { action() }
    }

    private fun secondary(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(ink)
        setOnClickListener { action() }
    }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(15), dp(13), dp(15), dp(13))
        setBackgroundColor(Color.WHITE)
        elevation = dp(1).toFloat()
    }

    private fun scroll(content: View): ScrollView = ScrollView(this).apply {
        isFillViewport = true
        addView(content)
    }

    private fun spacer(h: Int = 10): Space = Space(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(h))
    }

    private fun showError(message: String) {
        AlertDialog.Builder(this)
            .setTitle("SOLVIA")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    private fun normalize(value: String): String {
        var raw = value.trim()
        if (!raw.contains("://")) raw = "https://" + raw
        val uri = URI(raw)
        require(uri.scheme.equals("https", true) && uri.host != null && uri.userInfo == null)
        require(uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/"))
        require(uri.port == -1 || uri.port in 1..65535)
        val port = if (uri.port == 443) -1 else uri.port
        return URI("https", null, uri.host.lowercase(), port, null, null, null).toString().trimEnd('/')
    }

    private fun request(method: String, path: String, body: JSONObject? = null): Any {
        val connection = URL(server + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 6000
        connection.readTimeout = 12000
        connection.setRequestProperty("Accept", "application/json")
        if (token.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer " + token)
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }

        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val parsed: Any = if (text.isBlank()) JSONObject() else JSONTokener(text).nextValue()

        if (code !in 200..299) {
            val message = (parsed as? JSONObject)?.optString("error")?.takeIf { it.isNotBlank() }
                ?: "Помилка сервера " + code
            throw IllegalStateException(message)
        }
        return parsed
    }

    private fun apiAsync(method: String, path: String, body: JSONObject? = null, ok: (Any) -> Unit) {
        io.execute {
            try {
                val result = request(method, path, body)
                runOnUiThread { ok(result) }
            } catch (e: Exception) {
                runOnUiThread { showError(e.message ?: "Помилка підключення") }
            }
        }
    }

    private fun setupScreen() {
        backAction = null
        val body = root()
        body.addView(logo())
        body.addView(title("SOLVIA by QureMed", 18f))
        body.addView(title("Підключення до центру"))
        body.addView(caption("Введіть HTTPS-адресу серверного ПК. SOLVIA використовує порт 8443."))
        val address = edit("https://192.168.1.100:8443").apply {
            setText(if (server.isBlank()) "https://192.168.1.100:8443" else server)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        body.addView(address)
        body.addView(spacer())
        body.addView(caption("На планшеті має бути встановлений QureMed-Local-CA.crt як довірений CA-сертифікат."))
        body.addView(primary("Підключитися") {
            try {
                server = normalize(address.text.toString())
                prefs.edit().putString("server", server).apply()
                loginScreen()
            } catch (_: Exception) {
                showError("Вкажіть коректну HTTPS-адресу, наприклад https://192.168.1.100:8443")
            }
        })
        setContentView(scroll(body))
    }

    private fun loginScreen() {
        backAction = { setupScreen() }
        val body = root()
        body.addView(logo())
        body.addView(title("SOLVIA 2.0", 20f))
        body.addView(title("Вхід до центру"))
        body.addView(caption(server))
        val login = edit("Логін")
        val password = edit("Пароль", true)
        body.addView(login)
        body.addView(spacer(6))
        body.addView(password)
        body.addView(spacer())
        body.addView(primary("Увійти") {
            val payload = JSONObject()
                .put("login", login.text.toString())
                .put("password", password.text.toString())
                .put("platform", "Android")
            apiAsync("POST", "/api/login", payload) { result ->
                val obj = result as JSONObject
                token = obj.getString("token")
                val user = obj.getJSONObject("user")
                role = user.getString("role")
                userName = user.getString("name")
                homeScreen()
            }
        })
        body.addView(secondary("Змінити сервер") { setupScreen() })
        setContentView(scroll(body))
    }

    private fun homeScreen() {
        backAction = null
        val checking = root()
        checking.addView(logo(64))
        checking.addView(title("SOLVIA 2.0", 20f))
        checking.addView(caption("Перевіряємо відкриття зміни…"))
        setContentView(scroll(checking))
        apiAsync("GET", "/api/shift-day") { result ->
            val shift = result as JSONObject
            if (shift.optBoolean("open", false)) renderHomeScreen()
            else renderShiftGate(shift)
        }
    }

    private fun renderShiftGate(shift: JSONObject) {
        val body = root()
        body.addView(logo())
        body.addView(title("Зміна ще не відкрита"))
        body.addView(caption("Дата: " + shift.optString("shift_date", LocalDate.now().toString())))
        if (role == "admin") {
            body.addView(caption("Підтвердіть відкриття робочої зміни. Після цього команда зможе працювати в SOLVIA."))
            body.addView(primary("Підтвердити відкриття зміни") {
                apiAsync("POST", "/api/shift-day", JSONObject().put("action", "open")) { homeScreen() }
            })
        } else {
            body.addView(caption("Адміністратор має підтвердити відкриття зміни на сьогодні."))
        }
        body.addView(secondary("Перевірити ще раз") { homeScreen() })
        body.addView(secondary("Вийти") {
            token = ""
            loginScreen()
        })
        setContentView(scroll(body))
    }

    private fun renderHomeScreen() {
        backAction = null
        val outer = root()
        outer.addView(logo(64))
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val user = TextView(this).apply {
            text = userName + "\n" + roleLabel(role)
            setTextColor(ink)
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        head.addView(user)
        head.addView(secondary("Вийти") {
            if (token.isNotBlank()) apiAsync("POST", "/api/logout", JSONObject()) { }
            token = ""
            loginScreen()
        })
        outer.addView(head)
        outer.addView(spacer())

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        fun addTab(label: String, action: () -> Unit) {
            val b = secondary(label, action)
            b.layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f)
            tabs.addView(b)
        }
        addTab("Календар") { calendarScreen() }
        addTab("Пацієнти") { patientsScreen() }
        if (role == "psychologist") addTab("Звіт") { reportScreen() }
        outer.addView(tabs)
        outer.addView(spacer())
        outer.addView(title("Робочий простір", 25f))
        outer.addView(caption("Нативний Android-клієнт SOLVIA. Дані завантажуються безпосередньо з API центру."))

        val today = card()
        today.addView(title("Сьогодні", 18f))
        today.addView(caption(LocalDate.now().toString()))
        today.addView(primary("Відкрити календар") { calendarScreen() })
        today.addView(spacer(6))
        today.addView(primary("Мої пацієнти") { patientsScreen() })
        outer.addView(today)
        setContentView(scroll(outer))
    }

    private fun topBar(label: String, back: () -> Unit): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(secondary("←") { back() })
        addView(TextView(this@MainActivity).apply {
            text = label
            textSize = 20f
            setTextColor(ink)
            setPadding(dp(8), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun calendarScreen(date: String = LocalDate.now().toString()) {
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar("Мій календар", ::homeScreen))
        val dateInput = edit("YYYY-MM-DD").apply { setText(date) }
        body.addView(dateInput)
        body.addView(primary("Показати день") { calendarScreen(dateInput.text.toString()) })
        body.addView(spacer())
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(list)
        setContentView(scroll(body))

        apiAsync("GET", "/api/appointments?date=" + date) { result ->
            list.removeAllViews()
            val rows = result as JSONArray
            if (rows.length() == 0) list.addView(caption("На цей день записів немає."))
            for (i in 0 until rows.length()) {
                val item = rows.getJSONObject(i)
                val patients = item.optJSONArray("patients") ?: JSONArray()
                val box = card()
                box.addView(title(item.optString("start").takeLast(5) + " — " + item.optString("end").takeLast(5), 18f))
                box.addView(caption(item.optString("room") + " · " + statusLabel(item.optString("status"))))
                for (j in 0 until patients.length()) {
                    val patient = patients.getJSONObject(j)
                    val patientId = patient.getLong("id")
                    val patientName = patient.getString("name")
                    box.addView(secondary(patientName + " →") { patientScreen(patientId) })
                }
                list.addView(box)
                list.addView(spacer(8))
            }
        }
    }

    private fun patientsScreen() {
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar(if (role == "psychologist") "Мої пацієнти" else "Пацієнти", ::homeScreen))
        val search = edit("Пошук за №, ПІБ, телефоном, категорією")
        body.addView(search)
        body.addView(spacer())
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(list)
        setContentView(scroll(body))

        apiAsync("GET", "/api/patients") { result ->
            val all = result as JSONArray

            fun render(query: String) {
                list.removeAllViews()
                for (i in 0 until all.length()) {
                    val patient = all.getJSONObject(i)
                    val hay = (
                        patient.optString("patient_no") + " " +
                        patient.optString("name") + " " +
                        patient.optString("phone") + " " +
                        patient.optString("category")
                    ).lowercase()
                    if (query.isNotBlank() && !hay.contains(query.lowercase())) continue
                    val patientId = patient.getLong("id")
                    val box = card()
                    box.setOnClickListener { patientScreen(patientId) }
                    box.addView(title(patient.optString("name"), 17f))
                    box.addView(caption("№" + patient.optString("patient_no", "—") + " · " + patient.optString("category") + " · " + patient.optString("phone")))
                    list.addView(box)
                    list.addView(spacer(8))
                }
            }

            render("")
            search.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    render(s?.toString().orEmpty())
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
    }

    private fun patientScreen(id: Long) {
        backAction = { patientsScreen() }
        val body = root()
        body.addView(topBar("Картка пацієнта", ::patientsScreen))
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(content)
        setContentView(scroll(body))

        apiAsync("GET", "/api/patients/" + id) { result ->
            val patient = result as JSONObject
            content.removeAllViews()
            content.addView(title(patient.optString("name")))
            content.addView(caption(
                "№" + patient.optString("patient_no", "—") + " · " +
                patient.optString("category") + " · " +
                patient.optString("phone") + " · " +
                patient.optString("dob")
            ))
            val profile = card()
            profile.addView(title("Профіль", 18f))
            profile.addView(caption("Сім’я: " + patient.optString("family", "—")))
            profile.addView(caption("Роль у сім’ї: " + patient.optString("family_role", "—")))
            profile.addView(caption("Адреса: " + patient.optString("address", "—")))
            profile.addView(caption("Статус: " + patient.optString("status", "active")))
            content.addView(profile)

            if (role == "psychologist") {
                content.addView(spacer())
                content.addView(primary("+ Додати консультацію") {
                    consultationDialog(id, patient.optString("name"))
                })
            }

            val consultations = patient.optJSONArray("consultations")
            if (consultations != null) {
                content.addView(spacer())
                content.addView(title("Історія консультацій", 20f))
                for (i in 0 until consultations.length()) {
                    val consultation = consultations.getJSONObject(i)
                    val box = card()
                    box.addView(caption(
                        consultation.optString("created").replace('T', ' ') + " · " +
                        consultation.optString("consultation_type", "repeat") + " · ризик " +
                        consultation.optString("risk_level", "low")
                    ))
                    box.addView(TextView(this).apply {
                        text = consultation.optString("note")
                        textSize = 15f
                        setTextColor(ink)
                    })
                    box.addView(caption("План: " + consultation.optString("next_plan", "—")))
                    content.addView(box)
                    content.addView(spacer(8))
                }
            }
        }
    }

    private fun consultationDialog(patientId: Long, patientName: String) {
        apiAsync("GET", "/api/appointments?date=" + LocalDate.now().toString()) { result ->
            val apps = result as JSONArray
            val eligible = mutableListOf<JSONObject>()
            for (i in 0 until apps.length()) {
                val appointment = apps.getJSONObject(i)
                val status = appointment.optString("status")
                if (status != "scheduled" && status != "confirmed") continue
                val patients = appointment.optJSONArray("patients") ?: JSONArray()
                for (j in 0 until patients.length()) {
                    if (patients.getJSONObject(j).optLong("id") == patientId) {
                        eligible.add(appointment)
                    }
                }
            }

            if (eligible.isEmpty()) {
                showError("На сьогодні немає активного запису цього пацієнта.")
                return@apiAsync
            }

            val wrap = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), 0, dp(12), 0)
            }
            val appointmentSpinner = Spinner(this)
            val appointmentLabels = eligible.map {
                it.optString("start").takeLast(5) + " · " + it.optString("room")
            }
            appointmentSpinner.adapter = ArrayAdapter(
                this,
                android.R.layout.simple_spinner_dropdown_item,
                appointmentLabels
            )

            val typeSpinner = Spinner(this)
            val types = listOf("primary", "repeat", "crisis", "individual", "family", "child", "group")
            typeSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, types)

            val riskSpinner = Spinner(this)
            val risks = listOf("low", "moderate", "high", "critical")
            riskSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, risks)

            val note = edit("Нотатка")
            val goals = edit("Цілі роботи")
            val next = edit("План наступної консультації")
            val homework = edit("Домашнє завдання")
            val recommendations = edit("Рекомендації")

            wrap.addView(caption(patientName))
            wrap.addView(appointmentSpinner)
            wrap.addView(typeSpinner)
            wrap.addView(riskSpinner)
            wrap.addView(note)
            wrap.addView(goals)
            wrap.addView(next)
            wrap.addView(homework)
            wrap.addView(recommendations)

            AlertDialog.Builder(this)
                .setTitle("Підсумок консультації")
                .setView(wrap)
                .setNegativeButton("Скасувати", null)
                .setPositiveButton("Зберегти") { _, _ ->
                    val appointment = eligible[appointmentSpinner.selectedItemPosition]
                    val payload = JSONObject()
                        .put("patient_id", patientId)
                        .put("appointment_id", appointment.getLong("id"))
                        .put("note", note.text.toString())
                        .put("goals", goals.text.toString())
                        .put("next_plan", next.text.toString())
                        .put("homework", homework.text.toString())
                        .put("recommendations", recommendations.text.toString())
                        .put("consultation_type", types[typeSpinner.selectedItemPosition])
                        .put("duration_minutes", 60)
                        .put("request_text", "")
                        .put("state_text", "")
                        .put("work_done", "")
                        .put("result_text", "")
                        .put("risk_level", risks[riskSpinner.selectedItemPosition])
                        .put("risk_flags", JSONArray())
                    apiAsync("POST", "/api/consultations", payload) {
                        patientScreen(patientId)
                    }
                }
                .show()
        }
    }

    private fun reportScreen() {
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar("Звіт за зміну", ::homeScreen))
        body.addView(caption(LocalDate.now().toString()))

        val summary = edit("Підсумок роботи за зміну").apply { minLines = 4 }
        val incidents = edit("Важливі події / ризики").apply { minLines = 3 }
        val handover = edit("Передача / що проконтролювати").apply { minLines = 3 }
        val critical = CheckBox(this).apply {
            text = "Були критичні випадки"
            setTextColor(ink)
        }
        val notifyAdmin = CheckBox(this).apply {
            text = "Потрібен контроль адміністратора"
            setTextColor(ink)
        }
        val notifyDirector = CheckBox(this).apply {
            text = "Повідомити керівника"
            setTextColor(ink)
        }

        body.addView(summary)
        body.addView(incidents)
        body.addView(handover)
        body.addView(critical)
        body.addView(notifyAdmin)
        body.addView(notifyDirector)
        body.addView(primary("Зберегти звіт") {
            val payload = JSONObject()
                .put("shift_date", LocalDate.now().toString())
                .put("summary", summary.text.toString())
                .put("incidents", incidents.text.toString())
                .put("handover", handover.text.toString())
                .put("critical_cases", critical.isChecked)
                .put("notify_admin", notifyAdmin.isChecked)
                .put("notify_director", notifyDirector.isChecked)

            apiAsync("POST", "/api/shift-reports", payload) { result ->
                val count = (result as JSONObject).optInt("consultations_count")
                Toast.makeText(
                    this,
                    "Звіт збережено · консультацій: " + count,
                    Toast.LENGTH_LONG
                ).show()
                homeScreen()
            }
        })
        setContentView(scroll(body))
    }

    private fun roleLabel(value: String): String = when (value) {
        "admin" -> "Адміністратор"
        "reception" -> "Реєстратура"
        "psychologist" -> "Психолог"
        "director" -> "Керівник центру"
        else -> value
    }

    private fun statusLabel(value: String): String = when (value) {
        "draft" -> "Чернетка"
        "scheduled" -> "Заплановано"
        "confirmed" -> "Підтверджено"
        "completed" -> "Проведено"
        "cancelled" -> "Скасовано"
        "no_show" -> "Не з’явився"
        else -> value
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        backAction?.invoke() ?: super.onBackPressed()
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }
}
