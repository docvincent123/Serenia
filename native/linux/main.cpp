#include "ApiBridge.h"
#include <QFileInfo>
#include <QGuiApplication>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QScreen>
#include <QSettings>
#include <QTimer>
#include <algorithm>

int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    app.setOrganizationName("LemvoriLab");
    app.setApplicationVersion("3.2.0-preview7");
    app.setApplicationName("Lemvori Care");
    const bool adminEdition = app.arguments().contains(QStringLiteral("--admin"))
        || QFileInfo(app.applicationFilePath()).completeBaseName().compare("Lemvori Care Admin", Qt::CaseInsensitive) == 0;
    app.setApplicationDisplayName(adminEdition ? "Lemvori Care Admin" : "Lemvori Care");
    app.setDesktopFileName(adminEdition ? "lemvori-care-admin" : "solvia-native");
    app.setWindowIcon(QIcon(":/brand.png"));
    QQuickStyle::setStyle("Basic");

    ApiBridge api(adminEdition);
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("api", &api);
    engine.load(QUrl(QStringLiteral("qrc:/Main.qml")));
    if (engine.rootObjects().isEmpty()) return 2;
    // Remember each native edition's window size and position independently.
    // Never store tokens, patient records, or other private data in Qt settings.
    auto *window=qobject_cast<QQuickWindow*>(engine.rootObjects().first());
    if (window && !app.arguments().contains(QStringLiteral("--smoke"))) {
        const QString key=adminEdition ? QStringLiteral("ui/admin/geometry")
                                       : QStringLiteral("ui/staff/geometry");
        QSettings settings;
        const QRect saved=settings.value(key).toRect();
        const QScreen *screen=window->screen() ? window->screen() : app.primaryScreen();
        if (screen) {
            const QRect area=screen->availableGeometry();
            if (saved.isValid()) {
                const int w=std::clamp(saved.width(), 920, std::max(920,area.width()));
                const int h=std::clamp(saved.height(), 640, std::max(640,area.height()));
                window->resize(w,h);
                const QPoint proposed=saved.topLeft();
                if (area.contains(proposed) && area.intersects(QRect(proposed,QSize(w,h))))
                    window->setPosition(proposed);
                else
                    window->setPosition(area.center()-QPoint(w/2,h/2));
            }
        }
        auto *saveTimer=new QTimer(window);
        saveTimer->setInterval(450);
        saveTimer->setSingleShot(true);
        const auto schedule=[saveTimer](){saveTimer->start();};
        QObject::connect(window,&QWindow::widthChanged,window,schedule);
        QObject::connect(window,&QWindow::heightChanged,window,schedule);
        QObject::connect(window,&QWindow::xChanged,window,schedule);
        QObject::connect(window,&QWindow::yChanged,window,schedule);
        const auto save=[window,key]() {
            if (window->visibility()==QWindow::Maximized ||
                window->visibility()==QWindow::FullScreen) return;
            QSettings settings;settings.setValue(key,QRect(window->position(),window->size()));
            settings.sync();
        };
        QObject::connect(saveTimer,&QTimer::timeout,window,save);
        QObject::connect(&app,&QCoreApplication::aboutToQuit,window,save);
    }
    // CI smoke mode creates the *actual* native window and checks QML imports.
    if (app.arguments().contains(QStringLiteral("--smoke")))
        QTimer::singleShot(1000, &app, &QCoreApplication::quit);
    return app.exec();
}
