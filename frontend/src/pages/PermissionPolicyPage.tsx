import { useEffect, useState } from "react";

interface AuthProfile {
  id: number;
  name: string;
  method: string;
}

interface AuthorizationExpectation {
  id: number;
  authProfileId: number;
  action: string;
  expected: "ALLOWED" | "DENIED";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return response.json() as Promise<T>;
}

export function PermissionPolicyPage() {
  const [profiles, setProfiles] = useState<AuthProfile[]>([]);
  const [expectations, setExpectations] = useState<AuthorizationExpectation[]>([]);
  const [formProfileId, setFormProfileId] = useState<number | "">("");
  const [formAction, setFormAction] = useState("");
  const [formExpected, setFormExpected] = useState<"ALLOWED" | "DENIED">("DENIED");

  async function reload() {
    const loadedProfiles = await fetchJson<AuthProfile[]>("/api/auth-profiles");
    setProfiles(loadedProfiles);
    const perProfile = await Promise.all(
      loadedProfiles.map((profile) => fetchJson<AuthorizationExpectation[]>(`/api/authorization-expectations?authProfileId=${profile.id}`)),
    );
    setExpectations(perProfile.flat());
  }

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (formProfileId === "" || !formAction) return;
    await fetchJson("/api/authorization-expectations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authProfileId: formProfileId, action: formAction, expected: formExpected }),
    });
    setFormAction("");
    await reload();
  }

  const actions = [...new Set(expectations.map((e) => e.action))].sort();

  function cellValue(profileId: number, action: string): string {
    const match = expectations.find((e) => e.authProfileId === profileId && e.action === action);
    return match ? match.expected : "—";
  }

  return (
    <div>
      <h1>Política esperada de permissões</h1>

      <form onSubmit={handleSubmit}>
        <select
          aria-label="Perfil"
          value={formProfileId}
          onChange={(e) => setFormProfileId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">Selecione um perfil…</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <input aria-label="Ação" placeholder="Ex.: CAMPAIGN_EDIT" value={formAction} onChange={(e) => setFormAction(e.target.value)} />
        <select aria-label="Resultado esperado" value={formExpected} onChange={(e) => setFormExpected(e.target.value as "ALLOWED" | "DENIED")}>
          <option value="ALLOWED">Permitido</option>
          <option value="DENIED">Negado</option>
        </select>
        <button type="submit">Adicionar expectativa</button>
      </form>

      <table id="permission-matrix">
        <thead>
          <tr>
            <th>Ação</th>
            {profiles.map((profile) => (
              <th key={profile.id}>{profile.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <tr key={action}>
              <td>{action}</td>
              {profiles.map((profile) => (
                <td key={profile.id}>{cellValue(profile.id, action)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
