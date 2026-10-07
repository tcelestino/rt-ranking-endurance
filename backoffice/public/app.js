const state = {
  month: null,
  monthName: '',
  year: null,
  manifestCurrent: true,
  participants: [],
  // nome do participante -> lista de imagens anexadas
  selected: new Map(),
  // participante aguardando confirmação de remoção
  pendingRemoval: null,
  // período exibido na aba Ranking
  ranking: { year: null, month: null, periods: [], current: null, markdown: '' },
  // arquivos de data/ com alterações ainda não publicadas
  pendingChanges: [],
  // texto do ranking gerado na última publicação
  publishedMarkdown: '',
  // ano e dados exibidos na aba Gráficos
  stats: { year: null, data: null },
};

let nextImageId = 1;

const $ = (id) => document.getElementById(id);

function formatKm(value) {
  return `${value.toFixed(2).replace('.', ',')} km`;
}

function showMessage(text, type = 'error') {
  const el = $('message');
  el.textContent = text;
  el.className = `message ${type}`;
  el.hidden = false;
}

function clearMessage() {
  $('message').hidden = true;
}

// fetch autenticado: envia o session token do Clerk; em 401 volta para a tela de login
async function apiFetch(url, options = {}) {
  const token = await window.Clerk.session?.getToken();
  const headers = { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) showSignIn();
  return res;
}

async function request(url, options) {
  const res = await apiFetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Erro HTTP ${res.status}`);
  return body;
}

function postJson(url, payload) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function findParticipant(name) {
  return state.participants.find((p) => p.name === name);
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`Falha ao ler ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ---------- Lista de participantes ----------

function renderRunners() {
  for (const gender of ['female', 'male']) {
    const list = $(`list-${gender}`);
    list.replaceChildren();
    for (const p of state.participants.filter((r) => r.gender === gender)) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selected.has(p.name);
      checkbox.addEventListener('change', () => toggleRunner(p.name, checkbox.checked));

      const name = document.createElement('span');
      name.className = 'runner-name';
      name.textContent = p.name;

      const total = document.createElement('span');
      total.className = p.total > 0 ? 'runner-total' : 'runner-total zero';
      total.textContent = formatKm(p.total);

      label.append(checkbox, name, total);
      li.append(label);
      list.append(li);
    }
  }
}

function toggleRunner(name, checked) {
  if (checked) {
    state.selected.set(name, []);
  } else {
    for (const item of state.selected.get(name) ?? []) URL.revokeObjectURL(item.previewUrl);
    state.selected.delete(name);
  }
  closeConfirm();
  renderCards();
}

// ---------- Cards de cada participante ----------

function renderCards() {
  const container = $('cards');
  container.replaceChildren();
  $('empty').hidden = state.selected.size > 0;
  $('actions').hidden = state.selected.size === 0;

  for (const [name, items] of state.selected) {
    const card = $('card-template').content.firstElementChild.cloneNode(true);
    card.querySelector('.card-name').textContent = name;
    card.querySelector('.card-total').textContent = `Total atual: ${formatKm(findParticipant(name).total)}`;

    const dropzone = card.querySelector('.dropzone');
    const input = dropzone.querySelector('input');
    input.addEventListener('change', () => addFiles(name, input.files));
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('over');
      addFiles(name, e.dataTransfer.files);
    });

    const list = card.querySelector('.images');
    for (const item of items) list.append(renderImage(name, item));
    container.append(card);
  }
}

function renderImage(name, item) {
  const li = $('image-template').content.firstElementChild.cloneNode(true);
  li.dataset.status = item.status;
  li.querySelector('img').src = item.previewUrl;
  li.querySelector('.image-name').textContent = item.filename;

  const kmInput = li.querySelector('.image-km input');
  kmInput.value = item.km ?? '';
  kmInput.disabled = item.status !== 'done';
  kmInput.addEventListener('input', () => {
    item.km = kmInput.value === '' ? null : Number(kmInput.value);
  });

  li.querySelector('.image-status').textContent = statusText(item);
  li.querySelector('.image-remove').addEventListener('click', () => {
    URL.revokeObjectURL(item.previewUrl);
    const items = state.selected.get(name);
    items.splice(items.indexOf(item), 1);
    closeConfirm();
    renderCards();
  });
  return li;
}

