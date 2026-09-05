(() => {
  "use strict";
  const COMMIT = "a668e2158e5c70059c43ed51c515d916aef81ca9";
  const PATH = "tools/animalearn.js";
  const urls = [
    "https://cdn.jsdelivr.net/gh/Afra55/Afra55.github.io@" + COMMIT + "/" + PATH,
    "https://raw.githack.com/Afra55/Afra55.github.io/" + COMMIT + "/" + PATH
  ];
  function load(i) {
    if (i >= urls.length) {
      console.error("[animalearn] failed to restore script");
      return;
    }
    const s = document.createElement("script");
    s.src = urls[i];
    s.async = false;
    s.onerror = () => load(i + 1);
    document.head.appendChild(s);
  }
  load(0);
})();
