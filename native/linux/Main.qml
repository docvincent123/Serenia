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
    color: "#DEE2E2"
    property string page: "Головна"
    property int bookingPatientId: 0
    property int bookingAssignedPsychId: 0
    property string selectedSlot: ""
    property var bookingOriginal: ({})
    property string calendarDay: today
    readonly property color ink: "#11212D"
    readonly property color muted: "#4A5C6A"
    readonly property color accent: "#253745"
    readonly property color line: "#9BA8AB"
    readonly property string today: Qt.formatDate(new Date(), "yyyy-MM-dd")

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
        implicitHeight: 42
        implicitWidth: Math.max(98, contentItem.implicitWidth + 30)
        font.pixelSize: 13
        font.weight: Font.DemiBold
        contentItem: Text {
            text: btn.text
            font: btn.font
            color: btn.primary ? "#fff" : root.ink
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        background: Rectangle {
            radius: height / 2
            color: !btn.enabled ? "#DEE2E2" : btn.down ? (btn.primary ? "#253745" : "#9BA8AB")
                         : btn.primary ? root.ink : btn.hovered ? "#CCD0CF" : btn.subtle ? "transparent" : "#ffffff"
            border.color: btn.primary || btn.subtle ? "transparent" : root.line
            border.width: 1
        }
    }
    component MetricTile: Rectangle {
        property string figure: "—"
        property string heading: ""
        implicitWidth: 180
        implicitHeight: 110
        radius: 14
        color: "#ffffff"
        border.color: root.line
        Column {
            anchors.fill: parent; anchors.margins: 18; spacing: 9
            Text { text: figure; color: root.ink; font.pixelSize: 29; font.bold: true }
            Text { text: heading; color: root.muted; font.pixelSize: 13 }
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

    // Login / server provisioning. Session tokens intentionally stay in RAM only.
    Rectangle {
        anchors.fill: parent
        visible: !api.authenticated
        color: "#DEE2E2"
        RowLayout {
            anchors.centerIn: parent
            width: Math.min(910, parent.width - 60)
            height: 490
            spacing: 0
            Rectangle {
                Layout.fillHeight: true
                Layout.preferredWidth: 350
                color: "#253745"
                radius: 20
                Column {
                    anchors.fill: parent
                    anchors.margins: 38
                    spacing: 24
                    Image { source: "qrc:/brand.png"; width: 72; height: 72; fillMode: Image.PreserveAspectFit }
                    Text { text: root.title; font.pixelSize: 34; font.bold: true; color: "#fff" }
                    Text { text: "by LemvoriLab"; font.pixelSize: 15; color: "#CCD0CF" }
                    Text { text: "Робочий простір\nреабілітаційного центру";
                           color: "#DEE2E2"; font.pixelSize: 20; lineHeight: 1.3; wrapMode: Text.WordWrap }
                    Item { height: 24; width: 1 }
                    Text { text: "Нативна Linux-програма\nЗахищене підключення до сервера центру";
                           color: "#CCD0CF"; font.pixelSize: 12; wrapMode: Text.WordWrap; lineHeight: 1.4 }
                }
            }
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 20
                color: "#fff"
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 36; spacing: 12
                    Text { text: "Вхід до " + root.title; font.pixelSize: 24; font.bold: true; color: root.ink }
                    Text { text: "Адміністратор · Реєстратура · Керівник"; color: root.muted; font.pixelSize: 12 }
                    Item { Layout.preferredHeight: 8 }
                    Text { text: "Сервер центру"; font.pixelSize: 12; color: root.muted }
                    TextField { id: serverField; Layout.fillWidth: true; text: api.serverUrl
                                selectByMouse: true; placeholderText: "https://server.center:8443" }
                    RowLayout {
                        Layout.fillWidth: true
                        SolviaButton { text: "Перевірити сервер"; onClicked: api.configureServer(serverField.text) }
                        SolviaButton { text: "Файл центру"; onClicked: centerFile.open() }
                        Text { text: api.connected ? "● HTTPS перевірено" : "● Не підтверджено";
                               color: api.connected ? "#287950" : "#a07521"; font.pixelSize: 11 }
                    }
                    Item { Layout.preferredHeight: 8 }
                    Text { text: "Логін"; font.pixelSize: 12; color: root.muted }
                    TextField { id: username; Layout.fillWidth: true; placeholderText: "Логін працівника"
                                selectByMouse: true }
                    Text { text: "Пароль"; font.pixelSize: 12; color: root.muted }
                    TextField { id: password; Layout.fillWidth: true; placeholderText: "Пароль"; selectByMouse: true
                                echoMode: TextInput.Password; onAccepted: enter.clicked() }
                    SolviaButton { id: enter; Layout.fillWidth: true; text: api.working ? "Входимо…" : "Увійти";
                                   primary: true; enabled: api.connected && !api.working
                                   onClicked: { api.login(username.text,password.text); password.clear() } }
                    Text { text: "Сертифікат центру має бути довіреним у Linux. Перевірка TLS не вимикається.";
                           Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.muted; font.pixelSize: 11 }
                    Text { text: api.error || api.notice; visible: text.length > 0;
                           color: api.error ? "#a13f36" : "#287950"; wrapMode: Text.WordWrap
                           Layout.fillWidth: true; font.pixelSize: 12 }
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
                Text { text: "Робочий простір центру"; color: root.muted; font.pixelSize: 13 }
                Item { Layout.fillWidth: true }
                Text { text: api.lastRefresh ? "Оновлено о " + api.lastRefresh : "Синхронізація…";
                       font.pixelSize: 11; color: root.muted }
                Rectangle { width: 1; height: 27; color: root.line }
                Text { text: api.displayName; color: root.ink; font.bold: true; font.pixelSize: 12 }
                SolviaButton { text: "Вихід"; subtle: true; enabled: !api.databaseWorking; onClicked: { api.logout(); root.page="Головна" } }
            }
        }
        Rectangle { Layout.fillWidth:true; Layout.preferredHeight:1; color:root.line }
        Rectangle {
            Layout.fillWidth:true; Layout.preferredHeight:66; color:"#CCD0CF"
            RowLayout {
                anchors.fill: parent; anchors.leftMargin:28; anchors.rightMargin:28; spacing:15
                Rectangle { width:7; height:7; radius:4; color:api.shift.open ? "#2e865b" : "#c7a045" }
                Text { text: api.shift.open ? "Зміна відкрита" : "Зміна не відкрита";
                       font.bold:true; color:root.ink; font.pixelSize:14 }
                Text { text: api.shift.shift_date || root.today; color:root.muted; font.pixelSize:12 }
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
                Layout.fillHeight: true; Layout.preferredWidth: 213
                color: "#ffffff"
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 12; spacing: 4
                    Item { Layout.preferredHeight: 10 }
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
                            primary: root.page === modelData
                            onClicked: root.showPage(modelData)
                        }
                    }
                    Item { Layout.fillHeight: true }
                    Text { text: "Lemvori Care · LemvoriLab"; color:root.muted; font.pixelSize:11; Layout.leftMargin:10 }
                    Item { Layout.preferredHeight:10 }
                }
            }
            Rectangle { width:1; Layout.fillHeight:true; color:root.line }
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
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                contentWidth: availableWidth
                ColumnLayout {
                    id: contentCol
                    width: Math.max(scrollArea.availableWidth,640)
                    spacing:18
                    anchors.margins: 24
                    Item { Layout.preferredHeight: 3 }
                    RowLayout {
                        Layout.fillWidth:true
                        SolviaButton { text:"← Назад"; visible:root.page!=="Головна"; onClicked:root.showPage("Головна") }
                        SectionHeading { text:root.page; Layout.fillWidth:true }
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
                        Text { text:"Найважливіше на цю зміну"; font.pixelSize:13; color:root.muted }
                        RowLayout {
                            Layout.fillWidth:true; spacing:12
                            MetricTile { Layout.fillWidth:true; figure:String(api.role === "director" ? (api.overview.total_patients ?? "—") : (api.overview.counts ? api.overview.counts.waiting : "—")); heading:api.role === "director" ? "Пацієнти центру" : "Очікують прийому" }
                            MetricTile { Layout.fillWidth:true; figure:String(api.role === "director" ? (api.overview.consultations ?? "—") : (api.overview.counts ? api.overview.counts.arrived : "—")); heading:api.role === "director" ? "Консультації за місяць" : "Прибули" }
                            MetricTile { Layout.fillWidth:true; figure:String(api.role === "director" ? (api.overview.active_courses ?? "—") : (api.overview.counts ? api.overview.counts.completed : "—")); heading:api.role === "director" ? "Активні курси" : "Завершені прийоми" }
                            MetricTile { Layout.fillWidth:true; figure:String((api.overview.active_patients !== undefined ? api.overview.active_patients : "—")); heading:"Активні пацієнти" }
                        }
                        RowLayout {
                            spacing:12; Layout.fillWidth:true
                            SolviaButton { text:"+ Новий запис"; visible: api.role !== "director"; primary:true; onClicked:root.showPage("Пацієнти") }
                            SolviaButton { text:"Прийоми сьогодні"; visible: api.role !== "director"; onClicked:root.showPage("Прийоми") }
                            SolviaButton { text:"Психологи на зміні"; onClicked:root.showPage("Психологи") }
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
                                Text { visible:!(api.overview.next||[]).length; text:"Найближчих прийомів немає."; color:root.muted; font.pixelSize:13 }
                            ]
                        }
                    }

                    // Reception and administrator: patient arrival against real API.
                    ColumnLayout {
                        visible: root.page === "Прийоми"
                        Layout.fillWidth:true; spacing:12
                        Text { text:"Пацієнти та консультації поточної зміни"; color:root.muted; font.pixelSize:12 }
                        Repeater {
                            model: api.visits
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
                        Text { visible:api.visits.length===0; text:"Записів за сьогодні немає."; color:root.muted }
                    }

                    // Native patient directory, limited to the requested search results.
                    ColumnLayout {
                        visible: root.page==="Пацієнти"; Layout.fillWidth:true; spacing:12
                        TextField {
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
                        Text { visible:api.patients.length===0; text:"Пацієнтів не знайдено."; color:root.muted }
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
                        RowLayout {
                            Layout.fillWidth: true
                            Text { text:"Дата"; color:root.ink; font.bold:true }
                            TextField { id: calendarField; text: root.calendarDay; inputMask:"9999-99-99"; onEditingFinished: root.changeCalendar(text) }
                            SolviaButton { text:"Сьогодні"; onClicked: { calendarField.text = root.today; root.changeCalendar(root.today) } }
                            SolviaButton { text:"Показати"; primary:true; onClicked: root.changeCalendar(calendarField.text) }
                            Item { Layout.fillWidth: true }
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
    FileDialog {
        id: centerFile
        title: "Виберіть файл підключення центру"
        nameFilters: ["Профіль центру (*.solvia *.json)"]
        onAccepted: api.importProfile(selectedFile)
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
                TextField { id: reviewReason; visible: dischargeReview.record.workflow_status === "review"; Layout.fillWidth: true; placeholderText: "Причина повернення на доопрацювання" }
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
            TextField { id: cancelReason; Layout.fillWidth: true; placeholderText: "Причина скасування" }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; visible: !!api.error; text: api.error; color: "#8C3632" }
            RowLayout {
                SolviaButton { text:"Назад"; enabled:!api.working; onClicked:cancelDialog.close() }
                SolviaButton { text:"Підтвердити скасування"; primary:true; enabled:!api.working && !!cancelReason.text.trim(); onClicked:api.cancelBooking(cancelDialog.appointmentId,cancelReason.text) }
            }
        }
    }
    Dialog {
        id:bookingDialog; title:root.bookingOriginal.id ? "Перенести прийом" : "Записати пацієнта"; modal:true; anchors.centerIn:Overlay.overlay
        width:Math.min(540,root.width-60); standardButtons:Dialog.NoButton
        ColumnLayout {
            width:parent.width; spacing:10
            Text { id:bookingName; font.bold:true; color:root.ink; font.pixelSize:15 }
            Text { text:"Психолог"; color:root.muted; font.pixelSize:12 }
            ComboBox { id:bookingPsych; Layout.fillWidth:true
                model:bookingDate.text===root.today ? api.bookingPsychologists : api.psychologists
                textRole:"name"; valueRole:"id"; enabled: root.bookingAssignedPsychId === 0 && !api.working
                onModelChanged: Qt.callLater(() => {
                    if (root.bookingAssignedPsychId) currentIndex = indexOfValue(root.bookingAssignedPsychId)
                })
                onCurrentValueChanged: root.updateBookingSlots() }
            Text { visible:root.bookingAssignedPsychId>0 && bookingDate.text===root.today && !api.psychologistBookable(root.bookingAssignedPsychId,bookingDate.text)
                   Layout.fillWidth:true; wrapMode:Text.WordWrap; color:"#a05b23"; font.pixelSize:12
                   text:"Закріплений за пацієнтом психолог не на зміні. Попросіть адміністратора переглянути призначення." }
            Text { text:"Кабінет"; color:root.muted; font.pixelSize:12 }
            ComboBox { id:bookingRoom; Layout.fillWidth:true; model:api.rooms; textRole:"name"; valueRole:"id"; onCurrentValueChanged: root.updateBookingSlots() }
            Text { text:"Тип прийому"; visible:!root.bookingOriginal.id; color:root.muted; font.pixelSize:12 }
            ComboBox { id:bookingKind; Layout.fillWidth:true; model:["Індивідуальна","Дитяча","Кризова"]; currentIndex:0; visible:!root.bookingOriginal.id }
            RowLayout {
                Layout.fillWidth: true
                ColumnLayout {
                    Layout.fillWidth: true
                    Text { text: "Дата (РРРР-ММ-ДД)"; color: root.muted; font.pixelSize: 12 }
                    TextField { id: bookingDate; Layout.fillWidth: true; text: root.today; inputMask: "9999-99-99"; onTextChanged: root.updateBookingSlots() }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    Text { text: "Тривалість"; color: root.muted; font.pixelSize: 12 }
                    SpinBox {
                        id: bookingDuration; Layout.fillWidth: true
                        from: 15; to: 240; value: 60; stepSize: 5; editable: true
                        onValueChanged: root.updateBookingSlots()
                    }
                }
            }
            Text {
                Layout.fillWidth: true; wrapMode: Text.WordWrap
                text: api.slotError || (api.loadingSlots ? "Шукаємо вільний час…" : api.availableSlots.length ? "Виберіть вільний час" : "На цю дату вільного часу немає.")
                color: api.slotError ? "#8C3632" : root.muted
            }
            ScrollView {
                Layout.fillWidth: true; Layout.preferredHeight: 134
                contentWidth: availableWidth
                Flow {
                    width: parent.width; spacing: 8
                    Repeater {
                        model: api.availableSlots
                        delegate: SolviaButton {
                            required property string modelData
                            text: modelData
                            primary: root.selectedSlot === modelData
                            enabled: !api.working
                            onClicked: root.selectedSlot = modelData
                        }
                    }
                }
            }
            Text {
                visible: !!root.selectedSlot || !!api.error
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: api.error ? "#8C3632" : root.ink
                text: api.error || root.selectedSlot + "–" + api.endTime(root.selectedSlot, bookingDuration.value)
            }
            RowLayout {
                Layout.fillWidth:true
                SolviaButton { text:"Скасувати"; onClicked:bookingDialog.close() }
                Item { Layout.fillWidth:true }
                SolviaButton {
                    primary:true; text:api.working ? "Записуємо…" : "Підтвердити запис"
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
            TextField { id:patientName; Layout.fillWidth:true; placeholderText:"Прізвище, ім'я та по батькові" }
            TextField { id:patientPhone; Layout.fillWidth:true; placeholderText:"Номер телефону" }
            Text { text:"Дата народження (РРРР-ММ-ДД)"; color:root.muted; font.pixelSize:12 }
            TextField { id:patientDob; Layout.fillWidth:true; inputMask:"9999-99-99"; selectByMouse:true }
            Text { text:"Категорія"; color:root.muted; font.pixelSize:12 }
            ComboBox { id:patientCategory; Layout.fillWidth:true; model:["Військовий/військова","Ветеран/ветеранка","Партнер/партнерка","Дитина","Інше"] }
            Text { text:"Психолог"; color:root.muted; font.pixelSize:12 }
            ComboBox { id:patientPsy; Layout.fillWidth:true; model:api.psychologists; textRole:"name"; valueRole:"id" }
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
