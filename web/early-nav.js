// Runs as the page is parsed, before the first paint and before the app has started (the app waits on the network).
// The page ships showing Today, so without this a refresh on another tab flashes Today and then jumps. This applies
// the tab named in the address to the markup that is already here; app.js does the real navigation afterwards.
// A tab that doesn't exist yet (Admin is added later) or an unknown name leaves the page as it is.
(function () {
  var tab = decodeURIComponent(location.hash.slice(1)), panel = document.getElementById(tab + "-panel");
  if (!panel || panel.tagName !== "SECTION" || !document.getElementById("t-" + tab)) return;
  document.body.dataset.view = tab;
  var intro = document.getElementById("t-" + tab).dataset;
  document.getElementById("view-heading").textContent = intro.heading;
  document.getElementById("view-description").textContent = intro.description;
  document.querySelectorAll("section[id$=-panel]").forEach(function (s) { s.hidden = s !== panel });
  document.querySelectorAll("#tabs button").forEach(function (b) {
    var on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", on);
    b.tabIndex = on ? 0 : -1;
  });
})();