function statusText(item) {
  switch (item.status) {
    case 'pending':
      return 'Aguardando análise';
    case 'analyzing':
      return 'Analisando…';
    case 'done':
      return 'Confira o valor extraído';
    case 'duplicate':
      return item.error;
    case 'error':
      return `Erro: ${item.error}`;
    default:
      return '';
  }
}

async function addFiles(name, fileList) {
  const items = state.selected.get(name);
  for (const file of fileList) {
    if (!file.type.startsWith('image/')) continue;
    items.push({
      id: nextImageId++,
      filename: file.name,
      mimeType: file.type,
      data: await readAsBase64(file),
      previewUrl: URL.createObjectURL(file),
      status: 'pending',
      km: null,
      hash: null,
      error: null,
    });
  }
  closeConfirm();
  renderCards();
}

// ---------- Análise ----------

function allItems() {
  return [...state.selected].flatMap(([name, items]) => items.map((item) => ({ name, item })));
}

async function analyzeAll() {
  clearMessage();
  closeConfirm();
  const pending = allItems().filter(({ item }) => item.status === 'pending' || item.status === 'error');
  if (pending.length === 0) {
    showMessage('Nenhuma imagem pendente de análise.', 'info');
    return;
  }

  $('analyze-btn').disabled = true;
  for (const { name, item } of pending) {
    item.status = 'analyzing';
    renderCards();
    try {
      const result = await postJson('/api/analyze', { name, mimeType: item.mimeType, data: item.data });
      item.hash = result.hash;
      item.km = result.km;
      const sameInSession = allItems().find(({ item: other }) => other !== item && other.hash === result.hash);
      if (result.cached) {
        item.status = 'duplicate';
        item.error = `Imagem já processada em ${result.cachedEntry.date} (${formatKm(result.km)}) — será ignorada`;
      } else if (sameInSession) {
        item.status = 'duplicate';
        item.error = `Mesma imagem já anexada para ${sameInSession.name} — será ignorada`;
      } else {
        item.status = 'done';
      }
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }
  }
  $('analyze-btn').disabled = false;
  renderCards();
}

// ---------- Revisão e salvamento ----------

function collectEntries() {
  const items = allItems();
  if (items.some(({ item }) => item.status === 'pending' || item.status === 'analyzing' || item.status === 'error')) {
    throw new Error('Há imagens não analisadas ou com erro. Analise novamente ou remova-as.');
  }
  const ready = items.filter(({ item }) => item.status === 'done');
  const invalid = ready.find(({ item }) => !Number.isFinite(item.km) || item.km <= 0);
  if (invalid) throw new Error(`Km inválido em ${invalid.item.filename} (${invalid.name}).`);
  if (ready.length === 0) throw new Error('Nenhuma imagem válida para salvar.');

  return ready.map(({ name, item }) => ({ name, km: item.km, hash: item.hash, filename: item.filename }));
}

function openConfirm() {
  clearMessage();
  let entries;
  try {
    entries = collectEntries();
  } catch (err) {
    showMessage(err.message);
    return;
  }

  $('confirm-month').textContent = `${state.monthName}/${state.year}`;
  const body = $('confirm-body');
  body.replaceChildren();
  const names = [...new Set(entries.map((e) => e.name))];
  for (const name of names) {
    const kms = entries.filter((e) => e.name === name).map((e) => e.km);
    const before = findParticipant(name).total;
    const after = before + kms.reduce((sum, v) => sum + v, 0);

    const tr = document.createElement('tr');
    const cells = [name, kms.map(formatKm).join(' + '), `${formatKm(before)} → ${formatKm(after)}`];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  }

  $('actions-buttons').hidden = true;
  $('confirm').hidden = false;
}

function closeConfirm() {
  $('confirm').hidden = true;
  $('actions-buttons').hidden = false;
}

async function save() {
  clearMessage();
  $('save-btn').disabled = true;
  try {
    const entries = collectEntries();
    applyState(await postJson('/api/save', { entries }));
    for (const items of state.selected.values()) {
      for (const item of items) URL.revokeObjectURL(item.previewUrl);
    }
    state.selected.clear();
    closeConfirm();
    refreshRunnerViews();
    showMessage(`${entries.length} registro(s) salvo(s) em ${state.monthName}/${state.year}.`, 'success');
  } catch (err) {
    showMessage(err.message);
  } finally {
    $('save-btn').disabled = false;
  }
}

// ---------- Gerenciamento de participantes ----------

