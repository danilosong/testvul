import { useEffect, useState } from "react";

type BusinessSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface TargetBusinessProfile {
  profileName: string;
  enabled: boolean;
}

interface BusinessExpectation {
  id: number;
  targetId: number;
  objectType: string;
  propertyOrAction: string;
  expectationType: string;
  expectedValue: string;
  severity: BusinessSeverity;
}

interface BusinessInvariant {
  id: number;
  targetId: number;
  name: string;
  objectType: string;
  condition: unknown;
  expected: boolean;
  severity: BusinessSeverity;
}

interface ObservedProperty {
  id: number;
  objectType: string;
  propertyOrAction: string;
  observedValue: unknown;
}

interface BusinessFinding {
  id: number;
  title: string;
  severity: BusinessSeverity;
  category?: string;
  confidence?: string;
  proofLevel?: "OBSERVED" | "INFERRED" | "SAFE_PROBE_CONFIRMED" | "CONFIRMED" | "INCONCLUSIVE" | "NOT_TESTED";
}

interface ScanRunSummary {
  id: number;
  state: string;
  startedAt: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return response.json() as Promise<T>;
}

/** Mirrors backend/src/business-logic/business-findings.ts's getFindingConfirmationLabel — the UI's own confirmation-label boundary, so an OBSERVED/INFERRED finding is never rendered as confirmed here either. */
function isConfirmedProofLevel(proofLevel: BusinessFinding["proofLevel"]): boolean {
  return proofLevel === "CONFIRMED" || proofLevel === "SAFE_PROBE_CONFIRMED";
}

const KNOWN_PROFILES = ["contest"];

