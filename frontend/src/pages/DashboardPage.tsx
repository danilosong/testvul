import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

interface DashboardData {
  target: { id: number; name: string; hostname: string };
  scanRun: { id: number; state: string; hadRestoreIncident: boolean; hadPartialTruncation: boolean; truncationLimitReached: string | null };
  discoveryCounts: Record<string, number>;
  findingsBySeverity: Record<string, number>;
  technicalCoverage: unknown[];
  browserCoverage: Record<string, unknown>;
  businessLogicCoverage: Record<string, unknown>;
  environmentClassification: string;
  safetySkipped: { eligibilityState: string; count: number }[];
}

const LABELS: Record<string, string> = {
  pages: "Páginas", apiEndpoints: "Endpoints de API", forms: "Formulários", jsonEndpoints: "Endpoints JSON",
  authEndpoints: "Endpoints de autenticação", configEndpoints: "Endpoints de configuração", operations: "Operações",
  businessObjects: "Objetos de negócio", businessStates: "Estados de negócio",
};

export function DashboardPage() {
  const params = useParams();
  const [requestedId, setRequestedId] = useState(params.scanRunId ?? "1");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.scanRunId) return;
    fetch(`/api/scan-runs/${params.scanRunId}/dashboard`)
      .then((response) => { if (!response.ok) throw new Error("Execução não encontrada."); return response.json() as Promise<DashboardData>; })
      .then(setDashboard).catch((caught: Error) => setError(caught.message));
  }, [params.scanRunId]);

  if (!params.scanRunId) return <main><h1>Painel de auditorias</h1><label>ID da execução<input value={requestedId} onChange={(event) => setRequestedId(event.target.value)} /></label><Link className="button-link" to={`/scans/${requestedId}`}>Abrir painel</Link></main>;
  if (error) return <main><p role="alert">{error}</p></main>;
  if (!dashboard) return <main><p>Carregando painel…</p></main>;

  return <main>
    <h1>{dashboard.target.name}</h1>
    <p>{dashboard.target.hostname} · ambiente {dashboard.environmentClassification}</p>
    <p className={`status status-${dashboard.scanRun.state.toLowerCase()}`}>Estado real: {dashboard.scanRun.state}</p>
    {dashboard.scanRun.hadPartialTruncation && <p role="alert">Auditoria parcial. Limite atingido: {dashboard.scanRun.truncationLimitReached}.</p>}
    {dashboard.scanRun.hadRestoreIncident && <p role="alert">Esta execução possui histórico de incidente de restauração.</p>}
    <nav className="action-nav"><Link to={`/scans/${dashboard.scanRun.id}/progress`}>Acompanhar progresso</Link><Link to={`/scans/${dashboard.scanRun.id}/attack-surface`}>Superfície de ataque</Link><Link to={`/scans/${dashboard.scanRun.id}/reports`}>Baixar relatórios</Link></nav>
    <section><h2>Descoberta</h2><div className="metric-grid">{Object.entries(dashboard.discoveryCounts).map(([key, value]) => <article key={key}><strong>{value}</strong><span>{LABELS[key] ?? key}</span></article>)}</div></section>
    <section><h2>Achados por severidade</h2><div className="metric-grid">{["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((severity) => <article key={severity}><strong>{dashboard.findingsBySeverity[severity] ?? 0}</strong><span>{severity}</span></article>)}</div></section>
    <section><h2>Cobertura técnica</h2><pre>{JSON.stringify(dashboard.technicalCoverage, null, 2)}</pre></section>
    <section><h2>Cobertura do navegador</h2><pre>{JSON.stringify(dashboard.browserCoverage, null, 2)}</pre></section>
    <section><h2>Cobertura de lógica de negócio</h2><pre>{JSON.stringify(dashboard.businessLogicCoverage, null, 2)}</pre></section>
    <section><h2>Testes não executados por segurança</h2><ul>{dashboard.safetySkipped.map((item) => <li key={item.eligibilityState}>{item.eligibilityState}: {item.count}</li>)}</ul></section>
  </main>;
}
