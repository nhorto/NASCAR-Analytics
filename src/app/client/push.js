// Race-alert subscription UI (WS-H). Mounted on the Live page's My Driver tab
// for Pro viewers. Everything here degrades quietly: an unsupported browser,
// a denied permission, or an unconfigured server all just leave the card in a
// state that explains itself rather than throwing.
(function () {
  var mount = document.getElementById("push-mount");
  if (!mount) return;

  var supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  var standalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  function note(html) {
    mount.innerHTML = '<div class="card"><div class="card-h"><h2>Race alerts</h2></div>' + html + "</div>";
  }
  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
    return m ? m[1] : "";
  }
  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function followedDriver() {
    var v = localStorage.getItem("looplab_follow");
    return v ? Number(v) : null;
  }

  if (!supported) {
    // iOS only exposes push to an INSTALLED PWA — say that instead of
    // "unsupported", which would be wrong and unactionable.
    if (isIos && !standalone) {
      note(
        '<p class="note">On iPhone and iPad, race alerts work once Looplab is on your home screen: tap Share, then <b>Add to Home Screen</b>, and open it from there.</p>',
      );
    } else {
      note('<p class="note">This browser doesn\'t support push notifications.</p>');
    }
    return;
  }

  function render(state, detail) {
    if (state === "subscribed") {
      note(
        '<p class="note">Alerts are on for this device' +
          (followedDriver() ? " and your followed driver" : "") +
          '.</p><p style="margin-top:8px"><button class="install-btn" id="push-test" type="button">Send a test</button> <button class="install-dismiss" id="push-off" type="button">Turn off</button></p>',
      );
      document.getElementById("push-test").addEventListener("click", sendTest);
      document.getElementById("push-off").addEventListener("click", unsubscribe);
      return;
    }
    if (state === "denied") {
      note(
        '<p class="note">Notifications are blocked for this site. Enable them in your browser settings to get race alerts.</p>',
      );
      return;
    }
    if (state === "error") {
      note('<p class="note form-error">' + (detail || "Couldn\'t set up alerts.") + "</p>");
      return;
    }
    note(
      '<p class="note">Get a push when your driver pits, when the caution flies, at stage ends, and at the finish.</p>' +
        '<p style="margin-top:8px"><button class="install-btn" id="push-on" type="button">Turn on race alerts</button></p>',
    );
    document.getElementById("push-on").addEventListener("click", subscribe);
  }

  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
      body: JSON.stringify(body || {}),
    });
  }

  function subscribe() {
    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== "granted") {
          render(permission === "denied" ? "denied" : "idle");
          return null;
        }
        return fetch("/api/push/key")
          .then(function (r) {
            if (!r.ok) throw new Error("Race alerts aren't enabled on the server yet.");
            return r.json();
          })
          .then(function (data) {
            return navigator.serviceWorker.ready.then(function (reg) {
              return reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(data.publicKey),
              });
            });
          })
          .then(function (sub) {
            var json = sub.toJSON();
            return api("/api/push/subscribe", {
              endpoint: sub.endpoint,
              p256dh: json.keys.p256dh,
              auth: json.keys.auth,
              followedDriverId: followedDriver(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          })
          .then(function (res) {
            if (!res.ok) throw new Error("Server refused the subscription.");
            render("subscribed");
          });
      })
      .catch(function (err) {
        render("error", err && err.message);
      });
  }

  function unsubscribe() {
    navigator.serviceWorker.ready
      .then(function (reg) {
        return reg.pushManager.getSubscription();
      })
      .then(function (sub) {
        if (!sub) return null;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          return api("/api/push/unsubscribe", { endpoint: endpoint });
        });
      })
      .then(function () {
        render("idle");
      })
      .catch(function () {
        render("idle");
      });
  }

  function sendTest() {
    api("/api/push/test", {}).then(function (res) {
      if (!res.ok) render("error", "Test push failed — the server may not be configured.");
    });
  }

  if (Notification.permission === "denied") {
    render("denied");
  } else {
    navigator.serviceWorker.ready
      .then(function (reg) {
        return reg.pushManager.getSubscription();
      })
      .then(function (sub) {
        render(sub ? "subscribed" : "idle");
      })
      .catch(function () {
        render("idle");
      });
  }
})();
