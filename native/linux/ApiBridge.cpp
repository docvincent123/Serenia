#include "ApiBridge.h"
#include "CarePdf.h"
#include <stdexcept>
#include <memory>
#include <QBuffer>
#include <QCryptographicHash>
#include <QImageReader>
#include <QImage>
#include <QPdfWriter>
#include <QPainter>
#include <QTextDocument>
#include <QDesktopServices>
#include <QDate>
#include <QDateTime>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QHostInfo>
#include <QProcess>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSettings>
#include <QSysInfo>
#include <QTime>
#include <QUrl>
#include <QUrlQuery>
#include <QUuid>

ApiBridge::ApiBridge(bool adminEdition, QObject *parent) : QObject(parent), adminEdition_(adminEdition) {
    QSettings settings;
    // Company rename must retain the center URL and pinned identity on upgrade.
    if (!settings.contains("server/url")) {
        // Preserve the pre-rename Qt application profile and the older QureMed profile.
        const QList<QPair<QString,QString>> oldProfiles{
            {QStringLiteral("LemvoriLab"),QStringLiteral("SOLVIA")},
            {QStringLiteral("QureMed"),QStringLiteral("SOLVIA")}
        };
        for (const auto &profile: oldProfiles) {
            QSettings legacy(profile.first,profile.second);
            if (!legacy.contains("server/url")) continue;
            settings.setValue("server/url",legacy.value("server/url"));
            settings.setValue("server/identity",legacy.value("server/identity"));
            settings.sync(); break;
        }
    }
    origin_ = settings.value("server/url", "https://localhost:8443").toString();
    pinnedId_ = settings.value("server/identity").toString();
}

void ApiBridge::issue(const QString &message) {
    working_ = false;
    error_ = message;
    notice_.clear();
    emit stateChanged();
}

void ApiBridge::notify(const QString &message) {
    error_.clear();
    notice_ = message;
    emit stateChanged();
}

void ApiBridge::clearSession() {
    ++updatesGeneration_; clientUpdate_.clear(); updateReleases_.clear(); updateDevices_.clear();
    updatesLoading_ = false; updatesError_.clear(); emit updatesChanged();
    consentPolicy_.clear(); centerConfiguration_.clear(); licenseStatus_.clear(); centerModules_.clear(); registrationSnapshot_.clear(); registrationReference_.clear(); emit configurationChanged();
    ++workspaceGeneration_; ++recordGeneration_; ++detailGeneration_;
    detailRecord_.clear(); emit detailChanged();
    workspaceRows_.clear(); familyOptions_.clear(); documentTemplates_.clear(); rehabilitationGoals_.clear(); workspaceDetails_.clear(); patientRecord_.clear();
    workspaceSection_.clear(); workspaceError_.clear(); workspaceLoading_ = false;
    mutationBody_ = {}; mutationKey_.clear();
    emit workspaceChanged(); emit patientRecordChanged();
    ++sessionGeneration_;
    ++refreshGeneration_;
    ++patientGeneration_;
    ++adminGeneration_;
    ++slotsGeneration_;
    ++calendarGeneration_;
    adminRows_.clear(); adminDetails_.clear(); adminSection_.clear(); dischargeRows_.clear(); serviceChoices_.clear();
    loadingSlots_ = false; slots_.clear(); slotError_.clear();
    pendingBooking_ = {}; bookingKey_.clear();
    emit slotsChanged();
    token_.clear();
    name_.clear();
    role_.clear();
    blockedModules_.clear();
    working_ = false;
    shift_.clear(); overview_.clear(); system_.clear(); visits_.clear();
    patients_.clear(); appointments_.clear(); roster_.clear();
    patientQuery_.clear(); patientPage_ = 1; patientTotal_ = 0; patientsLoading_ = false;
    psychologists_.clear(); rooms_.clear();
    rosterSupported_ = false;
    rosterConfigured_ = false;
    rosterDate_.clear();
    emit bookingOptionsChanged();
    emit stateChanged();
    emit dataChanged();
}

void ApiBridge::request(const QByteArray &method, const QString &path,
                        const QJsonObject &body, Callback completed, bool quiet,
                        std::function<void(const QString &)> failed) {
    if (!origin_.startsWith("https://")) {
        if (!quiet) issue("Спочатку підключіть HTTPS-сервер Lemvori Care.");
        return;
    }
    // All paths are application-owned. Only already encoded search terms are appended.
    QNetworkRequest req(QUrl(origin_ + path));
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setRawHeader("Accept", "application/json");
    req.setTransferTimeout(path == "/api/mobile-update" || path == "/api/desktop-updates" ? 120000 : 15000);
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::ManualRedirectPolicy);
    if (!token_.isEmpty())
        req.setRawHeader("Authorization", QByteArray("Bearer ") + token_.toUtf8());
    QNetworkReply *reply = nullptr;
    if (method == "GET") reply = network_.get(req);
    else if (method == "POST") reply = network_.post(req, QJsonDocument(body).toJson(QJsonDocument::Compact));
    else if (method == "PATCH") reply = network_.sendCustomRequest(
        req, "PATCH", QJsonDocument(body).toJson(QJsonDocument::Compact));
    else if (method == "DELETE") reply = network_.deleteResource(req);
    if (!reply) {
        if (!quiet) issue("Невідомий метод запиту.");
        return;
    }
    const int generation = sessionGeneration_;
    const bool ownsWork = method != "GET" || (path == "/api/me" && role_.isEmpty()) || (path == "/api/health" && !connected_);
    connect(reply, &QNetworkReply::finished, this,
            [this, reply, generation, path, quiet, ownsWork, completed = std::move(completed), failed = std::move(failed)]() mutable {
        const auto bytes = reply->readAll();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const auto networkError = reply->error();
        const QString networkDetails = reply->errorString();
        reply->deleteLater();
        if (generation != sessionGeneration_) return; // logout/server switch won the race
        const bool reachable = status > 0;
        if (online_ != reachable) { online_ = reachable; emit stateChanged(); }
        const auto reportFailure = [this, ownsWork](const QString &why) {
            if (ownsWork) issue(why);
            else { error_ = why; notice_.clear(); emit stateChanged(); }
        };
        QJsonParseError parse{};
        const auto document = QJsonDocument::fromJson(bytes, &parse);
        const QJsonValue value = document.isArray()
            ? QJsonValue(document.array()) : QJsonValue(document.object());
        if (networkError != QNetworkReply::NoError || status < 200 || status >= 300) {
            // Not every deployed server has the optional roster endpoint yet.
            if (status == 404 && path.startsWith("/api/shift-psychologists")) {
                completed(QJsonValue());
                return;
            }
            QString why = document.isObject()
                ? document.object().value("error").toString() : QString();
            if (why.isEmpty()) why = networkError == QNetworkReply::NoError
                ? QString("Помилка сервера HTTP %1").arg(status)
                : networkDetails;
            if (status == 401 && path != "/api/login") {
                clearSession();
                issue("Сеанс завершився. Увійдіть повторно.");
                return;
            }
            if (failed) failed(why);
            if (!quiet) reportFailure(why);
            return;
        }
        if (parse.error != QJsonParseError::NoError || (!document.isArray() && !document.isObject())) {
            const QString why = "Сервер повернув некоректну відповідь.";
            if (failed) failed(why);
            if (!quiet) reportFailure(why);
            return;
        }
        completed(value);
    });
}

void ApiBridge::configureServer(const QString &value) {
    if (authenticated() || working_) return;
    connectServer(value, {});
}

void ApiBridge::forgetServerBinding() {
    if (authenticated() || working_) return;
    // An explicit, UI-confirmed recovery action after replacing the server database.
    // Keep certificate verification enabled; never automatically trust a changed server ID.
    QSettings settings;
    settings.remove("server/identity");
    settings.sync();
    pinnedId_.clear();
    connected_ = false;
    notify("Попередню прив'язку скинуто. Перевірте сертифікат та підключіть центр знову.");
}

void ApiBridge::verifySavedServer() {
    if (authenticated() || working_ || connected_ || pinnedId_.isEmpty()) return;
    connectServer(origin_, pinnedId_);
}

void ApiBridge::importProfile(const QUrl &url) {
    if (authenticated() || working_) return;
    QFile file(url.toLocalFile());
    if (!file.open(QIODevice::ReadOnly) || file.size() > 65536)
        return issue("Не вдалося відкрити файл підключення центру.");
    const auto profile = QJsonDocument::fromJson(file.read(65537)).object();
    const int version = profile.value("version").toInt();
    const QString id = profile.value("server_id").toString();
    if (profile.value("format").toString() != "quremed.solvia.mobile" || (version != 1 && version != 2) ||
        ((version == 2 || !id.isEmpty()) && !QRegularExpression("^[0-9a-f]{64}$").match(id).hasMatch()))
        return issue("Некоректний файл підключення центру.");
    const QString address = profile.value("https_url").toString(profile.value("api_url").toString());
    connectServer(address, id);
}

void ApiBridge::connectServer(const QString &value, const QString &expectedId) {
    const QString input = value.trimmed();
    QUrl url(input, QUrl::StrictMode);
    const bool valid = url.isValid() && url.scheme() == "https" && !url.host().isEmpty()
        && url.userInfo().isEmpty() && (url.path().isEmpty() || url.path() == "/")
        && !url.hasQuery() && !url.hasFragment() && url.port(-1) <= 65535
        && url.port(-1) != 0 && !input.contains(QRegularExpression("[\\s\\x00-\\x1F]"));
    if (!valid) {
        issue("Вкажіть правильну HTTPS-адресу сервера, наприклад https://192.168.1.10:8443");
        return;
    }
    const QString normalized = QString("https://%1%2").arg(
        url.host().contains(':') ? "[" + url.host().toLower() + "]" : url.host().toLower(),
        url.port(-1) < 0 || url.port() == 443 ? "" : ":" + QString::number(url.port()));
    clearSession();
    origin_ = normalized;
    connected_ = false;
    working_ = true;
    error_.clear();
    notice_ = "Перевіряємо сервер та TLS-сертифікат…";
    emit stateChanged();
    QSettings settings;
    const QString storedId = origin_ == settings.value("server/url").toString()
        ? settings.value("server/identity").toString() : QString();
    request("GET", "/api/health", {}, [this, storedId, expectedId](const QJsonValue &json) {
        const auto health = json.toObject();
        const QString id = health.value("server_id").toString();
        if (!health.value("ok").toBool() || id.isEmpty()) {
            issue("Сервер не підтвердив свою ідентичність.");
            return;
        }
        if ((!storedId.isEmpty() && storedId != id) || (!expectedId.isEmpty() && expectedId != id)) {
            issue("Ідентифікатор сервера змінився. Не підключайтеся до невідомого центру.");
            return;
        }
        QSettings settings;
        settings.setValue("server/url", origin_);
        settings.setValue("server/identity", id);
        pinnedId_ = id;
        connected_ = true;
        working_ = false;
        notify("Сервер Lemvori Care підтверджено. Увійдіть до свого кабінету.");
    });
}

