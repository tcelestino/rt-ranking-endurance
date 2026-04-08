# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run update    # processa imagens em images/ e salva km nos JSONs
npm run generate  # lê data/*.json e gera resultados.html + template-resultados.md
npm run build     # compila TypeScript para dist/
npx tsc --noEmit  # verifica tipos sem gerar arquivos (ignorar erros em templateGenerator.ts)
```

Não há testes automatizados. A verificação é feita rodando `npm run update` com imagens reais em `images/` e depois `npm run generate`.

## Arquitetura

O projeto é um script CLI Node.js/TypeScript com dois fluxos independentes:

### Fluxo 1 — `npm run update` (processamento de imagens)

**`src/index.ts`** — ponto de entrada. Lê todos os arquivos de `images/`, detecta o gênero do corredor via `participantsParser`, verifica cache, chama o analyzer e salva o km no JSON correspondente.

**`src/imageAnalyzerGemini.ts`** — implementação padrão usando `gemini-2.0-flash` via `@google/generative-ai`. Recebe o caminho da imagem e retorna `number` (km extraído).

**`src/jsonUpdater.ts`** — lê e escreve os arquivos JSON em `data/`. Funções principais: `loadMonthData`, `appendKm`, `saveMonthData`, `getDataFilePath`, `getMonthName`.

**`src/participantsParser.ts`** — carrega `runner.json` e expõe `loadParticipants()` e `findGender()`.

**`src/cacheManager.ts`** — cache de imagens por hash SHA256 em `data/.image-cache.json`. Evita reprocessar a mesma imagem no mesmo dia.

### Fluxo 2 — `npm run generate` (geração de rankings)

**`src/htmlGenerator.ts`** — lê os JSONs de `data/` e `participantes.json`, calcula os rankings mensal (feminino, masculino) e anual, e gera dois arquivos na raiz:
- `resultados.html` — página self-contained com visual dos rankings e botão "Copiar para WhatsApp"
- `template-resultados.md` — markdown no formato WhatsApp (`*negrito*`, medalhas, km)

## Convenções dos dados

- **Arquivos de dados**: `data/feminino-[mes].json` e `data/masculino-[mes].json`
  - Formato: `[{ "name": "Eli", "km": [19.04, 5.30] }]`
  - O campo `km` é um array — cada imagem processada adiciona um item
  - Total do corredor no mês = soma de todos os valores do array
- **Lista de participantes**: `participantes.json` — objeto com chaves `female` e `male` (arrays de nomes)
- O mês atual é detectado pela data do sistema. Pode ser sobrescrito com `CURRENT_MONTH=4` no `.env`

## Lógica de ranking

- **Mensal**: soma os km do JSON do mês atual para cada gênero, ordena desc, inclui corredores com 0km
- **Anual**: agrega todos os arquivos de `data/` (todos os meses, ambos os gêneros), ordena desc

## Arquivos sensíveis

- `.env` — variáveis de ambiente com API keys (`GEMINI_API_KEY`) (nunca commitar)
- `credentials.json` - contêm as configurações do Google API (nunca commitar)

Devem estar no `.gitignore`.

## Observações

- `templateGenerator.ts` e as dependências do Google Sheets foram substituídos pelo `htmlGenerator.ts`. O arquivo `templateGenerator.ts` existe no repositório mas não é mais usado — pode ser ignorado.
