import { useEffect, useState } from "react";

type AuthMethod = "BEARER" | "COOKIE" | "API_KEY" | "CUSTOM_HEADERS";

interface AuthProfile {
  id: number;
  name: string;
  method: AuthMethod;
  hasCredential: boolean;
  maskedCredential?: string;
  browserAuthLoginUrl?: string;
  browserAuthSelectors?: Record<string, string>;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json() as Promise<T>;
}

export function AuthProfilesPage() {
  const [profiles, setProfiles] = useState<AuthProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<AuthMethod>("BEARER");
  const [credential, setCredential] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [selectors, setSelectors] = useState("");
  const [allowedHosts, setAllowedHosts] = useState<string[]>([]);
  const [newHost, setNewHost] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [status, setStatus] = useState("");

  async function reload() {
    setProfiles(await readJson<AuthProfile[]>("/api/auth-profiles"));
  }

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    reload().catch((error: Error) => setStatus(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectProfile(profile: AuthProfile) {
    setSelectedId(profile.id);
    setName(profile.name);
    setMethod(profile.method);
    setCredential("");
    setLoginUrl(profile.browserAuthLoginUrl ?? "");
    setSelectors(profile.browserAuthSelectors ? JSON.stringify(profile.browserAuthSelectors, null, 2) : "");
    setAllowedHosts(await readJson<string[]>(`/api/auth-profiles/${profile.id}/allowed-hosts`));
  }

  function resetForm() {
    setSelectedId(null);
    setName("");
    setMethod("BEARER");
    setCredential("");
    setLoginUrl("");
    setSelectors("");
    setAllowedHosts([]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      name,
      method,
      ...(credential ? { credential } : {}),
      ...(loginUrl ? { browserAuthLoginUrl: loginUrl } : {}),
      ...(selectors ? { browserAuthSelectors: JSON.parse(selectors) as Record<string, string> } : {}),
    };
    if (selectedId === null) {
      await readJson("/api/auth-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await readJson(`/api/auth-profiles/${selectedId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    resetForm();
    await reload();
    setStatus("Perfil salvo. A credencial completa nunca é exibida após o salvamento.");
  }

  async function remove(id: number) {
    await fetch(`/api/auth-profiles/${id}`, { method: "DELETE" });
    if (selectedId === id) resetForm();
    await reload();
  }

  async function addHost() {
    if (selectedId === null || !newHost.trim()) return;
    await readJson(`/api/auth-profiles/${selectedId}/allowed-hosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname: newHost }),
    });
    setAllowedHosts(await readJson<string[]>(`/api/auth-profiles/${selectedId}/allowed-hosts`));
    setNewHost("");
  }

  async function testProfile() {
    if (selectedId === null || !testUrl) return;
    const hostname = new URL(testUrl).hostname;
    const result = await readJson<{ status: number }>(`/api/auth-profiles/${selectedId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl: testUrl, scope: [hostname] }),
    });
    setStatus(`O teste do perfil retornou HTTP ${result.status}.`);
  }

  return (
    <main>
      <h1>Perfis de autenticação</h1>
      {status && <p role="status">{status}</p>}
      <section className="split-view">
        <div>
          <h2>Perfis salvos</h2>
          <button onClick={resetForm}>Novo perfil</button>
          <ul>
            {profiles.map((profile) => (
              <li key={profile.id}>
                <button onClick={() => selectProfile(profile)}>{profile.name}</button> {profile.method} — {profile.maskedCredential ?? "Sem segredo"}
                <button onClick={() => remove(profile.id)}>Excluir</button>
              </li>
            ))}
          </ul>
        </div>
        <form onSubmit={save}>
          <h2>{selectedId === null ? "Novo perfil" : "Editar perfil"}</h2>
          <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Método<select value={method} onChange={(event) => setMethod(event.target.value as AuthMethod)}>
            <option value="BEARER">Bearer</option><option value="COOKIE">Cookie</option><option value="API_KEY">Chave de API</option><option value="CUSTOM_HEADERS">Cabeçalhos personalizados</option>
          </select></label>
          <label>Credencial<input type="password" value={credential} placeholder={selectedId === null ? "Segredo" : "Deixe vazio para manter o segredo atual"} onChange={(event) => setCredential(event.target.value)} /></label>
          <label>URL de login no navegador<input value={loginUrl} onChange={(event) => setLoginUrl(event.target.value)} /></label>
          <label>Seletores do navegador (JSON)<textarea value={selectors} onChange={(event) => setSelectors(event.target.value)} /></label>
          <button type="submit">Salvar perfil</button>
          {selectedId !== null && <>
            <h3>Hosts com compartilhamento de credenciais</h3>
            <p>{allowedHosts.join(", ") || "Nenhum"}</p>
            <input aria-label="Host permitido" value={newHost} onChange={(event) => setNewHost(event.target.value)} /><button type="button" onClick={addHost}>Adicionar host</button>
            <h3>Testar perfil</h3>
            <input aria-label="URL de teste do perfil" value={testUrl} onChange={(event) => setTestUrl(event.target.value)} /><button type="button" onClick={testProfile}>Testar perfil</button>
          </>}
        </form>
      </section>
    </main>
  );
}
