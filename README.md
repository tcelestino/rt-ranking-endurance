# R&T Clube de Corrida - Ranking Endurance

Simples monorepo para automação de atualização de rankings do clube de corrida da R&T Academia

O script lê screenshots de apps de corrida (Strava, Garmin, Nike Run, etc.), extrai o km percorrido via IA, utilizando o Gemini, salva em arquivos JSON locais, disponibiliza os dados via API e gera a página estática com os rankings.

## Fluxo

```mermaid
flowchart TD
    A[images/*.png] --> B[npm run update]
    B --> C[Scan pasta images/]
    C --> D[Gemini API\nextrai km da imagem]
    D --> E{Gênero via\nrunners.json}
    E -->|feminino| F[data/female-mes.json]
    E -->|masculino| G[data/male-mes.json]

    F --> H[npm run generate:manifest]
    G --> H
    H --> I[Lê data/*.json]
    I --> K[data/manifest.json\nlista de meses disponíveis]

    K --> L[api/src/server.ts\nExpress API]
    L --> M[static/index.html\nfetch via API_BASE]
```

## Estrutura

```
rt-ranking-endurance/
├── api/                          # Servidor Express (deployado no Render)
│   ├── src/server.ts             # 4 endpoints REST + CORS + rate limiting
│   ├── package.json
│   └── tsconfig.json
├── static/                       # Frontend estático (deployado no Render)
│   ├── index.html                # Página com rankings e navegação por abas
│   └── assets/
│       ├── app.js                # Lógica do browser (fetch, ranking, UI)
│       └── style.css             # Estilos da página
├── processor/                    # CLI local (não deployado)
│   ├── index.ts                  # CLI principal — processa imagens e salva JSONs
│   ├── imageAnalyzerGemini.ts    # Gemini Vision: extrai km da imagem
│   ├── clearImages.ts            # Limpa a pasta /images
│   ├── clearCache.ts             # Limpa o cache das imagens data/.image-cache.json
│   ├── imageFiles.ts             # Funções para gerenciamento da pasta /images
│   ├── manifest.ts               # Gera o data/manifest.json
│   ├── jsonUpdater.ts            # Lê e escreve os arquivos JSON de dados
│   ├── participantsParser.ts     # Carrega data/runners.json
│   └── cacheManager.ts           # Cache de imagens por hash SHA256
├── data/
│   ├── runners.json              # Lista de participantes por gênero
│   ├── manifest.json             # Meses disponíveis (gerado por npm run generate:manifest)
│   ├── female-[mes].json         # Dados mensais femininos (gerado por npm run update)
│   └── male-[mes].json           # Dados mensais masculinos (gerado por npm run update)
├── scripts/                      # Scripts de automação (uso local)
│   ├── copy-ranking.sh           # Copia output/ranking.md para o clipboard
│   └── deploy.sh                 # Cria branch, commit, PR e merge dos dados
├── images/                       # Coloque aqui os screenshots dos corredores
├── render.yaml                   # Configuração de deploy no Render.com
├── .env.example                  # Modelos das variáveis de ambiente
├── package.json
└── tsconfig.json
```

## Pré-requisitos