void ApiBridge::login(const QString &username, const QString &password) {
    if (authenticated() || working_) return;
    if (username.trimmed().isEmpty() || password.isEmpty()) {
        issue("Вкажіть логін та пароль.");
        return;
    }
    if (!connected_) {
        issue("Спочатку підтвердьте HTTPS-підключення до сервера.");
        return;
    }
    working_ = true;
    error_.clear();
    emit stateChanged();
    QJsonObject body{{"login",username.trimmed()}, {"password",password},
                     {"platform","Desktop"}, {"device_name", QSysInfo::prettyProductName()}};
    request("POST", "/api/login", body, [this](const QJsonValue &json) {
        const QString token = json.toObject().value("token").toString();
        if (token.isEmpty()) {
            issue("Сервер не повернув сеанс входу.");
            return;
        }
        token_ = token;
        request("GET", "/api/me", {}, [this](const QJsonValue &profile) {
            const auto data = profile.toObject();
            const QString accountRole = data.value("role").toString();
            if ((adminEdition_ && accountRole != "admin") ||
                (!adminEdition_ && accountRole != "reception" && accountRole != "director")) {
                logout();
                if (accountRole == "psychologist") issue("Для роботи психолога відкрийте Lemvori Care на Android.");
                else if (adminEdition_) issue("Lemvori Care Admin доступна лише адміністраторам.");
                else issue("Для облікового запису адміністратора відкрийте Lemvori Care Admin.");
                return;
            }
            role_ = accountRole;
            name_ = data.value("name").toString();
            working_ = false;
            notify("Вітаємо в Lemvori Care!");
            refresh();
        });
    });
}

void ApiBridge::logout() {
    if (!token_.isEmpty()) {
        // Forget the bearer locally before the asynchronous remote revocation.
        const QByteArray bearer = token_.toUtf8();
        QNetworkRequest req(QUrl(origin_ + "/api/logout"));
        req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        req.setRawHeader("Authorization", "Bearer " + bearer);
        req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
        req.setTransferTimeout(15000);
        auto *reply = network_.post(req, QByteArray("{}"));
        connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
    }
    clearSession();
    notify("Ви вийшли із системи.");
}

void ApiBridge::getShift(int generation) {
    request("GET", "/api/shift-day", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        shift_ = v.toObject().toVariantMap();
        emit dataChanged();
    }, true);
}
void ApiBridge::getOverview(int generation) {
    request("GET", role_ == "director" ? "/api/stats" : "/api/workday/home", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        overview_ = v.toObject().toVariantMap();
        lastRefresh_ = QTime::currentTime().toString("HH:mm:ss"); emit stateChanged();
        emit dataChanged();
    }, true);
}
void ApiBridge::getVisits(int generation) {
    request("GET", "/api/shift-workspace", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        visits_ = v.toArray().toVariantList();
        emit dataChanged();
    }, true);
}
void ApiBridge::getAppointments(int generation) {
    const QString day = calendarDate_.isEmpty() ? QDate::currentDate().toString(Qt::ISODate) : calendarDate_;
    request("GET", "/api/appointments?date=" + day, {}, [this,generation](const QJsonValue &v){
        if (generation != calendarGeneration_) return;
        appointments_ = v.toArray().toVariantList();
        emit dataChanged();
    }, true);
}
void ApiBridge::getMeta(int generation) {
    request("GET", "/api/meta", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        const auto value = v.toObject();
        const auto people = value.value("psychologists").toArray().toVariantList();
        const auto rooms = value.value("rooms").toArray().toVariantList();
        if (people == psychologists_ && rooms == rooms_) return;
        psychologists_ = people;
        rooms_ = rooms;
        emit bookingOptionsChanged();
    }, true);
}
void ApiBridge::getRoster(int generation) {
    request("GET", "/api/shift-psychologists", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        const auto previousBookingOptions = bookingPsychologists();
        rosterSupported_ = v.isObject();
        rosterConfigured_ = v.toObject().value("configured").toBool(false)
            && v.toObject().value("shift_open").toBool(false);
        rosterDate_ = v.toObject().value("date").toString();
        roster_ = v.toObject().value("psychologists").toArray().toVariantList();
        if (previousBookingOptions != bookingPsychologists()) emit bookingOptionsChanged();
        emit dataChanged();
    }, true);
}
void ApiBridge::getSystem(int generation) {
    request("GET", "/api/admin/system", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        system_ = v.toObject().toVariantMap();
        emit dataChanged();
    }, true);
}
void ApiBridge::checkServer() {
    request("GET","/api/health",{},[this](const QJsonValue &v){
        const auto health=v.toObject();
        if (!health.value("ok").toBool() || health.value("server_id").toString()!=pinnedId_) {
            issue("Сервер не підтвердив відомий ідентифікатор Lemvori Care.");
            return;
        }
        notify("HTTPS-з'єднання та сервер перевірено.");
    });
}
bool ApiBridge::moduleEnabled(const QString &module) const {
    return role_ == "admin" || !blockedModules_.contains(module);
}

void ApiBridge::refresh() {
    if (!authenticated()) return;
    const int generation = ++refreshGeneration_;
    if (role_ != "admin") {
        request("GET", "/api/my-module-permissions", {}, [this,generation](const QJsonValue &response) {
            if (generation != refreshGeneration_) return;
            QStringList next;
            for (const auto &item : response.toObject().value("blocked_modules").toArray()) {
                if (item.isString()) next.append(item.toString());
            }
            if (next != blockedModules_) {
                blockedModules_ = next;
                emit dataChanged();
            }
        }, true);
    }
    if (centerModules_.isEmpty()) loadCenterConfiguration();
    getShift(generation);
    getMeta(generation);
    if (role_ == "admin" || role_ == "reception") {
        getOverview(generation);
        getVisits(generation);
        getAppointments(++calendarGeneration_);
    } else {
        getOverview(generation);
    }
    getRoster(generation);
    if (role_ == "admin") getSystem(generation);
    emit stateChanged();
}
void ApiBridge::searchPatients(const QString &text) {
    if (!authenticated() || !canWrite()) return;
    patientQuery_ = text.trimmed();
    patientPage_ = 1;
    patientTotal_ = 0;
    loadPatientPage(1);
}

void ApiBridge::loadPatientPage(int page) {
    if (!authenticated() || !canWrite() || page < 1 ||
        (patientTotal_ > 0 && page > 1 && (page - 1) * 25 >= patientTotal_)) return;
    const int generation = ++patientGeneration_;
    patientsLoading_ = true;
    patients_.clear();
    emit dataChanged();
    const QString path = QString("/api/patient-directory?page=%1&page_size=25&q=").arg(page)
        + QString::fromUtf8(QUrl::toPercentEncoding(patientQuery_));
    request("GET", path, {}, [this,generation](const QJsonValue &v) {
        if (generation != patientGeneration_) return;
        const auto response = v.toObject();
        patients_ = response.value("items").toArray().toVariantList();
        patientPage_ = response.value("page").toInt(1);
        patientTotal_ = response.value("total").toInt(0);
        patientsLoading_ = false;
        emit dataChanged();
    }, true, [this,generation](const QString &reason) {
        if (generation != patientGeneration_) return;
        patientsLoading_ = false;
        issue("Не вдалося завантажити пацієнтів: " + reason);
        emit dataChanged();
    });
}
QVariantList ApiBridge::bookingPsychologists() const {
    if (!rosterSupported_ || !rosterConfigured_ ||
        rosterDate_ != QDate::currentDate().toString(Qt::ISODate))
        return psychologists_;
    QVariantList filtered;
    for (const auto &candidate : psychologists_) {
        const int id = candidate.toMap().value("id").toInt();
        for (const auto &entry : roster_) {
            const auto person = entry.toMap();
            if (person.value("id").toInt() == id && person.value("on_shift").toBool()) {
                filtered.append(candidate);
                break;
            }
        }
    }
    return filtered;
}
bool ApiBridge::psychologistBookable(int id, const QString &date) const {
    if (id<=0) return false;
    if (!rosterSupported_ || !rosterConfigured_ ||
        rosterDate_!=date || date!=QDate::currentDate().toString(Qt::ISODate))
        return true;
    for (const auto &item : roster_) {
        const auto p=item.toMap();
        if (p.value("id").toInt()==id && p.value("on_shift").toBool()) return true;
    }
    return false;
}
bool ApiBridge::canWrite() const { return role_ == "admin" || role_ == "reception"; }
bool ApiBridge::requireStaffRole() const {
    if (canWrite()) return true;
    const_cast<ApiBridge*>(this)->issue("Недостатньо прав для цієї операції.");
    return false;
}
void ApiBridge::markArrived(int appointmentId,int patientId) {
    if (!requireStaffRole()) return;
    if (appointmentId <= 0 || patientId <= 0) return issue("Некоректний номер прийому.");
    request("POST", QString("/api/appointments/%1/arrival").arg(appointmentId),
            {{"patient_id",patientId}}, [this](const QJsonValue&){
        notify("Прибуття зафіксовано.");
        emit operationCompleted("arrival");
        refresh();
    });
}
void ApiBridge::setShift(bool open) {
    if (role_ != "admin") return issue("Зміною керує лише адміністратор.");
    request("POST","/api/shift-day",{{"action",open?"open":"close"}},
            [this](const QJsonValue &){
        notify("Стан зміни оновлено.");
        emit operationCompleted("shift");
        refresh();
    });
}
void ApiBridge::assignPsychologist(int id,bool onShift) {
    if (role_ != "admin") return issue("Склад зміни затверджує лише адміністратор.");
    if (!rosterSupported_) return issue("Сервер ще не підтримує склад зміни. Потрібне оновлення сервера.");
    request("POST","/api/shift-psychologists",
            {{"psychologist_id",id},{"on_shift",onShift}},
            [this](const QJsonValue &){
        notify("Склад зміни оновлено.");
        emit operationCompleted("roster");
        refresh();
    });
}
void ApiBridge::setCalendarDate(const QString &date) {
    if (!canWrite() || !QDate::fromString(date, Qt::ISODate).isValid() || calendarDate_ == date) return;
    calendarDate_ = date;
    appointments_.clear();
    emit dataChanged();
    getAppointments(++calendarGeneration_);
}

