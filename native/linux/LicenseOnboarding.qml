import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

// First administrator sign-in after installation: signed license is server verified.
// This is deliberately NOT a local activation toggle or an editable fake state.
Item {
    id: root
    required property var bridge
    anchors.fill: parent
    z: 100
    readonly property string status: String(bridge.licenseStatus.status || "")
    readonly property bool publisherMissing: status === "publisher_key_required"
    onVisibleChanged: if (visible) bridge.clearLicenseFeedback()
    readonly property color ink: "#0C1C34"
    readonly property color muted: "#405C83"

    Rectangle {
        anchors.fill: parent
        color: "#E9EDEF"
        opacity: .98
    }
    MouseArea { anchors.fill: parent; acceptedButtons: Qt.AllButtons }
    ScrollView {
        anchors.fill: parent
        anchors.margins: 22
        contentWidth: availableWidth
        clip: true
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ColumnLayout {
            width: Math.min(690, parent.width)
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 16
            Item { Layout.preferredHeight: 12 }
            RowLayout {
                Layout.fillWidth: true
                spacing: 12
                Rectangle {
                    width: 52; height: 52; radius: 18; color: "#1764EF"
                    Label { anchors.centerIn: parent; text: "L"; font.pixelSize: 26; font.bold: true; color: "white" }
                }
                ColumnLayout {
                    Layout.fillWidth: true; spacing: 2
                    Label { text: "LEMVORI CARE"; font.pixelSize: 13; font.bold: true; color: root.ink }
                    Label { text: "Налаштування першого запуску"; color: root.muted; font.pixelSize: 13 }
                }
                Label {
                    text: "КРОК 1 ІЗ 2"
                    font.bold: true; color: root.muted; font.pixelSize: 11
                }
            }
            Rectangle {
                Layout.fillWidth: true
                radius: 24
                implicitHeight: wizardContent.implicitHeight + 48
                color: "white"
                border.color: "#CFDDF0"
                ColumnLayout {
                    id: wizardContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top
                    anchors.margins: 24; spacing: 14
                    Label {
                        Layout.fillWidth: true; wrapMode: Text.WordWrap
                        text: "Активація центру"
                        font.pixelSize: 29; font.bold: true; color: root.ink
                    }
                    Label {
                        Layout.fillWidth: true; wrapMode: Text.WordWrap; color: root.muted
                        text: "Один раз прив’яжіть підписану ліцензію Lemvori Control до цього сервера. Після підтвердження вона зберігається в PostgreSQL, тому під час наступних входів майстер не з’являтиметься."
                    }
                    Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: "#E1E6E7" }
                    Label { text: "Сервер центру"; font.bold: true; color: root.ink }
                    CareTextArea {
                        Layout.fillWidth: true; readOnly: true; selectByMouse: true
                        text: root.bridge.licenseStatus.server_id || "Очікуємо ідентифікатор"
                        font.family: "monospace"; font.pixelSize: 13; color: root.ink
                        wrapMode: TextEdit.WrapAnywhere; implicitHeight: 56
                        background: Rectangle { radius: 12; color: "#F3F5F5"; border.color: "#D4E0F1" }
                    }
                    PublisherKeySetup { bridge:root.bridge;visible:root.publisherMissing;Layout.fillWidth:true }
                    Label {
                        Layout.fillWidth: true; wrapMode: Text.WordWrap
                        color: root.publisherMissing ? "#925B24" : root.muted
                        text: root.publisherMissing
                            ? "Сервер ще не має відкритого ключа видавця. Встановіть публічний Ed25519 PEM із Lemvori Control через sudo lemvori-carectl publisher-key /шлях/до/public.pem — приватний ключ не копіюйте на сервер."
                            : "Видайте ліцензію в Lemvori Control на цей 64-символьний ID. Приймається підписаний JSON-файл (.lemvori-license або .json)."
                    }
                    RowLayout {
                        Layout.fillWidth: true; spacing: 10
                        Button {
                            text: "Експортувати запит центру"
                            enabled: !root.bridge.working
                            onClicked: requestFile.open()
                        }
                        Button {
                            text: "Вибрати файл ліцензії"
                            highlighted: true
                            enabled: !root.bridge.working
                            onClicked: licenseFile.open()
                        }
                    }
                    Label { text: "АБО ВСТАВТЕ ПІДПИСАНИЙ JSON"; color: root.muted; font.pixelSize: 11; font.bold: true }
                    CareTextArea {
                        id: licenseText
                        Layout.fillWidth: true; implicitHeight: 112
                        selectByMouse: true; wrapMode: TextEdit.WrapAnywhere
                        placeholderText: "Вставте повний вміст .lemvori-license: format, payload і signature"
                        color: root.ink; font.family: "monospace"; font.pixelSize: 12
                        background: Rectangle { radius: 13; color: "#F8FBFF"; border.color: licenseText.activeFocus ? "#1764EF" : "#CFDDF0" }
                    }
                    Button {
                        Layout.fillWidth: true
                        text: root.bridge.working ? "Перевіряємо цифровий підпис…" : "Активувати підписану ліцензію"
                        enabled: !root.bridge.working && licenseText.text.trim().length > 20
                        onClicked: root.bridge.activateLicenseText(licenseText.text)
                    }
                    Label {
                        Layout.fillWidth: true
                        visible: !!root.bridge.licenseError || !!root.bridge.licenseNotice
                        color: root.bridge.licenseError ? "#943B35" : "#256540"
                        wrapMode: Text.WordWrap
                        text: root.bridge.licenseError || root.bridge.licenseNotice
                    }
                    Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: "#E1E6E7" }
                    RowLayout {
                        Layout.fillWidth: true
                        Label {
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                            color: root.muted; font.pixelSize: 12
                            text: "Не маєте ліцензії? Скопіюйте ID та передайте його адміністратору Lemvori Control."
                        }
                        Button { text: "Вийти"; enabled: !root.bridge.working; onClicked: root.bridge.logout() }
                    }
                }
            }
            Label {
                Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter
                text: "Підписи перевіряються на сервері. Помилковий ключ не активує систему."
                color: root.muted; font.pixelSize: 11; wrapMode: Text.WordWrap
            }
        }
    }
    FileDialog {
        id: licenseFile
        title: "Підписана ліцензія Lemvori Control"
        nameFilters: ["Ліцензія (*.lemvori-license *.json)"]
        onAccepted: root.bridge.importLicense(selectedFile)
    }
    FileDialog {
        id: requestFile
        title: "Зберегти запит на ліцензію"
        fileMode: FileDialog.SaveFile
        defaultSuffix: "json"
        nameFilters: ["JSON (*.json)"]
        onAccepted: root.bridge.exportCenterRequest(selectedFile)
    }
    Connections {
        target: root.bridge
        function onOperationCompleted(name) {
            if (name === "license") licenseText.clear()
        }
    }
}
