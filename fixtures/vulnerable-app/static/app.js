// Fixture-only client script. Referenced by the operation-discovery JS
// static-analysis tests as a source of literal PATCH call sites.

function saveProjectNotes(id, body) {
  return axios.patch("/api/projects/" + id, body);
}

function saveSettings(body) {
  return fetch("/api/settings", { method: "PATCH", body: JSON.stringify(body) });
}
