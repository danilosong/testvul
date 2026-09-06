import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

interface ProgressData {
  scanRunId: number;
  state: string;
  cancellationRequested: boolean;
  stages: { stage: string; status: string }[];
}

const STAGE_LABELS: Record<string, string> = {
  DNS_RESOLVER: "Resolução DNS", SCOPE_VALIDATION: "Validação de escopo", HTTP_DISCOVERY: "Descoberta HTTP",
  CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY: "Crawler e descoberta pelo navegador", API_DISCOVERY: "Descoberta de API",
  JSON_DOM_ANALYZER: "Análise JSON/DOM", OPERATION_DISCOVERY: "Descoberta de operações",
  BUSINESS_OBJECT_STATE_DISCOVERY: "Descoberta de objetos e estados de negócio", CANDIDATE_GENERATOR: "Geração de candidatos",
  ELIGIBILITY_CLASSIFICATION: "Classificação de elegibilidade", AUTHENTICATION_MAPPING: "Mapeamento de autenticação",
  SECURITY_TESTS: "Testes de segurança", EVIDENCE: "Evidências", RESTORE: "Restauração", REPORT: "Relatório",
};
const STATUS_LABELS: Record<string, string> = { PENDING: "Pendente", RUNNING: "Em andamento", COMPLETED: "Concluído", FAILED: "Falhou" };

export function ScanProgressPage() {
  const { scanRunId } = useParams();
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [requestedBy, setRequestedBy] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => fetch(`/api/scan-runs/${scanRunId}/progress`).then((response) => response.json() as Promise<ProgressData>).then((data) => active && setProgress(data));
    load();
    const timer = window.setInterval(load, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [scanRunId]);

  async function cancel() {
    await fetch(`/api/scan-runs/${scanRunId}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy }) });
    const response = await fetch(`/api/scan-runs/${scanRunId}/progress`);
    setProgress((await response.json()) as ProgressData);
  }

  if (!progress) return <main><p>Carregando progresso da auditoria…</p></main>;
  return <main>
    <h1>Auditoria #{progress.scanRunId}</h1>
    <p className={`status status-${progress.state.toLowerCase()}`}>Estado: {progress.state}</p>
    {progress.cancellationRequested && <p role="status">Cancelamento solicitado. Qualquer restauração em andamento será concluída primeiro.</p>}
    <label>Identidade do operador<input value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} /></label>
    <button onClick={cancel} disabled={progress.cancellationRequested || ["COMPLETED", "FAILED", "CANCELLED", "RESTORE_REQUIRED"].includes(progress.state)}>Cancelar auditoria</button>
    <ol className="stage-list">{progress.stages.map((entry) => <li key={entry.stage}><strong>{STAGE_LABELS[entry.stage] ?? entry.stage}</strong><span>{STATUS_LABELS[entry.status] ?? entry.status}</span></li>)}</ol>
  </main>;
}
