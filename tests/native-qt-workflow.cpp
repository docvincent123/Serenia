#include "ApiBridge.h"

#include <QCoreApplication>
#include <QElapsedTimer>
#include <QFile>
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
    staff.loadSlots("2026-11-11", 7, 2, 45, 0);
    verify(waitFor([&] { return staff.availableSlots().contains("10:15"); }), "Server slot did not load");
    staff.book(19, 7, 2, "2026-11-11", "10:15", "11:00", "individual");
    staff.book(19, 7, 2, "2026-11-11", "10:15", "11:00", "individual");
    verify(waitFor([&] { return staff.notice().contains("Пацієнта записано"); }), "Booking failed");
    staff.logout();
    verify(!staff.authenticated() && staff.availableSlots().isEmpty(), "Sign-out retained a booking slot");
    staff.login("director", "test");
    verify(waitFor([&] { return staff.overview().value("total_patients").toInt() == 15; }), "Director statistics did not load");
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
    admin.loadAdminSection("team");
    verify(waitFor([&] { return admin.adminRows().size() == 1; }), "Admin team did not load");
    admin.saveAdminEntry("team", 4, {{"name", "Test Staff"}, {"role", "reception"}, {"active", true}});
    verify(waitFor([&] { return admin.notice().contains("Зміни збережено"); }), "Admin team change failed");
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
