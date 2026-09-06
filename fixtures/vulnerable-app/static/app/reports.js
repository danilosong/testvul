document.getElementById("upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const res = await fetch("/api/upload", { method: "POST", credentials: "include", body: formData });
  const data = await res.json();
  document.getElementById("upload-status").textContent = `received ${data.bytes} bytes`;
});
