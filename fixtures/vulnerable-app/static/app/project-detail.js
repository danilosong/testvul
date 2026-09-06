async function loadProjectDetail() {
  const id = window.location.pathname.split("/").pop();
  const res = await fetch(`/api/projects/${id}`, { credentials: "include" });
  const container = document.getElementById("project-detail");
  if (!res.ok) {
    container.textContent = "Not found";
    return;
  }
  const project = await res.json();
  const heading = document.createElement("h1");
  heading.textContent = project.name;
  container.appendChild(heading);
}

loadProjectDetail();
