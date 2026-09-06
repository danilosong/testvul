if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

document.getElementById("save-btn").addEventListener("click", async () => {
  const res = await fetch("/api/sw-save", { method: "PATCH", credentials: "include" });
  const data = await res.json();
  document.getElementById("sw-status").textContent = `swSaveCount=${data.swSaveCount}`;
});
