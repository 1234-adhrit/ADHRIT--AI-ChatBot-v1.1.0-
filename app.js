const chatBody = document.getElementById("chatBody");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const modelSelect = document.getElementById("modelSelect");
const tempRange = document.getElementById("tempRange");
const runtimePill = document.getElementById("runtimePill");
const connectionStatus = document.getElementById("connectionStatus");
const newChatBtn = document.getElementById("newChatBtn");
const chatList = document.getElementById("chatList");
const threadTitle = document.getElementById("threadTitle");
const threadTitleInput = document.getElementById("threadTitleInput");
const renameThreadBtn = document.getElementById("renameThreadBtn");
const editTagsBtn = document.getElementById("editTagsBtn");
const threadTagsInput = document.getElementById("threadTagsInput");
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const stopBtn = document.getElementById("stopBtn");
const pinThreadBtn = document.getElementById("pinThreadBtn");
const deleteThreadBtn = document.getElementById("deleteThreadBtn");
const exportThreadBtn = document.getElementById("exportThreadBtn");
const attachmentsRow = document.getElementById("attachmentsRow");
const attachmentList = document.getElementById("attachmentList");
const clearAttachmentsBtn = document.getElementById("clearAttachmentsBtn");
const threadSearchInput = document.getElementById("threadSearch");
const messageSearchInput = document.getElementById("messageSearch");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const exportAllBtn = document.getElementById("exportAllBtn");
const importAllBtn = document.getElementById("importAllBtn");
const importAllInput = document.getElementById("importAllInput");

const LEGACY_HISTORY_KEY = "novachat.history.v1";
const THREADS_KEY = "novachat.threads.v1";
const SETTINGS_KEY = "novachat.settings.v1";
const THEME_KEY = "novachat.theme.v1";
const DRAFTS_KEY = "novachat.drafts.v1";
const DEFAULT_THREAD_TITLE = "New thread";
const MAX_IMAGE_BYTES = 750_000;
const MAX_TEXT_BYTES = 200_000;
const MAX_PDF_BYTES = 3_000_000;
const MAX_PDF_PAGES = 20;
const MAX_PDF_CHARS = 12_000;
const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.js";

const state = {
  threads: [],
  activeThreadId: null,
  nextMessageId: 1,
  pendingId: null,
  pendingMessage: null,
  preferredModel: null,
  abortController: null,
  pendingAttachments: [],
  pdfJsPromise: null,
  isStreaming: false,
  searchQuery: "",
  messageSearchQuery: "",
  theme: "dark",
  drafts: {},
};

function generateId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setStatus({ label, mode }) {
  if (label) {
    connectionStatus.textContent = label;
  }
  if (mode === "live") {
    runtimePill.textContent = "Live";
    runtimePill.style.color = "var(--accent-2)";
    runtimePill.style.borderColor = "rgba(54, 201, 198, 0.4)";
  }
  if (mode === "demo") {
    runtimePill.textContent = "Demo mode";
    runtimePill.style.color = "var(--accent-2)";
    runtimePill.style.borderColor = "rgba(54, 201, 198, 0.3)";
  }
  if (mode === "error") {
    runtimePill.textContent = "Offline";
    runtimePill.style.color = "var(--accent)";
    runtimePill.style.borderColor = "rgba(242, 107, 79, 0.4)";
  }
}

function scrollToBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

function autoGrow() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function sanitizeFileName(value) {
  return (value || "thread")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .toLowerCase();
}

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = state.theme;
  themeToggleBtn.textContent = state.theme === "light" ? "Dark" : "Light";
  localStorage.setItem(THEME_KEY, state.theme);
}

function loadTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored) {
    applyTheme(stored);
  } else {
    applyTheme("dark");
  }
}

function toggleTheme() {
  applyTheme(state.theme === "light" ? "dark" : "light");
}

function persistDrafts() {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(state.drafts));
  } catch (err) {
    console.warn("Unable to persist drafts", err);
  }
}

function loadDrafts() {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return;
    const drafts = JSON.parse(raw);
    if (drafts && typeof drafts === "object") {
      state.drafts = drafts;
    }
  } catch (err) {
    console.warn("Unable to load drafts", err);
  }
}

function saveDraftForThread(threadId, text) {
  if (!threadId) return;
  const trimmed = text.trim();
  if (trimmed) {
    state.drafts[threadId] = text;
  } else {
    delete state.drafts[threadId];
  }
  persistDrafts();
}

