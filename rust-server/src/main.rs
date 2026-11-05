//! SOLVIA vNext API, phase 1. This binary is intentionally NOT a drop-in
//! replacement for the production C++ server yet. It runs on loopback and
//! proxies unported endpoints to the existing server (also on loopback).
//! Native read endpoints use the original PostgreSQL schema and RBAC checks.
use std::{env, net::SocketAddr};

use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get},
    Json, Router,
};
use chrono::Utc;
use chrono_tz::Europe::Kyiv;
use reqwest::{redirect::Policy, Client, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};

const MAX_REQUEST: usize = 48 * 1024 * 1024;
const MAX_RESPONSE: usize = 50 * 1024 * 1024;
const NATIVE_VERSION: &str = "3.1.1-rust-preview";

#[derive(Clone)]
struct Service {
    pool: PgPool,
    old_api: Option<Url>,
    client: Client,
    native_reads: bool,
}

#[derive(Debug)]
struct ApiError(StatusCode, &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, [(header::CACHE_CONTROL, "no-store"), (header::X_CONTENT_TYPE_OPTIONS, "nosniff")],
            Json(json!({"error":self.1}))).into_response()
    }
}
type ApiResult = Result<Json<Value>, ApiError>;

fn old_api_url(input: &str) -> Result<Url, &'static str> {
    let url = Url::parse(input).map_err(|_| "Некоректна адреса старого API")?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some() {
        return Err("Старий API повинен працювати тільки на HTTP loopback");
    }
    Ok(url)
}

fn valid_api_path(path: &str) -> bool {
    (path == "/api" || path.starts_with("/api/")) && !path.contains("//") && !path.contains('\\')
}

fn allowed(role: &str, roles: &[&str]) -> Result<(), ApiError> {
    if roles.contains(&role) { Ok(()) }
    else { Err(ApiError(StatusCode::FORBIDDEN, "Недостатньо прав доступу")) }
}

async fn authenticated_role(pool: &PgPool, headers: &HeaderMap) -> Result<String, ApiError> {
    let authorization = headers.get(header::AUTHORIZATION)
        .and_then(|s| s.to_str().ok())
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Увійдіть у систему"))?;
    let token = authorization.strip_prefix("Bearer ")
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Некоректна сесія"))?;
    let digest = hex::encode(Sha256::digest(token.as_bytes()));
    let now = Utc::now().timestamp();
    // Parity with the C++ session rule: expired ordinary sessions are rejected;
    // a shift-bound session lives only until its shift closes.
    let row = sqlx::query(
        "SELECT u.role FROM sessions s JOIN users u ON u.id=s.user_id \
        WHERE s.token=$1 AND (s.expires>$2 OR s.shift_date<>'') \
        AND (s.shift_date='' OR EXISTS(SELECT 1 FROM shift_days sd \
             WHERE sd.shift_date=s.shift_date AND sd.closed_at IS NULL)) \
        AND u.active=TRUE"
    ).bind(digest).bind(now).fetch_optional(pool).await
        .map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"База даних недоступна"))?
        .ok_or(ApiError(StatusCode::UNAUTHORIZED,"Сесія завершилася"))?;
    row.try_get("role")
        .map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"Помилка даних сесії"))
}

fn today() -> String {
    Utc::now().with_timezone(&Kyiv).format("%Y-%m-%d").to_string()
}

