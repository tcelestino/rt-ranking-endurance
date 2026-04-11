const API_BASE = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:3001"
  : "https://rt-ranking-endurance-api.onrender.com";

const RANKING_ONLINE_URL = "https://rt-ranking-endurance.onrender.com";

let activeMonth = null;
let state = { months: [], annual: [], year: null };

function medal(pos) {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return "";
}

function formatKm(km) {
  return km === 0 ? "0km" : km.toFixed(2) + "km";
}

function calcRanking(participants, data) {
  return participants
    .map(function (name) {
      const rec = data.find(function (d) {
        return d.name.toLowerCase() === name.toLowerCase();
      });
      const km = rec
        ? rec.km.reduce(function (a, b) {
            return a + b;
          }, 0)
        : 0;
      return { name: name, km: km };
    })
    .sort(function (a, b) {
      return b.km - a.km;
    })
    .map(function (r, i) {
      return Object.assign({}, r, { position: i + 1 });
    });
}

function calcAnnualRanking(allMonthsData, runners) {
  const totals = {};

  allMonthsData.forEach(function (monthData) {
    [].concat(monthData.female, monthData.male).forEach(function (record) {
      const key = record.name.toLowerCase();
      const sum = record.km.reduce(function (a, b) {
        return a + b;
      }, 0);
      totals[key] = (totals[key] || 0) + sum;
    });
  });

  const allNames = [].concat(runners.female, runners.male);
  const nameMap = {};
  allNames.forEach(function (n) {
    nameMap[n.toLowerCase()] = n;
  });
  allNames.forEach(function (n) {
    const key = n.toLowerCase();
    if (!(key in totals)) totals[key] = 0;
  });

  return Object.keys(totals)
    .map(function (key) {
      return { name: nameMap[key] || key, km: totals[key] };
    })
    .sort(function (a, b) {
      return b.km - a.km;
    })
    .map(function (r, i) {
      return Object.assign({}, r, { position: i + 1 });
    });
}

function renderRows(runners) {
  return runners
    .map(function (r) {
      const m = medal(r.position);
      const medalHtml = m ? '<span class="medal">' + m + "</span>" : "";
      const kmHtml =
        r.km === 0
          ? '<span class="zero">0km</span>'
          : '<span class="km">' + r.km.toFixed(2) + "km</span>";
      return (
        '<li class="runner' +
        (r.km === 0 ? " no-km" : "") +
        '">' +
        '<span class="pos">' +
        r.position +
        ".</span>" +
        medalHtml +
        '<span class="name">' +
        r.name +
        "</span>" +
        kmHtml +
        "</li>"
      );
    })
    .join("");
}

function renderUI() {
  const $tabsEl = document.getElementById("tabs");
  const $contentsEl = document.getElementById("month-contents");
  const $annualSection = document.getElementById("annual-section");
  const $annualList = document.getElementById("annual-list");
  const $loading = document.getElementById("loading");

  $loading.style.display = "none";

  // Tabs
  $tabsEl.innerHTML = state.months
    .map(function (m) {
      const active = m.month === activeMonth ? " active" : "";
      return (
        '<button class="tab' +
        active +
        '" data-month="' +
        m.month +
        '" onclick="switchTab(' +
        m.month +
        ')">' +
        m.monthName +
        "</button>"
      );
    })
    .join("");

  // Month contents
  $contentsEl.innerHTML = state.months
    .map(function (m) {
      const active = m.month === activeMonth ? " active" : "";
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
        "</ul>" +
        "</div>" +
        '<div class="section">' +
        '<div class="section-header">🏃‍♂️ Masculino</div>' +
        '<ul class="runner-list">' +
        renderRows(m.male) +
        "</ul>" +
        "</div>" +
        "</div>"
      );
    })
    .join("");

  // Annual
  $annualList.innerHTML = renderRows(state.annual);
  $annualSection.querySelector(".section-header").textContent =
    "🏆 Ranking Anual " + state.year;
  $annualSection.style.display = "block";

  updateTitle();
}

function updateTitle() {
  const m = state.months.find(function (m) {
    return m.month === activeMonth;
  });
  const monthName = m ? m.monthName : "";
  document.getElementById("title").innerHTML =
    "R&T Clube de Corrida - Ranking Endurance<br>" +
    monthName +
    " " +
    state.year;
}

function switchTab(month) {
  activeMonth = month;
  document.querySelectorAll(".month-content").forEach(function (el) {
    el.classList.remove("active");
  });
  document.querySelectorAll(".tab").forEach(function (el) {
    el.classList.remove("active");
  });
  const content = document.getElementById("content-" + month);
  if (content) content.classList.add("active");
  const tab = document.querySelector('[data-month="' + month + '"]');
  if (tab) tab.classList.add("active");
  updateTitle();
}

