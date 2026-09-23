use relaydesk_lib::relay::{RelayService, RelayUsageQuery};
use relaydesk_lib::{AppState, Database};
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let state = AppState::new(Arc::new(Database::memory().unwrap()));
    let user = std::env::var("RELAY_PROBE_USER").unwrap();
    let pass = std::env::var("RELAY_PROBE_PASS").unwrap();
    match RelayService::login(&state, "https://www.shenlanqaq.com", &user, &pass, false).await {
        Ok(_) => println!("login=ok"),
        Err(_) => {
            println!("login=failed");
            return;
        }
    }
    let end = chrono::Utc::now();
    let query = || RelayUsageQuery {
        start: (end - chrono::Duration::days(7)).to_rfc3339(),
        end: end.to_rfc3339(),
        timezone: Some("Asia/Shanghai".into()),
        group: None,
        model_name: None,
        token_name: None,
        r#type: None,
        cursor: None,
        page_size: Some(100),
    };
    match RelayService::usage_models(&state, query()).await {
        Ok(rows) => {
            println!(
                "detail_rows={}",
                rows.items
                    .iter()
                    .filter(|r| r.input_tokens.is_some())
                    .count()
            );
            println!(
                "models=ok rows={} nonzero={}",
                rows.items.len(),
                rows.items.iter().any(|r| r.total_tokens.unwrap_or(0) > 0)
            )
        }
        Err(e) => println!("models=failed {e}"),
    }
    match RelayService::usage_summary(&state, query()).await {
        Ok(s) => println!("summary=ok nonzero={}", s.total_tokens.unwrap_or(0) > 0),
        Err(e) => println!("summary=failed {e}"),
    }
    if std::env::var("RELAY_PROBE_CHECKOUT").as_deref() == Ok("1") {
        match RelayService::create_topup_payment(&state, "alipay", 10.0, "manual-checkout-probe")
            .await
        {
            Ok(order) => {
                println!("checkout={}", order.checkout_url.unwrap_or_default());
                tokio::time::sleep(std::time::Duration::from_secs(180)).await;
            }
            Err(_) => println!("checkout=failed"),
        }
    }
}
