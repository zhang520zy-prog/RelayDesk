//! Ephemeral loopback POST bridge for the relay-signed Epay form.
use crate::error::AppError;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

fn invalid() -> AppError {
    AppError::Message("relay.checkout_invalid".into())
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn form(raw: &Value) -> Result<(String, String), AppError> {
    let target = raw.get("url").and_then(Value::as_str).ok_or_else(invalid)?;
    let url = url::Url::parse(target).map_err(|_| invalid())?;
    if url.scheme() != "https"
        || url.host_str() != Some("epay.pledgeuai.com")
        || url.path() != "/submit.php"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let data = raw
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    let trade = data
        .get("out_trade_no")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(invalid)?
        .to_string();
    let allowed = [
        "device",
        "money",
        "name",
        "notify_url",
        "out_trade_no",
        "pid",
        "return_url",
        "sign",
        "sign_type",
        "type",
    ];
    if !["money", "pid", "sign", "sign_type", "type"]
        .iter()
        .all(|key| {
            data.get(*key)
                .and_then(Value::as_str)
                .is_some_and(|v| !v.is_empty())
        })
    {
        return Err(invalid());
    }
    let mut inputs = String::new();
    for (key, value) in data {
        if !allowed.contains(&key.as_str()) {
            return Err(invalid());
        }
        let value = value.as_str().ok_or_else(invalid)?;
        if value.len() > 4096 {
            return Err(invalid());
        }
        inputs.push_str(&format!(
            "<input type=hidden name=\"{}\" value=\"{}\">",
            escape(key),
            escape(value)
        ));
    }
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let html=format!("<!doctype html><meta charset=utf-8><meta name=referrer content=no-referrer><meta http-equiv=Content-Security-Policy content=\"default-src 'none'; form-action https://epay.pledgeuai.com; script-src 'nonce-{nonce}'; base-uri 'none'\"><title>RelayDesk checkout</title><form method=post action=\"{}\">{inputs}<button type=submit>Continue to payment / 前往付款</button></form><script nonce=\"{nonce}\">document.forms[0].submit()</script>",escape(target));
    Ok((trade, html))
}
pub fn serve(html: String) -> Result<String, AppError> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| invalid())?;
    listener.set_nonblocking(true).map_err(|_| invalid())?;
    let addr = listener.local_addr().map_err(|_| invalid())?;
    let route = format!("/{}", uuid::Uuid::new_v4().simple());
    let url = format!("http://{addr}{route}");
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let mut buf = [0u8; 8192];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let valid =
                        request.lines().next() == Some(format!("GET {route} HTTP/1.1").as_str());
                    let body = if valid { html.as_str() } else { "Not found" };
                    let code = if valid { "200 OK" } else { "404 Not Found" };
                    let response=format!("HTTP/1.1 {code}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                    let _ = stream.write_all(response.as_bytes());
                    if valid {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(30))
                }
                Err(_) => break,
            }
        }
    });
    Ok(url)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checkout_rejects_untrusted_hosts() {
        assert!(form(
            &serde_json::json!({"url":"https://epay.pledgeuai.com.evil/submit.php","data":{}})
        )
        .is_err());
    }
    fn fixture() -> Value {
        serde_json::json!({"url":"https://epay.pledgeuai.com/submit.php", "data":{
            "out_trade_no":"fixture", "money":"10.00", "pid":"1", "sign":"fixture-sign", "sign_type":"MD5", "type":"alipay"
        }})
    }
    #[test]
    fn signed_form_validates_fields_and_does_not_interpret_html() {
        let mut raw = fixture();
        raw["data"]["name"] = Value::String("\"><script>bad</script>".into());
        let (trade, html) = form(&raw).unwrap();
        assert_eq!(trade, "fixture");
        assert!(!html.contains("<script>bad</script>"));
        assert!(html.contains("&lt;script&gt;"));
        raw["data"]["unexpected"] = Value::String("x".into());
        assert!(form(&raw).is_err());
        let mut raw = fixture();
        raw["data"]["sign"] = Value::Null;
        assert!(form(&raw).is_err());
        raw = fixture();
        raw["data"]["money"] = serde_json::json!(10);
        assert!(form(&raw).is_err());
    }
    #[test]
    fn rejects_gateway_url_overrides() {
        for url in [
            "http://epay.pledgeuai.com/submit.php",
            "https://epay.pledgeuai.com/other",
            "https://user@epay.pledgeuai.com/submit.php",
            "https://epay.pledgeuai.com/submit.php?q=1",
            "https://epay.pledgeuai.com/submit.php#x",
        ] {
            let mut raw = fixture();
            raw["url"] = Value::String(url.into());
            assert!(form(&raw).is_err());
        }
    }
    #[test]
    fn escapes_form_values() {
        assert_eq!(escape("\"<>&'"), "&quot;&lt;&gt;&amp;&#39;");
    }
}
