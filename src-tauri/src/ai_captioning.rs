use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use base64::{Engine as _, engine::general_purpose};

#[derive(Debug, Serialize, Deserialize)]
pub struct CaptionRequest {
    pub image_path: String,
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub system_prompt: String,
    pub endpoint: Option<String>,
    pub custom_body_template: Option<String>,
    pub custom_headers: Option<String>,
    pub response_field: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CaptionResult {
    pub caption: String,
    pub raw_request: Option<String>,
    pub raw_response: Option<String>,
}

pub async fn generate(req: CaptionRequest) -> Result<CaptionResult, String> {
    // If empty, supply a 1x1 placeholder PNG for testing
    let (bytes, mime_type) = if req.image_path.trim().is_empty() {
        use base64::{engine::general_purpose, Engine as _};
        let b = general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
            .unwrap_or_default();
        (b, "image/png")
    } else {
        let b = fs::read(&req.image_path)
            .map_err(|e| format!("Failed to read image: {}", e))?;
        
        let m = match std::path::Path::new(&req.image_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str() {
                "png" => "image/png",
                "webp" => "image/webp",
                _ => "image/jpeg",
            };
        (b, m)
    };

    use base64::{engine::general_purpose, Engine as _};
    let b64 = general_purpose::STANDARD.encode(bytes);

    match req.provider.as_str() {
        "google" => call_gemini(req.model, req.api_key, req.system_prompt, b64, mime_type).await.map(|c| CaptionResult { caption: c, raw_request: None, raw_response: None }),
        "openai" => call_openai(req.model, req.api_key, req.system_prompt, b64, mime_type).await.map(|c| CaptionResult { caption: c, raw_request: None, raw_response: None }),
        "anthropic" => call_anthropic(req.model, req.api_key, req.system_prompt, b64, mime_type).await.map(|c| CaptionResult { caption: c, raw_request: None, raw_response: None }),
        "openrouter" => call_openrouter(req.model, req.api_key, req.system_prompt, b64, mime_type).await.map(|c| CaptionResult { caption: c, raw_request: None, raw_response: None }),
        "custom" => call_custom(req.model, req.api_key, req.system_prompt, b64, mime_type, req.endpoint, req.custom_body_template, req.custom_headers, req.response_field).await,
        _ => Err(format!("Unsupported provider: {}", req.provider)),
    }
}

async fn call_gemini(model: String, api_key: String, prompt: String, b64: String, mime_type: &str) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let body = json!({
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": b64
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.4,
            "topP": 0.8,
            "topK": 40,
            "maxOutputTokens": 2048,
        }
    });

    let client = reqwest::Client::new();
    let res = client.post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err) = json.get("error") {
        return Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Gemini error").to_string());
    }

    json.pointer("/candidates/0/content/parts/0/text")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("Invalid response from Gemini: {:?}", json))
}

async fn call_openai(model: String, api_key: String, prompt: String, b64: String, mime_type: &str) -> Result<String, String> {
    let url = "https://api.openai.com/v1/chat/completions";

    let body = json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{};base64,{}", mime_type, b64)
                        }
                    }
                ]
            }
        ],
        "max_tokens": 500
    });

    let client = reqwest::Client::new();
    let res = client.post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = json.get("error") {
        return Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown OpenAI error").to_string());
    }

    json.pointer("/choices/0/message/content")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("Invalid response from OpenAI: {:?}", json))
}

async fn call_anthropic(model: String, api_key: String, prompt: String, b64: String, mime_type: &str) -> Result<String, String> {
    let url = "https://api.anthropic.com/v1/messages";

    let body = json!({
        "model": model,
        "max_tokens": 1024,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": b64
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ]
    });

    let client = reqwest::Client::new();
    let res = client.post(url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = json.get("error") {
        return Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Anthropic error").to_string());
    }

    // Anthropic response structure: content[0].text
    json.pointer("/content/0/text")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("Invalid response from Anthropic: {:?}", json))
}