function renderManageRunners() {
  for (const gender of ['female', 'male']) {
    const list = $(`manage-${gender}`);
    list.replaceChildren();
    for (const p of state.participants.filter((r) => r.gender === gender)) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'runner-name';
      name.textContent = p.name;
      li.append(name);

      if (state.pendingRemoval === p.name) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancelar';
        cancel.addEventListener('click', () => {
          state.pendingRemoval = null;
          renderManageRunners();
        });
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'danger';
        confirm.textContent = 'Confirmar remoção';
        confirm.addEventListener('click', () => removeRunner(p.name, confirm));
        li.append(cancel, confirm);
      } else {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remover';
        remove.addEventListener('click', () => {
          state.pendingRemoval = p.name;
          renderManageRunners();
        });
        li.append(remove);
      }
      list.append(li);
    }
  }
}

function refreshRunnerViews() {
  renderRunners();
  renderCards();
  renderManageRunners();
}

async function addRunner(event) {
  event.preventDefault();
  clearMessage();
  const nameInput = $('runner-name');
  const gender = $('runner-gender').value;
  const name = nameInput.value.trim();
  $('runner-add-btn').disabled = true;
  try {
    applyState(await postJson('/api/runners', { name, gender }));
    nameInput.value = '';
    refreshRunnerViews();
    showMessage(`${name} adicionado(a) em ${gender === 'female' ? 'Feminino' : 'Masculino'}.`, 'success');
  } catch (err) {
    showMessage(err.message);
  } finally {
    $('runner-add-btn').disabled = false;
  }
}

async function removeRunner(name, button) {
  clearMessage();
  button.disabled = true;
  try {
    applyState(await request(`/api/runners/${encodeURIComponent(name)}`, { method: 'DELETE' }));
    state.pendingRemoval = null;
    if (state.selected.has(name)) toggleRunner(name, false);
    refreshRunnerViews();
    showMessage(`${name} removido(a) da lista de participantes.`, 'success');
  } catch (err) {
    button.disabled = false;
    showMessage(err.message);
  }
}

// ---------- Novo mês ----------

function renderNewMonthButton() {
  const btn = $('new-month-btn');
  btn.classList.toggle('attention', !state.manifestCurrent);
  btn.title = state.manifestCurrent
    ? `Manifest de ${state.monthName}/${state.year} já gerado`
    : `Manifest de ${state.monthName}/${state.year} ainda não foi gerado`;
}

function openNewMonth() {
  clearMessage();
  closePublish();
  if (state.manifestCurrent) {
    closeNewMonth();
    showMessage(`O manifest de ${state.monthName}/${state.year} já foi gerado. Nada a fazer.`, 'info');
    return;
  }
  $('new-month-label').textContent = `${state.monthName}/${state.year}`;
  $('new-month-panel').hidden = false;
}

function closeNewMonth() {
  $('new-month-panel').hidden = true;
}

async function startNewMonth() {
  clearMessage();
  $('new-month-confirm').disabled = true;
  try {
    const { createdFiles, state: newState } = await postJson('/api/new-month', {});
    applyState(newState);
    refreshRunnerViews();
    closeNewMonth();
    const created =
      createdFiles.length > 0 ? `Arquivos criados: ${createdFiles.join(', ')}.` : 'Os JSONs do mês já existiam.';
    showMessage(`Manifest gerado e cache limpo. ${created} Publique para enviar as alterações.`, 'success');
  } catch (err) {
    showMessage(err.message);
  } finally {
    $('new-month-confirm').disabled = false;
  }
}

// ---------- Ranking ----------

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function rankingRow(cells, className) {
  const tr = document.createElement('tr');
  if (className) tr.className = className;
  for (const cell of cells) {
    const td = document.createElement('td');
    td.textContent = cell.text;
    if (cell.colSpan) td.colSpan = cell.colSpan;
    tr.append(td);
  }
  return tr;
}

function renderRankingTable(table, runners, total) {
  table.replaceChildren();
  const active = runners.filter((r) => r.km > 0);
  for (const r of active) {
    const name = `${MEDALS[r.position] ?? ''} ${r.name}`.trim();
    table.append(rankingRow([{ text: `${r.position}º` }, { text: name }, { text: formatKm(r.km) }]));
  }
  if (active.length === 0) {
    table.append(rankingRow([{ text: 'Nenhum km registrado', colSpan: 3 }], 'empty-row'));
  }

  const tfoot = document.createElement('tfoot');
  tfoot.append(rankingRow([{ text: 'Total', colSpan: 2 }, { text: formatKm(total) }]));
  const inactive = runners.length - active.length;
  if (inactive > 0) {
    const label = inactive === 1 ? '1 participante sem km' : `${inactive} participantes sem km`;
    tfoot.append(rankingRow([{ text: label, colSpan: 3 }], 'inactive-row'));
  }
  table.append(tfoot);
}

