import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

interface TreeNode { name: string; url?: string; children: TreeNode[] }
interface Endpoint { id: number; method: string; url: string; classification: string; discoveredVia: string }

function Tree({ nodes, endpoints }: { nodes: TreeNode[]; endpoints: Endpoint[] }) {
  return <ul>{nodes.map((node) => {
    const endpoint = node.url ? endpoints.find((item) => item.url === node.url) : undefined;
    return <li key={`${node.name}-${node.url ?? "grupo"}`}>
      {endpoint ? <Link to={`/endpoints/${endpoint.id}`}>{node.name}</Link> : node.name}
      {node.children.length > 0 && <Tree nodes={node.children} endpoints={endpoints} />}
    </li>;
  })}</ul>;
}

export function AttackSurfacePage() {
  const { scanRunId } = useParams();
  const [data, setData] = useState<{ tree: TreeNode[]; endpoints: Endpoint[] } | null>(null);
  useEffect(() => { fetch(`/api/scan-runs/${scanRunId}/attack-surface`).then((response) => response.json()).then(setData); }, [scanRunId]);
  return <main><h1>Superfície de ataque</h1>{data ? <><Tree nodes={data.tree} endpoints={data.endpoints} /><h2>Endpoints descobertos</h2><table><thead><tr><th>Método</th><th>URL</th><th>Classificação</th><th>Origem da descoberta</th></tr></thead><tbody>{data.endpoints.map((endpoint) => <tr key={endpoint.id}><td>{endpoint.method}</td><td><Link to={`/endpoints/${endpoint.id}`}>{endpoint.url}</Link></td><td>{endpoint.classification}</td><td>{endpoint.discoveredVia}</td></tr>)}</tbody></table></> : <p>Carregando superfície de ataque…</p>}</main>;
}
