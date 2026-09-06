# Auditor de Configuração de Segurança

Aplicação interna para descobrir superfícies de ataque e executar verificações de segurança controladas em sistemas web autorizados. O projeto combina uma API Fastify/TypeScript, persistência SQLite, uma interface React e mecanismos de descoberta por HTTP e navegador.

> **Uso autorizado somente.** Execute o auditor apenas contra sistemas para os quais você possui autorização explícita. Mesmo testes classificados como seguros podem enviar requisições e, nos modos com mutação, alterar temporariamente recursos do alvo.

## Visão geral

O auditor foi projetado para encontrar regressões que costumam escapar de testes genéricos, com foco em:

- XSS armazenado, usando canários não executáveis e verificação de sanitização;
- configuração e permissões relacionadas a Google Tag Manager (GTM);
- IDOR/BOLA e autorização em nível de objeto ou função;
- violações de regras, invariantes e transições de estado de negócio;
- comportamento de autenticação entre perfis e origens;
- APIs e operações descobertas em HTML, OpenAPI, GraphQL, JavaScript e execução no navegador.

A segurança operacional faz parte da arquitetura: todo acesso deve respeitar escopo, validação de DNS/IP, limites de requisição, classificação do ambiente e elegibilidade do recurso. Operações destrutivas nunca são executadas automaticamente.

## Estado atual

O repositório contém os componentes de domínio, rotas HTTP, interface web e uma ampla suíte de testes unitários e de integração. A interface permite cadastrar alvos, perfis de autenticação, propriedade de recursos, políticas de permissão, regras de negócio e execuções, além de consultar progresso, cobertura, achados e relatórios.

No entrypoint atual, criar uma execução pela UI ou por `POST /api/targets/:targetId/scans` persiste a configuração e o estado inicial, mas **não inicia automaticamente um worker de varredura em segundo plano**. O sequenciador e os estágios completos estão implementados e exercitados por integração, mas ainda precisam ser ligados a um executor operacional para que uma execução criada pela API percorra o pipeline de ponta a ponta.

## Principais recursos

### Descoberta

- resolução DNS A, AAAA e CNAME e validação contra SSRF;
- descoberta HTTP/HTTPS, inspeção TLS passiva e identificação de tecnologias;
- crawler limitado por profundidade, quantidade de páginas, tamanho de resposta e taxa;
- descoberta de OpenAPI/Swagger, GraphQL e endpoints presentes em JavaScript;
- navegador Playwright para rotas SPA, formulários, ações e chamadas visíveis apenas em runtime;
- superfície de ataque unificada e classificação de candidatos testáveis, passivos, ignorados ou inconclusivos.

### Testes e evidências

- scanners de XSS, GTM, IDOR/BOLA e autorização funcional;
- motor extensível de lógica de negócio, com perfil genérico e perfis opcionais;
- modelos declarativos de expectativas e invariantes, sem `eval` ou código arbitrário;
- evidências sanitizadas, segredos mascarados e corpos grandes truncados com hash;
- resultados evidenciários separados entre vulnerabilidade comprovada, bloqueio comprovado, inconclusivo e não testado;
- relatórios HTML e JSON com configuração imutável, cobertura, achados e estado real da execução.

### Controles para mutações

- autorização explícita e auditada para modos que permitem escrita;
- Mutation Scope para declarar quais recursos são recursos de teste;
- backup antes da alteração, trava por recurso, diário de recuperação e restauração verificada;
- bloqueio quando a reversibilidade não pode ser comprovada;
- tratamento de conflito para não sobrescrever silenciosamente uma edição legítima concorrente;
- cancelamento seguro, aguardando a restauração de uma mutação em andamento;
- denylist absoluta para ações destrutivas e campos sensíveis.

## Modos de auditoria

| Modo | Comportamento |
| --- | --- |
| `PASSIVE` | Padrão. Permite descoberta e leitura, sem executar mutações. |
| `SAFE_AUTOMATIC` | Permite apenas mutações não destrutivas autorizadas, em recursos de teste e com reversibilidade comprovada. |
| `ADVANCED` | Aplica as mesmas barreiras de segurança e também exige opt-in explícito por módulo. |

Alvos são classificados como `LOCAL_FIXTURE`, `DEVELOPMENT`, `STAGING` ou `PRODUCTION`. Produção inicia em modo passivo; uma mutação só pode avançar quando autorização, recurso de teste, backup/restauração e reversibilidade estiverem todos comprovados.

## Arquitetura