void ApiBridge::loadSlots(const QString &date, int psychologistId, int roomId, int duration, int excludedId) {
    const int generation = ++slotsGeneration_;
    slots_.clear();
    slotError_.clear();
    loadingSlots_ = canWrite() && QDate::fromString(date, Qt::ISODate).isValid()
        && psychologistId > 0 && roomId > 0 && duration >= 15 && duration <= 240;
    emit slotsChanged();
    if (!loadingSlots_) return;
    QString path = QString("/api/slots?date=%1&psychologist_id=%2&room_id=%3&duration_minutes=%4")
        .arg(date).arg(psychologistId).arg(roomId).arg(duration);
    if (excludedId > 0) path += "&exclude_appointment_id=" + QString::number(excludedId);
    request("GET", path, {}, [this, generation](const QJsonValue &result) {
        if (generation != slotsGeneration_) return;
        for (const auto &slot : result.toArray()) slots_.append(slot.toString());
        loadingSlots_ = false;
        emit slotsChanged();
    }, true, [this, generation](const QString &reason) {
        if (generation != slotsGeneration_) return;
        loadingSlots_ = false;
        slotError_ = reason;
        emit slotsChanged();
    });
}

QString ApiBridge::endTime(const QString &start, int duration) const {
    const auto time = QTime::fromString(start, "HH:mm");
    return time.isValid() ? time.addSecs(duration * 60).toString("HH:mm") : QString();
}

int ApiBridge::durationMinutes(const QString &start, const QString &end) const {
    return QDateTime::fromString(start, Qt::ISODate).secsTo(QDateTime::fromString(end, Qt::ISODate)) / 60;
}

void ApiBridge::book(int patientId, int psychologistId, int roomId, const QString &date,
                     const QString &start, const QString &end, const QString &kind) {
    if (!requireStaffRole() || working_) return;
    if (!psychologistBookable(psychologistId, date))
        return issue("Психолог не включений до поточної зміни.");
    if (patientId <= 0 || psychologistId <= 0 || roomId <= 0 ||
        !QDate::fromString(date, Qt::ISODate).isValid() || start >= end)
        return issue("Оберіть пацієнта, психолога, кабінет і коректний час.");
    saveBooking({{"patient_ids", QJsonArray{patientId}},
        {"psychologist_id", psychologistId}, {"room_id", roomId}, {"kind", kind},
        {"status", "scheduled"}, {"start", date + "T" + start}, {"end", date + "T" + end}});
}

void ApiBridge::bookParticipants(const QVariantList &patientIds, int psychologistId, int roomId,
                                 const QString &date, const QString &start, const QString &end, const QString &kind) {
    if (!requireStaffRole() || working_) return;
    if (!psychologistBookable(psychologistId, date) || patientIds.isEmpty() || patientIds.size() > 30 ||
        roomId <= 0 || start >= end || !QDate::fromString(date, Qt::ISODate).isValid())
        return issue("Оберіть учасників, психолога, кабінет і час.");
    if (!QStringList{"individual","child","crisis","group","family"}.contains(kind) ||
        (patientIds.size() > 1 && kind != "group" && kind != "family"))
        return issue("Для кількох учасників оберіть сімейний або груповий прийом.");
    QJsonArray ids;
    for (const auto &value : patientIds) {
        const int id = value.toInt();
        if (id <= 0 || ids.contains(id)) return issue("Перевірте список учасників.");
        ids.append(id);
    }
    saveBooking({{"patient_ids", ids}, {"psychologist_id", psychologistId}, {"room_id", roomId},
        {"kind",kind}, {"status","scheduled"}, {"start",date+"T"+start}, {"end",date+"T"+end}});
}

void ApiBridge::moveBooking(const QVariantMap &appointment, int roomId,
                            const QString &date, const QString &start, const QString &end) {
    if (!requireStaffRole() || working_) return;
    const int id = appointment.value("id").toInt();
    const int psychologistId = appointment.value("psychologist_id").toInt();
    const QString status = appointment.value("status").toString();
    if (id <= 0 || roomId <= 0 || start >= end || !QDate::fromString(date, Qt::ISODate).isValid() ||
        !QStringList{"scheduled", "confirmed", "draft"}.contains(status) || !psychologistBookable(psychologistId, date))
        return issue("Цей прийом не можна перенести на вибрану дату.");
    QJsonArray patientIds;
    for (const auto &patient : appointment.value("patients").toList()) {
        const auto attendee = patient.toMap();
        if (!attendee.value("arrived_at").toString().isEmpty() ||
            !attendee.value("started_at").toString().isEmpty() ||
            !attendee.value("completed_at").toString().isEmpty() ||
            !attendee.value("visit_status").toString().isEmpty())
            return issue("Прийом уже має зафіксований статус учасника.");
        patientIds.append(attendee.value("id").toInt());
    }
    if (patientIds.isEmpty()) return issue("У прийомі немає учасників.");
    saveBooking({{"patient_ids", patientIds}, {"psychologist_id", psychologistId},
        {"room_id", roomId}, {"kind", appointment.value("kind").toString()}, {"status", status},
        {"note", appointment.value("note").toString()}, {"start", date + "T" + start}, {"end", date + "T" + end}}, id);
}

void ApiBridge::saveBooking(QJsonObject booking, int id) {
    if (id == 0) {
        if (booking != pendingBooking_) {
            pendingBooking_ = booking;
            bookingKey_ = QUuid::createUuid().toString(QUuid::WithoutBraces);
        }
        booking.insert("client_key", bookingKey_);
    }
    working_ = true;
    error_.clear();
    emit stateChanged();
    const QString path = id > 0 ? "/api/appointments/" + QString::number(id) : "/api/appointments";
    request(id > 0 ? "PATCH" : "POST", path, booking, [this, id](const QJsonValue &) {
        if (id == 0) { pendingBooking_ = {}; bookingKey_.clear(); }
        working_ = false;
        notify(id > 0 ? "Прийом перенесено." : "Пацієнта записано на прийом.");
        emit operationCompleted("booking");
        refresh();
    });
}
void ApiBridge::registerPatient(const QString &name,const QString &phone,
                                const QString &dob,const QString &category,int psychologistId, bool bookAfter) {
    if (!requireStaffRole() || working_) return;
    if (name.trimmed().isEmpty()||phone.trimmed().isEmpty()||psychologistId<=0)
        return issue("Заповніть обов'язкові поля.");
    working_ = true;
    error_.clear();
    emit stateChanged();
    request("POST","/api/patients",{{"name",name.trimmed()},{"phone",phone.trimmed()},
        {"dob",dob},{"category",category},{"psychologist_id",psychologistId}},
        [this, name, psychologistId, bookAfter](const QJsonValue &result){
        working_ = false;
        notify("Картку пацієнта створено.");
        searchPatients(QString());
        emit operationCompleted("patient");
        emit patientRegistered({{"id", result.toObject().value("id").toInt()},
            {"name", name.trimmed()}, {"psychologist_id", psychologistId}}, bookAfter);
        refresh();
    });
}

namespace {
const QHash<QString, QString> adminEndpoints{
    {"templates", "/api/document-templates"}, {"tv-displays", "/api/admin/tv-displays"}, {"team", "/api/users"}, {"rooms", "/api/rooms"}, {"services", "/api/services"},
    {"access", "/api/reception-access"}, {"workflow", "/api/settings/workflow"},
    {"center", "/api/settings/center"}, {"sessions", "/api/admin/sessions"}, {"audit", "/api/audit"},
    {"permissions", "/api/admin/module-permissions"}
};
}

void ApiBridge::loadAdminSection(const QString &section) {
    if (!adminEdition_ || role_ != "admin" || !adminEndpoints.contains(section)) return;
    const int generation = ++adminGeneration_;
    if (adminSection_ != section) {
        adminSection_ = section;
        adminRows_.clear(); adminDetails_.clear();
        emit dataChanged();
    }
    if (section == "team") {
        request("GET", "/api/services", {}, [this, generation](const QJsonValue &result) {
            if (generation != adminGeneration_) return;
            serviceChoices_ = result.toArray().toVariantList();
            emit dataChanged();
        }, true);
    }
    request("GET", adminEndpoints.value(section), {}, [this, generation](const QJsonValue &result) {
        if (generation != adminGeneration_) return;
        adminRows_ = result.toArray().toVariantList();
        adminDetails_ = result.toObject().toVariantMap();
        emit dataChanged();
    });
}

void ApiBridge::saveAdminEntry(const QString &section, int id, const QVariantMap &fields) {
    if (!adminEdition_ || role_ != "admin" || working_ || section != adminSection_) return;
    const bool item = section == "team" || section == "rooms" || section == "services" || section == "tv-displays" || section == "templates";
    if (!item && section != "access" && section != "workflow" && section != "center") return;
    QString path = adminEndpoints.value(section);
    const bool creates = section == "access" || (item && id == 0);
    if (item && id > 0) path += "/" + QString::number(id);
    working_ = true;
    error_.clear();
    emit stateChanged();
    request(creates ? "POST" : "PATCH", path, QJsonObject::fromVariantMap(fields),
            [this, section](const QJsonValue &) {
        working_ = false;
        notify("Зміни збережено.");
        emit operationCompleted("admin");
        loadAdminSection(section);
        if (section == "center") loadCenterConfiguration();
        refresh();
    });
}

void ApiBridge::saveModulePermissions(int userId, const QVariantList &blockedModules) {
    if (!adminEdition_ || role_ != "admin" || working_ || userId <= 0) return;
    working_ = true;
    error_.clear();
    emit stateChanged();
    request("POST", "/api/admin/module-permissions",
            {{"user_id",userId}, {"blocked_modules",QJsonArray::fromVariantList(blockedModules)}},
            [this](const QJsonValue &) {
        working_ = false;
        notify("Права працівника оновлено. Обмеження перевіряються сервером.");
        emit operationCompleted("permissions");
        loadAdminSection("permissions");
    });
}

void ApiBridge::endSession(const QString &id) {
    if (!adminEdition_ || role_ != "admin" || working_ ||
        !QRegularExpression("^[0-9a-f]{64}$").match(id).hasMatch()) return;
    working_ = true;
    emit stateChanged();
    request("DELETE", "/api/admin/sessions/" + id, {}, [this](const QJsonValue &) {
        working_ = false;
        notify("Сеанс завершено.");
        loadAdminSection("sessions");
    });
}

void ApiBridge::endUserSessions(int userId) {
    if (!adminEdition_ || role_ != "admin" || working_ || userId <= 0) return;
    working_ = true;
    error_.clear();
    emit stateChanged();
    request("DELETE", QString("/api/users/%1/sessions").arg(userId), {}, [this](const QJsonValue &) {
        working_ = false;
        notify("Сеанси працівника завершено.");
        loadAdminSection("team");
    });
}

