// Install affordance (WS-H). Chromium fires `beforeinstallprompt`, which we
// capture and re-fire from our own button. iOS Safari has no such event and
// installs only via Share → Add to Home Screen, so there we swap the button
// for the instruction instead of showing a control that cannot work.
(function () {
  var card = document.getElementById("install-card");
  if (!card) return;
  var copy = document.getElementById("install-copy");
  var go = document.getElementById("install-go");
  var no = document.getElementById("install-no");
  var deferred = null;
  var DISMISS_KEY = "looplab_install_dismissed";

  function standalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true
    );
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }
  function dismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch (e) {
      return false;
    }
  }
  function hide() {
    card.hidden = true;
  }

  if (standalone() || dismissed()) return;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    card.hidden = false;
  });

  if (isIos()) {
    copy.textContent =
      "Tap the Share button, then “Add to Home Screen” for full-screen race-day access — and to enable race alerts.";
    go.hidden = true;
    card.hidden = false;
  }

  go.addEventListener("click", function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function () {
      deferred = null;
      hide();
    });
  });

  no.addEventListener("click", function () {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch (e) {}
    hide();
  });

  window.addEventListener("appinstalled", hide);
})();