function restoreDraftForThread(threadId) {
  if (!threadId) return;
  const draft = state.drafts[threadId] || "";
  messageInput.value = draft;
  autoGrow();
}

function isTextFile(file) {
  if (!file || !file.name) return false;
  if (file.type && file.type.startsWith("text/")) return true;
  const name = file.name.toLowerCase();
  return [".txt", ".md", ".csv", ".json", ".log"].some((ext) => name.endsWith(ext));
}

function isPdfFile(file) {
  if (!file || !file.name) return false;
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function createAttachmentFromFile(file) {
  const attachment = {
    id: generateId("att"),
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    kind: "file",
    note: "",
  };

  if (file.type && file.type.startsWith("image/")) {
    attachment.kind = "image";
    if (file.size <= MAX_IMAGE_BYTES) {
      try {
        attachment.dataUrl = await readFileAsDataUrl(file);
      } catch (err) {
        attachment.note = "Image could not be read.";
      }
    } else {
      attachment.note = "Image too large to include.";
    }
    return attachment;
  }

  if (isPdfFile(file)) {
    attachment.kind = "pdf";
    if (file.size <= MAX_PDF_BYTES) {
      try {
        const { text, note } = await extractPdfText(file);
        if (text) {
          attachment.text = text;
        }
        if (note) {
          attachment.note = note;
        }
      } catch (err) {
        attachment.note = "PDF could not be read.";
      }
    } else {
      attachment.note = "PDF too large to extract.";
    }
    return attachment;
  }

  if (isTextFile(file)) {
    attachment.kind = "text";
    if (file.size <= MAX_TEXT_BYTES) {
      try {
        attachment.text = await readFileAsText(file);
      } catch (err) {
        attachment.note = "File could not be read.";
      }
    } else {
      attachment.note = "File too large to include.";
    }
    return attachment;
  }

  attachment.note = "Binary file attached (metadata only).";
  return attachment;
}

function setStreamingState(active) {
  state.isStreaming = active;
  stopBtn.classList.toggle("hidden", !active);
  stopBtn.disabled = !active;
  sendBtn.disabled = active;
}

function ensurePdfJs() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    return Promise.resolve(window.pdfjsLib);
  }
  if (state.pdfJsPromise) return state.pdfJsPromise;
  state.pdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDFJS_URL;
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(window.pdfjsLib);
      } else {
        reject(new Error("PDF.js not available after load."));
      }
    };
    script.onerror = () => reject(new Error("PDF.js failed to load."));
    document.head.appendChild(script);
  });
  return state.pdfJsPromise;
}

async function extractPdfText(file) {
  const pdfjs = await ensurePdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pageCount = Math.min(pdf.numPages || 0, MAX_PDF_PAGES);
  let output = "";

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    output += `${pageText}\n`;
    if (output.length >= MAX_PDF_CHARS) {
      output = output.slice(0, MAX_PDF_CHARS);
      return { text: output, note: "PDF text truncated." };
    }
  }

  if (!output.trim()) {
    return { text: "", note: "PDF had no extractable text." };
  }

  return { text: output, note: "" };
}

async function handleFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  for (const file of list) {
    try {
      const attachment = await createAttachmentFromFile(file);
      state.pendingAttachments.push(attachment);
    } catch (err) {
      console.warn("Unable to add attachment", err);
    }
  }
  renderPendingAttachments();
}

function renderPendingAttachments() {
  attachmentList.innerHTML = "";

  if (!state.pendingAttachments.length) {
    attachmentsRow.classList.add("hidden");
    return;
  }

  attachmentsRow.classList.remove("hidden");
  state.pendingAttachments.forEach((attachment) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.dataset.id = attachment.id;

    if (attachment.kind === "image" && attachment.dataUrl) {
      const thumb = document.createElement("div");
      thumb.className = "attachment-thumb";
      const img = document.createElement("img");
      img.src = attachment.dataUrl;
      img.alt = attachment.name;
      thumb.appendChild(img);
      chip.appendChild(thumb);
    } else {
      const thumb = document.createElement("div");
      thumb.className = "attachment-thumb";
      if (attachment.kind === "text") {
        thumb.textContent = "TXT";
      } else if (attachment.kind === "pdf") {
        thumb.textContent = "PDF";
      } else {
        thumb.textContent = "FILE";
      }
      chip.appendChild(thumb);
    }

    const meta = document.createElement("div");
    meta.className = "attachment-meta";

    const name = document.createElement("div");
    name.className = "attachment-name";
    name.textContent = attachment.name;

    const size = document.createElement("div");
    size.className = "attachment-size";
    const note = attachment.note ? ` - ${attachment.note}` : "";
    size.textContent = `${formatBytes(attachment.size)}${note}`;

    meta.appendChild(name);
    meta.appendChild(size);
    chip.appendChild(meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.textContent = "x";
    chip.appendChild(remove);

    attachmentList.appendChild(chip);
  });
}