```text
frontend/                         React 19 + TypeScript + Vite
backend/
├── db/migrations/                  esquema e migrações SQLite
├── deploy/browser-egress-strict/ referência de isolamento do navegador
└── src/
    ├── api-discovery/             OpenAPI, GraphQL e JavaScript
    ├── auth/                      perfis e credenciais criptografadas
    ├── backup/, mutation/         backup, trava, journal e restauração
    ├── browser/                   Playwright e proxy de egress controlado
    ├── business-logic/            expectativas, invariantes e perfis
    ├── crawler/, discovery/       descoberta e superfície de ataque
    ├── evidence/                  coleta e sanitização de evidências
    ├── findings-reporting/        dashboard, detalhes e relatórios
    ├── scan-orchestration/        filas, estados e pipeline
    ├── scanners/                  scanners técnicos
    └── target-configuration/      alvos, modos e escopo de mutação
fixtures/vulnerable-app/          aplicação vulnerável exclusiva para testes
openspec/                         proposta, design e especificações do projeto
```

O pipeline segue esta ordem fixa:

```text
DNS → Escopo → HTTP → Crawler/Navegador → APIs → JSON/DOM
    → Operações → Objetos de negócio → Candidatos → Elegibilidade
    → Autenticação → Testes → Evidências → Restauração → Relatório
```

Cada teste mutável conclui seu próprio ciclo de backup, mutação, verificação e restauração antes que o próximo teste do recurso seja executado.

## Requisitos

- Node.js 22 ou superior (o backend usa `node:sqlite`);
- npm;
- Chromium do Playwright para testes e descoberta com navegador;
- Docker e Docker Compose apenas para experimentar a topologia de egress estrito.

## Instalação

Clone o repositório e instale as dependências dos dois pacotes:

```bash
cd backend
npm ci
npx playwright install chromium

cd ../frontend
npm ci
```

O projeto não usa um workspace npm na raiz; execute os comandos dentro de `backend/` ou `frontend/`.

## Configuração

O backend lê as seguintes variáveis de ambiente:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP da API, vinculada a `127.0.0.1`. |
| `DB_PATH` | `backend/data.db` | Caminho do banco SQLite. Migrações são aplicadas ao iniciar. |
| `AUTH_CREDENTIAL_ENCRYPTION_KEY` | sem padrão | Chave AES-256-GCM em Base64, obrigatória para gravar ou ler credenciais. |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Libera IPs privados. Deve permanecer desativada fora do harness controlado de integração. |
| `LOCAL_FIXTURE_TEST_CAPABILITY` | `false` | Habilita capacidades perigosas exclusivas da fixture. Não é uma opção de produção ou da UI. |
| `BROWSER_EGRESS_ISOLATED` | `false` | Declara postura `STRICT`; use `true` somente quando o isolamento de rede realmente existir. |
| `SCOPE_ALLOWLIST` | vazio | Lista de hosts/wildcards, separada por vírgulas, para o proxy standalone. |
| `PROXY_HOST` | `127.0.0.1` | Endereço de bind do proxy standalone. |

Gere uma chave de desenvolvimento sem colocá-la no repositório:

```bash
export AUTH_CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

Use sempre a mesma chave para um banco existente. Trocar ou perder a chave torna as credenciais persistidas impossíveis de descriptografar.

## Executando em desenvolvimento

Abra dois terminais na raiz do repositório.

Backend:

```bash
cd backend
export AUTH_CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32)"
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Acesse `http://localhost:5173`. Durante o desenvolvimento, o Vite encaminha `/api` para `http://127.0.0.1:3000`.

O banco padrão é criado em `backend/data.db`. Para isolar uma execução:

```bash
cd backend
DB_PATH=/tmp/security-auditor-dev.db npm run dev
```

## Fluxo básico pela interface

1. Configure perfis em **Autenticação**, se o alvo exigir credenciais.
2. Cadastre propriedade de recursos e políticas esperadas de permissão quando for testar autorização.
3. Configure expectativas e invariantes em **Regras de negócio**.
4. Abra **Nova auditoria**, informe o DNS, o escopo permitido, o ambiente e o limite de requisições.
5. Mantenha `PASSIVE` para descoberta somente leitura. Para outro modo, declare recursos de teste e confirme explicitamente a autorização.
6. Use o ID gerado para abrir o painel, acompanhar eventos, inspecionar a superfície e baixar relatórios.

O escopo padrão inclui somente o hostname informado. Subdomínios ou hosts adicionais precisam ser autorizados explicitamente.

## API HTTP

As rotas principais são:

