# LLM Provider Layer Technical Design

> *Science-GPT is not locked to a single AI provider. This document describes how the backend routes extraction and evaluation requests across seven different providers — Azure OpenAI, Gemini, Anthropic, Llama, Macbook (local), and vLLM — through a common interface. It covers how each provider client works, how timeouts and retries are handled, how structured outputs are extracted from different response formats, and how every call's cost and token usage is recorded.*

This document describes the provider-routing layer implemented under `backend/services/llm/`. It covers classes, request/response contracts, timeout/retry behavior, concurrency controls, and cost-tracking integration.

## 1. Scope

In scope:

- `LLMService` provider dispatch;
- provider client responsibilities;
- extraction, image extraction, and paragraph generation methods;
- return dictionary conventions;
- timeout/retry behavior;
- Macbook queue serialization;
- cost/session metric recording.

Out of scope:

- frontend model picker UI;
- provider account provisioning;
- exact model availability at runtime.

## Visual workflow

![LLM provider routing workflow](images/llm-provider-routing.png)

All text and vision model use goes through `LLMService`. The routers provide the operation-specific context, while `LLMService` selects the provider client from `model_type`, applies timeout logging, normalizes the provider dictionary, and records session metrics on successful responses. Provider clients own SDK or REST details, including retries, model-name translation, structured output support, local Macbook serialization, and OpenAI-compatible vLLM calls. Downstream code should rely on the common result keys rather than provider-specific raw payloads whenever possible.

## 2. Main classes

| Class | File | Responsibility |
| --- | --- | --- |
| `LLMService` | `backend/services/llm/llm_service.py` | High-level router across provider clients. |
| `AzureLLMClient` | `backend/services/llm/azure.py` | Azure OpenAI / Azure AI Foundry REST+SDK calls. |
| `GeminiLLMClient` | `backend/services/llm/gemini.py` | Vertex AI Gemini text and vision calls. |
| `AnthropicLLMClient` | `backend/services/llm/anthropic.py` | Anthropic-on-Vertex calls. |
| `LlamaLLMClient` | `backend/services/llm/llama.py` | Vertex AI MaaS Llama calls. |
| `MacbookLLMClient` | `backend/services/llm/macbook.py` | Ollama-compatible Macbook-hosted inference. |
| `MacbookRequestQueue` | `backend/services/llm/macbook_queue.py` | FIFO single-worker queue for Macbook inference. |
| `VLLMClient` | `backend/services/llm/vllm.py` | OpenAI-compatible vLLM endpoint client. |

## 3. `LLMService`

`LLMService` owns provider client instances and exposes three main operations:

- `extract_entities_from_markdown(...)`
- `extract_content_from_image(...)`
- `generate_paragraph(...)`

It also records usage/cost metrics through `_record_session_metrics()` after successful provider calls.

### 3.1 Provider dispatch for entity extraction

`extract_entities_from_markdown()` dispatches by `model_type`:

| `model_type` | Client method |
| --- | --- |
| `azure` | `AzureLLMClient.extract_entities_with_azure()` |
| `gemini` | `GeminiLLMClient.extract_entities_with_gemini()` |
| `anthropic` | `AnthropicLLMClient.extract_entities_with_anthropic()` |
| `llama` | `LlamaLLMClient.extract_entities_with_llama()` |
| `azure-llama` | currently routed through Azure client path |
| `macbook` | `MacbookLLMClient.extract_entities_with_macbook()` |
| `vllm` | `VLLMClient.extract_entities_with_vllm()` |

Provider-disabled clients return structured `success=False` responses rather than crashing the whole app.

### 3.2 Timeout budgets

Default wrapper timeout is 240 seconds, with provider-specific overrides:

| Provider path | Timeout |
| --- | ---: |
| Azure/Gemini/Anthropic | 240s default wrapper |
| Llama | 300s |
| Macbook | 1900s |
| vLLM | 600s |

Timeouts are logged to `backend/output/timeout_logs/timeout_log.txt`.

### 3.3 Session metrics

On successful responses, `_record_session_metrics(session_id, provider, result)` extracts:

- provider;
- model/deployment;
- prompt tokens;
- completion tokens;
- duration.

Then it calls `cost_tracker.record_call(...)`.

## 4. Common response conventions

Provider clients return dictionaries rather than a shared class. Common keys:

| Key | Meaning |
| --- | --- |
| `success` | Boolean success flag. |
| `content` | Main text result. |
| `answer` | Structured answer text, when available. |
| `references` | Structured references, when available. |
| `raw` | Raw provider response or parsed JSON. |
| `meta` | Provider/model/timing/token metadata. |
| `error` | Error text when `success=False`. |

Provider-specific clients may also return compatibility fields such as `extracted_text`, `generated_text`, `usage`, `model`, or strategy metadata.

Downstream code should check `success` and then normalize provider-specific fields.

## 5. Azure provider

Class: `AzureLLMClient`

### 5.1 Configuration

Supports:

- global Azure OpenAI env vars;
- `AZURE_OPENAI_MODELS` JSON list for per-deployment endpoints/keys/API versions;
- Azure AI Foundry serverless endpoints detected by `.services.ai.azure.com`.

### 5.2 Entity extraction

Primary path uses OpenAI SDK structured outputs:

- Pydantic `MarkdownReference`
- Pydantic `ExtractionResult`
- `client.beta.chat.completions.parse(...)`
- JSON response format with answer and references

Fallback path uses raw REST `requests.post()` if structured parsing fails.

Retry behavior:

- up to 3 attempts;
- retry on 429, 500, 503, 504 or matching exception text;
- exponential backoff with jitter;
- temperature-related 400 errors can retry without `temperature`.

