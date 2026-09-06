async function loadProfile() {
  const res = await fetch("/api/profile", { credentials: "include" });
  const data = await res.json();
  // Deliberately vulnerable DOM sink: the stored value is inserted as raw
  // HTML, and only after hydration — the initial page has an empty #bio div.
  document.getElementById("bio").innerHTML = data.bio;
}

document.getElementById("bio-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ bio: form.get("bio") }),
  });
  loadProfile();
});

loadProfile();