bool ApiBridge::localDatabaseTools() const {
    const QString host = QUrl(origin_).host();
    return adminEdition_ && (host == "localhost" || host == "127.0.0.1" || host == "::1")
        && QFileInfo("/usr/local/sbin/lemvori-carectl").isExecutable();
}

void ApiBridge::runDatabaseTool(const QStringList &arguments) {
    if (role_ != "admin" || !localDatabaseTools() || databaseWorking_) return;
    databaseWorking_ = true;
    working_ = true;
    notify("Виконуємо операцію PostgreSQL…");
    auto *process = new QProcess(this);
    const int generation = sessionGeneration_;
    connect(process, &QProcess::errorOccurred, this, [this, process, generation](QProcess::ProcessError error) {
        if (error != QProcess::FailedToStart) return;
        databaseWorking_ = false;
        if (generation == sessionGeneration_) issue("Не вдалося запустити локальне керування базою.");
        process->deleteLater();
    });
    connect(process, &QProcess::finished, this, [this, process, arguments, generation](int code, QProcess::ExitStatus status) {
        databaseWorking_ = false;
        process->deleteLater();
        if (generation != sessionGeneration_) return;
        working_ = false;
        if (status != QProcess::NormalExit || code != 0) {
            issue(QString("Операцію PostgreSQL не завершено (код %1). Перевірте lemvori-carectl.").arg(code));
        } else if (arguments.first() == "restore" || arguments.first() == "restore-latest") {
            clearSession();
            notify("Резервну копію перевірено і базу відновлено. Повторно ввійдіть до центру.");
        } else {
            notify("Резервну копію збережено в каталозі /var/backups/lemvori-care/.");
            refresh();
        }
    });
    process->start("/usr/bin/pkexec", QStringList{"/usr/local/sbin/lemvori-carectl"} + arguments);
}

void ApiBridge::databaseBackup() {
    runDatabaseTool({"backup"});
}

void ApiBridge::databaseRestore(const QUrl &file, const QString &confirmation) {
    const QString path = file.toLocalFile();
    if (confirmation.trimmed() != "ВІДНОВИТИ" || !path.startsWith("/var/backups/lemvori-care/lemvori-core-") || !path.endsWith(".dump"))
        return issue("Оберіть файл .dump і введіть ВІДНОВИТИ.");
    if (!adminEdition_ || role_ != "admin" || !localDatabaseTools() || working_)
        return issue("Відновлення дозволене тільки адміністратору на серверному ПК.");
    runDatabaseTool({"restore", path, confirmation});

}

void ApiBridge::restoreLatestBackup(const QString &confirmation) {
    if (confirmation.trimmed() != "ВІДНОВИТИ")
        return issue("Для відновлення введіть ВІДНОВИТИ.");
    if (!adminEdition_ || role_!="admin" || !localDatabaseTools() || working_)
        return issue("Відновлення доступне адміністратору на серверному ПК.");
    runDatabaseTool({"restore-latest", confirmation});
}

void ApiBridge::loadDischarges() {
    if (role_ != "director" && role_ != "admin") return;
    request("GET", "/api/discharges", {}, [this](const QJsonValue &result) {
        dischargeRows_ = result.toArray().toVariantList();
        emit dataChanged();
    });
}

void ApiBridge::reviewDischarge(int id, int revision, bool approve, const QString &reason) {
    if ((role_ != "director" && role_ != "admin") || working_ || id <= 0 || revision <= 0) return;
    if (!approve && reason.trimmed().isEmpty()) return issue("Вкажіть причину повернення.");
    working_ = true;
    error_.clear();
    emit stateChanged();
    request("POST", QString("/api/discharges/%1/workflow").arg(id),
            {{"action", approve ? "approve" : "return"}, {"revision", revision}, {"reason", reason.trimmed()}},
            [this](const QJsonValue &) {
        working_ = false;
        notify("Статус виписки оновлено.");
        emit operationCompleted("discharge");
        loadDischarges();
    });
}

void ApiBridge::cancelBooking(int id, const QString &reason) {
    if (!requireStaffRole() || id <= 0 || working_) return;
    if (reason.trimmed().isEmpty()) return issue("Вкажіть причину скасування.");
    working_ = true;
    error_.clear();
    emit stateChanged();
    request("PATCH", "/api/appointments/" + QString::number(id),
            {{"status", "cancelled"}, {"cancellation_reason", reason.trimmed()}}, [this](const QJsonValue &) {
        working_ = false;
        notify("Прийом скасовано.");
        emit operationCompleted("cancel");
        refresh();
    });
}

void ApiBridge::exportProfile(const QUrl &file, bool localOnly) {
    if (!adminEdition_ || role_ != "admin" || !file.isLocalFile()) return;
    const QString path = file.toLocalFile();
    request("GET", localOnly ? "/api/mobile-config?lan=1" : "/api/mobile-config?stable=1",
            {}, [this, path](const QJsonValue &result) {
        const auto profile = result.toObject();
        if (profile.value("format").toString() != "quremed.solvia.mobile" ||
            profile.value("api_url").toString().isEmpty())
            return issue("Сервер не надав файл підключення.");
        const QByteArray bytes = QJsonDocument(profile).toJson();
        QSaveFile output(path);
        if (!output.open(QIODevice::WriteOnly) || output.write(bytes) != bytes.size() || !output.commit())
            return issue("Не вдалося зберегти файл підключення.");
        notify("Файл підключення збережено.");
    });
}

namespace {
const QHash<QString, QString> workspaceEndpoints{
    {"handover", "/api/operations/handover"}, {"waiting", "/api/waiting-list"},
    {"families", "/api/families"}, {"archive", "/api/patient-directory"},
    {"supervisions", "/api/supervisions"}, {"messages", "/api/staff/messages"},
    {"recipients", "/api/staff/recipients"}, {"reports", "/api/shift-reports"},
    {"workload", "/api/stats"}, {"tv", "/api/tv/candidates"},
    {"devices", "/api/admin/devices"}, {"recovery", "/api/admin/recovery"}
};
}

bool ApiBridge::workspaceAllowed(const QString &section) const {
    if (!authenticated()) return false;
    if (role_ == "admin" && adminEdition_) return workspaceEndpoints.contains(section) || section == "patient";
    const QHash<QString,QString> modules{{"handover","appointments"},{"waiting","appointments"},{"tv","appointments"},
        {"families","patients"},{"archive","patients"},{"patient","patients"},{"supervisions","reports"},
        {"workload","reports"},{"reports","reports"},{"messages","messages"},{"recipients","messages"}};
    if (!moduleEnabled(modules.value(section))) return false;
    // Patient registration remains accessible when optional clinical, document or rehab modules are disabled.
    // The server enforces role-based access and redacts private clinical content for reception staff.
    if (role_ == "reception" && !adminEdition_)
        return QStringList{"handover", "waiting", "families", "archive", "tv", "patient"}.contains(section);
    if (role_ == "director" && !adminEdition_)
        return QStringList{"supervisions", "messages", "recipients", "workload"}.contains(section);
    return false;
}

void ApiBridge::loadWorkspace(const QString &section, const QString &query, const QString &from, const QString &to) {
    if (!workspaceAllowed(section) || !workspaceEndpoints.contains(section)) return;
    const int generation = ++workspaceGeneration_;
    if (workspaceSection_ != section || workspaceQuery_ != query || workspaceFrom_ != from || workspaceTo_ != to) {
        workspaceRows_.clear(); workspaceDetails_.clear();
    }
    workspaceSection_ = section; workspaceQuery_ = query; workspaceFrom_ = from; workspaceTo_ = to;
    workspaceLoading_ = true; workspaceError_.clear(); emit workspaceChanged();
    QUrlQuery params;
    if (section == "archive") {
        // The date-from argument is unused for archive; Qt passes the archive page here.
        bool validPage = false;
        const int archivePage = from.toInt(&validPage);
        params.addQueryItem("status", "archived");
        params.addQueryItem("q", query);
        params.addQueryItem("page_size", "100");
        params.addQueryItem("page", QString::number(validPage && archivePage > 0 ? archivePage : 1));
    }
    if (section == "workload" || section == "reports") {
        const QString start = from.isEmpty() ? QDate::currentDate().toString("yyyy-MM-01") : from;
        const QString end = to.isEmpty() ? QDate::currentDate().toString(Qt::ISODate) : to;
        if (!QDate::fromString(start, Qt::ISODate).isValid() || !QDate::fromString(end, Qt::ISODate).isValid() || start > end) {
            workspaceLoading_ = false; workspaceError_ = "Перевірте період звіту."; emit workspaceChanged(); return;
        }
        params.addQueryItem("from", start); params.addQueryItem("to", end);
    }
    const QString path = workspaceEndpoints.value(section) + (params.isEmpty() ? "" : "?" + params.toString(QUrl::FullyEncoded));
    request("GET", path, {}, [this, generation, section](const QJsonValue &result) {
        if (generation != workspaceGeneration_) return;
        workspaceDetails_ = result.toObject().toVariantMap();
        workspaceRows_ = section == "archive" ? result.toObject().value("items").toArray().toVariantList()
            : section == "workload" ? result.toObject().value("load").toArray().toVariantList() : result.toArray().toVariantList();
        workspaceLoading_ = false; emit workspaceChanged();
    }, true, [this, generation](const QString &reason) {
        if (generation != workspaceGeneration_) return;
        workspaceLoading_ = false; workspaceError_ = reason;
        workspaceRows_.clear(); workspaceDetails_.clear(); emit workspaceChanged();
    });
}

