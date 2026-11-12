#include "ApiBridge.h"

#include <QCoreApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QImage>
#include <QSettings>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QTemporaryDir>
#include <QThread>
#include <functional>

static bool waitFor(const std::function<bool()> &ready) {
    QElapsedTimer timer;
    timer.start();
    while (!ready() && timer.elapsed() < 4000) {
        QCoreApplication::processEvents();
        QThread::msleep(5);
    }
    return ready();
}

static void verify(bool result, const char *message) {
    if (!result) qFatal("%s", message);
}

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    verify(argc == 3, "Expected HTTPS URL and test CA");
    const QString address = QString::fromLocal8Bit(argv[1]);
    QTemporaryDir config;
    verify(config.isValid(), "Temporary settings directory is unavailable");
    QCoreApplication::setOrganizationName("LemvoriLab");
    QCoreApplication::setApplicationName("NativeWorkflowTest");
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, config.path());

    auto ssl = QSslConfiguration::defaultConfiguration();
    const auto certificates = QSslCertificate::fromPath(QString::fromLocal8Bit(argv[2]));
    verify(!certificates.isEmpty(), "Unable to read test CA");
    ssl.addCaCertificates(certificates);
    QSslConfiguration::setDefaultConfiguration(ssl);

    ApiBridge staff;
    staff.verifySavedServer();
    verify(!staff.connected() && !staff.working(), "First launch tried to connect without a saved center");
    staff.configureServer(address);
    verify(waitFor([&] { return staff.connected(); }), "HTTPS did not connect");
    staff.login("admin", "test");
    verify(waitFor([&] { return staff.error().contains("Lemvori Care Admin"); }), "Staff app accepted admin");
    verify(!staff.authenticated(), "Rejected admin kept a staff session");

    staff.login("reception", "test");
    verify(waitFor([&] { return staff.role() == "reception"; }), "Reception sign-in failed");
    verify(waitFor([&] { return !staff.moduleEnabled("messages"); }), "Reception restrictions were not loaded");
    verify(staff.moduleEnabled("patients"), "Permission projection removed a permitted module");
    staff.loadSlots("2026-11-11", 7, 2, 45, 0);
    verify(waitFor([&] { return staff.availableSlots().contains("10:15"); }), "Server slot did not load");
    staff.book(19, 7, 2, "2026-11-11", "10:15", "11:00", "individual");
    staff.book(19, 7, 2, "2026-11-11", "10:15", "11:00", "individual");
    verify(waitFor([&] { return staff.notice().contains("Пацієнта записано"); }), "Booking failed");
    verify(staff.workspaceAllowed("waiting") && staff.workspaceAllowed("patient"), "Reception missing operational permissions");
    verify(!staff.workspaceAllowed("messages") && !staff.workspaceAllowed("devices"), "Reception gained management permission");
    staff.loadWorkspace("waiting");
    verify(waitFor([&] { return !staff.workspaceLoading() && staff.workspaceRows().size()==1; }), "Waiting list did not load");
    staff.workspaceAction("waiting", "offered", 6, {{"version",3}});
    verify(waitFor([&] { return !staff.working(); }), "Waiting offer did not complete");
    staff.workspaceAction("waiting", "book", 6, {{"version",4},{"room_id",2},{"start","2026-11-11T10:15"},{"end","2026-11-11T11:00"}});
    verify(waitFor([&] { return !staff.working(); }), "Waiting booking did not complete");
    staff.workspaceAction("handover", "create", 0, {{"summary","Передати ключі"},{"priority","important"}});
    staff.workspaceAction("handover", "create", 0, {{"summary","Передати ключі"},{"priority","important"}});
    verify(waitFor([&] { return !staff.working(); }), "Handover did not complete");
    staff.openPatient(19);
    verify(waitFor([&] { return staff.patientRecord().value("id").toInt()==19; }), "Patient record did not load");
    staff.workspaceAction("patient", "edit", 19, {{"family_id", 2},{"name", "Synthetic patient"}});
    verify(waitFor([&] { return !staff.working(); }), "Patient edit failed");
    verify(waitFor([&]{return staff.patientRecord().value("id").toInt()==19;}),"Patient did not reload after edit");
    QImage scan(32,32,QImage::Format_RGB32);scan.fill(Qt::white);
    const auto scanPath=config.filePath("paper.png");verify(scan.save(scanPath),"Cannot create test scan");
    staff.saveDocument({{"source","paper_scan"},{"title","Згода"},{"document_type","informed_consent"},{"status","signed"},{"signed_by_name","Пацієнт"},{"paper_signed",true}},QUrl::fromLocalFile(scanPath));
    verify(waitFor([&] { return !staff.working(); }), "Scanned document failed");
    staff.bookParticipants({19,20},7,2,"2026-11-11","14:15","15:15","group");
    verify(waitFor([&] { return !staff.working(); }), "Group booking failed");
    staff.workspaceAction("messages", "create", 0, {{"recipient_id",7},{"body","FORBIDDEN"}});
    staff.loadWorkspace("devices");
    staff.logout();
    verify(staff.workspaceRows().isEmpty() && staff.patientRecord().isEmpty() && !staff.workspaceAllowed("waiting"), "Sign-out retained workspace data or permissions");
    verify(!staff.authenticated() && staff.availableSlots().isEmpty(), "Sign-out retained a booking slot");
    staff.login("director", "test");
    verify(waitFor([&] { return staff.overview().value("total_patients").toInt() == 15; }), "Director statistics did not load");
    verify(staff.workspaceAllowed("supervisions") && staff.workspaceAllowed("messages") && !staff.workspaceAllowed("patient"), "Director permission boundary failed");
    staff.workspaceAction("supervisions", "create", 0, {{"psychologist_id",7},{"scheduled_at","2026-11-11T12:00"},{"duration_minutes",60},{"topic","План супервізії"}});
    verify(waitFor([&] { return !staff.working(); }), "Director supervision failed");
    staff.workspaceAction("messages", "create", 0, {{"recipient_id",7},{"body","Зустріч о 12:00"}});
    verify(waitFor([&] { return !staff.working(); }), "Director message failed");
    staff.loadDischarges();
    verify(waitFor([&] { return staff.dischargeRows().size() == 1; }), "Director discharges did not load");
    staff.reviewDischarge(9, 2, false, "Уточнити рекомендації");
    verify(waitFor([&] { return staff.notice().contains("Статус виписки оновлено"); }), "Director could not return a discharge");

    ApiBridge admin(true);
    admin.verifySavedServer();
    verify(waitFor([&] { return admin.connected(); }), "Saved center was not verified on restart");
    admin.login("reception", "test");
    verify(waitFor([&] { return admin.error().contains("лише адміністраторам"); }), "Admin app accepted reception");
    admin.login("admin", "test");
    verify(waitFor([&] { return admin.role() == "admin"; }), "Admin sign-in failed");
    verify(admin.workspaceAllowed("devices") && admin.workspaceAllowed("recovery"), "Admin missing device tools");
    admin.openDetail("recovery",12);
    verify(waitFor([&]{return admin.detailRecord().value("id").toInt()==12;}),"Recovery source did not load");
    admin.workspaceAction("recovery","resolve",12,{{"action","complete"},{"reason","Звірено оригінал"},{"confirmed",true},{"payload",admin.detailRecord().value("payload")}});
    verify(waitFor([&]{return !admin.working();}),"Recovery resolution failed");
    admin.searchPatients(QString());
    verify(waitFor([&] { return admin.patientTotal() == 41 && admin.patientPage() == 1 && admin.patients().size() == 1; }), "Patient register first page failed");
    admin.loadPatientPage(2);
    verify(waitFor([&] { return admin.patientPage() == 2 && admin.patients().size() == 1; }), "Patient register second page failed");
    verify(admin.patients().front().toMap().value("id").toInt() == 2, "Patient register page content mismatch");
    admin.loadAdminSection("team");
    verify(waitFor([&] { return admin.adminRows().size() == 1; }), "Admin team did not load");
    verify(waitFor([&] { return admin.serviceChoices().size() == 1; }), "Service options did not load");
    admin.saveAdminEntry("team", 4, {{"name", "Test Staff"}, {"role", "reception"}, {"active", true}, {"primary_service_code", "art"}});
    verify(waitFor([&] { return !admin.working() && admin.notice().contains("Зміни збережено"); }), "Admin team change failed");
    admin.endUserSessions(4);
    verify(waitFor([&] { return !admin.working() && admin.notice().contains("Сеанси працівника завершено"); }), "Employee session revocation failed");
    admin.loadAdminSection("permissions");
    verify(waitFor([&] { return admin.adminRows().size() == 1; }), "Admin permissions did not load");
    admin.saveModulePermissions(4, QVariantList{"documents","clinical"});
    verify(waitFor([&] { return !admin.working() && admin.notice().contains("Права працівника оновлено"); }), "Admin permission update failed");

    verify(waitFor([&]{return !admin.licenseStatus().isEmpty();}),"License metadata missing");
    const auto previousGlobalError=admin.error();
    admin.activateLicenseText("not a license");
    verify(!admin.licenseError().isEmpty() && admin.error()==previousGlobalError && !admin.working(),"Invalid license polluted global status");
    admin.activateLicenseText("{\"format\":\"quremed.solvia.license\",\"payload\":\"test\",\"signature\":\"test\"}");
    verify(admin.licenseError().contains("ключ") && admin.error()==previousGlobalError && !admin.working(),"Missing publisher key was not scoped");
    const auto publicKey=QUrl::fromLocalFile(qEnvironmentVariable("LEMVORI_TEST_PUBLIC_KEY"));
    auto preview=admin.publisherKeyInfo(publicKey);
    verify(preview.value("fingerprint").toString().size()==64,"Ed25519 publisher-key preview failed");
    auto privateKey=QUrl::fromLocalFile(qEnvironmentVariable("LEMVORI_TEST_PRIVATE_KEY"));
    verify(admin.publisherKeyInfo(privateKey).isEmpty() && !admin.licenseError().isEmpty(),"Private key accepted as publisher verifier");
    verify(admin.error()==previousGlobalError,"Publisher-key validation polluted global status");
    admin.clearLicenseFeedback();
    verify(admin.licenseError().isEmpty() && admin.licenseNotice().isEmpty(),"License feedback did not clear");

    admin.loadUpdates();
    verify(waitFor([&] { return !admin.updatesLoading() && admin.updateReleases().size()==2 && admin.updateDevices().size()==1; }), "Update inventory failed");
    const QByteArray package("!<arch>\nSynthetic DEB package for transport tests");
    const auto packagePath = config.filePath("update.deb");
    { QFile f(packagePath); verify(f.open(QIODevice::WriteOnly), "Fixture file creation failed"); f.write(package); }
    admin.publishUpdate(QUrl::fromLocalFile(packagePath),"android","3.13.0",182046,"","");
    verify(!admin.working() && !admin.error().isEmpty(),"Android accepted DEB package");
    admin.publishUpdate(QUrl::fromLocalFile(packagePath),"linux","3.13.0",182046,"Тестовий пакет","");
    verify(waitFor([&] { return !admin.working() && admin.notice().contains("опубліковане"); }),"Native publication failed");
    admin.checkClientUpdate();
    verify(waitFor([&] { return !admin.clientUpdate().isEmpty(); }),"Native update check failed");
    const auto downloadPath = config.filePath("download.deb");
    admin.downloadClientUpdate(QUrl::fromLocalFile(downloadPath));
    verify(waitFor([&] { return !admin.working(); }),"Update download stuck");
    { QFile f(downloadPath); verify(f.open(QIODevice::ReadOnly) && f.readAll()==package,"Verified package not saved correctly"); }

    admin.checkClientUpdate();
    verify(waitFor([&] { return admin.clientUpdate().value("sha256").toString()==QString(64,'0'); }),"Corrupt manifest fixture failed");
    admin.downloadClientUpdate(QUrl::fromLocalFile(downloadPath));
    verify(waitFor([&] { return !admin.working(); }) && !admin.error().isEmpty(),"Hash mismatch accepted");
    { QFile f(downloadPath); verify(f.open(QIODevice::ReadOnly) && f.readAll()==package,"Rejected download overwrote existing file"); }

    const auto profile = QUrl::fromLocalFile(config.filePath("test.solvia"));
    admin.exportProfile(profile, true);
    verify(waitFor([&] { return QFile::exists(profile.toLocalFile()); }), "Admin profile export failed");
    ApiBridge pairedStaff;
    pairedStaff.importProfile(profile);
    verify(waitFor([&] { return pairedStaff.connected(); }), "Profile failed to verify the center");

    QSettings settings;
    const QString wrongIdentity(64, QLatin1Char('c'));
    settings.setValue("server/identity", wrongIdentity);
    settings.sync();
    ApiBridge rejectedCenter;
    rejectedCenter.verifySavedServer();
    verify(waitFor([&] { return !rejectedCenter.error().isEmpty(); }), "Changed identity did not report an error");
    verify(!rejectedCenter.connected() && !rejectedCenter.working(), "Changed identity was accepted");
    verify(settings.value("server/identity").toString() == wrongIdentity, "Rejected server replaced saved identity");
}
