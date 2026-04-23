(function () {
  "use strict";

  var userEl = document.getElementById("portal-user");
  var welcomeEl = document.getElementById("portal-welcome");
  var metaEl = document.getElementById("portal-meta");
  var logoutBtn = document.getElementById("portal-logout-btn");

  if (!window.supabaseClient) {
    if (userEl) {
      userEl.textContent = "Supabase is not configured.";
    }
    return;
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

  function greetingFromEmail(email) {
    if (!email || email.indexOf("@") < 0) {
      return "Welcome";
    }
    var local = email.split("@")[0] || "";
    var first = local.split(/[._-]/)[0] || local;
    if (!first) {
      return "Welcome";
    }
    return "Welcome, " + first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
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

  window.supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (!session) {
      window.location.href = "login.html?redirect=staff-portal.html";
      return;
    }
    var email = session.user && session.user.email ? session.user.email : "";
    if (welcomeEl) {
      welcomeEl.textContent = greetingFromEmail(email);
    }
    if (metaEl) {
      metaEl.textContent = formatIndiaDateTime();
    }
    if (userEl) {
      userEl.textContent = email ? "Signed in as " + email : "Signed in";
    }
    bindLogout();
  });
})();
