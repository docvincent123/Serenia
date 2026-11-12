import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

Dialog {
    id: root
    required property var bridge
    property string selectedForm: "patient_request"
    readonly property var forms: [
        {id:"patient_request", title:"Заява на отримання послуг", description:"Звернення пацієнта, дата і підписи"},
        {id:"informed_consent", title:"Інформована згода", description:"Тільки актуальний затверджений текст центру"},
        {id:"data_processing", title:"Обробка персональних даних", description:"Затверджений текст і власноручний підпис"},
        {id:"center_rules", title:"Ознайомлення з правилами", description:"Редакція правил, дата і підпис"},
        {id:"family_consent", title:"Сімейна консультація", description:"Затверджений текст сімейної згоди"},
        {id:"referral", title:"Направлення до спеціаліста", description:"Причина, напрямок, підпис відповідального"},
        {id:"visit_sheet", title:"Лист відвідування", description:"Облік дат, часу та підписів"},
        {id:"consultation_attendance", title:"Підтвердження консультації", description:"Час прийому, учасники, підписи"},
        {id:"refusal", title:"Заява про відмову", description:"Вільний текст причини та підпис"},
        {id:"handover", title:"Акт передачі зміни", description:"Передано / прийнято, примітки та підписи"}
    ]
    title: "Бланки й підписи"
    modal: true
    anchors.centerIn: Overlay.overlay
    width: Math.min(770, Overlay.overlay.width-35)
    height: Math.min(720, Overlay.overlay.height-35)
    padding: 0
    onOpened: bridge.loadCenterConfiguration()
    background: Rectangle { radius: 22; color: "#F5F7F7"; border.color: "#CCD0CF" }
    header: Rectangle {
        color: "transparent"; implicitHeight: 90
        ColumnLayout {
            anchors.fill: parent; anchors.leftMargin: 24; anchors.rightMargin: 24; spacing: 4
            Label { text: "БІБЛІОТЕКА ДОКУМЕНТІВ"; color: "#64747E"; font.pixelSize: 11; font.bold: true }
            Label { text: "Підготовка PDF-бланків"; color: "#11212D"; font.pixelSize: 24; font.bold: true }
            Label { text: bridge.centerConfiguration.center_name || "Центр"; color: "#4A5C6A"; font.pixelSize: 12 }
        }
    }
    contentItem: ScrollView {
        id: formsScroll
        clip: true; contentWidth: availableWidth
        leftPadding: 24; rightPadding: 24
        ColumnLayout {
            width: formsScroll.availableWidth; spacing: 12
            Label {
                Layout.fillWidth: true
                text: "Оберіть бланк. PDF матиме назву та реквізити центру, місця для ПІБ, дати й власноручних підписів."
                wrapMode: Text.WordWrap; color: "#4A5C6A"
            }
            Repeater {
                model: root.forms
                delegate: Rectangle {
                    required property var modelData
                    Layout.fillWidth: true; implicitHeight: 70; radius: 14
                    color: root.selectedForm === modelData.id ? "#E7EEF0" : "#FFFFFF"
                    border.color: root.selectedForm === modelData.id ? "#253745" : "#D3DCDE"
                    RowLayout {
                        anchors.fill: parent; anchors.margins: 13; spacing: 12
                        RadioButton {
                            checked: root.selectedForm === modelData.id
                            onClicked: root.selectedForm = modelData.id
                        }
                        ColumnLayout {
                            Layout.fillWidth:true; spacing: 4
                            Label { text:modelData.title; color:"#11212D"; font.pixelSize:14; font.bold:true }
                            Label { text:modelData.description; color:"#4A5C6A"; font.pixelSize:12; wrapMode:Text.WordWrap; Layout.fillWidth:true }
                        }
                    }
                    MouseArea {
                        anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked:root.selectedForm = modelData.id
                    }
                }
            }
            Label {
                Layout.fillWidth:true; color:"#725A37"; wrapMode: Text.WordWrap
                text:"Для обов’язкових згод використовується лише текст, затверджений адміністратором. Загальні бланки не замінюють індивідуальні згоди з номером реєстрації та сканами."
                font.pixelSize: 12
            }
            Label {
                Layout.fillWidth:true; visible:!!bridge.error || !!bridge.notice
                text:bridge.error || bridge.notice; color:bridge.error?"#923C35":"#256540"; wrapMode:Text.WordWrap
            }
        }
    }
    footer: Rectangle {
        implicitHeight: 77; color: "transparent"
        RowLayout {
            anchors.fill: parent; anchors.leftMargin: 24; anchors.rightMargin:24; spacing:12
            Button { text:"Закрити"; enabled:!bridge.working; onClicked:root.close() }
            Item { Layout.fillWidth:true }
            Button {
                text:"Створити PDF для друку"
                highlighted: true; enabled:!bridge.working
                onClicked:saveFile.open()
            }
        }
    }
    FileDialog {
        id: saveFile
        title:"Зберегти бланк центру"
        fileMode:FileDialog.SaveFile
        defaultSuffix:"pdf"
        nameFilters:["PDF (*.pdf)"]
        onAccepted:root.bridge.exportBlankForm(selectedFile,root.selectedForm)
    }
}
