(function () {
  "use strict";

  const AO = window.AgentOffice;
  const GLYPHS = {
    doubao: "豆",
    deepseek: "DS",
    workbuddy: "WB",
    gemini: "✦",
    openai: "AI",
    anthropic: "C",
    kimi: "K",
    qwen: "Q",
    ollama: "OL"
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function bridge() {
    let stored = "";
    try { stored = localStorage.getItem("agent-office.bridge-url") || ""; } catch (err) {}
    return String(stored || AO.BRIDGE_DEFAULT || "http://127.0.0.1:8787").replace(/\/+$/, "");
  }

  const OTHER_MODALS = [
    ".feature-modal-root:not([hidden])",
    ".guide-modal-root:not([hidden])",
    ".external-modal:not([hidden])",
    ".mission-lab:not([hidden])",
    ".update-modal:not([hidden])",
    ".company-lab:not([hidden])",
    ".trace-lab:not([hidden])",
    ".command-root:not([hidden])",
    ".chat-window",
    "#detailDrawer.open"
  ].join(", ");

  function syncAppInert() {
    const app = document.getElementById("app");
    if (!app) return;
    const hasModal = !!document.querySelector(OTHER_MODALS + ", .ai-setup-root:not([hidden])");
    app.inert = hasModal;
  }

  function focusable(root) {
    return Array.from(root.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (node) {
      return node.offsetParent !== null;
    });
  }

  class AISetup {
    constructor(root) {
      this.root = root;
      this.step = 1;
      this.providers = [];
      this.selectedId = "";
      this.draft = { apiKey: "", baseUrl: "", model: "", useEnvironment: false };
      this.busy = false;
      this.error = "";
      this.loadError = "";
      this.result = null;
      this.success = false;
      this.previousFocus = null;
      if (!this.root) return;
      this.bind();
      this.root.hidden = true;
    }

    t(key, vars) {
      return AO.t(key, vars);
    }

    provider() {
      return this.providers.find((item) => item.id === this.selectedId) || null;
    }

    bind() {
      const self = this;
      this.root.addEventListener("click", function (event) {
        if (event.target.closest("[data-ai-setup-close]")) {
          event.preventDefault();
          self.close();
          return;
        }
        const provider = event.target.closest("[data-ai-provider]");
        if (provider) {
          self.choose(provider.getAttribute("data-ai-provider"));
          return;
        }
        if (event.target.closest("[data-ai-setup-retry]")) {
          self.load();
          return;
        }
        if (event.target.closest("[data-ai-setup-back]")) {
          self.back();
          return;
        }
        if (event.target.closest("[data-ai-setup-next]")) {
          self.next();
          return;
        }
        if (event.target.closest("[data-ai-auth-env]")) {
          self.readDraft();
          self.draft.useEnvironment = true;
          self.error = "";
          self.render();
          return;
        }
        if (event.target.closest("[data-ai-auth-key]")) {
          self.readDraft();
          self.draft.useEnvironment = false;
          self.error = "";
          self.render();
          return;
        }
        if (event.target.closest("[data-ai-setup-test]")) {
          self.testAndSave();
          return;
        }
        if (event.target.closest("[data-ai-setup-done]")) {
          self.close();
        }
      });
      document.addEventListener("keydown", function (event) {
        if (!self.root || self.root.hidden) return;
        if (event.key === "Escape") {
          self.close();
          return;
        }
        if (event.key === "Tab") {
          const nodes = focusable(self.root);
          if (!nodes.length) return;
          const first = nodes[0];
          const last = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      });
      document.addEventListener("agent-office:lang", function () {
        if (self.root && !self.root.hidden) self.render();
      });
    }

    async open() {
      if (!this.root) return;
      this.previousFocus = document.activeElement;
      this.step = 1;
      this.selectedId = "";
      this.busy = false;
      this.error = "";
      this.loadError = "";
      this.result = null;
      this.success = false;
      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      document.body.classList.add("ai-setup-open");
      syncAppInert();
      this.render();
      this.focusClose();
      await this.load();
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      document.body.classList.remove("ai-setup-open");
      syncAppInert();
      if (this.previousFocus && typeof this.previousFocus.focus === "function") {
        try { this.previousFocus.focus(); } catch (err) {}
      }
    }

    focusClose() {
      const close = this.root && this.root.querySelector("[data-ai-setup-close]");
      if (close) {
        try { close.focus(); } catch (err) {}
      }
    }

    async fetchJson(path, options) {
      const opts = options || {};
      const controller = new AbortController();
      const timer = window.setTimeout(function () { controller.abort(); }, opts.timeout || 45000);
      try {
        const response = await fetch(bridge() + path, {
          cache: "no-store",
          method: opts.method || "GET",
          headers: { "Content-Type": "application/json" },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: controller.signal
        });
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (err) { data = { error: text }; }
        if (!response.ok) {
          const error = new Error(data.error || ("HTTP " + response.status));
          error.code = data.code || "http_" + response.status;
          throw error;
        }
        return data;
      } catch (err) {
        if (err && err.name === "AbortError") {
          const timeout = new Error(this.t("aiSetupTesting"));
          timeout.code = "timeout";
          throw timeout;
        }
        throw err;
      } finally {
        window.clearTimeout(timer);
      }
    }

    async load() {
      this.busy = true;
      this.loadError = "";
      this.render();
      try {
        const data = await this.fetchJson("/providers", { timeout: 10000 });
        this.providers = (data.providers || []).slice().sort(function (a, b) {
          const score = function (item) {
            if (item.detected) return 0;
            if (item.configured) return 1;
            if (item.localReady) return 2;
            return 3;
          };
          return score(a) - score(b);
        });
        if (data.configError) this.loadError = data.configError;
      } catch (err) {
        this.providers = [];
        this.loadError = err.message || this.t("aiSetupLoadFailed");
      } finally {
        this.busy = false;
        this.render();
      }
    }

    choose(id) {
      const provider = this.providers.find((item) => item.id === id);
      if (!provider) return;
      this.selectedId = id;
      this.draft = {
        apiKey: "",
        baseUrl: provider.baseUrl || "",
        model: provider.model || "",
        useEnvironment: !!provider.detected,
        pricingSource: provider.pricingSource || "none",
        pricingPreset: provider.pricingPreset || {},
        pricing: {
          inputPerMillion: provider.pricing && provider.pricing.inputPerMillion != null ?
            provider.pricing.inputPerMillion : "",
          outputPerMillion: provider.pricing && provider.pricing.outputPerMillion != null ?
            provider.pricing.outputPerMillion : "",
          currency: (provider.pricing && provider.pricing.currency) || "USD"
        }
      };
      this.step = 2;
      this.error = "";
      this.result = null;
      this.success = false;
      this.render();
    }

    readDraft() {
      if (!this.root) return;
      const key = this.root.querySelector("[name='aiKey']");
      const model = this.root.querySelector("[name='aiModel']");
      const base = this.root.querySelector("[name='aiBase']");
      const priceIn = this.root.querySelector("[name='aiPriceIn']");
      const priceOut = this.root.querySelector("[name='aiPriceOut']");
      const currency = this.root.querySelector("[name='aiPriceCurrency']");
      if (key) this.draft.apiKey = key.value;
      if (model) this.draft.model = model.value;
      if (base) this.draft.baseUrl = base.value;
      if (priceIn) this.draft.pricing.inputPerMillion = priceIn.value;
      if (priceOut) this.draft.pricing.outputPerMillion = priceOut.value;
      if (currency) this.draft.pricing.currency = currency.value;
    }

    next() {
      if (this.step === 2) {
        this.readDraft();
        const provider = this.provider();
        if (!provider) return;
        if (!String(this.draft.model || "").trim()) {
          this.error = this.t("aiSetupModel");
          this.render();
          return;
        }
        if (!this.draft.useEnvironment && !provider.keyOptional &&
            !provider.configured && !String(this.draft.apiKey || "").trim()) {
          this.error = this.t("aiSetupKey");
          this.render();
          return;
        }
        this.error = "";
        this.step = 3;
        this.render();
      }
    }

    back() {
      if (this.step === 1) return;
      if (this.step === 2) {
        this.readDraft();
        this.step = 1;
        this.error = "";
        this.render();
        return;
      }
      if (this.success) {
        this.step = 1;
        this.success = false;
        this.result = null;
        this.error = "";
        this.render();
        return;
      }
      this.step = 2;
      this.error = "";
      this.render();
    }

    async testAndSave() {
      if (this.busy) return;
      const provider = this.provider();
      if (!provider) return;
      this.busy = true;
      this.error = "";
      this.result = null;
      this.render();
      try {
        const payload = {
          model: String(this.draft.model || "").trim(),
          baseUrl: String(this.draft.baseUrl || "").trim(),
          useEnvironment: !!this.draft.useEnvironment
        };
        const key = String(this.draft.apiKey || "").trim();
        if (key) payload.apiKey = key;
        const priceIn = Number(this.draft.pricing.inputPerMillion || 0);
        const priceOut = Number(this.draft.pricing.outputPerMillion || 0);
        if (priceIn > 0 || priceOut > 0) {
          payload.pricing = {
            inputPerMillion: priceIn,
            outputPerMillion: priceOut,
            currency: String(this.draft.pricing.currency || "USD").trim().toUpperCase()
          };
        } else {
          payload.clearPricing = true;
        }
        const data = await this.fetchJson(
          "/providers/" + encodeURIComponent(provider.id) + "/configure",
          { method: "POST", body: payload, timeout: 60000 }
        );
        this.result = data;
        this.success = true;
        const fresh = data.provider || provider;
        this.providers = this.providers.map(function (item) {
          return item.id === fresh.id ? Object.assign({}, item, fresh) : item;
        });
        document.dispatchEvent(new CustomEvent("agent-office:ai-ready", {
          detail: { provider: fresh }
        }));
      } catch (err) {
        this.error = (err && err.message) || this.t("aiSetupFail");
      } finally {
        this.busy = false;
        this.render();
      }
    }

    pricingFields() {
      const pricing = this.draft.pricing || {};
      return '<div class="ai-price-grid">' +
        '<label class="ai-field"><span>' + esc(this.t("aiSetupPriceIn")) + '</span>' +
        '<input type="number" min="0" step="0.0001" name="aiPriceIn" value="' +
        esc(pricing.inputPerMillion == null ? "" : pricing.inputPerMillion) + '" /></label>' +
        '<label class="ai-field"><span>' + esc(this.t("aiSetupPriceOut")) + '</span>' +
        '<input type="number" min="0" step="0.0001" name="aiPriceOut" value="' +
        esc(pricing.outputPerMillion == null ? "" : pricing.outputPerMillion) + '" /></label>' +
        '<label class="ai-field"><span>' + esc(this.t("aiSetupPriceCurrency")) + '</span>' +
        '<input type="text" maxlength="8" name="aiPriceCurrency" value="' +
        esc(pricing.currency || "USD") + '" spellcheck="false" /></label></div>' +
        '<small class="ai-price-hint">' + esc(this.t("aiSetupPriceHint")) + '</small>';
    }

    badges(provider) {
      const out = [];
      if (provider.detected) out.push('<span class="ai-badge detected">' + esc(this.t("aiSetupDetected")) + '</span>');
      if (provider.local) out.push('<span class="ai-badge">' + esc(this.t("aiSetupLocalBadge")) + '</span>');
      if (provider.configured) out.push('<span class="ai-badge">' + esc(this.t("aiSetupConfiguredBadge")) + '</span>');
      if (provider.localReady) out.push('<span class="ai-badge ok">' + esc(this.t("aiSetupLocalReady")) + '</span>');
      else if (provider.local) out.push('<span class="ai-badge warn">' + esc(this.t("aiSetupLocalOffline")) + '</span>');
      return out.join("");
    }

    providerCard(provider) {
      const glyph = GLYPHS[provider.id] || String(provider.name || provider.id).slice(0, 2).toUpperCase();
      return '<button type="button" class="ai-provider-card' + (provider.detected ? ' detected' : '') +
        (this.selectedId === provider.id ? ' active' : '') + '" data-ai-provider="' + esc(provider.id) + '">' +
        '<span class="ai-provider-avatar" style="--c:' + esc(provider.color || "#55d6c2") + '">' + esc(glyph) + '</span>' +
        '<span class="ai-provider-copy"><b>' + esc(provider.name || provider.id) + '</b><em>' +
        esc(provider.vendor || provider.protocol || "") + ' · ' + esc(provider.model || "") + '</em></span>' +
        '<span class="ai-provider-badges">' + this.badges(provider) + '</span></button>';
    }

    stepBody() {
      const provider = this.provider();
      if (this.loadError) {
        return '<div class="ai-setup-error"><b>' + esc(this.t("aiSetupLoadFailed")) + '</b><p>' +
          esc(this.loadError) + '</p><button type="button" class="ai-btn" data-ai-setup-retry>' +
          esc(this.t("aiRefresh")) + '</button></div>';
      }
      if (this.busy && !this.providers.length) {
        return '<div class="ai-setup-loading"><span class="ai-spinner"></span>' + esc(this.t("aiLoading")) + '</div>';
      }
      if (this.step === 1) {
        const detected = this.providers.filter(function (item) { return item.detected; })[0];
        return '<p class="ai-setup-intro">' + esc(this.t("aiSetupIntro")) + '</p>' +
          (detected ? '<div class="ai-detect-banner"><span>✓</span><div><b>' +
            esc(this.t("aiSetupDetectedTitle")) + '</b><p>' +
            esc(this.t("aiSetupDetectedHint", { env: detected.keyEnv || "environment" })) +
            '</p></div><i>' + esc(detected.name || detected.id) + '</i></div>' : '') +
          '<div class="ai-provider-grid">' +
          (this.providers.length ? this.providers.map(this.providerCard.bind(this)).join("") :
            '<p class="ai-setup-empty">' + esc(this.t("aiSetupNoProviders")) + '</p>') +
          '</div>';
      }
      if (!provider) return '';
      if (this.step === 2) {
        const envMode = !!this.draft.useEnvironment;
        const baseVisible = provider.local;
        return '<div class="ai-picked"><span class="ai-provider-avatar" style="--c:' +
          esc(provider.color || "#55d6c2") + '">' + esc(GLYPHS[provider.id] || "AI") + '</span>' +
          '<div><b>' + esc(provider.name || provider.id) + '</b><em>' + esc(provider.vendor || "") +
          ' · ' + esc(provider.protocol || "") + '</em></div>' + this.badges(provider) + '</div>' +
          (provider.detected ? '<div class="ai-auth-switch">' +
            '<button type="button" class="' + (envMode ? "active" : "") + '" data-ai-auth-env>' +
            esc(this.t("aiSetupAuthEnv")) + '</button><button type="button" class="' +
            (!envMode ? "active" : "") + '" data-ai-auth-key>' + esc(this.t("aiSetupAuthFile")) +
            '</button></div>' + (envMode ? '<p class="ai-env-note">' +
              esc(this.t("aiSetupAuthEnvHint")) + ' <code>' + esc(provider.keyEnv || "env") +
              '</code></p>' : '') : '') +
          (!envMode ? '<label class="ai-field"><span>' + esc(this.t("aiSetupKey")) + '</span>' +
            '<input type="password" name="aiKey" autocomplete="off" spellcheck="false" placeholder="' +
            esc(provider.configured ? this.t("aiSetupKeyKeep") : this.t("aiSetupKeyPh")) + '"' +
            (provider.keyOptional ? ' aria-describedby="aiKeyOptional"' : '') + ' />' +
            (provider.keyOptional ? '<small id="aiKeyOptional">' + esc(this.t("aiSetupKeyOptional")) + '</small>' : '') +
            '</label>' : '') +
          '<label class="ai-field"><span>' + esc(this.t("aiSetupModel")) + '</span>' +
          '<input type="text" name="aiModel" value="' + esc(this.draft.model) + '" spellcheck="false" /></label>' +
          (baseVisible ? '<label class="ai-field"><span>' + esc(this.t("aiSetupBase")) + '</span>' +
            '<input type="text" name="aiBase" value="' + esc(this.draft.baseUrl) + '" spellcheck="false" /></label>' +
            '<details class="ai-advanced"><summary>' + esc(this.t("aiSetupPrice")) + '</summary>' +
            this.pricingFields() + '</details>' :
            '<details class="ai-advanced"><summary>' + esc(this.t("aiSetupAdvanced")) + '</summary>' +
            '<label class="ai-field"><span>' + esc(this.t("aiSetupBase")) + '</span>' +
            '<input type="text" name="aiBase" value="' + esc(this.draft.baseUrl) + '" spellcheck="false" /></label>' +
            this.pricingFields() +
            '</details>') +
          (this.error ? '<p class="ai-setup-error-text">' + esc(this.error) + '</p>' : '');
      }
      const auth = this.draft.useEnvironment ? this.t("aiSetupAuthEnv") : this.t("aiSetupAuthFile");
      const test = this.result && this.result.test ? this.result.test : null;
      return '<div class="ai-review">' +
        '<div><span>Provider</span><b>' + esc(provider.name || provider.id) + '</b></div>' +
        '<div><span>' + esc(this.t("aiSetupAuth")) + '</span><b>' + esc(auth) + '</b></div>' +
        '<div><span>' + esc(this.t("aiSetupModel")) + '</span><b>' + esc(this.draft.model) + '</b></div>' +
        '<div><span>' + esc(this.t("aiSetupBase")) + '</span><b>' + esc(this.draft.baseUrl) + '</b></div>' +
        '<div><span>' + esc(this.t("aiSetupPrice")) + '</span><b>' +
        esc((Number(this.draft.pricing.inputPerMillion || 0) ? this.draft.pricing.inputPerMillion : "0") +
          " / " + (Number(this.draft.pricing.outputPerMillion || 0) ? this.draft.pricing.outputPerMillion : "0") +
          " " + (this.draft.pricing.currency || "USD") + " / 1M") + '</b></div>' +
        '</div>' +
        (this.success ? '<div class="ai-success"><span>✓</span><div><b>' + esc(this.t("aiSetupSuccess")) +
          '</b><p>' + esc(this.t("aiSetupSuccessHint")) + '</p>' +
          (test ? '<small>' + esc(this.t("aiSetupTested")) + ' · ' + esc(test.model || "") + ' · ' +
            esc(this.t("aiSetupLatency", { ms: test.durationMs || 0,
              tokens: (test.tokensIn || 0) + (test.tokensOut || 0) })) + '</small>' : '') +
          '</div></div>' :
          (this.error ? '<div class="ai-setup-error"><b>' + esc(this.t("aiSetupFail")) + '</b><p>' +
            esc(this.error) + '</p><small>' + esc(this.t("aiSetupFailHint")) + '</small></div>' :
            '<p class="ai-setup-intro">' + esc(this.t("aiSetupTestHint")) + '</p>'));
    }

    stepState() {
      const labels = [this.t("aiSetupStep1"), this.t("aiSetupStep2"), this.t("aiSetupStep3")];
      return labels.map((label, index) => {
        const number = index + 1;
        const cls = this.step === number ? "active" : (this.step > number ? "done" : "");
        return '<div class="ai-step ' + cls + '"><b>' + (this.step > number ? "✓" : number) +
          '</b><span>' + esc(label) + '</span></div>';
      }).join("");
    }

    footer() {
      if (this.step === 1) {
        return '<span class="ai-privacy">' + esc(this.t("aiSetupPrivacy")) + '</span>' +
          '<div class="ai-setup-actions"><button type="button" class="ai-btn" data-ai-setup-close>' +
          esc(this.t("close")) + '</button></div>';
      }
      if (this.step === 2) {
        return '<span class="ai-privacy">' + esc(this.t("aiSetupPrivacy")) + '</span>' +
          '<div class="ai-setup-actions"><button type="button" class="ai-btn" data-ai-setup-back>' +
          esc(this.t("aiSetupBack")) + '</button><button type="button" class="ai-btn primary" data-ai-setup-next>' +
          esc(this.t("aiSetupNext")) + '</button></div>';
      }
      return '<span class="ai-privacy">' + esc(this.t("aiSetupPrivacy")) + '</span>' +
        '<div class="ai-setup-actions">' +
        (this.success ? '<button type="button" class="ai-btn" data-ai-setup-back>' +
          esc(this.t("aiSetupChange")) + '</button><button type="button" class="ai-btn primary" data-ai-setup-done>' +
          esc(this.t("aiSetupDone")) + '</button>' :
          '<button type="button" class="ai-btn" data-ai-setup-back' + (this.busy ? ' disabled' : '') + '>' +
          esc(this.t("aiSetupBack")) + '</button><button type="button" class="ai-btn primary" data-ai-setup-test' +
          (this.busy ? ' disabled' : '') + '>' + esc(this.busy ? this.t("aiSetupTesting") : this.t("aiSetupTest")) +
          '</button>') + '</div>';
    }

    render() {
      if (!this.root || this.root.hidden) return;
      this.root.innerHTML =
        '<div class="ai-setup-backdrop" data-ai-setup-close></div>' +
        '<section class="ai-setup-card" role="dialog" aria-modal="true" aria-labelledby="aiSetupTitle">' +
        '<header class="ai-setup-head"><div><span>AI CONNECT / 3 STEPS</span><h2 id="aiSetupTitle">' +
        esc(this.t("aiSetupTitle")) + '</h2><p>' + esc(this.t("aiSetupSub")) + '</p></div>' +
        '<button type="button" class="ai-setup-close" data-ai-setup-close aria-label="' +
        esc(this.t("close")) + '">×</button></header>' +
        '<div class="ai-setup-steps">' + this.stepState() + '</div>' +
        '<div class="ai-setup-body">' + this.stepBody() + '</div>' +
        '<footer class="ai-setup-foot">' + this.footer() + '</footer></section>';
    }
  }

  AO.AISetup = AISetup;
})();
