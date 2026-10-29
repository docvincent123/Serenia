import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    id: root
    visible: true
    width: 1400
    height: 890
    minimumWidth: 920
    minimumHeight: 640
    title: "SOLVIA · Центр реабілітації"
    color: "#f5f5f2"
    property string page: "Головна"
    property int bookingPatientId: 0
    readonly property color ink: "#23282b"
    readonly property color muted: "#758080"
    readonly property color gold: "#b78b19"
    readonly property color line: "#e5e6e1"
    readonly property string today: Qt.formatDate(new Date(), "yyyy-MM-dd")

    function showPage(next) {
        page = next
        if (next === "Пацієнти") api.searchPatients(patientSearch.text)
        if (next === "Психологи" || next === "Прийоми" || next === "Календар") api.refresh()
    }
    function beginBooking(patient) {
        bookingPatientId = Number(patient.id)
        bookingName.text = patient.name || "Пацієнт"
        bookingPsych.currentIndex = bookingPsych.indexOfValue(Number(patient.psychologist_id))
        bookingDialog.open()
    }
    Connections {
        target: api
        function onOperationCompleted(name) {
            if (name === "booking") bookingDialog.close()
            if (name === "patient") newPatientDialog.close()
        }
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
            radius: 11
            color: !btn.enabled ? "#e6e6e3" : btn.down ? (btn.primary ? "#765917" : "#e8e5dc")
                         : btn.primary ? root.ink : btn.hovered ? "#fff8e8" : btn.subtle ? "transparent" : "#ffffff"
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
        color: "#f5f5f2"
        RowLayout {
            anchors.centerIn: parent
            width: Math.min(910, parent.width - 60)
            height: 490
            spacing: 0
            Rectangle {
                Layout.fillHeight: true
                Layout.preferredWidth: 350
                color: "#252b2b"
                radius: 20
                Column {
                    anchors.fill: parent
                    anchors.margins: 38
                    spacing: 24
                    Image { source: "qrc:/brand.svg"; width: 72; height: 72; fillMode: Image.PreserveAspectFit }
                    Text { text: "SOLVIA"; font.pixelSize: 38; font.bold: true; color: "#fff" }
                    Text { text: "Робочий простір\nреабілітаційного центру";
                           color: "#e9e9e0"; font.pixelSize: 20; lineHeight: 1.3; wrapMode: Text.WordWrap }
                    Item { height: 24; width: 1 }
                    Text { text: "Нативна Linux-програма\nЗахищене підключення до сервера центру";
                           color: "#c2c7c2"; font.pixelSize: 12; wrapMode: Text.WordWrap; lineHeight: 1.4 }
                }
            }
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 20
                color: "#fff"
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 36; spacing: 12
                    Text { text: "Вхід до SOLVIA"; font.pixelSize: 26; font.bold: true; color: root.ink }
                    Text { text: "Адміністратор · Реєстратура · Керівник"; color: root.muted; font.pixelSize: 12 }
                    Item { Layout.preferredHeight: 8 }
                    Text { text: "Сервер центру"; font.pixelSize: 12; color: root.muted }
                    TextField { id: serverField; Layout.fillWidth: true; text: api.serverUrl
                                selectByMouse: true; placeholderText: "https://server.center:8443" }
                    RowLayout {
                        Layout.fillWidth: true
                        SolviaButton { text: "Перевірити сервер"; onClicked: api.configureServer(serverField.text) }
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
                Image { source: "qrc:/brand.svg"; Layout.preferredWidth: 38; Layout.preferredHeight: 38; fillMode: Image.PreserveAspectFit }
                Text { text: "SOLVIA"; font.pixelSize: 22; font.bold: true; color: root.ink }
                Rectangle { width: 1; height: 25; color: root.line }
                Text { text: "Робочий простір центру"; color: root.muted; font.pixelSize: 13 }
                Item { Layout.fillWidth: true }
                SolviaButton { text: "Оновити ↻"; onClicked: api.refresh() }
                Text { text: api.lastRefresh ? "Оновлено о " + api.lastRefresh : "Синхронізація…";
                       font.pixelSize: 11; color: root.muted }
                Rectangle { width: 1; height: 27; color: root.line }
                Text { text: api.displayName; color: root.ink; font.bold: true; font.pixelSize: 12 }
                SolviaButton { text: "Вихід"; subtle: true; onClicked: { api.logout(); root.page="Головна" } }
            }
        }
        Rectangle { Layout.fillWidth:true; Layout.preferredHeight:1; color:root.line }
        Rectangle {
            Layout.fillWidth:true; Layout.preferredHeight:66; color:"#fffdf7"
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
                          ? ["Головна","Психологи","Календар"]
                          : api.role === "reception"
                          ? ["Головна","Прийоми","Пацієнти","Психологи","Календар"]
                          : ["Головна","Прийоми","Пацієнти","Психологи","Календар","Сервер"]
                        delegate: SolviaButton {
                            required property string modelData
                            Layout.fillWidth: true
                            text: modelData
                            primary: root.page === modelData
                            onClicked: root.showPage(modelData)
                        }
                    }
                    Item { Layout.fillHeight: true }
                    Text { text: "SOLVIA · Linux Native"; color:root.muted; font.pixelSize:11; Layout.leftMargin:10 }
                    Item { Layout.preferredHeight:10 }
                }
            }
            Rectangle { width:1; Layout.fillHeight:true; color:root.line }
            ScrollView {
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
                            MetricTile { Layout.fillWidth:true; figure:String(api.overview.counts?.waiting ?? "—"); heading:"Очікують прийому" }
                            MetricTile { Layout.fillWidth:true; figure:String(api.overview.counts?.arrived ?? "—"); heading:"Прибули" }
                            MetricTile { Layout.fillWidth:true; figure:String(api.overview.counts?.completed ?? "—"); heading:"Завершені прийоми" }
                            MetricTile { Layout.fillWidth:true; figure:String(api.overview.active_patients ?? "—"); heading:"Активні пацієнти" }
                        }
                        RowLayout {
                            spacing:12; Layout.fillWidth:true
                            SolviaButton { text:"Прийоми сьогодні"; primary:true; onClicked:root.showPage("Прийоми") }
                            SolviaButton { text:"Психологи на зміні"; onClicked:root.showPage("Психологи") }
                            SolviaButton { text:"Пацієнти"; visible:api.role!=="director"; onClicked:root.showPage("Пацієнти") }
                        }
                        Panel {
                            Layout.fillWidth:true
                            panelContent: [
                                Text { text:"Найближчі прийоми"; font.pixelSize:18; font.bold:true; color:root.ink },
                                Repeater {
                                    model: api.overview.next || []
                                    delegate: Rectangle {
                                        required property var modelData
                                        Layout.fillWidth:true; implicitHeight:54; radius:8; color:"#f8f8f5"
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
                                        Text { text:String(modelData.start||"").slice(11,16); color:root.gold; font.bold:true; font.pixelSize:17 }
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
                                            onClicked: {
                                                root.bookingPatientId=Number(modelData.patient_id);
                                                bookingName.text=modelData.patient||"Пацієнт";
                                                bookingPsych.currentIndex=bookingPsych.indexOfValue(Number(modelData.psychologist_id));
                                                bookingDialog.open();
                                            }}
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
                        Text { text:"Прийоми за сьогодні · "+root.today; color:root.muted; font.pixelSize:12 }
                        Repeater {
                            model:api.appointments
                            delegate: Panel {
                                required property var modelData
                                Layout.fillWidth:true
                                panelContent: [
                                    RowLayout {
                                        Layout.fillWidth:true
                                        Text { text:String(modelData.start||"").slice(11,16)+" — "+String(modelData.end||"").slice(11,16);
                                               font.bold:true; color:root.gold }
                                        ColumnLayout {
                                            Layout.fillWidth:true
                                            Text { text:modelData.psychologist||""; color:root.ink; font.bold:true }
                                            Text { text:(modelData.room||"") + " · " + (modelData.kind||""); color:root.muted; font.pixelSize:12 }
                                        }
                                        StatusChip { caption:modelData.status==="confirmed"?"Підтверджено":modelData.status==="scheduled"?"Заплановано":modelData.status||"—" }
                                    }
                                ]
                            }
                        }
                        Text { visible:api.appointments.length===0; text:"Сьогодні прийомів немає."; color:root.muted }
                    }
                    ColumnLayout {
                        visible:root.page==="Сервер"&&api.role==="admin"; Layout.fillWidth:true; spacing:12
                        Text { text:"Захищений центр підключення · без команд Linux та доступу до shell";
                               font.pixelSize:12; color:root.muted }
                        Panel {
                            Layout.fillWidth:true
                            panelContent: [
                                Text { text:"Сервер SOLVIA"; font.pixelSize:18; color:root.ink; font.bold:true },
                                Text { text:api.serverUrl; color:root.muted; font.pixelSize:13 },
                                Text { text:"Стан HTTPS: "+(api.connected?"підключено":"немає з'єднання"); color:root.ink },
                                SolviaButton { text:"Перевірити API"; onClicked:api.configureServer(api.serverUrl) }
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
        id:bookingDialog; title:"Записати пацієнта"; modal:true; anchors.centerIn:Overlay.overlay
        width:Math.min(540,root.width-60); standardButtons:Dialog.NoButton
        ColumnLayout {
            width:parent.width; spacing:10
            Text { id:bookingName; font.bold:true; color:root.ink; font.pixelSize:15 }
            Text { text:"Психолог"; color:root.muted; font.pixelSize:12 }
            ComboBox { id:bookingPsych; Layout.fillWidth:true; model:api.psychologists; textRole:"name"; valueRole:"id" }
            Text { text:"Кабінет"; color:root.muted; font.pixelSize:12 }
            ComboBox { id:bookingRoom; Layout.fillWidth:true; model:api.rooms; textRole:"name"; valueRole:"id" }
            Text { text:"Тип прийому"; color:root.muted; font.pixelSize:12 }
            ComboBox { id:bookingKind; Layout.fillWidth:true; model:["Індивідуальна","Дитяча","Кризова"]; currentIndex:0 }
            Text { text:"Дата (РРРР-ММ-ДД)"; color:root.muted; font.pixelSize:12 }
            TextField { id:bookingDate; Layout.fillWidth:true; text:root.today; inputMask:"9999-99-99"; selectByMouse:true }
            RowLayout {
                Layout.fillWidth:true
                ColumnLayout { Layout.fillWidth:true
                    Text { text:"Початок (ГГ:ХХ)"; color:root.muted; font.pixelSize:12 }
                    TextField { id:bookingStart; Layout.fillWidth:true; text:"09:00"; inputMask:"99:99" }
                }
                ColumnLayout { Layout.fillWidth:true
                    Text { text:"Кінець (ГГ:ХХ)"; color:root.muted; font.pixelSize:12 }
                    TextField { id:bookingEnd; Layout.fillWidth:true; text:"10:00"; inputMask:"99:99" }
                }
            }
            RowLayout {
                Layout.fillWidth:true
                SolviaButton { text:"Скасувати"; onClicked:bookingDialog.close() }
                Item { Layout.fillWidth:true }
                SolviaButton { primary:true; text:"Записати"; onClicked: api.book(root.bookingPatientId,Number(bookingPsych.currentValue),
                    Number(bookingRoom.currentValue),bookingDate.text,bookingStart.text,bookingEnd.text,
                    ["individual","child","crisis"][bookingKind.currentIndex]) }
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
            RowLayout {
                Layout.fillWidth:true
                SolviaButton { text:"Скасувати"; onClicked:newPatientDialog.close() }
                Item { Layout.fillWidth:true }
                SolviaButton { text:"Зберегти пацієнта"; primary:true
                    onClicked:api.registerPatient(patientName.text,patientPhone.text,patientDob.text,
                                                   String(patientCategory.currentText),Number(patientPsy.currentValue)) }
            }
        }
    }
}
