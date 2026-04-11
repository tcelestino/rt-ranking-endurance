# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run update       # processa imagens em images/ e salva km nos JSONs
npm run generate:manifest # lê data/*.json e gera data/manifest.json
npm run clear:images # remove todos os arquivos de imagem da pasta images/
npm run serve        # sobe servidor estático da pasta static/ na porta 3000
npm run build        # compila TypeScript (processor/) para dist/
npm run api:dev      # inicia a API em modo dev na porta 3001
npm run api:build    # compila a API para api/dist/
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
├── processor/                  # CLI local (não deployado)
│   ├── index.ts
│   ├── imageAnalyzerGemini.ts
│   ├── jsonUpdater.ts
│   ├── participantsParser.ts
│   ├── imageFiles.ts
│   ├── cacheManager.ts
│   ├── manifest.ts
│   └── clearImages.ts
├── data/                       # JSONs commitados — lidos por api/ e escritos por processor/
├── images/                     # gitignored — input local
├── package.json                # Scripts raiz para processor/
├── tsconfig.json               # rootDir ./processor
├── render.yaml                 # Config de deploy no Render
└── .gitignore
```

## Arquitetura

O projeto tem três partes independentes:

### Fluxo 1 — `npm run update` (processamento de imagens)

**`processor/index.ts`** — ponto de entrada. Lê todos os arquivos de `images/`, detecta o gênero do corredor via `participantsParser`, verifica cache, chama o analyzer e salva o km no JSON correspondente. Imagens já em cache (mesmo hash SHA256) são ignoradas — não atualizam os JSONs.

**`processor/imageAnalyzerGemini.ts`** — usa `gemini-2.0-flash` via `@google/genai`. Recebe o caminho da imagem e retorna `number` (km extraído).

**`processor/jsonUpdater.ts`** — lê e escreve os arquivos JSON em `data/`. Funções principais: `loadMonthData`, `appendKm`, `saveMonthData`, `getDataFilePath`, `getMonthName`.

**`processor/participantsParser.ts`** — carrega `data/runners.json` e expõe `loadParticipants()` e `findGender()`.

**`processor/imageFiles.ts`** — funções utilitárias para a pasta `images/`: `getImageFiles` (lista arquivos suportados) e `deleteImagesFiles` (remove os arquivos). Usado por `index.ts` e `clearImages.ts`.

**`processor/clearImages.ts`** — script do comando `npm run clear:images`. Lista todas as imagens em `images/` e as remove.

**`processor/cacheManager.ts`** — cache de imagens por hash SHA256 em `data/.image-cache.json`. Imagem já processada (mesmo hash) é ignorada em execuções futuras, independente da data.

### Fluxo 2 — `npm run generate:manifest` (geração do manifest)

**`processor/manifest.ts`** — lê os arquivos `female-*.json` e `male-*.json` em `data/` e gera:
- `data/manifest.json` — lista de meses disponíveis (slug, nome, mês/ano), consumida pelo frontend via API

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
- **Anual**: agrega todos os arquivos de `data/` (todos os meses, ambos os gêneros), ordena desc

## Arquivos sensíveis

- `.env` — variáveis de ambiente com API keys (`GEMINI_API_KEY`) (nunca commitar)

Devem estar no `.gitignore`.

## Fluxo de atualização do manifest.json com Deploy

Esse fluxo será executado caso durante uma nova atualização esteja acontecendo no primeiro dia do mês. Assim, você vai executar as seguintes etapas antes de rodar o `npm run update`

### 1. Sincronizar branch local

Execute o comando:
```bash
git checkout main && git pull origin main
```

### 2. Limpar cache

Execute o comando:
```bash
npm run clean:cache
```

### 3. Atualizar manifest.json
```bash
npm run generate:manifest || { echo "Falha ao gerar manifest.json. Abortando."; exit 1; }
```

### 4. Criar branch
```bash
git checkout -b update-manifest-$(date +%m)-$(date +%Y)
```

### 5. Commit e push
```bash
git add data/
git commit -m "chore: atualização do manifest $(date +%m/%Y)"
git push origin HEAD
```

### 6. Criar Pull Request e fazer merge
```bash
gh pr create --title "chore: atualização manifest.json" --body "Atualização do manifest.json para o mês $(date +%m/%Y)" --base main
gh pr merge --squash --delete-branch
```

O `--squash` mantêm o histórico da `main` limpo, consolidando os commits da branch em um único commit.

Após o merge, dê a sequência para o fluxo de update e deploy dos dados.

## Fluxo de Update e Deploy

Quando solicitado a executar o "processo de update", siga exatamente estas etapas:

### 1. Processar imagens
```bash
npm run update
```

### 2. Criar branch
```bash
git checkout -b update-$(date +%d)-$(date +%m)-$(date +%Y)
```

### 3. Commit e push
```bash
git add data/
git commit -m "update: dados $(date +%d/%m/%Y)"
git push origin HEAD
```

### 4. Criar Pull Request
```bash
gh pr create --title "Atualização: $(date +%d/%m/%Y)" --body "Update automático de dados de corrida do dia" --base main
```

### 5. Confirmação antes do merge
Capture o numero do PR criado no passo anterior. Informe o numero e URL ao usuário e aguarde confirmação explicita do usuário. Somente apos "pode fazer o merge", "confirmo" ou similar, execute:
```bash
gh pr merge <numero> --squash --delete-branch
```

### 6. Limpar pasta images
Após ser feito o merge do pull request, faça a limpeza da pasta `images` executando o comando:

```bash
npm run clear:images
```

Nunca execute o comando `npm run generate:manifest` nesse processo.


## Observações

- O cache em `data/.image-cache.json` é baseado em hash SHA256 — a mesma imagem nunca é reprocessada, independente da data ou nome do arquivo.