function renderBubbleAttachments(container, attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return;
  const list = document.createElement("div");
  list.className = "bubble-attachments";

  attachments.forEach((attachment) => {
    const item = document.createElement("div");
    item.className = "bubble-attachment";

    const thumb = document.createElement("div");
    thumb.className = "attachment-thumb";
    if (attachment.kind === "image" && attachment.dataUrl) {
      const img = document.createElement("img");
      img.src = attachment.dataUrl;
      img.alt = attachment.name;
      thumb.appendChild(img);
    } else {
      if (attachment.kind === "text") {
        thumb.textContent = "TXT";
      } else if (attachment.kind === "pdf") {
        thumb.textContent = "PDF";
      } else {
        thumb.textContent = "FILE";
      }
    }

    const meta = document.createElement("div");
    meta.className = "attachment-meta";

    const name = document.createElement("div");
    name.className = "attachment-name";
    name.textContent = attachment.name;

    const size = document.createElement("div");
    size.className = "attachment-size";
    const note = attachment.note ? ` - ${attachment.note}` : "";
    size.textContent = `${formatBytes(attachment.size)}${note}`;

    meta.appendChild(name);
    meta.appendChild(size);

    item.appendChild(thumb);
    item.appendChild(meta);
    list.appendChild(item);
  });

  container.appendChild(list);
}

function modelSupportsVision(model) {
  const value = (model || "").toLowerCase();
  return (
    value.includes("vision") ||
    value.includes("gpt-4o") ||
    value.includes("gpt-4.1") ||
    value.includes("llava") ||
    value.includes("bakllava") ||
    value.includes("qwen2-vl") ||
    value.includes("gemini")
  );
}

function buildAttachmentText(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return "";
  const lines = ["[Attachments]"];
  attachments.forEach((attachment) => {
    if ((attachment.kind === "text" || attachment.kind === "pdf") && attachment.text) {
      lines.push(`--- ${attachment.name} ---`);
      lines.push(attachment.text);
    } else if (attachment.kind === "pdf") {
      const note = attachment.note ? ` ${attachment.note}` : " PDF attached (no text extracted).";
      lines.push(`- PDF: ${attachment.name} (${formatBytes(attachment.size)})${note}`);
    } else if (attachment.kind === "image") {
      const note = attachment.note ? ` ${attachment.note}` : " Image attached (not sent to model).";
      lines.push(`- Image: ${attachment.name} (${formatBytes(attachment.size)})${note}`);
    } else {
      const note = attachment.note ? ` ${attachment.note}` : "";
      lines.push(`- File: ${attachment.name} (${formatBytes(attachment.size)})${note}`);
    }
  });
  return lines.join("\n");
}

function buildApiMessages(thread) {
  const supportsVision = modelSupportsVision(modelSelect.value);
  return thread.messages.map((message) => {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (attachments.length === 0) {
      return { role: message.role, content: message.content };
    }

    if (supportsVision) {
      const content = [{ type: "text", text: message.content || "" }];
      attachments.forEach((attachment) => {
        if (attachment.kind === "image" && attachment.dataUrl) {
          content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
        } else if ((attachment.kind === "text" || attachment.kind === "pdf") && attachment.text) {
          content.push({ type: "text", text: `[Attachment: ${attachment.name}]\n${attachment.text}` });
        } else {
          const note = attachment.note ? ` ${attachment.note}` : " Not included.";
          content.push({
            type: "text",
            text: `[Attachment: ${attachment.name}]${note}`,
          });
        }
      });
      return { role: message.role, content };
    }

    const attachmentText = buildAttachmentText(attachments);
    const combined = attachmentText ? `${message.content}\n\n${attachmentText}` : message.content;
    return { role: message.role, content: combined };
  });
}

