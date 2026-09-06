async function loadProjects() {
  const me = await fetch("/api/me", { credentials: "include" }).then((r) => r.json());
  const projects = await fetch("/api/my-projects", { credentials: "include" }).then((r) => r.json());

  const list = document.getElementById("projects-list");
  list.innerHTML = "";
  for (const project of projects) {
    const link = document.createElement("a");
    link.href = `/app/projects/${project.id}`;
    link.textContent = project.name;
    const item = document.createElement("div");
    item.appendChild(link);
    list.appendChild(item);

    // GTM tag injected only after hydration — never present in the initial HTML.
    const gtmScript = document.createElement("script");
    gtmScript.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(project.analyticsGtm)}`;
    gtmScript.async = true;
    document.head.appendChild(gtmScript);
  }

  return me;
}

loadProjects();
