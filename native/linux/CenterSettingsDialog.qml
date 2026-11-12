import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts
Dialog {
    id:root
    required property var bridge
    property string mode:"license"
    property var selectedModules:[]
    property var policy:({})
    property bool dirty:false
    function resetForm(){selectedModules=bridge.centerModules.filter(m=>m.enabled).map(m=>m.id);policy=JSON.parse(JSON.stringify(bridge.consentPolicy));dirty=false}
    function show(next){mode=next;resetForm();bridge.loadCenterConfiguration();open()}
    title:mode==="license"?"Ліцензія центру":mode==="modules"?"Модулі центру":"Обов’язкові згоди"
    modal:true;anchors.centerIn:Overlay.overlay;width:Math.min(780,Overlay.overlay.width-40);height:Math.min(730,Overlay.overlay.height-40)
    closePolicy:bridge.working?Popup.NoAutoClose:Popup.CloseOnEscape
    background:Rectangle{radius:22;color:"#F3F7FD";border.color:"#CFDDF0"}
    header:Rectangle{
        color:"transparent";implicitHeight:78
        ColumnLayout{anchors.fill:parent;anchors.leftMargin:24;anchors.rightMargin:24;spacing:4
            Label{text:"LEMVORI CARE · АДМІНІСТРУВАННЯ";font.pixelSize:11;font.bold:true;color:"#405C83"}
            Label{text:root.title;font.pixelSize:22;font.bold:true;color:"#0C1C34"}
        }
    }
    component Action:Button { id:b;implicitHeight:42;leftPadding:16;rightPadding:16;contentItem:Text{textFormat:Text.PlainText;text:b.text;color:b.enabled?"#0C1C34":"#6D85A4";font.bold:true;verticalAlignment:Text.AlignVCenter;horizontalAlignment:Text.AlignHCenter} background:Rectangle{radius:21;color:b.hovered?"#CFDDF0":"white";border.color:"#CFDDF0"} }
    contentItem:ScrollView {
        id:scroll;contentWidth:availableWidth;clip:true;leftPadding:24;rightPadding:24;topPadding:8;bottomPadding:12
        ColumnLayout {
            width:scroll.availableWidth;spacing:12
            ColumnLayout {
                visible:root.mode==="license";Layout.fillWidth:true
                Label { textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WrapAnywhere;text:"ID сервера: "+(root.bridge.licenseStatus.server_id || "—");font.bold:true }
                Label { textFormat:Text.PlainText;text:"Центр: "+(root.bridge.licenseStatus.center || root.bridge.centerConfiguration.center_name || "—");Layout.fillWidth:true;wrapMode:Text.WordWrap }
                Label { textFormat:Text.PlainText;text:"Стан: "+(root.bridge.licenseStatus.status || "Завантаження…") }
                Label { textFormat:Text.PlainText;text:"Ліцензія: "+(root.bridge.licenseStatus.perpetual?"Безстрокова":root.bridge.licenseStatus.expires_at?new Date((root.bridge.licenseStatus.expires_at-1)*1000).toLocaleDateString():"Не керується видавцем") }
                Label { textFormat:Text.PlainText;text:"Працівники: "+(root.bridge.licenseStatus.max_users || "—")+" · Телефони: "+(root.bridge.licenseStatus.max_devices || "—") }
                Label { textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;text:"Файл ліцензії має бути підписаний Lemvori Control для цього сервера. Ключ видавця перевіряється сервером. Завершення ліцензії не видаляє картки й не закриває читання або експорт.";color:"#405C83" }
                Action { text:"Файл запиту для видавця";onClicked:requestPicker.open() }
                Action { text:"Відкрити файл ліцензії";enabled:!root.bridge.working;onClicked:licensePicker.open() }
            }
            ColumnLayout {
                visible:root.mode==="modules";Layout.fillWidth:true
                Label { textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;text:"Модулі можна ввімкнути в межах ліцензії. Залежності мають бути ввімкнені. Вимкнення зберігає дані; сервер перевіряє право виконання кожної операції.";color:"#405C83" }
                Repeater {
                    model:root.bridge.centerModules
                    delegate:CheckBox {
                        required property var modelData
                        text:modelData.name+" · "+modelData.version+(modelData.core?" · базовий":!modelData.licensed?" · поза ліцензією":"")
                        checked:root.selectedModules.includes(modelData.id);enabled:!modelData.core&&modelData.licensed&&!root.bridge.working
                        onClicked:{let next=root.selectedModules.filter(id=>id!==modelData.id);if(checked)next.push(modelData.id);root.selectedModules=next;root.dirty=true}
                    }
                }
            }
            ColumnLayout {
                visible:root.mode==="consent-policy";Layout.fillWidth:true;spacing:10
                CheckBox { text:"Без підписаних сканів не завершувати реєстрацію";enabled:root.bridge.licenseStatus.version!==2;checked:root.policy.required!==false;onClicked:{root.policy=Object.assign({},root.policy,{required:checked});root.dirty=true} }
                Label { textFormat:Text.PlainText;text:"Внесіть затверджені центром тексти. Зміна тексту створює нову версію; старі підписані документи зберігаються в історії.";Layout.fillWidth:true;wrapMode:Text.WordWrap;color:"#405C83" }
                Repeater {
                    id:templates;model:root.policy.templates || []
                    delegate:ColumnLayout {
                        required property var modelData
                        readonly property var edited:({document_type:modelData.document_type,title:heading.text,content:body.text,required:consentRequired.checked})
                        Layout.fillWidth:true
                        CheckBox { id:consentRequired;text:"Обов’язкова · версія "+modelData.version;checked:modelData.required;onClicked:root.dirty=true }
                        CareTextField { id:heading;Layout.fillWidth:true;text:modelData.title;onTextEdited:root.dirty=true
    implicitHeight:46;leftPadding:14;selectByMouse:true
    background:Rectangle{radius:12;color:"white";border.color:heading.activeFocus?"#1764EF":"#CFDDF0"}
}
                        CareTextArea { id:body;Layout.fillWidth:true;implicitHeight:190;text:modelData.content;wrapMode:TextEdit.Wrap;selectByMouse:true;placeholderText:"Затверджений текст згоди";onTextChanged:{if(activeFocus)root.dirty=true}
    leftPadding:14;topPadding:12
    background:Rectangle{radius:12;color:"white";border.color:body.activeFocus?"#1764EF":"#CFDDF0"}
}
                    }
                }
            }
            Label { textFormat:Text.PlainText;text:root.bridge.error || root.bridge.notice;visible:!!text;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.bridge.error?"#8C3632":"#256540" }
        }
    }
    footer:DialogButtonBox {
        Action { objectName:"settings-close";text:"Закрити";enabled:!root.bridge.working;onClicked:root.close() }
        Action { text:"Зберегти";visible:root.mode!=="license";enabled:!root.bridge.working&&(root.mode==="modules"?root.bridge.centerModules.length>0:Number(root.policy.revision)>0);onClicked:{
            if(root.mode==="modules")root.bridge.saveCenterModules(root.selectedModules)
            else{const values=[];for(let i=0;i<templates.count;i++)values.push(templates.itemAt(i).edited);root.bridge.saveConsentPolicy({required:root.policy.required!==false,revision:Number(root.policy.revision),templates:values})}
        } }
    }
    FileDialog { id:requestPicker;title:"Зберегти запит центру";fileMode:FileDialog.SaveFile;defaultSuffix:"json";nameFilters:["JSON (*.json)"];onAccepted:root.bridge.exportCenterRequest(selectedFile) }
    FileDialog { id:licensePicker;title:"Ліцензія цього центру";nameFilters:["Ліцензія (*.lemvori-license *.json)"];onAccepted:root.bridge.importLicense(selectedFile) }
    Connections { target:root.bridge;function onConfigurationChanged(){if(root.opened&&!root.dirty)root.resetForm()}function onStateChanged(){if(!root.bridge.authenticated)root.close()}function onOperationCompleted(name){if(["modules","consent-policy"].includes(name))root.close()} }
}
