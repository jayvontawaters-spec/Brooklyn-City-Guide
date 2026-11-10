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

// Dish photos are stored in the database, unlike the visitor's temporary chat.
const MAX_DISH_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_DISH_IMAGE_SIDE = 1280;
const ALLOWED_DISH_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const dishUploadForm = document.querySelector("#dish-upload-form");
const dishTitleInput = document.querySelector("#dish-title");
const dishCaptionInput = document.querySelector("#dish-caption");
const dishImageInput = document.querySelector("#dish-image");
const dishUploadButton = document.querySelector("#dish-upload-button");
const dishUploadStatus = document.querySelector("#dish-upload-status");
const dishPreviewWrap = document.querySelector("#dish-preview-wrap");
const dishPreview = document.querySelector("#dish-preview");
const dishGalleryGrid = document.querySelector("#dish-gallery-grid");
const dishGalleryStatus = document.querySelector("#dish-gallery-status");
const dishPhotoCount = document.querySelector("#dish-photo-count");
let dishPhotos = [];
let dishPreviewUrl = null;

function dishFileMimeType(file) {
  if (ALLOWED_DISH_TYPES.has(file.type)) return file.type;

  const extension = file.name.toLowerCase().split(".").pop();
  const extensionTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return extensionTypes[extension] || file.type;
}

function setDishUploadMessage(message, kind = "") {
  dishUploadStatus.textContent = message;
  if (kind) {
    dishUploadStatus.dataset.kind = kind;
  } else {
    delete dishUploadStatus.dataset.kind;
  }
}

function clearDishPreview() {
  if (dishPreviewUrl) URL.revokeObjectURL(dishPreviewUrl);
  dishPreviewUrl = null;
  dishPreview.removeAttribute("src");
  dishPreviewWrap.hidden = true;
}

dishImageInput.addEventListener("change", () => {
  setDishUploadMessage("");
  clearDishPreview();

  const file = dishImageInput.files?.[0];
  if (!file) return;

  if (!ALLOWED_DISH_TYPES.has(dishFileMimeType(file))) {
    dishImageInput.value = "";
    setDishUploadMessage("Please choose a JPEG, PNG, or WebP photo.", "error");
    return;
  }

  if (file.size > MAX_DISH_IMAGE_BYTES) {
    dishImageInput.value = "";
    setDishUploadMessage("That photo is over 3 MB. Choose a smaller image.", "error");
    return;
  }

  dishPreviewUrl = URL.createObjectURL(file);
  dishPreview.src = dishPreviewUrl;
  dishPreviewWrap.hidden = false;
});

async function openDishImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function canvasToBlob(canvas, mimeType) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("This photo could not be prepared. Try another image."));
        }
      },
      mimeType,
      mimeType === "image/png" ? undefined : 0.84,
    );
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("This photo could not be read. Try another image."));
      }
    };
    reader.onerror = () => reject(new Error("This photo could not be read. Try another image."));
    reader.readAsDataURL(blob);
  });
}

async function resizeDishImage(file) {
  const image = await openDishImage(file);
  const largestSide = Math.max(image.width, image.height);
  const scale = Math.min(1, MAX_DISH_IMAGE_SIDE / largestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    if (typeof image.close === "function") image.close();
    throw new Error("This photo could not be resized in your browser.");
  }

  // Give transparent PNGs a white background if the browser converts the file.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (typeof image.close === "function") image.close();

  const blob = await canvasToBlob(canvas, dishFileMimeType(file));
  if (!ALLOWED_DISH_TYPES.has(blob.type)) {
    throw new Error("This browser could not prepare that image type. Try a JPEG, PNG, or WebP.");
  }
  if (blob.size > MAX_DISH_IMAGE_BYTES) {
    throw new Error("This photo is still over 3 MB after resizing. Choose a smaller image.");
  }

  return blobToDataUrl(blob);
}

function formatDishDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "RECENTLY ADDED";
  return `ADDED ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase()}`;
}

function renderDishGallery() {
  dishGalleryGrid.replaceChildren();
  const count = dishPhotos.length;
  dishPhotoCount.textContent = `${count} ${count === 1 ? "PHOTO" : "PHOTOS"}`;

  if (count === 0) {
    dishGalleryStatus.textContent = "No slices in the gallery yet. Add the first one.";
    return;
  }

  dishGalleryStatus.textContent = "";
  dishPhotos.forEach((photo) => {
    const card = document.createElement("article");
    card.className = "dish-card";

    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.className = "dish-card-image";
    image.src = photo.imageUrl;
    image.alt = `${photo.title}${photo.caption ? `: ${photo.caption}` : ""}`;
    image.loading = "lazy";
    image.decoding = "async";

    const dateCaption = document.createElement("figcaption");
    dateCaption.textContent = formatDishDate(photo.createdAt);
    figure.append(image, dateCaption);

    const copy = document.createElement("div");
    copy.className = "dish-card-copy";
    const title = document.createElement("h4");
    title.textContent = photo.title;
    copy.append(title);

    if (photo.caption) {
      const caption = document.createElement("p");
      caption.textContent = photo.caption;
      copy.append(caption);
    }

    card.append(figure, copy);
    dishGalleryGrid.append(card);
  });
}

async function loadDishPhotos() {
  dishGalleryStatus.textContent = "Loading the neighborhood’s favorites…";
  dishPhotoCount.textContent = "LOADING PHOTOS";

  try {
    const response = await fetch("/api/dishes");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "The gallery could not be loaded.");
    }
    dishPhotos = data;
    renderDishGallery();
  } catch (error) {
    dishPhotoCount.textContent = "GALLERY UNAVAILABLE";
    dishGalleryStatus.textContent =
      error.message || "The gallery could not be loaded. Try refreshing the page.";
  }
}

dishUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = dishImageInput.files?.[0];
  const title = dishTitleInput.value.trim();

  setDishUploadMessage("");
  if (!title) {
    setDishUploadMessage("Add a short title for your photo.", "error");
    dishTitleInput.focus();
    return;
  }
  if (!file) {
    setDishUploadMessage("Choose a JPEG, PNG, or WebP photo first.", "error");
    dishImageInput.focus();
    return;
  }
  if (!ALLOWED_DISH_TYPES.has(dishFileMimeType(file))) {
    setDishUploadMessage("Please choose a JPEG, PNG, or WebP photo.", "error");
    return;
  }
  if (file.size > MAX_DISH_IMAGE_BYTES) {
    setDishUploadMessage("That photo is over 3 MB. Choose a smaller image.", "error");
    return;
  }

  dishUploadButton.disabled = true;
  dishUploadButton.textContent = "Preparing photo…";

  try {
    const image = await resizeDishImage(file);
    const caption = dishCaptionInput.value.trim();
    const payload = { title, image };
    if (caption) payload.caption = caption;

    dishUploadButton.textContent = "Uploading…";
    const response = await fetch("/api/dishes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Your photo could not be saved. Please try again.");
    }

    dishPhotos.unshift(data);
    renderDishGallery();
    dishUploadForm.reset();
    clearDishPreview();
    setDishUploadMessage("Your photo is at the top of the gallery. Nice one!", "success");
  } catch (error) {
    setDishUploadMessage(
      error.message || "Your photo could not be saved. Please try again.",
      "error",
    );
  } finally {
    dishUploadButton.disabled = false;
    dishUploadButton.innerHTML = 'Share to gallery <span aria-hidden="true">↗</span>';
  }
});

loadDishPhotos();
