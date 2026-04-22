(function () {
  "use strict";

  var PAGE = 80;
  var offset = 0;
  var filterState = {
    dateFrom: "",
    dateTo: "",
    yearId: "",
    receiptQ: "",
    nameQ: ""
  };

  var el = {
    user: document.getElementById("ph-user"),
    message: document.getElementById("ph-message"),
    denied: document.getElementById("ph-denied"),
    app: document.getElementById("ph-app"),
    logoutBtn: document.getElementById("logout-btn"),
    dateFrom: document.getElementById("ph-date-from"),
    dateTo: document.getElementById("ph-date-to"),
    year: document.getElementById("ph-year"),
    receiptQ: document.getElementById("ph-receipt-q"),
    nameQ: document.getElementById("ph-name-q"),
    applyBtn: document.getElementById("ph-apply-btn"),
    loadMoreBtn: document.getElementById("ph-load-more"),
    loadMoreWrap: document.getElementById("ph-load-more-wrap"),
    tbody: document.getElementById("ph-tbody"),
    meta: document.getElementById("ph-meta")
  };

  if (!window.supabaseClient) {
    return;
  }

  initialize();

  async function initialize() {
    var sessionRes = await window.supabaseClient.auth.getSession();
    var s = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
    if (!s) {
      window.location.href = "login.html?redirect=payment-history.html";
      return;
    }
    if (el.user) {
      el.user.textContent = "Signed in as " + (s.user.email || "User");
    }
    if (el.logoutBtn) {
      el.logoutBtn.addEventListener("click", function () {
        window.supabaseClient.auth.signOut().then(function () {
          window.location.href = "login.html";
        });
      });
    }

    var roleRes = await window.supabaseClient
      .from("teachers")
      .select("role")
      .eq("user_id", s.user.id)
      .maybeSingle();

    if (roleRes.error || !roleRes.data || roleRes.data.role !== "admin") {
      if (el.denied) el.denied.classList.remove("is-hidden");
      return;
    }
    if (el.app) el.app.classList.remove("is-hidden");

    if (el.dateTo) el.dateTo.value = getIndiaDateString();
    if (el.dateFrom) el.dateFrom.value = getIndiaDateMinusDays(90);

    await populateYearSelect();

    if (el.applyBtn) {
      el.applyBtn.addEventListener("click", function () {
        loadPayments(true);
      });
    }
    if (el.loadMoreBtn) {
      el.loadMoreBtn.addEventListener("click", function () {
        loadPayments(false);
      });
    }

    await loadPayments(true);
  }

  function getIndiaDateString() {
    var now = new Date();
    var d = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    return formatYmd(d);
  }

  function getIndiaDateMinusDays(n) {
    var now = new Date();
    var d = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    d.setDate(d.getDate() - n);
    return formatYmd(d);
  }

  function formatYmd(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  async function populateYearSelect() {
    if (!el.year) return;
    el.year.innerHTML = '<option value="">All years</option>';
    var res = await window.supabaseClient
      .from("academic_years")
      .select("id, label, is_current")
      .order("label", { ascending: false });
    if (res.error) return;
    (res.data || []).forEach(function (row) {
      var opt = document.createElement("option");
      opt.value = row.id;
      opt.textContent = row.is_current ? row.label + " (current)" : row.label;
      el.year.appendChild(opt);
    });
  }

  function readFilters() {
    filterState.dateFrom = (el.dateFrom && el.dateFrom.value) ? el.dateFrom.value.trim() : "";
    filterState.dateTo = (el.dateTo && el.dateTo.value) ? el.dateTo.value.trim() : "";
    filterState.yearId = (el.year && el.year.value) ? el.year.value.trim() : "";
    filterState.receiptQ = (el.receiptQ && el.receiptQ.value) ? el.receiptQ.value.trim() : "";
    filterState.nameQ = (el.nameQ && el.nameQ.value) ? el.nameQ.value.trim() : "";
  }

  async function loadPayments(reset) {
    readFilters();
    if (!filterState.dateFrom || !filterState.dateTo) {
      showMessage("Set both “From” and “To” payment dates.", "error");
      return;
    }
    if (filterState.dateFrom > filterState.dateTo) {
      showMessage("“From” date must be on or before “To” date.", "error");
      return;
    }

    if (reset) {
      offset = 0;
      if (el.tbody) el.tbody.innerHTML = "";
      if (el.loadMoreWrap) el.loadMoreWrap.classList.add("is-hidden");
    }

    showMessage("Loading…", "info");
    if (el.applyBtn) el.applyBtn.disabled = true;
    if (el.loadMoreBtn) el.loadMoreBtn.disabled = true;

    var studentIds = null;
    if (filterState.nameQ) {
      var st = await window.supabaseClient
        .from("students")
        .select("id")
        .eq("is_active", true)
        .ilike("full_name", "%" + filterState.nameQ + "%")
        .limit(300);
      if (st.error) {
        showMessage("Student search failed: " + st.error.message, "error");
        if (el.applyBtn) el.applyBtn.disabled = false;
        if (el.loadMoreBtn) el.loadMoreBtn.disabled = false;
        return;
      }
      studentIds = (st.data || []).map(function (r) {
        return r.id;
      });
      if (studentIds.length === 0) {
        if (el.tbody && reset) {
          el.tbody.innerHTML =
            '<tr><td colspan="9" class="attendance-empty">No students match that name. Clear the name filter or try other spellings.</td></tr>';
        }
        if (el.meta) el.meta.textContent = "0 payments (no students matched the name).";
        if (el.loadMoreWrap) el.loadMoreWrap.classList.add("is-hidden");
        showMessage("", "");
        if (el.applyBtn) el.applyBtn.disabled = false;
        if (el.loadMoreBtn) el.loadMoreBtn.disabled = false;
        return;
      }
    }

    var q = window.supabaseClient
      .from("fee_payments")
      .select(
        "id, receipt_number, payment_date, amount_inr, payment_mode, created_at, students ( full_name, class_name, section, roll_no ), academic_years ( label )"
      )
      .gte("payment_date", filterState.dateFrom)
      .lte("payment_date", filterState.dateTo)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (filterState.yearId) {
      q = q.eq("academic_year_id", filterState.yearId);
    }
    if (filterState.receiptQ) {
      q = q.ilike("receipt_number", "%" + filterState.receiptQ + "%");
    }
    if (studentIds) {
      if (studentIds.length > 200) {
        studentIds = studentIds.slice(0, 200);
      }
      q = q.in("student_id", studentIds);
    }

    q = q.range(offset, offset + PAGE - 1);

    var res = await q;
    if (el.applyBtn) el.applyBtn.disabled = false;
    if (el.loadMoreBtn) el.loadMoreBtn.disabled = false;

    if (res.error) {
      showMessage("Query failed: " + res.error.message, "error");
      return;
    }

    var rows = res.data || [];
    if (reset && rows.length === 0) {
      if (el.tbody) {
        el.tbody.innerHTML =
          '<tr><td colspan="9" class="attendance-empty">No payments in this range. Widen the dates or clear filters.</td></tr>';
      }
      if (el.meta) {
        el.meta.textContent = "0 payments (try a wider “From / To” range).";
      }
      if (el.loadMoreWrap) el.loadMoreWrap.classList.add("is-hidden");
      showMessage("", "");
      return;
    }

    if (!reset && rows.length === 0) {
      if (el.loadMoreWrap) el.loadMoreWrap.classList.add("is-hidden");
      if (el.meta) {
        el.meta.textContent = "No more rows (end of list for these filters).";
      }
      showMessage("", "");
      return;
    }

    offset = offset + rows.length;

    if (el.tbody) {
      if (reset) {
        el.tbody.innerHTML = "";
      }
      rows.forEach(function (row) {
        el.tbody.appendChild(buildRow(row));
      });
    }

    if (el.meta) {
      var n = el.tbody ? el.tbody.querySelectorAll("tr").length : 0;
      el.meta.textContent =
        n +
        " row(s) in the table" +
        (rows.length === PAGE
          ? ". “Load more” fetches the next " + PAGE + "."
          : " (this page was the last, or the last page for your filters).");
    }
    if (el.loadMoreWrap) {
      if (rows.length < PAGE) {
        el.loadMoreWrap.classList.add("is-hidden");
      } else {
        el.loadMoreWrap.classList.remove("is-hidden");
      }
    }
    showMessage("", "");
  }

  function buildRow(row) {
    var tr = document.createElement("tr");
    var st = row.students;
    if (Array.isArray(st) && st.length) {
      st = st[0];
    }
    if (!st && row.student_id) {
      st = {};
    }
    var name = st && st.full_name ? st.full_name : "—";
    var cls = st && st.class_name != null ? String(st.class_name) : "—";
    var sec = st && st.section != null && String(st.section) !== "" ? String(st.section) : "—";
    var roll = st && st.roll_no != null ? String(st.roll_no) : "—";
    var y = row.academic_years;
    if (Array.isArray(y) && y.length) {
      y = y[0];
    }
    var ylabel = y && y.label ? y.label : "—";
    var amt = row.amount_inr != null ? Number(row.amount_inr) : 0;
    var amtStr = amt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var pdate = row.payment_date
      ? String(row.payment_date).slice(0, 10)
      : "—";
    var href = "receipt.html?payment=" + encodeURIComponent(row.id);
    tr.innerHTML =
      "<td>" +
      cell(row.receipt_number) +
      "</td><td>" +
      cell(ylabel) +
      "</td><td>" +
      cell(pdate) +
      "</td><td><strong>" +
      cell(name) +
      "</strong></td><td>" +
      cell(cls) +
      ' <span class="ph-muted">/</span> ' +
      cell(sec) +
      "</td><td>" +
      cell(roll) +
      "</td><td>₹ " +
      cell(amtStr) +
      "</td><td>" +
      cell(modeLabel(row.payment_mode)) +
      '</td><td class="ph-actions"><a class="btn btn-primary ph-receipt-a" href="' +
      href +
      '">Receipt</a></td>';
    return tr;
  }

  function cell(s) {
    return escapeHtml(String(s));
  }

  function modeLabel(code) {
    var map = {
      CASH: "Cash",
      UPI: "UPI",
      BANK_TRANSFER: "Bank",
      CHEQUE: "Cheque",
      CARD: "Card",
      OTHER: "Other"
    };
    return map[code] || code || "—";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showMessage(text, type) {
    if (!el.message) return;
    el.message.textContent = text || "";
    el.message.className = "attendance-message no-print";
    if (type) {
      el.message.classList.add("attendance-message-" + type);
    }
  }
})();
