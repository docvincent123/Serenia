import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

Item {
    id: root
    required property var bridge
    property string section: "team"
    property string searchText: ""
    readonly property var filteredRows: {
        const rows = bridge.adminRows || []
        const needle = searchText.trim().toLowerCase()
        if (!needle) return rows
        const fields = ["name", "login", "role", "code", "type", "category", "device_name", "platform", "event", "entity", "actor", "ip_address"]
        return rows.filter(function(record) {
            return fields.some(function(key) {
                return String(record[key] ?? "").toLowerCase().includes(needle)
            })
        })
    }
    readonly property color ink: "#11212D"
    readonly property color muted: "#4A5C6A"
    readonly property string today: Qt.formatDate(new Date(), "yyyy-MM-dd")
    readonly property var sections: [
        {label:"ЦЕНТР"},
        {key:"team", label:"Працівники", detail:"Облікові записи, ролі та доступ працівників центру"},
        {key:"rooms", label:"Кабінети", detail:"Типи, номери та місткість кабінетів"},
        {key:"services", label:"Напрямки", detail:"Перелік послуг і категорій центру"},
        {label:"ОРГАНІЗАЦІЯ"},
        {key:"access", label:"Доступ реєстратури", detail:"Коли реєстратура може працювати з прийомами"},
        {key:"workflow", label:"Правила запису", detail:"Робочі дні, крок розкладу та тривалість прийомів"},
        {key:"center", label:"Дані центру", detail:"Контакти, реквізити та файли підключення"},
        {label:"СИСТЕМА"},
        {key:"sessions", label:"Сеанси", detail:"Пристрої працівників і час останньої активності"},
        {key:"audit", label:"Журнал дій", detail:"Історія дій працівників у системі"},
        {key:"database", label:"База та копії", detail:"Резервне копіювання та відновлення PostgreSQL"}
    ]
    readonly property var serviceOptions: {
        const items = [{key: "", label: "Без прив’язки до напрямку"}]
        const services = bridge.serviceChoices || []
        for (let i = 0; i < services.length; i++) {
            const item = services[i]
            items.push({key: item.code, label: item.name + (item.active ? "" : " (неактивний)")})
        }
        return items
    }
    readonly property var roles: [
        {key:"reception", label:"Реєстратура"}, {key:"psychologist", label:"Психолог"},
        {key:"director", label:"Керівник"}, {key:"admin", label:"Адміністратор"}
    ]
    readonly property var roomTypes: [
        {key:"individual", label:"Індивідуальний"}, {key:"group", label:"Груповий"},
        {key:"family", label:"Сімейний"}
    ]
    readonly property var categories: [
        {key:"psychology", label:"Психологія"}, {key:"medical", label:"Медичні консультації"},
        {key:"rehabilitation", label:"Реабілітація"}, {key:"creative", label:"Терапевтичні заняття"},
        {key:"other", label:"Інший напрямок"}
    ]
    readonly property bool listEditable: ["team","rooms","services"].includes(section)
    readonly property bool detailsEditable: ["access","workflow","center"].includes(section)
    readonly property var currentSection: sections.find(item => item.key === section)
    readonly property var schema: ({
        team:[
            {key:"name", label:"ПІБ"}, {key:"login", label:"Логін", createOnly:true},
            {key:"role", label:"Роль доступу", options:roles, initial:"reception"},
            {key:"primary_service_code", label:"Професійний напрямок", options:root.serviceOptions, initial:""},
            {key:"phone", label:"Телефон"},
            {key:"password", label:"Пароль", type:"password"},
            {key:"active", label:"Обліковий запис активний", type:"check", initial:true, editOnly:true}
        ],
        rooms:[
            {key:"name", label:"Назва кабінету"}, {key:"code", label:"Номер"},
            {key:"type", label:"Тип", options:roomTypes, initial:"individual"},
            {key:"capacity", label:"Місткість", type:"number", from:1, to:100, initial:1},
            {key:"description", label:"Опис"},
            {key:"active", label:"Кабінет доступний", type:"check", initial:true, editOnly:true}
        ],
        services:[
            {key:"name", label:"Назва напрямку"},
            {key:"category", label:"Категорія", options:categories, initial:"psychology"},
            {key:"active", label:"Напрямок активний", type:"check", initial:true, editOnly:true}
        ],
        access:[
            {key:"access_date", label:"Дата (РРРР-ММ-ДД)", initial:today},
            {key:"start_time", label:"Доступ з (ГГ:ХХ)", initial:"08:00"},
            {key:"enabled", label:"Дозволити роботу реєстратури", type:"check", initial:true}
        ],
        workflow:[
            {key:"opening_time", label:"Початок роботи"}, {key:"closing_time", label:"Кінець роботи"},
            {key:"working_days", label:"Робочі дні (1–7, понеділок–неділя)"},
            {key:"slot_step_minutes", label:"Крок розкладу", options:[
                {key:15,label:"15 хв"}, {key:30,label:"30 хв"}, {key:60,label:"60 хв"}]},
            {key:"default_duration_minutes", label:"Тривалість за замовчуванням, хв", type:"number", from:15, to:240},
            {key:"session_hours", label:"Тривалість сеансу, год", type:"number", from:1, to:24}
        ],
        center:[
            {key:"center_name", label:"Назва центру"}, {key:"short_name", label:"Коротка назва"},
            {key:"city", label:"Місто"}, {key:"address", label:"Адреса"},
            {key:"phone", label:"Телефон"}, {key:"email", label:"Електронна пошта"},
            {key:"website", label:"Сайт"}, {key:"work_hours", label:"Години роботи"},
            {key:"director_name", label:"Керівник"}, {key:"head_name", label:"Завідувач"},
            {key:"head_title", label:"Посада завідувача"}, {key:"document_footer", label:"Підвал документів"},
            {key:"connection_mode", label:"Підключення", options:[{key:"local",label:"Мережа центру"},{key:"vps",label:"VPS"}], initial:"local"},
            {key:"local_api_url", label:"HTTPS-адреса в мережі центру"}, {key:"vps_api_url", label:"HTTPS-адреса VPS"}
        ]
    })

    function select(key) {
        searchText = ""
        section = key
        if (key !== "database") bridge.loadAdminSection(key)
    }

    function edit(record) {
        form.recordId = Number(record.id || 0)
        form.values = Object.assign({}, record)
        if (section === "access") {
            form.values.start_time = (record.starts_at || "").slice(11,16) || "08:00"
            form.values.enabled = record.enabled === undefined ? true : record.enabled
        }
        form.open()
    }

    function readable(options, key) {
        const item = options.find(value => value.key === key)
        return item ? item.label : String(key || "")
    }

    component Action: Button {
        id: action
        property bool primary: false
        property bool onRail: false
        implicitHeight: onRail ? 35 : 42
        leftPadding: 16; rightPadding: 16
        contentItem: Label {
            text: action.text; horizontalAlignment: action.onRail ? Text.AlignLeft : Text.AlignHCenter; verticalAlignment: Text.AlignVCenter
            color: action.onRail ? root.ink : action.primary ? "#F1F3F3" : root.ink
            font.bold: action.primary; elide: Text.ElideRight
        }
        background: Rectangle {
            radius: action.onRail ? 9 : height/2
            color: action.onRail ? (action.primary ? "#CCD0CF" : action.hovered ? "#EDF0F0" : "transparent")
                 : action.primary ? (action.hovered ? "#11212D" : "#253745") : (action.hovered ? "#B9C2C4" : "#DEE2E2")
            border.color: action.visualFocus ? root.ink : action.onRail ? "transparent" : "#9BA8AB"
            opacity: action.enabled ? 1 : .55
        }
    }

    RowLayout {
        anchors.fill: parent; anchors.margins: 18; spacing: 14
        Rectangle {
            Layout.fillHeight: true; Layout.preferredWidth: 178
            color: "#F8FAFA"; border.color: "#CCD0CF"; radius: 13
            ScrollView {
                id: adminRail
                anchors.fill: parent; anchors.margins: 8; clip: true
                contentWidth: availableWidth
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                ColumnLayout {
                    width: adminRail.availableWidth; spacing: 3
                    Repeater {
                        model: root.sections
                        delegate: ColumnLayout {
                            required property var modelData
                            Layout.fillWidth: true
                            Label {
                                visible: !modelData.key; text: modelData.label; color: root.muted
                                font.pixelSize: 10; font.letterSpacing: 1
                                Layout.topMargin: 9; Layout.bottomMargin: 3; Layout.leftMargin: 12
                            }
                            Action {
                                visible: !!modelData.key; text: modelData.label
                                Layout.fillWidth: true
                                onRail: true; primary: root.section === modelData.key
                                enabled: !root.bridge.working
                                onClicked: root.select(modelData.key)
                            }
                        }
                    }
                }
            }
        }
        ScrollView {
            id: adminContent
            Layout.fillWidth: true; Layout.fillHeight: true; clip: true
            contentWidth: availableWidth
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            ColumnLayout {
                width: adminContent.availableWidth; spacing: 14
                RowLayout {
                    Layout.fillWidth: true
                    ColumnLayout {
                        Layout.fillWidth: true; spacing: 4
                        Label { text: root.currentSection.label; color: root.ink; font.pixelSize: 26; font.bold: true; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                        Label { text: root.currentSection.detail; color: root.muted; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                    }
                    Action { text: "+ Додати"; primary: true; visible: root.listEditable; enabled: !root.bridge.working && (root.section !== "team" || root.bridge.serviceChoices.length > 0); onClicked: root.edit({}) }
                    Action { text: "Редагувати"; primary: true; visible: root.detailsEditable; enabled: !root.bridge.working && Object.keys(root.bridge.adminDetails).length > 0; onClicked: root.edit(root.bridge.adminDetails) }
                }
                Label {
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; visible: !!root.bridge.error || !!root.bridge.notice
                    text: root.bridge.error || root.bridge.notice
                    color: root.bridge.error ? "#8C3632" : root.muted
                }
                Label {
                    Layout.fillWidth: true; visible: root.detailsEditable && !Object.keys(root.bridge.adminDetails).length
                    text: "Очікуємо дані сервера…"; color: root.muted
                }
                Repeater {
                    model: root.detailsEditable && Object.keys(root.bridge.adminDetails).length ? root.schema[root.section] : []
                    delegate: RowLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        Label { text: modelData.label; color: root.muted; Layout.preferredWidth: 224; wrapMode: Text.WordWrap }
                        Label {
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.ink
                            text: {
                                const value = root.bridge.adminDetails[modelData.key]
                                if (modelData.key === "start_time") return (root.bridge.adminDetails.starts_at || "").slice(11,16) || "—"
                                if (modelData.type === "check") return value ? "Так" : "Ні"
                                return modelData.options ? root.readable(modelData.options, value) : String(value ?? "—")
                            }
                        }
                    }
                }
                ColumnLayout {
                    visible: root.listEditable || root.section === "sessions" || root.section === "audit"
                    Layout.fillWidth: true; spacing: 8
                    RowLayout {
                        Layout.fillWidth: true; spacing: 10
                        TextField {
                            id: adminSearch
                            Layout.fillWidth: true; Layout.preferredHeight: 42
                            text: root.searchText
                            Accessible.name: "Пошук у поточному розділі"
                            placeholderText: root.section === "team" ? "Пошук за ПІБ, логіном або роллю" :
                                             root.section === "sessions" ? "Пошук пристрою або користувача" :
                                             "Пошук у списку"
                            selectByMouse: true
                            onTextEdited: root.searchText = text
                            color: root.ink
                            background: Rectangle {
                                radius: 12; color: "#FFFFFF"
                                border.color: adminSearch.activeFocus ? "#253745" : "#CCD0CF"
                                border.width: adminSearch.activeFocus ? 2 : 1
                            }
                        }
                        Action { text: "Очистити"; enabled: root.searchText.length > 0; onClicked: root.searchText = "" }
                    }
                    Label {
                        text: "Показано " + root.filteredRows.length + " із " + root.bridge.adminRows.length
                        color: root.muted; font.pixelSize: 12
                    }
                }
                Label {
                    visible: (root.listEditable || root.section === "sessions" || root.section === "audit") &&
                             root.filteredRows.length === 0 && !root.bridge.working
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.muted
                    text: root.searchText ? "За цим запитом нічого не знайдено." : "У цьому розділі поки немає записів."
                }
                Label {
                    visible: root.section === "team" && root.bridge.serviceChoices.length === 0
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.muted
                    text: "Завантажуємо перелік напрямків для працівників…"
                }
                Label {
                    visible: root.section === "services"
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.muted
                    text: "Напрямки — це послуги центру. Права доступу працівника задаються окремою роллю; спеціалізація не надає доступ до чужих медичних записів."
                }
                Repeater {
                    model: root.listEditable || root.section === "sessions" || root.section === "audit" ? root.filteredRows : []
                    delegate: Rectangle {
                        required property var modelData
                        Layout.fillWidth: true; implicitHeight: row.implicitHeight + 22
                        color: "#FFFFFF"; radius: 13; border.color: "#CCD0CF"
                        RowLayout {
                            id: row
                            anchors.fill: parent; anchors.margins: 11
                            ColumnLayout {
                                Layout.fillWidth: true; spacing: 5
                                Label {
                                    Layout.fillWidth: true; elide: Text.ElideRight; color: root.ink; font.bold: true
                                    text: root.section === "audit" ? String(modelData.event || "") + " · " + String(modelData.entity || "") : String(modelData.name || modelData.device_name || "—")
                                }
                                Label {
                                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.muted
                                    text: {
                                        if (root.section === "team") return [modelData.login, root.readable(root.roles,modelData.role), modelData.primary_service_name, modelData.active ? "Активний" : "Вимкнений"].filter(Boolean).join(" · ")
                                        if (root.section === "rooms") return [modelData.code, root.readable(root.roomTypes,modelData.type), modelData.capacity + " місць", modelData.active ? "Доступний" : "Вимкнений"].filter(Boolean).join(" · ")
                                        if (root.section === "services") return root.readable(root.categories,modelData.category) + (modelData.active ? "" : " · Вимкнено")
                                        if (root.section === "sessions") return [modelData.login || modelData.user_name || modelData.user, modelData.device_name || modelData.platform, modelData.last_seen, modelData.online ? "Онлайн" : "Офлайн"].filter(Boolean).join(" · ")
                                        return [modelData.actor, modelData.created].filter(Boolean).join(" · ")
                                    }
                                }
                            }
                            Action { text: "Редагувати"; visible: root.listEditable; enabled: !root.bridge.working && (root.section !== "team" || root.bridge.serviceChoices.length > 0); onClicked: root.edit(modelData) }
                            Action {
                                text: "Сеанси (" + Number(modelData.active_sessions || 0) + ")"
                                visible: root.section === "team" && Number(modelData.active_sessions || 0) > 0
                                enabled: !root.bridge.working
                                onClicked: {
                                    endUserSessions.targetId = Number(modelData.id)
                                    endUserSessions.targetName = String(modelData.name || modelData.login || "працівник")
                                    endUserSessions.open()
                                }
                            }
                            Action { text: "Завершити сеанс"; visible: root.section === "sessions"; enabled: !root.bridge.working; onClicked: { endSession.sessionId = modelData.session_id; endSession.open() } }
                        }
                    }
                }
                RowLayout {
                    visible: root.section === "center"
                    Action { text:"Файл для Android / ПК"; onClicked:{ exportPicker.localOnly = false; exportPicker.open() } }
                    Action { text:"Файл для Wi-Fi центру"; visible:root.bridge.adminDetails.connection_mode === "local"; onClicked:{ exportPicker.localOnly = true; exportPicker.open() } }
                }
                Label {
                    visible: root.section === "database"
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.muted
                    text: root.bridge.localDatabaseTools()
                        ? "Операції виконуються на цьому Linux-сервері після підтвердження прав адміністратора системи."
                        : "Відкрийте Lemvori Care Admin на серверному ПК і підключіться до локальної HTTPS-адреси для роботи з файлами бази."
                }
                RowLayout {
                    visible: root.section === "database"
                    Action { text: "Створити копію БД"; primary: true; enabled: root.bridge.localDatabaseTools() && !root.bridge.working; onClicked: root.bridge.databaseBackup() }
                    Action { text: "Відновити з файлу"; enabled: root.bridge.localDatabaseTools() && !root.bridge.working; onClicked: picker.open() }
                }
                Item { Layout.fillHeight: true; implicitHeight: 16 }
            }
        }
    }

    Connections {
        target: root.bridge
        function onStateChanged() { if (!root.bridge.authenticated) form.close() }
        function onOperationCompleted(operation) { if (operation === "admin") form.close() }
    }

    Dialog {
        id: form
        property int recordId: 0
        property var values: ({})
        title: root.currentSection.label
        modal: true; anchors.centerIn: Overlay.overlay
        width: Math.min(530, root.width - 30)
        height: Math.min(600, root.height - 32)
        closePolicy: root.bridge.working ? Popup.NoAutoClose : Popup.CloseOnEscape
        contentItem: ScrollView {
            contentWidth: availableWidth
            ColumnLayout {
                width: parent.width; spacing: 9
                Repeater {
                    id: editorFields
                    model: form.visible ? (root.schema[root.section] || []).filter(field =>
                        (!field.createOnly || !form.recordId) && (!field.editOnly || !!form.recordId)) : []
                    delegate: ColumnLayout {
                        required property var modelData
                        readonly property var original: form.values[modelData.key] ?? modelData.initial ?? ""
                        readonly property var fieldValue: editor.item ? editor.item.fieldValue : original
                        Layout.fillWidth: true
                        Label { text: modelData.label; color: root.ink }
                        Loader {
                            id: editor
                            Layout.fillWidth: true
                            sourceComponent: modelData.options ? comboEditor : modelData.type === "check" ? checkEditor : modelData.type === "number" ? numericEditor : textEditor
                            Component {
                                id: comboEditor
                                ComboBox {
                                    readonly property var fieldValue: currentValue
                                    model: modelData.options; textRole: "label"; valueRole: "key"
                                    Component.onCompleted: {
                                        const index = indexOfValue(original)
                                        currentIndex = index >= 0 ? index : 0
                                    }
                                }
                            }
                            Component { id: checkEditor; CheckBox { readonly property bool fieldValue: checked; checked: Boolean(original); text: "Увімкнено" } }
                            Component { id: numericEditor; SpinBox { readonly property int fieldValue: value; from: modelData.from; to: modelData.to; value: Number(original); editable: true } }
                            Component { id: textEditor; TextField { readonly property string fieldValue: text; text: String(original); echoMode: modelData.type === "password" ? TextInput.Password : TextInput.Normal; selectByMouse: true } }
                        }
                    }
                }
                Label { Layout.fillWidth: true; visible: !!root.bridge.error; text: root.bridge.error; color: "#8C3632"; wrapMode: Text.WordWrap }
            }
        }
        footer: DialogButtonBox {
            Action { text: "Скасувати"; enabled: !root.bridge.working; DialogButtonBox.buttonRole: DialogButtonBox.RejectRole; onClicked: form.close() }
            Action {
                text: "Зберегти"; primary: true; enabled: !root.bridge.working
                DialogButtonBox.buttonRole: DialogButtonBox.ActionRole
                onClicked: {
                    const body = {}
                    for (let i=0; i<editorFields.count; i++) {
                        const field = editorFields.itemAt(i)
                        body[field.modelData.key] = field.fieldValue
                    }
                    root.bridge.saveAdminEntry(root.section, form.recordId, body)
                }
            }
        }
    }
    Dialog {
        id: endSession
        property string sessionId
        title: "Завершити сеанс пристрою?"
        modal: true; anchors.centerIn: Overlay.overlay
        standardButtons: Dialog.Yes | Dialog.No
        onAccepted: root.bridge.endSession(sessionId)
    }
    Dialog {
        id: endUserSessions
        property int targetId: 0
        property string targetName: ""
        title: "Завершити всі сеанси працівника?"
        modal: true; anchors.centerIn: Overlay.overlay
        width: Math.min(450, root.width - 32)
        standardButtons: Dialog.Yes | Dialog.No
        contentItem: Label {
            text: "Користувач: " + endUserSessions.targetName + "\nУсі його пристрої будуть розлогінені. Інших працівників це не зачепить."
            wrapMode: Text.WordWrap; color: root.ink; padding: 14
        }
        onAccepted: root.bridge.endUserSessions(targetId)
    }
    FileDialog {
        id: exportPicker
        property bool localOnly: false
        title: "Зберегти файл підключення центру"
        fileMode: FileDialog.SaveFile
        defaultSuffix: "solvia"
        nameFilters: ["Файл центру (*.solvia)"]
        onAccepted: root.bridge.exportProfile(selectedFile, localOnly)
    }
    FileDialog {
        id: picker
        title: "Вибрати резервну копію PostgreSQL"
        nameFilters: ["Резервна копія (*.dump)"]
        onAccepted: { restoreConfirmation.clear(); restore.open() }
    }
    Dialog {
        id: restore
        title: "Відновлення бази PostgreSQL"
        modal: true; anchors.centerIn: Overlay.overlay; width: 460
        ColumnLayout {
            width: parent.width
            Label { Layout.fillWidth: true; wrapMode: Text.WordWrap; text: "Після перевірки файла сервер створить захисну копію й відновить вибрану базу. Для підтвердження введіть ВІДНОВИТИ." }
            TextField { id: restoreConfirmation; Layout.fillWidth: true; placeholderText: "ВІДНОВИТИ" }
            Action { text: "Відновити"; enabled: restoreConfirmation.text.trim() === "ВІДНОВИТИ"; onClicked: { root.bridge.databaseRestore(picker.selectedFile, restoreConfirmation.text); restore.close() } }
        }
    }
}
