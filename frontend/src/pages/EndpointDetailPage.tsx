import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

interface EndpointDetail {
  id: number; method: string; url: string; classification: string; contentType?: string; authRequired?: boolean; fieldCount: number;
  interestingFields: { id: number; fieldPath: string; classification: string; sampleValueSanitized?: string }[];
}

export function EndpointDetailPage() {
  const { endpointId } = useParams();
  const [detail, setDetail] = useState<EndpointDetail | null>(null);
  useEffect(() => { fetch(`/api/endpoints/${endpointId}`).then((response) => response.json()).then(setDetail); }, [endpointId]);
  if (!detail) return <main><p>Carregando endpoint…</p></main>;
  return <main><h1>Detalhes do endpoint</h1><dl><dt>URL</dt><dd>{detail.url}</dd><dt>Método</dt><dd>{detail.method}</dd><dt>Classificação</dt><dd>{detail.classification}</dd><dt>Tipo de conteúdo</dt><dd>{detail.contentType ?? "Não informado"}</dd><dt>Autenticação obrigatória</dt><dd>{detail.authRequired === undefined ? "Não determinada" : detail.authRequired ? "Sim" : "Não"}</dd><dt>Total de campos</dt><dd>{detail.fieldCount}</dd></dl><h2>Campos de interesse</h2><table><thead><tr><th>Caminho</th><th>Classificação</th><th>Amostra sanitizada</th></tr></thead><tbody>{detail.interestingFields.map((field) => <tr key={field.id}><td>{field.fieldPath}</td><td>{field.classification}</td><td>{field.sampleValueSanitized ?? "—"}</td></tr>)}</tbody></table></main>;
}