function rankingTimeline() {
  return state.ranking.periods.flatMap((p) => p.months.map((m) => ({ year: p.year, month: m.month })));
}

function renderRankingFilters() {
  const { year, month, periods, current } = state.ranking;

  const yearSelect = $('ranking-year-select');
  yearSelect.replaceChildren(...periods.map((p) => new Option(p.year, p.year, false, p.year === year)));

  const monthSelect = $('ranking-month-select');
  const months = periods.find((p) => p.year === year)?.months ?? [];
  monthSelect.replaceChildren(...months.map((m) => new Option(m.monthName, m.month, false, m.month === month)));

  const timeline = rankingTimeline();
  const index = timeline.findIndex((t) => t.year === year && t.month === month);
  $('ranking-prev').disabled = index <= 0;
  $('ranking-next').disabled = index === -1 || index >= timeline.length - 1;
  $('ranking-current').disabled = year === current.year && month === current.month;
}

async function loadRanking(year, month) {
  const params = year && month ? `?year=${year}&month=${month}` : '';
  try {
    const data = await request(`/api/ranking${params}`);
    state.ranking = {
      year: data.year,
      month: data.month,
      periods: data.periods,
      current: data.current,
      markdown: data.markdown,
    };
    $('ranking-markdown').textContent = data.markdown;
    renderRankingFilters();
    $('ranking-title').textContent = `Ranking de ${data.monthName}/${data.year}`;
    $('ranking-year').textContent = data.year;
    renderRankingTable($('ranking-female'), data.female, data.totals.female);
    renderRankingTable($('ranking-male'), data.male, data.totals.male);
    renderRankingTable($('ranking-annual'), data.annual, data.totals.annual);
  } catch (err) {
    showMessage(`Falha ao carregar ranking: ${err.message}`);
  }
}

async function copyToClipboard(text, btn) {
  clearMessage();
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copiado!';
    setTimeout(() => {
      btn.textContent = label;
    }, 2000);
  } catch (err) {
    showMessage(`Não foi possível copiar: ${err.message}`);
  }
}

function changeRankingYear() {
  const year = Number($('ranking-year-select').value);
  const months = state.ranking.periods.find((p) => p.year === year).months;
  const sameMonth = months.find((m) => m.month === state.ranking.month);
  loadRanking(year, (sameMonth ?? months[months.length - 1]).month);
}

function stepRanking(offset) {
  const timeline = rankingTimeline();
  const index = timeline.findIndex((t) => t.year === state.ranking.year && t.month === state.ranking.month);
  const target = timeline[index + offset];
  if (target) loadRanking(target.year, target.month);
}

// ---------- Gráficos ----------

const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
const GENDER_LABEL = { female: 'Feminino', male: 'Masculino' };

let chartJsPromise = null;
let charts = [];