function createMessageObject(role, content, attachments = []) {
  return {
    id: state.nextMessageId++,
    role,
    content,
    attachments,
    createdAt: Date.now(),
  };
}

function appendMessageElement(message, { pending = false, deletable = true } = {}) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${message.role}`;
  messageEl.dataset.id = message.id;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = message.role === "user" ? "YOU" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (pending) {
    bubble.classList.add("pending");
  }
  const bubbleText = document.createElement("div");
  bubbleText.className = "bubble-text";
  bubbleText.textContent = message.content;
  bubble.appendChild(bubbleText);

  renderBubbleAttachments(bubble, message.attachments);

  if (deletable) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "Delete";
    bubble.appendChild(deleteBtn);
  }

  messageEl.appendChild(avatar);
  messageEl.appendChild(bubble);
  chatBody.appendChild(messageEl);
  scrollToBottom();
}

function updateMessageElement(id, content, { pending = false } = {}) {
  const messageEl = chatBody.querySelector(`[data-id="${id}"]`);
  if (!messageEl) return;
  const bubble = messageEl.querySelector(".bubble");
  if (!bubble) return;
  const bubbleText = bubble.querySelector(".bubble-text");
  if (bubbleText) {
    bubbleText.textContent = content;
  } else {
    bubble.textContent = content;
  }
  if (pending) {
    bubble.classList.add("pending");
  } else {
    bubble.classList.remove("pending");
  }
}

function createThread({ title = DEFAULT_THREAD_TITLE, messages = [] } = {}) {
  return {
    id: generateId("thread"),
    title,
    messages,
    tags: [],
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getActiveThread() {
  return state.threads.find((thread) => thread.id === state.activeThreadId) || state.threads[0];
}

function persistThreads() {
  try {
    localStorage.setItem(
      THREADS_KEY,
      JSON.stringify({
        threads: state.threads,
        activeThreadId: state.activeThreadId,
        nextMessageId: state.nextMessageId,
      })
    );
  } catch (err) {
    console.warn("Unable to persist threads", err);
  }
}

function normalizeLoadedThreads(threads) {
  let maxId = 0;
  threads.forEach((thread) => {
    if (!Array.isArray(thread.messages)) {
      thread.messages = [];
    }
    thread.pinned = Boolean(thread.pinned);
    thread.tags = Array.isArray(thread.tags) ? thread.tags.filter(Boolean) : [];
    thread.updatedAt = typeof thread.updatedAt === "number" ? thread.updatedAt : thread.createdAt || Date.now();

    thread.messages = thread.messages.map((message) => {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      if (typeof message.id !== "number") {
        maxId += 1;
        return {
          id: maxId,
          role: message.role,
          content: message.content,
          attachments,
          createdAt: message.createdAt || Date.now(),
        };
      }
      maxId = Math.max(maxId, message.id);
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        attachments,
        createdAt: message.createdAt || Date.now(),
      };
    });
  });
  state.nextMessageId = Math.max(state.nextMessageId, maxId + 1);
}

function loadThreads() {
  let loaded = false;
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.threads)) {
        state.threads = data.threads;
        state.activeThreadId = data.activeThreadId || null;
        if (typeof data.nextMessageId === "number") {
          state.nextMessageId = data.nextMessageId;
        }
        normalizeLoadedThreads(state.threads);
        loaded = true;
      }
    }
  } catch (err) {
    console.warn("Unable to load threads", err);
  }

  if (!loaded) {
    try {
      const legacyRaw = localStorage.getItem(LEGACY_HISTORY_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (legacy && Array.isArray(legacy.messages) && legacy.messages.length > 0) {
          const legacyMessages = legacy.messages.map((message) => createMessageObject(message.role, message.content));
          const legacyThread = createThread({ title: "Welcome thread", messages: legacyMessages });
          state.threads = [legacyThread];
          state.activeThreadId = legacyThread.id;
          loaded = true;
        }
      }
    } catch (err) {
      console.warn("Unable to migrate legacy history", err);
    }
  }

  if (!loaded || state.threads.length === 0) {
    const thread = createThread();
    state.threads = [thread];
    state.activeThreadId = thread.id;
  }

  if (!state.activeThreadId) {
    state.activeThreadId = state.threads[0].id;
  }

  normalizeLoadedThreads(state.threads);
  persistThreads();
}

function persistSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        model: modelSelect.value,
        temperature: Number.parseFloat(tempRange.value),
      })
    );
  } catch (err) {
    console.warn("Unable to persist settings", err);
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const settings = JSON.parse(raw);
    if (settings && typeof settings.temperature === "number") {
      tempRange.value = String(settings.temperature);
    }
    if (settings && typeof settings.model === "string") {
      state.preferredModel = settings.model;
    }
  } catch (err) {
    console.warn("Unable to load settings", err);
  }
}

function optionExists(value) {
  return Array.from(modelSelect.options).some((option) => option.value === value);
}

function applyPreferredModel() {
  if (state.preferredModel && optionExists(state.preferredModel)) {
    modelSelect.value = state.preferredModel;
  }
}

function getThreadSnippet(thread) {
  if (!thread.messages.length) {
    return "No messages yet";
  }
  const last = thread.messages[thread.messages.length - 1];
  return last.content.replace(/\s+/g, " ").slice(0, 70);
}

function renderThreadList() {
  chatList.innerHTML = "";
  const query = state.searchQuery.trim().toLowerCase();
  const orderedThreads = state.threads
    .slice()
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

  const visibleThreads = query
    ? orderedThreads.filter((thread) => {
        const title = (thread.title || "").toLowerCase();
        const snippet = getThreadSnippet(thread).toLowerCase();
        const tags = Array.isArray(thread.tags) ? thread.tags.join(" ").toLowerCase() : "";
        return title.includes(query) || snippet.includes(query) || tags.includes(query);
      })
    : orderedThreads;

  if (visibleThreads.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "No matching threads.";
    chatList.appendChild(empty);
    return;
  }

  visibleThreads.forEach((thread) => {
    const item = document.createElement("div");
    item.className = "chat-item";
    if (thread.id === state.activeThreadId) {
      item.classList.add("active");
    }
    item.dataset.threadId = thread.id;

    const title = document.createElement("div");
    title.className = "chat-title";
    title.textContent = `${thread.pinned ? "[PIN] " : ""}${thread.title || DEFAULT_THREAD_TITLE}`;

    const snippet = document.createElement("div");
    snippet.className = "chat-snippet";
    snippet.textContent = getThreadSnippet(thread);

    item.appendChild(title);

    if (Array.isArray(thread.tags) && thread.tags.length > 0) {
      const tagsRow = document.createElement("div");
      tagsRow.className = "thread-tags";
      thread.tags.slice(0, 3).forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = tag;
        tagsRow.appendChild(chip);
      });
      item.appendChild(tagsRow);
    }

    item.appendChild(snippet);
    chatList.appendChild(item);
  });
}

function renderWelcomeMessage() {
  const message = {
    id: "welcome",
    role: "assistant",
    content: "New thread ready. Ask anything, or wire in your AI provider to go live.",
  };
  appendMessageElement(message, { pending: false, deletable: false });
}

function renderActiveThread() {
  const thread = getActiveThread();
  if (!thread) return;
  threadTitle.textContent = thread.title || DEFAULT_THREAD_TITLE;
  threadTitleInput.value = thread.title || DEFAULT_THREAD_TITLE;
  cancelRenamingThread();
  threadTagsInput.value = Array.isArray(thread.tags) ? thread.tags.join(", ") : "";
  pinThreadBtn.textContent = thread.pinned ? "Unpin" : "Pin";
  chatBody.innerHTML = "";

  if (!thread.messages.length) {
    renderWelcomeMessage();
    return;
  }

  const query = state.messageSearchQuery.trim().toLowerCase();
  const visibleMessages = query
    ? thread.messages.filter((message) => {
        const content = (message.content || "").toLowerCase();
        const attachments = Array.isArray(message.attachments)
          ? message.attachments.map((attachment) => attachment.name || "").join(" ").toLowerCase()
          : "";
        return content.includes(query) || attachments.includes(query);
      })
    : thread.messages;

  visibleMessages.forEach((message) => {
    appendMessageElement(message);
  });
  scrollToBottom();
}

function setActiveThread(threadId) {
  if (state.activeThreadId === threadId) return;
  saveDraftForThread(state.activeThreadId, messageInput.value);
  state.activeThreadId = threadId;
  state.pendingId = null;
  state.pendingMessage = null;
  state.pendingAttachments = [];
  renderPendingAttachments();
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  persistThreads();
  renderThreadList();
  renderActiveThread();
  restoreDraftForThread(state.activeThreadId);
}

function addMessageToThread(role, content, attachments = []) {
  const thread = getActiveThread();
  if (!thread) return null;
  const message = createMessageObject(role, content, attachments);
  thread.messages.push(message);
  thread.updatedAt = Date.now();
  persistThreads();
  appendMessageElement(message);
  renderThreadList();
  return message;
}

function ensureThreadTitleFromMessage(thread, text) {
  if (!thread || !text) return;
  if (thread.title && thread.title !== DEFAULT_THREAD_TITLE) return;
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 5);
  thread.title = words.join(" ") || DEFAULT_THREAD_TITLE;
  thread.updatedAt = Date.now();
  persistThreads();
  renderThreadList();
  threadTitle.textContent = thread.title;
}

function startRenamingThread() {
  const thread = getActiveThread();
  if (!thread) return;
  threadTitleInput.value = thread.title || DEFAULT_THREAD_TITLE;
  threadTitle.classList.add("hidden");
  threadTitleInput.classList.remove("hidden");
  threadTitleInput.focus();
  threadTitleInput.select();
}

function cancelRenamingThread() {
  threadTitleInput.classList.add("hidden");
  threadTitle.classList.remove("hidden");
}

function commitThreadRename() {
  const thread = getActiveThread();
  if (!thread) return;
  const value = threadTitleInput.value.trim();
  thread.title = value || DEFAULT_THREAD_TITLE;
  thread.updatedAt = Date.now();
  persistThreads();
  renderThreadList();
  threadTitle.textContent = thread.title;
  cancelRenamingThread();
}

function startEditingTags() {
  const thread = getActiveThread();
  if (!thread) return;
  threadTagsInput.value = Array.isArray(thread.tags) ? thread.tags.join(", ") : "";
  threadTagsInput.classList.remove("hidden");
  threadTagsInput.focus();
  threadTagsInput.select();
}

function commitTags() {
  const thread = getActiveThread();
  if (!thread) return;
  const raw = threadTagsInput.value || "";
  const tags = raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
  thread.tags = tags;
  thread.updatedAt = Date.now();
  persistThreads();
  renderThreadList();
  threadTagsInput.classList.add("hidden");
}

function deleteMessage(id) {
  const thread = getActiveThread();
  if (!thread) return;

  if (state.pendingId === id) {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    state.pendingId = null;
    state.pendingMessage = null;
    renderActiveThread();
    return;
  }

  const index = thread.messages.findIndex((message) => message.id === id);
  if (index === -1) return;
  thread.messages.splice(index, 1);
  thread.updatedAt = Date.now();
  persistThreads();
  renderThreadList();
  renderActiveThread();
}

function togglePinThread() {
  const thread = getActiveThread();
  if (!thread) return;
  thread.pinned = !thread.pinned;
  thread.updatedAt = Date.now();
  persistThreads();
  renderThreadList();
  renderActiveThread();
}

function deleteActiveThread() {
  const thread = getActiveThread();
  if (!thread) return;
  const confirmed = window.confirm("Delete this thread? This cannot be undone.");
  if (!confirmed) return;

  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }

  state.pendingAttachments = [];
  renderPendingAttachments();

  const index = state.threads.findIndex((item) => item.id === thread.id);
  if (index === -1) return;

  if (state.threads.length === 1) {
    thread.messages = [];
    thread.title = DEFAULT_THREAD_TITLE;
    thread.updatedAt = Date.now();
    persistThreads();
    renderThreadList();
    renderActiveThread();
    setStatus({ label: "Not connected", mode: "demo" });
    return;
  }

  state.threads.splice(index, 1);
  const nextThread = state.threads[Math.max(0, index - 1)];
  state.activeThreadId = nextThread.id;
  persistThreads();
  renderThreadList();
  renderActiveThread();
}

function exportActiveThread() {
  const thread = getActiveThread();
  if (!thread) return;
  const timestamp = new Date();
  const header = [
    "NovaChat Export",
    `Thread: ${thread.title || DEFAULT_THREAD_TITLE}`,
    `Exported: ${timestamp.toLocaleString()}`,
    "",
  ];

  const lines = [...header];
  thread.messages.forEach((message) => {
    lines.push(`${message.role.toUpperCase()}:`);
    lines.push(message.content || "");
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      lines.push(buildAttachmentText(message.attachments));
    }
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const link = document.createElement("a");
  const safeTitle = sanitizeFileName(thread.title || DEFAULT_THREAD_TITLE);
  const dateStamp = `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, "0")}${String(
    timestamp.getDate()
  ).padStart(2, "0")}-${String(timestamp.getHours()).padStart(2, "0")}${String(
    timestamp.getMinutes()
  ).padStart(2, "0")}`;
  link.href = URL.createObjectURL(blob);
  link.download = `novachat-${safeTitle || "thread"}-${dateStamp}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function exportAllThreads() {
  const payload = {
    exportedAt: new Date().toISOString(),
    threads: state.threads,
    activeThreadId: state.activeThreadId,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "novachat-threads.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function importAllThreads(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.threads)) {
      throw new Error("Invalid backup file.");
    }
    const confirmed = window.confirm("Importing will replace your current threads. Continue?");
    if (!confirmed) return;

    state.threads = data.threads;
    state.activeThreadId = data.activeThreadId || (state.threads[0] && state.threads[0].id) || null;
    normalizeLoadedThreads(state.threads);
    persistThreads();
    renderThreadList();
    renderActiveThread();
  } catch (err) {
    window.alert(`Import failed: ${err.message}`);
  } finally {
    importAllInput.value = "";
  }
}

