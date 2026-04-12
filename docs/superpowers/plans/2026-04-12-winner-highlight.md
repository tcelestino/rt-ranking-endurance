# Winner Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir, no último dia do mês, um card destacando o vencedor feminino e masculino do mês ativo.

**Architecture:** Lógica inteiramente no frontend estático. Uma função verifica se hoje é o último dia do mês atual via `new Date()`. Se sim, `renderUI()` injeta um card de vencedores no HTML de cada `month-content`. A visibilidade é controlada pelo mecanismo `.month-content.active` já existente.

**Tech Stack:** Vanilla JS, CSS custom properties (já usadas no projeto), sem dependências novas.

---

## Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `static/assets/app.js` | Adicionar `isLastDayOfCurrentMonth()`, `renderMonthWinners()`, integrar em `renderUI()` |
| `static/assets/style.css` | Adicionar `.winner-row` e `.winner-gender` |

---

## Task 1: Adicionar `isLastDayOfCurrentMonth()` em `app.js`

**Files:**
- Modify: `static/assets/app.js`

- [ ] **Step 1: Adicionar a função logo após a função `medal()` (linha 17)**

Abra `static/assets/app.js`. Após o bloco da função `medal()` (que termina na linha 17), insira:

```js
function isLastDayOfCurrentMonth() {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() === lastDay;
}
```

- [ ] **Step 2: Verificar no console do navegador**

Suba o servidor:
```bash
npm run serve
```

Abra `http://localhost:3000` e no DevTools console execute:
```js
isLastDayOfCurrentMonth()
```
Esperado: `true` ou `false` dependendo da data atual (sem erros de JS).

---

## Task 2: Adicionar `renderMonthWinners()` em `app.js`

**Files:**
- Modify: `static/assets/app.js`

- [ ] **Step 1: Adicionar a função logo após `renderTotalMonth()` (por volta da linha 89)**

```js
function renderMonthWinners(female, male) {
  const f = female[0];
  const m = male[0];
  return (
    '<div class="section">' +
    '<div class="section-header">🏆 Vencedores do Mês</div>' +
    '<div class="winner-row">' +
    '<span class="winner-gender">🏃‍♀️</span>' +
    '<span class="medal">🥇</span>' +
    '<span class="name">' + f.name + '</span>' +
    '<span class="km">' + f.km.toFixed(2) + 'km</span>' +
    '</div>' +
    '<div class="winner-row">' +
    '<span class="winner-gender">🏃‍♂️</span>' +
    '<span class="medal">🥇</span>' +
    '<span class="name">' + m.name + '</span>' +
    '<span class="km">' + m.km.toFixed(2) + 'km</span>' +
    '</div>' +
    '</div>'
  );
}
```

- [ ] **Step 2: Verificar no console do navegador**

Com `npm run serve` rodando, no console execute (após dados carregarem):
```js
renderMonthWinners(state.months[0].female, state.months[0].male)
```
Esperado: string HTML com o nome do primeiro colocado feminino e masculino, sem erros.

---

## Task 3: Adicionar estilos em `style.css`

**Files:**
- Modify: `static/assets/style.css`

- [ ] **Step 1: Adicionar estilos ao final de `style.css`, antes do `@media (min-width: 768px)`**

Localize o bloco `@media (min-width: 768px)` (linha 294) e insira antes dele:

```css
.winner-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.winner-row:last-child {
  border-bottom: none;
}

.winner-gender {
  font-size: 1rem;
  min-width: 1.4rem;
}
```

---

## Task 4: Integrar `renderMonthWinners()` em `renderUI()`

**Files:**
- Modify: `static/assets/app.js`

- [ ] **Step 1: Localizar o loop de renderização de `month-content` em `renderUI()`**

Em `static/assets/app.js`, localize o trecho (por volta da linha 144):

```js
$contentsEl.innerHTML = state.months
    .map((m) => {
      const active = m.month === activeMonth ? ' active' : '';
      return (
        '<div id="content-' +
        m.month +
        '" class="month-content' +
        active +
        '">' +
        '<div class="section">' +
        '<div class="section-header">🏃‍♀️ Feminino</div>' +
        '<ul class="runner-list">' +
        renderRows(m.female) +
        '</ul>' +
        renderTotalMonth(m.female) +
        '</div>' +
        '<div class="section">' +
        '<div class="section-header">🏃‍♂️ Masculino</div>' +
        '<ul class="runner-list">' +
        renderRows(m.male) +
        '</ul>' +
        renderTotalMonth(m.male) +
        '</div>' +
        '</div>'
      );
    })
    .join('');
```

- [ ] **Step 2: Adicionar o card de vencedores antes do fechamento do `month-content`**

Substitua o trecho acima por:

```js
$contentsEl.innerHTML = state.months
    .map((m) => {
      const active = m.month === activeMonth ? ' active' : '';
      return (
        '<div id="content-' +
        m.month +
        '" class="month-content' +
        active +
        '">' +
        '<div class="section">' +
        '<div class="section-header">🏃‍♀️ Feminino</div>' +
        '<ul class="runner-list">' +
        renderRows(m.female) +
        '</ul>' +
        renderTotalMonth(m.female) +
        '</div>' +
        '<div class="section">' +
        '<div class="section-header">🏃‍♂️ Masculino</div>' +
        '<ul class="runner-list">' +
        renderRows(m.male) +
        '</ul>' +
        renderTotalMonth(m.male) +
        '</div>' +
        (isLastDayOfCurrentMonth() ? renderMonthWinners(m.female, m.male) : '') +
        '</div>'
      );
    })
    .join('');
```

- [ ] **Step 3: Verificar visualmente com a condição forçada**

Para testar sem esperar o último dia do mês, modifique temporariamente `isLastDayOfCurrentMonth()` para retornar `true`:

```js
function isLastDayOfCurrentMonth() {
  return true; // temporário para teste
}
```

Com `npm run serve` rodando, acesse `http://localhost:3000` e confirme:
- Card "Vencedores do Mês" aparece abaixo das seções feminino e masculino
- Ao trocar de aba, o card exibe os vencedores do mês correspondente
- Nome e km do primeiro colocado feminino e masculino estão corretos
- Layout respeita o tema claro e escuro

- [ ] **Step 4: Reverter o retorno temporário de `isLastDayOfCurrentMonth()`**

Restaure a função para a implementação correta:

```js
function isLastDayOfCurrentMonth() {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() === lastDay;
}
```

- [ ] **Step 5: Verificar tipos no console**

No console do navegador, execute:
```js
npx tsc --noEmit
```

Ou via terminal:
```bash
npx tsc --noEmit
```
Esperado: sem erros de TypeScript (o projeto não tem testes automatizados; verificação de tipos é suficiente).

- [ ] **Step 6: Commit**

```bash
git add static/assets/app.js static/assets/style.css
git commit -m "feat: exibe vencedores do mes no ultimo dia do mes (issue #13)"
```

---

## Self-review

- `isLastDayOfCurrentMonth()` — spec coberto (Task 1)
- `renderMonthWinners()` — spec coberto (Task 2)
- CSS `.winner-row` e `.winner-gender` — spec coberto (Task 3)
- Integração condicional em `renderUI()` — spec coberto (Task 4)
- Condição: último dia do mês atual do calendário — spec coberto (Task 4, step 2)
- Vencedor do mês ativo (não fixo) — spec coberto, pois o card é renderizado por `m.female[0]` e `m.male[0]` de cada mês
- Sem mudanças na API, processor ou JSONs — confirmado