function ensureChartJs() {
  chartJsPromise ??= loadScript(CHART_JS_URL).catch((err) => {
    chartJsPromise = null;
    throw err;
  });
  return chartJsPromise;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartTheme() {
  return {
    text: cssVar('--color-muted'),
    grid: cssVar('--color-border'),
    accent: cssVar('--color-accent'),
    gender: { female: cssVar('--chart-female'), male: cssVar('--chart-male') },
    series: [1, 2, 3, 4, 5].map((i) => cssVar(`--chart-${i}`)),
  };
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const formatCount = (singular, pluralForm) => (value) => plural(value, singular, pluralForm);

function barChart(
  id,
  labels,
  datasets,
  { horizontal = false, stacked = false, format = formatKm, integer = false } = {},
) {
  const valueAxis = { beginAtZero: true, stacked, ticks: integer ? { precision: 0 } : {} };
  const categoryAxis = { stacked, grid: { display: false } };
  charts.push(
    new window.Chart($(id), {
      type: 'bar',
      data: {
        labels,
        datasets: datasets.map((d) => ({ borderRadius: 4, maxBarThickness: 32, skipNull: true, ...d })),
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        maintainAspectRatio: false,
        scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
        plugins: {
          legend: { display: datasets.length > 1 },
          tooltip: {
            filter: (item) => item.raw !== null,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${format(horizontal ? ctx.parsed.x : ctx.parsed.y)}`,
            },
          },
        },
      },
    }),
  );
}

function genderDatasets(runners, field, theme) {
  return ['female', 'male'].map((gender) => ({
    label: GENDER_LABEL[gender],
    backgroundColor: theme.gender[gender],
    data: runners.map((r) => (r.gender === gender ? r[field] : null)),
  }));
}

function runnerBarChart(id, runners, field, format) {
  const ranked = runners.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]);
  barChart(
    id,
    ranked.map((r) => r.name),
    genderDatasets(ranked, field, chartTheme()),
    { horizontal: true, stacked: true, integer: true, format },
  );
}

function renderStatsCharts(data) {
  for (const chart of charts) chart.destroy();
  charts = [];

  const theme = chartTheme();
  window.Chart.defaults.color = theme.text;
  window.Chart.defaults.borderColor = theme.grid;
  window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  const monthLabels = data.months.map((m) => m.monthName);
  barChart(
    'chart-months',
    monthLabels,
    ['female', 'male'].map((gender) => ({
      label: GENDER_LABEL[gender],
      backgroundColor: theme.gender[gender],
      data: data.months.map((m) => m[gender]),
    })),
    { stacked: true },
  );

  const bestMonths = [...data.months].sort((a, b) => b.total - a.total);
  barChart(
    'chart-best-months',
    bestMonths.map((m) => m.monthName),
    [{ label: 'Total', backgroundColor: theme.accent, data: bestMonths.map((m) => m.total) }],
    { horizontal: true },
  );

  barChart(
    'chart-years',
    data.yearTotals.map((y) => String(y.year)),
    [{ label: 'Total', backgroundColor: theme.accent, data: data.yearTotals.map((y) => y.km) }],
  );

  runnerBarChart('chart-wins', data.runners, 'wins', formatCount('vitória', 'vitórias'));
  runnerBarChart('chart-activities', data.runners, 'activities', formatCount('atividade', 'atividades'));
  runnerBarChart('chart-active-months', data.runners, 'activeMonths', formatCount('mês', 'meses'));

  barChart(
    'chart-active-runners',
    monthLabels,
    [{ label: 'Corredores ativos', backgroundColor: theme.accent, data: data.months.map((m) => m.activeRunners) }],
    { integer: true, format: formatCount('corredor', 'corredores') },
  );

  barChart(
    'chart-distances',
    data.distances.map((d) => d.label),
    [{ label: 'Corridas', backgroundColor: theme.accent, data: data.distances.map((d) => d.count) }],
    { integer: true, format: formatCount('corrida', 'corridas') },
  );

  charts.push(
    new window.Chart($('chart-cumulative'), {
      type: 'line',
      data: {
        labels: monthLabels,
        datasets: data.cumulativeTop5.map((runner, i) => ({
          label: runner.name,
          data: runner.values,
          borderColor: theme.series[i],
          backgroundColor: theme.series[i],
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        })),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
        plugins: {
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatKm(ctx.parsed.y)}` } },
        },
      },
    }),
  );
}

function setKpi(id, value, detail) {
  const el = $(id);
  el.textContent = value;
  if (detail) {
    const small = document.createElement('small');
    small.textContent = detail;
    el.append(small);
  }
}

function renderStatsKpis(data) {
  const total = data.yearTotals.find((y) => y.year === data.year)?.km ?? 0;
  setKpi('kpi-total', formatKm(total));

  const detailed = data.months.filter((m) => m.activities !== null);
  setKpi('kpi-activities', String(detailed.reduce((sum, m) => sum + m.activities, 0)));

  const best = data.months.reduce((a, b) => (b.total > a.total ? b : a), data.months[0]);
  setKpi('kpi-best-month', best ? best.monthName : '—', best ? formatKm(best.total) : '');

  const longest = data.longestRun;
  setKpi('kpi-longest', longest ? formatKm(longest.km) : '—', longest ? `${longest.name} · ${longest.monthName}` : '');

  const consolidated = data.months.filter((m) => m.activities === null).map((m) => m.monthName);
  $('stats-note').hidden = consolidated.length === 0;
  $('stats-note').textContent =
    `${consolidated.join(', ')}: os dados guardam só o total mensal de cada corredor, ` +
    'por isso ficam fora de atividades, distribuição de distâncias e maior corrida.';
}

function renderWinnersTable(winners) {
  const table = $('winners-table');
  table.replaceChildren();

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const text of ['Mês', 'Feminino', 'Masculino']) {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const winnerText = (winner) => (winner ? `${winner.name} (${formatKm(winner.km)})` : '—');
  for (const w of winners) {
    table.append(rankingRow([{ text: w.monthName }, { text: winnerText(w.female) }, { text: winnerText(w.male) }]));
  }
  if (winners.length === 0) {
    table.append(rankingRow([{ text: 'Nenhum mês encerrado', colSpan: 3 }], 'empty-row'));
  }
}

function renderStats(data) {
  $('stats-year-select').replaceChildren(...data.years.map((y) => new Option(y, y, false, y === data.year)));
  renderStatsKpis(data);
  renderWinnersTable(data.winners);
  renderStatsCharts(data);
}

async function loadStats(year) {
  try {
    await ensureChartJs();
    const data = await request(`/api/stats${year ? `?year=${year}` : ''}`);
    state.stats = { year: data.year, data };
    renderStats(data);
  } catch (err) {
    showMessage(`Falha ao carregar gráficos: ${err.message}`);
  }
}

// ---------- Publicação ----------

async function refreshPublishStatus() {
  try {
    const { pendingChanges } = await request('/api/publish/status');
    state.pendingChanges = pendingChanges;
    $('publish-btn').classList.toggle('attention', pendingChanges.length > 0);
    $('publish-btn').title =
      pendingChanges.length > 0
        ? `${pendingChanges.length} arquivo(s) para publicar`
        : 'Nenhuma alteração para publicar';
  } catch (err) {
    showMessage(`Falha ao verificar alterações: ${err.message}`);
  }
}

async function openPublish() {
  clearMessage();
  closeNewMonth();
  $('publish-result').hidden = true;
  await refreshPublishStatus();
  if (state.pendingChanges.length === 0) {
    closePublish();
    showMessage('Nenhuma alteração em data/ para publicar.', 'info');
    return;
  }
  $('publish-files').replaceChildren(
    ...state.pendingChanges.map((file) => {
      const li = document.createElement('li');
      li.textContent = file;
      return li;
    }),
  );
  $('publish-panel').hidden = false;
}

function closePublish() {
  $('publish-panel').hidden = true;
}

function showPublishResult(title, body) {
  $('publish-result-title').textContent = title;
  $('publish-result-log').textContent = body.log ?? '';
  $('publish-result-pr').hidden = !body.prUrl;
  $('publish-result-link').href = body.prUrl ?? '';
  $('publish-result-link').textContent = body.prUrl ?? '';
  state.publishedMarkdown = body.markdown ?? '';
  $('publish-result-copy').hidden = !body.markdown;
  $('publish-result').hidden = false;
}

async function publish() {
  clearMessage();
  const confirmBtn = $('publish-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Publicando…';
  $('publish-btn').disabled = true;
  try {
    const res = await apiFetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoMerge: $('publish-auto-merge').checked }),
    });
    const body = await res.json().catch(() => ({}));
    closePublish();
    if (res.ok) {
      showPublishResult('Publicação concluída', body);
    } else if (body.log) {
      showPublishResult('Falha na publicação', body);
      showMessage(body.error);
    } else {
      showMessage(body.error || `Erro HTTP ${res.status}`);
    }
  } catch (err) {
    showMessage(err.message);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmar publicação';
    $('publish-btn').disabled = false;
    refreshPublishStatus();
  }
}