async fn workday_home(state: &Service, headers: &HeaderMap) -> ApiResult {
    let role = authenticated_role(&state.pool, headers).await?;
    allowed(&role, &["admin","reception"])?;
    let day = today();
    // Explicit field projection: no consultation text, diagnosis, notes,
    // risk flags, assessments, document bodies or private clinical content.
    let counts = sqlx::query(
        r#"SELECT
        count(*) FILTER(WHERE t.visit_status='' AND a.status IN ('scheduled','confirmed')
            AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) expected_total,
        count(*) FILTER(WHERE t.visit_status='' AND a.status IN ('scheduled','confirmed') AND t.arrived_at=''
            AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) waiting,
        count(*) FILTER(WHERE t.visit_status='' AND a.status IN ('scheduled','confirmed') AND t.arrived_at<>''
            AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) arrived,
        count(*) FILTER(WHERE EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)) completed,
        count(*) FILTER(WHERE t.visit_status<>'' OR a.status IN ('cancelled','no_show')) not_completed
        FROM appointments a JOIN attendees t ON t.appointment_id=a.id WHERE substr(a.start,1,10)=$1"#
    ).bind(&day).fetch_one(&state.pool).await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE,"Не вдалося прочитати статистику"))?;
    let now = Utc::now().with_timezone(&Kyiv).format("%Y-%m-%dT%H:%M").to_string();
    let visits = sqlx::query(
        r#"SELECT a.id appointment_id,a.start,a."end",p.id patient_id,
        p.name patient,p.patient_no,us.name psychologist,r.name room,t.arrived_at
        FROM appointments a JOIN attendees t ON t.appointment_id=a.id
        JOIN patients p ON p.id=t.patient_id JOIN users us ON us.id=a.psychologist_id
        JOIN rooms r ON r.id=a.room_id WHERE substr(a.start,1,10)=$1
        AND a.status IN ('scheduled','confirmed') AND t.visit_status=''
        AND NOT EXISTS(SELECT 1 FROM consultations c WHERE c.appointment_id=a.id AND c.patient_id=t.patient_id)
        ORDER BY CASE WHEN a.start >= $2 THEN 0 ELSE 1 END,a.start,p.name LIMIT 6"#
    ).bind(&day).bind(&now).fetch_all(&state.pool).await
        .map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"Не вдалося отримати прийоми"))?;
    let next: Vec<Value> = visits.iter().map(|r|json!({
        "appointment_id":r.get::<i64,_>("appointment_id"),
        "patient_id":r.get::<i64,_>("patient_id"),
        "start":r.get::<String,_>("start"),
        "end":r.get::<String,_>("end"),
        "patient":r.get::<String,_>("patient"),
        "patient_no":r.get::<String,_>("patient_no"),
        "psychologist":r.get::<String,_>("psychologist"),
        "room":r.get::<String,_>("room"),
        "arrived_at":r.get::<String,_>("arrived_at")
    })).collect();
    let active: i64 = sqlx::query_scalar("SELECT count(*) FROM patients WHERE status='active'")
        .fetch_one(&state.pool).await
        .map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"Статистика недоступна"))?;
    let waiting: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM waiting_list WHERE status IN ('waiting','offered')"
    ).fetch_one(&state.pool).await
        .map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"Черга недоступна"))?;
    Ok(Json(json!({
        "date":day,
        "counts":{
            "expected_total":counts.get::<i64,_>("expected_total"),
            "waiting":counts.get::<i64,_>("waiting"),
            "arrived":counts.get::<i64,_>("arrived"),
            "completed":counts.get::<i64,_>("completed"),
            "not_completed":counts.get::<i64,_>("not_completed")
        },
        "active_patients":active,"waiting_list":waiting,"next":next
    })))
}

async fn rooms(state: &Service, headers: &HeaderMap) -> ApiResult {
    let role = authenticated_role(&state.pool, headers).await?;
    allowed(&role, &["admin"])?;
    let rows=sqlx::query("SELECT id,name,code,type,capacity,description,active FROM rooms ORDER BY active DESC,name")
        .fetch_all(&state.pool).await
        .map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"Кабінети недоступні"))?;
    Ok(Json(Value::Array(rows.into_iter().map(|r|json!({
        "id":r.get::<i64,_>("id"),"name":r.get::<String,_>("name"),
        "code":r.get::<String,_>("code"),"type":r.get::<String,_>("type"),
        "capacity":r.get::<i32,_>("capacity"),"description":r.get::<String,_>("description"),
        "active":r.get::<bool,_>("active")
    })).collect())))
}

async fn readiness(State(state):State<Service>)->ApiResult {
    let connected=sqlx::query_scalar::<_,i64>("SELECT 1").fetch_optional(&state.pool).await
        .map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"PostgreSQL недоступна"))?;
    if connected!=Some(1){return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE,"PostgreSQL недоступна"));}
    Ok(Json(json!({"ok":true,"runtime":"rust","version":NATIVE_VERSION,
        "legacy_bridge":state.old_api.is_some(),"native_reads_enabled":state.native_reads})))
}

