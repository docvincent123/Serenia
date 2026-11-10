import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

ApplicationWindow {
    id: root
    visible: true
    onClosing: function(event) { if (api.databaseWorking) event.accepted = false }
    width: 1400
    height: 890
    minimumWidth: 920
    minimumHeight: 640
    title: api.adminEdition ? "Lemvori Care Admin" : "Lemvori Care"
    color: "#EDF0F0"
    property string page: "Головна"
    property int bookingPatientId: 0
    property int bookingAssignedPsychId: 0
    property string selectedSlot: ""
    property var bookingOriginal: ({})
    property string calendarDay: today
    property string visitQuery: ""
    property string visitFilter: "all"
    readonly property bool shiftDateMismatch: api.shift.open === true &&
        !!api.shift.shift_date && api.shift.shift_date !== today
    readonly property var visibleVisits: {
        const needle = visitQuery.trim().toLowerCase()
        const items = api.visits || []
        return items.filter(function(item) {
            const status = root.visitStatus(item)
            if (root.visitFilter !== "all" && status !== root.visitFilter) return false
            if (!needle) return true
            const text = [item.patient, item.patient_no, item.phone, item.psychologist,
                          item.room, item.category].map(function(value) { return String(value || "") }).join(" ").toLowerCase()
            return text.includes(needle)
        })
    }
    readonly property color ink: "#11212D"
    readonly property color muted: "#4A5C6A"
    readonly property color accent: "#253745"
    readonly property color line: "#CCD0CF"
    readonly property string roleLabel: api.role === "admin" ? "Адміністратор"
        : api.role === "director" ? "Керівник" : "Реєстратура"
    readonly property var pageDescriptions: ({
        "Головна": "Стан роботи центру та швидкий доступ до щоденних дій",
        "Прийоми": "Прибуття пацієнтів і статус консультацій",
        "Пацієнти": "Знайдіть картку за іменем, телефоном або номером",
        "Психологи": "Працівники на зміні та їхня доступність",
        "Календар": "Прийоми за обрану дату, перенесення та скасування",
        "Виписки": "Перегляд і погодження документів центру",
        "Сервер": "Стан серверних служб і робочих пристроїв"
    })
    readonly property string today: Qt.formatDate(new Date(), "yyyy-MM-dd")

    function visitStatus(item) {
        if (item.completed_at || item.visit_status === "completed") return "completed"
        if (item.visit_status) return "other"
        if (item.started_at) return "busy"
        if (item.arrived_at) return "arrived"
        return "waiting"
    }
    function updateBookingSlots() {
        selectedSlot = ""
        if (bookingDialog.opened) slotDebounce.restart()
    }
    function showPage(next) {
        page = next
        if (next === "Адміністрування") api.loadAdminSection(adminWorkspace.section)
        if (next === "Виписки") api.loadDischarges()
        if (next === "Пацієнти") api.searchPatients(patientSearch.text)
        if (next === "Психологи" || next === "Прийоми" || next === "Календар") api.refresh()
    }
    // Start a real booking flow by selecting a patient from the live directory.
    // The server performs the actual slot and conflict checks in beginBooking().
    function openPatientDirectory(query) {
        patientSearch.text = String(query || "")
        showPage("Пацієнти")
        patientSearch.forceActiveFocus()
    }
    function beginBooking(patient) {
        bookingOriginal = ({})
        bookingPatientId = Number(patient.id)
        bookingAssignedPsychId = Number(patient.psychologist_id)
        bookingName.text = patient.name || "Пацієнт"
        bookingDate.text = calendarDay
        bookingDuration.value = 60
        bookingKind.currentIndex = 0
        bookingPsych.currentIndex = bookingPsych.indexOfValue(bookingAssignedPsychId)
        bookingDialog.open()
        updateBookingSlots()
    }
    function canChange(appointment) {
        return ["scheduled","confirmed","draft"].includes(appointment.status) &&
            !(appointment.patients || []).some(person => person.arrived_at || person.started_at || person.completed_at || person.visit_status)
    }
    function beginMove(appointment) {
        bookingOriginal = appointment
        bookingAssignedPsychId = Number(appointment.psychologist_id)
        bookingName.text = (appointment.patients || []).map(person => person.name).join(", ")
        bookingDate.text = String(appointment.start).slice(0,10)
        bookingDuration.value = api.durationMinutes(appointment.start, appointment.end)
        bookingPsych.currentIndex = bookingPsych.indexOfValue(bookingAssignedPsychId)
        bookingRoom.currentIndex = bookingRoom.indexOfValue(Number(appointment.room_id))
        bookingDialog.open()
        updateBookingSlots()
    }
    function changeCalendar(day) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(Date.parse(day))) return
        calendarDay = day
        api.setCalendarDate(day)
    }
    function stepCalendar(days) {
        const day = new Date(calendarDay + "T12:00:00Z")
        day.setUTCDate(day.getUTCDate() + days)
        calendarField.text = day.toISOString().slice(0, 10)
        changeCalendar(calendarField.text)
    }
    Connections {
        target: api
        function onStateChanged() {
            if (!api.authenticated) {
                bookingDialog.close()
                newPatientDialog.close()
                dischargeReview.close()
                cancelDialog.close()
            }
        }
        function onPatientRegistered(patient, bookAfter) {
            if (bookAfter && Number(patient.id) > 0) root.beginBooking(patient)
        }
        function onOperationCompleted(name) {
            if (name === "booking") bookingDialog.close()
            if (name === "patient") newPatientDialog.close()
            if (name === "discharge") dischargeReview.close()
            if (name === "cancel") cancelDialog.close()
        }
    }
    Timer {
        id: slotDebounce; interval: 220
        onTriggered: api.loadSlots(bookingDate.text, Number(bookingPsych.currentValue || 0),
            Number(bookingRoom.currentValue || 0), bookingDuration.value, Number(root.bookingOriginal.id || 0))
    }
    Timer { interval: 15000; running: root.visible && api.authenticated; repeat: true; onTriggered: api.refresh() }

    component SolviaButton: Button {
        id: btn
        property bool primary: false
        property bool subtle: false
        property bool onRail: false
        implicitHeight: 42
        implicitWidth: Math.max(98, contentItem.implicitWidth + 30)
        leftPadding: 15; rightPadding: 15
        font.pixelSize: 13
        font.weight: Font.DemiBold
        contentItem: Text {
            text: btn.text
            font: btn.font
            color: btn.onRail ? (btn.primary ? root.ink : "#F5F7F7")
                              : btn.primary ? "#fff" : root.ink
            opacity: btn.enabled ? 1 : 0.7
            horizontalAlignment: btn.onRail ? Text.AlignLeft : Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        background: Rectangle {
            radius: btn.onRail ? 11 : height / 2
            color: btn.onRail ? (btn.primary ? "#CCD0CF" : btn.hovered ? "#253745" : "transparent")
                         : !btn.enabled ? "#DEE2E2" : btn.down ? (btn.primary ? "#253745" : "#9BA8AB")
                         : btn.primary ? root.ink : btn.hovered ? "#CCD0CF" : btn.subtle ? "transparent" : "#ffffff"
            border.color: btn.visualFocus ? (btn.onRail || btn.primary ? "#9BA8AB" : root.accent)
                         : btn.primary || btn.subtle || btn.onRail ? "transparent" : root.line
            border.width: btn.visualFocus ? 2 : 1
        }
    }
    component CareField: TextField {
        id: field
        implicitHeight: 40
        leftPadding: 12; rightPadding: 12
        color: root.ink
        background: Rectangle {
            radius: 10
            color: "#FFFFFF"
            border.color: field.activeFocus ? root.accent : root.line
            border.width: field.activeFocus ? 2 : 1
        }
    }
    component CareSelect: ComboBox {
        id: select
        implicitHeight: 40
        leftPadding: 12
        contentItem: Label {
            text: select.displayText || "Оберіть"
            color: select.displayText ? root.ink : root.muted
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        background: Rectangle {
            radius: 10
            color: select.enabled ? "#FFFFFF" : "#EDF0F0"
            border.color: select.visualFocus ? root.accent : root.line
            border.width: select.visualFocus ? 2 : 1
        }
    }
    component MetricTile: Rectangle {
        property string figure: "—"
        property string heading: ""
        implicitWidth: 160
        implicitHeight: 114
        radius: 18
        color: "#ffffff"
        border.color: "#D9DEDF"
        Column {
            anchors.fill: parent; anchors.margins: 18; spacing: 9
            Text { text: figure; color: root.ink; font.pixelSize: 29; font.bold: true }
            Text { width: parent.width; text: heading; color: root.muted; font.pixelSize: 13; wrapMode: Text.WordWrap }
        }
    }
    component StatusChip: Rectangle {
        property string caption: ""
        property string state: "normal"
        implicitWidth: Math.max(100, chipText.implicitWidth + 22)
        implicitHeight: 30
        radius: 15
        color: state === "busy" ? "#fce7d4" : state === "waiting" ? "#fff3cb"
              : state === "available" ? "#e2f3e7" : "#efefed"
        Text { id: chipText; anchors.centerIn: parent; font.pixelSize: 11; font.bold: true
               color: state === "busy" ? "#8d4e18" : state === "waiting" ? "#796019"
                : state === "available" ? "#256540" : "#5f6464"; text: caption }
    }
    component Panel: Rectangle {
        color: "white"
        radius: 16
        border.color: root.line
        implicitHeight: innerContent.implicitHeight + 34
        property alias panelContent: innerContent.data
        ColumnLayout { id: innerContent; x: 17; y: 17; width: parent.width - 34; spacing: 12 }
    }
    component SectionHeading: Label {
        color: root.ink
        font.pixelSize: 24
        font.bold: true
    }

    Component.onCompleted: api.verifySavedServer()

    // Session tokens intentionally stay in RAM only.
    Item {
        anchors.fill: parent
        visible: !api.authenticated
        Rectangle {
            anchors.centerIn: parent
            width: 430
            height: loginForm.implicitHeight + 64
            radius: 24
            color: "#FFFFFF"
            border.color: root.line
            Rectangle {
                width: 48; height: 4; radius: 2
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top; anchors.topMargin: 13
                color: root.accent
            }
            ColumnLayout {
                id: loginForm
                anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top
                anchors.margins: 32
                spacing: 10
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12
                    Image {
                        source: "qrc:/brand.png"
                        Layout.preferredWidth: 46; Layout.preferredHeight: 46
                        fillMode: Image.PreserveAspectFit
                    }
                    ColumnLayout {
                        Layout.fillWidth: true; spacing: 3
                        Label { text: root.title; color: root.ink; font.pixelSize: 18; font.bold: true }
                        Label { text: "Реабілітаційний центр"; color: root.muted; font.pixelSize: 12 }
                    }
                }
                Label { text: "Вхід у систему"; color: root.ink; font.pixelSize: 28; font.bold: true; Layout.topMargin: 9 }
                Label {
                    text: api.adminEdition ? "Кабінет адміністратора" : "Кабінет реєстратури та керівника"
                    color: root.muted; font.pixelSize: 13
                }
                Label { text: "Логін"; color: root.ink; font.pixelSize: 13; Layout.topMargin: 10 }
                CareField {
                    id: username; Layout.fillWidth: true; Layout.preferredHeight: 44
                    Accessible.name: "Логін"; placeholderText: "Введіть логін"
                    selectByMouse: true; enabled: !api.working
                    onAccepted: password.forceActiveFocus()
                }
                Label { text: "Пароль"; color: root.ink; font.pixelSize: 13 }
                CareField {
                    id: password; Layout.fillWidth: true; Layout.preferredHeight: 44
                    Accessible.name: "Пароль"; placeholderText: "Введіть пароль"
                    echoMode: TextInput.Password; enabled: !api.working
                    onAccepted: { if (enter.enabled) enter.clicked() }
                }
                SolviaButton {
                    id: enter
                    Layout.fillWidth: true; Layout.preferredHeight: 46; Layout.topMargin: 4
                    primary: true
                    text: api.working && api.connected ? "Входимо…" : "Увійти"
                    enabled: api.connected && !api.working && !!username.text.trim() && !!password.text
                    onClicked: { api.login(username.text, password.text); password.clear() }
                }
                Label {
                    visible: api.connected && !!api.error && !connectionDialog.visible
                    Layout.fillWidth: true; wrapMode: Text.WordWrap
                    color: "#8C3632"; font.pixelSize: 12; text: api.error
                }
                Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; Layout.topMargin: 7; color: root.line }
                RowLayout {
                    Layout.fillWidth: true
                    Label {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap; font.pixelSize: 12
                        color: api.connected ? "#256540" : root.muted
                        text: api.connected ? "Сервер підключено" : api.working ? "Перевіряємо з’єднання…"
                              : api.error ? "З’єднання не встановлено" : "Підключіть сервер центру"
                    }
                    SolviaButton {
                        text: "Підключення"
                        subtle: true
                        enabled: !api.working || !api.connected
                        onClicked: connectionDialog.open()
                    }
                }
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent; spacing: 0
        visible: api.authenticated
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 77
            color: "#ffffff"
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 26; anchors.rightMargin: 26; spacing: 15
                Image { source: "qrc:/brand.png"; Layout.preferredWidth: 38; Layout.preferredHeight: 38; fillMode: Image.PreserveAspectFit }
                Text { text: root.title; font.pixelSize: 21; font.bold: true; color: root.ink }
                Rectangle { width: 1; height: 25; color: root.line }
                Text { text: root.roleLabel; color: root.muted; font.pixelSize: 13 }
                Item { Layout.fillWidth: true }
                Text { text: api.lastRefresh ? "Оновлено о " + api.lastRefresh : "Синхронізація…";
                       font.pixelSize: 11; color: root.muted }
                Rectangle { width: 1; height: 27; color: root.line }
                Text { Layout.maximumWidth: 190; text: api.displayName; elide: Text.ElideRight; color: root.ink; font.bold: true; font.pixelSize: 12 }
                SolviaButton { text: "Вихід"; subtle: true; enabled: !api.databaseWorking; onClicked: { api.logout(); root.page="Головна" } }
            }
        }
        Rectangle { Layout.fillWidth:true; Layout.preferredHeight:1; color:root.line }
        Rectangle {
            Layout.fillWidth:true; Layout.preferredHeight:52; color:"#F6F8F8"
            RowLayout {
                anchors.fill: parent; anchors.leftMargin:28; anchors.rightMargin:28; spacing:15
                Rectangle { width:7; height:7; radius:4; color:api.shift.open ? "#2e865b" : "#c7a045" }
                Text { text: api.shift.open ? "Зміна відкрита" : "Зміна не відкрита";
                       font.bold:true; color:root.ink; font.pixelSize:14 }
                Text {
                    text: root.shiftDateMismatch
                          ? "Відкрита з " + api.shift.shift_date + " — перевірте дату зміни"
                          : api.shift.shift_date || root.today
                    color: root.shiftDateMismatch ? "#99611D" : root.muted
                    font.pixelSize: 12; font.bold: root.shiftDateMismatch
                }
                Item { Layout.fillWidth:true }
                SolviaButton { text: api.shift.open ? "Закрити зміну" : "Відкрити зміну";
                    visible: api.role === "admin"
                    onClicked: api.shift.open ? closeShiftDialog.open() : api.setShift(true) }
            }
        }
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight:1; color:root.line }
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; spacing:0
            Rectangle {
                Layout.fillHeight: true; Layout.preferredWidth: 224
                color: "#344957"
                ScrollView {
                    anchors.fill: parent
                    padding: 12
                    clip: true
                    contentWidth: availableWidth
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    ColumnLayout {
                        width: parent.width
                        spacing: 5
                        Label {
                            text: api.role === "admin" ? "НАВІГАЦІЯ АДМІНІСТРАТОРА" : "РОБОЧЕ МЕНЮ"; color: "#E0E5E5"
                            font.pixelSize: 10; font.letterSpacing: 1.2
                            Layout.topMargin: 6; Layout.bottomMargin: 7; Layout.leftMargin: 14
                        }
                        Repeater {
                            model: api.role === "director"
                              ? ["Головна","Психологи","Виписки"]
                              : api.role === "reception"
                              ? ["Головна","Прийоми","Пацієнти","Психологи","Календар"]
                              : ["Головна","Адміністрування","Прийоми","Пацієнти","Психологи","Календар","Виписки","Сервер"]
                            delegate: SolviaButton {
                                required property string modelData
                                Layout.fillWidth: true
                                text: modelData
                                onRail: true
                                primary: root.page === modelData
                                onClicked: root.showPage(modelData)
                            }
                        }
                    }
                }
            }
            AdminWorkspace {
                id: adminWorkspace
                visible: root.page === "Адміністрування" && api.adminEdition && api.authenticated
                Layout.fillWidth: true; Layout.fillHeight: true
                bridge: api
            }
            ScrollView {
                visible: root.page !== "Адміністрування"
                id: scrollArea
                Layout.fillHeight:true; Layout.fillWidth:true; clip:true
                padding: 22
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                contentWidth: availableWidth
                ColumnLayout {
                    id: contentCol
                    width: scrollArea.availableWidth
                    spacing:18
                    RowLayout {
                        Layout.fillWidth:true
                        ColumnLayout {
                            Layout.fillWidth: true; spacing: 4
                            SectionHeading { text:root.page === "Головна" ? "Огляд центру" : root.page; Layout.fillWidth:true }
                            Label {
                                Layout.fillWidth: true; wrapMode: Text.WordWrap
                                text: root.pageDescriptions[root.page] || ""
                                color: root.muted; font.pixelSize: 13
                            }
                        }
                        SolviaButton { text:"+ Новий пацієнт"; visible:api.role!=="director"&&root.page==="Пацієнти";
                            primary:true; onClicked:newPatientDialog.open() }
                    }
                    Rectangle {
                        visible: api.error.length>0 || api.notice.length>0
                        Layout.fillWidth:true; Layout.preferredHeight:noticeText.implicitHeight + 22
                        color: api.error ? "#fff2ef" : "#eaf5ef"; radius:10
                        Text { id:noticeText; anchors.fill:parent; anchors.margins:11; color:api.error?"#a04439":"#287950";
                               font.pixelSize:12; text:api.error||api.notice; wrapMode:Text.WordWrap }
                    }

                    // Homepage: active workday and one-click access to operational modules.
                    ColumnLayout {
                        visible: root.page === "Головна"
                        Layout.fillWidth:true; spacing:18
                        Rectangle {
                            Layout.fillWidth: true; Layout.preferredHeight: 138
                            radius: 20; color: "#253745"
                            RowLayout {
                                anchors.fill: parent; anchors.margins: 22; spacing: 18
                                ColumnLayout {
                                    Layout.fillWidth: true; spacing: 7
                                    Label {
                                        text: api.role === "director" ? "КЕРУВАННЯ ЦЕНТРОМ" : "РОБОЧИЙ ПРОСТІР"
                                        color: "#C8D4DC"; font.pixelSize: 10; font.letterSpacing: 1.5
                                    }
                                    Label {
                                        text: api.role === "director" ? "Огляд роботи центру" : "Усе для щоденного прийому"
                                        color: "#FFFFFF"; font.bold: true; font.pixelSize: 23
                                    }
                                    Label {
                                        text: api.role === "director" ? "Дані центру та навантаження команди" : "Знайдіть пацієнта, перевірте час та створіть запис"
                                        color: "#E0E8EC"; font.pixelSize: 13; wrapMode: Text.WordWrap
                                        Layout.fillWidth: true
                                    }
                                }
                                SolviaButton {
                                    visible: api.role !== "director"
                                    text: "+ Записати на прийом"
                                    Accessible.name: "Відкрити пошук пацієнта для запису"
                                    onClicked: root.openPatientDirectory("")
                                }
                                SolviaButton {
                                    visible: api.role === "director"
                                    text: "Переглянути виписки"
                                    onClicked: root.showPage("Виписки")
                                }
                            }
                        }
                        RowLayout {
                            visible: api.role !== "director"; Layout.fillWidth: true; spacing: 10
                            CareField {
                                id: quickPatientSearch
                                Layout.fillWidth: true; Layout.preferredHeight: 46
                                Accessible.name: "Швидкий пошук пацієнта"
                                placeholderText: "Знайти пацієнта за ПІБ, телефоном або номером картки"
                                selectByMouse: true
                                onAccepted: root.openPatientDirectory(text)
                            }
                            SolviaButton {
                                text: "Знайти й записати"; primary: true
                                onClicked: root.openPatientDirectory(quickPatientSearch.text)
                            }
                        }
                        RowLayout {
                            Layout.fillWidth:true; spacing:12
                            MetricTile { Layout.fillWidth:true; figure:String(api.role === "director" ? (api.overview.total_patients ?? "—") : (api.overview.counts ? api.overview.counts.waiting : "—")); heading:api.role === "director" ? "Пацієнти центру" : "Очікують прийому" }
                            MetricTile { Layout.fillWidth:true; figure:String(api.role === "director" ? (api.overview.consultations ?? "—") : (api.overview.counts ? api.overview.counts.arrived : "—")); heading:api.role === "director" ? "Консультації за місяць" : "Прибули" }
                            MetricTile { Layout.fillWidth:true; figure:String(api.role === "director" ? (api.overview.active_courses ?? "—") : (api.overview.counts ? api.overview.counts.completed : "—")); heading:api.role === "director" ? "Активні курси" : "Завершені прийоми" }
                            MetricTile { Layout.fillWidth:true; figure:String((api.overview.active_patients !== undefined ? api.overview.active_patients : "—")); heading:"Активні пацієнти" }
                        }
                        RowLayout {
                            spacing:12; Layout.fillWidth:true
                            SolviaButton { text:"+ Новий запис"; visible: api.role !== "director"; primary:true; onClicked:root.openPatientDirectory("") }
                            SolviaButton { text:"Прийоми сьогодні"; visible: api.role !== "director"; onClicked:root.showPage("Прийоми") }
                            SolviaButton { text:"Психологи на зміні"; onClicked:root.showPage("Психологи") }
                            SolviaButton { text:"+ Новий пацієнт"; visible:api.role!=="director"; onClicked:newPatientDialog.open() }
                            SolviaButton { text:"Календар"; visible:api.role!=="director"; onClicked:root.showPage("Календар") }
                            SolviaButton { text:"Виписки"; visible:api.role==="director"; onClicked:root.showPage("Виписки") }
                        }
                        ColumnLayout {
                            visible: api.role === "director"; Layout.fillWidth: true; spacing: 9
                            Text { text:"Навантаження за місяць"; color:root.ink; font.bold:true; font.pixelSize:18 }
                            Repeater {
                                model: api.overview.load || []
                                delegate: Rectangle {
                                    required property var modelData
                                    Layout.fillWidth: true; implicitHeight: 48; radius: 12; color:"#CCD0CF"
                                    RowLayout {
                                        anchors.fill: parent; anchors.margins: 10
                                        Text { Layout.fillWidth:true; elide:Text.ElideRight; text:modelData.name || "Психолог"; color:root.ink; font.bold:true }
                                        Text { text:String(modelData.appointments ?? 0) + " прийомів · " + String(modelData.hours ?? 0) + " год"; color:root.muted }
                                    }
                                }
                            }
                        }
                        Panel {
                            visible: api.role !== "director"
                            Layout.fillWidth:true
                            panelContent: [
                                Text { text:"Найближчі прийоми"; font.pixelSize:18; font.bold:true; color:root.ink },
                                Repeater {
                                    model: api.overview.next || []
                                    delegate: Rectangle {
                                        required property var modelData
                                        Layout.fillWidth:true; implicitHeight:54; radius:8; color:"#DEE2E2"
                                        RowLayout { anchors.fill:parent; anchors.margins:12
                                            Text { text:String(modelData.start||"").slice(11,16); font.bold:true; color:root.ink }
                                            Text { text:modelData.patient||""; Layout.fillWidth:true; color:root.ink }
                                            Text { text:modelData.psychologist||""; color:root.muted; font.pixelSize:12 }
                                        }
                                    }
                                },
                                Text { visible:!(api.overview.next||[]).length; text:"Найближчих прийомів немає."; color:root.muted; font.pixelSize:13 },
                                SolviaButton { text: "Відкрити всі прийоми"; onClicked: root.showPage("Прийоми") }
                            ]
                        }
                    }

                    // Reception and administrator: patient arrival against real API.
                    ColumnLayout {
                        visible: root.page === "Прийоми"
                        Layout.fillWidth:true; spacing:12
                        Panel {
                            Layout.fillWidth: true
                            panelContent: [
                                ColumnLayout {
                                    Layout.fillWidth: true; spacing: 10
                                    Text { text:"Реєстр прийомів"; color:root.ink; font.bold:true; font.pixelSize:18 },
                                    CareField {
                                        Layout.fillWidth: true; text: root.visitQuery
                                        Accessible.name: "Пошук серед прийомів поточного дня"
                                        placeholderText: "Пошук пацієнта, психолога, кабінету або номера картки"
                                        selectByMouse: true
                                        onTextEdited: root.visitQuery = text
                                    },
                                    RowLayout {
                                        Layout.fillWidth: true; spacing: 7
                                        Repeater {
                                            model: [
                                                {key:"all", title:"Усі"},
                                                {key:"waiting", title:"Очікують"},
                                                {key:"arrived", title:"Прибули"},
                                                {key:"busy", title:"На прийомі"},
                                                {key:"completed", title:"Завершені"}
                                            ]
                                            delegate: SolviaButton {
                                                required property var modelData
                                                implicitWidth: 90
                                                text: modelData.title
                                                primary: root.visitFilter === modelData.key
                                                onClicked: root.visitFilter = modelData.key
                                            }
                                        }
                                        Item { Layout.fillWidth: true }
                                    },
                                    RowLayout {
                                        Layout.fillWidth: true
                                        Label { text: "Показано " + root.visibleVisits.length + " із " + api.visits.length + " прийомів"; color:root.muted; font.pixelSize:12 }
                                        Item { Layout.fillWidth: true }
                                        SolviaButton {
                                            text: "Скинути фільтри"; subtle: true
                                            visible: root.visitFilter !== "all" || root.visitQuery.length > 0
                                            onClicked: { root.visitFilter = "all"; root.visitQuery = "" }
                                        }
                                    }
                                }
                            ]
                        }
                        Repeater {
                            model: root.visibleVisits
                            delegate: Panel {
                                required property var modelData
                                Layout.fillWidth:true
                                panelContent: [
                                    RowLayout {
                                        Layout.fillWidth:true; spacing:14
                                        Text { text:String(modelData.start||"").slice(11,16); color:root.accent; font.bold:true; font.pixelSize:17 }
                                        ColumnLayout {
                                            Layout.fillWidth:true; spacing:4
                                            Text { text:modelData.patient||"Пацієнт"; color:root.ink; font.pixelSize:15; font.bold:true }
                                            Text { text:(modelData.psychologist||"") + " · " +(modelData.room||""); color:root.muted; font.pixelSize:12 }
                                        }
                                        StatusChip {
                                            state:modelData.started_at?"busy":modelData.arrived_at?"waiting":"normal"
                                            caption:modelData.completed_at?"Завершено":modelData.started_at?"На консультації":modelData.arrived_at?"Прибув":"Очікується"
                                        }
                                        SolviaButton {
                                            text:"Пацієнт прибув"
                                            visible:!modelData.arrived_at&&!modelData.started_at&&!modelData.completed_at&&modelData.visit_status===""
                                            onClicked:api.markArrived(Number(modelData.appointment_id),Number(modelData.patient_id))
                                        }
                                        SolviaButton { text:"Записати"; visible:api.role!=="director"
                                            onClicked: root.beginBooking({id:modelData.patient_id, psychologist_id:modelData.psychologist_id, name:modelData.patient}) }
                                    }
                                ]
                            }
                        }
                        Panel {
                            visible: root.visibleVisits.length === 0
                            Layout.fillWidth: true
                            panelContent: [
                                Text {
                                    text: api.visits.length === 0 ? "На сьогодні прийомів поки немає." : "За вибраними фільтрами прийомів не знайдено."
                                    color: root.ink; font.pixelSize: 15; font.bold: true
                                },
                                Text {
                                    text: api.visits.length === 0 ? "Створіть новий запис через пошук пацієнта." : "Спробуйте інший статус або пошуковий запит."
                                    color: root.muted; font.pixelSize: 13
                                },
                                SolviaButton {
                                    text: "Записати пацієнта"; primary: true
                                    visible: api.visits.length === 0
                                    onClicked: root.openPatientDirectory("")
                                }
                            ]
                        }
                    }

                    // Native patient directory, limited to the requested search results.
                    ColumnLayout {
                        visible: root.page==="Пацієнти"; Layout.fillWidth:true; spacing:12
                        CareField {
                            id: patientSearch; Layout.fillWidth:true
                            placeholderText:"Пошук за ПІБ, номером картки або телефоном"
                            selectByMouse:true
                            onTextEdited: patientDebounce.restart()
                        }
                        Timer { id:patientDebounce; interval:350; onTriggered:api.searchPatients(patientSearch.text) }
                        Repeater {
                            model: api.patients
                            delegate: Panel {
                                required property var modelData
                                Layout.fillWidth:true
                                panelContent: [
                                    RowLayout {
                                        Layout.fillWidth:true; spacing:12
                                        ColumnLayout {
                                            Layout.fillWidth:true
                                            Text { text:modelData.name||""; color:root.ink; font.pixelSize:16; font.bold:true }
                                            Text { text:"№ "+(modelData.patient_no||"—")+" · "+(modelData.psychologist||"Психолог не призначений");
                                                   color:root.muted; font.pixelSize:12 }
                                        }
                                        SolviaButton { text:"Записати на прийом"; onClicked:root.beginBooking(modelData) }
                                    }
                                ]
                            }
                        }
                        Panel {
                            visible: api.patients.length===0
                            Layout.fillWidth: true
                            panelContent: [
                                Text { text: "Нічого не знайдено"; color:root.ink; font.pixelSize:17; font.bold:true },
                                Text { text: "Перевірте ПІБ, номер картки або телефон. Якщо людина звернулася вперше — створіть картку."; color:root.muted; wrapMode:Text.WordWrap },
                                SolviaButton { text: "+ Створити картку пацієнта"; primary:true; onClicked: newPatientDialog.open() }
                            ]
                        }
                    }

                    // Roster endpoint is optional until the server-side PR is merged.
                    ColumnLayout {
                        visible:root.page==="Психологи"; Layout.fillWidth:true; spacing:13
                        Text { text:"Статуси обчислюються за прийомами; підключення телефона показано окремо.";
                               color:root.muted; font.pixelSize:12 }
                        Rectangle {
                            visible:!api.rosterSupported
                            Layout.fillWidth:true; implicitHeight:70; color:"#fff7e4"; radius:12
                            Text { anchors.fill:parent; anchors.margins:16; wrapMode:Text.WordWrap
                                   color:"#77591a"; font.pixelSize:13
                                   text:"Сервер ще не підтримує табло психологів. Після встановлення серверного модуля склад зміни з'явиться тут автоматично." }
                        }
                        Repeater {
                            model: api.roster
                            delegate: Panel {
                                required property var modelData
                                Layout.fillWidth:true
                                panelContent: [
                                    RowLayout {
                                        Layout.fillWidth:true; spacing:14
                                        ColumnLayout {
                                            Layout.fillWidth:true
                                            Text { text:modelData.name||""; color:root.ink; font.pixelSize:16; font.bold:true }
                                            Text { text:modelData.on_shift
                                                ? (modelData.connected ? "● Телефон на зв'язку" : "○ Телефон не на зв'язку")
                                                : "Поза поточною зміною"; color:root.muted; font.pixelSize:12 }
                                        }
                                        StatusChip {
                                            state:modelData.status||"normal"
                                            caption:modelData.status==="busy"?"На консультації":modelData.status==="waiting"?"Очікує пацієнт":modelData.status==="available"?"Вільний":"Поза зміною"
                                        }
                                        Text { text:"У роботі: "+(modelData.busy_count||0)+"   Очікують: "+(modelData.waiting_count||0);
                                               font.pixelSize:11; color:root.muted; visible:modelData.on_shift }
                                        SolviaButton { text:modelData.on_shift?"Зняти":"Додати"; visible:api.role==="admin"
                                            onClicked: modelData.on_shift
                                                ? (root.pendingStaffId=Number(modelData.id),confirmUnassign.open())
                                                : api.assignPsychologist(Number(modelData.id),true) }
                                    }
                                ]
                            }
                        }
                    }

                    // Calendar uses live appointment data without extra web rendering.
                    ColumnLayout {
                        visible:root.page==="Календар"; Layout.fillWidth:true; spacing:12
                        Panel {
                            Layout.fillWidth: true
                            panelContent: [
                                RowLayout {
                                    Layout.fillWidth: true
                                    SolviaButton { text: "‹"; Accessible.name: "Попередній день"; implicitWidth: 42; onClicked: root.stepCalendar(-1) }
                                    CareField {
                                        id: calendarField; text: root.calendarDay; inputMask: "9999-99-99"
                                        Accessible.name: "Дата календаря"; Layout.preferredWidth: 118
                                        onEditingFinished: root.changeCalendar(text)
                                    }
                                    SolviaButton { text: "›"; Accessible.name: "Наступний день"; implicitWidth: 42; onClicked: root.stepCalendar(1) }
                                    SolviaButton { text: "Сьогодні"; onClicked: { calendarField.text = root.today; root.changeCalendar(root.today) } }
                                    Item { Layout.fillWidth: true }
                                    Label { text: "Прийомів: " + api.appointments.length; color: root.muted }
                                }
                            ]
                        }
                        Repeater {
                            model:api.appointments
                            delegate: Panel {
                                required property var modelData
                                Layout.fillWidth:true
                                panelContent: [
                                    RowLayout {
                                        Layout.fillWidth:true
                                        Text { text:String(modelData.start||"").slice(11,16)+" — "+String(modelData.end||"").slice(11,16);
                                               font.bold:true; color:root.accent }
                                        ColumnLayout {
                                            Layout.fillWidth:true
                                            Text { Layout.fillWidth:true; elide:Text.ElideRight; text:(modelData.patients || []).map(person => person.name).join(", "); color:root.ink; font.bold:true }
                                            Text { text:(modelData.psychologist||"") + " · " + (modelData.room||""); color:root.muted; font.pixelSize:12 }
                                        }
                                        StatusChip { caption:modelData.status==="confirmed"?"Підтверджено":modelData.status==="scheduled"?"Заплановано":modelData.status==="cancelled"?"Скасовано":modelData.status==="completed"?"Завершено":"Чернетка" }
                                        SolviaButton { text:"Перенести"; visible:root.canChange(modelData); onClicked:root.beginMove(modelData) }
                                        SolviaButton { text:"Скасувати"; visible:root.canChange(modelData); onClicked:{ cancelDialog.appointmentId = Number(modelData.id); cancelReason.clear(); cancelDialog.open() } }
                                    }
                                ]
                            }
                        }
                        Text { visible:api.appointments.length===0; text:"На обрану дату прийомів немає."; color:root.muted }
                    }
                    ColumnLayout {
                        visible: root.page === "Виписки"
                        Layout.fillWidth: true; spacing: 10
                        Text { visible: !api.dischargeRows.length; text: "Виписок немає."; color: root.muted }
                        Repeater {
                            model: api.dischargeRows
                            delegate: Rectangle {
                                required property var modelData
                                Layout.fillWidth: true; implicitHeight: 75; radius: 15; color: "#CCD0CF"; border.color: root.line
                                RowLayout {
                                    anchors.fill: parent; anchors.margins: 12
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        Text { text: (modelData.patient_name || "") + " · № " + (modelData.document_no || "—"); font.bold: true; color: root.ink }
                                        Text { text: (modelData.author || "") + " · " + (modelData.workflow_status === "review" ? "На погодженні" : modelData.workflow_status === "approved" ? "Погоджено" : modelData.workflow_status === "draft" ? "Чернетка" : "Архівна"); color: root.muted }
                                    }
                                    SolviaButton { text: "Відкрити"; onClicked: { dischargeReview.record = modelData; reviewReason.clear(); dischargeReview.open() } }
                                }
                            }
                        }
                    }
                    ColumnLayout {
                        visible:root.page==="Сервер"&&api.role==="admin"; Layout.fillWidth:true; spacing:12
                        Text { text:"Захищений центр підключення · без команд Linux та доступу до shell";
                               font.pixelSize:12; color:root.muted }
                        Panel {
                            Layout.fillWidth:true
                            panelContent: [
                                Text { text:"Сервер Lemvori Care"; font.pixelSize:18; color:root.ink; font.bold:true },
                                Text { text:api.serverUrl; color:root.muted; font.pixelSize:13 },
                                Text { text:"Стан HTTPS: "+(api.connected?"підключено":"немає з'єднання"); color:root.ink },
                                Text { text: "PostgreSQL: " + (api.system.database ? (api.system.database.name || "—") : "—");
                                       color: root.ink; font.pixelSize:13 },
                                Text { text: "Диск: " + (api.system.host_resources && api.system.host_resources.disk_available
                                             ? Math.round(api.system.host_resources.disk_used_percent) + "% зайнято" : "немає даних");
                                       color:root.muted; font.pixelSize:12 },
                                SolviaButton { text:"Перевірити HTTPS"; onClicked:api.checkServer() }
                            ]
                        }
                    }
                    Item { Layout.preferredHeight:24 }
                }
            }
        }
    }

    property int pendingStaffId: 0
    Dialog {
        id:confirmUnassign; title:"Зняти психолога зі зміни?"; modal:true; anchors.centerIn:Overlay.overlay
        standardButtons:Dialog.Yes|Dialog.Cancel
        onAccepted:api.assignPsychologist(root.pendingStaffId,false)
        Label { text:"За наявності незавершених прийомів сервер заблокує цю дію."; wrapMode:Text.WordWrap }
    }
    Dialog {
        id:closeShiftDialog; title:"Закрити робочу зміну?"; modal:true; anchors.centerIn:Overlay.overlay
        standardButtons:Dialog.Yes|Dialog.Cancel
        onAccepted:api.setShift(false)
        Label { text:"Сервер перевірить незавершені консультації та синхронізацію телефонів."; wrapMode:Text.WordWrap }
    }
    Dialog {
        id: connectionDialog
        property bool attempted: false
        title: "Підключення до центру"
        modal: true
        anchors.centerIn: Overlay.overlay
        width: 510
        padding: 22
        onOpened: {
            attempted = false
            serverField.text = api.serverUrl
            serverField.forceActiveFocus()
        }
        background: Rectangle { color: "#FFFFFF"; radius: 20; border.color: root.line }
        header: Label {
            text: connectionDialog.title
            leftPadding: 22; topPadding: 18
            color: root.ink; font.pixelSize: 21; font.bold: true
        }
        contentItem: ColumnLayout {
            spacing: 11
            Label {
                Layout.fillWidth: true; wrapMode: Text.WordWrap
                text: "Введіть HTTPS-адресу або відкрийте файл підключення, який видав адміністратор центру."
                color: root.muted
            }
            Label { text: "Адреса сервера"; color: root.ink; font.bold: true }
            CareField {
                id: serverField
                Layout.fillWidth: true; enabled: !api.working
                Accessible.name: "Адреса сервера"; placeholderText: "https://server.center:8443"
                selectByMouse: true
                onAccepted: { if (verifyConnection.enabled) verifyConnection.clicked() }
            }
            RowLayout {
                Layout.fillWidth: true
                SolviaButton {
                    id: verifyConnection
                    text: api.working ? "Перевіряємо…" : "Перевірити адресу"
                    primary: true; enabled: !api.working && !!serverField.text.trim()
                    onClicked: {
                        connectionDialog.attempted = true
                        api.configureServer(serverField.text)
                    }
                }
                SolviaButton { text: "Відкрити файл центру"; enabled: !api.working; onClicked: centerFile.open() }
            }
            Label {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 12
                color: !api.working && api.error && (connectionDialog.attempted || !api.connected) ? "#8C3632"
                       : api.connected ? "#256540" : root.muted
                text: api.working ? "Перевіряємо HTTPS-з’єднання…"
                      : api.error && (connectionDialog.attempted || !api.connected) ? api.error
                      : api.connected ? "HTTPS-з’єднання підтверджено." : "Сервер ще не підключено."
            }
            SolviaButton {
                Layout.alignment: Qt.AlignRight
                text: "Готово"
                onClicked: connectionDialog.close()
            }
        }
    }
    Connections {
        target: api
        function onStateChanged() {
            if (connectionDialog.visible && connectionDialog.attempted && api.connected && !api.error) {
                serverField.text = api.serverUrl
            }
        }
    }
    FileDialog {
        id: centerFile
        title: "Виберіть файл підключення центру"
        nameFilters: ["Профіль центру (*.solvia *.json)"]
        onAccepted: {
            connectionDialog.attempted = true
            api.importProfile(selectedFile)
        }
    }
    Dialog {
        id: dischargeReview
        property var record: ({})
        title: "Виписка № " + (record.document_no || "—")
        modal: true; anchors.centerIn: Overlay.overlay
        width: Math.min(640, root.width - 40); height: Math.min(530, root.height - 30)
        contentItem: ScrollView {
            contentWidth: availableWidth
            ColumnLayout {
                width: parent.width
                Text { text: dischargeReview.record.patient_name || ""; font.bold: true; color: root.ink }
                Repeater {
                    model: [["Підсумок","summary"],["Динаміка","dynamics"],["Рекомендації","recommendations"],["Подальший супровід","followup"]]
                    delegate: ColumnLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        Text { text: modelData[0]; font.bold: true; color: root.ink }
                        Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; text: dischargeReview.record[modelData[1]] || "—"; color: root.muted }
                    }
                }
                CareField { id: reviewReason; visible: dischargeReview.record.workflow_status === "review"; Layout.fillWidth: true; placeholderText: "Причина повернення на доопрацювання" }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; text: api.error; visible: !!api.error; color: "#8C3632" }
                RowLayout {
                    visible: dischargeReview.record.workflow_status === "review"
                    SolviaButton { text: "Повернути"; enabled: !api.working && !!reviewReason.text.trim(); onClicked: api.reviewDischarge(Number(dischargeReview.record.id), Number(dischargeReview.record.revision), false, reviewReason.text) }
                    SolviaButton { text: "Погодити"; primary: true; enabled: !api.working; onClicked: api.reviewDischarge(Number(dischargeReview.record.id), Number(dischargeReview.record.revision), true, "") }
                }
            }
        }
        standardButtons: Dialog.Close
    }
    Dialog {
        id: cancelDialog
        property int appointmentId: 0
        title: "Скасувати прийом?"
        modal: true; anchors.centerIn: Overlay.overlay; width: 450
        ColumnLayout {
            width: parent.width
            CareField { id: cancelReason; Layout.fillWidth: true; placeholderText: "Причина скасування" }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; visible: !!api.error; text: api.error; color: "#8C3632" }
            RowLayout {
                SolviaButton { text:"Назад"; enabled:!api.working; onClicked:cancelDialog.close() }
                SolviaButton { text:"Підтвердити скасування"; primary:true; enabled:!api.working && !!cancelReason.text.trim(); onClicked:api.cancelBooking(cancelDialog.appointmentId,cancelReason.text) }
            }
        }
    }
    Dialog {
        id: bookingDialog
        title: root.bookingOriginal.id ? "Перенести прийом" : "Новий запис"
        modal: true
        anchors.centerIn: Overlay.overlay
        width: Math.min(820, root.width - 48)
        height: Math.min(568, root.height - 40)
        padding: 18
        background: Rectangle { color: "#FFFFFF"; radius: 17; border.color: root.line }
        header: Label {
            text: bookingDialog.title
            leftPadding: 18; topPadding: 16; bottomPadding: 3
            color: root.ink; font.pixelSize: 22; font.bold: true
        }
        onClosed: slotDebounce.stop()
        closePolicy: api.working ? Popup.NoAutoClose : Popup.CloseOnEscape | Popup.CloseOnPressOutside
        contentItem: ColumnLayout {
            spacing: 12
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 60
                radius: 12
                color: "#EDF0F0"
                RowLayout {
                    anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 14
                    Label { text: "ПАЦІЄНТ"; color: root.muted; font.pixelSize: 10; font.letterSpacing: 1.1 }
                    Label { id: bookingName; Layout.fillWidth: true; elide: Text.ElideRight; font.bold: true; color: root.ink; font.pixelSize: 16 }
                }
            }
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 16
                ScrollView {
                    Layout.fillHeight: true
                    Layout.preferredWidth: 320
                    Layout.minimumWidth: 294
                    contentWidth: availableWidth
                    clip: true
                    enabled: !api.working
                    ColumnLayout {
                        width: parent.width; spacing: 7
                        Label { text: "1  Параметри прийому"; color: root.ink; font.pixelSize: 16; font.bold: true }
                        Label { text: "Психолог"; color: root.muted; Layout.topMargin: 4 }
                        CareSelect {
                            id: bookingPsych; Layout.fillWidth: true
                            Accessible.name: "Психолог"
                            model: bookingDate.text === root.today ? api.bookingPsychologists : api.psychologists
                            textRole: "name"; valueRole: "id"; enabled: root.bookingAssignedPsychId === 0 && !api.working
                            onModelChanged: Qt.callLater(() => {
                                if (root.bookingAssignedPsychId) currentIndex = indexOfValue(root.bookingAssignedPsychId)
                            })
                            onCurrentValueChanged: root.updateBookingSlots()
                        }
                        Label {
                            visible: root.bookingAssignedPsychId > 0 && bookingDate.text === root.today &&
                                     !api.psychologistBookable(root.bookingAssignedPsychId, bookingDate.text)
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; color: "#8A501F"; font.pixelSize: 12
                            text: "Закріплений за пацієнтом психолог не на зміні. Попросіть адміністратора переглянути призначення."
                        }
                        Label { text: "Кабінет"; color: root.muted }
                        CareSelect {
                            id: bookingRoom; Layout.fillWidth: true; Accessible.name: "Кабінет"
                            model: api.rooms; textRole: "name"; valueRole: "id"
                            onCurrentValueChanged: root.updateBookingSlots()
                        }
                        Label { text: "Тип прийому"; visible: !root.bookingOriginal.id; color: root.muted }
                        CareSelect {
                            id: bookingKind; Layout.fillWidth: true; visible: !root.bookingOriginal.id; Accessible.name: "Тип прийому"
                            model: ["Індивідуальна","Дитяча","Кризова"]; currentIndex: 0
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            ColumnLayout {
                                Layout.fillWidth: true
                                Label { text: "Дата"; color: root.muted }
                                CareField {
                                    id: bookingDate; Layout.fillWidth: true; text: root.today
                                    Accessible.name: "Дата прийому"; inputMask: "9999-99-99"
                                    onTextChanged: root.updateBookingSlots()
                                }
                            }
                            ColumnLayout {
                                Layout.fillWidth: true
                                Label { text: "Тривалість, хв"; color: root.muted }
                                SpinBox {
                                    id: bookingDuration; Layout.fillWidth: true; Accessible.name: "Тривалість у хвилинах"
                                    from: 15; to: 240; value: 60; stepSize: 5; editable: true
                                    onValueChanged: root.updateBookingSlots()
                                }
                            }
                        }
                    }
                }
                Rectangle { Layout.fillHeight: true; Layout.preferredWidth: 1; color: root.line }
                ColumnLayout {
                    Layout.fillWidth: true; Layout.fillHeight: true; spacing: 8
                    Label { text: "2  Вільний час"; color: root.ink; font.pixelSize: 16; font.bold: true }
                    Label {
                        Layout.fillWidth: true; wrapMode: Text.WordWrap
                        text: api.slotError || (api.loadingSlots || slotDebounce.running ? "Перевіряємо розклад…"
                            : !bookingPsych.currentValue || !bookingRoom.currentValue ? "Оберіть психолога й кабінет."
                            : api.availableSlots.length ? "Оберіть час початку прийому."
                            : "Вільних годин немає. Перевірте іншу дату або кабінет.")
                        color: api.slotError ? "#8C3632" : root.muted
                    }
                    ScrollView {
                        id: slotScroll
                        Layout.fillWidth: true; Layout.fillHeight: true
                        contentWidth: availableWidth
                        clip: true
                        Flow {
                            width: slotScroll.availableWidth; spacing: 8
                            Repeater {
                                model: api.availableSlots
                                delegate: SolviaButton {
                                    required property string modelData
                                    text: modelData
                                    primary: root.selectedSlot === modelData
                                    Accessible.description: primary ? "Обраний час" : ""
                                    enabled: !api.working && !api.loadingSlots && !slotDebounce.running
                                    onClicked: root.selectedSlot = modelData
                                }
                            }
                        }
                    }
                }
            }
            Label {
                visible: !!api.error; Layout.fillWidth: true; wrapMode: Text.WordWrap
                color: "#8C3632"; text: api.error
            }
        }
        footer: Rectangle {
            implicitHeight: 66
            color: "transparent"
            Rectangle { anchors.top: parent.top; width: parent.width; height: 1; color: root.line }
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 18; anchors.rightMargin: 18; spacing: 10
                Label {
                    Layout.fillWidth: true; elide: Text.ElideRight
                    color: root.ink; font.bold: true
                    text: root.selectedSlot ? bookingDate.text + "  ·  " + root.selectedSlot + "–" +
                          api.endTime(root.selectedSlot, bookingDuration.value) : "Час ще не обрано"
                }
                SolviaButton { text: "Закрити"; enabled: !api.working; onClicked: bookingDialog.close() }
                SolviaButton {
                    primary: true
                    text: api.working ? "Зберігаємо…" : root.bookingOriginal.id ? "Перенести прийом" : "Підтвердити запис"
                    enabled: !api.working && !api.loadingSlots && !slotDebounce.running && api.availableSlots.includes(root.selectedSlot)
                    onClicked: {
                        const end = api.endTime(root.selectedSlot, bookingDuration.value)
                        if (root.bookingOriginal.id) {
                            api.moveBooking(root.bookingOriginal, Number(bookingRoom.currentValue), bookingDate.text, root.selectedSlot, end)
                        } else {
                            api.book(root.bookingPatientId, Number(bookingPsych.currentValue), Number(bookingRoom.currentValue),
                                bookingDate.text, root.selectedSlot, end, ["individual","child","crisis"][bookingKind.currentIndex])
                        }
                    }
                }
            }
        }
    }
    Dialog {
        id:newPatientDialog; title:"Новий пацієнт"; modal:true; anchors.centerIn:Overlay.overlay
        width:Math.min(500,root.width-60); standardButtons:Dialog.NoButton
        ColumnLayout {
            width:parent.width; spacing:10
            CareField { id:patientName; Layout.fillWidth:true; placeholderText:"Прізвище, ім'я та по батькові" }
            CareField { id:patientPhone; Layout.fillWidth:true; placeholderText:"Номер телефону" }
            Text { text:"Дата народження (РРРР-ММ-ДД)"; color:root.muted; font.pixelSize:12 }
            CareField { id:patientDob; Layout.fillWidth:true; inputMask:"9999-99-99"; selectByMouse:true }
            Text { text:"Категорія"; color:root.muted; font.pixelSize:12 }
            CareSelect { id:patientCategory; Layout.fillWidth:true; model:["Військовий/військова","Ветеран/ветеранка","Партнер/партнерка","Дитина","Інше"] }
            Text { text:"Психолог"; color:root.muted; font.pixelSize:12 }
            CareSelect { id:patientPsy; Layout.fillWidth:true; model:api.psychologists; textRole:"name"; valueRole:"id" }
            Text { Layout.fillWidth:true; wrapMode:Text.WordWrap; text:api.error; visible:!!api.error; color:"#8C3632" }
            RowLayout {
                Layout.fillWidth:true
                SolviaButton { text:"Скасувати"; enabled:!api.working; onClicked:newPatientDialog.close() }
                Item { Layout.fillWidth:true }
                SolviaButton { text:"Зберегти"; enabled:!api.working
                    onClicked:api.registerPatient(patientName.text,patientPhone.text,patientDob.text,
                                                   String(patientCategory.currentText),Number(patientPsy.currentValue),false) }
                SolviaButton { text:"Зберегти й записати"; primary:true; enabled:!api.working
                    onClicked:api.registerPatient(patientName.text,patientPhone.text,patientDob.text,
                                                   String(patientCategory.currentText),Number(patientPsy.currentValue),true) }
            }
        }
    }
}