void ApiBridge::openPatient(int id) {
    if (!workspaceAllowed("patient") || id <= 0) return;
    const int generation = ++recordGeneration_;
    patientRecord_.clear(); familyOptions_.clear(); rehabilitationGoals_.clear();
    ++patientVisitGeneration_; patientVisits_.clear(); patientVisitsTotal_=0;
    patientVisitsPage_=1; patientVisitsPeriod_="upcoming"; patientVisitsError_.clear(); patientVisitsLoading_=false;
    emit patientRecordChanged();
    rehabilitationGoals_.clear();
    if (role_ == "admin" && moduleEnabled("rehabilitation")) request("GET", "/api/patients/" + QString::number(id) + "/rehab-goals", {}, [this, generation](const QJsonValue &value) {
        if (generation != recordGeneration_) return;
        rehabilitationGoals_ = value.toArray().toVariantList(); emit patientRecordChanged();
    });
    if (moduleEnabled("documents")) request("GET", "/api/document-templates", {}, [this, generation](const QJsonValue &value) {
        if (generation != recordGeneration_) return;
        documentTemplates_ = value.toArray().toVariantList(); emit patientRecordChanged();
    });
    request("GET", "/api/families", {}, [this, generation](const QJsonValue &value) {
        if (generation != recordGeneration_) return;
        familyOptions_ = value.toArray().toVariantList(); emit patientRecordChanged();
    });
    request("GET", "/api/patients/" + QString::number(id), {}, [this, generation](const QJsonValue &value) {
        if (generation != recordGeneration_) return;
        patientRecord_ = value.toObject().toVariantMap(); emit patientRecordChanged();
        loadPatientVisits("upcoming", 1);
    });
}
void ApiBridge::loadPatientVisits(const QString &period, int page) {
    if (!workspaceAllowed("patient") || patientRecord_.value("id").toInt()<=0) return;
    if (period!="upcoming" && period!="history") return;
    if (page<1 || page>100000) return;
    const int id=patientRecord_.value("id").toInt();
    const int generation=recordGeneration_;
    const int visitGeneration=++patientVisitGeneration_;
    patientVisitsPeriod_=period; patientVisitsPage_=page; patientVisits_.clear();
    patientVisitsTotal_=0; patientVisitsError_.clear(); patientVisitsLoading_=true;
    emit patientRecordChanged();
    QUrlQuery query;
    query.addQueryItem("period", period);
    query.addQueryItem("page", QString::number(page));
    const QString path="/api/patients/"+QString::number(id)+"/appointments?"+query.toString(QUrl::FullyEncoded);
    request("GET", path, {}, [this,generation,visitGeneration,id,page](const QJsonValue&value){
        if (generation!=recordGeneration_ || visitGeneration!=patientVisitGeneration_ ||
            patientRecord_.value("id").toInt()!=id) return;
        const auto response=value.toObject();
        patientVisits_=response.value("items").toArray().toVariantList();
        patientVisitsTotal_=response.value("total").toInt();
        patientVisitsPage_=response.value("page").toInt(page);
        patientVisitsLoading_=false; emit patientRecordChanged();
    }, true, [this,generation,visitGeneration](const QString&error){
        if (generation!=recordGeneration_ || visitGeneration!=patientVisitGeneration_)return;
        patientVisitsLoading_=false; patientVisitsError_=error; patientVisits_.clear();
        emit patientRecordChanged();
    });
}

void ApiBridge::updatePatientReferral(int referralId, const QString &status) {
    if (!workspaceAllowed("patient") || working_ || referralId<=0 ||
        (role_!="admin" && role_!="reception")) return;
    const QStringList allowed{"recommended","sent","completed","cancelled"};
    if(!allowed.contains(status))return issue("Оберіть коректний статус направлення.");
    bool belongs=false;
    for(const auto &entry:patientRecord_.value("referrals").toList()) {
        const auto referral=entry.toMap();
        if(referral.value("id").toInt()==referralId) {
            belongs=referral.value("status").toString()!=status;
            break;
        }
    }
    if (!belongs) return issue("Направлення не належить відкритій картці або статус не змінено.");
    const int patientId=patientRecord_.value("id").toInt();
    const int generation=recordGeneration_;
    working_=true;error_.clear();emit stateChanged();
    request("PATCH","/api/referrals/"+QString::number(referralId),
        {{"status",status}},[this,patientId,generation](const QJsonValue&){
        working_=false;notify("Статус направлення оновлено.");
        emit operationCompleted("referral");
        if(generation==recordGeneration_ && patientRecord_.value("id").toInt()==patientId)
            openPatient(patientId);
    });
}

void ApiBridge::exportAppointmentTicket(const QUrl &file) {
    if (!workspaceAllowed("patient") || patientRecord_.value("id").toInt()<=0 || !file.isLocalFile())
        return issue("Відкрийте картку пацієнта для друку талона.");
    if (patientVisitsPeriod_!="upcoming" || patientVisitsLoading_ || patientVisits_.isEmpty())
        return issue("Спочатку завантажте майбутні прийоми пацієнта.");
    const auto next=patientVisits_.first().toMap();
    if (next.value("start").toString().isEmpty())
        return issue("У найближчого прийому немає дати.");
    const QString center=CarePdf::text(centerConfiguration_.value("center_name","Lemvori Care"));
    QString html="<h2>"+center+"</h2><p>"+
        CarePdf::text(centerConfiguration_.value("address"))+" · "+
        CarePdf::text(centerConfiguration_.value("phone"))+"</p><hr>";
    html+="<h1>Талон на прийом</h1>";
    html+="<p><b>Пацієнт:</b> "+CarePdf::text(patientRecord_.value("name"))+"</p>";
    html+="<p><b>Номер картки:</b> "+CarePdf::text(patientRecord_.value("patient_no"))+"</p>";
    html+="<p><b>Дата й час:</b> "+CarePdf::text(next.value("start"))+"</p>";
    html+="<p><b>Спеціаліст:</b> "+CarePdf::text(next.value("psychologist"))+"</p>";
    html+="<p><b>Кабінет:</b> "+CarePdf::text(next.value("room"))+"</p>";
    html += QStringLiteral("<p style='font-size:10pt;color:#4A5C6A'>"
        "Цей талон підтверджує інформацію про запис на момент друку. "
        "При перенесенні або скасуванні прийому уточніть актуальний час у реєстратурі.</p>");
    if(!CarePdf::save(file,"Талон на прийом · "+patientRecord_.value("name").toString(),html))
        return issue("Не вдалося зберегти талон PDF.");
    notify("Талон майбутнього прийому збережено у PDF.");
}

void ApiBridge::closePatient() {
    ++recordGeneration_; ++detailGeneration_; ++patientVisitGeneration_;
    patientRecord_.clear(); patientVisits_.clear(); patientVisitsTotal_=0;
    patientVisitsPage_=1; patientVisitsError_.clear(); patientVisitsLoading_=false;
    familyOptions_.clear(); rehabilitationGoals_.clear(); detailRecord_.clear();
    emit patientRecordChanged(); emit detailChanged();
}

void ApiBridge::workspaceAction(const QString &section, const QString &action, int id, const QVariantMap &fields) {
    if (!workspaceAllowed(section) || working_) return;
    QString path; QByteArray method = "POST";
    auto body = QJsonObject::fromVariantMap(fields);
    bool keyed = false;
    if (section == "handover") {
        path = workspaceEndpoints.value(section);
        if (action == "resolve" && id > 0) { path += "/" + QString::number(id); method = "PATCH"; body = {{"state", "resolved"}}; }
        else if (action == "create") keyed = true;
        else return;
    } else if (section == "families" && action == "create") path = workspaceEndpoints.value(section);
    else if (section == "waiting") {
        path = workspaceEndpoints.value(section);
        if (action == "create") {}
        else if (id > 0 && (action == "offered" || action == "cancelled")) {
            path += "/" + QString::number(id); method = "PATCH";
            body = {{"version", body.value("version")}, {"status", action}};
        } else if (id > 0 && action == "book") path += "/" + QString::number(id) + "/book";
        else return;
    } else if (section == "supervisions") {
        path = workspaceEndpoints.value(section);
        if (action == "edit" && id > 0) { path += "/" + QString::number(id); method = "PATCH"; }
        else if (action != "create") return;
    } else if (section == "messages" && action == "create") { path = workspaceEndpoints.value(section); keyed = true; }
    else if (section == "tv" && action == "call") path = "/api/tv/call";
    else if (section == "patient" && id > 0) {
        const int patientId = patientRecord_.value("id").toInt();
        if (patientId <= 0) return;
        const QString patientPath = "/api/patients/" + QString::number(patientId);
        if (action == "edit" && id == patientId) { path = patientPath; method = "PATCH"; }
        else if (action == "course-open" && id == patientId) path = patientPath + "/courses";
        else if (action == "course-close") {
            bool found = false;
            for (const auto &row : patientRecord_.value("courses").toList()) if (row.toMap().value("id").toInt() == id) found = true;
            if (!found) return;
            path = "/api/courses/" + QString::number(id); method = "PATCH";
        } else if (action == "document" && id == patientId) path = patientPath + "/documents";
        else if (action == "discharge" && role_ == "admin") { path = "/api/discharges"; body.insert("patient_id", patientId); }
        else if (action == "referral") path = patientPath + "/referrals";
        else if (action == "note" && role_ == "admin") { path = "/api/admin-notes"; body.insert("patient_id", patientId); }
        else return;
    } else if (section == "recovery" && action == "resolve" && id > 0 && detailRecord_.value("id").toInt() == id) {
        path = "/api/admin/recovery/" + QString::number(id);
        body.insert("revision", QJsonValue::fromVariant(detailRecord_.value("revision")));
        body.insert("draft_version", QJsonValue::fromVariant(detailRecord_.value("draft_version")));
    } else return;
    if (keyed) {
        QJsonObject fingerprint = body; fingerprint.insert("_path", path);
        if (fingerprint != mutationBody_) { mutationBody_ = fingerprint; mutationKey_ = QUuid::createUuid().toString(QUuid::WithoutBraces); }
        body.insert("client_key", mutationKey_);
    }
    working_ = true; error_.clear(); emit stateChanged();
    request(method, path, body, [this, section](const QJsonValue &) {
        working_ = false; mutationBody_ = {}; mutationKey_.clear();
        notify("Зміни збережено."); emit operationCompleted("workspace");
        if (section == "patient") openPatient(patientRecord_.value("id").toInt());
        else if (workspaceSection_ == section) loadWorkspace(section, workspaceQuery_, workspaceFrom_, workspaceTo_);
        refresh();
    });
}

