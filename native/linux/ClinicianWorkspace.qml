import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ColumnLayout {
    id: root
    required property var bridge
    signal openPatient(int patientId)
    spacing: 16

    RowLayout {
        Layout.fillWidth: true
        Label {
            Layout.fillWidth: true
            text: "Мої прийоми · " + Qt.formatDate(new Date(), "dd.MM.yyyy")
            color: "#183750"
            font.pixelSize: 22
            font.bold: true
        }
        Button { text: "Оновити"; onClicked: root.bridge.refresh() }
    }
    Label {
        visible: !root.bridge.visits.length
        text: "На сьогодні записів немає."
        color: "#405C83"
    }
    Repeater {
        model: root.bridge.visits
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
                        text: String(modelData.start).slice(11,16) + " · " + modelData.patient
                        font.bold: true
                        wrapMode: Text.WordWrap
                    }
                    Label { text: modelData.room || "—"; color: "#405C83" }
                }
                Button {
                    text: "Картка"
                    visible: root.bridge.workspaceAllowed("patient")
                    onClicked: root.openPatient(modelData.patient_id)
                }
                Button {
                    text: "Запис консультації"
                    visible: root.bridge.moduleEnabled("clinical") && !modelData.completed_at &&
                             !modelData.visit_status && ["scheduled","confirmed"].includes(modelData.status)
                    onClicked: {
                        visit.record = modelData
                        note.clear()
                        result.clear()
                        recommendations.clear()
                        visit.open()
                    }
                }
            }
        }
    }

    Dialog {
        id: visit
        property var record: ({})
        anchors.centerIn: Overlay.overlay
        title: "Запис консультації"
        width: Math.min(660, Overlay.overlay.width - 40)
        modal: true
        closePolicy: root.bridge.working ? Popup.NoAutoClose : Popup.CloseOnEscape
        contentItem: ColumnLayout {
            spacing: 10
            Label { textFormat: Text.PlainText; text: visit.record.patient || ""; font.bold: true }
            CareTextArea {
                id: note
                Layout.fillWidth: true
                implicitHeight: 115
                wrapMode: TextEdit.Wrap
                placeholderText: "Підсумок консультації"
            }
            CareTextArea {
                id: result
                Layout.fillWidth: true
                implicitHeight: 82
                wrapMode: TextEdit.Wrap
                placeholderText: "Результат"
            }
            CareTextArea {
                id: recommendations
                Layout.fillWidth: true
                implicitHeight: 82
                wrapMode: TextEdit.Wrap
                placeholderText: "Рекомендації"
            }
            Label {
                visible: !!root.bridge.error
                text: root.bridge.error
                color: "#8C3632"
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }
            RowLayout {
                Layout.fillWidth: true
                Button { text: "Скасувати"; enabled: !root.bridge.working; onClicked: visit.close() }
                Button {
                    text: "Завершити і зберегти"
                    enabled: !!note.text.trim() && !root.bridge.working
                    onClicked: {
                        const times = [visit.record.start, visit.record.end].map(value => {
                            const clock = String(value).slice(11,16).split(":")
                            return Number(clock[0])*60 + Number(clock[1])
                        })
                        root.bridge.saveClinicalVisit(visit.record.appointment_id, visit.record.patient_id, {
                            note: note.text, result_text: result.text, recommendations: recommendations.text,
                            duration_minutes: Math.max(10, times[1] - times[0])
                        })
                    }
                }
            }
        }
        Connections {
            target: root.bridge
            function onOperationCompleted(name) { if (name === "clinicalVisit") visit.close() }
            function onStateChanged() { if (!root.bridge.authenticated) visit.close() }
        }
    }
}
