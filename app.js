(function () {
  "use strict";

  var STORAGE_KEY = "ledger-tracker-v1";

  var DEFAULT_DATA = {
    salaryUSD: 1500,
    rate: 58,
    accounts: [
      { id: "a1", name: "Pag-IBIG Housing Loan", type: "loan", monthly: 8433.55, dueDay: 21, total: 1548120, term: 360, start: "2026-06", paid: 2 },
      { id: "a2", name: "Phirst Park Homes — Loan Diff.", type: "loan", monthly: 10050.77, dueDay: 30, total: 241218.45, term: 24, start: "2026-03", paid: 4 },
      { id: "a3", name: "Construction Loan (Parents)", type: "loan", monthly: 4144, dueDay: 16, total: 49728, term: 12, start: "2026-02", paid: 5 },
      { id: "a4", name: "Parent's Allowance", type: "recurring", monthly: 10000, dueDay: 11 }
    ]
  };

  var state = null;
  var ui = { expandedId: null, showAdd: false, showSettings: false, addType: "loan", view: "accounts" };

  // ---------- persistence ----------
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---------- formatting ----------
  function peso(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return "\u20B1" + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pesoShort(n) {
    var v = Math.round(Number(n) || 0);
    return "\u20B1" + v.toLocaleString("en-PH");
  }
  function ordinal(n) {
    n = Number(n);
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function monthLabel(d) {
    return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
  }
  function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1);
  }
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // ---------- IndexedDB (receipt screenshots) ----------
  var DB_NAME = "ledger-receipts-db", DB_STORE = "receipts";
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          var store = db.createObjectStore(DB_STORE, { keyPath: "id" });
          store.createIndex("accountId", "accountId", { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function addReceipt(accountId, dataUrl) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        var rec = { id: "r" + Date.now() + Math.random().toString(36).slice(2, 7), accountId: accountId, dataUrl: dataUrl, addedAt: Date.now() };
        tx.objectStore(DB_STORE).add(rec);
        tx.oncomplete = function () { resolve(rec); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function getReceipts(accountId) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var idx = tx.objectStore(DB_STORE).index("accountId");
        var req = idx.getAll(accountId);
        req.onsuccess = function () {
          var list = req.result || [];
          list.sort(function (a, b) { return b.addedAt - a.addedAt; });
          resolve(list);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function deleteReceipt(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // ---------- due-date math ----------
  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // Remaining balance approximated proportionally to payments completed vs term.
  // (Straight cash-paid subtraction breaks down for interest-bearing loans like
  // Pag-IBIG once projected many years out, since payments include interest.)
  function loanRemaining(a, paidCount) {
    var term = Number(a.term) || 1;
    var frac = Math.min(1, Math.max(0, Number(paidCount)) / term);
    return Math.max(0, Number(a.total) * (1 - frac));
  }
  function nextOccurrence(now, dueDay) {
    var y = now.getFullYear(), m = now.getMonth();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var day = Math.min(Number(dueDay), daysInMonth);
    var candidate = new Date(y, m, day);
    if (candidate < stripTime(now)) {
      var nm = (m + 1) % 12, ny = m === 11 ? y + 1 : y;
      var daysInNext = new Date(ny, nm + 1, 0).getDate();
      candidate = new Date(ny, nm, Math.min(Number(dueDay), daysInNext));
    }
    return candidate;
  }
  function activeAccountsForReminders() {
    return state.accounts.filter(function (a) {
      return a.type === "recurring" || Number(a.paid) < Number(a.term);
    });
  }

  // ---------- summary view ----------
  function overallTotals() {
    var totalBorrowed = 0, totalPaidSoFar = 0, totalRemaining = 0;
    var latestPayoff = null;
    var now = new Date();
    state.accounts.forEach(function (a) {
      if (a.type !== "loan") return;
      totalBorrowed += Number(a.total);
      totalPaidSoFar += Number(a.paid) * Number(a.monthly);
      totalRemaining += loanRemaining(a, a.paid);
      var remainingPayments = Math.max(0, Number(a.term) - Number(a.paid));
      if (remainingPayments > 0) {
        var payoff = addMonths(now, remainingPayments - 1);
        if (!latestPayoff || payoff > latestPayoff) latestPayoff = payoff;
      }
    });
    return { totalBorrowed: totalBorrowed, totalPaidSoFar: totalPaidSoFar, totalRemaining: totalRemaining, debtFreeDate: latestPayoff };
  }

  function buildYearlyProjection() {
    var now = new Date();
    var horizon = 1;
    state.accounts.forEach(function (a) {
      if (a.type === "loan") horizon = Math.max(horizon, Math.max(0, Number(a.term) - Number(a.paid)));
    });
    var yearMap = {}, order = [];
    for (var i = 0; i < horizon; i++) {
      var d = addMonths(now, i), y = d.getFullYear();
      if (!yearMap[y]) { yearMap[y] = { total: 0, remainingAtEnd: 0, compParts: [] }; order.push(y); }
      var monthTotal = 0, compParts = [];
      state.accounts.forEach(function (a) {
        if (a.type === "recurring") {
          monthTotal += Number(a.monthly);
          compParts.push(a.id);
        } else {
          var paymentNo = Number(a.paid) + i + 1;
          if (paymentNo <= Number(a.term)) { monthTotal += Number(a.monthly); compParts.push(a.id); }
        }
      });
      yearMap[y].total += monthTotal;
      yearMap[y].compParts = compParts.slice().sort();
      var remainSum = 0;
      state.accounts.forEach(function (a) {
        if (a.type !== "loan") return;
        var paidCount = Math.min(Number(a.term), Number(a.paid) + i + 1);
        remainSum += loanRemaining(a, paidCount);
      });
      yearMap[y].remainingAtEnd = remainSum;
    }
    var rows = [];
    order.forEach(function (y) {
      var yr = yearMap[y];
      var key = Math.round(yr.total) + "|" + yr.compParts.join(",");
      var last = rows[rows.length - 1];
      if (last && last.key === key) {
        last.endYear = y;
        last.endRemaining = yr.remainingAtEnd;
      } else {
        rows.push({ startYear: y, endYear: y, total: yr.total, endRemaining: yr.remainingAtEnd, key: key });
      }
    });
    return rows;
  }

  function renderSummary() {
    var t = overallTotals();
    var totalsEl = document.getElementById("summary-totals");
    var debtFreeLabel = t.debtFreeDate ? monthLabel(t.debtFreeDate) : "All loans paid off";
    totalsEl.innerHTML =
      '<div class="summary-grid">' +
      statHtml("Total borrowed", pesoShort(t.totalBorrowed)) +
      statHtml("Paid so far", pesoShort(t.totalPaidSoFar)) +
      statHtml("Remaining", pesoShort(t.totalRemaining)) +
      statHtml("Debt-free by", debtFreeLabel) +
      "</div>" +
      '<div class="toolbar-note">Remaining-balance figures are approximate for interest-bearing loans (like Pag-IBIG) since only the payment count is tracked exactly, not the real amortization schedule.</div>';

    var rows = buildYearlyProjection();
    var yearlyEl = document.getElementById("summary-yearly");
    var html = '<table class="year-table"><thead><tr><th>Year</th><th>Paid that year</th><th>Remaining by year-end</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var label = r.startYear === r.endYear ? String(r.startYear) : (r.startYear + "\u2013" + r.endYear);
      html += "<tr><td class=\"year-label\">" + esc(label) + "</td><td>" + esc(pesoShort(r.total)) + (r.startYear !== r.endYear ? "/yr" : "") + "</td><td>" + esc(pesoShort(r.endRemaining)) + "</td></tr>";
    });
    html += "</tbody></table>";
    yearlyEl.innerHTML = html;
  }
  function statHtml(label, value) {
    return '<div class="summary-stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + esc(value) + "</div></div>";
  }

  // ---------- ICS calendar export ----------
  function pad2(n) { return String(n).padStart(2, "0"); }
  function icsDateTime(y, m, d, h, mi) {
    return "" + y + pad2(m) + pad2(d) + "T" + pad2(h) + pad2(mi) + "00";
  }
  function icsEscape(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
  }
  function buildICS() {
    var now = new Date();
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ledger Tracker//EN", "CALSCALE:GREGORIAN"];
    activeAccountsForReminders().forEach(function (a) {
      var dueDay = Math.max(1, Math.min(31, Number(a.dueDay) || 1));
      var start = nextOccurrence(now, dueDay);
      var dtstart = icsDateTime(start.getFullYear(), start.getMonth() + 1, start.getDate(), 9, 0);
      var dtstamp = icsDateTime(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes());
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + a.id + "@ledger-tracker");
      lines.push("DTSTAMP:" + dtstamp);
      lines.push("DTSTART:" + dtstart);
      lines.push("SUMMARY:Pay: " + icsEscape(a.name) + " (" + icsEscape(pesoShort(a.monthly)) + ")");
      lines.push("DESCRIPTION:" + icsEscape("Monthly payment of " + peso(a.monthly) + " due on the " + ordinal(a.dueDay) + "."));
      var rrule = "FREQ=MONTHLY;BYMONTHDAY=" + dueDay;
      if (a.type === "loan") {
        var remaining = Math.max(1, Number(a.term) - Number(a.paid));
        rrule += ";COUNT=" + remaining;
      }
      lines.push("RRULE:" + rrule);
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:Payment due in 2 days \u2014 " + icsEscape(a.name));
      lines.push("TRIGGER:-P2D");
      lines.push("END:VALARM");
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:Payment due today \u2014 " + icsEscape(a.name));
      lines.push("TRIGGER:PT0M");
      lines.push("END:VALARM");
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function downloadICS() {
    var ics = buildICS();
    var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "ledger-payment-reminders.ics";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---------- in-app upcoming banner + notifications ----------
  function computeUpcoming() {
    var now = new Date(), today = stripTime(now), items = [];
    activeAccountsForReminders().forEach(function (a) {
      var due = nextOccurrence(now, a.dueDay);
      var daysUntil = Math.round((due - today) / 86400000);
      if (daysUntil === 0 || daysUntil === 2) {
        items.push({ name: a.name, monthly: a.monthly, daysUntil: daysUntil });
      }
    });
    return items;
  }
  function renderBanner() {
    var el = document.getElementById("upcoming-banner");
    var items = computeUpcoming();
    if (items.length === 0) { el.innerHTML = ""; return; }
    var dueToday = items.some(function (i) { return i.daysUntil === 0; });
    var html = '<div class="upcoming-banner-inner' + (dueToday ? " due-today" : "") + '">';
    items.forEach(function (i) {
      html += '<div class="row"><span class="label">' + (i.daysUntil === 0 ? "Due today: " : "Due in 2 days: ") + esc(i.name) + '</span><span class="amt">' + esc(peso(i.monthly)) + "</span></div>";
    });
    html += "</div>";
    el.innerHTML = html;
    maybeNotify(items);
  }
  var notifiedKey = "ledger-notified-" + new Date().toDateString();
  function maybeNotify(items) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { if (sessionStorage.getItem(notifiedKey)) return; } catch (e) {}
    var body = items.map(function (i) {
      return (i.daysUntil === 0 ? "Due today: " : "Due in 2 days: ") + i.name + " (" + peso(i.monthly) + ")";
    }).join("\n");
    var show = function (reg) {
      if (reg && reg.showNotification) {
        reg.showNotification("Ledger — payment reminder", { body: body, icon: "icons/icon-192.png" });
      } else {
        try { new Notification("Ledger — payment reminder", { body: body }); } catch (e) {}
      }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(show).catch(function () { show(null); });
    } else {
      show(null);
    }
    try { sessionStorage.setItem(notifiedKey, "1"); } catch (e) {}
  }
  function enableNotifications() {
    if (!("Notification" in window)) {
      alert("Notifications aren't supported in this browser. Use the calendar download instead \u2014 it works everywhere.");
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm === "granted") { renderBanner(); }
      else alert("Notifications weren't enabled. The calendar download still works regardless.");
    });
  }

  // ---------- receipts UI ----------
  function renderReceiptsGallery(accountId) {
    var container = document.getElementById("gallery-" + accountId);
    if (!container) return;
    getReceipts(accountId).then(function (list) {
      if (!container) return;
      if (list.length === 0) {
        container.innerHTML = '<div class="receipts-empty">No screenshots saved yet.</div>';
        return;
      }
      var html = "";
      list.forEach(function (r) {
        html += '<div class="receipt-thumb" data-receipt="' + r.id + '"><img src="' + r.dataUrl + '" alt="Payment screenshot"><button class="del-receipt" data-del="' + r.id + '" aria-label="Delete">\u00D7</button></div>';
      });
      container.innerHTML = html;
      container.querySelectorAll(".receipt-thumb").forEach(function (thumb) {
        thumb.addEventListener("click", function (e) {
          if (e.target.classList.contains("del-receipt")) return;
          var img = thumb.querySelector("img");
          showLightbox(img.src);
        });
      });
      container.querySelectorAll(".del-receipt").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          deleteReceipt(btn.getAttribute("data-del")).then(function () { renderReceiptsGallery(accountId); });
        });
      });
    });
  }
  function showLightbox(src) {
    var lb = document.getElementById("lightbox");
    lb.innerHTML = '<button class="lightbox-close" id="lightbox-close-btn">\u00D7</button><img src="' + src + '">';
    lb.classList.remove("hidden");
    document.getElementById("lightbox-close-btn").onclick = function () { lb.classList.add("hidden"); lb.innerHTML = ""; };
    lb.onclick = function (e) { if (e.target === lb) { lb.classList.add("hidden"); lb.innerHTML = ""; } };
  }
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- derived data ----------
  function salaryPHP() { return (Number(state.salaryUSD) || 0) * (Number(state.rate) || 0); }
  function currentMonthly() {
    return state.accounts.reduce(function (sum, a) {
      if (a.type === "recurring") return sum + Number(a.monthly);
      var stillActive = Number(a.paid) < Number(a.term);
      return sum + (stillActive ? Number(a.monthly) : 0);
    }, 0);
  }
  function forecast() {
    var months = [], now = new Date();
    for (var i = 0; i < 18; i++) {
      var d = addMonths(now, i), total = 0;
      state.accounts.forEach(function (a) {
        if (a.type === "recurring") {
          total += Number(a.monthly);
        } else {
          var paymentNo = Number(a.paid) + i + 1;
          if (paymentNo <= Number(a.term)) total += Number(a.monthly);
        }
      });
      months.push({ label: monthLabel(d), net: salaryPHP() - total });
    }
    return months;
  }

  // ---------- mutations ----------
  function addAccount(acc) {
    acc.id = "a" + Date.now();
    state.accounts.push(acc);
    save();
    ui.showAdd = false;
    renderAll();
  }
  function removeAccount(id) {
    state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
    save();
    renderAll();
  }
  function patchAccount(id, patch) {
    state.accounts = state.accounts.map(function (a) {
      return a.id === id ? Object.assign({}, a, patch) : a;
    });
    save();
    renderAll();
  }
  function markPaid(id) {
    state.accounts = state.accounts.map(function (a) {
      if (a.id === id && a.type === "loan" && Number(a.paid) < Number(a.term)) {
        return Object.assign({}, a, { paid: Number(a.paid) + 1 });
      }
      return a;
    });
    save();
    renderAll();
  }

  // ---------- render: hero ----------
  function renderHero() {
    var salary = salaryPHP(), monthly = currentMonthly(), net = salary - monthly;
    var html = "";
    html += heroFigure("salary", salary, "var(--gold)", "$" + Number(state.salaryUSD).toLocaleString() + " \u00D7 " + state.rate);
    html += '<span class="hero-sep">\u2212</span>';
    html += heroFigure("obligations", monthly, "var(--rust)", state.accounts.length + " accounts");
    html += '<span class="hero-sep">=</span>';
    html += heroFigure("net remaining", net, "var(--teal-deep)", "this month", true);
    html += '<button class="lg-btn" id="settings-toggle-btn" style="margin-left:auto">Salary &amp; rate</button>';
    document.getElementById("hero-row").innerHTML = html;
    document.getElementById("settings-toggle-btn").onclick = function () {
      ui.showSettings = !ui.showSettings;
      document.getElementById("settings-panel").classList.toggle("hidden", !ui.showSettings);
    };
    document.getElementById("salary-usd").value = state.salaryUSD;
    document.getElementById("rate").value = state.rate;
    document.getElementById("salary-usd").oninput = function (e) {
      state.salaryUSD = e.target.value === "" ? "" : Number(e.target.value);
      save(); renderHero(); renderChart();
    };
    document.getElementById("rate").oninput = function (e) {
      state.rate = e.target.value === "" ? "" : Number(e.target.value);
      save(); renderHero(); renderChart();
    };
    document.getElementById("settings-panel").classList.toggle("hidden", !ui.showSettings);
  }
  function heroFigure(label, value, color, sub, big) {
    return '<div class="hero-figure' + (big ? " big" : "") + '">' +
      '<div class="fig-label">' + esc(label) + "</div>" +
      '<div class="fig-value" style="color:' + color + '">' + esc(pesoShort(value)) + "</div>" +
      '<div class="fig-sub">' + esc(sub) + "</div></div>";
  }

  // ---------- render: chart ----------
  function renderChart() {
    var data = forecast();
    var svg = document.getElementById("forecast-chart");
    var W = 600, H = 180, padTop = 12, padBottom = 12;
    var values = data.map(function (m) { return m.net; });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (min === max) { min -= 1; max += 1; }
    var innerH = H - padTop - padBottom;
    function xAt(i) { return (i / (data.length - 1)) * W; }
    function yAt(v) { return padTop + innerH - ((v - min) / (max - min)) * innerH; }

    var linePts = data.map(function (m, i) { return xAt(i) + "," + yAt(m.net); }).join(" L ");
    var areaPts = "M " + xAt(0) + "," + H + " L " + linePts.replace("M ", "").split(" L ").map(function(p,i){return p;}).join(" L ");
    var pathLine = "M " + linePts;
    var pathArea = "M " + xAt(0) + "," + (padTop + innerH) + " L " + linePts + " L " + xAt(data.length - 1) + "," + (padTop + innerH) + " Z";

    var svgHtml = "";
    svgHtml += '<defs><linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#2F6F62" stop-opacity="0.35"/>' +
      '<stop offset="100%" stop-color="#2F6F62" stop-opacity="0.03"/></linearGradient></defs>';
    svgHtml += '<path d="' + pathArea + '" fill="url(#netFill)" stroke="none"></path>';
    svgHtml += '<path d="' + pathLine + '" fill="none" stroke="#204E45" stroke-width="2.5" vector-effect="non-scaling-stroke"></path>';
    data.forEach(function (m, i) {
      svgHtml += '<circle cx="' + xAt(i) + '" cy="' + yAt(m.net) + '" r="2.2" fill="#204E45"><title>' + esc(m.label) + ": " + esc(pesoShort(m.net)) + '</title></circle>';
    });
    svg.innerHTML = svgHtml;

    var labelsHtml = "";
    data.forEach(function (m, i) {
      if (i % 3 === 0 || i === data.length - 1) labelsHtml += "<span>" + esc(m.label) + "</span>";
    });
    document.getElementById("chart-labels").innerHTML = labelsHtml;
  }

  // ---------- render: accounts ----------
  function renderAccounts() {
    var container = document.getElementById("accounts-list");
    if (state.accounts.length === 0) {
      container.innerHTML = '<div class="empty-note">No accounts yet — add a loan or recurring expense above.</div>';
      return;
    }
    var html = "";
    state.accounts.forEach(function (a) { html += accountCardHtml(a); });
    container.innerHTML = html;

    state.accounts.forEach(function (a) {
      var expandBtn = document.getElementById("expand-" + a.id);
      if (expandBtn) expandBtn.onclick = function () {
        ui.expandedId = ui.expandedId === a.id ? null : a.id;
        renderAccounts();
      };
      var markBtn = document.getElementById("mark-" + a.id);
      if (markBtn) markBtn.onclick = function () { markPaid(a.id); };
      var removeBtn = document.getElementById("remove-" + a.id);
      if (removeBtn) removeBtn.onclick = function () { removeAccount(a.id); };

      if (ui.expandedId === a.id) {
        bindDetailInputs(a);
        renderReceiptsGallery(a.id);
        var fileInput = document.getElementById("file-" + a.id);
        if (fileInput) {
          fileInput.onchange = function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            readFileAsDataURL(file).then(function (dataUrl) {
              return addReceipt(a.id, dataUrl);
            }).then(function () {
              renderReceiptsGallery(a.id);
            });
            e.target.value = "";
          };
        }
      }
    });
  }

  function accountCardHtml(a) {
    var isLoan = a.type === "loan";
    var remaining = isLoan ? loanRemaining(a, a.paid) : null;
    var pct = isLoan ? Math.min(1, Number(a.paid) / Number(a.term)) : 0;
    var segments = 24, filled = Math.round(pct * segments);
    var paidOff = isLoan && Number(a.paid) >= Number(a.term);
    var monogram = (a.name || "?").trim().charAt(0).toUpperCase() || "?";
    var expanded = ui.expandedId === a.id;

    var html = '<div class="lg-card account-card">';
    html += '<div class="account-top">';
    html += '<div class="account-icon">' + esc(monogram) + "</div>";
    html += '<div class="account-info">';
    html += '<div class="account-name">' + esc(a.name) + "</div>";
    html += '<div class="account-meta">' + esc(peso(a.monthly)) + " / mo \u00B7 due the " + esc(ordinal(a.dueDay));
    if (isLoan) html += " \u00B7 " + Math.max(0, Number(a.term) - Number(a.paid)) + " payments left";
    html += "</div></div>";
    html += '<div class="account-balance">';
    if (isLoan) {
      html += '<div class="amount ' + (paidOff ? "paidoff" : "owed") + '">' + (paidOff ? "Paid off" : esc(peso(remaining))) + "</div>";
      html += '<div class="sub">remaining</div>';
    } else {
      html += '<div class="sub">recurring</div>';
    }
    html += "</div>";
    html += '<button class="expand-btn" id="expand-' + a.id + '" aria-label="Expand">' + (expanded ? "\u2212" : "+") + "</button>";
    html += "</div>";

    if (isLoan) {
      html += '<div class="tally">';
      for (var i = 0; i < segments; i++) html += '<span class="' + (i < filled ? "filled" : "") + '"></span>';
      html += "</div>";
    }

    if (expanded) {
      html += '<div class="account-detail">';
      html += '<div class="detail-grid">';
      html += fieldHtml("name-" + a.id, "Name", a.name, "text");
      html += fieldHtml("monthly-" + a.id, "Monthly payment", a.monthly, "number");
      html += fieldHtml("dueday-" + a.id, "Due day", a.dueDay, "number");
      if (isLoan) {
        html += fieldHtml("total-" + a.id, "Total loan amount", a.total, "number");
        html += fieldHtml("term-" + a.id, "Term (months)", a.term, "number");
        html += fieldHtml("start-" + a.id, "Start month", a.start, "month");
        html += fieldHtml("paid-" + a.id, "Payments made", a.paid, "number");
      }
      html += "</div>";
      html += '<div class="detail-actions">';
      if (isLoan && !paidOff) html += '<button class="lg-btn lg-btn-primary" id="mark-' + a.id + '">Mark next payment paid</button>';
      html += '<button class="lg-btn lg-btn-danger" id="remove-' + a.id + '">Remove</button>';
      html += "</div>";
      html += '<div class="receipts-section">';
      html += '<div class="receipts-header"><span class="lg-label" style="margin:0">Payment screenshots</span>';
      html += '<label class="lg-btn receipt-upload-btn" for="file-' + a.id + '">+ Add screenshot</label>';
      html += '<input type="file" id="file-' + a.id + '" accept="image/*" capture="environment" style="display:none"></div>';
      html += '<div class="receipts-gallery" id="gallery-' + a.id + '"></div>';
      html += "</div>";
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function fieldHtml(id, label, value, type) {
    return '<div><label class="lg-label">' + esc(label) + '</label><input class="lg-input" id="' + id + '" type="' + type + '" value="' + esc(value) + '"></div>';
  }

  function bindDetailInputs(a) {
    var map = [
      ["name-" + a.id, "name", "text"],
      ["monthly-" + a.id, "monthly", "number"],
      ["dueday-" + a.id, "dueDay", "number"],
      ["total-" + a.id, "total", "number"],
      ["term-" + a.id, "term", "number"],
      ["start-" + a.id, "start", "text"],
      ["paid-" + a.id, "paid", "number"]
    ];
    map.forEach(function (m) {
      var el = document.getElementById(m[0]);
      if (!el) return;
      el.onchange = function (e) {
        var v = m[2] === "number" ? Number(e.target.value) : e.target.value;
        var patch = {}; patch[m[1]] = v;
        patchAccount(a.id, patch);
      };
    });
  }

  // ---------- add form ----------
  function renderAddForm() {
    var container = document.getElementById("add-form-container");
    if (!ui.showAdd) { container.innerHTML = ""; return; }
    var t = ui.addType;
    var html = '<div class="lg-card add-form">';
    html += '<div class="type-toggle">';
    html += '<button class="lg-btn' + (t === "loan" ? " active" : "") + '" id="type-loan">Loan</button>';
    html += '<button class="lg-btn' + (t === "recurring" ? " active" : "") + '" id="type-recurring">Recurring expense</button>';
    html += "</div>";
    html += '<div class="detail-grid">';
    html += fieldHtml("new-name", "Name", "", "text");
    html += fieldHtml("new-monthly", "Monthly payment", "", "number");
    html += fieldHtml("new-dueday", "Due day", "1", "number");
    if (t === "loan") {
      html += fieldHtml("new-total", "Total loan amount", "", "number");
      html += fieldHtml("new-term", "Term (months)", "", "number");
      html += fieldHtml("new-start", "Start month", new Date().toISOString().slice(0, 7), "month");
      html += fieldHtml("new-paid", "Payments already made", "0", "number");
    }
    html += "</div>";
    html += '<div class="detail-actions">';
    html += '<button class="lg-btn lg-btn-primary" id="new-submit">Add</button>';
    html += '<button class="lg-btn" id="new-cancel">Cancel</button>';
    html += "</div></div>";
    container.innerHTML = html;

    document.getElementById("type-loan").onclick = function () { ui.addType = "loan"; renderAddForm(); };
    document.getElementById("type-recurring").onclick = function () { ui.addType = "recurring"; renderAddForm(); };
    document.getElementById("new-cancel").onclick = function () { ui.showAdd = false; renderAddForm(); };
    document.getElementById("new-submit").onclick = function () {
      var name = document.getElementById("new-name").value.trim();
      var monthly = Number(document.getElementById("new-monthly").value);
      if (!name || !monthly) return;
      var dueDay = Number(document.getElementById("new-dueday").value) || 1;
      var acc = { name: name, type: ui.addType, monthly: monthly, dueDay: dueDay };
      if (ui.addType === "loan") {
        acc.total = Number(document.getElementById("new-total").value) || 0;
        acc.term = Number(document.getElementById("new-term").value) || 1;
        acc.start = document.getElementById("new-start").value || new Date().toISOString().slice(0, 7);
        acc.paid = Number(document.getElementById("new-paid").value) || 0;
      }
      addAccount(acc);
    };
  }

  // ---------- boot ----------
  function renderAll() {
    renderBanner();
    renderHero();
    renderChart();
    renderAddForm();
    renderAccounts();
    if (ui.view === "summary") renderSummary();
  }

  function bootUI() {
    document.getElementById("add-account-btn").onclick = function () {
      ui.showAdd = !ui.showAdd;
      renderAddForm();
    };
    document.getElementById("download-ics-btn").onclick = downloadICS;
    document.getElementById("enable-notif-btn").onclick = enableNotifications;
    document.getElementById("tab-accounts").onclick = function () { switchView("accounts"); };
    document.getElementById("tab-summary").onclick = function () { switchView("summary"); };
  }
  function switchView(view) {
    ui.view = view;
    document.getElementById("tab-accounts").classList.toggle("active", view === "accounts");
    document.getElementById("tab-summary").classList.toggle("active", view === "summary");
    document.getElementById("accounts-view").classList.toggle("hidden", view !== "accounts");
    document.getElementById("summary-view").classList.toggle("hidden", view !== "summary");
    if (view === "summary") renderSummary();
  }

  document.addEventListener("DOMContentLoaded", function () {
    state = load();
    bootUI();
    renderAll();
  });

  if (document.readyState !== "loading") {
    state = load();
    bootUI();
    renderAll();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
