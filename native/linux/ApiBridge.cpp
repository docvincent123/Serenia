#include "ApiBridge.h"
#include <QDate>
#include <QDateTime>
#include <QHostInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSettings>
#include <QSysInfo>
#include <QTime>
#include <QUrl>
#include <QUrlQuery>
#include <QUuid>

ApiBridge::ApiBridge(QObject *parent) : QObject(parent) {
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
    token_.clear();
    name_.clear();
    role_.clear();
    working_ = false;
    shift_.clear(); overview_.clear(); system_.clear(); visits_.clear();
    patients_.clear(); appointments_.clear(); roster_.clear();
    psychologists_.clear(); rooms_.clear();
    rosterSupported_ = false;
    rosterConfigured_ = false;
    rosterDate_.clear();
    emit stateChanged();
    emit dataChanged();
}

void ApiBridge::request(const QByteArray &method, const QString &path,
                        const QJsonObject &body, Callback completed, bool quiet) {
    if (!origin_.startsWith("https://")) {
        if (!quiet) issue("Спочатку підключіть HTTPS-сервер SOLVIA.");
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
    if (!reply) {
        if (!quiet) issue("Невідомий метод запиту.");
        return;
    }
    const int generation = sessionGeneration_;
    connect(reply, &QNetworkReply::finished, this,
            [this, reply, generation, path, quiet, completed = std::move(completed)]() mutable {
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
            if (!quiet) issue(why);
            return;
        }
        if (parse.error != QJsonParseError::NoError || (!document.isArray() && !document.isObject())) {
            if (!quiet) issue("Сервер повернув некоректну відповідь.");
            return;
        }
        completed(value);
    });
}

void ApiBridge::configureServer(const QString &value) {
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
    error_.clear();
    notice_ = "Перевіряємо сервер та TLS-сертифікат…";
    emit stateChanged();
    QSettings settings;
    const QString storedId = origin_ == settings.value("server/url").toString()
        ? settings.value("server/identity").toString() : QString();
    request("GET", "/api/health", {}, [this, storedId](const QJsonValue &json) {
        const auto health = json.toObject();
        const QString id = health.value("server_id").toString();
        if (!health.value("ok").toBool() || id.isEmpty()) {
            issue("Сервер не підтвердив свою ідентичність.");
            return;
        }
        if (!storedId.isEmpty() && storedId != id) {
            issue("Ідентифікатор сервера змінився. Не підключайтеся до невідомого центру.");
            return;
        }
        QSettings settings;
        settings.setValue("server/url", origin_);
        settings.setValue("server/identity", id);
        pinnedId_ = id;
        connected_ = true;
        notify("Сервер SOLVIA підтверджено. Увійдіть до свого кабінету.");
    });
}

void ApiBridge::login(const QString &username, const QString &password) {
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
        working_ = false;
        const QString token = json.toObject().value("token").toString();
        if (token.isEmpty()) {
            issue("Сервер не повернув сеанс входу.");
            return;
        }
        token_ = token;
        request("GET", "/api/me", {}, [this](const QJsonValue &profile) {
            const auto data = profile.toObject();
            role_ = data.value("role").toString();
            name_ = data.value("name").toString();
            if (!QStringList{"admin","reception","director"}.contains(role_)) {
                logout();
                issue("Це робоче місце призначене для адміністрації. Для психолога використайте Android.");
                return;
            }
            notify("Вітаємо в SOLVIA!");
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
    request("GET", "/api/workday/home", {}, [this,generation](const QJsonValue &v){
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
    const QString day = QDate::currentDate().toString(Qt::ISODate);
    request("GET", "/api/appointments?date=" + day, {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        appointments_ = v.toArray().toVariantList();
        emit dataChanged();
    }, true);
}
void ApiBridge::getMeta(int generation) {
    request("GET", "/api/meta", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        const auto value = v.toObject();
        psychologists_ = value.value("psychologists").toArray().toVariantList();
        rooms_ = value.value("rooms").toArray().toVariantList();
        emit dataChanged();
    }, true);
}
void ApiBridge::getRoster(int generation) {
    request("GET", "/api/shift-psychologists", {}, [this,generation](const QJsonValue &v){
        if (generation != refreshGeneration_) return;
        rosterSupported_ = v.isObject();
        rosterConfigured_ = v.toObject().value("configured").toBool(false)
            && v.toObject().value("shift_open").toBool(false);
        rosterDate_ = v.toObject().value("date").toString();
        roster_ = v.toObject().value("psychologists").toArray().toVariantList();
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
            issue("Сервер не підтвердив відомий ідентифікатор SOLVIA.");
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
        searchPatients(QString());
    }
    getAppointments(generation);
    getRoster(generation);
    if (role_ == "admin") getSystem(generation);
    lastRefresh_ = QTime::currentTime().toString("HH:mm:ss");
    emit stateChanged();
}
void ApiBridge::searchPatients(const QString &text) {
    if (!authenticated() || role_ == "director") return;
    const int generation = ++patientGeneration_;
    const QString path = "/api/patient-directory?page=1&page_size=25&q="
        + QString::fromUtf8(QUrl::toPercentEncoding(text.trimmed()));
    request("GET", path, {}, [this,generation](const QJsonValue &v){
        if (generation != patientGeneration_) return;
        patients_ = v.toObject().value("items").toArray().toVariantList();
        emit dataChanged();
    }, true);
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
void ApiBridge::book(int patientId,int psychologistId,int roomId,const QString &date,
                     const QString &start,const QString &end,const QString &kind) {
    if (!requireStaffRole()) return;
    if (!psychologistBookable(psychologistId,date))
        return issue("Психолог не включений до поточної зміни.");
    if (patientId<=0||psychologistId<=0||roomId<=0||date.isEmpty()||start>=end)
        return issue("Оберіть пацієнта, психолога, кабінет і коректний час.");
    request("POST","/api/appointments",{{"patient_ids",QJsonArray{patientId}},
       {"psychologist_id",psychologistId},{"room_id",roomId},{"kind",kind},
       {"status","scheduled"},{"start",date+"T"+start},{"end",date+"T"+end},
       {"client_key",QUuid::createUuid().toString(QUuid::WithoutBraces)}},
       [this](const QJsonValue &){
        notify("Пацієнта записано на прийом.");
        emit operationCompleted("booking");
        refresh();
    });
}
void ApiBridge::registerPatient(const QString &name,const QString &phone,
                                const QString &dob,const QString &category,int psychologistId) {
    if (!requireStaffRole()) return;
    if (name.trimmed().isEmpty()||phone.trimmed().isEmpty()||psychologistId<=0)
        return issue("Заповніть обов'язкові поля.");
    request("POST","/api/patients",{{"name",name.trimmed()},{"phone",phone.trimmed()},
        {"dob",dob},{"category",category},{"psychologist_id",psychologistId}},
        [this](const QJsonValue &){
        notify("Картку пацієнта створено.");
        emit operationCompleted("patient");
        refresh();
    });
}
