# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run update    # processa imagens em images/ e salva km nos JSONs
npm run generate  # lê data/*.json e gera output/results.md + data/manifest.json
npm run serve     # sobe servidor estático na porta 3000 (acesse http://localhost:3000)
npm run build     # compila TypeScript para dist/
npx tsc --noEmit  # verifica tipos sem gerar arquivos
```

Não há testes automatizados. A verificação é feita rodando `npm run update` com imagens reais em `images/` e depois `npm run generate`.

## Arquitetura

O projeto é um script CLI Node.js/TypeScript com dois fluxos independentes:

### Fluxo 1 — `npm run update` (processamento de imagens)

**`generator/index.ts`** — ponto de entrada. Lê todos os arquivos de `images/`, detecta o gênero do corredor via `participantsParser`, verifica cache, chama o analyzer e salva o km no JSON correspondente. Imagens já em cache (mesmo hash SHA256) são ignoradas — não atualizam os JSONs.

**`generator/imageAnalyzerGemini.ts`** — usa `gemini-2.0-flash` via `@google/genai`. Recebe o caminho da imagem e retorna `number` (km extraído).

**`generator/jsonUpdater.ts`** — lê e escreve os arquivos JSON em `data/`. Funções principais: `loadMonthData`, `appendKm`, `saveMonthData`, `getDataFilePath`, `getMonthName`.

**`generator/participantsParser.ts`** — carrega `data/runners.json` e expõe `loadParticipants()` e `findGender()`.

**`generator/cacheManager.ts`** — cache de imagens por hash SHA256 em `data/.image-cache.json`. Imagem já processada (mesmo hash) é ignorada em execuções futuras, independente da data.

### Fluxo 2 — `npm run generate` (geração de rankings)

**`generator/htmlGenerator.ts`** — lê os JSONs de `data/` e `data/runners.json`, calcula os rankings mensal (feminino, masculino) e anual, e gera dois arquivos:
- `output/results.md` — markdown no formato WhatsApp (`*negrito*`, medalhas, km)
- `data/manifest.json` — lista de meses disponíveis, consumida pelo `index.html` via `fetch()`

**`index.html`** — página estática na raiz do projeto. Carrega os dados via `fetch()` em runtime (`manifest.json` + JSONs mensais) e renderiza os rankings com navegação por abas e botão "Copiar para WhatsApp".

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
- `credentials.json` - contêm as configurações do Google API (nunca commitar)

Devem estar no `.gitignore`.

## Observações

- O cache em `data/.image-cache.json` é baseado em hash SHA256 — a mesma imagem nunca é reprocessada, independente da data ou nome do arquivo.