async fn call_openrouter(model: String, api_key: String, prompt: String, b64: String, mime_type: &str) -> Result<String, String> {
    let url = "https://openrouter.ai/api/v1/chat/completions";

    let body = json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{};base64,{}", mime_type, b64)
                        }
                    }
                ]
            }
        ],
        "max_tokens": 500
    });

    let client = reqwest::Client::new();
    let res = client.post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://github.com/beautiful-batches")
        .header("X-Title", "Beautiful Batches")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown OpenRouter error").to_string());
    }

    json.pointer("/choices/0/message/content")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("Invalid response from OpenRouter: {:?}", json))
}

async fn call_custom(
    model: String,
    api_key: String,
    prompt: String,
    b64: String,
    mime_type: &str,
    endpoint: Option<String>,
    custom_body_template: Option<String>,
    custom_headers: Option<String>,
    response_field: Option<String>,
) -> Result<CaptionResult, String> {
    let endpoint = endpoint.ok_or_else(|| "Missing endpoint for custom API".to_string())?;
    let template = custom_body_template.unwrap_or_else(|| "{}".to_string());
    
    // Process string replacement inside JSON (handles escaping logic safely because we are putting raw strings in a JSON payload? 
    // actually doing string replace might break JSON if prompt has quotes. Better to use replace on template but we must be careful.
    // simpler fix: parse to serde_json::Value and deep-replace.
    // Given the straightforward string template approach, we will replace, but we must escape JSON strings.
    let escaped_prompt = prompt.replace("\"", "\\\"").replace("\n", "\\n");
    let escaped_model = model.replace("\"", "\\\"");

    let body_str = template
        .replace("{{model}}", &escaped_model)
        .replace("{{prompt}}", &escaped_prompt)
        .replace("{{image}}", &format!("data:{};base64,{}", mime_type, b64))
        .replace("{{mime}}", mime_type)
        .replace("{{base64}}", &b64);
        
    let body_json: serde_json::Value = serde_json::from_str(&body_str)
        .map_err(|e| format!("Invalid JSON template after replacing placeholders. Error: {}\nTemplate Preview: {:.100}", e, body_str))?;

    let mut headers = reqwest::header::HeaderMap::new();
    
    if !api_key.trim().is_empty() {
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key.trim())) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
        }
    }
    
    if let Some(custom) = custom_headers {
        for line in custom.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Some((k, v)) = line.split_once(':') {
                if let Ok(key) = reqwest::header::HeaderName::from_bytes(k.trim().as_bytes()) {
                    if let Ok(val) = reqwest::header::HeaderValue::from_str(v.trim()) {
                        headers.insert(key, val);
                    }
                }
            }
        }
    }
    
    let client_builder = reqwest::Client::builder();
    let client = client_builder.default_headers(headers).build().map_err(|e| e.to_string())?;
    
    let res = client.post(&endpoint)
        .json(&body_json)
        .send()
        .await
        .map_err(|e| e.to_string())?;
        
    let raw_response = res.text().await.map_err(|e| e.to_string())?;
    
    let resp_json: Option<serde_json::Value> = serde_json::from_str(&raw_response).ok();
    
    let mut caption = String::new();
    let mut has_caption = false;
    
    if let Some(field) = response_field {
        let field_clean = field.trim();
        if !field_clean.is_empty() && resp_json.is_some() {
            let pointer_str = format!("/{}", field_clean.replace(".", "/").replace("[", "/").replace("]", ""));
            // Clean up consecutive slashes if there are arrays
            let pointer_str = pointer_str.replace("//", "/");
            
            if let Some(v) = resp_json.as_ref().unwrap().pointer(&pointer_str) {
                if let Some(s) = v.as_str() {
                    caption = s.trim().to_string();
                    has_caption = true;
                } else if let Some(n) = v.as_number() {
                    caption = n.to_string();
                    has_caption = true;
                }
            }
        }
    }
    
    if !has_caption {
        caption = "Failed to extract caption from response.".to_string();
    }
    
    Ok(CaptionResult {
        caption,
        raw_request: Some(body_str),
        raw_response: Some(raw_response),
    })
}
