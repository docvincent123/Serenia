import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

Item {
    id: root
    required property var bridge
    property string section: "team"
    readonly property color ink: "#11212D"
    readonly property color muted: "#4A5C6A"
    readonly property string today: Qt.formatDate(new Date(), "yyyy-MM-dd")
    readonly property var sections: [
        {key:"team", label:"Працівники"}, {key:"rooms", label:"Кабінети"},
        {key:"services", label:"Напрямки"}, {key:"access", label:"Доступ реєстратури"},
        {key:"workflow", label:"Правила запису"}, {key:"center", label:"Дані центру"},
        {key:"sessions", label:"Сеанси"}, {key:"audit", label:"Журнал дій"},
        {key:"database", label:"База та копії"}
    ]
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
    readonly property string heading: sections.find(item => item.key === section).label
    readonly property var schema: ({
        team:[
            {key:"name", label:"ПІБ"}, {key:"login", label:"Логін", createOnly:true},
            {key:"role", label:"Роль", options:roles, initial:"reception"},
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
            {key:"head_title", label:"Посада завідувача"}, {key:"document_footer", label:"Підвал документів"}
        ]
    })

    function select(key) {
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
        implicitHeight: 42
        leftPadding: 16; rightPadding: 16
        contentItem: Label {
            text: action.text; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter
            color: action.primary ? "#F1F3F3" : root.ink; font.bold: action.primary
        }
        background: Rectangle {
            radius: height/2
            color: action.primary ? (action.hovered ? "#11212D" : "#253745") : (action.hovered ? "#B9C2C4" : "#DEE2E2")
            border.color: action.visualFocus ? root.ink : "#9BA8AB"
            opacity: action.enabled ? 1 : .55
        }
    }

    RowLayout {
        anchors.fill: parent; spacing: 18
        Rectangle {
            Layout.fillHeight: true; Layout.preferredWidth: 208
            color: "#4A5C6A"
            ScrollView {
                anchors.fill: parent; anchors.margins: 10
                contentWidth: availableWidth
                ColumnLayout {
                    width: parent.width; spacing: 7
                    Repeater {
                        model: root.sections
                        delegate: Action {
                            required property var modelData
                            Layout.fillWidth: true
                            text: modelData.label
                            primary: root.section === modelData.key
                            enabled: !root.bridge.working
                            onClicked: root.select(modelData.key)
                        }
                    }
                }
            }
        }
        ScrollView {
            Layout.fillWidth: true; Layout.fillHeight: true
            contentWidth: availableWidth
            ColumnLayout {
                width: parent.width; spacing: 14
                RowLayout {
                    Layout.fillWidth: true
                    Label { text: root.heading; color: root.ink; font.pixelSize: 26; font.bold: true; Layout.fillWidth: true }
                    Action { text: "+ Додати"; primary: true; visible: root.listEditable; enabled: !root.bridge.working; onClicked: root.edit({}) }
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
                Repeater {
                    model: root.listEditable || root.section === "sessions" || root.section === "audit" ? root.bridge.adminRows : []
                    delegate: Rectangle {
                        required property var modelData
                        Layout.fillWidth: true; implicitHeight: row.implicitHeight + 22
                        color: "#CCD0CF"; radius: 16; border.color: "#9BA8AB"
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
                                        if (root.section === "team") return [modelData.login, root.readable(root.roles,modelData.role), modelData.active ? "Активний" : "Вимкнений"].join(" · ")
                                        if (root.section === "rooms") return [modelData.code, root.readable(root.roomTypes,modelData.type), modelData.capacity + " місць", modelData.active ? "Доступний" : "Вимкнений"].filter(Boolean).join(" · ")
                                        if (root.section === "services") return root.readable(root.categories,modelData.category) + (modelData.active ? "" : " · Вимкнено")
                                        if (root.section === "sessions") return [modelData.device_name || modelData.platform, modelData.last_seen, modelData.online ? "Онлайн" : "Офлайн"].filter(Boolean).join(" · ")
                                        return [modelData.actor, modelData.created].filter(Boolean).join(" · ")
                                    }
                                }
                            }
                            Action { text: "Редагувати"; visible: root.listEditable; enabled: !root.bridge.working; onClicked: root.edit(modelData) }
                            Action { text: "Завершити сеанс"; visible: root.section === "sessions"; enabled: !root.bridge.working; onClicked: { endSession.sessionId = modelData.session_id; endSession.open() } }
                        }
                    }
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
        title: root.heading
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
