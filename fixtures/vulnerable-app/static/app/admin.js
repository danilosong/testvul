async function loadAdmin() {
  const res = await fetch("/api/admin/summary", { credentials: "include" });
  const container = document.getElementById("admin");
  if (!res.ok) {
    container.textContent = "Forbidden";
    return;
  }
  const data = await res.json();
  container.textContent = JSON.stringify(data);
}

loadAdmin();
