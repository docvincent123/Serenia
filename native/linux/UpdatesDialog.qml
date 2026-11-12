import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

Dialog {
    id: root
    required property var bridge
    title: "Оновлення програм на пристроях"
    modal: true
    anchors.centerIn: Overlay.overlay
    width: Math.min(850, Overlay.overlay.width - 32)
    height: Math.min(780, Overlay.overlay.height - 32)
    padding: 0
    closePolicy: bridge.working ? Popup.NoAutoClose : Popup.CloseOnEscape
    background: Rectangle { radius: 22; color: "#F3F7FD"; border.color: "#CFDDF0" }
    onOpened: bridge.loadUpdates()
    component Action: Button {
        id: button
        implicitHeight: 44
        leftPadding: 18; rightPadding: 18
        contentItem: Label {
            text: button.text; textFormat: Text.PlainText; color: "#0C1C34"
            horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight; font.bold: true
        }
        background: Rectangle {
            radius: 22; color: button.hovered ? "#E7EFFB" : "white"
            border.color: button.activeFocus ? "#1764EF" : "#CFDDF0"
            opacity: button.enabled ? 1 : .5
        }
    }
    component Field: CareTextField {
        implicitHeight: 46; leftPadding:14; rightPadding:14; selectByMouse:true
        background:Rectangle {radius:12;color:"white";border.color:parent.activeFocus?"#1764EF":"#CFDDF0"}
    }
    header: Label {
        text: root.title; textFormat: Text.PlainText
        padding: 22; font.pixelSize: 22; font.bold: true
        color: "#0C1C34"; wrapMode: Text.WordWrap
    }
    contentItem: ScrollView {
        id: scroll
        clip: true; contentWidth: availableWidth
        leftPadding: 22; rightPadding: 22; bottomPadding: 20
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ColumnLayout {
            width: scroll.availableWidth; spacing: 14
            Label {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: "#405C83"
                text: "Опублікуйте пакет на сервері центру. Android перевіряє оновлення під час роботи; установка потребує підтвердження на пристрої та того самого підпису APK. Пакети ПК встановлюються на робочих місцях після збереження роботи."
            }
            Label { text: "Новий пакет"; font.bold: true; font.pixelSize: 18; color: "#0C1C34" }
            GridLayout {
                Layout.fillWidth: true; columns: scroll.availableWidth > 600 ? 2 : 1
                columnSpacing: 16; rowSpacing: 10
                ColumnLayout {
                    Layout.fillWidth: true; Layout.preferredWidth:1; Layout.minimumWidth:0
                    Label { text: "Платформа" }
                    CareComboBox {
                        id: platform; Layout.fillWidth: true; implicitHeight: 46
                        model: ["Android", "Windows", "Linux"]
                        readonly property string key: ["android", "windows", "linux"][currentIndex]
                        enabled: !root.bridge.working
                        onCurrentIndexChanged: packageFile.file = ""
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true; Layout.preferredWidth:1; Layout.minimumWidth:0
                    Label { text: "Версія пакета *" }
                    Field {
                        id: version; objectName: "update-version"
                        Layout.fillWidth: true; implicitHeight: 46
                        text: "3.13.0"; placeholderText: "3.13.0"; selectByMouse: true
                        enabled: !root.bridge.working
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true; visible: platform.key === "android"
                    Label { text: "Номер Android збірки *" }
                    SpinBox {
                        id: build; Layout.fillWidth: true; implicitHeight: 46
                        from: 1; to: 2100000000; value: 182046; editable: true
                        textFromValue:function(value,locale){return String(value)}
                        valueFromText:function(text,locale){return Number(text)}
                        background:Rectangle{radius:12;color:"white";border.color:"#CFDDF0"}
                        enabled: !root.bridge.working
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true; visible: platform.key === "android"
                    Label { text: "Пробна група (ID психологів через кому)"; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                    Field {
                        id: pilot; Layout.fillWidth: true; implicitHeight: 46
                        placeholderText: "Порожньо — всі психологи"; selectByMouse: true
                        enabled: !root.bridge.working
                    }
                }
            }
            Action {
                text: "Вибрати пакет"; enabled: !root.bridge.working
                onClicked: packageFile.open()
            }
            Label {
                Layout.fillWidth: true; wrapMode: Text.WrapAnywhere; color: "#405C83"
                text: packageFile.file ? String(packageFile.file).split("/").pop() :
                      platform.key === "android" ? "Робочий підписаний APK, до 8 МБ" :
                      platform.key === "windows" ? "EXE інсталятор, до 32 МБ" : "DEB або tar.gz, до 32 МБ"
            }
            Label { text: "Що змінилося"; font.bold: true }
            CareTextArea {
                id: notes; Layout.fillWidth: true; Layout.preferredHeight: 110
                wrapMode: TextEdit.Wrap; selectByMouse: true
                placeholderText: "Короткий опис для працівників (до 3000 символів)"
                enabled: !root.bridge.working
                background: Rectangle { color: "white"; radius: 12; border.color: "#CFDDF0" }
            }
            Action {
                text: root.bridge.working ? "Завантажуємо пакет…" : "Опублікувати оновлення"
                objectName: "publish-update"
                enabled: !!packageFile.file && !!version.text.trim() && notes.length <= 3000 && !root.bridge.working
                onClicked: publish.open()
            }
            Label {
                text: root.bridge.error || root.bridge.notice; visible: !!text
                Layout.fillWidth: true; wrapMode: Text.WordWrap
                color: root.bridge.error ? "#8C3632" : "#256540"
            }
            Label { text: "Опубліковані версії"; font.bold: true; font.pixelSize: 18; color: "#0C1C34" }
            BusyIndicator { running: root.bridge.updatesLoading; visible: running; Layout.alignment: Qt.AlignHCenter }
            Label {
                text: root.bridge.updatesError; visible: !!text
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: "#8C3632"
            }
            Label { text: "Пакетів ще немає."; visible: !root.bridge.updatesLoading && !root.bridge.updateReleases.length && !root.bridge.updatesError }
            Repeater {
                model: root.bridge.updateReleases
                delegate: Frame {
                    required property var modelData
                    Layout.fillWidth: true
                    ColumnLayout {
                        width: parent.width; spacing: 7
                        Label {
                            text: modelData.platform + " · " + modelData.version +
                                  (modelData.version_code ? " · build " + modelData.version_code : "")
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; font.bold: true
                        }
                        Label {
                            text: ((modelData.size_bytes || 0) / 1048576).toFixed(1) + " МБ · " +
                                  ((modelData.rollout_user_ids || []).length ? "Пробна група: " + modelData.rollout_user_ids.join(", ") : "Усі сумісні пристрої")
                            Layout.fillWidth: true; wrapMode: Text.WordWrap
                        }
                        Label { text: modelData.release_notes || "Без опису"; textFormat: Text.PlainText; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                    }
                    background: Rectangle { radius: 14; color: "white"; border.color: "#CFDDF0" }
                }
            }
            Label { text: "Android: установлені версії й зв’язок"; font.bold: true; font.pixelSize: 18; Layout.fillWidth: true; wrapMode: Text.WordWrap }
            Label { text: "Пристроїв поки немає."; visible: !root.bridge.updatesLoading && !root.bridge.updateDevices.length }
            Repeater {
                model: root.bridge.updateDevices
                delegate: Label {
                    required property var modelData
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; textFormat: Text.PlainText
                    text: [modelData.name, modelData.device_name,
                           modelData.version_name || "Версія невідома",
                           modelData.fresh ? "На зв’язку" : "Немає свіжого зв’язку",
                           modelData.last_seen, modelData.error_code].filter(Boolean).join(" · ")
                }
            }
        }
    }
    footer: DialogButtonBox {
        Action { text: "Закрити"; enabled: !root.bridge.working; onClicked: root.close() }
    }
    Dialog {
        id: publish; modal: true; anchors.centerIn: Overlay.overlay
        height: Math.min(300, root.height - 32)
        title: "Опублікувати пакет?"; width: Math.min(470, root.width - 32)
        standardButtons: Dialog.Ok | Dialog.Cancel
        contentItem: Label {
            text: "Платформа: " + platform.currentText + "\nВерсія: " + version.text +
                  (platform.key === "android" ? " · build " + build.value : "") +
                  "\nПакет стане доступним працівникам із сервера центру. Переконайтеся, що обрали готовий інсталятор."
            wrapMode: Text.WordWrap; textFormat: Text.PlainText
        }
        onAccepted: root.bridge.publishUpdate(packageFile.file, platform.key, version.text.trim(), build.value, notes.text, platform.key === "android" ? pilot.text : "")
    }
    FileDialog {
        id: packageFile
        property url file: ""
        title: "Пакет оновлення Lemvori Care"
        nameFilters: platform.key === "android" ? ["Android APK (*.apk)"] : platform.key === "windows" ? ["Windows installer (*.exe)"] : ["Linux package (*.deb *.tar.gz)"]
        onAccepted: file = selectedFile
    }
    Connections {
        target: root.bridge
        function onStateChanged() { if (!root.bridge.authenticated) { publish.close(); packageFile.close(); root.close() } }
        function onOperationCompleted(operation) { if (operation === "update") packageFile.file = "" }
    }
}
