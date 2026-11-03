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