| Grupo | Rotas |
| --- | --- |
| Alvos | `POST/GET /api/targets`, `GET/PATCH /api/targets/:id` |
| Execuções | `POST /api/targets/:targetId/scans`, `GET /api/scan-runs/:id/progress`, `POST /api/scan-runs/:id/cancel` |
| Escopo de mutação | `GET/POST /api/targets/:targetId/mutation-scope`, `DELETE /api/targets/:targetId/mutation-scope/:id` |
| Autenticação | CRUD em `/api/auth-profiles` e hosts adicionais em `/api/auth-profiles/:id/allowed-hosts` |
| Autorização | `/api/resource-ownership` e `/api/authorization-expectations` |
| Regras de negócio | `/api/business-expectations`, `/api/business-invariants` e `/api/targets/:id/business-profiles` |
| Descoberta direta | `POST /api/discovery/attack-surface` |
| Resultados | `/api/scan-runs/:id/dashboard`, `/attack-surface`, `/findings`, `/observed-properties` |
| Detalhes | `GET /api/endpoints/:id`, `GET /api/findings/:id` |
| Relatórios | `GET /api/scan-runs/:id/reports/html` e `/reports/json` |

Exemplo de descoberta direta passiva:

```bash
curl -X POST http://127.0.0.1:3000/api/discovery/attack-surface \
  -H 'Content-Type: application/json' \
  -d '{
    "targetUrl": "https://staging.example.com",
    "scope": ["staging.example.com"],
    "maxDepth": 2,
    "maxPages": 50
  }'
```

## Testes e qualidade

Backend:

```bash
cd backend
npm test                  # testes unitários
npm run test:integration  # integração com fixture local controlada
npm run test:all          # ambos
npm run build             # verifica TypeScript e gera dist/
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

Fixture deliberadamente vulnerável:

```bash
cd fixtures/vulnerable-app
npm test
npm start
```

Quando iniciada manualmente, a fixture escuta apenas em loopback: HTTP `4100`, HTTPS `4143` e origem secundária `4200`. **Nunca publique ou implante essa aplicação.** A configuração de integração é o único local que habilita `ALLOW_PRIVATE_NETWORKS` e `LOCAL_FIXTURE_TEST_CAPABILITY` automaticamente.

## Build de produção

```bash
cd backend
npm ci
npm run build
npm start
```

```bash
cd frontend
npm ci
npm run build
```

O backend não serve os arquivos do frontend. Publique `frontend/dist/` em um servidor web e encaminhe `/api` para a API Fastify. Por padrão, a API escuta somente em `127.0.0.1`; exponha-a por meio de um proxy reverso com autenticação, TLS e controles de acesso adequados.

## Isolamento do navegador

Todo navegador iniciado pelo motor usa o Controlled Egress Proxy e reduz caminhos alternativos como QUIC, WebRTC, prefetch e Service Workers. Em desenvolvimento, essa postura é reportada como `BROWSER_EGRESS_BEST_EFFORT`.

Uma topologia de referência para `BROWSER_EGRESS_STRICT` está em `backend/deploy/browser-egress-strict/docker-compose.yml`. Ela é um modelo de implantação, não uma stack pronta: as imagens da aplicação e o fornecimento dinâmico do escopo ainda precisam ser integrados ao ambiente real. Nunca defina `BROWSER_EGRESS_ISOLATED=true` apenas para alterar o rótulo; ele afirma que o isolamento no nível de rede está efetivamente ativo.

## Persistência e estados

O SQLite usa foreign keys e modo WAL. Cada execução guarda uma fotografia imutável da configuração, inclusive perfis selecionados, escopo, autorização, regras e recursos de teste.

Os estados preservam falhas e incidentes em vez de reduzi-los a um simples sucesso: `PASSIVE_PENDING`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED`, `RESTORE_REQUIRED` e `COMPLETED_WITH_RECOVERY`. Um relatório parcial, cancelado ou recuperado é identificado como tal; zero achados não significa que todos os candidatos foram testados ou que o alvo está seguro.

## Limites deliberados

Este MVP não faz varredura de portas, brute force de subdomínios ou credenciais, exploração de SQL injection/RCE, DoS, bypass de WAF ou fuzzing em massa. Também não executa payloads XSS reais, pagamentos, transferências, exclusões, uploads, downloads ou outras operações destrutivas. WebSockets podem ser observados e classificados, mas não são reproduzidos automaticamente.

Para detalhes de decisões arquiteturais e requisitos de segurança, consulte `openspec/changes/add-security-configuration-auditor/`.
