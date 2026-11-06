// The page the terminal WebView loads (spec MOB17). The app injects commands through
// `window.__deck(command)` and receives messages through ReactNativeWebView.postMessage; the
// protocol of both is `src/terminal/terminal-bridge.ts`. xterm is created with the DESKTOP pane's
// columns and rows (the phone never resizes the desktop, MOB14); the app picks the font size so
// those columns fit the screen, and above 100% the page scrolls sideways.
(function () {
  var host = document.getElementById("term");
  var term = null;
  var stickToBottom = true;

  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function atBottom() {
    var el = document.scrollingElement || document.documentElement;
    return window.innerHeight + el.scrollTop >= el.scrollHeight - 4;
  }

  function scrollToBottom() {
    var el = document.scrollingElement || document.documentElement;
    el.scrollTop = el.scrollHeight;
  }

  window.addEventListener("scroll", function () {
    stickToBottom = atBottom();
  });

  function create(cmd) {
    document.body.style.background = cmd.background;
    term = new Terminal({
      cols: cmd.cols,
      rows: cmd.rows,
      fontSize: cmd.fontSize,
      fontFamily: 'Menlo, "SF Mono", ui-monospace, monospace',
      scrollback: 1000,
      cursorBlink: false,
      allowProposedApi: false,
      theme: { background: cmd.background, foreground: cmd.foreground, cursor: cmd.foreground },
    });
    term.open(host);
    var area = term.textarea;
    if (area) {
      // The soft keyboard must send raw keys: no autocorrect, no capital letters, no suggestions.
      area.setAttribute("autocorrect", "off");
      area.setAttribute("autocapitalize", "none");
      area.setAttribute("autocomplete", "off");
      area.setAttribute("spellcheck", "false");
    }
    term.onData(function (data) {
      post({ t: "input", d: data });
    });
    post({ t: "inited" });
  }

  // The page's one global entry point, which the React Native side calls through injectJavaScript;
  // the underscores keep it clear of xterm's names.
  // oxlint-disable-next-line no-underscore-dangle -- see above
  window.__deck = function (cmd) {
    try {
      if (cmd.t === "init") return create(cmd);
      if (!term) return;
      switch (cmd.t) {
        case "write":
          term.write(cmd.d, function () {
            if (stickToBottom) scrollToBottom();
          });
          break;
        case "resize":
          term.resize(cmd.cols, cmd.rows);
          break;
        case "font":
          host.style.transform = "";
          term.options.fontSize = cmd.size;
          break;
        case "reset":
          term.reset();
          stickToBottom = true;
          break;
        case "focus":
          term.focus();
          break;
        case "blur":
          term.blur();
          break;
      }
    } catch (error) {
      post({ t: "error", message: String(error && error.message) });
    }
  };

  // Pinch: preview by scaling while the fingers move, then report the final scale; the app snaps
  // it to a fixed text size and answers with a `font` command.
  var startDistance = 0;
  var scale = 1;
  function distance(touches) {
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  document.addEventListener(
    "touchstart",
    function (event) {
      if (event.touches.length === 2) {
        startDistance = distance(event.touches);
        scale = 1;
      }
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    function (event) {
      if (event.touches.length === 2 && startDistance > 0) {
        event.preventDefault();
        scale = distance(event.touches) / startDistance;
        host.style.transformOrigin = "0 0";
        host.style.transform = "scale(" + scale + ")";
      }
    },
    { passive: false },
  );
  document.addEventListener(
    "touchend",
    function (event) {
      if (startDistance > 0 && event.touches.length < 2) {
        var finished = scale;
        startDistance = 0;
        scale = 1;
        host.style.transform = "";
        post({ t: "pinch", scale: finished });
      }
    },
    { passive: true },
  );

  post({ t: "ready" });
})();
