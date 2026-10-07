# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run update       # processa imagens em images/ e salva km nos JSONs
npm run generate:manifest # lê data/*.json e gera data/manifest.json
npm run clear:images # remove todos os arquivos de imagem da pasta images/
npm run clear:cache # remove arquivo data/.image-cache.json
npm run serve        # sobe servidor estático da pasta static/ na porta 3000
npm run build        # compila TypeScript (processor/) para dist/
npm run api:dev      # inicia a API em modo dev na porta 3001
npm run api:build    # compila a API para api/dist/
npm run backoffice   # sobe o backoffice local em localhost:3002 (Workers AI)
npm run backoffice:check # verifica tipos do backoffice
npx tsc --noEmit     # verifica tipos sem gerar arquivos
```

Não há testes automatizados. A verificação é feita rodando `npm run update` com imagens reais em `images/` e depois `npm run generate:manifest`.

## Estrutura

```
rt-ranking-endurance/
├── api/                        # Servidor Express (deployado no Render)
│   ├── src/server.ts
│   ├── package.json
│   └── tsconfig.json
├── static/                     # Frontend estático (deployado no Render)
│   ├── index.html
│   └── assets/
│       ├── app.js
│       └── style.css
├── backoffice/                 # Interface local (não deployado)
│   ├── src/server.ts
│   ├── public/                 # index.html, app.js, style.css
│   └── tsconfig.json           # noEmit, inclui ../processor
├── processor/                  # CLI local (não deployado)
│   ├── index.ts
│   ├── imageAnalyzerGemini.ts
│   ├── imageAnalyzerCloudflare.ts
│   ├── kmPrompt.ts
│   ├── jsonUpdater.ts
│   ├── participantsParser.ts
│   ├── imageFiles.ts
│   ├── cacheManager.ts
│   ├── manifest.ts
│   ├── ranking.ts
│   ├── stats.ts
│   ├── clearCache.ts
│   └── clearImages.ts
├── data/                       # JSONs commitados — lidos por api/ e escritos por processor/
├── images/                     # gitignored — input local
├── package.json                # Scripts raiz para processor/
├── tsconfig.json               # rootDir ./processor
├── render.yaml                 # Config de deploy no Render
└── .gitignore
```

## Arquitetura

O projeto tem quatro partes independentes:

### Fluxo 1 — `npm run update` (processamento de imagens)

**`processor/index.ts`** — ponto de entrada. Lê todos os arquivos de `images/`, detecta o gênero do corredor via `participantsParser`, verifica cache, chama o analyzer e salva o km no JSON correspondente. Imagens já em cache (mesmo hash SHA256) são ignoradas — não atualizam os JSONs.

**`processor/imageAnalyzerGemini.ts`** — usa `gemini-2.0-flash` via `@google/genai`. Recebe o caminho da imagem e retorna `number` (km extraído).

**`processor/jsonUpdater.ts`** — lê e escreve os arquivos JSON em `data/`. Funções principais: `loadMonthData`, `appendKm`, `saveMonthData`, `getDataFilePath`, `getMonthName`.

**`processor/participantsParser.ts`** — carrega `data/runners.json` e expõe `loadParticipants()` e `findParticipant()`.

**`processor/imageFiles.ts`** — funções utilitárias para a pasta `images/`: `getImageFiles` (lista arquivos suportados) e `deleteImagesFiles` (remove os arquivos). Usado por `index.ts` e `clearImages.ts`.

**`processor/clearImages.ts`** — script do comando `npm run clear:images`. Lista todas as imagens em `images/` e as remove.

**`processor/clearCache.ts`** — script do comando `npm run clear:cache`. Remove o arquivo de cache `data/.image-cache.json`.

**`processor/cacheManager.ts`** — cache de imagens por hash SHA256 em `data/.image-cache.json`. Imagem já processada (mesmo hash) é ignorada em execuções futuras, independente da data.

### Fluxo 2 — `npm run generate:manifest` (geração do manifest)

**`processor/manifest.ts`** — lê os arquivos `female-*.json` e `male-*.json` em `data/` e gera:
- `data/manifest.json` — lista de meses disponíveis (slug, nome, mês/ano), consumida pelo frontend via API

### Backoffice — `npm run backoffice`

**`backoffice/src/server.ts`** — Express local (`127.0.0.1:3002`) sem `package.json` próprio; roda via `tsx` com `node_modules` e `.env` da raiz e importa funções de `processor/`. Endpoints:
- `GET /api/state` → participantes de `runners.json` com km/total do mês atual
- `GET /api/ranking?year=&month=` → `{ year, month, monthName, current, periods, female, male, annual, totals, markdown }` via `processor/ranking.ts`. Sem parâmetros usa o mês vigente (ou o período mais recente com dados); `periods` lista anos/meses existentes em `data/`; `markdown` é o texto do WhatsApp do período (`buildRankingMarkdown`); 404 para período sem dados
- `GET /api/stats?year=` → agregados do ano para a aba "Gráficos" via `processor/stats.ts` (`buildStats`): km por mês (F/M), km por ano, atividades/meses ativos/vitórias por corredor, campeões dos meses fechados, top 5 acumulado, distribuição de distâncias e maior corrida. Sem `year` usa o ano mais recente; 404 para ano sem dados. Meses em que cada corredor tem um único valor (só o total mensal, ex.: fev–mar/2026) não entram nas métricas por atividade. O frontend carrega o Chart.js do jsDelivr sob demanda
- `POST /api/analyze` `{ name, mimeType, data(base64) }` → `{ km, hash, cached }` (não grava nada)
- `POST /api/save` `{ entries: [{ name, km, hash, filename }] }` → `appendKm` + `saveMonthData` + `storeCache`; rejeita hash repetido/em cache
- `POST /api/runners` `{ name, gender }` → adiciona em `runners.json` (409 se o nome já existir em qualquer gênero)
- `DELETE /api/runners/:name` → remove de `runners.json` (JSONs mensais não são alterados)
- `POST /api/new-month` → `removeCache` + `generateManifest` (cria JSONs do mês vigente se não existirem e regrava `manifest.json`); retorna `{ createdFiles, state }`. Responde 409 se o manifest já estiver no mês vigente (`isManifestCurrent`), evitando limpar o cache à toa

- `GET /api/publish/status` → `{ publishing, pendingChanges }` (arquivos alterados em `data/` segundo `git status`)
- `POST /api/publish` `{ autoMerge }` → `writeRankingMarkdown` + `bash scripts/deploy.sh` (com `--no-merge` se `autoMerge` for falso, timeout de 5 min); retorna `{ log, prUrl, markdown }`. 409 sem alterações ou com publicação em andamento; 500 com `log` se o script falhar. Como o `deploy.sh` troca de branch, rode o backoffice a partir da `main`

`GET /api/state` também retorna `manifestCurrent`, usado para destacar o botão "Novo mês" ou avisar que o manifest já foi gerado, e `user` (`{ name, email }` do Clerk), mostrado como tooltip do UserButton no header.

**Autenticação (Clerk)** — `backoffice/src/auth.ts`. O servidor não sobe sem `CLERK_PUBLISHABLE_KEY` e `CLERK_SECRET_KEY` no `.env`.
- `GET /api/config` é público e retorna `{ publishableKey }`; o `app.js` carrega o Clerk JS pelo Frontend API (domínio extraído da chave), exibe o `SignIn` e envia `Authorization: Bearer <session token>` em todas as chamadas (`apiFetch`).
- Demais rotas `/api/*` passam por `clerkMiddleware()` + `requireAdmin`: 401 sem sessão válida, 403 se `publicMetadata.role` não for `"admin"`.
- Configuração no dashboard do Clerk: login só com Google; Restrictions > Allowlist com os emails permitidos; Sessions > Customize session token com `{ "metadata": "{{user.public_metadata}}" }`; após o primeiro login, definir `publicMetadata` = `{ "role": "admin" }` no usuário.

Scripts do `processor/` reaproveitados pelo backoffice exportam a função principal e só executam `main()` com `if (require.main === module)`.

**`processor/imageAnalyzerCloudflare.ts`** — chama a REST API do Workers AI (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_MODEL` opcional; padrão `@cf/meta/llama-3.2-11b-vision-instruct`, que exige aceite único da licença Meta com `{"prompt":"agree"}`).

**`processor/ranking.ts`** — cálculo dos rankings mensal/anual (por ano), `listRankingPeriods` e montagem do texto do ranking (`buildRankingMarkdown`); usado por `markdownGenerator.ts` e pelo backoffice.

**`processor/stats.ts`** — estatísticas anuais para os gráficos do backoffice (`buildStats`); reaproveita `calcMonthlyRanking` e `listRankingPeriods` de `ranking.ts`.

**`processor/kmPrompt.ts`** — prompt e `parseKmResponse` compartilhados entre Gemini e Cloudflare.

### API — `api/src/server.ts`

Servidor Express deployado no Render. Expõe os dados de `data/` via 4 endpoints:
- `GET /api/manifest` → `data/manifest.json`
- `GET /api/runners` → `data/runners.json`
- `GET /api/data/:slug/female` → `data/female-{slug}.json`
- `GET /api/data/:slug/male` → `data/male-{slug}.json`

Controles: CORS (variável `ALLOWED_ORIGINS`), rate limiting (60 req/min por IP), validação de slug.

### Frontend — `static/`

Página estática deployada no Render. Carrega dados via `fetch()` para a API (`API_BASE` detectado automaticamente: `localhost:3001` em dev, URL de produção em prod).

## Acesso a `data/` por cada parte

| Quem | Como acessa | Onde roda |
|------|-------------|-----------|
| `processor/` | `path.resolve("data/...")` (CWD = raiz) | Local |
| `api/src/server.ts` | `path.resolve(__dirname, "../../data")` | Render |

## Convenções dos dados

- **Arquivos de dados**: `data/female-[mes].json` e `data/male-[mes].json`
  - Formato: `[{ "name": "Eli", "km": [19.04, 5.30] }]`
  - O campo `km` é um array — cada imagem processada adiciona um item
  - Total do corredor no mês = soma de todos os valores do array
- **Lista de participantes**: `data/runners.json` — objeto com chaves `female` e `male` (arrays de nomes)
- O mês atual é detectado pela data do sistema. Pode ser sobrescrito com `CURRENT_MONTH=4` no `.env`

## Lógica de ranking

- **Mensal**: soma os km do JSON do mês atual para cada gênero, ordena desc, inclui corredores com 0km
- **Anual**: agrega todos os meses do ano em `data/{ano}/` (ambos os gêneros), ordena desc

## Arquivos sensíveis

- `.env` — variáveis de ambiente com API keys (`GEMINI_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLERK_SECRET_KEY`) (nunca commitar)

Devem estar no `.gitignore`.

## Observações

- O cache em `data/.image-cache.json` é baseado em hash SHA256 — a mesma imagem nunca é reprocessada, independente da data ou nome do arquivo.
