# Model API providers

Agent Office can connect a model API as an external agent. The bridge owns the
credentials and makes the outbound request; the browser only receives provider
metadata, model names and aggregated token counts.

The model can power Mission Control's AI discussion and **full auto-run**: the
bridge executes dependency-ready tasks and stores each report plus a Markdown
deliverable. It is still **not a code execution sandbox**; repository changes
need an external Agent or a tool-enabled runtime. Provider-managed agents do not
poll assignments; MCP or pairing is the path for a real external worker.

For the beginner path, see [AI setup and auto-run](AI_SETUP.md).

## Security model

- API keys are read only by `bridge.py`, from environment variables or
  `~/.agent-office/providers.json`.
- A pasted key travels only to the local bridge configure endpoint. The bridge never returns it; the browser does not store it in localStorage, IndexedDB, task records or exports.
- The config lives outside the static web root, so
  `http://127.0.0.1:5173/providers.json` cannot serve it.
- The legacy repo-root `providers.local.json` name is ignored by git as an extra
  guard, but do not put real keys inside the repository.
- Prompts and responses are sent to the provider you configure. Do not send
  secrets in prompts.
- `GET /providers` returns whether a provider is configured, but never returns
  the key.
- Keep the bridge on loopback. See [SECURITY.md](../SECURITY.md).

## Configure

### Option A: three-step UI (recommended)

Open **Tools → AI model service → Connect AI in 3 steps**:

1. pick a provider;
2. reuse detected local credentials or paste an API key;
3. test and enable. The bridge writes the file with mode `0600` only after the
   test passes.

### Option B: environment variables

Restart the bridge after changing environment variables:

```bash
export DEEPSEEK_API_KEY=sk-...
export GEMINI_API_KEY=...
export DOUBAO_API_KEY=...
./start.sh
```

Claude-compatible gateways commonly use `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL`; these are supported in addition to
`ANTHROPIC_API_KEY`. OpenAI-compatible gateways also accept `OPENAI_BASE_URL` /
`OPENAI_API_BASE` and `OPENAI_MODEL`.

### Option C: `~/.agent-office/providers.json`

Create the directory and file. The bridge reads it on every request, so no
restart is needed after editing it. It is outside the static app directory, so
the web server cannot serve it.

```bash
mkdir -p ~/.agent-office
cat > ~/.agent-office/providers.json <<'JSON'
{
  "deepseek": { "apiKey": "sk-...", "model": "deepseek-chat" }
}
JSON
```

```json
{
  "deepseek": {
    "apiKey": "sk-...",
    "model": "deepseek-chat"
  },
  "gemini": {
    "apiKey": "...",
    "model": "gemini-2.5-flash"
  },
  "doubao": {
    "apiKey": "...",
    "model": "doubao-seed-1-6-250615"
  },
  "workbuddy": {
    "baseUrl": "http://127.0.0.1:10108/v1",
    "model": "hy3"
  }
}
```

`providers.example.json` is a safe template. Never commit a filled-in copy.
You can also point the bridge at another config file:

```bash
BRIDGE_PROVIDERS=/absolute/path/to/providers.json python3 bridge.py
```

## Provider presets

| id | Provider | Protocol | Default model | Default base URL | Key env |
| --- | --- | --- | --- | --- | --- |
| `doubao` | 豆包 / Volcengine Ark | OpenAI-compatible | `doubao-seed-1-6-250615` | `https://ark.cn-beijing.volces.com/api/v3` | `DOUBAO_API_KEY` or `ARK_API_KEY` |
| `deepseek` | DeepSeek | OpenAI-compatible | `deepseek-chat` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| `workbuddy` | Tencent WorkBuddy | OpenAI-compatible local gateway | `hy3` | `http://127.0.0.1:10108/v1` | `WORKBUDDY_API_KEY` (optional) |
| `gemini` | Google Gemini | Gemini generateContent | `gemini-2.5-flash` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| `openai` | OpenAI | OpenAI-compatible | `gpt-4.1-mini` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `anthropic` | Claude | Anthropic Messages | `claude-sonnet-5-5` | `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` |
| `kimi` | Kimi / Moonshot | OpenAI-compatible | `kimi-latest` | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` or `KIMI_API_KEY` |
| `qwen` | 通义千问 / DashScope | OpenAI-compatible | `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` or `QWEN_API_KEY` |
| `ollama` | Ollama | OpenAI-compatible local | `llama3.2` | `http://127.0.0.1:11434/v1` | no key required |

Every preset also accepts `AGENT_OFFICE_<PROVIDER>_BASE_URL` and
`AGENT_OFFICE_<PROVIDER>_MODEL` overrides, for example
`AGENT_OFFICE_DEEPSEEK_MODEL=deepseek-reasoner` or
`AGENT_OFFICE_DOUBAO_MODEL=ep-2026...`. Base/model overrides use the
`AGENT_OFFICE_` prefix so unrelated SDK variables such as
`ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL` do not silently redirect provider
traffic. API keys still use the standard provider variables in the table.

### Doubao

