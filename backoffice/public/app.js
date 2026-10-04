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

async function request(url, options) {
  const res = await fetch(url, options);
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
    const created = createdFiles.length > 0 ? `Arquivos criados: ${createdFiles.join(', ')}.` : 'Os JSONs do mês já existiam.';
    showMessage(`Manifest gerado e cache limpo. ${created} Publique para enviar as alterações.`, 'success');
  } catch (err) {
    showMessage(err.message);
  } finally {
    $('new-month-confirm').disabled = false;
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
}

// ---------- Inicialização ----------

function applyState(data) {
  state.month = data.month;
  state.monthName = data.monthName;
  state.year = data.year;
  state.participants = data.participants;
  state.manifestCurrent = data.manifestCurrent;
  renderNewMonthButton();
  $('month-label').textContent = `Mês vigente: ${data.monthName}/${data.year}`;
}

async function init() {
  $('analyze-btn').addEventListener('click', analyzeAll);
  $('review-btn').addEventListener('click', openConfirm);
  $('cancel-btn').addEventListener('click', closeConfirm);
  $('save-btn').addEventListener('click', save);
  $('runner-form').addEventListener('submit', addRunner);
  $('new-month-btn').addEventListener('click', openNewMonth);
  $('new-month-cancel').addEventListener('click', closeNewMonth);
  $('new-month-confirm').addEventListener('click', startNewMonth);
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  }

  try {
    applyState(await request('/api/state'));
    refreshRunnerViews();
  } catch (err) {
    showMessage(`Falha ao carregar participantes: ${err.message}`);
  }
}

init();