### 5.3 Paragraph generation

Uses REST chat completions. Payload includes messages, max completion tokens, `n=1`, optional temperature, and Foundry-specific model field when needed.

### 5.4 Vision extraction

Reads image as base64 and sends a multimodal chat payload with text and image data URL through REST using `aiohttp`.

## 6. Gemini provider

Class: `GeminiLLMClient`

### 6.1 Configuration

Requires:

- GCP project id;
- Vertex location;
- service account credentials.

Supports env aliases such as `GEMINI_PROJECT_ID`, `GEMINI_PROJECT`, `VERTEX_AI_PROJECT`, `GEMINI_LOCATION`, and `VERTEX_AI_LOCATION`.

### 6.2 Core call behavior

Builds Vertex AI publisher-model endpoint:

- global endpoint for global-only models;
- regional endpoint otherwise.

Payload supports:

- `contents`;
- `generationConfig.temperature`;
- `generationConfig.maxOutputTokens`;
- optional `responseMimeType: application/json` and `responseJsonSchema`;
- optional `systemInstruction`.

Retry behavior:

- three attempts;
- retries 429/500/503/504;
- retries empty responses, JSON parse failures, and content extraction errors;
- returns partial content if finish reason is `MAX_TOKENS`.

### 6.3 Supported extraction/generation models

Allowed short names include:

- `gemini-2.5-pro`
- `gemini-2.5-flash-lite`
- `gemini-2.5-flash`
- `gemini-3-pro-preview`

Structured extraction uses the Gemini version of `ExtractionResult.model_json_schema()`.

## 7. Anthropic provider

Class: `AnthropicLLMClient`

### 7.1 Configuration

Uses `anthropic.AnthropicVertex`, requiring Google service account credentials. It finds credentials from `GOOGLE_APPLICATION_CREDENTIALS` or JSON files under `backend/core/`.

### 7.2 Core call behavior

Calls `client.messages.create(...)` with:

- `model`
- `max_tokens`
- `messages`
- optional `system`
- optional `temperature`

For structured extraction, the code uses prompt-enforced JSON because Vertex-hosted Anthropic structured output beta is not used here.

### 7.3 Entity extraction

Default model:

- `claude-sonnet-4-5@20250929`

Structured-output prompt requests:

- `answer: string`
- `references: [{ text: string }]`

## 8. Llama provider

Class: `LlamaLLMClient`

### 8.1 Configuration

Uses Vertex AI MaaS OpenAI-compatible endpoint. Requires project, location/region, and service account credentials.

### 8.2 Region routing

- Llama 4 models route to `us-east5`.
- Llama 3.x models route to `us-central1`.

### 8.3 Extraction algorithm

Primary strategy:

1. Optimize/truncate long prompts and markdown.
2. Request JSON object output.
3. Validate response with Pydantic `ExtractionResult`.
4. Return answer/references and `strategy='primary_optimized'`.

Fallback strategy:

1. Minimal system prompt.
2. Shortened context.
3. Low token budget.
4. Return `strategy='fallback_minimal'`.

Parsing error handling writes diagnostic JSON logs under `backend/logs/llama_errors/` and attempts to salvage embedded JSON fragments.

## 9. Macbook provider

Class: `MacbookLLMClient`

### 9.1 Configuration

Uses:

- `MACBOOK_LLM_BASE_URL`
- optional retry/backoff/timeout env vars;
- `backend/config/macbook_model_policy.json` for allow/deny model filtering.

The endpoint is Ollama-style:

- `GET /api/tags`
- `POST /api/generate`

### 9.2 Queueing

Macbook calls are serialized through `MacbookRequestQueue`.

Queue behavior:

- one background worker;
- FIFO `asyncio.Queue`;
- caller awaits a future;
- failed worker is restarted on next enqueue;
- stats expose total enqueued, processed, pending, and worker state.

This prevents concurrent requests from overwhelming a local Macbook-hosted model runtime.

### 9.3 Response cleanup

`_sanitize_content()` strips reasoning/thinking tags and preserves user-facing content.

## 10. vLLM provider

Class: `VLLMClient`

### 10.1 Configuration

Uses:

- `VLLM_BASE_URL`
- optional `VLLM_API_KEY`
- optional `VLLM_MODELS`

If static models are configured, `fetch_available_models()` uses them. Otherwise it queries `GET /models`.

### 10.2 Core call

Calls OpenAI-compatible:

```text
POST {base_url}/chat/completions
```

Payload:

- `model`
- `messages`
- `max_tokens`
- `temperature`

Default timeout is 600 seconds.

If model id starts with `vllm-`, the prefix is stripped before sending to the backend.

## 11. Cost tracking integration

`LLMService` records successful calls only.

Cost tracker uses:

- provider;
- normalized model key;
- prompt/completion token counts;
- duration;
- optional document/page metadata for document parser costs.

See [11-auth-security-observability.md](11-auth-security-observability.md) for telemetry details.

## 12. Error behavior

| Provider | Error style |
| --- | --- |
| Azure | Returns `success=False` with error/raw details; retries transient failures. |
| Gemini | Returns structured error or fallback partial content on token truncation. |
| Anthropic | Returns error dict for API/JSON parsing failures. |
| Llama | Uses primary/fallback strategies and parsing diagnostics. |
| Macbook | Retries 5xx/HTML/bad-gateway/request exceptions until attempt/total cap. |
| vLLM | Returns error for timeout, non-200, or missing choices. |

## 13. Related docs

- [07-extraction-flow.md](07-extraction-flow.md)
- [08-evaluation-flow.md](08-evaluation-flow.md)
- [11-auth-security-observability.md](11-auth-security-observability.md)