function buildMonthMarkdown(m) {
  const monthUpper = m.monthName.toUpperCase();
  const section = function (runners) {
    return runners
      .map(function (r) {
        return (
          r.position +
          ". " +
          medal(r.position) +
          r.name +
          " - " +
          formatKm(r.km)
        );
      })
      .join("\n");
  };
  return [
    "*RANKING ENDURANCE - " + monthUpper + " " + state.year + "*",
    "*Visualize o ranking online:* " + RANKING_ONLINE_URL,
    "",
    "*feminino* 🏃‍♀️",
    section(m.female),
    "",
    "*masculino* 🏃‍♂️",
    section(m.male),
  ].join("\n");
}

function buildAnnualMarkdown() {
  const section = state.annual
    .map(function (r) {
      return (
        r.position + ". " + medal(r.position) + r.name + " - " + formatKm(r.km)
      );
    })
    .join("\n");
  return "\n*RANKING ANUAL - " + state.year + "* 🏆 🏅\n" + section + "\n";
}

function setWhatsappEnabled(value) {
  window.localStorage.setItem("whatsappEnabled", value ? "true" : "false");
  showCopyButton();
}

function showCopyButton() {
  const $copyButton = document.querySelector(".copy-btn");
  const isEnabled = window.localStorage.getItem("whatsappEnabled") === "true";
  $copyButton.style.display = isEnabled ? "block" : "none";
}

function copyToWhatsApp() {
  const m = state.months.find(function (m) {
    return m.month === activeMonth;
  });
  if (!m) return;
  const text = buildMonthMarkdown(m) + buildAnnualMarkdown();
  navigator.clipboard
    .writeText(text)
    .then(showToast)
    .catch(function () {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast();
    });
}

function showToast() {
  const toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(function () {
    toast.classList.remove("show");
  }, 2000);
}

function getEffectiveTheme() {
  const stored = window.localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.setAttribute("data-theme", "light");
  }
  const $btn = document.getElementById("theme-toggle");
  if ($btn) $btn.textContent = theme === "dark" ? "☀️" : "🌕";
}

function toggleTheme() {
  const current = getEffectiveTheme();
  const next = current === "dark" ? "light" : "dark";
  window.localStorage.setItem("theme", next);
  applyTheme(next);
}

(function init() {
  applyTheme(getEffectiveTheme());
  document
    .getElementById("theme-toggle")
    .addEventListener("click", toggleTheme);

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (!window.localStorage.getItem("theme")) {
        applyTheme(getEffectiveTheme());
      }
    });

  if (window.localStorage.getItem("whatsappEnabled") === null) {
    window.localStorage.setItem("whatsappEnabled", "false");
  }
  showCopyButton();
  window.addEventListener("storage", function (event) {
    if (event.key === "whatsappEnabled") {
      showCopyButton();
    }
  });
  Promise.all([
    fetch(API_BASE + "/api/manifest").then(function (r) {
      return r.json();
    }),
    fetch(API_BASE + "/api/runners").then(function (r) {
      return r.json();
    }),
  ])
    .then(function (results) {
      const manifest = results[0];
      const runners = results[1];

      state.year = manifest.year;
      activeMonth = manifest.currentMonth;

      const hasCurrentMonth = manifest.months.some(function (m) {
        return m.month === activeMonth;
      });
      if (!hasCurrentMonth && manifest.months.length > 0) {
        activeMonth = manifest.months[manifest.months.length - 1].month;
      }

      return Promise.all(
        manifest.months.map(function (m) {
          return Promise.all([
            fetch(API_BASE + "/api/data/" + m.slug + "/female")
              .then(function (r) {
                return r.json();
              })
              .catch(function () {
                return [];
              }),
            fetch(API_BASE + "/api/data/" + m.slug + "/male")
              .then(function (r) {
                return r.json();
              })
              .catch(function () {
                return [];
              }),
          ]).then(function (data) {
            return {
              month: m.month,
              slug: m.slug,
              monthName: m.monthName,
              femaleRaw: data[0],
              maleRaw: data[1],
            };
          });
        }),
      ).then(function (monthsRaw) {
        state.months = monthsRaw.map(function (m) {
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

        const allRaw = monthsRaw.map(function (m) {
          return { female: m.femaleRaw, male: m.maleRaw };
        });
        state.annual = calcAnnualRanking(allRaw, runners);

        renderUI();
      });
    })
    .catch(function (err) {
      document.getElementById("loading").textContent =
        "Erro ao carregar dados: " + err.message;
    });
})();
