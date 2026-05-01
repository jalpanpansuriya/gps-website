(function () {
  "use strict";

  var userEl = document.getElementById("portal-user");
  var welcomeEl = document.getElementById("portal-welcome");
  var metaEl = document.getElementById("portal-meta");
  var logoutBtn = document.getElementById("portal-logout-btn");

  var feeDash = document.getElementById("staff-fee-dash");
  var feeNonAdmin = document.getElementById("staff-fee-non-admin");
  var feeYearLabel = document.getElementById("staff-fee-year-label");
  var statToday = document.getElementById("staff-stat-today");
  var statMonth = document.getElementById("staff-stat-month");
  var statSession = document.getElementById("staff-stat-session");
  var statTodayN = document.getElementById("staff-stat-today-n");
  var statMonthN = document.getElementById("staff-stat-month-n");
  var statSessionN = document.getElementById("staff-stat-session-n");
  var modeWrap = document.getElementById("staff-mode-wrap");
  var modeList = document.getElementById("staff-mode-list");
  var defEmpty = document.getElementById("staff-def-preview-empty");
  var defTableWrap = document.getElementById("staff-def-preview-table-wrap");
  var defBody = document.getElementById("staff-def-preview-body");

  if (!window.supabaseClient) {
    if (userEl) {
      userEl.textContent = "Supabase is not configured.";
    }
    return;
  }

  function formatInr(n) {
    if (n == null || isNaN(Number(n))) {
      return "—";
    }
    return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function formatIndiaDateTime() {
    var now = new Date();
    try {
      var d = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(now);
      var t = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }).format(now);
      return d + " · " + t + " IST";
    } catch (e) {
      return now.toLocaleString();
    }
  }

  function capitalizeWord(word) {
    if (!word) {
      return "";
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  function firstNameForWelcome(user) {
    if (!user) {
      return "";
    }
    var m = user.user_metadata || {};
    if (m.first_name && String(m.first_name).trim()) {
      return String(m.first_name).trim();
    }
    var multi = m.name || m.full_name || m.display_name;
    if (multi && String(multi).trim()) {
      var w = String(multi).trim().split(/\s+/)[0];
      if (w) {
        return w;
      }
    }
    var email = user.email || "";
    if (email.indexOf("@") < 0) {
      return "";
    }
    var local = email.split("@")[0] || "";
    var fromEmail = local.split(/[._-]/)[0] || local;
    return fromEmail;
  }

  function greetingForUser(user) {
    var raw = firstNameForWelcome(user);
    if (!raw) {
      return "Welcome";
    }
    return "Welcome, " + capitalizeWord(raw);
  }

  function bindLogout() {
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        window.supabaseClient.auth.signOut().then(function () {
          window.location.href = "login.html";
        });
      });
    }
  }

  var MODE_LABELS = {
    CASH: "Cash",
    UPI: "UPI",
    BANK_TRANSFER: "Bank transfer",
    CHEQUE: "Cheque",
    CARD: "Card",
    OTHER: "Other"
  };

  async function loadCurrentAcademicYear() {
    var cur = await window.supabaseClient
      .from("academic_years")
      .select("id, label")
      .eq("is_current", true)
      .maybeSingle();
    if (!cur.error && cur.data && cur.data.id) {
      return cur.data;
    }
    var fb = await window.supabaseClient
      .from("academic_years")
      .select("id, label")
      .order("label", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fb.error || !fb.data) {
      return null;
    }
    return fb.data;
  }

  async function loadFeeDashboard(yearId, yearLabel) {
    if (feeYearLabel) {
      feeYearLabel.textContent = yearLabel ? "Academic year: " + yearLabel : "";
    }

    var statsRpc = await window.supabaseClient.rpc("admin_fee_dashboard_stats", {
      p_academic_year_id: yearId
    });
    if (statsRpc.error) {
      if (statToday) statToday.textContent = "—";
      if (statMonth) statMonth.textContent = "—";
      if (statSession) statSession.textContent = "—";
      if (statTodayN) statTodayN.textContent = statsRpc.error.message || "Could not load stats";
      return;
    }
    var row = statsRpc.data && statsRpc.data[0] ? statsRpc.data[0] : null;
    if (!row) {
      return;
    }
    if (statToday) statToday.textContent = formatInr(row.collected_today_inr);
    if (statMonth) statMonth.textContent = formatInr(row.collected_month_inr);
    if (statSession) statSession.textContent = formatInr(row.collected_session_inr);
    if (statTodayN) {
      statTodayN.textContent =
        row.payments_today != null ? row.payments_today + " payment(s)" : "";
    }
    if (statMonthN) {
      statMonthN.textContent =
        row.payments_month != null ? row.payments_month + " payment(s)" : "";
    }
    if (statSessionN) {
      statSessionN.textContent =
        row.payments_session != null ? row.payments_session + " payment(s)" : "";
    }

    var modes = row.by_mode_session;
    if (modeList) modeList.innerHTML = "";
    if (modeWrap && modeList && modes != null && typeof modes === "object" && !Array.isArray(modes)) {
      var keys = Object.keys(modes);
      if (keys.length > 0) {
        modeWrap.classList.remove("is-hidden");
        keys.sort();
        keys.forEach(function (k) {
          var li = document.createElement("li");
          li.className = "staff-mode-item";
          var lab = MODE_LABELS[k] || k;
          li.innerHTML =
            '<span class="staff-mode-name">' +
            lab +
            '</span><span class="staff-mode-amt">' +
            formatInr(modes[k]) +
            "</span>";
          modeList.appendChild(li);
        });
      } else {
        modeWrap.classList.add("is-hidden");
      }
    }

    var defRpc = await window.supabaseClient.rpc("admin_list_fee_defaulters", {
      p_academic_year_id: yearId,
      p_min_outstanding: 1,
      p_class_name: null
    });
    if (defRpc.error || !defBody) {
      return;
    }
    var rows = defRpc.data || [];
    var top = rows.slice(0, 8);
    defBody.innerHTML = "";
    if (top.length === 0) {
      if (defEmpty) defEmpty.classList.remove("is-hidden");
      if (defTableWrap) defTableWrap.classList.add("is-hidden");
    } else {
      if (defEmpty) defEmpty.classList.add("is-hidden");
      if (defTableWrap) defTableWrap.classList.remove("is-hidden");
      top.forEach(function (r) {
        var tr = document.createElement("tr");
        var cls = r.class_name || "—";
        if (r.section) cls += " " + r.section;
        tr.innerHTML =
          "<td>" +
          escapeHtml(r.full_name || "—") +
          '</td><td class="staff-def-num">' +
          escapeHtml(cls) +
          '</td><td class="staff-def-num">' +
          formatInr(r.expected_inr) +
          '</td><td class="staff-def-num">' +
          formatInr(r.paid_inr) +
          '</td><td class="staff-def-num staff-def-due">' +
          formatInr(r.outstanding_inr) +
          '</td><td>' +
          '<a class="btn btn-primary staff-def-record-pay" href="' +
          escapeHtml(
            "record-payment.html?student_id=" +
              encodeURIComponent(r.student_id) +
              "&year_id=" +
              encodeURIComponent(yearId)
          ) +
          '">Record payment</a></td>';
        defBody.appendChild(tr);
      });
    }
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  async function initialize() {
    var sessionRes = await window.supabaseClient.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
    if (!session) {
      window.location.href = "login.html?redirect=staff-portal.html";
      return;
    }

    var user = session.user;
    var email = user && user.email ? user.email : "";
    if (welcomeEl) {
      welcomeEl.textContent = greetingForUser(user);
    }
    if (metaEl) {
      metaEl.textContent = formatIndiaDateTime();
    }
    if (userEl) {
      userEl.textContent = email ? "Signed in as " + email : "Signed in";
    }
    bindLogout();

    var roleRes = await window.supabaseClient
      .from("teachers")
      .select("role")
      .eq("user_id", session.user.id)
      .maybeSingle();

    var isAdmin = roleRes.data && roleRes.data.role === "admin";

    if (isAdmin) {
      if (feeDash) feeDash.classList.remove("is-hidden");
      if (feeNonAdmin) feeNonAdmin.classList.add("is-hidden");

      var year = await loadCurrentAcademicYear();
      if (!year || !year.id) {
        if (statToday) statToday.textContent = "—";
        if (statTodayN) {
          statTodayN.textContent =
            "No academic year found. Add one in Supabase or run fee_structure_v1.sql.";
        }
        return;
      }
      await loadFeeDashboard(year.id, year.label);
    } else {
      if (feeDash) feeDash.classList.add("is-hidden");
      if (feeNonAdmin) feeNonAdmin.classList.remove("is-hidden");
    }
  }

  initialize();
})();
