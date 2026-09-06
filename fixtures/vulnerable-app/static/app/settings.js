const QUANTITY_CLIENT_LIMIT = 10;

async function loadSettings() {
  const [vulnerable, enforced] = await Promise.all([
    fetch("/api/settings", { credentials: "include" }).then((r) => r.json()),
    fetch("/api/settings-enforced", { credentials: "include" }).then((r) => r.json()),
  ]);

  const container = document.getElementById("settings");
  container.innerHTML = "";

  container.appendChild(
    buildQuantitySection("Client-limit-only quantity", vulnerable.quantity, "/api/settings", false),
  );
  container.appendChild(
    buildQuantitySection("Server-enforced quantity", enforced.quantity, "/api/settings-enforced", true),
  );

  const deleteButton = document.createElement("button");
  deleteButton.id = "delete-account-btn";
  deleteButton.textContent = "Delete Account";
  deleteButton.addEventListener("click", () => {
    // Never invoked automatically anywhere in this fixture or its scripts.
    fetch("/api/account", { method: "DELETE", credentials: "include" });
  });
  container.appendChild(deleteButton);
}

function buildQuantitySection(label, initialQuantity, endpoint, serverEnforced) {
  const section = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = label;
  section.appendChild(heading);

  const quantityLabel = document.createElement("span");
  quantityLabel.className = "quantity-value";
  quantityLabel.textContent = String(initialQuantity);
  section.appendChild(quantityLabel);

  let quantity = initialQuantity;

  const increaseButton = document.createElement("button");
  increaseButton.className = "increase-btn";
  increaseButton.textContent = "+";
  increaseButton.disabled = quantity >= QUANTITY_CLIENT_LIMIT;
  increaseButton.addEventListener("click", () => {
    quantity += 1;
    quantityLabel.textContent = String(quantity);
    if (quantity >= QUANTITY_CLIENT_LIMIT) increaseButton.disabled = true; // client-side-only check
  });
  section.appendChild(increaseButton);

  const saveButton = document.createElement("button");
  saveButton.className = "save-settings-btn";
  saveButton.textContent = "Save Settings";
  saveButton.addEventListener("click", async () => {
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ quantity }),
    });
    section.dataset.lastSaveStatus = String(res.status);
  });
  section.appendChild(saveButton);

  return section;
}

loadSettings();
