#pragma once
#include <QObject>
#include <QJsonObject>
#include <QJsonValue>
#include <QNetworkAccessManager>
#include <QVariantMap>
#include <QVariantList>
#include <functional>

class ApiBridge final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString serverUrl READ serverUrl NOTIFY stateChanged)
    Q_PROPERTY(QString displayName READ displayName NOTIFY stateChanged)
    Q_PROPERTY(QString role READ role NOTIFY stateChanged)
    Q_PROPERTY(QString error READ error NOTIFY stateChanged)
    Q_PROPERTY(QString notice READ notice NOTIFY stateChanged)
    Q_PROPERTY(QString lastRefresh READ lastRefresh NOTIFY stateChanged)
    Q_PROPERTY(bool authenticated READ authenticated NOTIFY stateChanged)
    Q_PROPERTY(bool connected READ connected NOTIFY stateChanged)
    Q_PROPERTY(bool working READ working NOTIFY stateChanged)
    Q_PROPERTY(bool rosterSupported READ rosterSupported NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap system READ system NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap shift READ shift NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap overview READ overview NOTIFY dataChanged)
    Q_PROPERTY(QVariantList visits READ visits NOTIFY dataChanged)
    Q_PROPERTY(QVariantList patients READ patients NOTIFY dataChanged)
    Q_PROPERTY(QVariantList appointments READ appointments NOTIFY dataChanged)
    Q_PROPERTY(QVariantList roster READ roster NOTIFY dataChanged)
    Q_PROPERTY(QVariantList psychologists READ psychologists NOTIFY dataChanged)
    Q_PROPERTY(QVariantList rooms READ rooms NOTIFY dataChanged)
public:
    explicit ApiBridge(QObject *parent = nullptr);
    QString serverUrl() const { return origin_; }
    QString displayName() const { return name_; }
    QString role() const { return role_; }
    QString error() const { return error_; }
    QString notice() const { return notice_; }
    QString lastRefresh() const { return lastRefresh_; }
    bool authenticated() const { return !token_.isEmpty(); }
    bool connected() const { return connected_; }
    bool working() const { return working_; }
    bool rosterSupported() const { return rosterSupported_; }
    QVariantMap system() const { return system_; }
    QVariantMap shift() const { return shift_; }
    QVariantMap overview() const { return overview_; }
    QVariantList visits() const { return visits_; }
    QVariantList patients() const { return patients_; }
    QVariantList appointments() const { return appointments_; }
    QVariantList roster() const { return roster_; }
    QVariantList psychologists() const { return psychologists_; }
    QVariantList rooms() const { return rooms_; }

    Q_INVOKABLE void configureServer(const QString &url);
    Q_INVOKABLE void login(const QString &login, const QString &password);
    Q_INVOKABLE void logout();
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void checkServer();
    Q_INVOKABLE void searchPatients(const QString &text);
    Q_INVOKABLE void markArrived(int appointmentId, int patientId);
    Q_INVOKABLE void setShift(bool open);
    Q_INVOKABLE void assignPsychologist(int id, bool onShift);
    Q_INVOKABLE void book(int patientId, int psychologistId, int roomId,
                          const QString &date, const QString &start, const QString &end,
                          const QString &kind);
    Q_INVOKABLE void registerPatient(const QString &name, const QString &phone,
                                     const QString &dob, const QString &category,
                                     int psychologistId);
signals:
    void stateChanged();
    void dataChanged();
    void operationCompleted(const QString &operation);
private:
    using Callback = std::function<void(const QJsonValue &)>;
    void request(const QByteArray &method, const QString &path, const QJsonObject &body,
                 Callback completed, bool quiet = false);
    void issue(const QString &message);
    void notify(const QString &message);
    void clearSession();
    void getOverview(int generation);
    void getSystem(int generation);
    void getVisits(int generation);
    void getMeta(int generation);
    void getRoster(int generation);
    void getAppointments(int generation);
    void getShift(int generation);
    bool canWrite() const;
    bool requireStaffRole() const;
    QNetworkAccessManager network_;
    QString origin_, pinnedId_, token_, role_, name_, error_, notice_, lastRefresh_;
    bool connected_ = false, working_ = false, rosterSupported_ = false;
    QVariantMap shift_, overview_, system_;
    QVariantList visits_, patients_, appointments_, roster_, psychologists_, rooms_;
    int sessionGeneration_ = 0, refreshGeneration_ = 0, patientGeneration_ = 0;
};
