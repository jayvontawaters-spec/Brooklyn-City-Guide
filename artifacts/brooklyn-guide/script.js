// Keep visitor notes only for this page session; nothing is saved to the browser.
const savedLikes = [];
const likeForm = document.querySelector("#like-form");
const likeInput = document.querySelector("#like-input");
const likeList = document.querySelector("#like-list");
const listCount = document.querySelector("#list-count");
const listEmpty = document.querySelector("#list-empty");

function drawLikes() {
  likeList.replaceChildren();

  savedLikes.forEach((like, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = like;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-like";
    removeButton.textContent = "REMOVE";
    removeButton.setAttribute("aria-label", `Remove ${like}`);
    removeButton.addEventListener("click", () => {
      savedLikes.splice(index, 1);
      drawLikes();
    });

    item.append(label, removeButton);
    likeList.append(item);
  });

  listCount.textContent = `${savedLikes.length} SAVED`;
  listEmpty.hidden = savedLikes.length > 0;
}

// Trim spaces and ignore empty submissions so every list item is useful.
likeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const like = likeInput.value.trim();
  if (!like) {
    likeInput.focus();
    return;
  }

  savedLikes.push(like);
  likeInput.value = "";
  drawLikes();
  likeInput.focus();
});

const birdButton = document.querySelector(".bird-button");
const bird = document.querySelector(".bird");

// The button supports mouse, touch, Enter, and Space through native keyboard behavior.
birdButton.addEventListener("click", () => {
  bird.classList.remove("bird-flutter");
  // Restart the CSS animation so repeated taps work, too.
  void bird.offsetWidth;
  bird.classList.add("bird-flutter");
  birdButton.setAttribute("aria-pressed", "true");
});

bird.addEventListener("animationend", () => {
  bird.classList.remove("bird-flutter");
  birdButton.setAttribute("aria-pressed", "false");
});

drawLikes();

// Keep chat history in this page session only; no message is saved to storage.
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSubmit = document.querySelector("#chat-submit");
const chatTranscript = document.querySelector("#chat-transcript");
const chatStatus = document.querySelector("#chat-status");
const systemPromptText = document.querySelector("#system-prompt-text");
const chatHistory = [];
const visibleMessages = [];
let requestPending = false;

const settingControls = {
  temperature: {
    input: document.querySelector("#temperature-control"),
    output: document.querySelector("#temperature-value"),
    format: (value) => Number(value).toFixed(1),
  },
  maxOutputTokens: {
    input: document.querySelector("#max-tokens-control"),
    output: document.querySelector("#max-tokens-value"),
    format: (value) => String(Number(value)),
  },
  topP: {
    input: document.querySelector("#top-p-control"),
    output: document.querySelector("#top-p-value"),
    format: (value) => Number(value).toFixed(2),
  },
};

function getChatSettings() {
  return Object.fromEntries(
    Object.entries(settingControls).map(([key, control]) => [
      key,
      Number(control.input.value),
    ]),
  );
}

function updateSettingLabels() {
  Object.values(settingControls).forEach(({ input, output, format }) => {
    output.value = format(input.value);
    output.textContent = output.value;
  });
}

Object.values(settingControls).forEach(({ input }) => {
  input.addEventListener("input", updateSettingLabels);
});
updateSettingLabels();

function addText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderChatMessage(message) {
  const bubble = document.createElement("article");
  bubble.className = `chat-message chat-message-${message.role}${message.error ? " chat-message-error" : ""}`;

  addText(
    bubble,
    "span",
    "chat-message-label",
    message.role === "user" ? "YOU" : "BROOKLYN GUIDE",
  );
  addText(bubble, "p", "chat-message-content", message.content);

  if (message.pending) {
    addText(bubble, "span", "chat-thinking", "Finding a good answer…");
  }

  if (message.metadata) {
    const { settings, usage, model } = message.metadata;
    addText(
      bubble,
      "p",
      "chat-meta",
      `Settings used · temp ${settings.temperature.toFixed(1)} · top-p ${settings.topP.toFixed(2)} · max ${settings.maxOutputTokens} tokens · ${model}`,
    );
    addText(
      bubble,
      "p",
      "chat-meta",
      `Tokens used · input ${usage.promptTokens} · answer ${usage.outputTokens} · total ${usage.totalTokens}`,
    );
    if (usage.truncated) {
      addText(bubble, "p", "chat-cutoff", "This answer was cut off at the max token limit.");
    }
  }

  chatTranscript.append(bubble);
}

function renderChat() {
  chatTranscript.replaceChildren();

  if (visibleMessages.length === 0) {
    const welcome = document.createElement("article");
    welcome.className = "chat-message chat-message-assistant";
    addText(welcome, "span", "chat-message-label", "BROOKLYN GUIDE");
    addText(
      welcome,
      "p",
      "chat-message-content",
      "Hey there. Ask me about Brooklyn’s famous slice, a few local facts, or what makes this borough special.",
    );
    chatTranscript.append(welcome);
  }

  visibleMessages.forEach(renderChatMessage);
  if (requestPending) {
    renderChatMessage({
      role: "assistant",
      content: "One sec—checking my Brooklyn notes.",
      pending: true,
    });
  }

  chatTranscript.scrollTop = chatTranscript.scrollHeight;
}

fetch("/api/chat/system-prompt")
  .then((response) => {
    if (!response.ok) throw new Error("Unable to load prompt");
    return response.json();
  })
  .then((data) => {
    systemPromptText.textContent = data.systemPrompt;
  })
  .catch(() => {
    systemPromptText.textContent = "The system prompt is unavailable right now.";
  });

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || requestPending) return;

  const history = chatHistory.slice(-20);
  visibleMessages.push({ role: "user", content: message });
  requestPending = true;
  chatStatus.hidden = true;
  chatStatus.textContent = "";
  chatInput.value = "";
  chatInput.disabled = true;
  chatSubmit.disabled = true;
  renderChat();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history,
        settings: getChatSettings(),
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      const errorMessage =
        data && typeof data.error === "string"
          ? data.error
          : "The city guide could not answer just now. Please try again.";
      visibleMessages.push({ role: "assistant", content: errorMessage, error: true });
      throw new Error(errorMessage);
    }

    const answer = {
      role: "assistant",
      content: data.reply,
      metadata: {
        settings: data.settings,
        usage: data.usage,
        model: data.model,
      },
    };
    chatHistory.push({ role: "user", content: message }, { role: "assistant", content: data.reply });
    visibleMessages.push(answer);
  } catch (error) {
    if (!visibleMessages.at(-1)?.error) {
      visibleMessages.push({
        role: "assistant",
        content: "The city guide could not answer just now. Please try again.",
        error: true,
      });
    }
    chatStatus.textContent = error.message;
    chatStatus.hidden = false;
  } finally {
    requestPending = false;
    chatInput.disabled = false;
    chatSubmit.disabled = false;
    renderChat();
    chatInput.focus();
  }
});

renderChat();
