import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

interface FindingDetail {
  id: number; title: string; severity: string; targetName: string; targetHostname: string; targetEndpoint?: string; fieldPath?: string;
  authProfileName?: string; observation: string; restoreStatus?: string; evidentiaryOutcome: string;
  category?: string; confidence?: string; proofLevel?: string; recommendation?: string;
  browserEvidence: { id: number; kind: "SCREENSHOT" | "DOM_SNAPSHOT"; assetRef?: string; structuralData?: unknown }[];
}

export function FindingDetailPage() {
  const { findingId } = useParams();
  const [finding, setFinding] = useState<FindingDetail | null>(null);
  useEffect(() => { fetch(`/api/findings/${findingId}`).then((response) => response.json()).then(setFinding); }, [findingId]);
  if (!finding) return <main><p>Carregando achado…</p></main>;
  return <main>
    <h1>{finding.title}</h1><p className={`severity severity-${finding.severity.toLowerCase()}`}>Severidade: {finding.severity}</p>
    <dl><dt>Alvo</dt><dd>{finding.targetName} ({finding.targetHostname})</dd><dt>Endpoint</dt><dd>{finding.targetEndpoint ?? "—"}</dd><dt>Campo</dt><dd>{finding.fieldPath ?? "—"}</dd><dt>Autenticação</dt><dd>{finding.authProfileName ?? "Não associada"}</dd><dt>Observação</dt><dd>{finding.observation}</dd><dt>Estado da restauração</dt><dd>{finding.restoreStatus ?? "Não aplicável"}</dd><dt>Resultado evidenciário</dt><dd>{finding.evidentiaryOutcome}</dd></dl>
    {finding.category && <section><h2>Lógica de negócio</h2><dl><dt>Categoria</dt><dd>{finding.category}</dd><dt>Confiança</dt><dd>{finding.confidence}</dd><dt>Nível de prova</dt><dd>{finding.proofLevel}</dd></dl></section>}
    <section><h2>Evidência assistida pelo navegador</h2>{finding.browserEvidence.length === 0 ? <p>Nenhuma evidência de navegador.</p> : finding.browserEvidence.map((evidence) => <article key={evidence.id}><h3>{evidence.kind === "SCREENSHOT" ? "Captura de tela" : "Estado do DOM"}</h3>{evidence.assetRef && <img src={evidence.assetRef} alt="Evidência visual sanitizada" />}<pre>{JSON.stringify(evidence.structuralData, null, 2)}</pre></article>)}</section>
    {finding.recommendation && <section><h2>Recomendação</h2><p>{finding.recommendation}</p></section>}
  </main>;
}
