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
      var rec = data.find(function (d) {
        return d.name.toLowerCase() === name.toLowerCase();
      });
      var km = rec
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
  var totals = {};

  allMonthsData.forEach(function (monthData) {
    [].concat(monthData.female, monthData.male).forEach(function (record) {
      var key = record.name.toLowerCase();
      var sum = record.km.reduce(function (a, b) {
        return a + b;
      }, 0);
      totals[key] = (totals[key] || 0) + sum;
    });
  });

  var allNames = [].concat(runners.female, runners.male);
  var nameMap = {};
  allNames.forEach(function (n) {
    nameMap[n.toLowerCase()] = n;
  });
  allNames.forEach(function (n) {
    var key = n.toLowerCase();
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
      var m = medal(r.position);
      var medalHtml = m ? '<span class="medal">' + m + "</span>" : "";
      var kmHtml =
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
  var tabsEl = document.getElementById("tabs");
  var contentsEl = document.getElementById("month-contents");
  var annualSection = document.getElementById("annual-section");
  var annualList = document.getElementById("annual-list");
  var loading = document.getElementById("loading");

  loading.style.display = "none";

  // Tabs
  tabsEl.innerHTML = state.months
    .map(function (m) {
      var active = m.month === activeMonth ? " active" : "";
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
  contentsEl.innerHTML = state.months
    .map(function (m) {
      var active = m.month === activeMonth ? " active" : "";
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
  annualList.innerHTML = renderRows(state.annual);
  annualSection.querySelector(".section-header").textContent =
    "🏆 Ranking Anual " + state.year;
  annualSection.style.display = "block";

  updateTitle();
}

function updateTitle() {
  var m = state.months.find(function (m) {
    return m.month === activeMonth;
  });
  var monthName = m ? m.monthName : "";
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
  var content = document.getElementById("content-" + month);
  if (content) content.classList.add("active");
  var tab = document.querySelector('[data-month="' + month + '"]');
  if (tab) tab.classList.add("active");
  updateTitle();
}

function buildMonthMarkdown(m) {
  var monthUpper = m.monthName.toUpperCase();
  var section = function (runners) {
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
    "",
    "*feminino* 🏃‍♀️",
    section(m.female),
    "",
    "*masculino* 🏃‍♂️",
    section(m.male),
  ].join("\n");
}

function buildAnnualMarkdown() {
  var section = state.annual
    .map(function (r) {
      return (
        r.position + ". " + medal(r.position) + r.name + " - " + formatKm(r.km)
      );
    })
    .join("\n");
  return "\n*RANKING ANUAL - " + state.year + "* 🏆 🏅\n" + section + "\n";
}

function copyToWhatsApp() {
  var m = state.months.find(function (m) {
    return m.month === activeMonth;
  });
  if (!m) return;
  var text = buildMonthMarkdown(m) + buildAnnualMarkdown();
  navigator.clipboard
    .writeText(text)
    .then(showToast)
    .catch(function () {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast();
    });
}

function showToast() {
  var toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(function () {
    toast.classList.remove("show");
  }, 2000);
}

// Inicialização
(function init() {
  Promise.all([
    fetch("data/manifest.json").then(function (r) {
      return r.json();
    }),
    fetch("data/runners.json").then(function (r) {
      return r.json();
    }),
  ])
    .then(function (results) {
      var manifest = results[0];
      var runners = results[1];

      state.year = manifest.year;
      activeMonth = manifest.currentMonth;

      // Verifica se o mês atual tem dados; se não, usa o último disponível
      var hasCurrentMonth = manifest.months.some(function (m) {
        return m.month === activeMonth;
      });
      if (!hasCurrentMonth && manifest.months.length > 0) {
        activeMonth = manifest.months[manifest.months.length - 1].month;
      }

      return Promise.all(
        manifest.months.map(function (m) {
          return Promise.all([
            fetch("data/female-" + m.slug + ".json")
              .then(function (r) {
                return r.json();
              })
              .catch(function () {
                return [];
              }),
            fetch("data/male-" + m.slug + ".json")
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

        var allRaw = monthsRaw.map(function (m) {
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
