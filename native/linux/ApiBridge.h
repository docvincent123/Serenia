#pragma once
#include <QObject>
#include <QJsonObject>
#include <QJsonValue>
#include <QNetworkAccessManager>
#include <QStringList>
#include <QUrl>
#include <QVariantMap>
#include <QVariantList>
#include <functional>

class ApiBridge final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap clientUpdate READ clientUpdate NOTIFY updatesChanged)
    Q_PROPERTY(QVariantList updateReleases READ updateReleases NOTIFY updatesChanged)
    Q_PROPERTY(QVariantList updateDevices READ updateDevices NOTIFY updatesChanged)
    Q_PROPERTY(bool updatesLoading READ updatesLoading NOTIFY updatesChanged)
    Q_PROPERTY(QString updatesError READ updatesError NOTIFY updatesChanged)
    Q_PROPERTY(QString licenseError READ licenseError NOTIFY licenseFeedbackChanged)
    Q_PROPERTY(QString licenseNotice READ licenseNotice NOTIFY licenseFeedbackChanged)
    Q_PROPERTY(bool publisherKeyToolsAvailable READ publisherKeyToolsAvailable NOTIFY stateChanged)
    Q_PROPERTY(QVariantMap consentPolicy READ consentPolicy NOTIFY configurationChanged)
    Q_PROPERTY(QVariantMap centerConfiguration READ centerConfiguration NOTIFY configurationChanged)
    Q_PROPERTY(QVariantMap licenseStatus READ licenseStatus NOTIFY configurationChanged)
    Q_PROPERTY(QVariantList centerModules READ centerModules NOTIFY configurationChanged)
    Q_PROPERTY(QString registrationReference READ registrationReference NOTIFY configurationChanged)
    Q_PROPERTY(QVariantList rehabilitationGoals READ rehabilitationGoals NOTIFY patientRecordChanged)
    Q_PROPERTY(QVariantList documentTemplates READ documentTemplates NOTIFY patientRecordChanged)
    Q_PROPERTY(QVariantMap detailRecord READ detailRecord NOTIFY detailChanged)
    Q_PROPERTY(QVariantList familyOptions READ familyOptions NOTIFY patientRecordChanged)
    Q_PROPERTY(QVariantList workspaceRows READ workspaceRows NOTIFY workspaceChanged)
    Q_PROPERTY(QVariantMap workspaceDetails READ workspaceDetails NOTIFY workspaceChanged)
    Q_PROPERTY(QVariantMap patientRecord READ patientRecord NOTIFY patientRecordChanged)
    Q_PROPERTY(QVariantList patientVisits READ patientVisits NOTIFY patientRecordChanged)
    Q_PROPERTY(int patientVisitsTotal READ patientVisitsTotal NOTIFY patientRecordChanged)
    Q_PROPERTY(int patientVisitsPage READ patientVisitsPage NOTIFY patientRecordChanged)
    Q_PROPERTY(QString patientVisitsPeriod READ patientVisitsPeriod NOTIFY patientRecordChanged)
    Q_PROPERTY(bool patientVisitsLoading READ patientVisitsLoading NOTIFY patientRecordChanged)
    Q_PROPERTY(QString patientVisitsError READ patientVisitsError NOTIFY patientRecordChanged)
    Q_PROPERTY(bool workspaceLoading READ workspaceLoading NOTIFY workspaceChanged)
    Q_PROPERTY(QString workspaceError READ workspaceError NOTIFY workspaceChanged)
    Q_PROPERTY(bool adminEdition READ adminEdition CONSTANT)
    Q_PROPERTY(QVariantList adminRows READ adminRows NOTIFY dataChanged)
    Q_PROPERTY(QVariantList serviceChoices READ serviceChoices NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap adminDetails READ adminDetails NOTIFY dataChanged)
    Q_PROPERTY(QStringList availableSlots READ availableSlots NOTIFY slotsChanged)
    Q_PROPERTY(bool databaseWorking READ databaseWorking NOTIFY stateChanged)
    Q_PROPERTY(bool loadingSlots READ loadingSlots NOTIFY slotsChanged)
    Q_PROPERTY(QString slotError READ slotError NOTIFY slotsChanged)
    Q_PROPERTY(QVariantList dischargeRows READ dischargeRows NOTIFY dataChanged)
    Q_PROPERTY(QString serverUrl READ serverUrl NOTIFY stateChanged)
    Q_PROPERTY(QString displayName READ displayName NOTIFY stateChanged)
    Q_PROPERTY(QString role READ role NOTIFY stateChanged)
    Q_PROPERTY(QStringList blockedModules READ blockedModules NOTIFY dataChanged)
    Q_PROPERTY(QString error READ error NOTIFY stateChanged)
    Q_PROPERTY(QString notice READ notice NOTIFY stateChanged)
    Q_PROPERTY(QString lastRefresh READ lastRefresh NOTIFY stateChanged)
    Q_PROPERTY(bool authenticated READ authenticated NOTIFY stateChanged)
    Q_PROPERTY(bool online READ online NOTIFY stateChanged)
    Q_PROPERTY(bool connected READ connected NOTIFY stateChanged)
    Q_PROPERTY(bool working READ working NOTIFY stateChanged)
    Q_PROPERTY(bool rosterSupported READ rosterSupported NOTIFY dataChanged)
    Q_PROPERTY(bool rosterConfigured READ rosterConfigured NOTIFY dataChanged)
    Q_PROPERTY(QVariantList bookingPsychologists READ bookingPsychologists NOTIFY bookingOptionsChanged)
    Q_PROPERTY(QVariantMap system READ system NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap shift READ shift NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap overview READ overview NOTIFY dataChanged)
    Q_PROPERTY(QVariantList visits READ visits NOTIFY dataChanged)
    Q_PROPERTY(QVariantList patients READ patients NOTIFY dataChanged)
    Q_PROPERTY(int patientPage READ patientPage NOTIFY dataChanged)
    Q_PROPERTY(int patientTotal READ patientTotal NOTIFY dataChanged)
    Q_PROPERTY(bool patientsLoading READ patientsLoading NOTIFY dataChanged)
    Q_PROPERTY(QVariantList appointments READ appointments NOTIFY dataChanged)
    Q_PROPERTY(QVariantList roster READ roster NOTIFY dataChanged)
    Q_PROPERTY(QVariantList psychologists READ psychologists NOTIFY bookingOptionsChanged)
    Q_PROPERTY(QVariantList rooms READ rooms NOTIFY bookingOptionsChanged)
