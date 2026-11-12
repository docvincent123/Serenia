import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts
Dialog {
    id:root
    required property var bridge
    property var scans:({})
    property string printedSnapshot:""
    property url printedFile:""
    readonly property var rules:(bridge.consentPolicy.templates || []).filter(r=>r.required)
    readonly property bool requiresConsent:bridge.consentPolicy.required !== false
    readonly property bool phoneValid: {
        const count=phone.text.replace(/[^0-9]/g,"").length
        return count>=7 && count<=15
    }
    readonly property bool dateValid: {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob.text)) return false
        const parts=dob.text.split("-").map(Number)
        const d=new Date(parts[0],parts[1]-1,parts[2])
        return parts[0]>=1900 && d.getFullYear()===parts[0] &&
               d.getMonth()+1===parts[1] && d.getDate()===parts[2] && d<=new Date()
    }
    readonly property bool dataReady: !!name.text.trim()&&phoneValid&&dateValid&&Number(psychologist.currentValue)>0
    readonly property bool ready:{
        if(!dataReady||!Object.keys(bridge.consentPolicy).length)return false
        if(!requiresConsent)return true
        if(!bridge.registrationReference||printedSnapshot!==JSON.stringify(fields())||!rules.length)return false
        for(let i=0;i<consents.count;i++){const row=consents.itemAt(i);if(!row||!row.signed||!row.signerName||!scans[row.documentType])return false}
        return true
    }
    function fields(){return {name:name.text.trim(),phone:phone.text.trim(),dob:dob.text,category:category.currentText,psychologist_id:Number(psychologist.currentValue)}}
    function submit(bookAfter){const entries=[];for(let i=0;i<consents.count;i++){const row=consents.itemAt(i);if(scans[row.documentType])entries.push({document_type:row.documentType,file:String(scans[row.documentType]),signed_by_name:row.signerName,paper_signed:row.signed})}bridge.registerWithConsents(fields(),entries,bookAfter)}
    title:"Реєстрація пацієнта та згоди"; modal:true; anchors.centerIn:Overlay.overlay
    width:Math.min(780,Overlay.overlay.width-40);height:Math.min(740,Overlay.overlay.height-40)
    closePolicy:bridge.working?Popup.NoAutoClose:Popup.CloseOnEscape
    background:Rectangle{radius:22;color:"#F5F7F7";border.color:"#CCD0CF"}
    header:Rectangle{
        color:"transparent";implicitHeight:82
        ColumnLayout{anchors.fill:parent;anchors.leftMargin:22;anchors.rightMargin:22;spacing:3
            Label{text:bridge.centerConfiguration.center_name || "LEMVORI CARE";font.pixelSize:12;color:"#4A5C6A"}
            Label{text:root.title;font.pixelSize:22;font.bold:true;color:"#11212D"}
        }
    }
    onOpened:{scans=({});printedSnapshot="";bridge.loadCenterConfiguration()}
    onClosed:{name.clear();phone.clear();dob.clear();scans=({});printedSnapshot=""}
    component Action:Button { id:b;implicitHeight:42;leftPadding:16;rightPadding:16;contentItem:Text{textFormat:Text.PlainText;text:b.text;color:b.enabled?"#11212D":"#9BA8AB";font.bold:true;verticalAlignment:Text.AlignVCenter;horizontalAlignment:Text.AlignHCenter} background:Rectangle{radius:21;color:b.hovered?"#CCD0CF":"white";border.color:"#CCD0CF"} }
    component Field:CareTextField { implicitHeight:48;leftPadding:14;rightPadding:14;selectByMouse:true;background:Rectangle{radius:12;color:"white";border.color:parent.activeFocus?"#253745":"#CCD0CF"} }
    contentItem:ScrollView {
        id:scroll;contentWidth:availableWidth;clip:true;leftPadding:22;rightPadding:22;topPadding:8;bottomPadding:12
        ColumnLayout {
            width:scroll.availableWidth;spacing:12
            Label { textFormat:Text.PlainText;text:"1. Реєстраційні дані";font.bold:true;font.pixelSize:18 }
            Label { text:"ПІБ пацієнта *";font.bold:true;color:"#11212D" }
            Field { id:name;Layout.fillWidth:true;placeholderText:"Прізвище, ім’я та по батькові";Accessible.name:"ПІБ пацієнта" }
            GridLayout {
                Layout.fillWidth:true;columns:scroll.availableWidth>580?2:1
                columnSpacing:14;rowSpacing:10
                ColumnLayout{Layout.fillWidth:true;Layout.preferredWidth:1;Layout.minimumWidth:0;Layout.alignment:Qt.AlignTop;spacing:5
                    Label{text:"Телефон *";font.bold:true;color:"#11212D"}
                    Field { id:phone;Layout.fillWidth:true;placeholderText:"+380…";Accessible.name:"Телефон"
                        inputMethodHints:Qt.ImhDialableCharactersOnly }
                    Label {visible:phone.text.length>0&&!root.phoneValid
                        text:"Перевірте номер: 7–15 цифр";font.pixelSize:11;color:"#8C3632"}
                }
                ColumnLayout{Layout.fillWidth:true;Layout.preferredWidth:1;Layout.minimumWidth:0;Layout.alignment:Qt.AlignTop;spacing:5
                    Label{text:"Дата народження *";font.bold:true;color:"#11212D"}
                    Field { id:dob;Layout.fillWidth:true;placeholderText:"РРРР-ММ-ДД";maximumLength:10;inputMethodHints:Qt.ImhDate;Accessible.name:"Дата народження" }
                    Label {visible:dob.text.length>0&&!root.dateValid
                        text:"Введіть дійсну дату, не пізніше сьогодні";font.pixelSize:11;color:"#8C3632"}
                }
            }
            GridLayout {
                Layout.fillWidth:true;columns:scroll.availableWidth>580?2:1
                columnSpacing:14;rowSpacing:10
                ColumnLayout{Layout.fillWidth:true;Layout.preferredWidth:1;Layout.minimumWidth:0;Layout.alignment:Qt.AlignTop;spacing:5
                    Label{text:"Категорія *";font.bold:true;color:"#11212D"}
                    CareComboBox { id:category;objectName:"registration-category";Layout.fillWidth:true;implicitHeight:46;model:["Військовий/військова","Ветеран/ветеранка","Партнер/партнерка","Дитина","Інше"]
                        background:Rectangle{radius:12;color:"white";border.color:"#CCD0CF"} }
                }
                ColumnLayout{Layout.fillWidth:true;Layout.preferredWidth:1;Layout.minimumWidth:0;Layout.alignment:Qt.AlignTop;spacing:5
                    Label{text:"Відповідальний психолог *";font.bold:true;color:"#11212D"}
                    CareComboBox { id:psychologist;Layout.fillWidth:true;implicitHeight:46;model:root.bridge.bookingPsychologists;textRole:"name";valueRole:"id"
                        background:Rectangle{radius:12;color:"white";border.color:"#CCD0CF"} }
                }
            }
            Label {visible:!root.bridge.bookingPsychologists.length
                text:"Немає психологів, доступних для призначення. Перевірте графік зміни.";Layout.fillWidth:true
                wrapMode:Text.WordWrap;color:"#8C3632" }
            Label { textFormat:Text.PlainText;text:"2. Друк і власноручний підпис";font.bold:true;font.pixelSize:18;Layout.topMargin:8 }
            Label { textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;text:"Роздрукуйте картку та затверджені центром бланки. Пацієнт або законний представник підписує їх на папері. Якщо реєстраційні дані зміняться, бланки потрібно надрукувати повторно.";color:"#4A5C6A" }
            Action { text:"Зберегти бланки PDF для друку";enabled:root.dataReady&&!root.bridge.working;onClicked:printPicker.open() }
            Action { text:"Відкрити PDF для друку";visible:!!root.printedFile&&root.printedSnapshot===JSON.stringify(root.fields());onClicked:root.bridge.openPdf(root.printedFile) }
            Label { textFormat:Text.PlainText;visible:!!root.bridge.registrationReference;text:"Реєстрація: "+root.bridge.registrationReference;wrapMode:Text.WrapAnywhere;Layout.fillWidth:true;color:"#4A5C6A" }
            Label { textFormat:Text.PlainText;text:"3. Скан підписаних згод";font.bold:true;font.pixelSize:18;Layout.topMargin:8 }
            Label { Layout.fillWidth:true;wrapMode:Text.WordWrap;font.pixelSize:12;color:"#4A5C6A"
                text:root.requiresConsent ? "Потрібно оформити " + root.rules.length + " обов’язкових згод за актуальними редакціями." : "Обов’язкові згоди наразі не встановлені адміністратором." }
            Repeater {
                id:consents
                model:root.rules
                delegate:ColumnLayout {
                    required property var modelData
                    readonly property string documentType:modelData.document_type
                    readonly property string signerName:signer.text.trim()
                    readonly property bool signed:verified.checked
                    Layout.fillWidth:true;spacing:7
                    Label { textFormat:Text.PlainText;text:modelData.title+" · версія "+modelData.version;Layout.fillWidth:true;wrapMode:Text.WordWrap;font.bold:true }
                    Action { text:root.scans[documentType]?"Змінити скан":"Вибрати підписаний скан";onClicked:{scanPicker.documentType=documentType;scanPicker.open()} }
                    Image { visible:!!root.scans[documentType];source:root.scans[documentType] || "";Layout.fillWidth:true;Layout.preferredHeight:150;fillMode:Image.PreserveAspectFit;sourceSize.width:900;cache:false }
                    Field { id:signer;Layout.fillWidth:true;placeholderText:"ПІБ того, хто підписав документ" }
                    CheckBox { id:verified;text:"Підпис на паперовому оригіналі перевірено" }
                    Rectangle { Layout.fillWidth:true;Layout.preferredHeight:1;color:"#CCD0CF" }
                }
            }
            Label { textFormat:Text.PlainText;visible:!root.rules.length;text:"Адміністратор має налаштувати та затвердити тексти згод центру.";Layout.fillWidth:true;wrapMode:Text.WordWrap;color:"#8C3632" }
            Label { textFormat:Text.PlainText;text:root.bridge.error || root.bridge.notice;visible:!!text;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.bridge.error?"#8C3632":"#256540" }
        }
    }
    footer:DialogButtonBox {
        Action { text:"Скасувати";enabled:!root.bridge.working;onClicked:root.close() }
        Action { text:"Зареєструвати";enabled:root.ready&&!root.bridge.working;onClicked:root.submit(false) }
        Action { text:"Зареєструвати й записати";enabled:root.ready&&!root.bridge.working;onClicked:root.submit(true) }
    }
    FileDialog { id:printPicker;title:"Бланки реєстрації та згод";fileMode:FileDialog.SaveFile;defaultSuffix:"pdf";nameFilters:["PDF (*.pdf)"];onAccepted:{if(root.bridge.printRegistration(selectedFile,root.fields())){root.printedSnapshot=JSON.stringify(root.fields());root.printedFile=selectedFile}} }
    FileDialog { id:scanPicker;property string documentType;title:"Підписана згода";nameFilters:["Зображення (*.png *.jpg *.jpeg)"];onAccepted:{const next=Object.assign({},root.scans);next[documentType]=selectedFile;root.scans=next} }
    Connections { target:root.bridge;function onStateChanged(){if(!root.bridge.authenticated)root.close()}function onOperationCompleted(operation){if(operation==="patient")root.close()} }
}
