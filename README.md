# Ranking Endurance

Automação de atualização de rankings de corrida. O script lê screenshots de apps de corrida (Strava, Garmin, etc.), extrai o km percorrido via IA (Gemini), salva em arquivos JSON locais e gera a página `results.html` com os rankings e o arquivo `results.md` para envio no WhatsApp.

## Fluxo

```
images/eli.png, tiago.png
       ↓
  Scan pasta images/
       ↓
  Gemini Vision → extrai km da imagem
       ↓
  Salva em data/feminino-[mes].json ou data/masculino-[mes].json
       ↓
  npm run generate
       ↓
  Lê data/*.json + data/runners.json
       ↓
  Gera output/results.html + output/results.md
```

## Estrutura

```
rt-ranking/
├── src/
│   ├── index.ts                  # CLI principal — processa imagens e salva JSONs
│   ├── imageAnalyzerGemini.ts    # Gemini Vision: extrai km da imagem
│   ├── htmlGenerator.ts          # Gera output/results.html e output/results.md
│   ├── jsonUpdater.ts            # Lê e escreve os arquivos JSON de dados
│   ├── participantsParser.ts     # Carrega data/runners.json
│   └── cacheManager.ts           # Cache de imagens por hash SHA256
├── data/
│   ├── runners.json              # Lista de participantes por gênero
│   ├── feminino-[mes].json       # Dados mensais femininos (gerado automaticamente)
│   └── masculino-[mes].json      # Dados mensais masculinos (gerado automaticamente)
├── images/                       # Coloque aqui os screenshots dos corredores
├── output/
│   ├── results.html              # Página com rankings e botão WhatsApp
│   └── results.md                # Markdown para envio no WhatsApp
├── .env                          # Variáveis de ambiente (não commitado)
├── .env.example                  # Modelo das variáveis
├── package.json
└── tsconfig.json
```

## Pré-requisitos

- Node.js 18+
- Conta no [Google AI Studio](https://aistudio.google.com) com acesso à API Gemini

## Instalação

```bash
npm install
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

## Uso

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

### 2. Gerar rankings

```bash
npm run generate
```

Gera dois arquivos:
- `output/results.html` — abrir no browser, visualizar rankings e copiar para WhatsApp com o botão
- `output/results.md` — markdown pronto para colar no WhatsApp

## Formatos de imagem suportados

`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`

## Observações

- O nome do arquivo define o nome do corredor (ex: `tiago.png` → `Tiago`)
- O corredor deve estar cadastrado em `data/runners.json` para ser reconhecido
- O cache em `data/.image-cache.json` evita reprocessar a mesma imagem no mesmo dia
- `.env` está no `.gitignore` e nunca deve ser commitado
