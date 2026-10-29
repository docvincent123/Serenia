#include "ApiBridge.h"
#include <QGuiApplication>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QTimer>

int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    app.setOrganizationName("QureMed");
    app.setApplicationName("SOLVIA");
    app.setWindowIcon(QIcon(":/brand.svg"));
    QQuickStyle::setStyle("Basic");

    ApiBridge api;
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("api", &api);
    engine.load(QUrl(QStringLiteral("qrc:/Main.qml")));
    if (engine.rootObjects().isEmpty()) return 2;
    // CI smoke mode creates the *actual* native window and checks QML imports.
    if (app.arguments().contains(QStringLiteral("--smoke")))
        QTimer::singleShot(1000, &app, &QCoreApplication::quit);
    return app.exec();
}
