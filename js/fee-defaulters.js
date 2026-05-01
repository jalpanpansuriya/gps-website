(function () {
  "use strict";

  var denied = document.getElementById("fd-denied");
  var app = document.getElementById("fd-app");
  var userEl = document.getElementById("fd-user");
  var msgEl = document.getElementById("fd-message");
  var metaEl = document.getElementById("fd-meta");
  var yearSel = document.getElementById("fd-year");
  var classInput = document.getElementById("fd-class");
  var minInput = document.getElementById("fd-min");
  var loadBtn = document.getElementById("fd-load-btn");
  var exportBtn = document.getElementById("fd-export-btn");
  var tableBody = document.getElementById("fd-table-body");
  var logoutBtn = document.getElementById("logout-btn");
  var lastRows = [];

  if (!window.supabaseClient) {
    if (msgEl) {
      msgEl.textContent = "Supabase is not configured.";
      msgEl.classList.add("attendance-message-error");
    }
    return;
  }

  function formatInr(n) {
    if (n == null || isNaN(Number(n))) {
      return "—";
    }
    return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function csvEscape(val) {
    var s = val == null ? "" : String(val);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadCsv(filename, csvText) {
    var blob = new Blob(["\ufeff" + csvText], {
      type: "text/csv;charset=utf-8"
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportOutstandingCsv() {
    if (!lastRows.length) {
      showMessage("Load the list first, then export.", "error");
      return;
    }
    var yearId = yearSel && yearSel.value ? yearSel.value : "";
    var yLabel =
      yearSel && yearSel.selectedIndex >= 0
        ? (yearSel.options[yearSel.selectedIndex].text || "").trim()
        : "";
    var cls = classInput && classInput.value ? classInput.value.trim() : "";
    var minRaw = minInput && minInput.value !== "" ? parseFloat(minInput.value) : 1;
    var minDue = isNaN(minRaw) || minRaw < 0 ? 1 : minRaw;
    var head = [
      "academic_year_id",
      "academic_year_label",
      "filter_class",
      "filter_min_due_inr",
      "student_id",
      "full_name",
      "roll_no",
      "class_name",
      "section",
      "expected_inr",
      "paid_inr",
      "outstanding_inr",
      "last_payment_date"
    ];
    var lines = [head.map(csvEscape).join(",")];
    lastRows.forEach(function (r) {
      var row = [
        yearId,
        yLabel,
        cls,
        minDue,
        r.student_id,
        r.full_name,
        r.roll_no,
        r.class_name,
        r.section,
        r.expected_inr,
        r.paid_inr,
        r.outstanding_inr,
        r.last_payment_date != null ? String(r.last_payment_date) : ""
      ];
      lines.push(row.map(csvEscape).join(","));
    });
    var stub = yLabel.replace(/[^\w\-]+/g, "_").slice(0, 40) || "outstanding";
    downloadCsv("outstanding_" + stub + ".csv", lines.join("\r\n"));
    showMessage("Downloaded CSV (" + lastRows.length + " row(s)).", "success");
  }

  function showMessage(text, type) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.className = "attendance-message no-print";
    if (type) {
      msgEl.classList.add("attendance-message-" + type);
    }
  }

  async function populateYears() {
    if (!yearSel) return;
    yearSel.innerHTML = "";
    var res = await window.supabaseClient
      .from("academic_years")
      .select("id, label, is_current")
      .order("label", { ascending: false });
    if (res.error) {
      showMessage("Could not load years: " + res.error.message, "error");
      return;
    }
    var rows = res.data || [];
    if (rows.length === 0) {
      showMessage("No academic years. Run fee_structure_v1.sql.", "error");
      return;
    }
    rows.forEach(function (r) {
      var o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.label + (r.is_current ? " (current)" : "");
      yearSel.appendChild(o);
    });
    var cur = rows.find(function (r) {
      return r.is_current;
    });
    if (cur) {
      yearSel.value = cur.id;
    } else {
      yearSel.value = rows[0].id;
    }
  }

  async function loadList() {
    lastRows = [];
    var yearId = yearSel && yearSel.value ? yearSel.value : "";
    if (!yearId) {
      showMessage("Select an academic year.", "error");
      return;
    }
    var minRaw = minInput && minInput.value !== "" ? parseFloat(minInput.value) : 1;
    var minDue = isNaN(minRaw) || minRaw < 0 ? 1 : minRaw;
    var cls = classInput && classInput.value ? classInput.value.trim() : "";

    loadBtn.disabled = true;
    loadBtn.textContent = "Loading…";
    showMessage("Loading…", "info");
    if (metaEl) metaEl.textContent = "";

    var params = {
      p_academic_year_id: yearId,
      p_min_outstanding: minDue,
      p_class_name: cls || null
    };

    var rpc = await window.supabaseClient.rpc("admin_list_fee_defaulters", params);

    loadBtn.disabled = false;
    loadBtn.textContent = "Load list";

    if (rpc.error) {
      showMessage(rpc.error.message || "Failed to load.", "error");
      return;
    }

    var rows = rpc.data || [];
    lastRows = rows.slice();
    showMessage(
      rows.length === 0
        ? "No students match (everyone paid up to structure, or no fee lines for their class)."
        : "Showing " + rows.length + " student(s) with due ≥ " + formatInr(minDue) + ".",
      rows.length === 0 ? "info" : "success"
    );

    if (metaEl) {
      var yl = yearSel.options[yearSel.selectedIndex];
      metaEl.textContent =
        (yl ? yl.text : "") +
        (cls ? " · Class filter: " + cls : " · All classes");
    }

    if (!tableBody) return;
    tableBody.innerHTML = "";
    if (rows.length === 0) {
      var tr0 = document.createElement("tr");
      tr0.innerHTML = '<td colspan="8" class="fd-empty">No rows.</td>';
      tableBody.appendChild(tr0);
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      var clsDisp = r.class_name || "—";
      if (r.section) clsDisp += " " + r.section;
      var last =
        r.last_payment_date != null
          ? escapeHtml(String(r.last_payment_date))
          : "—";
      var payHref =
        "record-payment.html?student_id=" +
        encodeURIComponent(r.student_id) +
        "&year_id=" +
        encodeURIComponent(yearId);
      tr.innerHTML =
        "<td>" +
        escapeHtml(r.full_name || "—") +
        '</td><td>' +
        escapeHtml(r.roll_no || "—") +
        '</td><td>' +
        escapeHtml(clsDisp) +
        '</td><td class="staff-def-num">' +
        formatInr(r.expected_inr) +
        '</td><td class="staff-def-num">' +
        formatInr(r.paid_inr) +
        '</td><td class="staff-def-num staff-def-due">' +
        formatInr(r.outstanding_inr) +
        "</td><td>" +
        last +
        '</td><td class="fd-record-cell"><a class="btn btn-primary fd-record-pay" href="' +
        escapeHtml(payHref) +
        '">Record payment</a></td>';
      tableBody.appendChild(tr);
    });
  }

  async function init() {
    var sessionRes = await window.supabaseClient.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
    if (!session) {
      window.location.href = "login.html?redirect=fee-defaulters.html";
      return;
    }

    if (userEl) {
      userEl.textContent = "Signed in as " + (session.user.email || "User");
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        window.supabaseClient.auth.signOut().then(function () {
          window.location.href = "login.html";
        });
      });
    }

    var roleRes = await window.supabaseClient
      .from("teachers")
      .select("role")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (roleRes.error) {
      showMessage("Could not verify role: " + roleRes.error.message, "error");
      if (denied) denied.classList.remove("is-hidden");
      return;
    }

    if (!roleRes.data || roleRes.data.role !== "admin") {
      if (denied) denied.classList.remove("is-hidden");
      return;
    }

    if (app) app.classList.remove("is-hidden");
    await populateYears();

    if (loadBtn) {
      loadBtn.addEventListener("click", loadList);
    }
    if (exportBtn) {
      exportBtn.addEventListener("click", exportOutstandingCsv);
    }
  }

  init();
})();