function buildPayload(thread) {
  return {
    messages: buildApiMessages(thread),
    model: modelSelect.value,
    temperature: Number.parseFloat(tempRange.value),
    stream: true,
  };
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if ((!text && state.pendingAttachments.length === 0) || state.pendingId) return;

  const thread = getActiveThread();
  if (!thread) return;

  const attachments = state.pendingAttachments.slice();
  state.pendingAttachments = [];
  renderPendingAttachments();

  const messageText =
    text || (attachments.length === 1 ? `Shared ${attachments[0].name}` : `Shared ${attachments.length} files`);

  addMessageToThread("user", messageText, attachments);
  ensureThreadTitleFromMessage(thread, messageText);
  messageInput.value = "";
  autoGrow();
  saveDraftForThread(thread.id, "");

  const pendingMessage = createMessageObject("assistant", "Thinking...");
  state.pendingId = pendingMessage.id;
  state.pendingMessage = pendingMessage;
  appendMessageElement(pendingMessage, { pending: true });

  const controller = new AbortController();
  state.abortController = controller;
  setStreamingState(true);

  try {
    const response = await fetch("/api/chat?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(thread)),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorMessage = "Request failed";
      try {
        const data = await response.json();
        errorMessage = data.error || errorMessage;
      } catch (err) {
        const textBody = await response.text();
        if (textBody) errorMessage = textBody;
      }
      throw new Error(errorMessage);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      const reply = data.reply || "No response returned.";
      updateMessageElement(pendingMessage.id, reply, { pending: false });
      pendingMessage.content = reply;
      thread.messages.push(pendingMessage);
      thread.updatedAt = Date.now();
      persistThreads();
      renderThreadList();
      if (data.demo) {
        setStatus({ label: "Not connected", mode: "demo" });
      } else {
        setStatus({ label: "Connected", mode: "live" });
      }
      return;
    }

    if (!response.body) {
      const textBody = await response.text();
      const reply = textBody.trim() || "No response returned.";
      updateMessageElement(pendingMessage.id, reply, { pending: false });
      pendingMessage.content = reply;
      thread.messages.push(pendingMessage);
      thread.updatedAt = Date.now();
      persistThreads();
      renderThreadList();
      setStatus({ label: "Connected", mode: "live" });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      updateMessageElement(pendingMessage.id, fullText, { pending: true });
    }

    fullText = fullText.trim() || "No response returned.";
    updateMessageElement(pendingMessage.id, fullText, { pending: false });
    pendingMessage.content = fullText;
    thread.messages.push(pendingMessage);
    thread.updatedAt = Date.now();
    persistThreads();
    renderThreadList();
    setStatus({ label: "Connected", mode: "live" });
  } catch (err) {
    if (err.name === "AbortError") {
      updateMessageElement(pendingMessage.id, "Request cancelled.", { pending: false });
      return;
    }
    updateMessageElement(pendingMessage.id, `Error: ${err.message}`, { pending: false });
    setStatus({ label: "Connection error", mode: "error" });
  } finally {
    state.pendingId = null;
    state.pendingMessage = null;
    state.abortController = null;
    setStreamingState(false);
  }
}

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load models");
    }

    if (Array.isArray(data.models) && data.models.length > 0) {
      const existing = new Set(Array.from(modelSelect.options).map((option) => option.value));
      data.models.forEach((modelId) => {
        if (!existing.has(modelId)) {
          const option = document.createElement("option");
          option.value = modelId;
          option.textContent = modelId;
          modelSelect.appendChild(option);
        }
      });
    }

    applyPreferredModel();
  } catch (err) {
    console.warn("Model list unavailable", err);
  }
}