public:
    QVariantMap clientUpdate() const { return clientUpdate_; }
    Q_INVOKABLE void checkClientUpdate();
    Q_INVOKABLE void downloadClientUpdate(const QUrl &file);
    QVariantList updateReleases() const { return updateReleases_; }
    QVariantList updateDevices() const { return updateDevices_; }
    bool updatesLoading() const { return updatesLoading_; }
    QString updatesError() const { return updatesError_; }
    Q_INVOKABLE void loadUpdates();
    Q_INVOKABLE void publishUpdate(const QUrl &file, const QString &platform, const QString &version,
                                  int build, const QString &notes, const QString &pilotIds);
    explicit ApiBridge(bool adminEdition = false, QObject *parent = nullptr);
    QString licenseError() const { return licenseError_; }
    QString licenseNotice() const { return licenseNotice_; }
    bool publisherKeyToolsAvailable() const;
    Q_INVOKABLE void clearLicenseFeedback();
    Q_INVOKABLE QVariantMap publisherKeyInfo(const QUrl &file);
    Q_INVOKABLE void installPublisherKey(const QUrl &file, const QString &fingerprint);
    QVariantMap consentPolicy() const { return consentPolicy_; }
    QVariantMap centerConfiguration() const { return centerConfiguration_; }
    QVariantMap licenseStatus() const { return licenseStatus_; }
    QVariantList centerModules() const { return centerModules_; }
    QString registrationReference() const { return registrationReference_; }
    Q_INVOKABLE void loadCenterConfiguration();
    Q_INVOKABLE void exportCenterRequest(const QUrl &file);
    Q_INVOKABLE void importLicense(const QUrl &file);
    Q_INVOKABLE void activateLicenseText(const QString &signedJson);
    Q_INVOKABLE void exportBlankForm(const QUrl &file, const QString &formId);
    Q_INVOKABLE void saveCenterModules(const QVariantList &enabled);
    Q_INVOKABLE void saveConsentPolicy(const QVariantMap &policy);
    Q_INVOKABLE void openPdf(const QUrl &file);
    Q_INVOKABLE bool printRegistration(const QUrl &file, const QVariantMap &fields);
    Q_INVOKABLE void registerWithConsents(const QVariantMap &fields, const QVariantList &consents, bool bookAfter);
    Q_INVOKABLE void exportPatientCard(const QUrl &file, bool clinical);
    QVariantList rehabilitationGoals() const { return rehabilitationGoals_; }
    QVariantList documentTemplates() const { return documentTemplates_; }
    Q_INVOKABLE void exportDischarge(const QUrl &file, int id);
    QVariantMap detailRecord() const { return detailRecord_; }
    Q_INVOKABLE void openDetail(const QString &kind, int id);
    Q_INVOKABLE void saveDocument(const QVariantMap &fields, const QUrl &scanFile);
    Q_INVOKABLE void changePassword(const QString &current, const QString &next);
    QVariantList familyOptions() const { return familyOptions_; }
    QVariantList workspaceRows() const { return workspaceRows_; }
    QVariantMap workspaceDetails() const { return workspaceDetails_; }
    QVariantMap patientRecord() const { return patientRecord_; }
    QVariantList patientVisits() const { return patientVisits_; }
    int patientVisitsTotal() const { return patientVisitsTotal_; }
    int patientVisitsPage() const { return patientVisitsPage_; }
    QString patientVisitsPeriod() const { return patientVisitsPeriod_; }
    bool patientVisitsLoading() const { return patientVisitsLoading_; }
    QString patientVisitsError() const { return patientVisitsError_; }
    bool workspaceLoading() const { return workspaceLoading_; }
    QString workspaceError() const { return workspaceError_; }
    Q_INVOKABLE bool workspaceAllowed(const QString &section) const;
    Q_INVOKABLE void loadWorkspace(const QString &section, const QString &query = QString(), const QString &from = QString(), const QString &to = QString());
    Q_INVOKABLE void workspaceAction(const QString &section, const QString &action, int id, const QVariantMap &fields);
    Q_INVOKABLE void openPatient(int id);
    Q_INVOKABLE void loadPatientVisits(const QString &period, int page = 1);
    Q_INVOKABLE void exportAppointmentTicket(const QUrl &file);
    Q_INVOKABLE void updatePatientReferral(int referralId, const QString &status);
    Q_INVOKABLE void closePatient();
    bool adminEdition() const { return adminEdition_; }
    QVariantList dischargeRows() const { return dischargeRows_; }
    QVariantList adminRows() const { return adminRows_; }
    QVariantList serviceChoices() const { return serviceChoices_; }
    QVariantMap adminDetails() const { return adminDetails_; }
    QStringList availableSlots() const { return slots_; }
    bool databaseWorking() const { return databaseWorking_; }
    bool loadingSlots() const { return loadingSlots_; }
    QString slotError() const { return slotError_; }
    QString serverUrl() const { return origin_; }
    QString displayName() const { return name_; }
    QString role() const { return role_; }
    QStringList blockedModules() const { return blockedModules_; }
    QString error() const { return error_; }
    QString notice() const { return notice_; }
    QString lastRefresh() const { return lastRefresh_; }
    bool authenticated() const { return !token_.isEmpty() && !role_.isEmpty(); }
    bool online() const { return online_; }
    bool connected() const { return connected_; }
    bool working() const { return working_; }
    bool rosterSupported() const { return rosterSupported_; }
    bool rosterConfigured() const { return rosterConfigured_; }
    QVariantList bookingPsychologists() const;
    QVariantMap system() const { return system_; }
    QVariantMap shift() const { return shift_; }
    QVariantMap overview() const { return overview_; }
    QVariantList visits() const { return visits_; }
    QVariantList patients() const { return patients_; }
    int patientPage() const { return patientPage_; }
    int patientTotal() const { return patientTotal_; }
    bool patientsLoading() const { return patientsLoading_; }
    QVariantList appointments() const { return appointments_; }
    QVariantList roster() const { return roster_; }
    QVariantList psychologists() const { return psychologists_; }
    QVariantList rooms() const { return rooms_; }

    Q_INVOKABLE void loadAdminSection(const QString &section);
    Q_INVOKABLE void saveAdminEntry(const QString &section, int id, const QVariantMap &fields);
    Q_INVOKABLE void endSession(const QString &id);
    Q_INVOKABLE void endUserSessions(int userId);
    Q_INVOKABLE void saveModulePermissions(int userId, const QVariantList &blockedModules);
    Q_INVOKABLE bool localDatabaseTools() const;
    Q_INVOKABLE void databaseBackup();
    Q_INVOKABLE void databaseRestore(const QUrl &file, const QString &confirmation);
    Q_INVOKABLE void restoreLatestBackup(const QString &confirmation);
    Q_INVOKABLE void loadSlots(const QString &date, int psychologistId, int roomId, int duration, int excludedId);
    Q_INVOKABLE void setCalendarDate(const QString &date);
    Q_INVOKABLE int durationMinutes(const QString &start, const QString &end) const;
    Q_INVOKABLE void moveBooking(const QVariantMap &appointment, int roomId,
                                 const QString &date, const QString &start, const QString &end);
    Q_INVOKABLE void cancelBooking(int id, const QString &reason);
    Q_INVOKABLE void exportProfile(const QUrl &file, bool localOnly);
    Q_INVOKABLE QString endTime(const QString &start, int duration) const;
    Q_INVOKABLE void loadDischarges();
    Q_INVOKABLE void reviewDischarge(int id, int revision, bool approve, const QString &reason);
    Q_INVOKABLE void importProfile(const QUrl &file);
    Q_INVOKABLE void configureServer(const QString &url);
    Q_INVOKABLE void forgetServerBinding();
    Q_INVOKABLE void verifySavedServer();
    Q_INVOKABLE void login(const QString &login, const QString &password);
    Q_INVOKABLE void logout();
    Q_INVOKABLE void refresh();
    Q_INVOKABLE bool moduleEnabled(const QString &module) const;
    Q_INVOKABLE void checkServer();
    Q_INVOKABLE bool psychologistBookable(int id, const QString &date) const;
    Q_INVOKABLE void searchPatients(const QString &text);
    Q_INVOKABLE void loadPatientPage(int page);
    Q_INVOKABLE void markArrived(int appointmentId, int patientId);
    Q_INVOKABLE void setShift(bool open);
    Q_INVOKABLE void assignPsychologist(int id, bool onShift);
    Q_INVOKABLE void bookParticipants(const QVariantList &patientIds, int psychologistId, int roomId, const QString &date, const QString &start, const QString &end, const QString &kind);
    Q_INVOKABLE void book(int patientId, int psychologistId, int roomId,
                          const QString &date, const QString &start, const QString &end,
                          const QString &kind);
    Q_INVOKABLE void registerPatient(const QString &name, const QString &phone,
                                     const QString &dob, const QString &category,
                                     int psychologistId, bool bookAfter);
