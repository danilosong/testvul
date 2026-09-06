import { useParams } from "react-router-dom";

export function ReportDownloadPage() {
  const { scanRunId } = useParams();
  return <main><h1>Baixar relatórios</h1><p>Os dois formatos incluem cobertura completa, configuração imutável, evidências sanitizadas e estado real da execução.</p><div className="download-actions"><a className="button-link" href={`/api/scan-runs/${scanRunId}/reports/html`} download>Baixar relatório HTML</a><a className="button-link" href={`/api/scan-runs/${scanRunId}/reports/json`} download>Baixar relatório JSON</a></div></main>;
}