messageInput.addEventListener("input", autoGrow);
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.abortController) {
    state.abortController.abort();
  }
});

sendBtn.addEventListener("click", sendMessage);
uploadBtn.addEventListener("click", () => fileInput.click());
stopBtn.addEventListener("click", () => {
  if (state.abortController) {
    state.abortController.abort();
  }
});
renameThreadBtn.addEventListener("click", startRenamingThread);
threadTitle.addEventListener("dblclick", startRenamingThread);
threadTitleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitThreadRename();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelRenamingThread();
  }
});
threadTitleInput.addEventListener("blur", commitThreadRename);
editTagsBtn.addEventListener("click", startEditingTags);
threadTagsInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitTags();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    threadTagsInput.classList.add("hidden");
  }
});
threadTagsInput.addEventListener("blur", commitTags);
deleteThreadBtn.addEventListener("click", deleteActiveThread);
exportThreadBtn.addEventListener("click", exportActiveThread);
themeToggleBtn.addEventListener("click", toggleTheme);
pinThreadBtn.addEventListener("click", togglePinThread);
exportAllBtn.addEventListener("click", exportAllThreads);
importAllBtn.addEventListener("click", () => importAllInput.click());
importAllInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  importAllThreads(file);
});
fileInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  await handleFiles(files);
  fileInput.value = "";
});
attachmentList.addEventListener("click", (event) => {
  const button = event.target.closest(".attachment-remove");
  if (!button) return;
  const chip = event.target.closest(".attachment-chip");
  if (!chip) return;
  const id = chip.dataset.id;
  state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== id);
  renderPendingAttachments();
});
clearAttachmentsBtn.addEventListener("click", () => {
  state.pendingAttachments = [];
  renderPendingAttachments();
});

