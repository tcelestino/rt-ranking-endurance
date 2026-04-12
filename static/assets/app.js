const API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://localhost:3001'
  : 'https://rt-ranking-endurance-api.onrender.com';

const RANKING_ONLINE_URL = 'https://rt-ranking-endurance.onrender.com';

let activeMonth = null;
let state = { months: [], annual: [], year: null, totalAnnual: 0 };

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

function shouldShowWinners(monthNum) {
  const currentMonth = new Date().getMonth() + 1;
  if (monthNum < currentMonth) return true;
  if (monthNum === currentMonth) return isLastDayOfCurrentMonth();
  return false;
}

function formatKm(km) {
  return km === 0 ? '0km' : km.toFixed(2) + 'km';
}

function calcRanking(participants, data) {
  return participants
    .map((name) => {
      const searchName = name.toLowerCase();
      const rec = data.find((d) => d.name.toLowerCase() === searchName);
      const km = rec ? rec.km.reduce((a, b) => a + b, 0) : 0;
      return { name: name, km: km };
    })
    .sort((a, b) => b.km - a.km)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

function calcAnnualRanking(allMonthsData, runners) {
  const totals = {};

  allMonthsData.forEach((monthData) => {
    [...monthData.female, ...monthData.male].forEach((record) => {
      const key = record.name.toLowerCase();
      const sum = record.km.reduce((a, b) => a + b, 0);
      totals[key] = (totals[key] || 0) + sum;
    });
  });

  const allNames = [...runners.female, ...runners.male];
  const nameMap = {};
  allNames.forEach((n) => {
    nameMap[n.toLowerCase()] = n;
  });
  allNames.forEach((n) => {
    const key = n.toLowerCase();
    if (!(key in totals)) totals[key] = 0;
  });

  return Object.keys(totals)
    .map((key) => ({ name: nameMap[key] || key, km: totals[key] }))
    .sort((a, b) => b.km - a.km)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

function calcTotal(allMonthsData) {
  let total = 0;

  allMonthsData.forEach((monthData) => {
    [...monthData.female, ...monthData.male].forEach((record) => {
      const sum = record.km.reduce((a, b) => a + b, 0);
      total += sum;
    });
  });

  return total;
}

function renderTotal(total) {
  return (
    '<div class="total">' +
    '<span class="total-label">Total:</span>' +
    '<span class="total-value km">' +
    formatKm(total) +
    '</span>' +
    '</div>'
  );
}

function renderTotalMonth(runners) {
  const total = runners.reduce((sum, r) => sum + r.km, 0);
  return renderTotal(total);
}

function renderMonthWinnerCard(female, male) {
  const f = female[0];
  const m = male[0];
  if (!f || !m) return '';
  return (
    '<div class="winner-cards">' +
    '<div class="section">' +
    '<div class="section-header">🎉 Vencedora do Mês</div>' +
    '<div class="winner-row">' +
    '<span class="name">' + f.name + '</span>' +
    '<span class="km">' + formatKm(f.km) + '</span>' +
    '</div>' +
    '</div>' +
    '<div class="section">' +
    '<div class="section-header">🎉 Vencedor do Mês</div>' +
    '<div class="winner-row">' +
    '<span class="name">' + m.name + '</span>' +
    '<span class="km">' + formatKm(m.km) + '</span>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderRows(runners) {
  return runners
    .map((r) => {
      const m = medal(r.position);
      const medalHtml = m ? '<span class="medal">' + m + '</span>' : '';
      const kmHtml = r.km === 0 ? '<span class="zero">0km</span>' : '<span class="km">' + r.km.toFixed(2) + 'km</span>';
      return (
        '<li class="runner' +
        (r.km === 0 ? ' no-km' : '') +
        '">' +
        '<span class="pos">' +
        r.position +
        '.</span>' +
        medalHtml +
        '<span class="name">' +
        r.name +
        '</span>' +
        kmHtml +
        '</li>'
      );
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

  $loading.style.display = 'none';

  // Tabs
  $tabsEl.innerHTML = state.months
    .map((m) => {
      const active = m.month === activeMonth ? ' active' : '';
      return (
        '<button class="tab' +
        active +
        '" data-month="' +
        m.month +
        '" onclick="switchTab(' +
        m.month +
        ')">' +
        m.monthName +
        '</button>'
      );
    })
    .join('');

  // Month contents
  $contentsEl.innerHTML = state.months
    .map((m) => {
      const active = m.month === activeMonth ? ' active' : '';
      return (
        '<div id="content-' +
        m.month +
        '" class="month-content' +
        active +
        '">' +
        (shouldShowWinners(m.month) ? renderMonthWinnerCard(m.female, m.male) : '') +
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

  // Annual
  $annualList.innerHTML = renderRows(state.annual);
  $annualSection.querySelector('.section-header').textContent = '🏆 Ranking Anual ' + state.year;
  $annualSection.classList.add('show');
  $annualTotal.innerHTML = renderTotal(state.totalAnnual);

  updateTitle();
}

function updateTitle() {
  const m = state.months.find((m) => m.month === activeMonth);
  const monthName = m ? m.monthName : '';
  document.getElementById('title').innerHTML =
    'R&T Clube de Corrida - Ranking Endurance<br>' + monthName + ' ' + state.year;
}

function switchTab(month) {
  activeMonth = month;
  document.querySelectorAll('.month-content').forEach((el) => {
    el.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.remove('active');
  });
  const content = document.getElementById('content-' + month);
  if (content) content.classList.add('active');
  const tab = document.querySelector('[data-month="' + month + '"]');
  if (tab) tab.classList.add('active');
  updateTitle();
}

function buildMonthMarkdown(m) {
  const monthUpper = m.monthName.toUpperCase();
  const section = (runners) => {
    return runners
      .map((r) => {
        return r.position + '. ' + medal(r.position) + r.name + ' - ' + formatKm(r.km);
      })
      .join('\n');
  };
  return [
    '*RANKING ENDURANCE - ' + monthUpper + ' ' + state.year + '*',
    '*Visualize o ranking online:* ' + RANKING_ONLINE_URL,
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
    .map((r) => {
      return r.position + '. ' + medal(r.position) + r.name + ' - ' + formatKm(r.km);
    })
    .join('\n');
  return '\n*RANKING ANUAL - ' + state.year + '* 🏆 🏅\n' + section + '\n';
}

function setWhatsappEnabled(value) {
  window.localStorage.setItem('whatsappEnabled', value ? 'true' : 'false');
  showCopyButton();
}

function showCopyButton() {
  const $copyButton = document.querySelector('.copy-btn');
  const isEnabled = window.localStorage.getItem('whatsappEnabled') === 'true';
  $copyButton.style.display = isEnabled ? 'block' : 'none';
}

function copyToWhatsApp() {
  const m = state.months.find((m) => m.month === activeMonth);
  if (!m) return;
  const text = buildMonthMarkdown(m) + buildAnnualMarkdown();
  navigator.clipboard
    .writeText(text)
    .then(showToast)
    .catch(() => {
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
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
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

(function init() {
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

  Promise.all([
    fetch(API_BASE + '/api/manifest').then((r) => r.json()),
    fetch(API_BASE + '/api/runners').then((r) => r.json()),
  ])
    .then((results) => {
      const manifest = results[0];
      const runners = results[1];

      state.year = manifest.year;
      activeMonth = manifest.currentMonth;

      const hasCurrentMonth = manifest.months.some((m) => m.month === activeMonth);
      if (!hasCurrentMonth && manifest.months.length > 0) {
        activeMonth = manifest.months[manifest.months.length - 1].month;
      }

      return Promise.all(
        manifest.months.map(async (m) => {
          const data = await Promise.all([
            fetch(API_BASE + '/api/data/' + m.slug + '/female')
              .then((r) => r.json())
              .catch(() => {
                return [];
              }),
            fetch(API_BASE + '/api/data/' + m.slug + '/male')
              .then((r) => r.json())
              .catch(() => {
                return [];
              }),
          ]);
          return {
            month: m.month,
            slug: m.slug,
            monthName: m.monthName,
            femaleRaw: data[0],
            maleRaw: data[1],
          };
        }),
      ).then((monthsRaw) => {
        state.months = monthsRaw.map((m) => {
          return {
            month: m.month,
            slug: m.slug,
            monthName: m.monthName,
            female: calcRanking(runners.female, m.femaleRaw),
            male: calcRanking(runners.male, m.maleRaw),
            femaleRaw: m.femaleRaw,
            maleRaw: m.maleRaw,
          };
        });

        const allRaw = monthsRaw.map((m) => {
          return { female: m.femaleRaw, male: m.maleRaw };
        });
        state.annual = calcAnnualRanking(allRaw, runners);
        state.totalAnnual = calcTotal(allRaw);

        renderUI();
      });
    })
    .catch((err) => {
      document.getElementById('loading').textContent = 'Erro ao carregar dados: ' + err.message;
    });
})();
