import { useEffect, useState } from "react";

interface Target {
  id: number;
  name: string;
  hostname: string;
  scope: string[];
  defaultScanMode: "PASSIVE" | "SAFE_AUTOMATIC" | "ADVANCED";
  rateLimitRps: number;
  environment: "LOCAL_FIXTURE" | "DEVELOPMENT" | "STAGING" | "PRODUCTION";
}

interface AuthProfile {
  id: number;
  name: string;
  method: string;
}

interface ScanRunResult {
  scanRunId: number;
  scanRunConfigId: number;
}

const MUTATION_AUTHORIZATION_CONFIRMATION_TEXT =
  "I confirm that I am authorized to test this target and authorize temporary non-destructive mutations.";

const ERROR_LABELS: Record<string, string> = {
  MISSING_PROJECT_NAME: "Informe o nome do projeto.",
  MISSING_TARGET_DNS: "Informe o DNS do alvo.",
  TARGET_NOT_IN_SCOPE: "O DNS do alvo precisa estar incluído no escopo permitido.",
  INVALID_ENVIRONMENT: "Selecione um ambiente válido.",
  MUTATION_AUTHORIZATION_REQUIRED: "Confirme a autorização para mutações antes de iniciar.",
};

const SCAN_MODE_LABELS = { PASSIVE: "Passivo", SAFE_AUTOMATIC: "Automático seguro", ADVANCED: "Avançado" } as const;