// ---------- Navegação ----------

function showView(view) {
  clearMessage();
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.view === view);
  }
  for (const el of document.querySelectorAll('.view')) {
    el.hidden = el.id !== `view-${view}`;
  }
  if (view === 'ranking') loadRanking(state.ranking.year, state.ranking.month);
  if (view === 'stats') loadStats(state.stats.year);
}

// ---------- Inicialização ----------

function applyState(data) {
  state.month = data.month;
  state.monthName = data.monthName;
  state.year = data.year;
  state.participants = data.participants;
  state.manifestCurrent = data.manifestCurrent;
  renderNewMonthButton();
  refreshPublishStatus();
  $('month-label').textContent = `Mês vigente: ${data.monthName}/${data.year}`;
}

function bindEvents() {
  $('analyze-btn').addEventListener('click', analyzeAll);
  $('review-btn').addEventListener('click', openConfirm);
  $('cancel-btn').addEventListener('click', closeConfirm);
  $('save-btn').addEventListener('click', save);
  $('runner-form').addEventListener('submit', addRunner);
  $('new-month-btn').addEventListener('click', openNewMonth);
  $('new-month-cancel').addEventListener('click', closeNewMonth);
  $('new-month-confirm').addEventListener('click', startNewMonth);
  $('publish-btn').addEventListener('click', openPublish);
  $('publish-cancel').addEventListener('click', closePublish);
  $('publish-confirm').addEventListener('click', publish);
  $('publish-result-close').addEventListener('click', () => {
    $('publish-result').hidden = true;
  });
  $('publish-result-copy').addEventListener('click', () =>
    copyToClipboard(state.publishedMarkdown, $('publish-result-copy')),
  );
  $('ranking-year-select').addEventListener('change', changeRankingYear);
  $('ranking-month-select').addEventListener('change', () =>
    loadRanking(state.ranking.year, Number($('ranking-month-select').value)),
  );
  $('ranking-prev').addEventListener('click', () => stepRanking(-1));
  $('ranking-next').addEventListener('click', () => stepRanking(1));
  $('ranking-current').addEventListener('click', () => loadRanking());
  $('ranking-filters').addEventListener('submit', (e) => e.preventDefault());
  $('copy-ranking-btn').addEventListener('click', () => copyToClipboard(state.ranking.markdown, $('copy-ranking-btn')));
  $('stats-year-select').addEventListener('change', () => loadStats(Number($('stats-year-select').value)));
  $('stats-filters').addEventListener('submit', (e) => e.preventDefault());
  // as cores dos gráficos vêm das variáveis CSS, que mudam com o tema do sistema
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.stats.data && window.Chart) renderStatsCharts(state.stats.data);
  });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  }
}