newChatBtn.addEventListener("click", () => {
  const thread = createThread();
  state.threads.unshift(thread);
  state.activeThreadId = thread.id;
  state.pendingAttachments = [];
  renderPendingAttachments();
  persistThreads();
  renderThreadList();
  renderActiveThread();
  setStatus({ label: "Not connected", mode: "demo" });
  saveDraftForThread(thread.id, "");
  restoreDraftForThread(thread.id);
});
threadSearchInput.addEventListener("input", (event) => {
  state.searchQuery = event.target.value;
  renderThreadList();
});
messageSearchInput.addEventListener("input", (event) => {
  state.messageSearchQuery = event.target.value;
  renderActiveThread();
});
messageInput.addEventListener("input", () => {
  saveDraftForThread(state.activeThreadId, messageInput.value);
});

chatList.addEventListener("click", (event) => {
  const item = event.target.closest(".chat-item");
  if (!item) return;
  const threadId = item.dataset.threadId;
  if (threadId) {
    setActiveThread(threadId);
  }
});

chatBody.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-btn");
  if (!button) return;
  const messageEl = event.target.closest(".message");
  if (!messageEl) return;
  const id = Number(messageEl.dataset.id);
  if (!Number.isFinite(id)) return;
  deleteMessage(id);
});

modelSelect.addEventListener("change", persistSettings);
tempRange.addEventListener("change", persistSettings);

loadSettings();
loadTheme();
loadDrafts();
loadThreads();
renderThreadList();
renderActiveThread();
setStatus({ label: "Not connected", mode: "demo" });
renderPendingAttachments();
setStreamingState(false);
autoGrow();
loadModels();
restoreDraftForThread(state.activeThreadId);
