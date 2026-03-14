const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function extractReply(data) {
  if (!data) return null;
  if (typeof data.reply === "string") return data.reply;
  if (typeof data.message === "string") return data.message;
  if (data.choices && data.choices[0]) {
    const choice = data.choices[0];
    if (choice.message && typeof choice.message.content === "string") {
      return choice.message.content;
    }
    if (typeof choice.text === "string") return choice.text;
  }
  if (typeof data.output_text === "string") return data.output_text;
  if (Array.isArray(data.output) && data.output[0]) {
    const content = data.output[0].content;
    if (Array.isArray(content) && content[0] && typeof content[0].text === "string") {
      return content[0].text;
    }
  }
  return null;
}

function extractDelta(data) {
  if (!data) return null;
  if (data.choices && data.choices[0]) {
    const choice = data.choices[0];
    if (choice.delta && typeof choice.delta.content === "string") {
      return choice.delta.content;
    }
    if (choice.message && typeof choice.message.content === "string") {
      return choice.message.content;
    }
  }
  if (data.message && typeof data.message.content === "string") {
    return data.message.content;
  }
  if (typeof data.response === "string") {
    return data.response;
  }
  if (typeof data.output_text === "string") {
    return data.output_text;
  }
  return null;
}

function isDoneEvent(data) {
  if (!data) return false;
  if (data.done === true) return true;
  if (data.choices && data.choices[0] && data.choices[0].finish_reason) {
    return data.choices[0].finish_reason === "stop";
  }
  return false;
}

function parseErrorMessage(data, status) {
  return (
    (data && data.error && data.error.message) ||
    data.error ||
    `Provider error (${status})`
  );
}

function inferModelsEndpoint(endpoint) {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (normalizedPath.endsWith("/chat/completions")) {
      url.pathname = normalizedPath.replace(/\/chat\/completions$/, "/models");
      return url.toString();
    }
    if (normalizedPath.endsWith("/responses")) {
      url.pathname = normalizedPath.replace(/\/responses$/, "/models");
      return url.toString();
    }
    if (normalizedPath.endsWith("/models")) {
      return url.toString();
    }
    if (normalizedPath.endsWith("/v1")) {
      url.pathname = `${normalizedPath}/models`;
      return url.toString();
    }
  } catch (err) {
    return null;
  }
  return null;
}

function extractModels(data) {
  if (!data) return [];
  if (Array.isArray(data.data)) {
    return data.data.map((item) => item.id).filter(Boolean);
  }
  if (Array.isArray(data.models)) {
    return data.models.filter(Boolean);
  }
  return [];
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: "Invalid JSON" });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const requestedModelRaw = typeof payload.model === "string" ? payload.model.trim() : "";
  const requestedModel = requestedModelRaw.toLowerCase();
  const presetModels = new Set(["", "auto", "fast", "creative", "reasoned"]);
  const fallbackModel = process.env.AI_MODEL || "gpt-4.1-mini";
  const model = presetModels.has(requestedModel) ? fallbackModel : requestedModelRaw;
  const temperature = Number.isFinite(payload.temperature) ? payload.temperature : 0.6;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsStream = payload.stream === true || url.searchParams.get("stream") === "1";

  const endpoint = process.env.AI_ENDPOINT;
  const apiKey = process.env.AI_API_KEY;

  if (!endpoint) {
    return sendJson(res, 200, {
      reply:
        "AI provider not configured yet. Set AI_ENDPOINT (and AI_API_KEY if needed) then restart the server.",
      demo: true,
      model,
    });
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const requestBody = { model, messages, temperature };
  if (wantsStream) {
    requestBody.stream = true;
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      const errorMessage = parseErrorMessage(data, upstream.status);
      return sendJson(res, upstream.status, { error: errorMessage });
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!wantsStream || contentType.includes("application/json")) {
      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      const reply = extractReply(data);
      if (!reply) {
        return sendJson(res, 502, {
          error: "Could not parse provider response. Update extractReply in server.js.",
        });
      }

      return sendJson(res, 200, { reply, demo: false, model });
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    const reader = upstream.body?.getReader();
    if (!reader) {
      const text = await upstream.text();
      res.end(text);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let payloadText = trimmed;
        if (payloadText.startsWith("data:")) {
          payloadText = payloadText.slice(5).trim();
        }
        if (payloadText === "[DONE]") {
          res.end();
          return;
        }

        let eventData = null;
        let delta = null;
        try {
          eventData = JSON.parse(payloadText);
          delta = extractDelta(eventData);
        } catch {
          delta = payloadText;
        }

        if (delta) {
          res.write(delta);
        }

        if (eventData && isDoneEvent(eventData)) {
          res.end();
          return;
        }
      }
    }

    if (buffer.trim()) {
      try {
        const eventData = JSON.parse(buffer.trim());
        const delta = extractDelta(eventData);
        if (delta) {
          res.write(delta);
        }
      } catch {
        res.write(buffer);
      }
    }

    res.end();
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Upstream request failed" });
  }
}

async function handleModels(req, res) {
  const endpoint = process.env.AI_MODELS_ENDPOINT || inferModelsEndpoint(process.env.AI_ENDPOINT);
  const apiKey = process.env.AI_API_KEY;

  if (!endpoint) {
    return sendJson(res, 200, { models: [], demo: true, defaultModel: process.env.AI_MODEL || null });
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const upstream = await fetch(endpoint, { method: "GET", headers });
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!upstream.ok) {
      const errorMessage =
        (data && data.error && data.error.message) ||
        data.error ||
        `Provider error (${upstream.status})`;
      return sendJson(res, upstream.status, { error: errorMessage });
    }

    const models = extractModels(data);
    return sendJson(res, 200, { models, demo: false, defaultModel: process.env.AI_MODEL || null });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Upstream request failed" });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = decodeURIComponent(url.pathname);
  const safePath = path.posix.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = safePath === "/" ? "index.html" : safePath.replace(/^\/+/, "");
  const absolutePath = path.resolve(ROOT, filePath);

  const rootNormalized = path.resolve(ROOT);
  if (!absolutePath.startsWith(rootNormalized + path.sep) && absolutePath !== rootNormalized) {
    return send(res, 403, "Forbidden");
  }

  fs.readFile(absolutePath, (err, data) => {
    if (err) {
      return send(res, 404, "Not found");
    }
    const ext = path.extname(absolutePath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    send(res, 200, data, { "Content-Type": type });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.startsWith("/api/chat")) {
    return handleChat(req, res);
  }
  if (req.method === "GET" && req.url.startsWith("/api/models")) {
    return handleModels(req, res);
  }
  if (req.method === "GET") {
    return serveStatic(req, res);
  }
  send(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`NovaChat running on http://localhost:${PORT}`);
});