- Node.js 22+
- Conta no [Google AI Studio](https://aistudio.google.com) com acesso à API Gemini
- [GitHub CLI](https://cli.github.com) (`gh`) autenticado — necessário para `npm run deploy`

## Instalação

```bash
npm install
cd api && npm install
```

## Configuração

### Variáveis de ambiente

Copie o arquivo de exemplo e preencha os valores:

```bash
cp .env.example .env
```

| Variável | Descrição |
|---|---|
| `GEMINI_API_KEY` | Chave da API Google Gemini (obrigatória) |
| `CURRENT_MONTH` | Sobrescreve o mês atual (opcional, ex: `4` para abril) |

## Configurando o API Gemini

Para usar o processamento das imagens, é preciso adicionar sua chave da API do Gemini.

Para obter a chave, acesse o [https://ai.google.dev/gemini-api/docs/api-key?hl=pt-br](https://ai.google.dev/gemini-api/docs/api-key?hl=pt-br)

## Atualizando os dados do ranking

Fluxo completo para atualizar os dados de corrida e publicar no ranking.

### Primeiro dia do mês

No primeiro dia de cada mês, atualize o `manifest.json` antes de processar as imagens:

```bash
git checkout main && git pull origin main
npm run clear:cache
npm run generate:manifest
```

Em seguida, publique o manifest:

```bash
git checkout -b update-manifest-$(date +%m)-$(date +%Y)
git add data/
git commit -m "chore: atualização do manifest $(date +%m/%Y)"
git push origin HEAD
gh pr create --title "chore: atualização manifest.json" --body "Atualização do manifest.json para o mês $(date +%m/%Y)" --base main
gh pr merge --squash --delete-branch
git checkout main && git pull origin main
```

Depois, continue com o fluxo normal abaixo.

### Fluxo normal (demais dias)

#### 1. Processar imagens

Coloque os screenshots na pasta `images/` e execute:

```bash
npm run update
```

#### 2. Gerar e copiar o ranking

```bash
npm run generate:markdown
npm run copy:ranking
```

O conteúdo de `output/ranking.md` é copiado para o clipboard (macOS e Linux). Cole onde precisar (WhatsApp, planilha, etc.).

#### 3. Publicar os dados

```bash
npm run deploy
```

O script cria automaticamente o branch com a data de hoje, commita os JSONs de `data/`, abre o PR e faz o merge com squash.

> Se o repositório tiver branch protection ativa (revisão obrigatória ou CI), o merge automático falhará. O script exibirá a URL do PR para que o merge seja feito manualmente.

#### 4. Limpar imagens

```bash
npm run clear:images
```

---

## Uso (comandos individuais)

### 1. Processar imagens

Coloque os screenshots na pasta `images/` com o nome do corredor como nome do arquivo:

```bash
cp ~/Downloads/eli.png images/
cp ~/Downloads/tiago.png images/
```

Execute:

```bash
npm run update
```

Saída esperada:

```
Processando eli.png... Eli → 19.04km ✓
Processando tiago.png... Tiago → 23.06km ✓

Resumo:
  eli.png → Eli (female) → 19.04km
  tiago.png → Tiago (male) → 23.06km
```

### 2. Gerar manifest.json

```bash
npm run generate:manifest
```

Gera o arquivo:
- `data/manifest.json` — lista de meses disponíveis para o frontend

### 3. Gerar markdown
```bash
npm run generate:markdown
```

Gera e ou atualiza arquivo markdown.
- `output/ranking.md` — ranking atualizado em formato markdown

### 4. Copiar resultado
 ```bash
 npm run copy:ranking
 ```
Faz a cópia do arquivo `output/ranking.md` para a área de transferência.

### 5. Deploy
```bash
npm run deploy
```
Cria a branch de atualização, pull request e merge automático utilizando o `gh`.


### 6. Limpar pasta "images"

```bash
npm run clear:images
```

Remove todas imagens existentes na pasta `/images`

### 7. Limpar cache das imagens

```bash
npm run clear:cache
```

Limpa o cache das imagens já enviadas para análise no Gemini

## API e frontend

### 1. Visualizar rankings no browser (desenvolvimento local)

Terminal 1 — inicia a API:

```bash
npm run api:dev
```

A API lê os JSONs de `data/` (commitados no repositório) e os expõe via 4 endpoints:

```
GET /api/manifest
GET /api/runners
GET /api/data/:month/female
GET /api/data/:month/male
```

Terminal 2 — serve o frontend:

```bash
npm run serve
```

O frontend detecta o ambiente automaticamente: usa `http://localhost:3001` em desenvolvimento e `https://rt-ranking-endurance-api.onrender.com` em produção.

Acesse `http://localhost:3000` para ver os rankings com navegação por abas e o botão "Copiar para WhatsApp".

## Deploy (Render.com)

O arquivo `render.yaml` configura dois serviços independentes:

| Serviço | Tipo | Diretório |
|---|---|---|
| `rt-ranking-endurance-api` | Web (Node) | `api/` |
| `rt-ranking-endurance-static` | Static Site | `static/` |

## Formatos de imagem suportados

`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`

## Observações

- O nome do arquivo define o nome do corredor (ex: `tiago.png` → `Tiago`)
- O corredor deve estar cadastrado em `data/runners.json` para ser reconhecido
- O cache em `data/.image-cache.json` evita reprocessar a mesma imagem
- `.env` está no  `.gitignore` e nunca deve ser commitado
