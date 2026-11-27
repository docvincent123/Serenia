import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

Dialog {
    id: root
    objectName: "patient-requests-dialog"
    required property var bridge
    readonly property bool canCreate: bridge.role === "admin" || bridge.role === "reception"
    title: "Заяви пацієнта"
    anchors.centerIn: Overlay.overlay
    width: Math.min(720, Overlay.overlay.width - 40)
    height: Math.min(630, Overlay.overlay.height - 40)
    modal: true
    standardButtons: Dialog.Close
    onOpened: bridge.loadIntakeRequests()
    Connections {
        target: root.bridge
        function onStateChanged() { if (!root.bridge.authenticated) root.close() }
    }
    contentItem: ScrollView {
        id: scroll
        contentWidth: availableWidth
        clip: true
        ColumnLayout {
            width: scroll.availableWidth
            spacing: 14
            Label {
                Layout.fillWidth: true
                textFormat: Text.PlainText
                font.pixelSize: 17
                font.bold: true
                text: (root.bridge.patientRecord.name || "") + " · картка № " + (root.bridge.patientRecord.patient_no || "—")
                wrapMode: Text.WordWrap
            }
            RowLayout {
                Layout.fillWidth: true
                visible: root.canCreate
                CareComboBox {
                    id: service
                    Layout.fillWidth: true
                    Layout.minimumWidth: 140
                    model: root.bridge.intakeServices
                    textRole: "name"
                    valueRole: "code"
                    displayText: currentIndex >= 0 ? currentText : "Оберіть напрямок"
                }
                Button {
                    text: "Створити заяву"
                    enabled: !!service.currentValue && !root.bridge.working
                    onClicked: root.bridge.createIntakeRequest(service.currentValue)
                }
            }
            Label {
                visible: !!root.bridge.error
                text: root.bridge.error
                color: "#8C3632"
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }
            Label {
                visible: !root.bridge.intakeRequests.length
                text: "До цієї картки ще не додано заяв."
                color: "#405C83"
            }
            Repeater {
                model: root.bridge.intakeRequests
                delegate: Frame {
                    required property var modelData
                    Layout.fillWidth: true
                    RowLayout {
                        width: parent.width
                        ColumnLayout {
                            Layout.fillWidth: true
                            Label {
                                Layout.fillWidth: true
                                textFormat: Text.PlainText
                                text: modelData.number + " · " + modelData.service
                                font.bold: true
                                wrapMode: Text.WordWrap
                            }
                            Label { text: String(modelData.created).slice(0, 10); color: "#405C83" }
                        }
                        Button {
                            text: "PDF"
                            onClicked: {
                                pdf.documentId = modelData.id
                                pdf.currentFile = String(pdf.currentFolder) + "/" + modelData.number + ".pdf"
                                pdf.open()
                            }
                        }
                        Button { text: "Роздрукувати"; onClicked: root.bridge.outputIntakeRequest(modelData.id) }
                    }
                }
            }
        }
    }
    FileDialog {
        id: pdf
        property int documentId: 0
        title: "Зберегти заяву Lemvori Care"
        fileMode: FileDialog.SaveFile
        defaultSuffix: "pdf"
        nameFilters: ["PDF (*.pdf)"]
        onAccepted: root.bridge.outputIntakeRequest(documentId, selectedFile)
    }
}
