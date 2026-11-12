#include "ApiBridge.h"
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickItem>
#include <QQuickWindow>
#include <QQuickStyle>
#include <QImage>
#include <QPalette>
#include <QColor>
#include <QFile>
#include <QElapsedTimer>
#include <QSettings>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QTemporaryDir>
#include <QThread>
#include <functional>

static void pump(int ms=160) { QElapsedTimer t; t.start(); while(t.elapsed()<ms){QCoreApplication::processEvents();QThread::msleep(3);} }
static bool waitFor(const std::function<bool()> &ready) { QElapsedTimer t; t.start(); while(!ready()&&t.elapsed()<5000)pump(10);pump(50);return ready(); }
static void verify(bool ok,const char *message){if(!ok)qFatal("%s",message);}
static QQuickItem *find(QQuickItem *item,const char *property,const QString &value){
    if(!item->isVisible())return nullptr;
    if(item->property(property).toString()==value)return item;
    for(auto *child:item->childItems())if(auto *match=find(child,property,value))return match;
    return nullptr;
}
int main(int argc,char **argv){
    QGuiApplication app(argc,argv); QQuickStyle::setStyle("Basic");
    if (qEnvironmentVariableIsSet("LEMVORI_TEST_DARK_PALETTE")) {
        QPalette dark;
        for (const auto group : {QPalette::Active,QPalette::Inactive,QPalette::Disabled}) {
            dark.setColor(group,QPalette::Text,Qt::white);
            dark.setColor(group,QPalette::WindowText,Qt::white);
            dark.setColor(group,QPalette::ButtonText,Qt::white);
            dark.setColor(group,QPalette::HighlightedText,Qt::white);
            dark.setColor(group,QPalette::Base,QColor("#202020"));
            dark.setColor(group,QPalette::Window,QColor("#202020"));
        }
        QGuiApplication::setPalette(dark);
    }
    verify(argc==3,"Expected HTTPS fixture and CA");
    QTemporaryDir config;QSettings::setDefaultFormat(QSettings::IniFormat);QSettings::setPath(QSettings::IniFormat,QSettings::UserScope,config.path());
    QCoreApplication::setOrganizationName("LemvoriLab");QCoreApplication::setApplicationName("NativeUiTest");
    auto ssl=QSslConfiguration::defaultConfiguration();ssl.addCaCertificates(QSslCertificate::fromPath(argv[2]));QSslConfiguration::setDefaultConfiguration(ssl);
    QStringList warnings;
    ApiBridge bridge;
    QQmlApplicationEngine engine;
    QObject::connect(&engine,&QQmlEngine::warnings,[&](const QList<QQmlError> &errors){for(const auto &error:errors)warnings<<error.toString();});
    engine.rootContext()->setContextProperty("api",&bridge);engine.load(QUrl("qrc:/Main.qml"));
    verify(!engine.rootObjects().isEmpty(),"QML did not load");
    auto *window=qobject_cast<QQuickWindow*>(engine.rootObjects().first());verify(window,"Window missing");
    window->resize(920,640);pump();
    auto lookup=[&](const char *prop,const QString &value){return find(window->contentItem(),prop,value);};
    auto click=[&](const QString &text){auto *item=lookup("text",text);if(!item)qFatal("Requested action not found: %s",qPrintable(text));verify(QMetaObject::invokeMethod(item,"clicked"),"Action is not clickable");pump();};
    auto clickObject=[&](const QString &name){auto *item=lookup("objectName",name);verify(item,"Named action missing");verify(QMetaObject::invokeMethod(item,"clicked"),"Named action not clickable");pump();};
    verify(lookup("placeholderText","Введіть логін")&&!lookup("placeholderText","https://server.center:8443"),"Login exposes server form");
    auto *login=lookup("placeholderText","Введіть логін");auto bounds=login->mapRectToScene(login->boundingRect());
    verify(bounds.left()>=0&&bounds.right()<=window->width()&&bounds.bottom()<=window->height(),"Login does not fit small window");
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS"))window->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/login.png");
    click("Підключення");verify(lookup("placeholderText","https://server.center:8443"),"Connection dialog missing");click("Готово");
    bridge.configureServer(argv[1]);verify(waitFor([&]{return bridge.connected();}),"Fixture connection failed");
    bridge.login("reception","test");verify(waitFor([&]{return bridge.role()=="reception";}),"Reception login failed");pump();
    auto page=[&](const QString &name){verify(QMetaObject::invokeMethod(window,"showPage",Q_ARG(QVariant,QVariant(name))),"Navigation method failed");pump();verify(waitFor([&]{return !bridge.workspaceLoading();}),"Workspace stuck loading");
        verify((lookup("objectName","homepage-welcome")!=nullptr)==(name=="Головна"),"Greeting visible outside home page");};
    verify(lookup("objectName","homepage-welcome"),"Homepage greeting missing");
    verify(bridge.notice().isEmpty(),"Greeting leaked into global status");
    verify(!lookup("text","Адміністрування")&&!lookup("text","Супервізії"),"Reception sees management menu");
    click(bridge.displayName());
    verify(lookup("placeholderText","Поточний пароль"),"Profile form missing");
    click("Закрити");
    page("Пацієнти");click("+ Новий пацієнт");
    auto *registrationName=lookup("placeholderText","Прізвище, ім’я та по батькові");
    verify(registrationName,"Registration form missing");
    const auto registrationBounds=registrationName->mapRectToScene(registrationName->boundingRect());
    verify(registrationBounds.left()>=0&&registrationBounds.right()<=window->width(),"Registration fields overflow small window");
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS"))window->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/registration.png");
    auto *category=lookup("objectName","registration-category");verify(category,"Category selector missing");
    auto *categoryPopup=category->property("popup").value<QObject*>();verify(categoryPopup,"Category popup missing");
    QMetaObject::invokeMethod(categoryPopup,"open");pump();
    verify(categoryPopup->property("visible").toBool(),"Category popup did not open");
    QMetaObject::invokeMethod(categoryPopup,"close");pump();
    click("Скасувати");
    page("Передача зміни");verify(lookup("text","Завдання наступній зміні"),"Handover row missing");click("+ Додати");
    auto *summary=lookup("objectName","summary");verify(summary,"Handover editor missing");summary->setProperty("text","Передати зміну");click("Зберегти");verify(waitFor([&]{return !bridge.working();}),"Handover save failed");pump();
    page("Лист очікування");page("Сім’ї");click("+ Додати");verify(lookup("objectName","name"),"Family editor missing");click("Скасувати");
    page("Пацієнти");verify(waitFor([&]{return !bridge.patients().isEmpty();}),"Patient directory missing");pump();click("Картка");verify(waitFor([&]{return bridge.patientRecord().value("id").toInt()==19;}),"Patient record missing");pump();
    verify(waitFor([&]{return !bridge.patientVisitsLoading() && bridge.patientVisitsTotal()==11;}),"Upcoming patient visits did not load");
    const auto ticketPath=config.filePath("appointment-ticket.pdf");
    bridge.exportAppointmentTicket(QUrl::fromLocalFile(ticketPath));
    QFile ticket(ticketPath);
    verify(ticket.open(QIODevice::ReadOnly) && ticket.read(5)=="%PDF-","Next appointment ticket not a PDF");
    clickObject("patient-tab-visits");
    verify(lookup("text","Історія та майбутні прийоми"),"Visit timeline tab not visible");
    clickObject("patient-visits-history");
    verify(waitFor([&]{return !bridge.patientVisitsLoading() && bridge.patientVisitsPeriod()=="history" && bridge.patientVisitsTotal()==1;}),"Visit history did not load");
    verify(bridge.patientVisits().first().toMap().value("status").toString()=="completed","Past visit projection invalid");
    clickObject("patient-visits-upcoming");
    verify(waitFor([&]{return !bridge.patientVisitsLoading() && bridge.patientVisitsPeriod()=="upcoming" && bridge.patientVisitsTotal()==11;}),"Upcoming visits reload failed");
    clickObject("patient-tab-referrals");
    clickObject("referral-edit-7");
    auto *referralChoice=lookup("objectName","referral-status-select");
    verify(referralChoice,"Referral status editor missing");
    referralChoice->setProperty("currentIndex",1);
    pump();click("Зберегти статус");
    verify(waitFor([&]{return !bridge.working();}),"Referral status update failed");
    clickObject("patient-tab-overview");
    verify(lookup("text","Телефон: —"),"Patient overview registration field missing");
        verify(lookup("text","Новий документ")==nullptr,"Document dialog unexpectedly open");click("Додати документ");verify(lookup("placeholderText","Назва документа"),"Document form missing");clickObject("document-close");
    click("Переглянути документи");verify(waitFor([&]{return lookup("text","Текст згоди")!=nullptr;}),"Document text missing");clickObject("document-close");
    click("У лист очікування");verify(lookup("objectName","date_from"),"Waiting request editor missing");click("Скасувати");clickObject("patient-close");
    verify(waitFor([&]{return !bridge.centerConfiguration().isEmpty()&&!bridge.consentPolicy().isEmpty();}),"Consent rules did not load");
    QVariantMap registration{{"name","Synthetic consent patient"},{"dob","2000-01-02"},{"phone","+380990000111"},{"category","Інше"},{"psychologist_id",7}};
    verify(bridge.printRegistration(QUrl::fromLocalFile(config.filePath("registration.pdf")),registration),"Registration PDF failed");
    verify(!bridge.registrationReference().isEmpty(),"Printed reference missing");
    QImage scan(32,32,QImage::Format_RGB32);scan.fill(Qt::white);const auto scanPath=config.filePath("signed.png");verify(scan.save(scanPath),"Scan fixture failed");
    QVariantList signatures;
    for(const auto&kind:QStringList{"informed_consent","data_processing"})signatures.append(QVariantMap{{"document_type",kind},{"file",QUrl::fromLocalFile(scanPath).toString()},{"signed_by_name","Synthetic signer"},{"paper_signed",true}});
    auto changed=registration;changed.insert("name","Changed after printing");bridge.registerWithConsents(changed,signatures,false);verify(!bridge.working()&&bridge.error().contains("повторно"),"Changed registration accepted stale signatures");
    int registered=0;QObject::connect(&bridge,&ApiBridge::patientRegistered,[&](const QVariantMap&patient,bool){registered=patient.value("id").toInt();});
    bridge.registerWithConsents(registration,signatures,false);verify(waitFor([&]{return registered==21;}),"Registration did not attach signed scans");
    click("Записати на прийом");auto *kind=lookup("objectName","booking-kind");verify(kind,"Booking type selector missing");kind->setProperty("currentIndex",4);pump();verify(lookup("text","+ Учасник"),"Group participant selector missing");click("Закрити");
    page("Виклик на табло");page("Архів");
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS"))window->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/archive.png");
    bridge.logout();bridge.login("director","test");verify(waitFor([&]{return bridge.role()=="director";}),"Director login failed");pump();
    verify(!lookup("text","Пацієнти")&&!lookup("text","Телефони"),"Director sees confidential modules");page("Супервізії");click("+ Додати");verify(lookup("objectName","scheduled_at"),"Supervision form missing");click("Скасувати");page("Повідомлення");click("+ Додати");verify(lookup("objectName","body"),"Message editor missing");click("Скасувати");page("Навантаження");
    bridge.loadDischarges();verify(waitFor([&]{return !bridge.dischargeRows().isEmpty();}),"PDF source missing");
    const auto pdfPath=config.filePath("discharge.pdf");bridge.exportDischarge(QUrl::fromLocalFile(pdfPath),9);
    verify(waitFor([&]{return QFile::exists(pdfPath);}),"PDF export failed");QFile pdf(pdfPath);verify(pdf.open(QIODevice::ReadOnly)&&pdf.read(5)=="%PDF-","Export is not a PDF");
    ApiBridge admin(true);QQmlApplicationEngine adminEngine;QObject::connect(&adminEngine,&QQmlEngine::warnings,[&](const QList<QQmlError> &errors){for(const auto &error:errors)warnings<<error.toString();});
    adminEngine.rootContext()->setContextProperty("api",&admin);adminEngine.load(QUrl("qrc:/Main.qml"));verify(!adminEngine.rootObjects().isEmpty(),"Admin QML missing");
    auto *adminWindow=qobject_cast<QQuickWindow*>(adminEngine.rootObjects().first());adminWindow->resize(920,640);admin.configureServer(argv[1]);verify(waitFor([&]{return admin.connected();}),"Admin connection failed");admin.login("admin","test");verify(waitFor([&]{return admin.role()=="admin";}),"Admin login failed");pump();
    for(const auto &name:QStringList{"Телефони","Синхронізація","Адміністрування"}){QMetaObject::invokeMethod(adminWindow,"showPage",Q_ARG(QVariant,QVariant(name)));pump();}
    QMetaObject::invokeMethod(adminWindow,"showPage",Q_ARG(QVariant,QVariant("Синхронізація")));pump();
    auto *recover=find(adminWindow->contentItem(),"text","Звірити запис");verify(recover,"Recovery action missing");QMetaObject::invokeMethod(recover,"clicked");verify(waitFor([&]{return admin.detailRecord().value("id").toInt()==12;}),"Recovery detail failed");pump();verify(find(adminWindow->contentItem(),"text","Запис із телефона"),"Recovery source text missing");
    auto *closeRecovery=find(adminWindow->contentItem(),"text","Закрити");
    verify(closeRecovery,"Recovery close missing");QMetaObject::invokeMethod(closeRecovery,"clicked");pump();
    QMetaObject::invokeMethod(adminWindow,"showPage",Q_ARG(QVariant,QVariant("Адміністрування")));pump();
    auto *workspace=find(adminWindow->contentItem(),"objectName","admin-workspace");verify(workspace,"Admin workspace missing");
    auto select=[&](const QString &section){verify(QMetaObject::invokeMethod(workspace,"select",Q_ARG(QVariant,QVariant(section))),"Admin section failed");pump();};
    select("overview");
    verify(find(adminWindow->contentItem(),"objectName","admin-hero"),"Medical dashboard hero missing");
    auto *selectedSection=find(adminWindow->contentItem(),"text","Панель керування");verify(selectedSection,"Selected section missing");
    auto *selectedBackground=selectedSection->property("background").value<QObject*>();verify(selectedBackground,"Selected section background missing");
    verify(selectedBackground->property("color").value<QColor>()==QColor("#1764EF"),"Active navigation lost its blue background");
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS")) {
        adminWindow->resize(1440,900);pump();
        adminWindow->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/blue-admin-desktop.png");
        adminWindow->resize(920,640);pump();
        adminWindow->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/blue-admin-small.png");
    }
    select("team");
    auto *add=find(adminWindow->contentItem(),"text","+ Додати");verify(add,"Staff create action missing");QMetaObject::invokeMethod(add,"clicked");pump();
    auto *field=find(adminWindow->contentItem(),"text","ПІБ");verify(field,"Staff editor missing");
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS"))adminWindow->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/admin-staff.png");
    auto *cancel=find(adminWindow->contentItem(),"text","Скасувати");verify(cancel,"Staff cancel missing");QMetaObject::invokeMethod(cancel,"clicked");pump();
    select("center");
    verify(waitFor([&]{return !admin.adminDetails().isEmpty();}),"Center settings did not load");pump();
    auto *editCenter=find(adminWindow->contentItem(),"text","Редагувати");verify(editCenter,"Center editor action missing");
    QMetaObject::invokeMethod(editCenter,"clicked");pump();
    auto *centerScroll=find(adminWindow->contentItem(),"objectName","admin-editor-scroll");verify(centerScroll,"Center scroll missing");
    auto *flick=centerScroll->property("contentItem").value<QObject*>();verify(flick,"Center viewport missing");
    flick->setProperty("contentY",std::max(0.0,flick->property("contentHeight").toDouble()-flick->property("height").toDouble()));pump();
    auto *headTitle=find(adminWindow->contentItem(),"objectName","admin-field-head_title");verify(headTitle,"Center text field missing");
    verify(headTitle->property("color").value<QColor>()==QColor("#0C1C34"),"Input inherits unreadable system text");
    verify(headTitle->property("placeholderTextColor").value<QColor>()==QColor("#526A89"),"Placeholder contrast missing");
    headTitle->setProperty("enabled",false);pump();
    verify(headTitle->property("color").value<QColor>()==QColor("#52637D"),"Disabled input unreadable");
    headTitle->setProperty("enabled",true);pump();
    auto *connectionMode=find(adminWindow->contentItem(),"objectName","admin-field-connection_mode");verify(connectionMode,"Connection selector missing");
    auto *connectionPopup=connectionMode->property("popup").value<QObject*>();verify(connectionPopup,"Connection popup missing");
    QMetaObject::invokeMethod(connectionPopup,"open");pump();
    for (int i=0;i<2;++i) {
        auto *option=find(adminWindow->contentItem(),"objectName","care-option-"+QString::number(i));verify(option,"Connection option not visible");
        auto *label=option->property("contentItem").value<QObject*>();verify(label,"Connection option label missing");
        verify(!label->property("text").toString().isEmpty(),"Connection option text empty");
        verify(label->property("color").value<QColor>()==QColor("#0C1C34"),"Popup option text lacks contrast");
    }
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS"))adminWindow->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/connection-options.png");
    QMetaObject::invokeMethod(connectionPopup,"close");pump();
    cancel=find(adminWindow->contentItem(),"text","Скасувати");verify(cancel,"Center cancel missing");QMetaObject::invokeMethod(cancel,"clicked");pump();
    select("license");
    verify(find(adminWindow->contentItem(),"objectName","license-publisher-key"),"Publisher-key setup step missing");
    auto *setup=find(adminWindow->contentItem(),"objectName","publisher-key-setup");verify(setup,"Publisher setup view missing");
    auto *publicPicker=setup->findChild<QObject*>("publisher-public-key-picker");verify(publicPicker,"Public-key picker missing");
    publicPicker->setProperty("selectedFile",QUrl::fromLocalFile(qEnvironmentVariable("LEMVORI_TEST_PUBLIC_KEY")));
    QMetaObject::invokeMethod(publicPicker,"accepted");pump();
    auto *trustPrompt=setup->findChild<QObject*>("publisher-key-confirmation");verify(trustPrompt,"Key trust confirmation missing");
    verify(waitFor([&]{return trustPrompt->property("visible").toBool();}),"Selecting a valid public key did not open confirmation");
    QMetaObject::invokeMethod(trustPrompt,"close");pump();
    auto *importLicense=find(adminWindow->contentItem(),"objectName","license-import");verify(importLicense,"License import missing");
    verify(importLicense->isEnabled(),"Choosing a license is blocked before publisher-key setup");
    QMetaObject::invokeMethod(importLicense,"clicked");pump();
    auto *licensePicker=adminWindow->findChild<QObject*>("license-file-picker");verify(licensePicker,"License file picker missing");
    verify(waitFor([&]{return licensePicker->property("visible").toBool();}),"License file picker did not open");
    QMetaObject::invokeMethod(licensePicker,"close");pump();
    const auto globalBeforeLicense=admin.error();
    admin.activateLicenseText("invalid-license-json");pump();
    verify(!admin.licenseError().isEmpty() && admin.error()==globalBeforeLicense,"License error escaped into global banner");
    auto *feedback=find(adminWindow->contentItem(),"objectName","license-feedback");verify(feedback,"Scoped license error missing");
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS"))adminWindow->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/license-setup.png");
    auto *closeLicense=find(adminWindow->contentItem(),"objectName","settings-close");verify(closeLicense,"License close action missing");
    QMetaObject::invokeMethod(closeLicense,"clicked");pump();
    verify(admin.licenseError().isEmpty() && admin.error()==globalBeforeLicense,"Closed license error remained on other pages");
    select("updates");
    verify(waitFor([&]{return !admin.updatesLoading();}),"Update inventory did not finish");pump();
    verify(find(adminWindow->contentItem(),"objectName","update-version"),"Update publisher form missing");
    if(qEnvironmentVariableIsSet("LEMVORI_UI_SHOTS"))adminWindow->grabWindow().save(qEnvironmentVariable("LEMVORI_UI_SHOTS")+"/updates.png");
    if(!warnings.isEmpty())qFatal("QML warnings: %s",qPrintable(warnings.join("\n")));
    qInfo("PASS: reception, director and admin native UI and small-window login");
}
