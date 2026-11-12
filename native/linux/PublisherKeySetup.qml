import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

ColumnLayout {
    id: root
    required property var bridge
    property var selectedKey: ({})
    spacing: 10
    Label {
        text: "1. Ключ перевірки видавця"; font.bold: true; font.pixelSize: 16
        color: "#0C1C34"; Layout.fillWidth: true; wrapMode: Text.WordWrap
    }
    Label {
        text: "Оберіть відкритий Ed25519 ключ із Lemvori Control. Після системного підтвердження він буде налаштований на сервері. Приватний ключ залишається у видавця."
        Layout.fillWidth: true; wrapMode: Text.WordWrap; color: "#405C83"
    }
    Button {
        text: "Налаштувати ключ видавця"; objectName: "license-publisher-key"
        enabled: root.bridge.publisherKeyToolsAvailable && !root.bridge.working
        implicitHeight: 44; leftPadding: 18; rightPadding: 18
        onClicked: keyPicker.open()
        background: Rectangle { radius: 12; color: parent.enabled ? "#1764EF" : "#E7EFFB" }
        contentItem: Label { text: parent.text; color: parent.enabled ? "white" : "#52637D"; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
    }
    Label {
        visible: !root.bridge.publisherKeyToolsAvailable
        text: "Цей крок виконується на Linux-сервері: відкрийте там Lemvori Care Admin і підключіться до https://localhost:8443. Потрібні права системного адміністратора. Якщо ви вже на сервері, встановіть актуальний DEB-пакет: він містить компонент налаштування ключа."
        Layout.fillWidth: true; wrapMode: Text.WordWrap; color: "#73501B"
    }
    FileDialog {
        id: keyPicker; title: "Відкритий ключ видавця Lemvori Control"
        nameFilters: ["Відкритий ключ (*.pem *.pub)"]
        onAccepted: {
            root.selectedKey = root.bridge.publisherKeyInfo(selectedFile)
            if (root.selectedKey.fingerprint) confirm.open()
        }
    }
    Dialog {
        id: confirm; modal: true; anchors.centerIn: Overlay.overlay
        title: "Довіряти цьому ключу видавця?"
        width: Math.min(560, root.width); height: 310
        closePolicy: Popup.CloseOnEscape
        background: Rectangle { radius: 20; color: "#F8FBFF"; border.color: "#CFDDF0" }
        contentItem: Label {
            textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere; color: "#0C1C34"
            text: "Файл: " + (root.selectedKey.name || "") + "\n\nSHA-256:\n" +
                  (root.selectedKey.fingerprint || "") +
                  "\n\nЗвірте відбиток із ключем у Lemvori Control. Сервер буде перезапущено, після чого можна імпортувати ліцензію."
        }
        standardButtons: Dialog.Ok | Dialog.Cancel
        onAccepted: root.bridge.installPublisherKey(root.selectedKey.file, root.selectedKey.fingerprint)
    }
    Connections {
        target: root.bridge
        function onStateChanged() { if (!root.bridge.authenticated) { confirm.close(); keyPicker.close(); root.selectedKey = ({}) } }
    }
}
