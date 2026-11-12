import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

Dialog {
    id:root
    required property var bridge
    property bool viewing:false
    property url scanFile:""
    property bool hasSignature:false
    title:viewing?"Документи пацієнта":"Новий документ"
    modal:true; anchors.centerIn:Overlay.overlay
    width:Math.min(760,Overlay.overlay.width-40); height:Math.min(740,Overlay.overlay.height-40)
    closePolicy:bridge.working?Popup.NoAutoClose:Popup.CloseOnEscape
    background:Rectangle{radius:22;color:"#F3F7FD";border.color:"#CFDDF0"}
    header:Rectangle{
        color:"transparent";implicitHeight:76
        ColumnLayout{anchors.fill:parent;anchors.leftMargin:22;anchors.rightMargin:22;spacing:3
            Label{text:bridge.centerConfiguration.center_name || "LEMVORI CARE";font.pixelSize:12;color:"#405C83"}
            Label{text:root.title;font.pixelSize:22;font.bold:true;color:"#0C1C34"}
        }
    }
    function create() { viewing=false;scanFile="";hasSignature=false;pad.reset=true;docTitle.text="";content.text="";signer.text="";paperSigned.checked=false;status.currentIndex=0;source.currentIndex=0;templateChoice.currentIndex=0;open();pad.requestPaint() }
    function showDocuments() { viewing=true;bridge.openDetail("documents",bridge.patientRecord.id);open() }
    Connections { target:root.bridge; function onOperationCompleted(operation){if(operation==="workspace")root.close()} function onStateChanged(){if(!root.bridge.authenticated)root.close()} function onDataChanged(){if(!root.bridge.workspaceAllowed("patient"))root.close()} }
    component Action: Button {
        id:control
        implicitHeight:40; leftPadding:16; rightPadding:16
        contentItem:Text { text:control.text; color:"#0C1C34"; font.bold:true; opacity:control.enabled?1:0.45; horizontalAlignment:Text.AlignHCenter; verticalAlignment:Text.AlignVCenter }
        background:Rectangle { radius:20; color:control.hovered?"#CFDDF0":"white"; border.color:"#CFDDF0" }
    }
    contentItem:ScrollView {
        id:scroll; contentWidth:availableWidth; clip:true; leftPadding:22;rightPadding:22;topPadding:8;bottomPadding:12
        ColumnLayout {
            width:scroll.availableWidth; spacing:10
            ColumnLayout {
                visible:!root.viewing; Layout.fillWidth:true; spacing:9
                Label { textFormat:Text.PlainText; text:"Шаблон центру" }
                CareComboBox {
                    id:templateChoice
                    Layout.fillWidth:true
                    model:[{id:0,title:"Власний текст"}].concat(root.bridge.documentTemplates)
                    textRole:"title"
                    onActivated:function(index){if(index>0){const entry=root.bridge.documentTemplates[index-1];docTitle.text=entry.title;content.text=entry.content}}
                }
                Label { textFormat:Text.PlainText; text:"Тип документа" }
                CareComboBox { background:Rectangle {radius:10;color:"white";border.color:"#CFDDF0"}  id:type; Layout.fillWidth:true; model:["Інформована згода","Обробка персональних даних","Правила центру","Сімейна згода","Відмова від послуг","Інший документ"] }
                Label { textFormat:Text.PlainText; text:"Назва *" }
                CareTextField { background:Rectangle {radius:10;color:"white";border.color:"#CFDDF0"}  id:docTitle; Layout.fillWidth:true; placeholderText:"Назва документа"; selectByMouse:true; maximumLength:200 }
                Label { textFormat:Text.PlainText; text:"Текст документа" }
                CareTextArea { id:content; Layout.fillWidth:true; implicitHeight:160; wrapMode:TextEdit.Wrap; selectByMouse:true; placeholderText:"Повний текст, з яким ознайомлюється підписант";leftPadding:14;topPadding:12;background:Rectangle{radius:12;color:"white";border.color:content.activeFocus?"#1764EF":"#CFDDF0"} }
                RowLayout {
                    Layout.fillWidth:true
                    CareComboBox { background:Rectangle {radius:10;color:"white";border.color:"#CFDDF0"}  id:source; Layout.fillWidth:true; model:["Підпис на екрані","Скан паперового документа"] }
                    CareComboBox { background:Rectangle {radius:10;color:"white";border.color:"#CFDDF0"}  id:status; Layout.fillWidth:true; model:["Підписано","Відмова від підпису"] }
                }
                Label { textFormat:Text.PlainText; text:"ПІБ підписанта" }
                CareTextField { background:Rectangle {radius:10;color:"white";border.color:"#CFDDF0"}  id:signer; Layout.fillWidth:true; selectByMouse:true; maximumLength:200 }
                ColumnLayout {
                    visible:source.currentIndex===1; Layout.fillWidth:true
                    Action { text:root.scanFile?"Змінити зображення":"Вибрати PNG / JPEG"; onClicked:picker.open() }
                    Image { source:root.scanFile; Layout.fillWidth:true; Layout.preferredHeight:220; fillMode:Image.PreserveAspectFit; sourceSize.width:1200; cache:false; visible:!!root.scanFile }
                    CheckBox { id:paperSigned; text:"Я перевірив підпис на паперовому оригіналі"; visible:status.currentIndex===0 }
                }
                ColumnLayout {
                    visible:source.currentIndex===0&&status.currentIndex===0; Layout.fillWidth:true
                    Label { textFormat:Text.PlainText; text:"Підпис пацієнта / законного представника" }
                    Rectangle {
                        Layout.fillWidth:true; Layout.preferredHeight:150; color:"white"; radius:10; border.color:"#6D85A4"
                        Canvas {
                            id:pad; anchors.fill:parent; anchors.margins:2
                            property real lastX:0
                            property real lastY:0
                            property bool reset:true
                            onPaint:{const ctx=getContext("2d");if(reset){ctx.fillStyle="white";ctx.fillRect(0,0,width,height);reset=false}}
                            MouseArea {
                                anchors.fill:parent
                                onPressed:function(mouse){pad.lastX=mouse.x;pad.lastY=mouse.y}
                                onPositionChanged:function(mouse){if(!pressed)return;const ctx=pad.getContext("2d");ctx.strokeStyle="#0C1C34";ctx.lineWidth=2;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(pad.lastX,pad.lastY);ctx.lineTo(mouse.x,mouse.y);ctx.stroke();pad.lastX=mouse.x;pad.lastY=mouse.y;root.hasSignature=true;pad.requestPaint()}
                            }
                        }
                    }
                    Action { text:"Очистити підпис"; onClicked:{root.hasSignature=false;pad.reset=true;pad.requestPaint()} }
                }
                Label { textFormat:Text.PlainText; text:"Документ фіксує підпис і дані на момент збереження. Після збереження він залишається в історії картки."; Layout.fillWidth:true; wrapMode:Text.WordWrap; color:"#405C83" }
            }
            Repeater {
                model:root.viewing?(root.bridge.detailRecord.documents || []):[]
                delegate:ColumnLayout {
                    required property var modelData
                    Layout.fillWidth:true; spacing:8
                    Label { textFormat:Text.PlainText; text:modelData.title; font.bold:true; font.pixelSize:18; Layout.fillWidth:true; wrapMode:Text.WordWrap }
                    Label { textFormat:Text.PlainText; text:(modelData.status==="signed"?"Підписано":"Відмова")+" · "+(modelData.signed_by_name || "")+" · "+(modelData.signed_at || ""); Layout.fillWidth:true; wrapMode:Text.WordWrap; color:"#405C83" }
                    Label { textFormat:Text.PlainText; text:modelData.content || ""; Layout.fillWidth:true; wrapMode:Text.WordWrap }
                    Image { source:modelData.scan_data || modelData.signature_data || ""; visible:!!source; Layout.fillWidth:true; Layout.preferredHeight:modelData.scan_data?460:150; fillMode:Image.PreserveAspectFit; sourceSize.width:1400 }
                    Rectangle { Layout.fillWidth:true; Layout.preferredHeight:1; color:"#CFDDF0" }
                }
            }
            Label { textFormat:Text.PlainText; visible:root.viewing&&!(root.bridge.detailRecord.documents || []).length; text:"Документів немає або вони завантажуються…"; color:"#405C83" }
            Label { textFormat:Text.PlainText; visible:!!root.bridge.error; text:root.bridge.error; color:"#8C3632"; wrapMode:Text.WordWrap; Layout.fillWidth:true }
        }
    }
    footer:DialogButtonBox {
        Action { objectName:"document-close"; text:"Закрити"; enabled:!root.bridge.working; onClicked:root.close() }
        Action {
            text:root.bridge.working?"Зберігаємо…":"Зберегти документ"
            visible:!root.viewing
            enabled:!root.bridge.working&&!!docTitle.text.trim()&&(status.currentIndex===1 || !!signer.text.trim()&&(source.currentIndex===1?paperSigned.checked&&!!root.scanFile:root.hasSignature))&&(source.currentIndex===0||!!root.scanFile)
            onClicked:root.bridge.saveDocument({document_type:["informed_consent","data_processing","center_rules","family_consent","service_refusal","other"][type.currentIndex],title:docTitle.text.trim(),content:content.text,status:status.currentIndex===0?"signed":"refused",source:source.currentIndex===0?"digital":"paper_scan",signed_by_name:signer.text.trim(),signature_data:source.currentIndex===0&&status.currentIndex===0?pad.toDataURL("image/png"):"",paper_signed:source.currentIndex===1&&status.currentIndex===0&&paperSigned.checked},root.scanFile)
        }
    }
    FileDialog { id:picker; title:"Зображення паперового документа"; nameFilters:["Зображення (*.png *.jpg *.jpeg)"]; onAccepted:root.scanFile=selectedFile }
}