Use a model name or a Volcengine Ark endpoint id. Ark's OpenAI-compatible path
is `/api/v3/chat/completions`; the bridge appends `/chat/completions` to the
base URL.

### Gemini

The bridge calls:

```text
POST {baseUrl}/models/{model}:generateContent
x-goog-api-key: <key>
```

The key is sent in a header, not a query string. The browser never sees it.

### WorkBuddy

Tencent WorkBuddy does not expose an official OpenAI-compatible HTTP API. Use a
local gateway that exposes one, then point `WORKBUDDY_BASE_URL` at it. Community
examples include:

- [workbuddy-connect](https://www.npmjs.com/package/workbuddy-connect) — npm
  package exposing a local bridge on `127.0.0.1:10108` (the default here).
- [workbuddy2api](https://github.com/3304711297/workbuddy2api) — desktop gateway
  with OpenAI, Anthropic and Responses protocols.
- [workbuddy2api-panel](https://github.com/haohaomin/workbuddy2api-panel) —
  multi-account panel, default port `7863`.

If your gateway uses a different port, set:

```json
{
  "workbuddy": {
    "baseUrl": "http://127.0.0.1:10108/v1",
    "model": "hy3",
    "apiKey": "local"
  }
}
```

Avoid port `8787` for a WorkBuddy gateway when using Agent Office's bridge; that
is the Agent Office bridge's default port. Use `10108`, `8790`, `7863`, or
change `BRIDGE_PORT`.

The gateway is a separate process; Agent Office does not install or manage it.

### Ollama

Run Ollama locally and pull the model first:

```bash
ollama pull llama3.2
python3 bridge.py
```

Ollama is keyless. The bridge uses `http://127.0.0.1:11434/v1` unless
`OLLAMA_BASE_URL` is set.

## Use in the app

1. Start both processes with `./start.sh`.
2. Open **TEAM → 接入外部 Agent**.
3. In **MODEL APIS**, click **刷新** if the bridge was already running.
4. A configured provider shows `READY` or `LOCAL`. Click **接入** to create the
   external agent, then **试跑** to send one prompt.
5. The response is written to the ledger as an external event with model,
   tokens and duration; open Trace Lab and use the `EXT` filter.

If a provider shows `NO KEY`, click **密钥配置** to copy the setup instructions.
Keys are not entered in the modal.

## API

```text
GET  /providers
GET  /providers/<id>
POST /providers/<id>/connect
POST /providers/<id>/test       {"prompt": "..."}
POST /providers/<id>/run        {"prompt": "...", "system": "...", "maxTokens": 512}
```

`GET /providers` example:

```json
{
  "providers": [
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "vendor": "DeepSeek",
      "protocol": "openai",
      "model": "deepseek-chat",
      "baseUrl": "https://api.deepseek.com/v1",
      "configured": true,
      "keyEnv": "DEEPSEEK_API_KEY",
      "local": false
    }
  ],
  "configFile": "providers.json",
  "configError": ""
}
```

`POST /providers/deepseek/run` returns text, token usage, duration and the
external event that was recorded. It does not mutate simulated task status.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `409 provider_not_configured` | Key missing; set the env var or `~/.agent-office/providers.json` |
| `502 provider_call_failed` | Wrong base URL/model, network failure, quota, or provider error body |
| WorkBuddy `connection refused` | Start the local WorkBuddy gateway; use the right port |
| Doubao 404/model error | Use a valid Ark model name or endpoint id |
| Gemini 400 | Model name must exist for the API version in `baseUrl` |
| Empty response | The provider returned no text (safety block/tool-only response) |
| Browser says page blocked | Serve the app from localhost; `file://` is blocked by default |

## Optional price table

AI setup → provider → Advanced exposes **Price table (optional)**. You can also
store it in `~/.agent-office/providers.json`:

```json
{
  "deepseek": {
    "apiKey": "sk-...",
    "model": "deepseek-chat",
    "pricing": {
      "inputPerMillion": 0.14,
      "outputPerMillion": 0.28,
      "currency": "USD"
    }
  }
}
```

- Values are per **1,000,000 tokens**, in the currency you enter.
- Both values may be zero/empty to disable pricing for that provider.
- The bridge computes `cost = in/1M × inputPrice + out/1M × outputPrice` after
  each real provider response and stores it on the model-call ledger. Saving a
  price table also reprices that provider’s historical unpriced calls.
- Unpriced calls appear as `—`; the app never invents a price.
- Cache discounts, batch discounts and taxes are not modeled.

## Limits

- One prompt per request; no streaming UI.
- No automatic task claiming or completion writeback.
- Token counts come from the provider response when available. Monetary cost is
  **not guessed**: it is `null` unless you enter an optional per-million-token
  price table (input, output, currency) in AI setup or `providers.json`. The
  ledger then computes `cost` from real tokens. Prices are user-supplied and may
  be stale; the app does not fetch vendor price lists.
- Provider errors are returned as text and are not logged as ledger events.
- The bridge does not retry automatically; use **试跑** again after fixing the
  configuration.
