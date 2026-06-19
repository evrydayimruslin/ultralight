// Theme-aware favicon. Chromium doesn't reliably honour prefers-color-scheme
// inside an SVG favicon, and CSP forbids inline scripts, so swap the href from
// this self-hosted file: white mark on dark UI, black mark on light UI.
(function () {
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var link = document.getElementById("favicon");
    if (!link) return;
    var set = function (isDark) {
      link.setAttribute("href", isDark ? "/favicon-white.svg" : "/favicon-black.svg");
    };
    set(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", function (e) { set(e.matches); });
    } else if (mq.addListener) {
      mq.addListener(function (e) { set(e.matches); });
    }
  } catch (e) {
    /* leave the static <link> favicon in place */
  }
})();
