# NovaChat

A polished, ChatGPT-style chat UI with a tiny Node server. Plug in your own model provider to make it a real AI assistant.

## Highlights

- Multi-thread chat history with search, tags, pinning, delete, and rename.
- Streaming replies with a Stop button (and Esc to cancel).
- Upload images + files, including PDF text extraction.
- Per-thread drafts that auto-save.
- Export current thread to `.txt`, export/import all threads as JSON.
- Light/Dark theme toggle.

All history, drafts, and settings are stored locally in your browser (localStorage).

## Run locally

1. Install Node.js 18+.
2. Start the server:

```bash
node server.js
```

3. Open `http://localhost:3000` in your browser.

Tip: A launcher is included at `start-novachat.bat` (Windows).

## Connect a real AI provider

Set these environment variables before starting the server:

- `AI_ENDPOINT` : Full URL to your provider chat endpoint.
- `AI_API_KEY` : Optional API key (sent as `Authorization: Bearer ...`).
- `AI_MODEL` : Optional default model name (used when the UI says Auto/Fast/Creative/Reasoned).
- `AI_MODELS_ENDPOINT` : Optional models list endpoint (defaults to `AI_ENDPOINT` with `/models` inferred).
- `PORT` : Optional server port (default `3000`).

Example (PowerShell):

```powershell
$env:AI_ENDPOINT = "https://your-provider.example/v1/chat/completions"
$env:AI_API_KEY = "your-key"
$env:AI_MODEL = "your-model"
node server.js
```

If your provider uses a different request or response format, update the payload or the `extractReply` function in `server.js`.

## Local, Free Option (Ollama)

If you want to avoid paid APIs, you can run a local model with Ollama and point NovaChat to it.

1. Install Ollama: `https://ollama.com/download/windows`
2. Pull a small model (good for 8 GB RAM):

```cmd
ollama pull llama3.2
```

3. Point NovaChat to Ollama's OpenAI-compatible endpoint:

```cmd
set AI_ENDPOINT=http://localhost:11434/v1/chat/completions
set AI_MODEL=llama3.2
set AI_API_KEY=
set PORT=3001
node server.js
```

Then open `http://localhost:3001`.

## Uploads (Images / Files / PDFs)

- Images: previewed and sent only if the model likely supports vision.
- Text files: content is injected into the prompt.
- PDFs: text is extracted with PDF.js (loaded from a CDN).

Limits are defined in `app.js`:

```js
const MAX_IMAGE_BYTES = 750_000;
const MAX_TEXT_BYTES = 200_000;
const MAX_PDF_BYTES = 3_000_000;
const MAX_PDF_PAGES = 20;
const MAX_PDF_CHARS = 12_000;
```

If PDF.js cannot load (offline), the PDF will attach without extracted text.

## Threads, Tags, Search, Export

- Threads reorder by recency; pinned threads stay on top.
- Tags are comma-separated and searchable.
- Search box filters thread list and message list.
- Export current thread (`.txt`) or export/import all threads (`.json`).

## Troubleshooting Notes (Issues We Hit During Setup)

This section documents real issues encountered during setup and their fixes. It is intentionally practical and short.

### 1) Port already in use (EADDRINUSE)
**Symptom:** `Error: listen EADDRINUSE :::3000`  
**Fix:** Stop the process using port 3000 or run on another port:

```cmd
set PORT=3001
node server.js
```

### 2) "Model auto does not exist"
**Symptom:** `Error: The model 'auto' does not exist or you do not have access to it.`  
**Cause:** The UI sends `auto/fast/creative/reasoned` as labels, which are not real model IDs.  
**Fix:** Set `AI_MODEL` to a real model ID and restart. Server maps UI labels to `AI_MODEL`.

### 3) Incorrect API key errors
**Symptom:** `Incorrect API key provided`  
**Fix:** Use a valid key created from your provider dashboard.  
**Important:** Never paste keys into browser code or commit them to Git.  
**cmd.exe note:** Do **not** wrap the key in quotes in `cmd`.

```cmd
set AI_API_KEY=sk-your-real-key-here
```

### 4) Quota exceeded
**Symptom:** `You exceeded your current quota`  
**Fix:** Add billing/credits to the API account or use local models (see Ollama section).

### 5) LM Studio GUI crash (GPU process not usable)
**Symptom:** LM Studio fails to open or crashes with GPU errors.  
**Fix:** Start with GPU disabled:

```cmd
start "" "C:\Users\Administrator\AppData\Local\Programs\LM Studio\LM Studio.exe" --disable-gpu
```

If it still fails, use Ollama (CLI-only) instead.

### 6) Low disk space / RAM constraints
**Symptom:** Models fail to download or run slowly.  
**Fix:** Use smaller models (1B–3B) and keep several GB free on disk.

## Go Online

- https://adhrit-ai-chatbot.onrender.com