const list = document.getElementById("list");
const addButton = document.getElementById("add");

let saveTimer = 0;
let prompts = [];

function uid() {
	if (crypto.randomUUID) {
		return crypto.randomUUID();
	}

	return `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function scheduleSave() {
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		void chrome.storage.local.set({ prompts });
	}, 200);
}

function render() {
	list.replaceChildren();

	if (prompts.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "No prompts yet. Add one and it will show up in the popup.";
		list.appendChild(empty);
		return;
	}

	for (const prompt of prompts) {
		const card = document.createElement("article");
		card.className = "card";
		card.innerHTML = `
			<input class="name" type="text" placeholder="Name" />
			<textarea class="text" placeholder="Prompt text"></textarea>
			<div class="card-actions">
				<button class="delete" type="button">Delete</button>
			</div>
		`;

		const nameInput = card.querySelector(".name");
		const textInput = card.querySelector(".text");
		nameInput.value = prompt.name || "";
		textInput.value = prompt.text || "";

		nameInput.addEventListener("input", () => {
			prompt.name = nameInput.value;
			scheduleSave();
		});

		textInput.addEventListener("input", () => {
			prompt.text = textInput.value;
			scheduleSave();
		});

		card.querySelector(".delete").addEventListener("click", () => {
			prompts = prompts.filter((item) => item.id !== prompt.id);
			scheduleSave();
			render();
		});

		list.appendChild(card);
	}
}

addButton.addEventListener("click", () => {
	prompts.push({
		id: uid(),
		name: "New prompt",
		text: "",
	});
	scheduleSave();
	render();
});

async function init() {
	const stored = await chrome.storage.local.get({ prompts: [] });
	prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
	render();
}

void init();
