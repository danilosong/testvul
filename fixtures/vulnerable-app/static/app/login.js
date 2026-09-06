document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
  });
  if (res.ok) {
    window.location.href = "/app/projects";
  } else {
    document.getElementById("login-error").textContent = "Invalid credentials";
  }
});
