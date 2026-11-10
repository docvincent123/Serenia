#include "ApiBridge.h"
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
        QSettings legacy(QStringLiteral("QureMed"), QStringLiteral("SOLVIA"));
        if (legacy.contains("server/url")) {
            settings.setValue("server/url", legacy.value("server/url"));
            settings.setValue("server/identity", legacy.value("server/identity"));
            settings.sync();
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
    req.setTransferTimeout(15000);
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
    connect(reply, &QNetworkReply::finished, this,
            [this, reply, generation, path, quiet, completed = std::move(completed), failed = std::move(failed)]() mutable {
        const auto bytes = reply->readAll();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const auto networkError = reply->error();
        const QString networkDetails = reply->errorString();
        reply->deleteLater();
        if (generation != sessionGeneration_) return; // logout/server switch won the race
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
            if (!quiet) issue(why);
            return;
        }
        if (parse.error != QJsonParseError::NoError || (!document.isArray() && !document.isObject())) {
            const QString why = "Сервер повернув некоректну відповідь.";
            if (failed) failed(why);
            if (!quiet) issue(why);
            return;
        }
        completed(value);
    });
}

void ApiBridge::configureServer(const QString &value) {
    if (authenticated() || working_) return;
    connectServer(value, {});
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
void ApiBridge::refresh() {
    if (!authenticated()) return;
    const int generation = ++refreshGeneration_;
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
    lastRefresh_ = QTime::currentTime().toString("HH:mm:ss");
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
    {"team", "/api/users"}, {"rooms", "/api/rooms"}, {"services", "/api/services"},
    {"access", "/api/reception-access"}, {"workflow", "/api/settings/workflow"},
    {"center", "/api/settings/center"}, {"sessions", "/api/admin/sessions"}, {"audit", "/api/audit"}
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
    const bool item = section == "team" || section == "rooms" || section == "services";
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
        refresh();
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
        && QFileInfo("/usr/local/sbin/solvia-admin").isExecutable();
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
            issue(QString("Операцію PostgreSQL не завершено (код %1). Перевірте журнал solvia-admin.").arg(code));
        } else if (arguments.first() == "restore-ui") {
            clearSession();
            notify("Базу відновлено. Увійдіть до центру повторно.");
        } else {
            notify("Резервну копію збережено в каталозі /var/backups/solvia/.");
            refresh();
        }
    });
    process->start("/usr/bin/pkexec", QStringList{"/usr/local/sbin/solvia-admin"} + arguments);
}

void ApiBridge::databaseBackup() {
    runDatabaseTool({"backup"});
}

void ApiBridge::databaseRestore(const QUrl &file, const QString &confirmation) {
    const QString path = file.toLocalFile();
    if (confirmation.trimmed() != "ВІДНОВИТИ" || !QFileInfo(path).isFile() || !path.endsWith(".dump"))
        return issue("Оберіть файл .dump і введіть ВІДНОВИТИ.");
    runDatabaseTool({"restore-ui", path});
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