void ApiBridge::openDetail(const QString &kind, int id) {
    QString path;
    if (kind == "recovery" && workspaceAllowed("recovery") && id > 0) path = "/api/admin/recovery/" + QString::number(id);
    else if (kind == "family" && workspaceAllowed("families") && id > 0) path = "/api/patient-directory?status=all&page_size=100&family_id=" + QString::number(id);
    else if (kind == "documents" && workspaceAllowed("patient") && id == patientRecord_.value("id").toInt() && id > 0)
        path = "/api/patients/" + QString::number(id) + "/documents";
    else return;
    const int generation = ++detailGeneration_;
    detailRecord_.clear(); emit detailChanged();
    request("GET", path, {}, [this, generation, kind](const QJsonValue &value) {
        if (generation != detailGeneration_) return;
        detailRecord_ = kind == "documents" ? QVariantMap{{"documents",value.toArray().toVariantList()}} : value.toObject().toVariantMap();
        emit detailChanged();
    });
}
void ApiBridge::saveDocument(const QVariantMap &fields, const QUrl &scanFile) {
    if (!workspaceAllowed("patient") || working_) return;
    QVariantMap body = fields;
    if (body.value("source").toString()=="paper_scan") for (const auto &entry:consentPolicy_.value("templates").toList()) {
        const auto rule=entry.toMap();
        if(rule.value("document_type")==body.value("document_type") && rule.value("content").toString().size()>=20) {body.insert("consent_version",rule.value("version"));body.insert("content",rule.value("content"));body.insert("title",rule.value("title"));}
    }
    if (body.value("source").toString() == "paper_scan") {
        if (!scanFile.isLocalFile()) return issue("Оберіть зображення документа на цьому ПК.");
        QFile file(scanFile.toLocalFile());
        if (!file.open(QIODevice::ReadOnly) || file.size() > 4400000) return issue("Оберіть PNG або JPEG до 4 МБ.");
        QImageReader reader(&file); reader.setAutoTransform(true);
        const auto dimensions = reader.size();
        if (!dimensions.isValid() || qint64(dimensions.width()) * dimensions.height() > 24000000 ||
            (reader.format() != "png" && reader.format() != "jpeg")) return issue("Потрібне зображення PNG або JPEG до 24 мегапікселів.");
        const QImage image = reader.read();
        if (image.isNull()) return issue("Не вдалося прочитати зображення документа.");
        QByteArray bytes; QBuffer buffer(&bytes); buffer.open(QIODevice::WriteOnly);
        if (!image.save(&buffer, "JPEG", 90) || bytes.size() > 4400000) return issue("Зменште розмір зображення документа.");
        const QString encoded = "data:image/jpeg;base64," + QString::fromLatin1(bytes.toBase64());
        file.seek(0);
        const QString mime = reader.format() == "png" ? "image/png" : "image/jpeg";
        body.insert("scan_data", encoded);
        body.insert("original_data", "data:" + mime + ";base64," + QString::fromLatin1(file.readAll().toBase64()));
    }
    workspaceAction("patient", "document", patientRecord_.value("id").toInt(), body);
}
void ApiBridge::changePassword(const QString &current, const QString &next) {
    if (!authenticated() || working_) return;
    if (current.isEmpty() || next.isEmpty() || current == next) return issue("Вкажіть поточний та інший новий пароль.");
    working_ = true; error_.clear(); emit stateChanged();
    request("POST", "/api/account/password", {{"current_password",current},{"new_password",next}}, [this](const QJsonValue &) {
        clearSession(); notify("Пароль змінено. Увійдіть з новим паролем."); emit operationCompleted("password");
    });
}

void ApiBridge::exportDischarge(const QUrl &url, int id) {
    if (!authenticated() || (role_ != "admin" && role_ != "director") || !url.isLocalFile()) return;
    QVariantMap record;
    for (const auto &row : dischargeRows_) if (row.toMap().value("id").toInt() == id) record = row.toMap();
    if (record.isEmpty()) return issue("Відкрийте актуальний список виписок.");
    const QString file = url.toLocalFile();
    request("GET", "/api/settings/center", {}, [this, file, record](const QJsonValue &value) {
        const auto center = value.toObject();
        auto escape = [](const QVariant &text) { return text.toString().toHtmlEscaped().replace("\n", "<br>"); };
        const bool approved = record.value("workflow_status").toString() == "approved";
        QString html = "<html><body style='font-family:Sans Serif;font-size:11pt;color:#11212D'>";
        html += "<h2>" + escape(center.value("center_name").toString("Lemvori Care")) + "</h2><p>" + escape(center.value("address").toString()) + "<br>" + escape(center.value("phone").toString()) + "</p><hr>";
        html += "<h1>Виписка № " + escape(record.value("document_no")) + "</h1>";
        if (!approved) html += "<p style='color:#8C3632;font-weight:bold'>ЧЕРНЕТКА · НЕ ПОГОДЖЕНО</p>";
        html += "<p><b>Пацієнт:</b> " + escape(record.value("patient_name")) + "<br><b>Номер картки:</b> " + escape(record.value("patient_no_snapshot")) + "<br><b>Дата народження:</b> " + escape(record.value("patient_dob")) + "<br><b>Період:</b> " + escape(record.value("date_from")) + " — " + escape(record.value("date_to")) + "</p>";
        const QList<QPair<QString,QString>> sections{{"Підсумок","summary"},{"Динаміка","dynamics"},{"Рекомендації","recommendations"},{"Подальший супровід","followup"}};
        for (const auto &section : sections) html += "<h3>" + section.first + "</h3><p>" + escape(record.value(section.second)) + "</p>";
        html += "<br><p>Психолог: " + escape(record.value("psychologist_name")) + " __________________</p><p>Керівник: " + escape(record.value("approved_by_name")) + " __________________</p><p style='font-size:9pt'>Редакція " + escape(record.value("revision")) + " · " + escape(record.value("created")) + "</p></body></html>";
        QSaveFile destination(file);
        if (!destination.open(QIODevice::WriteOnly)) return issue("Не вдалося створити PDF у вибраному місці.");
        bool painted = false;
        {
            QPdfWriter writer(&destination); writer.setResolution(96); writer.setPageSize(QPageSize(QPageSize::A4));
            writer.setPageMargins(QMarginsF(16,16,16,16)); writer.setTitle("Lemvori Care · " + record.value("document_no").toString()); writer.setCreator("Lemvori Care");
            QTextDocument document; document.setHtml(html); document.setPageSize(QSizeF(writer.width(), writer.height()));
            QPainter painter(&writer);
            if (painter.isActive()) {
                painted = true;
                for (int page=0; page<document.pageCount(); ++page) {
                    if (page>0 && !writer.newPage()) { painted = false; break; }
                    painter.save(); painter.translate(0,-page*writer.height());
                    document.drawContents(&painter,QRectF(0,page*writer.height(),writer.width(),writer.height())); painter.restore();
                }
                painter.end();
            }
        }
        if (!painted || !destination.commit()) return issue("Не вдалося зберегти PDF-виписку.");
        notify("PDF-виписку збережено.");
    });
}

namespace {
QVariantMap paperImages(const QUrl &source){
 if(!source.isLocalFile())throw std::runtime_error("Оберіть локальний PNG або JPEG.");
 QFile file(source.toLocalFile());
 if(!file.open(QIODevice::ReadOnly)||file.size()>4400000)throw std::runtime_error("Зображення має бути до 4 МБ.");
 QImageReader reader(&file);reader.setAutoTransform(true);const auto size=reader.size();const auto format=reader.format();
 if(!size.isValid()||qint64(size.width())*size.height()>24000000||(format!="png"&&format!="jpeg"))throw std::runtime_error("Потрібен PNG або JPEG до 24 мегапікселів.");
 const auto image=reader.read();if(image.isNull())throw std::runtime_error("Зображення пошкоджене.");
 QByteArray data;QBuffer buffer(&data);buffer.open(QIODevice::WriteOnly);
 if(!image.save(&buffer,"JPEG",90)||data.size()>4400000)throw std::runtime_error("Зменште розмір зображення.");
 file.seek(0);
 return {{"scan_data","data:image/jpeg;base64,"+QString::fromLatin1(data.toBase64())},
 {"original_data",QString("data:image/%1;base64,").arg(format=="png"?"png":"jpeg")+QString::fromLatin1(file.readAll().toBase64())}};
}
}
void ApiBridge::loadCenterConfiguration(){
 if(!authenticated())return;
 request("GET","/api/settings/center",{},[this](const QJsonValue&value){centerConfiguration_=value.toObject().toVariantMap();emit configurationChanged();},true);
 request("GET","/api/center/modules",{},[this](const QJsonValue&value){auto data=value.toObject();centerModules_=data.value("modules").toArray().toVariantList();licenseStatus_=data.value("license").toObject().toVariantMap();emit configurationChanged();},true);
 if(role_=="admin"||role_=="reception")request("GET","/api/consent-policy",{},[this](const QJsonValue&value){consentPolicy_=value.toObject().toVariantMap();emit configurationChanged();},true);
}
void ApiBridge::importLicense(const QUrl&url){
 if(!adminEdition_||role_!="admin"||working_||!url.isLocalFile())return;
 QFile file(url.toLocalFile());if(!file.open(QIODevice::ReadOnly)||file.size()>65536)return issue("Не вдалося прочитати файл ліцензії.");
 const auto envelope=QJsonDocument::fromJson(file.readAll());if(!envelope.isObject())return issue("Некоректний файл ліцензії.");
 working_=true;error_.clear();emit stateChanged();
 request("POST","/api/license",envelope.object(),[this](const QJsonValue&){working_=false;notify("Ліцензію перевірено сервером і активовано.");loadCenterConfiguration();emit operationCompleted("license");});
}
void ApiBridge::activateLicenseText(const QString &signedJson) {
 if(!adminEdition_ || role_!="admin" || working_)return;
 const QByteArray bytes=signedJson.trimmed().toUtf8();
 if(bytes.isEmpty() || bytes.size()>65536)return issue("Вставте підписаний JSON-файл ліцензії, не звичайний пароль.");
 QJsonParseError parseError{};
 const auto document=QJsonDocument::fromJson(bytes,&parseError);
 if(parseError.error!=QJsonParseError::NoError || !document.isObject() ||
    document.object().value("format").toString()!="quremed.solvia.license" ||
    !document.object().value("payload").isString() ||
    !document.object().value("signature").isString())
   return issue("Потрібна підписана ліцензія від Lemvori Control у форматі JSON.");
 working_=true;error_.clear();emit stateChanged();
 request("POST","/api/license",document.object(),[this](const QJsonValue&){
  working_=false;notify("Ліцензію перевірено і закріплено за цим сервером.");
  loadCenterConfiguration();emit operationCompleted("license");
 });
}
void ApiBridge::saveCenterModules(const QVariantList&enabled){
 if(!adminEdition_||role_!="admin"||working_)return;
 working_=true;error_.clear();emit stateChanged();
 request("PATCH","/api/center/modules",{{"enabled",QJsonArray::fromVariantList(enabled)}},[this](const QJsonValue&){working_=false;notify("Модулі центру налаштовано.");loadCenterConfiguration();emit operationCompleted("modules");});
}
void ApiBridge::saveConsentPolicy(const QVariantMap&policy){
 if(!adminEdition_||role_!="admin"||working_)return;
 working_=true;error_.clear();emit stateChanged();
 request("PATCH","/api/consent-policy",QJsonObject::fromVariantMap(policy),[this](const QJsonValue&value){working_=false;consentPolicy_=value.toObject().toVariantMap();emit configurationChanged();notify("Правила та версії згод збережено.");emit operationCompleted("consent-policy");});
}
void ApiBridge::exportBlankForm(const QUrl &file, const QString &formId) {
 if (!adminEdition_ || role_ != "admin" || !file.isLocalFile() || working_) return;
 if (centerConfiguration_.isEmpty()) return issue("Спочатку завантажте дані центру.");
 const QStringList all{
  "patient_request","informed_consent","data_processing","center_rules",
  "family_consent","referral","visit_sheet","consultation_attendance","refusal","handover"};
 if(!all.contains(formId))return issue("Невідомий тип бланка.");
 const QHash<QString,QString> titles{
  {"patient_request","Заява на отримання послуг"},
  {"informed_consent","Інформована згода"},
  {"data_processing","Згода на обробку персональних даних"},
  {"center_rules","Ознайомлення з правилами центру"},
  {"family_consent","Згода на сімейну консультацію"},
  {"referral","Направлення до спеціаліста"},
  {"visit_sheet","Лист відвідування"},
  {"consultation_attendance","Підтвердження проведення консультації"},
  {"refusal","Заява про відмову"},
  {"handover","Акт передачі зміни"}};
 const QString title=titles.value(formId);
 const QString line="____________________________________________________________________";
 const QString metadata="<p><b>Номер документа:</b> ____________________ &nbsp; "
                        "<b>Дата:</b> ____________________</p>";
 QString html="<html><body style='font-family:Sans Serif;color:#11212D;font-size:11pt'>";
 html+="<h2>"+CarePdf::text(centerConfiguration_.value("center_name","Lemvori Care"))+"</h2>";
 html+="<p>"+CarePdf::text(centerConfiguration_.value("address"))+" · "+
       CarePdf::text(centerConfiguration_.value("phone"))+"</p><hr>";
 html+="<h1>"+CarePdf::text(title)+"</h1>"+metadata;
 html+="<p><b>Пацієнт:</b> "+line+"<br><b>Дата народження:</b> ____________________</p>";
 if (formId == "informed_consent" || formId == "data_processing" ||
     formId == "center_rules" || formId == "family_consent") {
    bool found=false;
    for(const auto &entry:consentPolicy_.value("templates").toList()) {
      const auto rule=entry.toMap();
      if(rule.value("document_type").toString()!=formId)continue;
      const auto content=rule.value("content").toString();
      if(content.trimmed().size()<20)
        return issue("Адміністратор ще не затвердив текст згоди. Збереження заборонено.");
      html+="<p><b>Редакція:</b> "+CarePdf::text(rule.value("version"))+"</p>";
      html+="<p style='line-height:160%'>"+CarePdf::text(content)+"</p>";
      found=true;break;
    }
    if(!found)return issue("Для цього бланка потрібно налаштувати згоду в розділі «Згоди пацієнтів».");
 } else if(formId=="patient_request") {
    html+="<p><b>Послуга / мета звернення:</b> "+line+"</p>";
    html+="<p><b>Коментар заявника:</b><br><br>"+line+"<br><br>"+line+"</p>";
 } else if(formId=="referral") {
    html+="<p><b>Спеціаліст / установа:</b> "+line+"</p>";
    html+="<p><b>Причина направлення:</b><br><br>"+line+"<br><br>"+line+"</p>";
 } else if(formId=="visit_sheet") {
    html+="<table width='100%' border='1' cellspacing='0' cellpadding='7'>";
    html+="<tr><th>Дата</th><th>Час</th><th>Фахівець</th><th>Підпис</th></tr>";
    for(int i=0;i<9;i++)html+="<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>";
    html+="</table>";
 } else if(formId=="consultation_attendance") {
    html+="<p><b>Дата, час, кабінет:</b> "+line+"</p>";
    html+="<p><b>Спеціаліст:</b> "+line+"</p>";
    html+="<p><b>Примітки:</b><br><br>"+line+"<br><br>"+line+"</p>";
 } else if(formId=="refusal") {
    html+="<p><b>Опис відмови (заповнює заявник):</b><br><br>"+line+"<br><br>"+line+"<br><br>"+line+"</p>";
 } else if(formId=="handover") {
    html+="<p><b>Зміна / підрозділ:</b> "+line+"</p>";
    html+="<p><b>Передані документи, матеріали й зауваження:</b><br><br>"+line+"<br><br>"+line+"<br><br>"+line+"</p>";
 }
 html+="<br><p><b>ПІБ заявника / представника:</b> "+line+"</p>";
 html+="<p><b>Підпис заявника:</b> ____________________  <b>Дата:</b> ____________</p>";
 html+="<p><b>Працівник центру:</b> "+line+"</p>";
 html+="<p><b>Підпис працівника:</b> ____________________  <b>Дата:</b> ____________</p>";
 html+="<p style='font-size:9pt;color:#4A5C6A'>"+
       CarePdf::text(centerConfiguration_.value("document_footer"))+"</p></body></html>";
 if(!CarePdf::save(file,title+" · "+centerConfiguration_.value("center_name").toString(),html))
    return issue("Не вдалося створити PDF-бланк.");
 notify("Бланк PDF збережено. Підписи ставляться на роздрукованому оригіналі.");
}

