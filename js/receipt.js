(function () {
  "use strict";

  var el = {
    user: document.getElementById("rc-user"),
    message: document.getElementById("rc-message"),
    denied: document.getElementById("rc-denied"),
    app: document.getElementById("rc-app"),
    logoutBtn: document.getElementById("logout-btn"),
    printBtn: document.getElementById("receipt-print-btn"),
    body: document.getElementById("receipt-content")
  };

  if (!window.supabaseClient) {
    if (el.message) {
      el.message.textContent = "Supabase is not configured.";
      el.message.className = "attendance-message attendance-message-error";
    }
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var paymentId = params.get("payment");
  if (!paymentId) {
    if (el.app) el.app.classList.add("is-hidden");
    if (el.denied) {
      el.denied.classList.remove("is-hidden");
    }
    var r = document.getElementById("receipt-denied-reason");
    if (r) {
      r.textContent = "No receipt id. Use a link from Record payment, or add ?payment={id} to the URL.";
    }
    return;
  }

  initialize(paymentId);

  async function initialize(id) {
    var sessionRes = await window.supabaseClient.auth.getSession();
    var s = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
    if (!s) {
      var back =
        "receipt.html?payment=" + encodeURIComponent(id);
      window.location.href = "login.html?redirect=" + encodeURIComponent(back);
      return;
    }
    if (el.user) {
      el.user.textContent = "Signed in as " + (s.user.email || "User");
    }
    if (el.logoutBtn) {
      el.logoutBtn.addEventListener("click", function () {
        window.supabaseClient.auth.signOut().then(function () {
          window.location.href = "index.html";
        });
      });
    }

    var roleRes = await window.supabaseClient
      .from("teachers")
      .select("role")
      .eq("user_id", s.user.id)
      .maybeSingle();

    if (roleRes.error || !roleRes.data || roleRes.data.role !== "admin") {
      if (el.app) el.app.classList.add("is-hidden");
      if (el.denied) el.denied.classList.remove("is-hidden");
      var r2 = document.getElementById("receipt-denied-reason");
      if (r2) {
        r2.textContent = "You must be signed in as an admin to view this receipt.";
      }
      return;
    }

    var payRes = await window.supabaseClient
      .from("fee_payments")
      .select(
        "id, receipt_number, amount_inr, payment_date, payment_mode, reference, note, created_at, student_id, academic_year_id"
      )
      .eq("id", id)
      .maybeSingle();

    if (payRes.error) {
      showError("Could not load receipt: " + payRes.error.message);
      return;
    }
    if (!payRes.data) {
      showError("Receipt not found or you do not have access.");
      return;
    }
    var p = payRes.data;

    var stRes = await window.supabaseClient
      .from("students")
      .select("full_name, class_name, section, roll_no, parent_phone")
      .eq("id", p.student_id)
      .maybeSingle();
    var yRes = await window.supabaseClient
      .from("academic_years")
      .select("label, starts_on, ends_on")
      .eq("id", p.academic_year_id)
      .maybeSingle();

    if (stRes.error || !stRes.data) {
      showError("Could not load student: " + (stRes.error && stRes.error.message));
      return;
    }
    if (yRes.error || !yRes.data) {
      showError("Could not load academic year.");
      return;
    }

    if (el.app) el.app.classList.remove("is-hidden");
    if (el.message) {
      el.message.textContent = "";
      el.message.className = "attendance-message no-print";
    }
    fillReceipt(p, stRes.data, yRes.data);

    if (el.printBtn) {
      el.printBtn.addEventListener("click", function () {
        window.print();
      });
    }
  }

  function showError(text) {
    if (el.message) {
      el.message.textContent = text;
      el.message.className = "attendance-message attendance-message-error";
    }
    if (el.app) {
      el.app.classList.remove("is-hidden");
    }
  }

  function formatMoney(n) {
    var x = Number(n);
    if (isNaN(x)) {
      return "—";
    }
    return x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function modeLabel(code) {
    var map = {
      CASH: "Cash",
      UPI: "UPI",
      BANK_TRANSFER: "Bank transfer / NEFT / RTGS",
      CHEQUE: "Cheque",
      CARD: "Card",
      OTHER: "Other"
    };
    return map[code] || code || "—";
  }

  function fillReceipt(p, st, y) {
    if (!el.body) return;
    el.body.innerHTML =
      '<p class="receipt-school">Shri Swaminarayan Gurukul Public School</p>' +
      '<p class="receipt-address">Plot No. 508, Sardar Park, GIDC, Ankleshwar, Bharuch, Gujarat</p>' +
      '<p class="receipt-title">Fee receipt (office copy)</p>' +
      '<dl class="receipt-dl">' +
      makeRow("Receipt no.", p.receipt_number) +
      makeRow("Date of payment", formatDateIn(p.payment_date)) +
      makeRow("Academic year", y.label) +
      "</dl>" +
      "<hr class=\"receipt-hr\" />" +
      "<p class=\"receipt-student-name\">" +
      escapeHtml(st.full_name) +
      "</p>" +
      "<dl class=\"receipt-dl\">" +
      makeRow("Class", escapeHtml(String(st.class_name != null ? st.class_name : "—"))) +
      makeRow("Section", st.section != null && String(st.section) !== "" ? escapeHtml(String(st.section)) : "—") +
      makeRow("Roll no.", st.roll_no != null ? escapeHtml(String(st.roll_no)) : "—") +
      makeRow("Parent phone", st.parent_phone != null && String(st.parent_phone) !== "" ? escapeHtml(String(st.parent_phone)) : "—") +
      "</dl>" +
      "<hr class=\"receipt-hr\" />" +
      "<dl class=\"receipt-dl\">" +
      makeRow("Amount received", "₹ " + formatMoney(p.amount_inr)) +
      makeRow("Mode of payment", escapeHtml(modeLabel(p.payment_mode))) +
      (p.reference
        ? makeRow("Reference", escapeHtml(p.reference))
        : "") +
      (p.note ? makeRow("Note (office)", escapeHtml(p.note)) : "") +
      "</dl>" +
      '<p class="receipt-footer">This is a system-generated record. ' +
      (p.created_at
        ? "Recorded at: " + formatTs(p.created_at) + " (IST)"
        : "") +
      "</p>";
  }

  function makeRow(l, v) {
    return (
      "<div class=\"receipt-dl-row\"><dt>" +
      l +
      "</dt><dd>" +
      v +
      "</dd></div>"
    );
  }

  function formatDateIn(d) {
    if (!d) return "—";
    if (typeof d === "string" && d.length >= 10) {
      return d.slice(0, 10);
    }
    return String(d);
  }

  function formatTs(ts) {
    try {
      return new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    } catch (e) {
      return String(ts);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
