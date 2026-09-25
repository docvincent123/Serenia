package com.quremed.solvia

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Build
import android.provider.Settings
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
    private val openConfigRequest = 4101

    private val bg = Color.rgb(239, 246, 242)
    private val ink = Color.rgb(17, 52, 41)
    private val muted = Color.rgb(99, 122, 112)
    private val forest = Color.rgb(24, 103, 76)
    private val forestDark = Color.rgb(14, 73, 53)
    private val forestSoft = Color.rgb(228, 241, 234)
    private val line = Color.rgb(211, 226, 217)

    private var server = ""
    private var token = ""
    private var role = ""
    private var userName = ""
    private var backAction: (() -> Unit)? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        server = prefs.getString("server", "") ?: ""
        if (intent?.data != null) {
            importServerConfig(intent.data!!)
        } else if (server.isBlank()) setupScreen() else loginScreen()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radius: Int = 16, stroke: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
            stroke?.let { setStroke(dp(1), it) }
        }

    private fun isPrivateHost(host: String): Boolean {
        val h = host.lowercase()
        if (h == "localhost" || h == "127.0.0.1") return true
        val parts = h.split(".")
        if (parts.size != 4) return false
        val nums = parts.mapNotNull { it.toIntOrNull() }
        if (nums.size != 4 || nums.any { it !in 0..255 }) return false
        return nums[0] == 10 ||
            (nums[0] == 192 && nums[1] == 168) ||
            (nums[0] == 172 && nums[1] in 16..31)
    }

    private fun root(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(bg)
        setPadding(dp(18), dp(20), dp(18), dp(30))
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
        setTypeface(typeface, Typeface.BOLD)
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
        setPadding(dp(14), dp(13), dp(14), dp(13))
        if (password) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        background = rounded(Color.WHITE, 13, line)
    }

    private fun primary(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14f
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(14), dp(10), dp(14), dp(10))
        background = rounded(forest, 13)
        setOnClickListener { action() }
    }

    private fun secondary(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(forestDark)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = rounded(forestSoft, 13, line)
        setOnClickListener { action() }
    }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(15), dp(16), dp(15))
        background = rounded(Color.WHITE, 17, line)
        elevation = dp(2).toFloat()
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
        require(raw.isNotBlank())
        if (!raw.contains("://")) {
            val possibleHost = raw.substringBefore(':').trim()
            raw = if (isPrivateHost(possibleHost)) "http://$raw" else "https://$raw"
        }
        val uri = URI(raw)
        val scheme = uri.scheme?.lowercase()
        val host = uri.host ?: throw IllegalArgumentException("Не знайдено IP/host")
        require(scheme == "http" || scheme == "https")
        require(uri.userInfo == null && uri.query == null && uri.fragment == null)
        require(uri.path.isNullOrEmpty() || uri.path == "/")
        require(uri.port == -1 || uri.port in 1..65535)
        if (scheme == "http") require(isPrivateHost(host)) {
            "HTTP дозволений тільки для локальної приватної IP-адреси"
        }
        val port = when {
            uri.port != -1 -> uri.port
            scheme == "http" && isPrivateHost(host) -> 8765
            scheme == "https" && isPrivateHost(host) -> 8443
            else -> -1
        }
        return URI(scheme, null, host.lowercase(), port, null, null, null).toString().trimEnd('/')
    }

    private fun requestAt(base: String, method: String, path: String, body: JSONObject? = null): Any {
        val connection = URL(base + path).openConnection() as HttpURLConnection
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
                ?: "Помилка сервера $code"
            throw IllegalStateException(message)
        }
        return parsed
    }

    private fun request(method: String, path: String, body: JSONObject? = null): Any =
        requestAt(server, method, path, body)

    private fun apiAsync(method: String, path: String, body: JSONObject? = null, ok: (Any) -> Unit) {
        io.execute {
            try {
                val result = request(method, path, body)
                runOnUiThread { ok(result) }
            } catch (e: Exception) {
                runOnUiThread {
                    val message = e.message ?: "Помилка підключення"
                    if (message.contains("Увійдіть у систему", true)) {
                        token = ""
                        Toast.makeText(this, "Сесію завершено. Увійдіть знову.", Toast.LENGTH_LONG).show()
                        loginScreen()
                    } else {
                        showError(message)
                    }
                }
            }
        }
    }

    private fun openServerConfigFile() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(intent, openConfigRequest)
    }

    private fun importServerConfig(uri: android.net.Uri) {
        io.execute {
            try {
                val text = contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                    ?: throw IllegalStateException("Не вдалося прочитати файл")
                val json = JSONObject(text)
                require(json.optString("format") == "quremed.solvia.mobile") { "Це не файл підключення SOLVIA" }
                val candidate = normalize(
                    json.optString("api_url").ifBlank {
                        json.optString("http_url").ifBlank { json.optString("https_url") }
                    }
                )
                val health = requestAt(candidate, "GET", "/api/health") as JSONObject
                require(health.optBoolean("ok")) { "Сервер не підтвердив готовність" }
                server = candidate
                prefs.edit().putString("server", server).apply()
                runOnUiThread {
                    Toast.makeText(this, "Сервер SOLVIA підключено: $server", Toast.LENGTH_LONG).show()
                    loginScreen()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    showError("Не вдалося імпортувати підключення: " + (e.message ?: "невідома помилка"))
                    setupScreen()
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == openConfigRequest && resultCode == RESULT_OK && data?.data != null) {
            importServerConfig(data.data!!)
        }
    }

    private fun setupScreen() {
        backAction = null
        val body = root()
        body.addView(logo())
        body.addView(title("Підключення до SOLVIA", 27f))
        body.addView(caption("Найпростіше — відкрити файл SOLVIA-Mobile.solvia, створений серверним ПК. IP і порт підтягнуться автоматично."))

        val importCard = card()
        importCard.background = rounded(forestSoft, 17, line)
        importCard.addView(title("Автоматичне підключення", 18f))
        importCard.addView(caption("На серверному ПК файл знаходиться у Public Documents → QureMed → SOLVIA. Скопіюйте його на телефон або планшет."))
        importCard.addView(primary("Відкрити файл SOLVIA-Mobile.solvia") { openServerConfigFile() })
        body.addView(importCard)
        body.addView(spacer(14))

        body.addView(title("Або введіть адресу вручну", 18f))
        body.addView(caption("Локально можна: 192.168.1.100 або http://192.168.1.100:8765. Для VPS використовуйте тільки https://."))
        val address = edit("192.168.1.100").apply {
            setText(server)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        body.addView(address)
        body.addView(spacer(8))
        body.addView(primary("Перевірити та підключитися") {
            val previous = server
            try {
                val candidate = normalize(address.text.toString())
                io.execute {
                    try {
                        val health = requestAt(candidate, "GET", "/api/health") as JSONObject
                        require(health.optBoolean("ok")) { "Сервер не готовий" }
                        server = candidate
                        prefs.edit().putString("server", server).apply()
                        runOnUiThread {
                            Toast.makeText(this, "Підключено · SOLVIA " + health.optString("version", "2.0"), Toast.LENGTH_LONG).show()
                            loginScreen()
                        }
                    } catch (e: Exception) {
                        server = previous
                        runOnUiThread { showError(e.message ?: "Немає зв’язку із сервером") }
                    }
                }
            } catch (e: Exception) {
                showError(e.message ?: "Вкажіть коректну адресу сервера")
            }
        })
        body.addView(spacer(10))
        body.addView(caption("Примітка: HTTP дозволяється тільки для приватної локальної мережі. Для доступу через інтернет/VPS SOLVIA вимагає HTTPS."))
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
                .put("device_id", Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "")
                .put("device_name", (Build.MANUFACTURER + " " + Build.MODEL).trim())
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
        if (role == "admin") addTab("Пристрої") { devicesScreen() }
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
        if (role == "admin" || role == "psychologist") {
            apiAsync("GET", "/api/reminders") { result ->
                val reminders = result as JSONArray
                if (reminders.length() > 0) {
                    outer.addView(spacer())
                    val box = card()
                    box.addView(title("Найближчі записи", 18f))
                    for (i in 0 until reminders.length().coerceAtMost(5)) {
                        val item = reminders.getJSONObject(i)
                        box.addView(caption(
                            item.optString("start").takeLast(5) + " · " +
                            item.optString("patients") + " · " +
                            item.optString("psychologist")
                        ))
                    }
                    outer.addView(box)
                }
            }
        }
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
                        break
                    }
                }
            }

            if (eligible.isEmpty()) {
                showError("На сьогодні немає активного запису цього пацієнта.")
                return@apiAsync
            }

            val wrap = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(6), dp(12), dp(18))
                setBackgroundColor(bg)
            }
            val scroll = ScrollView(this).apply { addView(wrap) }

            wrap.addView(title(patientName, 20f))
            wrap.addView(caption("Усі поля нижче передаються в API SOLVIA та зберігаються у PostgreSQL на серверному ПК."))

            val appointmentSpinner = Spinner(this)
            val appointmentLabels = eligible.map {
                it.optString("start").takeLast(5) + " · " + it.optString("room")
            }
            appointmentSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, appointmentLabels)

            val typeValues = listOf("primary", "repeat", "crisis", "individual", "family", "child", "group")
            val typeLabels = listOf("Первинна", "Повторна", "Кризова", "Індивідуальна", "Сімейна", "Дитяча", "Групова")
            val typeSpinner = Spinner(this)
            typeSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, typeLabels)

            val riskValues = listOf("low", "moderate", "high", "critical")
            val riskLabels = listOf("Низький", "Помірний", "Високий", "Критичний")
            val riskSpinner = Spinner(this)
            riskSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, riskLabels)

            val duration = edit("Тривалість, хв").apply {
                setText("60")
                inputType = InputType.TYPE_CLASS_NUMBER
            }
            val requestText = edit("Запит / причина звернення").apply { minLines = 2 }
            val stateText = edit("Стан на початку консультації").apply { minLines = 2 }
            val workDone = edit("Що було проведено").apply { minLines = 3 }
            val note = edit("Приватна нотатка психолога").apply { minLines = 3 }
            val goals = edit("Цілі роботи").apply { minLines = 2 }
            val next = edit("План наступної консультації").apply { minLines = 2 }
            val homework = edit("Домашнє завдання").apply { minLines = 2 }
            val recommendations = edit("Рекомендації").apply { minLines = 2 }
            val resultText = edit("Результат / динаміка").apply { minLines = 2 }

            val flagValues = listOf(
                "anxiety" to "Тривога",
                "depression" to "Депресивні прояви",
                "ptsd" to "ПТСР / флешбеки",
                "sleep" to "Порушення сну",
                "panic" to "Панічні прояви",
                "aggression" to "Агресія / дратівливість",
                "suicide" to "Суїцидальний ризик",
                "harm_others" to "Ризик для оточення",
                "urgent_followup" to "Терміновий повторний контакт",
                "doctor_referral" to "Скерування до лікаря / психіатра"
            )
            val flagChecks = flagValues.map { pair ->
                CheckBox(this).apply {
                    text = pair.second
                    setTextColor(ink)
                    textSize = 13f
                }
            }

            fun addGap() = wrap.addView(spacer(8))
            wrap.addView(caption("Запис у календарі"))
            wrap.addView(appointmentSpinner)
            addGap()
            wrap.addView(caption("Тип консультації"))
            wrap.addView(typeSpinner)
            addGap()
            wrap.addView(duration)
            addGap()
            wrap.addView(requestText)
            addGap()
            wrap.addView(stateText)
            addGap()
            wrap.addView(workDone)
            addGap()
            wrap.addView(note)
            addGap()
            wrap.addView(goals)
            addGap()
            wrap.addView(next)
            addGap()
            wrap.addView(homework)
            addGap()
            wrap.addView(recommendations)
            addGap()
            wrap.addView(resultText)
            addGap()
            wrap.addView(caption("Рівень ризику"))
            wrap.addView(riskSpinner)
            addGap()
            wrap.addView(title("Важливі позначки", 16f))
            flagChecks.forEach { wrap.addView(it) }

            val dialog = AlertDialog.Builder(this)
                .setTitle("Підсумок консультації")
                .setView(scroll)
                .setNegativeButton("Скасувати", null)
                .setPositiveButton("Зберегти", null)
                .create()

            dialog.setOnShowListener {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val minutes = duration.text.toString().toIntOrNull() ?: 0
                    if (note.text.toString().isBlank()) {
                        Toast.makeText(this, "Заповніть приватну нотатку психолога.", Toast.LENGTH_LONG).show()
                        return@setOnClickListener
                    }
                    if (minutes !in 10..480) {
                        Toast.makeText(this, "Тривалість має бути від 10 до 480 хвилин.", Toast.LENGTH_LONG).show()
                        return@setOnClickListener
                    }

                    val appointment = eligible[appointmentSpinner.selectedItemPosition]
                    val flags = JSONArray()
                    flagChecks.forEachIndexed { index, check ->
                        if (check.isChecked) flags.put(flagValues[index].first)
                    }
                    val payload = JSONObject()
                        .put("patient_id", patientId)
                        .put("appointment_id", appointment.getLong("id"))
                        .put("note", note.text.toString())
                        .put("goals", goals.text.toString())
                        .put("next_plan", next.text.toString())
                        .put("homework", homework.text.toString())
                        .put("recommendations", recommendations.text.toString())
                        .put("consultation_type", typeValues[typeSpinner.selectedItemPosition])
                        .put("duration_minutes", minutes)
                        .put("request_text", requestText.text.toString())
                        .put("state_text", stateText.text.toString())
                        .put("work_done", workDone.text.toString())
                        .put("result_text", resultText.text.toString())
                        .put("risk_level", riskValues[riskSpinner.selectedItemPosition])
                        .put("risk_flags", flags)

                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                    apiAsync("POST", "/api/consultations", payload) {
                        dialog.dismiss()
                        Toast.makeText(this, "Консультацію збережено в SOLVIA.", Toast.LENGTH_LONG).show()
                        patientScreen(patientId)
                    }
                }
            }
            dialog.show()
        }
    }

    private fun devicesScreen() {
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar("Активні пристрої", ::homeScreen))
        body.addView(caption("Телефони, планшети та ПК з активним входом у SOLVIA."))
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(list)
        setContentView(scroll(body))

        fun load() {
            apiAsync("GET", "/api/admin/sessions") { result ->
                list.removeAllViews()
                val sessions = result as JSONArray
                if (sessions.length() == 0) {
                    list.addView(caption("Активних сесій немає."))
                    return@apiAsync
                }
                for (i in 0 until sessions.length()) {
                    val session = sessions.getJSONObject(i)
                    val box = card()
                    box.addView(title(session.optString("device_name", session.optString("platform")), 17f))
                    box.addView(caption(
                        session.optString("name") + " · " +
                        roleLabel(session.optString("role")) + " · " +
                        session.optString("ip_address", "—")
                    ))
                    box.addView(caption(
                        (if (session.optBoolean("online")) "Онлайн" else "Неактивний") +
                        " · остання активність " + session.optString("last_seen", "—")
                    ))
                    box.addView(primary("Завершити сесію") {
                        AlertDialog.Builder(this)
                            .setTitle("Завершити сесію?")
                            .setMessage(session.optString("name") + " · " + session.optString("device_name"))
                            .setNegativeButton("Скасувати", null)
                            .setPositiveButton("Завершити") { _, _ ->
                                apiAsync("DELETE", "/api/admin/sessions/" + session.getString("session_id"), JSONObject()) {
                                    load()
                                }
                            }
                            .show()
                    })
                    list.addView(box)
                    list.addView(spacer(8))
                }
            }
        }
        load()
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
