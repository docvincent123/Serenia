#include "ApiBridge.h"
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QSettings>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QTemporaryDir>
#include <QThread>
#include <functional>

static void pump(int milliseconds) {
    QElapsedTimer timer; timer.start();
    while (timer.elapsed() < milliseconds) {
        QCoreApplication::processEvents(); QThread::msleep(5);
    }
}
static void check(bool ok, const char *message) { if (!ok) qFatal("%s", message); }
static void waitFor(const std::function<bool()> &ready) {
    QElapsedTimer timer; timer.start();
    while (!ready() && timer.elapsed() < 4000) pump(10);
    check(ready(), "Timed out waiting for native client");
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    check(argc == 3, "Expected HTTPS URL and CA");
    QTemporaryDir settings;
    QCoreApplication::setOrganizationName("LemvoriRefreshTest");
    QCoreApplication::setApplicationName("Refresh");
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, settings.path());
    auto ssl = QSslConfiguration::defaultConfiguration();
    ssl.addCaCertificates(QSslCertificate::fromPath(QString::fromLocal8Bit(argv[2])));
    QSslConfiguration::setDefaultConfiguration(ssl);
    ApiBridge bridge;
    bridge.configureServer(QString::fromLocal8Bit(argv[1]));
    waitFor([&] { return bridge.connected(); });
    bridge.login("reception", "test");
    waitFor([&] { return bridge.authenticated() && bridge.role() == "reception"; });
    for (int i=0; i<100; ++i) bridge.refresh();
    // The first response must remain usable while a follow-up is queued.
    waitFor([&] { return bridge.shift().value("open").toBool(); });
    pump(1200);
    int redraws = 0;
    QObject::connect(&bridge, &ApiBridge::dataChanged, [&] { ++redraws; });
    bridge.refresh(); // fixture fails one request; the batch must still finish
    pump(800);
    bridge.refresh(); // identical successful snapshot must not redraw the models
    pump(800);
    check(redraws == 0, "Unchanged refresh rebuilt desktop models");
    bridge.refresh();
    for (int i=0; i<100; ++i) bridge.refresh();
    bridge.logout();
    pump(800);
    check(!bridge.authenticated() && bridge.shift().isEmpty(), "Old refresh restored signed-out data");
    bridge.login("reception", "test");
    waitFor([&] { return bridge.role() == "reception"; });
    waitFor([&] { return bridge.shift().value("open").toBool(); });
    pump(800);
    return 0;
}