async fn endpoint(State(state):State<Service>, request:Request)->Response {
    if !valid_api_path(request.uri().path()) {
        return ApiError(StatusCode::NOT_FOUND,"Невідомий маршрут").into_response();
    }
    // Rollout is opt-in. Unported APIs retain exactly the current C++ contract.
    if state.native_reads && request.method()==axum::http::Method::GET {
        match request.uri().path() {
            "/api/workday/home" => return match workday_home(&state,request.headers()).await {
                Ok(x)=>x.into_response(),Err(e)=>e.into_response()
            },
            "/api/rooms" => return match rooms(&state,request.headers()).await {
                Ok(x)=>x.into_response(),Err(e)=>e.into_response()
            },
            _=>{}
        }
    }
    let Some(root)=&state.old_api else {
        return ApiError(StatusCode::NOT_IMPLEMENTED,
            "Цей API ще переноситься на Rust; не використовуйте тестовий сервер у центрі").into_response();
    };
    let mut target=root.clone();
    target.set_path(request.uri().path());
    target.set_query(request.uri().query());
    let method=match reqwest::Method::from_bytes(request.method().as_str().as_bytes()){
        Ok(m)=>m,Err(_)=>return ApiError(StatusCode::METHOD_NOT_ALLOWED,"Метод не підтримується").into_response()
    };
    let headers=request.headers().clone();
    let (_,body)=request.into_parts();
    let bytes=match to_bytes(body,MAX_REQUEST).await {
        Ok(bytes)=>bytes,
        Err(_)=>return ApiError(StatusCode::PAYLOAD_TOO_LARGE,"Запит завеликий").into_response(),
    };
    let mut call=state.client.request(method,target);
    for key in [header::AUTHORIZATION,header::ACCEPT,header::CONTENT_TYPE] {
        if let Some(v)=headers.get(&key){call=call.header(key.clone(),v.clone());}
    }
    let response=match call.body(bytes).send().await {
        Ok(r)=>r,Err(_)=>return ApiError(StatusCode::BAD_GATEWAY,"Чинний API недоступний").into_response()
    };
    let status=response.status();
    let content_type=response.headers().get(header::CONTENT_TYPE).cloned();
    let content_disposition=response.headers().get(header::CONTENT_DISPOSITION).cloned();
    let content_length=response.content_length();
    if content_length.is_some_and(|n|n>MAX_RESPONSE as u64){
        return ApiError(StatusCode::BAD_GATEWAY,"Відповідь занадто велика").into_response();
    }
    let bytes=match response.bytes().await {
        Ok(bytes) if bytes.len()<=MAX_RESPONSE => bytes,
        _ => return ApiError(StatusCode::BAD_GATEWAY,"Не вдалося прочитати відповідь").into_response()
    };
    let mut response=Response::builder().status(status)
        .header(header::CACHE_CONTROL,"no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS,"nosniff");
    if let Some(value)=content_type {response=response.header(header::CONTENT_TYPE,value);}
    if let Some(value)=content_disposition {response=response.header(header::CONTENT_DISPOSITION,value);}
    response.body(Body::from(bytes)).expect("valid response")
}

#[tokio::main]
async fn main()->Result<(),Box<dyn std::error::Error>> {
    let database=env::var("SOLVIA_DATABASE_URL")
        .or_else(|_|env::var("DATABASE_URL"))
        .map_err(|_|"Вкажіть SOLVIA_DATABASE_URL для тестової бази PostgreSQL")?;
    let pool=PgPoolOptions::new().max_connections(8).connect(&database).await?;
    let old_api=env::var("SOLVIA_LEGACY_API").ok().map(|s|old_api_url(&s)).transpose()?;
    let state=Service{
        pool,old_api,
        native_reads:env::var("SOLVIA_RUST_NATIVE_READS").as_deref()==Ok("1"),
        client:Client::builder().timeout(std::time::Duration::from_secs(120))
            .connect_timeout(std::time::Duration::from_secs(5))
            .redirect(Policy::none()).no_proxy().build()?,
    };
    let app=Router::new()
        .route("/__rust/health",get(readiness))
        .route("/api",any(endpoint))
        .route("/api/{*path}",any(endpoint))
        .layer(axum::extract::DefaultBodyLimit::disable())
        .with_state(state);
    // Do not expose this migration sidecar to LAN: only existing Caddy TLS
    // can become the public gateway AFTER parity/rollout checks pass.
    let addr:SocketAddr="127.0.0.1:8766".parse()?;
    let listener=tokio::net::TcpListener::bind(addr).await?;
    eprintln!("SOLVIA Rust migration API on http://{addr} (localhost only)");
    axum::serve(listener,app).await?;
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn only_localhost_old_api(){
        for value in ["http://127.0.0.1:8765","http://localhost:8765","http://[::1]:8765"] {
            assert!(old_api_url(value).is_ok(),"{value}");
        }
        for value in ["https://127.0.0.1:8765","http://10.0.0.3:8765",
            "http://user:password@localhost:8765","http://localhost:8765/patients",
            "http://localhost:8765?token=hi"]{
            assert!(old_api_url(value).is_err(),"{value}");
        }
    }
    #[test]
    fn path_is_limited_to_api(){
        for p in ["/api","/api/health","/api/patients/1"]{assert!(valid_api_path(p));}
        for p in ["/admin","//evil/api","/api//evil","/api\\evil"]{assert!(!valid_api_path(p));}
    }
    #[test]
    fn read_model_roles(){
        assert!(allowed("admin",&["admin","reception"]).is_ok());
        assert!(allowed("reception",&["admin","reception"]).is_ok());
        assert!(allowed("psychologist",&["admin","reception"]).is_err());
        assert!(allowed("director",&["admin","reception"]).is_err());
        assert!(allowed("reception",&["admin"]).is_err());
    }
}
