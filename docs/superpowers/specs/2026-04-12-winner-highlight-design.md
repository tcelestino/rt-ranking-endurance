# Design: Destaque do Vencedor Mensal

**Data:** 2026-04-12
**Issue:** #13

## Resumo

Exibir, abaixo das seções de ranking mensal, um card destacando o vencedor feminino e masculino daquele mês. O card só aparece no último dia do mês atual do calendário.

## Escopo

Mudancas apenas em `static/assets/app.js` e `static/assets/style.css`. Sem alterações na API, nos JSONs de dados ou no processor.

## Condição de exibição

- Verificada via `isLastDayOfCurrentMonth()` no frontend
- Usa `new Date()` do cliente
- Se hoje for o último dia do mês corrente, o card é renderizado em todos os meses; se não for, não é renderizado em nenhum
- O card exibido mostra o vencedor do mês correspondente à aba ativa

```js
function isLastDayOfCurrentMonth() {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() === lastDay;
}
```

## Renderização

Nova função `renderMonthWinners(female, male)`:
- Recebe o array de corredores femininos e masculinos já ordenados por posição
- Pega `female[0]` e `male[0]` (posição 1 de cada gênero)
- Retorna HTML de um card com:
  - Header: "Vencedores do Mês"
  - Linha feminina: 🥇 nome + km (estilo `.km`)
  - Linha masculina: 🥇 nome + km (estilo `.km`)

Inserida em `renderUI()`, dentro do loop de `state.months.map(...)`, ao final de cada `month-content`, condicionada a `isLastDayOfCurrentMonth()`.

## Visual

Card segue o padrão `.section` existente:
- `.section-header` com texto "Vencedores do Mês"
- Duas linhas com layout similar ao `.runner` existente
- Sem novos componentes visuais além de estilos mínimos para o card de destaque

## Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `static/assets/app.js` | Adicionar `isLastDayOfCurrentMonth()`, `renderMonthWinners()`, chamar em `renderUI()` |
| `static/assets/style.css` | Estilos para o card `.winner-card` se necessário |

## Fora do escopo

- Mudanças na API
- Mudanças no manifest.json ou processor
- Persistência ou cache da informação de vencedor
- Exibição em meses que não são o atual do calendário (ex: meses passados não ganham o card automaticamente)
