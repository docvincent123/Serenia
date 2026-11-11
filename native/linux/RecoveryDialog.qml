import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Dialog {
    id:root
    required property var bridge
    readonly property var record:bridge.detailRecord
    property string validation:""
    title:"Звірка запису з Android"; modal:true; anchors.centerIn:Overlay.overlay
    width:Math.min(830,Overlay.overlay.width-40); height:Math.min(730,Overlay.overlay.height-40)
    closePolicy:bridge.working?Popup.NoAutoClose:Popup.CloseOnEscape
    function show(id){validation="";reason.text="";confirmed.checked=false;conflict.checked=false;choice.currentIndex=0;bridge.openDetail("recovery",id);open()}
    function textFor(payload){return payload?[payload.request_text,payload.state_text,payload.work_done,payload.note,payload.goals,payload.result_text,payload.recommendations,payload.homework,payload.next_plan].filter(Boolean).join("\n\n"):"Відсутній"}
    Connections { target:root.bridge; function onOperationCompleted(operation){if(operation==="workspace")root.close()} function onStateChanged(){if(!root.bridge.authenticated)root.close()} }
    component Action: Button {
        id:control
        implicitHeight:40; leftPadding:16; rightPadding:16
        contentItem:Text { text:control.text; color:"#11212D"; font.bold:true; opacity:control.enabled?1:0.45; horizontalAlignment:Text.AlignHCenter; verticalAlignment:Text.AlignVCenter }
        background:Rectangle { radius:20; color:control.hovered?"#CCD0CF":"white"; border.color:"#CCD0CF" }
    }
    contentItem:ScrollView {
        id:scroll; contentWidth:availableWidth; clip:true
        ColumnLayout {
            width:scroll.availableWidth; spacing:12
            Label { textFormat:Text.PlainText; text:[root.record.patient,root.record.psychologist,root.record.device_name].filter(Boolean).join(" · "); wrapMode:Text.WordWrap; Layout.fillWidth:true; font.bold:true }
            Label { textFormat:Text.PlainText; text:root.record.error || "Завантаження…"; wrapMode:Text.WordWrap; Layout.fillWidth:true; color:"#8C3632" }
            Label { textFormat:Text.PlainText; text:"Оригінал з телефона"; font.bold:true }
            Label { textFormat:Text.PlainText; text:root.textFor(root.record.payload); wrapMode:Text.WordWrap; Layout.fillWidth:true }
            Label { textFormat:Text.PlainText; text:"Чернетка на сервері"; font.bold:true }
            Label { textFormat:Text.PlainText; text:root.textFor(root.record.server_draft); wrapMode:Text.WordWrap; Layout.fillWidth:true }
            Label { textFormat:Text.PlainText; text:"Уже проведені консультації"; font.bold:true }
            Repeater { model:root.record.existing || []; delegate:Label { textFormat:Text.PlainText; required property var modelData; text:"№ "+modelData.id+"\n"+root.textFor(modelData); wrapMode:Text.WordWrap; Layout.fillWidth:true } }
            ComboBox { background:Rectangle {radius:10;color:"white";border.color:"#CCD0CF"}  id:choice; Layout.fillWidth:true; visible:!(root.record.existing || []).length; model:["Провести оригінал з телефона","Провести серверну чернетку"]; enabled:!!root.record.server_draft }
            ComboBox { background:Rectangle {radius:10;color:"white";border.color:"#CCD0CF"}  id:existing; Layout.fillWidth:true; visible:!!(root.record.existing || []).length; model:root.record.existing || []; textRole:"id"; valueRole:"id" }
            Label { textFormat:Text.PlainText; text:"Причина рішення *" }
            TextArea { id:reason; Layout.fillWidth:true; implicitHeight:80; wrapMode:TextEdit.Wrap }
            CheckBox { id:confirmed; text:(root.record.existing || []).length?"Підтверджую відповідність уже проведеної консультації":"Підтверджую, що консультація фактично відбулася" }
            CheckBox { id:conflict; text:"Я звірив відмінності та підтверджую вибір тексту"; visible:!!root.record.server_draft }
            Label { textFormat:Text.PlainText; text:root.validation || root.bridge.error; visible:!!text; wrapMode:Text.WordWrap; Layout.fillWidth:true; color:"#8C3632" }
        }
    }
    footer:DialogButtonBox {
        Action { text:"Закрити"; enabled:!root.bridge.working; onClicked:root.close() }
        Action {
            text:(root.record.existing || []).length?"Пов’язати з консультацією":"Провести консультацію"
            enabled:!!root.record.id&&root.record.state==="open"&&!root.bridge.working&&confirmed.checked&&!!reason.text.trim()&&(!root.record.server_draft||conflict.checked)
            onClicked:{
                const link=!!(root.record.existing || []).length
                const payload=choice.currentIndex===1?root.record.server_draft:root.record.payload
                root.bridge.workspaceAction("recovery","resolve",root.record.id,{action:link?"link":"complete",reason:reason.text.trim(),confirmed:true,confirm_server_conflict:conflict.checked,consultation_id:Number(existing.currentValue || 0),payload:payload})
            }
        }
    }
}