export function NewSecurityAuditPage() {
  const [projectName, setProjectName] = useState("");
  const [targetDns, setTargetDns] = useState("");
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [useAdvancedScope, setUseAdvancedScope] = useState(false);
  const [advancedScopeText, setAdvancedScopeText] = useState("");
  const [scanMode, setScanMode] = useState<"PASSIVE" | "SAFE_AUTOMATIC" | "ADVANCED">("PASSIVE");
  const [rateLimitRps, setRateLimitRps] = useState(2);
  const [environment, setEnvironment] = useState<Target["environment"]>("DEVELOPMENT");
  const [testResourceOrigin, setTestResourceOrigin] = useState("");
  const [testResourceTenantId, setTestResourceTenantId] = useState("");
  const [testResourceObjectType, setTestResourceObjectType] = useState("");
  const [testResourceId, setTestResourceId] = useState("");
  const [testResourceDescription, setTestResourceDescription] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<Target | null>(null);
  const [scanRun, setScanRun] = useState<ScanRunResult | null>(null);
  const [authProfiles, setAuthProfiles] = useState<AuthProfile[]>([]);
  const [selectedAuthProfileIds, setSelectedAuthProfileIds] = useState<number[]>([]);
  const [mutationAuthorizationConfirmed, setMutationAuthorizationConfirmed] = useState(false);
  const [confirmedBy, setConfirmedBy] = useState("");

  useEffect(() => {
    fetch("/api/auth-profiles")
      .then((response) => response.json() as Promise<AuthProfile[]>)
      .then(setAuthProfiles)
      .catch(() => setAuthProfiles([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors([]);
    setCreated(null);
    setScanRun(null);
    const advancedScope = useAdvancedScope
      ? advancedScopeText
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean)
      : undefined;
    const response = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName, targetDns, includeSubdomains, advancedScope, scanMode, rateLimitRps, environment }),
    });
    if (response.status === 400) {
      const body = (await response.json()) as { details: string[] };
      setErrors(body.details.map((error) => ERROR_LABELS[error] ?? error));
      return;
    }
    const target = (await response.json()) as Target;
    setCreated(target);

    if (testResourceOrigin || testResourceTenantId || testResourceObjectType || testResourceId) {
      const scopeResponse = await fetch(`/api/targets/${target.id}/mutation-scope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(testResourceOrigin ? { origin: testResourceOrigin } : {}),
          ...(testResourceTenantId ? { tenantId: testResourceTenantId } : {}),
          ...(testResourceObjectType ? { objectType: testResourceObjectType } : {}),
          ...(testResourceId ? { resourceId: testResourceId } : {}),
          ...(testResourceDescription ? { description: testResourceDescription } : {}),
        }),
      });
      if (!scopeResponse.ok) {
        setErrors(["Não foi possível declarar o recurso de teste."]);
        return;
      }
    }

    const scanResponse = await fetch(`/api/targets/${target.id}/scans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanMode,
        rateLimitRps,
        authProfileIds: selectedAuthProfileIds,
        ...(scanMode !== "PASSIVE"
          ? {
              mutationAuthorization: {
                confirmationText: MUTATION_AUTHORIZATION_CONFIRMATION_TEXT,
                confirmedBy,
              },
            }
          : {}),
      }),
    });
    if (!scanResponse.ok) {
      const body = (await scanResponse.json()) as { error?: string };
      setErrors([body.error ? (ERROR_LABELS[body.error] ?? body.error) : "Não foi possível iniciar a auditoria"]);
      return;
    }
    setScanRun((await scanResponse.json()) as ScanRunResult);
  }

  return (
    <div>
      <h1>Nova auditoria de segurança</h1>

      {errors.length > 0 && (
        <ul id="validation-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      {created && (
        <p id="created-target">
          Alvo #{created.id} ({created.name}, {created.hostname}) criado — escopo [{created.scope.join(", ")}], modo {SCAN_MODE_LABELS[created.defaultScanMode]}, limite de {created.rateLimitRps} req/s.
        </p>
      )}
      {scanRun && <p id="created-scan-run">Execução #{scanRun.scanRunId} criada e disponível para consulta.</p>}

      <form onSubmit={handleSubmit}>
        <label>
          Nome do projeto
          <input aria-label="Nome do projeto" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </label>
        <label>
          DNS do alvo
          <input aria-label="DNS do alvo" placeholder="Ex.: staging.example.com" value={targetDns} onChange={(e) => setTargetDns(e.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="Incluir subdomínios autorizados"
            checked={includeSubdomains}
            disabled={useAdvancedScope}
            onChange={(e) => setIncludeSubdomains(e.target.checked)}
          />
          Incluir subdomínios autorizados
        </label>
        <label>
          <input type="checkbox" aria-label="Usar escopo avançado" checked={useAdvancedScope} onChange={(e) => setUseAdvancedScope(e.target.checked)} />
          Escopo avançado
        </label>
        {useAdvancedScope && (
          <label>
            Hosts permitidos (separados por vírgula)
            <input
              aria-label="Hosts do escopo avançado"
              placeholder="Ex.: example.com, *.example.com"
              value={advancedScopeText}
              onChange={(e) => setAdvancedScopeText(e.target.value)}
            />
          </label>
        )}
        <label>
          Modo da auditoria
          <select
            aria-label="Modo da auditoria"
            value={scanMode}
            onChange={(e) => {
              setScanMode(e.target.value as typeof scanMode);
              setMutationAuthorizationConfirmed(false);
            }}
          >
            <option value="PASSIVE">Passivo</option>
            <option value="SAFE_AUTOMATIC">Automático seguro</option>
            <option value="ADVANCED">Avançado</option>
          </select>
        </label>
        <label>
          Limite de requisições (req/s)
          <input aria-label="Limite de requisições" type="number" value={rateLimitRps} onChange={(e) => setRateLimitRps(Number(e.target.value))} />
        </label>
        <label>
          Ambiente do alvo
          <select
            aria-label="Ambiente do alvo"
            value={environment}
            onChange={(event) => {
              const nextEnvironment = event.target.value as Target["environment"];
              setEnvironment(nextEnvironment);
              if (nextEnvironment === "PRODUCTION") setScanMode("PASSIVE");
            }}
          >
            <option value="LOCAL_FIXTURE">Fixture local</option>
            <option value="DEVELOPMENT">Desenvolvimento</option>
            <option value="STAGING">Homologação</option>
            <option value="PRODUCTION">Produção</option>
          </select>
        </label>
        {environment === "PRODUCTION" && <p role="alert">Produção inicia em modo Passivo. Mutações exigem autorização, recurso de teste, reversibilidade comprovada e backup/restauração.</p>}
        <fieldset>
          <legend>Escopo de recursos de teste</legend>
          <p>Campos vazios funcionam como curinga. Sem declaração, recursos permanecem desconhecidos e não podem ser alterados.</p>
          <label>Origem<input value={testResourceOrigin} onChange={(event) => setTestResourceOrigin(event.target.value)} placeholder="https://staging.example.com" /></label>
          <label>ID do tenant<input value={testResourceTenantId} onChange={(event) => setTestResourceTenantId(event.target.value)} /></label>
          <label>Tipo do objeto<input value={testResourceObjectType} onChange={(event) => setTestResourceObjectType(event.target.value)} placeholder="project" /></label>
          <label>ID do recurso<input value={testResourceId} onChange={(event) => setTestResourceId(event.target.value)} /></label>
          <label>Descrição<input value={testResourceDescription} onChange={(event) => setTestResourceDescription(event.target.value)} /></label>
        </fieldset>
        <fieldset>
          <legend>Perfis de autenticação</legend>
          {authProfiles.length === 0 && <p>Nenhum perfil de autenticação configurado.</p>}
          {authProfiles.map((profile) => (
            <label key={profile.id}>
              <input
                type="checkbox"
                checked={selectedAuthProfileIds.includes(profile.id)}
                onChange={(event) =>
                  setSelectedAuthProfileIds((current) =>
                    event.target.checked ? [...current, profile.id] : current.filter((id) => id !== profile.id),
                  )
                }
              />
              {profile.name} ({profile.method})
            </label>
          ))}
        </fieldset>
        {scanMode !== "PASSIVE" && (
          <dialog open aria-labelledby="mutation-authorization-title">
            <h2 id="mutation-authorization-title">Autorização para mutações obrigatória</h2>
            <p>Confirmo que estou autorizado a testar este alvo e autorizo mutações temporárias não destrutivas.</p>
            <label>
              Identidade do operador
              <input aria-label="Identidade do operador" value={confirmedBy} onChange={(event) => setConfirmedBy(event.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                aria-label="Confirmar autorização para mutações"
                checked={mutationAuthorizationConfirmed}
                onChange={(event) => setMutationAuthorizationConfirmed(event.target.checked)}
              />
              Confirmo a autorização
            </label>
          </dialog>
        )}
        <button type="submit" disabled={scanMode !== "PASSIVE" && (!mutationAuthorizationConfirmed || !confirmedBy.trim())}>
          Criar auditoria
        </button>
      </form>
    </div>
  );
}
