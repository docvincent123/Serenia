//! Desktop-only shell. Server-side roles and patient permissions remain
//! enforced by the existing SOLVIA API, never by the UI or this proxy.

use reqwest::{redirect::Policy, Client, Method, Url};
use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 48 * 1024 * 1024;

#[derive(Serialize)]
struct ApiResponse {
    status: u16,
    body: String,
}

fn valid_base(base: &str) -> Result<Url, String> {
    let url = Url::parse(base).map_err(|_| "Некоректна адреса сервера SOLVIA")?;
    let hostname = url.host_str().ok_or("Адреса сервера не містить назви хоста")?;
    let loopback = matches!(hostname, "localhost" | "127.0.0.1" | "[::1]");
    if url.scheme() != "https" && !(loopback && url.scheme() == "http") {
        return Err("Для мережевого сервера обов'язковий HTTPS".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (url.path() != "/" && !url.path().is_empty())
    {
        return Err("Вкажіть лише адресу та порт SOLVIA, без інших параметрів".into());
    }
    Ok(url)
}

fn valid_api_path(path: &str) -> Result<(), String> {
    // No arbitrary URLs, protocol-relative paths, control bytes or fragments.
    if !(path == "/api" || path.starts_with("/api/"))
        || path.chars().any(|c| c.is_control())
        || path.contains('#')
    {
        return Err("Дозволені лише шляхи /api/... сервера SOLVIA".into());
    }
    let parsed = Url::parse(&format!("https://solvia.invalid{path}"))
        .map_err(|_| "Некоректний шлях API")?;
    if parsed.host_str() != Some("solvia.invalid")
        || !(parsed.path() == "/api" || parsed.path().starts_with("/api/"))
    {
        return Err("Некоректний шлях API".into());
    }
    Ok(())
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .redirect(Policy::none())
            // Never send patient/session data via an environment-configured proxy.
            .no_proxy()
            // Native TLS checks certificates against trusted system roots.
            .build()
            .expect("native TLS HTTP client initialization")
    })
}

#[tauri::command]
async fn solvia_api_request(
    base: String,
    token: Option<String>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<ApiResponse, String> {
    let root = valid_base(&base)?;
    valid_api_path(&path)?;
    let method = Method::from_bytes(method.as_bytes())
        .map_err(|_| "Невідомий HTTP-метод")?;
    if !matches!(method, Method::GET | Method::HEAD | Method::POST | Method::PUT | Method::PATCH | Method::DELETE) {
        return Err("Недозволений HTTP-метод".into());
    }

    let url = root.join(&path).map_err(|_| "Не вдалося створити адресу API")?;
    let mut request = client().request(method.clone(), url).header("Accept", "application/json");
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }
    if method != Method::GET && method != Method::HEAD {
        let data = serde_json::to_vec(&body.unwrap_or_else(|| serde_json::json!({})))
            .map_err(|_| "Некоректне тіло запиту")?;
        if data.len() > MAX_REQUEST_BYTES {
            return Err("Запит завеликий".into());
        }
        request = request.header("Content-Type", "application/json").body(data);
    }

    let mut response = request.send().await.map_err(|_| {
        "Немає зв'язку із сервером або сертифікат центру не є довіреним".to_string()
    })?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Помилка читання відповіді")? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("Відповідь сервера завелика".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| "Сервер повернув не-UTF-8 відповідь")?;
    Ok(ApiResponse { status, body })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![solvia_api_request])
        .run(tauri::generate_context!())
        .expect("SOLVIA Tauri failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_localhost_http_only() {
        assert!(valid_base("http://127.0.0.1:8765").is_ok());
        assert!(valid_base("https://192.168.1.105:8443").is_ok());
        assert!(valid_base("http://192.168.1.105:8765").is_err());
    }

    #[test]
    fn rejects_credentials_and_foreign_paths() {
        for base in ["https://user:pass@server", "https://server/api", "file:///tmp", "https://server/?x=1"] {
            assert!(valid_base(base).is_err(), "{base}");
        }
        for path in ["/other", "//evil.invalid/api/health", "/api/ok#fragment", "/api/../../other", "https://evil.invalid/api"] {
            assert!(valid_api_path(path).is_err(), "{path}");
        }
        assert!(valid_api_path("/api/health").is_ok());
        assert!(valid_api_path("/api/patients?q=test").is_ok());
    }
}
