(function () {
  "use strict";

  const AO = window.AgentOffice;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  AO.logoMarkHTML = function (agent) {
    const url = agent && agent.logoUrl ? String(agent.logoUrl) : "";
    const fallback = (agent && (agent.logoText || agent.brand)) || "AI";
    if (!url) return esc(fallback);
    return '<img class="brand-logo-img" src="' + esc(url) +
      '" alt="" draggable="false" onload="this.parentNode.classList.add(\'logo-loaded\')"' +
      ' onerror="this.remove()"><i class="brand-logo-fallback">' + esc(fallback) + '</i>';
  };

  AO.logoClass = function (agent) {
    return agent && agent.logoUrl ? " has-brand-logo" : "";
  };
})();
