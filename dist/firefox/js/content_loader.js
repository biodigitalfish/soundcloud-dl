(async () => {
  function getExtensionURL(relativePath) {
    if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL) {
      return browser.runtime.getURL(relativePath);
    } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL(relativePath);
    }
    console.error("SOUNDCLOUD-DL: Cannot get extension URL for path:", relativePath);
    return null;
  }
  (async () => {
    const modulePath = "js/content.js";
    const src = getExtensionURL(modulePath);
    if (src) {
      try {
        await import(src).then(async (m) => {
          await m.__tla;
          return m;
        });
        console.log("SOUNDCLOUD-DL: content.js module initiated via content_loader.js");
      } catch (e) {
        console.error("SOUNDCLOUD-DL: Error dynamically importing content.js module at", src, e);
      }
    } else {
      console.error("SOUNDCLOUD-DL: Could not resolve extension URL for content.js module.");
    }
  })();
})();
