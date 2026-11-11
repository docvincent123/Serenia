import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs

Item {
    id: root
    required property var bridge
    property string section: "handover"
    property int archivePage: 1
    onSectionChanged: archivePage = 1
    signal bookPatient(var patient)
    signal bookWaiting(var entry)
    readonly property color ink: "#11212D"
    readonly property color muted: "#4A5C6A"
    readonly property string today: Qt.formatDate(new Date(), "yyyy-MM-dd")
    readonly property var titles: ({handover:"Передача зміни",waiting:"Лист очікування",families:"Сім’ї",archive:"Архів",supervisions:"Супервізії",messages:"Повідомлення",workload:"Навантаження",reports:"Звіти психологів",tv:"Виклик на табло",devices:"Телефони психологів",recovery:"Проблеми синхронізації"})
    readonly property var descriptions: ({handover:"Завдання для наступної зміни без приватних консультаційних записів",waiting:"Побажання пацієнтів і запис у вільний час",families:"Об’єднуйте картки членів родини через поле «Сім’я» в картці пацієнта",archive:"Пошук архівних карток і повторне відкриття курсу",supervisions:"Планування зустрічей, підсумки та рекомендації",messages:"Службові повідомлення на Android психолога. Статуси доставки та прочитання",workload:"Показники центру за вибраний період",reports:"Звіти, подані психологами за зміни",tv:"Виклик доступний після відмітки прибуття пацієнта",devices:"Зв’язок, версія програми та черга синхронізації з телефона",recovery:"Непроведені записи з Android. Обробка потребує звірки з оригіналом"})
    readonly property var priority: [{key:"normal",label:"Звичайний"},{key:"important",label:"Важливий"},{key:"urgent",label:"Терміновий"}]
    readonly property var people: bridge.psychologists.map(p => ({key:p.id,label:p.name}))
    readonly property var families: [{key:0,label:"Без сім’ї"}].concat(bridge.familyOptions.map(p => ({key:p.id,label:p.name})))
    readonly property var schemas: ({
        handover:[{key:"summary",label:"Що потрібно передати",type:"area",required:true},{key:"priority",label:"Пріоритет",options:priority,initial:"normal"}],
        families:[{key:"name",label:"Назва сім’ї",required:true}],
        waiting:[{key:"date_from",label:"Дата від (РРРР-ММ-ДД)",initial:today,required:true},{key:"date_to",label:"Дата до (РРРР-ММ-ДД)",initial:today,required:true},{key:"time_from",label:"Час від",initial:"09:00",required:true},{key:"time_to",label:"Час до",initial:"18:00",required:true},{key:"priority",label:"Пріоритет",options:[{key:"normal",label:"Звичайний"},{key:"high",label:"Високий"}],initial:"normal"},{key:"contact_note",label:"Побажання щодо зв’язку",type:"area"}],
        supervisions:[{key:"psychologist_id",label:"Психолог",options:people,required:true},{key:"scheduled_at",label:"Дата і час (РРРР-ММ-ДДTГГ:ХХ)",initial:today+"T10:00",required:true},{key:"duration_minutes",label:"Тривалість, хв",type:"number",from:30,to:240,initial:60},{key:"topic",label:"Тема",type:"area"},{key:"status",label:"Стан",editOnly:true,options:[{key:"scheduled",label:"Заплановано"},{key:"completed",label:"Проведено"},{key:"cancelled",label:"Скасовано"}]},{key:"case_summary",label:"Підсумок випадку",type:"area",editOnly:true},{key:"recommendations",label:"Рекомендації",type:"area",editOnly:true}],
        messages:[{key:"recipient_id",label:"Одержувач",options:people,required:true},{key:"body",label:"Повідомлення",type:"area",required:true}],
        patient:[{key:"name",label:"ПІБ",required:true},{key:"phone",label:"Телефон",required:true},{key:"dob",label:"Дата народження",required:true},{key:"category",label:"Категорія",required:true},{key:"psychologist_id",label:"Відповідальний психолог",options:people,required:true},{key:"family_id",label:"Сім’я",options:families},{key:"family_role",label:"Роль у сім’ї"},{key:"address",label:"Адреса"},{key:"referral_source",label:"Джерело звернення"},{key:"referral_source_details",label:"Деталі звернення",type:"area"}],
        referral:[{key:"destination_type",label:"Напрямок допомоги",required:true},{key:"destination_name",label:"Установа / спеціаліст"},{key:"reason",label:"Причина",type:"area"},{key:"status",label:"Стан",options:[{key:"recommended",label:"Рекомендовано"},{key:"sent",label:"Направлено"},{key:"completed",label:"Виконано"},{key:"cancelled",label:"Скасовано"}],initial:"recommended"}],
        courseOpen:[{key:"started_at",label:"Дата початку",initial:today,required:true},{key:"reason",label:"Причина нового курсу",type:"area",required:true}],
        courseClose:[{key:"ended_at",label:"Дата завершення",initial:today,required:true},{key:"status",label:"Результат",options:[{key:"completed",label:"Курс завершено"},{key:"archived",label:"Перенести в архів"}],initial:"completed"},{key:"outcome",label:"Підсумок / причина",type:"area",required:true}],
        discharge:[{key:"date_from",label:"Період від",initial:Qt.formatDate(new Date(),"yyyy-MM-01"),required:true},{key:"date_to",label:"Період до",initial:today,required:true}],
        note:[{key:"note",label:"Нотатка адміністратора",type:"area",required:true},{key:"priority",label:"Пріоритет",options:priority,initial:"normal"}]
    })
    function load() {
        // Archive uses the third bridge argument for its server-side page number.
        bridge.loadWorkspace(section, search.text, section === "archive" ? String(archivePage) : from.text, to.text)
    }
    function edit(kind, action, entry, title) {
        form.kind = kind; form.action = action; form.entry = entry || {}; form.heading = title || titles[section]
        form.targetSection = ["patient","referral","courseOpen","courseClose","note","discharge"].includes(kind) ? "patient" : kind
        form.open()
    }
    function openPatient(id) { bridge.openPatient(id); patientDialog.open() }
    function label(value) {
        const names = {waiting:"Очікує",offered:"Час запропоновано",booked:"Записано",cancelled:"Скасовано",scheduled:"Заплановано",completed:"Завершено",active:"Активний",archived:"Архів",open:"Відкрите",resolved:"Виконано",signed:"Підписано",refused:"Відмова",recommended:"Рекомендовано",sent:"Направлено",normal:"Звичайний",high:"Високий",important:"Важливий",urgent:"Терміновий"}
        return names[value] || value || "—"
    }
    function summary(row) {
        switch(section) {
        case "handover": return [label(row.priority),row.created_by,row.shift_date,label(row.state)].filter(Boolean).join(" · ")
        case "waiting": return [row.psychologist,row.date_from+" — "+row.date_to,row.time_from+"–"+row.time_to,label(row.status),row.contact_note].filter(Boolean).join(" · ")
        case "families": return String(row.member_count || 0)+" членів сім’ї"
        case "archive": return [row.patient_no,row.phone,row.psychologist].filter(Boolean).join(" · ")
        case "supervisions": return [row.scheduled_at,String(row.duration_minutes)+" хв",row.supervisor,label(row.status),row.topic,row.recommendations].filter(Boolean).join(" · ")
        case "messages": return [row.recipient,row.created,row.read_at ? "Прочитано "+row.read_at : row.delivered_at ? "Доставлено "+row.delivered_at : "Очікує доставки"].filter(Boolean).join(" · ")
        case "workload": return String(row.appointments || 0)+" прийомів · "+String(row.hours || 0)+" год"
        case "reports": return [row.shift_date,String(row.consultations_count || 0)+" консультацій",row.summary,row.incidents,row.handover].filter(Boolean).join("\n")
        case "tv": return [String(row.start || "").slice(11,16),row.psychologist,row.room,row.called_at ? "Викликано" : row.arrived_at ? "Прибув" : "Ще не прибув"].filter(Boolean).join(" · ")
        case "devices": return [row.device_name,row.fresh ? "На зв’язку" : "Немає свіжого зв’язку",row.version_name,"Черга: "+(row.pending_count || 0),"Заблоковано: "+(row.blocked_count || 0),row.last_seen,row.error_code].filter(Boolean).join(" · ")
        case "recovery": return [row.psychologist,label(row.state),row.kind,row.error,row.updated].filter(Boolean).join(" · ")
        }
        return ""
    }
    component Action: Button {
        id: control
        property bool primary: false
        implicitHeight: 40
        leftPadding: 16; rightPadding: 16
        contentItem: Text { text:control.text; color:control.primary ? "white" : root.ink; opacity:control.enabled?1:0.5; font.pixelSize:13; font.bold:true; horizontalAlignment:Text.AlignHCenter; verticalAlignment:Text.AlignVCenter; elide:Text.ElideRight }
        background: Rectangle { radius:20; color:control.primary?root.ink:control.hovered?"#CCD0CF":"white"; border.color:control.primary?root.ink:"#CCD0CF" }
    }
    component Field: TextField {
        implicitHeight:42; leftPadding:12; rightPadding:12; selectByMouse:true; color:root.ink
        background: Rectangle { radius:10; color:"white"; border.color:parent.activeFocus?root.muted:"#CCD0CF" }
    }
    Timer { interval:15000; repeat:true; running:root.visible && root.bridge.authenticated; onTriggered: { if (!form.opened && !patientDialog.opened && !root.bridge.workspaceLoading) root.load() } }
    ScrollView {
        id: scroll
        anchors.fill:parent; padding:24; clip:true
        contentWidth:availableWidth; ScrollBar.horizontal.policy:ScrollBar.AlwaysOff
        ColumnLayout {
            width:scroll.availableWidth; spacing:16
            Label { textFormat:Text.PlainText; text:root.titles[root.section] || ""; font.pixelSize:27; font.bold:true; color:root.ink; Layout.fillWidth:true }
            Label { textFormat:Text.PlainText; text:root.descriptions[root.section] || ""; color:root.muted; wrapMode:Text.WordWrap; Layout.fillWidth:true }
            Label { textFormat:Text.PlainText; visible:!!root.bridge.error || !!root.bridge.notice; text:root.bridge.error || root.bridge.notice; color:root.bridge.error?"#8C3632":"#256540"; Layout.fillWidth:true; wrapMode:Text.WordWrap }
            RowLayout {
                Layout.fillWidth:true
                Field { id:search; visible:root.section==="archive"; Layout.fillWidth:true; placeholderText:"Пошук в архіві"; onTextEdited:{root.archivePage=1; debounce.restart()} }
                Timer { id:debounce; interval:350; onTriggered:root.load() }
                Label { textFormat:Text.PlainText; text:"Від"; visible:["workload","reports"].includes(root.section) }
                Field { id:from; visible:["workload","reports"].includes(root.section); Layout.preferredWidth:135; text:Qt.formatDate(new Date(),"yyyy-MM-01"); onEditingFinished:root.load() }
                Label { textFormat:Text.PlainText; text:"До"; visible:["workload","reports"].includes(root.section) }
                Field { id:to; visible:["workload","reports"].includes(root.section); Layout.preferredWidth:135; text:root.today; onEditingFinished:root.load() }
                Item { Layout.fillWidth:true }
                Action { text:"+ Додати"; primary:true; visible:["handover","families","supervisions","messages"].includes(root.section); enabled:!root.bridge.working; onClicked:root.edit(root.section,"create",{},root.titles[root.section]) }
            }
            Label { textFormat:Text.PlainText;
                visible:root.section==="workload"; Layout.fillWidth:true; wrapMode:Text.WordWrap; color:root.ink; font.pixelSize:16
                text:"Пацієнти: "+(root.bridge.workspaceDetails.total_patients ?? "—")+"   ·   Консультації: "+(root.bridge.workspaceDetails.consultations ?? "—")+"   ·   Нові звернення: "+(root.bridge.workspaceDetails.new_patients ?? "—")+"   ·   Активні курси: "+(root.bridge.workspaceDetails.active_courses ?? "—")
            }
            Label { textFormat:Text.PlainText; visible:root.bridge.workspaceLoading && !root.bridge.workspaceRows.length; text:"Завантаження…"; color:root.muted }
            Label { textFormat:Text.PlainText; visible:!!root.bridge.workspaceError; text:root.bridge.workspaceError; Layout.fillWidth:true; wrapMode:Text.WordWrap; color:"#8C3632" }
            Repeater {
                model:root.bridge.workspaceRows
                delegate: Rectangle {
                    required property var modelData
                    Layout.fillWidth:true; implicitHeight:row.implicitHeight+34; radius:18; color:"white"; border.color:"#D3DCDF"
                    ColumnLayout {
                        id:row; anchors.left:parent.left; anchors.right:parent.right; anchors.top:parent.top; anchors.margins:15; spacing:10
                        Label { textFormat:Text.PlainText; Layout.fillWidth:true; wrapMode:Text.WordWrap; color:root.ink; font.bold:true; font.pixelSize:15; text:modelData.summary || modelData.body || modelData.patient || modelData.psychologist || modelData.name || "Запис № "+modelData.id }
                        Label { textFormat:Text.PlainText; Layout.fillWidth:true; wrapMode:Text.WordWrap; color:root.muted; text:root.summary(modelData) }
                        Flow {
                            Layout.fillWidth:true; spacing:8
                            Action { text:"Виконано"; visible:root.section==="handover"&&modelData.state==="open"; enabled:!root.bridge.working; onClicked:root.bridge.workspaceAction("handover","resolve",modelData.id,{}) }
                            Action { text:"Запропоновано"; visible:root.section==="waiting"&&modelData.status==="waiting"; enabled:!root.bridge.working; onClicked:root.bridge.workspaceAction("waiting","offered",modelData.id,{version:modelData.version}) }
                            Action { text:"Записати"; primary:true; visible:root.section==="waiting"&&["waiting","offered"].includes(modelData.status); onClicked:root.bookWaiting(modelData) }
                            Action { text:"Скасувати очікування"; visible:root.section==="waiting"&&["waiting","offered"].includes(modelData.status); enabled:!root.bridge.working; onClicked:{ confirm.entry=modelData; confirm.open() } }
                            Action { text:"Звірити запис"; visible:root.section==="recovery"; onClicked:recovery.show(modelData.id) }
                            Action { text:"Члени сім’ї"; visible:root.section==="families"; onClicked:{root.bridge.openDetail("family",modelData.id);familyDialog.open()} }
                            Action { text:"Відкрити картку"; visible:root.section==="archive"; onClicked:root.openPatient(modelData.id) }
                            Action { text:"Редагувати"; visible:root.section==="supervisions"; enabled:!root.bridge.working; onClicked:root.edit("supervisions","edit",modelData,"Супервізія") }
                            Action { text:"Викликати на табло"; visible:root.section==="tv"&&!!modelData.arrived_at&&!modelData.started_at; enabled:!root.bridge.working; onClicked:root.bridge.workspaceAction("tv","call",0,{appointment_id:modelData.appointment_id,patient_id:modelData.patient_id}) }
                        }
                    }
                }
            }
            Rectangle {
                visible:!root.bridge.workspaceLoading&&!root.bridge.workspaceError&&!root.bridge.workspaceRows.length
                Layout.fillWidth:true; implicitHeight:116; radius:17;color:"#F7F9F9";border.color:"#DCE1E1"
                ColumnLayout {anchors.centerIn:parent;spacing:8
                    Label {text:"Записів поки немає";color:root.ink;font.bold:true;font.pixelSize:16;horizontalAlignment:Text.AlignHCenter}
                    Label {text:root.section==="archive"?"Спробуйте інше ім’я або номер картки":"Нові записи з’являться тут";color:root.muted;font.pixelSize:12;horizontalAlignment:Text.AlignHCenter}
                }
            }
            RowLayout {
                Layout.fillWidth:true; spacing:12
                visible:root.section==="archive" && Number(root.bridge.workspaceDetails.total || 0)>100
                Action { text:"← Назад"; enabled:root.archivePage>1 && !root.bridge.workspaceLoading
                    onClicked:{root.archivePage--;root.load()} }
                Label { textFormat:Text.PlainText; Layout.fillWidth:true; horizontalAlignment:Text.AlignHCenter
                    text:"Сторінка "+root.archivePage+" із "+Math.max(1,Math.ceil(Number(root.bridge.workspaceDetails.total || 0)/100))
                    color:root.muted }
                Action { text:"Далі →"; enabled:root.archivePage*100<Number(root.bridge.workspaceDetails.total || 0) && !root.bridge.workspaceLoading
                    onClicked:{root.archivePage++;root.load()} }
            }
        }
    }
    Connections {
        target:root.bridge
        function onDataChanged() { if (!root.bridge.workspaceAllowed("patient")) patientDialog.close(); if (form.visible && !root.bridge.workspaceAllowed(form.targetSection)) form.close() }
        function onStateChanged() { if (!root.bridge.authenticated) { form.close(); patientDialog.close(); confirm.close() } }
        function onOperationCompleted(operation) { if (operation==="workspace") { form.close(); confirm.close() } }
    }
    Dialog {
        id:familyDialog; title:"Члени сім’ї"; modal:true; anchors.centerIn:Overlay.overlay
        width:Math.min(620,Overlay.overlay.width-40); height:Math.min(500,Overlay.overlay.height-40)
        contentItem:ScrollView {
            id:membersScroll; contentWidth:availableWidth; clip:true
            ColumnLayout {
                width:membersScroll.availableWidth; spacing:10
                Repeater {
                    model:root.bridge.detailRecord.items || []
                    delegate:Action {
                        required property var modelData
                        Layout.fillWidth:true
                        text:modelData.name+" · "+(modelData.family_role || "")+" · "+root.label(modelData.status)
                        onClicked:{familyDialog.close();root.openPatient(modelData.id)}
                    }
                }
                Label { textFormat:Text.PlainText; text:root.bridge.error; visible:!!text; Layout.fillWidth:true; wrapMode:Text.WordWrap; color:"#8C3632" }
            }
        }
        footer:DialogButtonBox { Action { text:"Закрити"; onClicked:familyDialog.close() } }
        Connections { target:root.bridge; function onStateChanged(){if(!root.bridge.authenticated)familyDialog.close()} }
    }
    FileDialog { id:cardPicker; property bool clinical:false; title:"Зберегти картку PDF";fileMode:FileDialog.SaveFile;defaultSuffix:"pdf";nameFilters:["PDF (*.pdf)"];onAccepted:root.bridge.exportPatientCard(selectedFile,clinical) }
    DocumentsDialog { id:documents; bridge:root.bridge }
    RecoveryDialog { id:recovery; bridge:root.bridge }
    Dialog {
        id:confirm
        property var entry:({})
        title:"Скасувати очікування пацієнта?"; modal:true; anchors.centerIn:Overlay.overlay
        closePolicy:root.bridge.working?Popup.NoAutoClose:Popup.CloseOnEscape
        footer:DialogButtonBox {
            Action { text:"Залишити"; enabled:!root.bridge.working; onClicked:confirm.close() }
            Action { text:"Скасувати очікування"; enabled:!root.bridge.working; onClicked:root.bridge.workspaceAction("waiting","cancelled",confirm.entry.id,{version:confirm.entry.version}) }
        }
    }
    Dialog {
        id:form
        property string kind
        property string action
        property string targetSection
        property string heading
        property var entry:({})
        property string validation:""
        title:heading; modal:true; anchors.centerIn:Overlay.overlay
        width:Math.min(560,Overlay.overlay.width-40); height:Math.min(640,Overlay.overlay.height-40)
        closePolicy:root.bridge.working?Popup.NoAutoClose:Popup.CloseOnEscape
        onOpened:validation=""
        contentItem:ScrollView {
            contentWidth:availableWidth; clip:true
            ColumnLayout {
                width:parent.width; spacing:10
                Repeater {
                    id:fields
                    model:form.visible ? (root.schemas[form.kind] || []).filter(f => !f.editOnly || form.action==="edit") : []
                    delegate:ColumnLayout {
                        required property var modelData
                        readonly property var original:form.entry[modelData.key] ?? modelData.initial ?? ""
                        readonly property var fieldValue:editor.item?editor.item.fieldValue:original
                        Layout.fillWidth:true
                        Label { textFormat:Text.PlainText; text:modelData.label+(modelData.required?" *":""); color:root.ink; Layout.fillWidth:true; wrapMode:Text.WordWrap }
                        Loader {
                            id:editor; Layout.fillWidth:true
                            sourceComponent:modelData.options?comboEditor:modelData.type==="number"?numberEditor:modelData.type==="area"?areaEditor:textEditor
                            Component { id:comboEditor; ComboBox { background:Rectangle{radius:10;color:"white";border.color:"#CCD0CF"}  objectName:modelData.key; readonly property var fieldValue:currentValue; model:modelData.options; textRole:"label"; valueRole:"key"; Component.onCompleted:{const index=indexOfValue(original); currentIndex=index>=0?index:0} } }
                            Component { id:numberEditor; SpinBox { readonly property int fieldValue:value; from:modelData.from; to:modelData.to; value:Number(original); editable:true } }
                            Component { id:textEditor; Field { objectName:modelData.key; readonly property string fieldValue:text; text:String(original); maximumLength:modelData.key==="summary"?300:3000 } }
                            Component { id:areaEditor; TextArea { objectName:modelData.key; readonly property string fieldValue:text; text:String(original); selectByMouse:true; wrapMode:TextEdit.Wrap; implicitHeight:100; color:root.ink; background:Rectangle{radius:10;color:"white";border.color:"#CCD0CF"} } }
                        }
                    }
                }
                Label { textFormat:Text.PlainText; text:form.validation || root.bridge.error; visible:!!text; color:"#8C3632"; Layout.fillWidth:true; wrapMode:Text.WordWrap }
            }
        }
        footer:DialogButtonBox {
            Action { text:"Скасувати"; enabled:!root.bridge.working; onClicked:form.close() }
            Action { text:root.bridge.working?"Зберігаємо…":"Зберегти"; primary:true; enabled:!root.bridge.working; onClicked:{
                const body={}
                for(let i=0;i<fields.count;i++) {
                    const f=fields.itemAt(i)
                    if(f.modelData.required && (f.fieldValue===undefined || f.fieldValue===null || !String(f.fieldValue).trim())) {form.validation="Заповніть поле «"+f.modelData.label+"»."; return}
                    body[f.modelData.key]=f.fieldValue
                }
                if(form.kind==="patient") body.family_id=Number(body.family_id)>0?Number(body.family_id):null
                if(form.kind==="waiting") {body.patient_id=form.entry.patient_id;body.psychologist_id=form.entry.psychologist_id}
                root.bridge.workspaceAction(form.targetSection,form.action,Number(form.entry.id || 0),body)
            } }
        }
    }
    Dialog {
        id: patientDialog
        property string activeTab: "overview"
        readonly property var patient: root.bridge.patientRecord
        readonly property var tabs: {
            const items = [{key:"overview",label:"Огляд"}, {key:"courses",label:"Курси"},
                           {key:"visits",label:"Прийоми"}]
            if (root.bridge.moduleEnabled("documents")) items.push({key:"documents",label:"Документи"})
            items.push({key:"referrals",label:"Направлення"})
            if (root.bridge.role==="admin" && root.bridge.moduleEnabled("rehabilitation"))
                items.push({key:"rehab",label:"План реабілітації"})
            if (root.bridge.role==="admin" && root.bridge.moduleEnabled("clinical"))
                items.push({key:"clinical",label:"Консультації"})
            return items
        }
        title: patient.name || "Картка пацієнта"
        modal: true
        anchors.centerIn: Overlay.overlay
        width: Math.min(980, Overlay.overlay.width-36)
        height: Math.min(770, Overlay.overlay.height-36)
        padding: 0
        background: Rectangle { radius: 22; color:"#F4F6F6"; border.color:"#CCD0CF" }
        onOpened: activeTab="overview"
        onClosed: root.bridge.closePatient()

        header: Rectangle {
            color: "#FFFFFF"; implicitHeight: 107; radius: 22
            Rectangle { anchors.bottom:parent.bottom; width:parent.width; height:20; color:parent.color }
            ColumnLayout {
                anchors.fill: parent; anchors.leftMargin:24; anchors.rightMargin:24; spacing:5
                Label { text:"LEMVORI CARE · КАРТКА ПАЦІЄНТА"; font.pixelSize:11; font.bold:true; color:"#64747E" }
                Label {
                    Layout.fillWidth:true; textFormat:Text.PlainText; font.pixelSize:23; font.bold:true
                    color:root.ink; text:patientDialog.patient.name || "Завантаження картки…"; elide:Text.ElideRight
                }
                Label {
                    textFormat:Text.PlainText; Layout.fillWidth:true; color:root.muted; font.pixelSize:12
                    text:["№ "+(patientDialog.patient.patient_no || "—"),
                          root.label(patientDialog.patient.status),
                          patientDialog.patient.psychologist || ""].filter(Boolean).join(" · ")
                    elide:Text.ElideRight
                }
            }
        }
        contentItem: ScrollView {
            id: recordScroll
            clip: true; contentWidth:availableWidth
            leftPadding:22;rightPadding:22;topPadding:16;bottomPadding:18
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            ColumnLayout {
                width:recordScroll.availableWidth;spacing:15
                Label {
                    textFormat:Text.PlainText; visible:!patientDialog.patient.id
                    text:root.bridge.error || "Завантаження картки…"
                    Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.muted
                }
                Flow {
                    Layout.fillWidth:true; spacing:8; visible:!!patientDialog.patient.id
                    Action { text:"Реєстраційні дані"; onClicked:root.edit("patient","edit",patientDialog.patient,"Реєстраційні дані") }
                    Action { text:"Записати"; primary:true; visible:patientDialog.patient.status==="active"; onClicked:{const patient=patientDialog.patient;patientDialog.close();root.bookPatient(patient)} }
                    Action { text:"У лист очікування"; visible:patientDialog.patient.status==="active"; onClicked:root.edit("waiting","create",{patient_id:patientDialog.patient.id,psychologist_id:patientDialog.patient.psychologist_id},"Побажання пацієнта") }
                    Action { text:"Новий курс"; visible:patientDialog.patient.status!=="active"; onClicked:root.edit("courseOpen","course-open",patientDialog.patient,"Новий курс супроводу") }
                    Action { text:"Друк карти"; onClicked:{cardPicker.clinical=false;cardPicker.open()} }
                    Action { text:"Історія PDF"; visible:root.bridge.role==="admin"&&root.bridge.moduleEnabled("clinical"); onClicked:{cardPicker.clinical=true;cardPicker.open()} }
                    Action { text:"Додати документ"; visible:root.bridge.moduleEnabled("documents"); onClicked:documents.create() }
                    Action { text:"Переглянути документи"; visible:root.bridge.moduleEnabled("documents"); onClicked:documents.showDocuments() }
                    Action { text:"Направлення"; onClicked:root.edit("referral","referral",patientDialog.patient,"Нове направлення") }
                    Action { text:"Створити виписку"; visible:root.bridge.role==="admin"&&root.bridge.moduleEnabled("documents"); onClicked:root.edit("discharge","discharge",patientDialog.patient,"Період виписки") }
                    Action { text:"Нотатка адміна"; visible:root.bridge.role==="admin"; onClicked:root.edit("note","note",patientDialog.patient,"Нотатка адміністратора") }
                }
                GridLayout {
                    visible:!!patientDialog.patient.id
                    Layout.fillWidth:true; columns:width>680?3:1;columnSpacing:10;rowSpacing:10
                    Repeater {
                        model: [
                            {caption:"Курс супроводу",value:patientDialog.patient.status==="active"?"Активний":root.label(patientDialog.patient.status)},
                            {caption:"Згоди пацієнта",value:patientDialog.patient.consent_status ?
                                (patientDialog.patient.consent_status.complete?"Оформлено":"Потрібно перевірити"):"Перевіряємо…"},
                            {caption:"Документи",value:String((patientDialog.patient.documents||[]).length)}
                        ]
                        delegate: Rectangle {
                            required property var modelData
                            Layout.fillWidth:true;implicitHeight:76;radius:15;color:"#FFFFFF";border.color:"#D7DEDF"
                            ColumnLayout {anchors.fill:parent;anchors.margins:14;spacing:4
                                Label{text:modelData.caption;color:root.muted;font.pixelSize:11}
                                Label{text:modelData.value;color:root.ink;font.pixelSize:17;font.bold:true;elide:Text.ElideRight;Layout.fillWidth:true}
                            }
                        }
                    }
                }
                Rectangle {
                    visible:!!patientDialog.patient.consent_status && !patientDialog.patient.consent_status.complete
                    Layout.fillWidth:true;implicitHeight:consentWarning.implicitHeight+28
                    radius:13;color:"#FFF3E4";border.color:"#E6CFAC"
                    Label {id:consentWarning;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:14
                        color:"#795126";wrapMode:Text.WordWrap;textFormat:Text.PlainText
                        text:"Потрібні підписані згоди: "+((patientDialog.patient.consent_status||{}).missing||[]).join(", ")
                    }
                }
                Flow {
                    Layout.fillWidth:true;spacing:7;visible:!!patientDialog.patient.id
                    Repeater {
                        model:patientDialog.tabs
                        delegate: Action {
                            required property var modelData
                            objectName:"patient-tab-"+modelData.key
                            text:modelData.label
                            primary:patientDialog.activeTab===modelData.key
                            onClicked:{
                                patientDialog.activeTab=modelData.key
                                if(modelData.key==="visits")
                                    root.bridge.loadPatientVisits(root.bridge.patientVisitsPeriod,1)
                            }
                        }
                    }
                }
                // Patient registration and non-clinical records remain visible to reception;
                // clinical text remains guarded by role and server-side RBAC.
                ColumnLayout {
                    visible:patientDialog.activeTab==="overview"
                    Layout.fillWidth:true;spacing:12
                    Rectangle {
                        Layout.fillWidth:true;radius:16;implicitHeight:identityBlock.implicitHeight+36
                        color:"white";border.color:"#CCD0CF"
                        ColumnLayout {id:identityBlock;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:18;spacing:9
                            Label {text:"РЕЄСТРАЦІЙНІ ДАНІ";font.pixelSize:11;font.bold:true;color:root.muted}
                            Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.ink
                                text:"Телефон: "+(patientDialog.patient.phone||"—")}
                            Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.ink
                                text:"Дата народження: "+(patientDialog.patient.dob||"—")}
                            Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.ink
                                text:"Категорія: "+(patientDialog.patient.category||"—")}
                            Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.ink
                                text:"Адреса: "+(patientDialog.patient.address||"—")}
                            Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.muted
                                text:"Джерело звернення: "+(patientDialog.patient.referral_source||"—")}
                        }
                    }
                    Label {text:"Останній активний курс і документи доступні у вкладках вище.";color:root.muted;Layout.fillWidth:true;wrapMode:Text.WordWrap}
                    Repeater {
                        model:root.bridge.role==="admin"?(patientDialog.patient.admin_notes||[]):[]
                        delegate: Rectangle {
                            required property var modelData;Layout.fillWidth:true;radius:14
                            implicitHeight:adminNote.implicitHeight+28;color:"white";border.color:"#D7DEDF"
                            Label {id:adminNote;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:14
                                textFormat:Text.PlainText;wrapMode:Text.WordWrap;color:root.ink
                                text:[modelData.author,modelData.created,modelData.note].filter(Boolean).join("\n")}
                        }
                    }
                }
                ColumnLayout {
                    visible:patientDialog.activeTab==="courses"
                    Layout.fillWidth:true;spacing:10
                    Label {text:"Курси супроводу";color:root.ink;font.bold:true;font.pixelSize:18}
                    Repeater {
                        model:patientDialog.patient.courses||[]
                        delegate: Rectangle {
                            required property var modelData;Layout.fillWidth:true
                            implicitHeight:courseContent.implicitHeight+30;radius:15;color:"white";border.color:"#D4DDDF"
                            ColumnLayout {id:courseContent;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:15;spacing:9
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;font.bold:true;color:root.ink
                                    text:"Курс № "+modelData.course_no+" · "+root.label(modelData.status)}
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.muted
                                    text:[modelData.started_at,modelData.psychologist,modelData.reason,modelData.outcome].filter(Boolean).join(" · ")}
                                Action {text:"Завершити курс";visible:modelData.status==="active";onClicked:root.edit("courseClose","course-close",modelData,"Завершення курсу")}
                            }
                        }
                    }
                    Label {visible:!(patientDialog.patient.courses||[]).length;text:"Курсів поки немає.";color:root.muted}
                }
                ColumnLayout {
                    visible:patientDialog.activeTab==="visits"
                    Layout.fillWidth:true;spacing:10
                    Label {text:"Історія та майбутні прийоми";color:root.ink;font.bold:true;font.pixelSize:18}
                    RowLayout {
                        Layout.fillWidth:true
                        Action {objectName:"patient-visits-upcoming";text:"Майбутні";primary:root.bridge.patientVisitsPeriod==="upcoming";onClicked:root.bridge.loadPatientVisits("upcoming",1)}
                        Action {objectName:"patient-visits-history";text:"Історія";primary:root.bridge.patientVisitsPeriod==="history";onClicked:root.bridge.loadPatientVisits("history",1)}
                        Item {Layout.fillWidth:true}
                        Label {color:root.muted;text:"Усього: "+root.bridge.patientVisitsTotal}
                    }
                    Label {visible:root.bridge.patientVisitsLoading;text:"Завантажуємо прийоми…";color:root.muted}
                    Label {visible:!!root.bridge.patientVisitsError;textFormat:Text.PlainText;Layout.fillWidth:true
                        text:root.bridge.patientVisitsError;color:"#8C3632";wrapMode:Text.WordWrap}
                    Repeater {
                        model:root.bridge.patientVisits
                        delegate: Rectangle {
                            required property var modelData;Layout.fillWidth:true;radius:14
                            implicitHeight:visitInfo.implicitHeight+28;color:"white";border.color:"#D7DEDF"
                            ColumnLayout {id:visitInfo;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:14;spacing:5
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;font.bold:true;color:root.ink;wrapMode:Text.WordWrap
                                    text:[modelData.start||"Дата не вказана",modelData.psychologist||"Фахівець"].join(" · ")}
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;color:root.muted;wrapMode:Text.WordWrap
                                    text:[modelData.room,root.label(modelData.visit_status||modelData.status),modelData.completed_at?"Проведено":"",modelData.arrived_at?"Прибув":""].filter(Boolean).join(" · ")}
                            }
                        }
                    }
                    Label {visible:!root.bridge.patientVisitsLoading&&!root.bridge.patientVisitsError&&!root.bridge.patientVisits.length
                        text:"Прийомів за цей період немає.";color:root.muted}
                    RowLayout {
                        Layout.fillWidth:true
                        visible:root.bridge.patientVisitsTotal>10
                        Action {text:"← Назад";enabled:root.bridge.patientVisitsPage>1&&!root.bridge.patientVisitsLoading
                            onClicked:root.bridge.loadPatientVisits(root.bridge.patientVisitsPeriod,root.bridge.patientVisitsPage-1)}
                        Label {Layout.fillWidth:true;text:"Сторінка "+root.bridge.patientVisitsPage+" із "+Math.max(1,Math.ceil(root.bridge.patientVisitsTotal/10));color:root.muted;horizontalAlignment:Text.AlignHCenter}
                        Action {text:"Далі →";enabled:root.bridge.patientVisitsPage*10<root.bridge.patientVisitsTotal&&!root.bridge.patientVisitsLoading
                            onClicked:root.bridge.loadPatientVisits(root.bridge.patientVisitsPeriod,root.bridge.patientVisitsPage+1)}
                    }
                }
                ColumnLayout {
                    visible:patientDialog.activeTab==="documents"
                    Layout.fillWidth:true;spacing:10
                    Label {text:"Документи та підписи";font.bold:true;font.pixelSize:18;color:root.ink}
                    Repeater {
                        model:patientDialog.patient.documents||[]
                        delegate: Rectangle {
                            required property var modelData;Layout.fillWidth:true;radius:15
                            implicitHeight:docLine.implicitHeight+28;color:"white";border.color:"#D4DDDF"
                            ColumnLayout {id:docLine;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:14;spacing:5
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap
                                    text:modelData.title||"Документ";color:root.ink;font.bold:true}
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap
                                    text:[root.label(modelData.status),modelData.signed_by_name,modelData.signed_at||modelData.created].filter(Boolean).join(" · ");color:root.muted}
                            }
                        }
                    }
                    Label {visible:!(patientDialog.patient.documents||[]).length;text:"Документів немає.";color:root.muted}
                    Action {text:"Переглянути оригінали й скани";onClicked:documents.showDocuments()}
                }
                ColumnLayout {
                    visible:patientDialog.activeTab==="referrals"
                    Layout.fillWidth:true;spacing:10
                    Label {text:"Направлення";font.bold:true;font.pixelSize:18;color:root.ink}
                    Repeater {
                        model:patientDialog.patient.referrals||[]
                        delegate: Rectangle {
                            required property var modelData;Layout.fillWidth:true;radius:15
                            implicitHeight:refLine.implicitHeight+28;color:"white";border.color:"#D4DDDF"
                            ColumnLayout {id:refLine;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:14;spacing:5
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap
                                    text:[modelData.destination_type,modelData.destination_name].filter(Boolean).join(" · ");color:root.ink;font.bold:true}
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap
                                    text:[root.label(modelData.status),modelData.reason].filter(Boolean).join(" · ");color:root.muted}
                            }
                        }
                    }
                    Label {visible:!(patientDialog.patient.referrals||[]).length;text:"Направлень поки немає.";color:root.muted}
                }
                ColumnLayout {
                    visible:patientDialog.activeTab==="rehab"&&root.bridge.role==="admin"
                    Layout.fillWidth:true;spacing:10
                    Label {text:"План реабілітації";font.bold:true;font.pixelSize:18;color:root.ink}
                    Label {Layout.fillWidth:true;text:"Клінічні цілі редагує відповідальний психолог на своєму пристрої. Тут — перегляд прогресу.";color:root.muted;wrapMode:Text.WordWrap}
                    Repeater {
                        model:root.bridge.rehabilitationGoals
                        delegate: Rectangle {
                            required property var modelData;Layout.fillWidth:true;radius:15
                            implicitHeight:rehabLine.implicitHeight+30;color:"white";border.color:"#D4DDDF"
                            ColumnLayout {id:rehabLine;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:15;spacing:7
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;font.bold:true;wrapMode:Text.WordWrap;text:modelData.title;color:root.ink}
                                Label {textFormat:Text.PlainText;Layout.fillWidth:true;wrapMode:Text.WordWrap;color:root.muted
                                    text:[modelData.measurement,"Було: "+(modelData.baseline||"—"),"Мета: "+(modelData.target_value||"—"),"Прогрес: "+(modelData.progress_value||"—"),modelData.target_date].filter(Boolean).join(" · ")}
                                Label {textFormat:Text.PlainText;color:root.ink;text:"Стан: "+root.label(modelData.state)+" · Редакція "+modelData.revision}
                                Repeater {
                                    model:(modelData.updates||[]).slice(0,3)
                                    delegate:Label {required property var modelData;Layout.fillWidth:true;textFormat:Text.PlainText;wrapMode:Text.WordWrap;color:root.muted
                                        text:[modelData.created,modelData.author_name,modelData.note].filter(Boolean).join(" · ")}
                                }
                            }
                        }
                    }
                    Label {visible:!root.bridge.rehabilitationGoals.length;text:"Клінічних цілей поки немає.";color:root.muted}
                }
                ColumnLayout {
                    visible:patientDialog.activeTab==="clinical"&&root.bridge.role==="admin"
                    Layout.fillWidth:true;spacing:10
                    Label {text:"Консультації";font.bold:true;font.pixelSize:18;color:root.ink}
                    Repeater {
                        model:patientDialog.patient.consultations||[]
                        delegate: Rectangle {
                            required property var modelData;Layout.fillWidth:true;radius:15
                            implicitHeight:clinicalLine.implicitHeight+28;color:"white";border.color:"#D4DDDF"
                            Label {id:clinicalLine;anchors.left:parent.left;anchors.right:parent.right;anchors.top:parent.top;anchors.margins:14
                                textFormat:Text.PlainText;wrapMode:Text.WordWrap;color:root.ink
                                text:[modelData.created,modelData.psychologist,modelData.request_text,modelData.state_text,
                                    modelData.work_done,modelData.goals,modelData.note,modelData.result_text,
                                    modelData.recommendations,modelData.next_plan].filter(Boolean).join("\n\n")}
                        }
                    }
                    Label {visible:!(patientDialog.patient.consultations||[]).length;text:"Консультацій поки немає.";color:root.muted}
                }
            }
        }
        footer: DialogButtonBox {
            Action {objectName:"patient-close";text:"Закрити";enabled:!root.bridge.working;onClicked:patientDialog.close()}
        }
    }
}