bool ApiBridge::printRegistration(const QUrl&file,const QVariantMap&fields){
 if(!requireStaffRole()||working_||centerConfiguration_.isEmpty()||consentPolicy_.isEmpty())return false;
 const auto birth=QDate::fromString(fields.value("dob").toString(),Qt::ISODate);
 if(fields.value("name").toString().trimmed().isEmpty()||fields.value("name").toString().toUtf8().size()>150||!birth.isValid()||birth<QDate(1900,1,1)||birth>QDate::currentDate()){issue("Заповніть ПІБ та дату народження перед друком.");return false;}
 QString reference=QUuid::createUuid().toString(QUuid::WithoutBraces);
 const QString header="<h2>"+CarePdf::text(centerConfiguration_.value("center_name","Lemvori Care"))+"</h2><p>"+CarePdf::text(centerConfiguration_.value("address"))+"<br>"+CarePdf::text(centerConfiguration_.value("phone"))+"</p>";
 QString html=header+"<h1>Реєстраційна картка</h1><p><b>Посилання на реєстрацію:</b> "+reference+"</p><p><b>Пацієнт:</b> "+CarePdf::text(fields.value("name"))+"<br><b>Дата народження:</b> "+CarePdf::text(fields.value("dob"))+"<br><b>Телефон:</b> "+CarePdf::text(fields.value("phone"))+"<br><b>Категорія:</b> "+CarePdf::text(fields.value("category"))+"</p><p>Дата __________________ Підпис __________________</p>";
 for(const auto&entry:consentPolicy_.value("templates").toList()){
  auto consent=entry.toMap();if(!consent.value("required").toBool())continue;
  if(consent.value("content").toString().size()<20){issue("Адміністратор має затвердити тексти згод перед друком.");return false;}
  html+="<div style='page-break-before:always'>"+header+"<h2>"+CarePdf::text(consent.value("title"))+"</h2><p>Версія "+CarePdf::text(consent.value("version"))+" · "+reference+"</p><p>Пацієнт: "+CarePdf::text(fields.value("name"))+"<br>Дата народження: "+CarePdf::text(fields.value("dob"))+"</p><p>"+CarePdf::text(consent.value("content"))+"</p><br><p>ПІБ підписанта ______________________________</p><p>Дата __________________ Підпис __________________</p></div>";
 }
 if(!CarePdf::save(file,"Реєстрація · "+fields.value("name").toString(),html)){issue("Не вдалося зберегти бланки PDF.");return false;}
 registrationSnapshot_=fields;registrationReference_=reference;emit configurationChanged();notify("Бланки PDF готові до друку. Підпишіть і завантажте скани.");return true;
}
void ApiBridge::registerWithConsents(const QVariantMap&fields,const QVariantList&consents,bool bookAfter){
 if(!requireStaffRole()||working_)return;
 const bool required=consentPolicy_.value("required",true).toBool();
 if(consentPolicy_.isEmpty())return issue("Завантажте правила згод центру.");
 if(required&&(registrationReference_.isEmpty()||fields!=registrationSnapshot_))return issue("Після зміни даних повторно роздрукуйте бланки та отримайте підписи.");
 QJsonArray documents;
 try{
  for(const auto&entry:consents){
   auto item=entry.toMap();if(!item.value("paper_signed").toBool()||item.value("signed_by_name").toString().trimmed().isEmpty())return issue("Перевірте підписи на папері та вкажіть підписанта.");
   QVariantMap document=paperImages(QUrl(item.value("file").toString()));
   QVariantMap rule;for(const auto&candidate:consentPolicy_.value("templates").toList())if(candidate.toMap().value("document_type")==item.value("document_type"))rule=candidate.toMap();
   if(rule.isEmpty())return issue("Невідома згода.");
   document.insert("document_type",rule.value("document_type"));document.insert("title",rule.value("title"));document.insert("content",rule.value("content"));document.insert("consent_version",rule.value("version"));
   document.insert("registration_reference",registrationReference_);document.insert("signed_patient_name",fields.value("name"));document.insert("signed_patient_dob",fields.value("dob"));
   document.insert("source","paper_scan");document.insert("status","signed");document.insert("paper_signed",true);document.insert("signed_by_name",item.value("signed_by_name"));documents.append(QJsonObject::fromVariantMap(document));
  }
 }catch(const std::exception&error){return issue(QString::fromUtf8(error.what()));}
 auto body=QJsonObject::fromVariantMap(fields);body.insert("consents",documents);
 working_=true;error_.clear();notice_.clear();emit stateChanged();
 request("POST","/api/patients",body,[this,fields,bookAfter](const QJsonValue&value){
  working_=false;registrationReference_.clear();registrationSnapshot_.clear();emit configurationChanged();notify("Пацієнта зареєстровано. Підписані згоди прикріплено до картки.");
  emit operationCompleted("patient");emit patientRegistered({{"id",value.toObject().value("id").toInt()},{"name",fields.value("name")},{"psychologist_id",fields.value("psychologist_id")}},bookAfter);searchPatients("");refresh();
 });
}
void ApiBridge::exportPatientCard(const QUrl&file,bool clinical){
 if(!workspaceAllowed("patient")||patientRecord_.isEmpty()||(clinical&&role_!="admin"))return;
 const auto&record=patientRecord_;
 QString html="<h2>"+CarePdf::text(centerConfiguration_.value("center_name","Lemvori Care"))+"</h2><p>"+CarePdf::text(centerConfiguration_.value("address"))+"</p><h1>Картка № "+CarePdf::text(record.value("patient_no"))+"</h1><h2>"+CarePdf::text(record.value("name"))+"</h2><p>Дата народження: "+CarePdf::text(record.value("dob"))+"<br>Телефон: "+CarePdf::text(record.value("phone"))+"<br>Категорія: "+CarePdf::text(record.value("category"))+"</p>";
 for(const auto&entry:record.value("courses").toList()){auto row=entry.toMap();html+="<h3>Курс № "+CarePdf::text(row.value("course_no"))+"</h3><p>"+CarePdf::text(row.value("started_at"))+" — "+CarePdf::text(row.value("ended_at"))+" · "+CarePdf::text(row.value("psychologist"))+"</p>";}
 if(clinical){
  html+="<h2>Історія консультацій</h2>";
  for(const auto&entry:record.value("consultations").toList()){
   auto row=entry.toMap();html+="<h3>"+CarePdf::text(row.value("created"))+" · "+CarePdf::text(row.value("psychologist"))+"</h3>";
   const QList<QPair<QString,QString>> fields{{"Звернення","request_text"},{"Стан","state_text"},{"Проведена робота","work_done"},{"Нотатка","note"},{"Цілі","goals"},{"Результат","result_text"},{"Рекомендації","recommendations"},{"Подальший супровід","next_plan"}};
   for(const auto&field:fields)if(!row.value(field.second).toString().isEmpty())html+="<p><b>"+field.first+":</b> "+CarePdf::text(row.value(field.second))+"</p>";
  }
 }
 html+="<h3>Згоди та документи</h3>";
 for(const auto&entry:record.value("documents").toList()){auto row=entry.toMap();html+="<p>"+CarePdf::text(row.value("title"))+" · "+CarePdf::text(row.value("status"))+" · "+CarePdf::text(row.value("signed_at"))+" · "+CarePdf::text(row.value("signed_by_name"))+"</p>";}
 if(!CarePdf::save(file,"Картка · "+record.value("patient_no").toString(),html))return issue("Не вдалося зберегти PDF-картку.");notify("PDF-картку збережено.");
}

