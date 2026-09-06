import { useEffect, useState } from "react";

interface AuthProfile { id: number; name: string }
interface Ownership {
  id: number;
  resourceKey: { targetId: number; origin: string; tenantId?: string; objectType: string; resourceId: string };
  ownerAuthProfileId: number;
}

export function ResourceOwnershipPage() {
  const [targetId, setTargetId] = useState(1);
  const [profiles, setProfiles] = useState<AuthProfile[]>([]);
  const [ownership, setOwnership] = useState<Ownership[]>([]);
  const [origin, setOrigin] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [objectType, setObjectType] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [ownerAuthProfileId, setOwnerAuthProfileId] = useState<number | "">("");

  async function reload() {
    const [profileResponse, ownershipResponse] = await Promise.all([
      fetch("/api/auth-profiles"),
      fetch(`/api/resource-ownership?targetId=${targetId}`),
    ]);
    setProfiles((await profileResponse.json()) as AuthProfile[]);
    setOwnership((await ownershipResponse.json()) as Ownership[]);
  }

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await fetch("/api/resource-ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceKey: { targetId, origin, objectType, resourceId, ...(tenantId ? { tenantId } : {}) },
        ownerAuthProfileId,
      }),
    });
    setResourceId("");
    await reload();
  }

  async function remove(id: number) {
    await fetch(`/api/resource-ownership/${id}`, { method: "DELETE" });
    await reload();
  }

  const profileName = (id: number) => profiles.find((profile) => profile.id === id)?.name ?? `Perfil #${id}`;

  return <main>
    <h1>Propriedade de recursos</h1>
    <label>ID do alvo<input type="number" value={targetId} onChange={(event) => setTargetId(Number(event.target.value) || 1)} /></label>
    <form onSubmit={save}>
      <label>Origem<input value={origin} onChange={(event) => setOrigin(event.target.value)} required /></label>
      <label>ID do tenant<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} /></label>
      <label>Tipo do objeto<input value={objectType} onChange={(event) => setObjectType(event.target.value)} required /></label>
      <label>ID do recurso<input value={resourceId} onChange={(event) => setResourceId(event.target.value)} required /></label>
      <label>Proprietário<select value={ownerAuthProfileId} onChange={(event) => setOwnerAuthProfileId(event.target.value ? Number(event.target.value) : "")} required>
        <option value="">Selecione um perfil…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>
      <button type="submit">Declarar propriedade</button>
    </form>
    <table><thead><tr><th>Recurso</th><th>Tenant</th><th>Proprietário</th><th></th></tr></thead><tbody>
      {ownership.map((entry) => <tr key={entry.id}><td>{entry.resourceKey.origin} / {entry.resourceKey.objectType}:{entry.resourceKey.resourceId}</td><td>{entry.resourceKey.tenantId ?? "—"}</td><td>{profileName(entry.ownerAuthProfileId)}</td><td><button onClick={() => remove(entry.id)}>Excluir</button></td></tr>)}
    </tbody></table>
  </main>;
}
