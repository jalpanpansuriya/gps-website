(function () {
  "use strict";

  var form = document.getElementById("login-form");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var loginBtn = document.getElementById("login-btn");
  var messageEl = document.getElementById("login-message");
  var redirectTarget = new URLSearchParams(window.location.search).get("redirect") || "staff-portal.html";

  if (!window.supabaseClient) {
    messageEl.textContent = "Supabase is not configured.";
    messageEl.className = "auth-message auth-message-error";
    return;
  }

  window.supabaseClient.auth.getSession().then(function (result) {
    if (result.data && result.data.session) {
      window.location.href = redirectTarget;
    }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    setLoading(true);
    setMessage("Signing in...", "info");

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    try {
      var response = await window.supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (response.error) {
        throw response.error;
      }

      setMessage("Login successful. Redirecting...", "success");
      window.location.href = redirectTarget;
    } catch (error) {
      setMessage(error.message || "Login failed", "error");
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.textContent = isLoading ? "Signing In..." : "Sign In";
  }

  function setMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = "auth-message";
    if (type) {
      messageEl.classList.add("auth-message-" + type);
    }
  }
})();