void ApiBridge::exportCenterRequest(const QUrl&url){
 if(!adminEdition_||role_!="admin"||!url.isLocalFile()||licenseStatus_.value("server_id").toString().isEmpty())return;
 QJsonArray modules;for(const auto&entry:centerModules_)if(entry.toMap().value("enabled").toBool())modules.append(entry.toMap().value("id").toString());
 QJsonObject request{{"format","lemvori.center-request"},{"version",1},{"server_id",licenseStatus_.value("server_id").toString()},{"center",centerConfiguration_.value("center_name").toString()},{"requested_modules",modules}};
 QSaveFile file(url.toLocalFile());if(!file.open(QIODevice::WriteOnly)||file.write(QJsonDocument(request).toJson())<0||!file.commit())return issue("Не вдалося зберегти запит центру.");notify("Запит центру збережено для Lemvori Control.");
}

void ApiBridge::openPdf(const QUrl&url){
 if(!authenticated()||!url.isLocalFile())return;
 const QFileInfo file(url.toLocalFile());if(!file.isFile()||file.suffix().compare("pdf",Qt::CaseInsensitive)!=0)return;
 if(!QDesktopServices::openUrl(url))issue("Відкрийте збережений PDF у системній програмі для друку.");
}

// Packages stay on the authenticated center server. Devices retain their own
// installation/signature checks; publication never interrupts a consultation.
void ApiBridge::loadUpdates() {
    if (!adminEdition_ || role_ != "admin" || updatesLoading_) return;
    const int generation = ++updatesGeneration_;
    updatesLoading_ = true; updatesError_.clear();
    updateReleases_.clear(); updateDevices_.clear(); emit updatesChanged();
    auto remaining = std::make_shared<int>(3);
    auto finish = [this, generation, remaining]() {
        if (generation != updatesGeneration_) return;
        if (--*remaining == 0) updatesLoading_ = false;
        emit updatesChanged();
    };
    auto failure = [this, generation, finish](const QString &message) {
        if (generation != updatesGeneration_) return;
        updatesError_ = message; finish();
    };
    request("GET", "/api/desktop-updates", {}, [this,generation,finish](const QJsonValue &value) {
        if (generation != updatesGeneration_) return;
        for (const auto &entry : value.toArray()) updateReleases_.append(entry.toObject().toVariantMap());
        finish();
    }, true, failure);
    request("GET", "/api/mobile-update", {}, [this,generation,finish](const QJsonValue &value) {
        if (generation != updatesGeneration_) return;
        auto release = value.toObject();
        if (release.value("available").toBool()) {
            release.insert("platform", "android");
            release.insert("version", release.value("version_name"));
            updateReleases_.append(release.toVariantMap());
        }
        finish();
    }, true, failure);
    request("GET", "/api/admin/devices", {}, [this,generation,finish](const QJsonValue &value) {
        if (generation != updatesGeneration_) return;
        updateDevices_ = value.toArray().toVariantList(); finish();
    }, true, failure);
}

void ApiBridge::publishUpdate(const QUrl &file, const QString &platform, const QString &version,
                              int build, const QString &notes, const QString &pilotIds) {
    if (!adminEdition_ || role_ != "admin" || working_) return;
    if (!QStringList{"android","windows","linux"}.contains(platform) || !file.isLocalFile())
        return issue("Оберіть платформу та локальний файл оновлення.");
    if (!QRegularExpression("^(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})$").match(version).hasMatch())
        return issue("Версія пакета: три числа, наприклад 3.13.0.");
    if (notes.size() > 3000 || (platform == "android" && build <= 0))
        return issue("Перевірте номер збірки та опис (до 3000 символів).");
    QJsonArray pilot;
    for (const auto &part : pilotIds.split(',', Qt::SkipEmptyParts)) {
        bool ok = false; const int id = part.trimmed().toInt(&ok);
        if (!ok || id <= 0 || pilot.contains(id) || pilot.size() >= 200)
            return issue("Пробна група: різні ID активних психологів через кому (до 200).");
        pilot.append(id);
    }
    QFile input(file.toLocalFile());
    const qint64 limit = (platform == "android" ? 8 : 32) * 1024 * 1024;
    if (!input.open(QIODevice::ReadOnly) || input.size() < 8 || input.size() > limit)
        return issue(platform == "android" ? "Оберіть APK до 8 МБ." : "Оберіть пакет ПК до 32 МБ.");
    const auto bytes = input.read(limit + 1);
    if (bytes.size() != input.size() || bytes.size() > limit || input.error() != QFile::NoError)
        return issue("Не вдалося прочитати пакет повністю.");
    if ((platform == "android" && !bytes.startsWith("PK")) ||
        (platform == "windows" && !bytes.startsWith("MZ")) ||
        (platform == "linux" && !(bytes.startsWith(QByteArray::fromHex("1f8b")) || bytes.startsWith("!<arch>\n"))))
        return issue("Формат пакета не відповідає платформі.");
    QJsonObject body{{"sha256",QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex())},
                     {"release_notes",notes.trimmed()}};
    const bool mobile = platform == "android";
    if (mobile) {
        body.insert("version_code",build); body.insert("version_name",version);
        body.insert("package_name","com.quremed.solvia"); body.insert("rollout_user_ids",pilot);
        body.insert("apk_base64",QString::fromLatin1(bytes.toBase64()));
    } else {
        body.insert("platform",platform); body.insert("version",version);
        body.insert("package_base64",QString::fromLatin1(bytes.toBase64()));
    }
    working_ = true; error_.clear(); emit stateChanged();
    request("POST", mobile ? "/api/mobile-update" : "/api/desktop-updates", body,
            [this](const QJsonValue &) {
        working_ = false; notify("Оновлення опубліковане на сервері центру.");
        emit operationCompleted("update"); loadUpdates();
    });
}

namespace {
QString nativePlatform() {
#ifdef Q_OS_WIN
    return "windows";
#else
    return "linux";
#endif
}
}
void ApiBridge::checkClientUpdate() {
    if (!authenticated() || working_) return;
    clientUpdate_.clear(); emit updatesChanged();
    request("GET", "/api/desktop-updates?platform=" + nativePlatform(), {}, [this](const QJsonValue &value) {
        auto release = value.toObject();
        if (release.value("available").toBool()) clientUpdate_ = release.toVariantMap();
        else notify("Адміністратор ще не опублікував пакет для цього ПК.");
        emit updatesChanged();
    });
}
void ApiBridge::downloadClientUpdate(const QUrl &file) {
    if (!authenticated() || working_ || clientUpdate_.isEmpty() || !file.isLocalFile()) return;
    const auto release = clientUpdate_;
    const auto sha = release.value("sha256").toString();
    const qint64 size = release.value("size_bytes").toLongLong();
    const QString filename = release.value("filename").toString();
    if (!QRegularExpression("^[a-f0-9]{64}$").match(sha).hasMatch() || size < 8 || size > 32*1024*1024 ||
        !(filename.endsWith(".deb") || filename.endsWith(".exe") || filename.endsWith(".tar.gz")))
        return issue("Некоректний опис пакета оновлення.");
    if (QFileInfo(file.toLocalFile()).absoluteFilePath() == QFileInfo(QCoreApplication::applicationFilePath()).absoluteFilePath())
        return issue("Збережіть інсталятор в окремий файл.");
    QNetworkRequest req(QUrl(origin_ + "/api/desktop-updates/package?platform=" + nativePlatform() + "&sha=" + sha));
    req.setRawHeader("Authorization", QByteArray("Bearer ") + token_.toUtf8());
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    req.setTransferTimeout(120000);
    auto *reply = network_.get(req);
    const int session = sessionGeneration_;
    auto data = std::make_shared<QByteArray>();
    working_ = true; error_.clear(); emit stateChanged();
    connect(reply, &QNetworkReply::readyRead, this, [this,reply,data,size,session]() {
        if (session != sessionGeneration_ || data->size() + reply->bytesAvailable() > size) { reply->abort(); return; }
        data->append(reply->readAll());
    });
    connect(reply, &QNetworkReply::finished, this, [this,reply,data,size,sha,file,session,filename]() {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const auto error = reply->error(); reply->deleteLater();
        if (session != sessionGeneration_) return;
        working_ = false;
        if (error != QNetworkReply::NoError || status != 200 || data->size() != size ||
            QCryptographicHash::hash(*data,QCryptographicHash::Sha256).toHex() != sha.toLatin1())
            return issue("Не вдалося перевірити пакет. Файл не збережено.");
        if ((filename.endsWith(".deb") && !data->startsWith("!<arch>\n")) ||
            (filename.endsWith(".exe") && !data->startsWith("MZ")) ||
            (filename.endsWith(".tar.gz") && !data->startsWith(QByteArray::fromHex("1f8b"))))
            return issue("Формат пакета не збігається з описом.");
        QSaveFile output(file.toLocalFile());
        if (!output.open(QIODevice::WriteOnly) || output.write(*data) != data->size() || !output.commit())
            return issue("Не вдалося зберегти інсталятор.");
        notify("Пакет перевірено й збережено. Збережіть роботу, закрийте Lemvori Care та встановіть пакет системним інсталятором.");
        emit operationCompleted("client-update");
    });
}