signals:
    void licenseFeedbackChanged();
    void updatesChanged();
    void configurationChanged();
    void detailChanged();
    void workspaceChanged();
    void patientRecordChanged();
    void stateChanged();
    void dataChanged();
    void slotsChanged();
    void bookingOptionsChanged();
    void operationCompleted(const QString &operation);
    void patientRegistered(const QVariantMap &patient, bool bookAfter);
private:
    QVariantMap clientUpdate_;
    QVariantList updateReleases_, updateDevices_;
    bool updatesLoading_ = false;
    QString updatesError_;
    int updatesGeneration_ = 0;
    QString licenseError_, licenseNotice_;
    void setLicenseFeedback(const QString &text, bool failed = false);
    using Callback = std::function<void(const QJsonValue &)>;
    void request(const QByteArray &method, const QString &path, const QJsonObject &body,
                 Callback completed, bool quiet = false,
                 std::function<void(const QString &)> failed = {});
    void issue(const QString &message);
    void notify(const QString &message);
    void clearSession();
    void finishRefreshRequest(int generation);
    void getOverview(int generation);
    void connectServer(const QString &value, const QString &expectedId);
    void saveBooking(QJsonObject booking, int id = 0);
    void runDatabaseTool(const QStringList &arguments);
    void getSystem(int generation);
    void getVisits(int generation);
    void getMeta(int generation);
    void getRoster(int generation);
    void getAppointments(int generation);
    void getShift(int generation);
    bool canWrite() const;
    bool requireStaffRole() const;
    QVariantMap consentPolicy_, centerConfiguration_, licenseStatus_, registrationSnapshot_;
    QVariantList centerModules_;
    QString registrationReference_;
    QVariantList workspaceRows_, familyOptions_, documentTemplates_, rehabilitationGoals_, patientVisits_;
    QVariantMap workspaceDetails_, patientRecord_, detailRecord_;
    int detailGeneration_ = 0;
    bool workspaceLoading_ = false;
    QString workspaceSection_, workspaceQuery_, workspaceFrom_, workspaceTo_, workspaceError_;
    int workspaceGeneration_ = 0, recordGeneration_ = 0, patientVisitGeneration_ = 0;
    int patientVisitsTotal_ = 0, patientVisitsPage_ = 1;
    QString patientVisitsPeriod_ = "upcoming", patientVisitsError_;
    bool patientVisitsLoading_ = false;
    QString mutationKey_;
    QJsonObject mutationBody_;
    QNetworkAccessManager network_;
    const bool adminEdition_;
    bool loadingSlots_ = false, databaseWorking_ = false, patientsLoading_ = false;
    int patientPage_ = 1, patientTotal_ = 0;
    QString patientQuery_;
    int slotsGeneration_ = 0, adminGeneration_ = 0;
    QStringList slots_;
    QString slotError_, adminSection_, bookingKey_;
    QJsonObject pendingBooking_;
    QVariantList adminRows_, dischargeRows_, serviceChoices_;
    QVariantMap adminDetails_;
    QString origin_, pinnedId_, token_, role_, name_, error_, notice_, lastRefresh_;
    bool online_ = false;
    bool connected_ = false, working_ = false, rosterSupported_ = false, rosterConfigured_ = false;
    QString rosterDate_, calendarDate_;
    int calendarGeneration_ = 0;
    QVariantMap shift_, overview_, system_;
    QStringList blockedModules_;
    QVariantList visits_, patients_, appointments_, roster_, psychologists_, rooms_;
    int refreshPending_ = 0;
    bool collectingRefresh_ = false, refreshQueued_ = false;
    int sessionGeneration_ = 0, refreshGeneration_ = 0, patientGeneration_ = 0;
};
