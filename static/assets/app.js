const API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://localhost:3001'
  : 'https://rt-ranking-endurance-api.onrender.com';

const RANKING_ONLINE_URL = 'https://rt-ranking-endurance.onrender.com';

let activeMonth = null;
let state = { months: [], annual: [], year: null, totalAnnual: 0 };
const monthElements = new Map();

const $btnToggleTheme = document.getElementById('theme-toggle');

function medal(pos) {
  if (pos === 1) return '🥇';
  if (pos === 2) return '🥈';
  if (pos === 3) return '🥉';
  return '';
}

function isLastDayOfCurrentMonth() {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() === lastDay;
}

function shouldShowWinners(monthNum, currentMonth, isLastDay) {
  if (monthNum < currentMonth) return true;
  if (monthNum === currentMonth) return isLastDay;
  return false;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatKm(km) {
  return km === 0 ? '0km' : km.toFixed(2) + 'km';
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Erro ao carregar ${url}: ${response.statusText}`);
  }
  return response.json();
}

function calcRanking(participants, data) {
  const dataMap = new Map();
  data.forEach((d) => {
    dataMap.set(
      d.name.toLowerCase(),
      d.km.reduce((a, b) => a + b, 0),
    );
  });

  return participants
    .map((name) => ({
      name,
      km: dataMap.get(name.toLowerCase()) || 0,
    }))
    .sort((a, b) => b.km - a.km)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

function calcAnnualRanking(allMonthsData, runners) {
  const totals = new Map();

  allMonthsData.forEach((monthData) => {
    [...monthData.female, ...monthData.male].forEach((record) => {
      const key = record.name.toLowerCase();
      const sum = record.km.reduce((a, b) => a + b, 0);
      totals.set(key, (totals.get(key) || 0) + sum);
    });
  });

  const allNames = [...runners.female, ...runners.male];
  return allNames
    .map((name) => ({
      name,
      km: totals.get(name.toLowerCase()) || 0,
    }))
    .sort((a, b) => b.km - a.km)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

function calcTotal(allMonthsData) {
  return allMonthsData.reduce((total, monthData) => {
    const monthSum = [...monthData.female, ...monthData.male].reduce((sum, record) => {
      return sum + record.km.reduce((a, b) => a + b, 0);
    }, 0);
    return total + monthSum;
  }, 0);
}

function renderTotal(total) {
  return `<div class="total">
    <span class="total-label">Total:</span>
    <span class="total-value km">${formatKm(total)}</span>
  </div>`;
}

function renderTotalMonth(runners) {
  const total = runners.reduce((sum, r) => sum + r.km, 0);
  return renderTotal(total);
}

function templateRanking(title, runner) {
  return `<div class="section">
  <div class="section-header">🎉 ${title}</div>
  <div class="winner-row">
  <span class="name">${escapeHtml(runner.name)}</span>
  <span class="km">${formatKm(runner.km)}</span>
  </div>
  </div>`;
}

function renderMonthWinnerCard(female, male) {
  const f = female[0];
  const m = male[0];

  if ((!f || f.km === 0) && (!m || m.km === 0)) return '';

  const femaleCard = f && f.km > 0 ? templateRanking('Vencedora do Mês', f) : '';
  const maleCard = m && m.km > 0 ? templateRanking('Vencedor do Mês', m) : '';

  return `<div class="winner-cards">${femaleCard} ${maleCard}</div>`;
}

function renderRows(runners) {
  return runners
    .map((r) => {
      const m = medal(r.position);
      const medalHtml = m ? `<span class="medal">${m}</span>` : '';
      const kmHtml = r.km === 0 ? `<span class="zero">0km</span>` : `<span class="km">${r.km.toFixed(2)}km</span>`;
      return `<li class="runner ${r.km === 0 ? 'no-km' : ''}">
        <span class="pos">${r.position}.</span>
        ${medalHtml}
        <span class="name">${escapeHtml(r.name)}</span>
        ${kmHtml}
      </li>`;
    })
    .join('');
}

function renderUI() {
  const $tabsEl = document.getElementById('tabs');
  const $contentsEl = document.getElementById('month-contents');
  const $annualSection = document.getElementById('annual-section');
  const $annualTotal = document.getElementById('annual-total');
  const $annualList = document.getElementById('annual-list');
  const $loading = document.getElementById('loading');

  if ($loading) $loading.style.display = 'none';

  // Tabs
  $tabsEl.innerHTML = state.months
    .map((m) => {
      const active = m.month === activeMonth ? ' active' : '';
      return `<button class="tab${active}" data-month="${escapeHtml(m.month)}">${escapeHtml(m.monthName)}</button>`;
    })
    .join('');

  // Month contents
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const isLastDay = isLastDayOfCurrentMonth();

  $contentsEl.innerHTML = state.months
    .map((m) => {
      const active = m.month === activeMonth ? 'active' : '';

      return `
        <div id="content-${m.month}" class="month-content ${active}">
          ${shouldShowWinners(m.month, currentMonth, isLastDay) ? renderMonthWinnerCard(m.female, m.male) : ''}
          <div class="section">
            <div class="section-header">🏃‍♀️ Feminino</div>
            <ul class="runner-list">${renderRows(m.female)}</ul>
            ${renderTotalMonth(m.female)}
          </div>
          <div class="section">
            <div class="section-header">🏃‍♂️ Masculino</div>
            <ul class="runner-list">${renderRows(m.male)}</ul>
            ${renderTotalMonth(m.male)}
          </div>
        </div>
      `;
    })
    .join('');

  monthElements.clear();
  $tabsEl.querySelectorAll('.tab').forEach(($tab) => {
    const month = Number($tab.dataset.month);
    monthElements.set(month, {
      tab: $tab,
      content: document.getElementById(`content-${month}`),
    });
    $tab.addEventListener('click', () => switchTab(month));
  });

  // Annual
  $annualList.innerHTML = renderRows(state.annual);
  $annualSection.querySelector('.section-header').textContent = `🏆 Ranking Anual ${state.year}`;
  $annualSection.classList.add('show');
  $annualTotal.innerHTML = renderTotal(state.totalAnnual);

  updateTitle();
}

function updateTitle() {
  const titleEl = document.getElementById('title');
  if (titleEl) titleEl.innerHTML = `R&T Clube de Corrida - Ranking Endurance ${state.year}`;
}

function switchTab(month) {
  const monthNum = Number(month);
  activeMonth = monthNum;
  monthElements.forEach(({ tab, content }, m) => {
    tab.classList.toggle('active', m === month);
    if (content) content.classList.toggle('active', m === month);
  });
  updateTitle();
}

function buildMonthMarkdown(m) {
  const monthUpper = m.monthName.toUpperCase();
  const section = (runners) => {
    return runners
      .filter((r) => r.km > 0)
      .map((r) => {
        return r.position + '. ' + medal(r.position) + r.name + ' - ' + formatKm(r.km);
      })
      .join('\n');
  };
  return [
    '*RANKING ENDURANCE - ' + monthUpper + ' ' + state.year + '*',
    // '*Visualize o ranking online:* ' + RANKING_ONLINE_URL,
    '',
    '*feminino* 🏃‍♀️',
    section(m.female),
    '',
    '*masculino* 🏃‍♂️',
    section(m.male),
  ].join('\n');
}

function buildAnnualMarkdown() {
  const section = state.annual
    .filter((r) => r.km > 0)
    .map((r) => {
      return r.position + '. ' + medal(r.position) + r.name + ' - ' + formatKm(r.km);
    })
    .join('\n');
  return `\n*RANKING ANUAL - ${state.year}* 🏆 🏅\n${section}\n`;
}

function setWhatsappEnabled(value) {
  window.localStorage.setItem('whatsappEnabled', value ? 'true' : 'false');
  showCopyButton();
}

function showCopyButton() {
  const $copyButton = document.querySelector('.copy-btn');
  if (!$copyButton) return;
  const isEnabled = window.localStorage.getItem('whatsappEnabled') === 'true';
  $copyButton.style.display = isEnabled ? 'block' : 'none';
}

function copyToWhatsApp() {
  const m = state.months.find((m) => m.month === activeMonth);
  if (!m) return;
  const text = buildMonthMarkdown(m) + '\n' + buildAnnualMarkdown();
  navigator.clipboard
    .writeText(text)
    .then(showToast)
    .catch(() => {
      //fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast();
    });
}

function showToast() {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }
}

function getEffectiveTheme() {
  const stored = window.localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.setAttribute('data-theme', 'light');
  }

  if ($btnToggleTheme) $btnToggleTheme.textContent = theme === 'dark' ? '☀️' : '🌕';
}

function toggleTheme() {
  const current = getEffectiveTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  window.localStorage.setItem('theme', next);
  applyTheme(next);
}

async function init() {
  applyTheme(getEffectiveTheme());

  if ($btnToggleTheme) {
    $btnToggleTheme.addEventListener('click', toggleTheme);
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!window.localStorage.getItem('theme')) {
      applyTheme(getEffectiveTheme());
    }
  });

  if (window.localStorage.getItem('whatsappEnabled') === null) {
    window.localStorage.setItem('whatsappEnabled', 'false');
  }
  showCopyButton();
  window.addEventListener('storage', (event) => {
    if (event.key === 'whatsappEnabled') {
      showCopyButton();
    }
  });

  try {
    const [manifest, runners] = await Promise.all([
      fetchJson(`${API_BASE}/api/manifest`),
      fetchJson(`${API_BASE}/api/runners`),
    ]);

    state.year = manifest.year;
    activeMonth = manifest.currentMonth;

    const hasCurrentMonth = manifest.months.some((m) => m.month === activeMonth);
    if (!hasCurrentMonth && manifest.months.length > 0) {
      activeMonth = manifest.months[manifest.months.length - 1].month;
    }

    const monthsRaw = await Promise.all(
      manifest.months.map(async (m) => {
        const [femaleRaw, maleRaw] = await Promise.all([
          fetchJson(`${API_BASE}/api/data/${state.year}/${m.slug}/female`),
          fetchJson(`${API_BASE}/api/data/${state.year}/${m.slug}/male`),
        ]);
        return {
          month: m.month,
          slug: m.slug,
          monthName: m.monthName,
          femaleRaw,
          maleRaw,
        };
      }),
    );

    state.months = monthsRaw.map((m) => ({
      month: m.month,
      slug: m.slug,
      monthName: m.monthName,
      female: calcRanking(runners.female, m.femaleRaw),
      male: calcRanking(runners.male, m.maleRaw),
      femaleRaw: m.femaleRaw,
      maleRaw: m.maleRaw,
    }));

    const allRaw = monthsRaw.map((m) => ({ female: m.femaleRaw, male: m.maleRaw }));
    state.annual = calcAnnualRanking(allRaw, runners);
    state.totalAnnual = calcTotal(allRaw);

    renderUI();
  } catch (err) {
    console.error(err);
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.textContent = 'Erro ao carregar dados: ' + err.message;
  }
}

init();