export function BusinessLogicRulesPage() {
  const [targetId, setTargetId] = useState<number>(1);
  const [profiles, setProfiles] = useState<TargetBusinessProfile[]>([]);
  const [expectations, setExpectations] = useState<BusinessExpectation[]>([]);
  const [invariants, setInvariants] = useState<BusinessInvariant[]>([]);
  const [scanRuns, setScanRuns] = useState<ScanRunSummary[]>([]);
  const [selectedScanRunId, setSelectedScanRunId] = useState<number | "">("");
  const [observedProperties, setObservedProperties] = useState<ObservedProperty[]>([]);
  const [findings, setFindings] = useState<BusinessFinding[]>([]);

  const [expObjectType, setExpObjectType] = useState("");
  const [expPropertyOrAction, setExpPropertyOrAction] = useState("");
  const [expExpectedValue, setExpExpectedValue] = useState("");
  const [expSeverity, setExpSeverity] = useState<BusinessSeverity>("MEDIUM");

  const [invName, setInvName] = useState("");
  const [invObjectType, setInvObjectType] = useState("");
  const [invSeverity, setInvSeverity] = useState<BusinessSeverity>("MEDIUM");

  async function reloadConfiguredRules() {
    const [loadedProfiles, loadedExpectations, loadedInvariants, loadedScanRuns] = await Promise.all([
      fetchJson<TargetBusinessProfile[]>(`/api/targets/${targetId}/business-profiles`),
      fetchJson<BusinessExpectation[]>(`/api/business-expectations?targetId=${targetId}`),
      fetchJson<BusinessInvariant[]>(`/api/business-invariants?targetId=${targetId}`),
      fetchJson<ScanRunSummary[]>(`/api/targets/${targetId}/scan-runs`),
    ]);
    setProfiles(loadedProfiles);
    setExpectations(loadedExpectations);
    setInvariants(loadedInvariants);
    setScanRuns(loadedScanRuns);
  }

  useEffect(() => {
    reloadConfiguredRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  useEffect(() => {
    if (selectedScanRunId === "") {
      setObservedProperties([]);
      setFindings([]);
      return;
    }
    fetchJson<ObservedProperty[]>(`/api/scan-runs/${selectedScanRunId}/observed-properties`).then(setObservedProperties);
    fetchJson<BusinessFinding[]>(`/api/scan-runs/${selectedScanRunId}/findings`).then(setFindings);
  }, [selectedScanRunId]);

  function isProfileEnabled(name: string): boolean {
    return profiles.find((p) => p.profileName === name)?.enabled ?? false;
  }

  async function toggleProfile(name: string, enabled: boolean) {
    // The endpoint responds 204 No Content — fetchJson would fail parsing an empty body as JSON.
    await fetch(`/api/targets/${targetId}/business-profiles/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await reloadConfiguredRules();
  }

  async function handleCreateExpectation(event: React.FormEvent) {
    event.preventDefault();
    if (!expObjectType || !expPropertyOrAction || !expExpectedValue) return;
    await fetchJson("/api/business-expectations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId,
        objectType: expObjectType,
        propertyOrAction: expPropertyOrAction,
        expectationType: "VISIBILITY",
        expectedValue: expExpectedValue,
        severity: expSeverity,
      }),
    });
    setExpObjectType("");
    setExpPropertyOrAction("");
    setExpExpectedValue("");
    await reloadConfiguredRules();
  }

  async function handleDeleteExpectation(id: number) {
    await fetch(`/api/business-expectations/${id}`, { method: "DELETE" });
    await reloadConfiguredRules();
  }

  async function handleEditExpectation(expectation: BusinessExpectation) {
    const expectedValue = window.prompt("Novo valor esperado", expectation.expectedValue);
    if (expectedValue === null || expectedValue === expectation.expectedValue) return;
    await fetchJson(`/api/business-expectations/${expectation.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedValue }),
    });
    await reloadConfiguredRules();
  }

  async function handleCreateInvariant(event: React.FormEvent) {
    event.preventDefault();
    if (!invName || !invObjectType) return;
    await fetchJson("/api/business-invariants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId, name: invName, objectType: invObjectType, condition: { field: "status", operator: "EXISTS" }, expected: true, severity: invSeverity }),
    });
    setInvName("");
    setInvObjectType("");
    await reloadConfiguredRules();
  }

  async function handleDeleteInvariant(id: number) {
    await fetch(`/api/business-invariants/${id}`, { method: "DELETE" });
    await reloadConfiguredRules();
  }

  async function handleEditInvariant(invariant: BusinessInvariant) {
    const name = window.prompt("Novo nome da invariante", invariant.name);
    if (name === null || name === invariant.name) return;
    await fetchJson(`/api/business-invariants/${invariant.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    await reloadConfiguredRules();
  }

  return (
    <div>
      <h1>Regras de lógica de negócio</h1>

      <label>
        ID do alvo:{" "}
        <input
          aria-label="ID do alvo"
          type="number"
          value={targetId}
          onChange={(e) => setTargetId(Number(e.target.value) || 1)}
        />
      </label>

      {/* ── View 1: Configured Rules — what the operator has set up ── */}
      <section id="configured-rules-view" aria-label="Regras configuradas">
        <h2>Regras configuradas</h2>

        <h3>Perfis</h3>
        <ul id="profile-toggles">
          {KNOWN_PROFILES.map((name) => (
            <li key={name}>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Ativar perfil ${name}`}
                  checked={isProfileEnabled(name)}
                  onChange={(e) => toggleProfile(name, e.target.checked)}
                />
                {name}
              </label>
            </li>
          ))}
        </ul>

        <h3>Expectativas de negócio</h3>
        <form onSubmit={handleCreateExpectation}>
          <input aria-label="Tipo do objeto" placeholder="Ex.: Campaign" value={expObjectType} onChange={(e) => setExpObjectType(e.target.value)} />
          <input
            aria-label="Propriedade ou ação"
            placeholder="Ex.: currentLowestEligibleNumber"
            value={expPropertyOrAction}
            onChange={(e) => setExpPropertyOrAction(e.target.value)}
          />
          <input aria-label="Valor esperado" placeholder="Ex.: PRIVATE" value={expExpectedValue} onChange={(e) => setExpExpectedValue(e.target.value)} />
          <select aria-label="Severidade da expectativa" value={expSeverity} onChange={(e) => setExpSeverity(e.target.value as BusinessSeverity)}>
            {(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as BusinessSeverity[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit">Adicionar expectativa</button>
        </form>
        <table id="business-expectations-table">
          <thead>
            <tr>
              <th>Tipo do objeto</th>
              <th>Propriedade/ação</th>
              <th>Tipo</th>
              <th>Valor esperado</th>
              <th>Severidade</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {expectations.map((expectation) => (
              <tr key={expectation.id}>
                <td>{expectation.objectType}</td>
                <td>{expectation.propertyOrAction}</td>
                <td>{expectation.expectationType}</td>
                <td>{expectation.expectedValue}</td>
                <td>{expectation.severity}</td>
                <td>
                  <button onClick={() => handleEditExpectation(expectation)}>Editar</button>
                  <button onClick={() => handleDeleteExpectation(expectation.id)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Invariantes de negócio</h3>
        <form onSubmit={handleCreateInvariant}>
          <input aria-label="Nome da invariante" placeholder="Ex.: Número do ticket é imutável após pagamento" value={invName} onChange={(e) => setInvName(e.target.value)} />
          <input aria-label="Tipo de objeto da invariante" placeholder="Ex.: Ticket" value={invObjectType} onChange={(e) => setInvObjectType(e.target.value)} />
          <select aria-label="Severidade da invariante" value={invSeverity} onChange={(e) => setInvSeverity(e.target.value as BusinessSeverity)}>
            {(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as BusinessSeverity[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit">Adicionar invariante</button>
        </form>
        <table id="business-invariants-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo do objeto</th>
              <th>Severidade</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invariants.map((invariant) => (
              <tr key={invariant.id}>
                <td>{invariant.name}</td>
                <td>{invariant.objectType}</td>
                <td>{invariant.severity}</td>
                <td>
                  <button onClick={() => handleEditInvariant(invariant)}>Editar</button>
                  <button onClick={() => handleDeleteInvariant(invariant.id)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <label>
        Execução da auditoria:{" "}
        <select aria-label="Execução da auditoria" value={selectedScanRunId} onChange={(e) => setSelectedScanRunId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Selecione uma execução…</option>
          {scanRuns.map((run) => (
            <option key={run.id} value={run.id}>
              #{run.id} — {run.state} — {run.startedAt}
            </option>
          ))}
        </select>
      </label>

      {/* ── View 2: Observed Behavior — what the engine itself found, never compared against a rule here ── */}
      <section id="observed-behavior-view" aria-label="Comportamento observado">
        <h2>Comportamento observado</h2>
        <table id="observed-behavior-table">
          <thead>
            <tr>
              <th>Tipo do objeto</th>
              <th>Propriedade/ação</th>
              <th>Valor observado</th>
            </tr>
          </thead>
          <tbody>
            {observedProperties.map((property) => (
              <tr key={property.id}>
                <td>{property.objectType}</td>
                <td>{property.propertyOrAction}</td>
                <td>{JSON.stringify(property.observedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── View 3: Violations — findings only, an OBSERVED/INFERRED hypothesis is never labeled confirmed here ── */}
      <section id="violations-view" aria-label="Violações">
        <h2>Violações</h2>
        <table id="violations-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Severidade</th>
              <th>Categoria</th>
              <th>Nível de prova</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id}>
                <td>{finding.title}</td>
                <td>{finding.severity}</td>
                <td>{finding.category ?? "—"}</td>
                <td>{finding.proofLevel ?? "—"}</td>
                <td>{isConfirmedProofLevel(finding.proofLevel) ? "CONFIRMED" : (finding.proofLevel ?? "UNCONFIRMED")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