// ---------- Autenticação (Clerk) ----------

const CLERK_JS_URL = (domain) => `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
const CLERK_UI_URL = (domain) => `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`;

let appStarted = false;
let signInMounted = false;

function loadScript(src, attributes = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    for (const [key, value] of Object.entries(attributes)) script.setAttribute(key, value);
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

async function loadClerk() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`Falha ao carregar configuração (HTTP ${res.status})`);
  const { publishableKey } = await res.json();

  // o domínio do Frontend API do Clerk vem codificado na publishable key (pk_test_<base64>)
  const domain = atob(publishableKey.split('_')[2]).slice(0, -1);
  await loadScript(CLERK_UI_URL(domain));
  await loadScript(CLERK_JS_URL(domain), { 'data-clerk-publishable-key': publishableKey });
  await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
}

function showAuthStatus(text) {
  $('auth-status').textContent = text;
  $('auth-status').hidden = !text;
}

function showSignIn() {
  appStarted = false;
  $('app').hidden = true;
  $('auth').hidden = false;
  showAuthStatus('');
  if (signInMounted) return;
  window.Clerk.unmountUserButton($('sign-in'));
  window.Clerk.mountSignIn($('sign-in'));
  signInMounted = true;
}

function unmountSignIn() {
  if (!signInMounted) return;
  window.Clerk.unmountSignIn($('sign-in'));
  signInMounted = false;
}

function showForbidden(message) {
  $('app').hidden = true;
  $('auth').hidden = false;
  showAuthStatus(message);
  unmountSignIn();
  window.Clerk.mountUserButton($('sign-in'));
}

async function startApp() {
  if (appStarted) return;
  appStarted = true;
  showAuthStatus('Carregando…');
  unmountSignIn();

  const res = await apiFetch('/api/state');
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) return;
  if (!res.ok) {
    appStarted = false;
    showForbidden(body.error || `Erro HTTP ${res.status}`);
    return;
  }

  $('auth').hidden = true;
  $('app').hidden = false;
  window.Clerk.mountUserButton($('user-button'));
  $('user-button').title = body.user?.email ?? '';
  applyState(body);
  refreshRunnerViews();
  await loadRanking();
}

async function init() {
  bindEvents();
  try {
    await loadClerk();
  } catch (err) {
    showAuthStatus(`Falha ao carregar o login: ${err.message}`);
    return;
  }

  // emite o estado atual ao registrar; user undefined = sessão ainda carregando
  window.Clerk.addListener(({ user }) => {
    if (user) startApp();
    else if (user === null) showSignIn();
  });
}

init();
