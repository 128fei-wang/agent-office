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

  function t(key, fallback) {
    try {
      const value = AO.t(key);
      return value && value !== key ? value : (fallback || key);
    } catch (err) {
      return fallback || key;
    }
  }

  function safeUrl(value) {
    const url = String(value || "").trim();
    return /^https?:\/\//i.test(url) ? url : "";
  }

  function escapeAttr(value) {
    return esc(value).replace(/`/g, "&#96;");
  }

  function inline(raw) {
    let text = esc(raw);
    const tokens = [];
    function stash(html) {
      const key = "\u0000" + tokens.length + "\u0000";
      tokens.push(html);
      return key;
    }
    // Inline code must be protected before links/emphasis.
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      return stash("<code>" + code + "</code>");
    });
    // Links: [label](https://...)
    text = text.replace(/\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
      const href = safeUrl(url.replace(/&amp;/g, "&"));
      if (!href) return label;
      return stash('<a href="' + escapeAttr(href) +
        '" target="_blank" rel="noopener noreferrer">' + label + "</a>");
    });
    // Bare URLs, kept short and safe.
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (_, lead, url) {
      const href = safeUrl(url.replace(/&amp;/g, "&"));
      if (!href) return lead + url;
      return lead + stash('<a href="' + escapeAttr(href) +
        '" target="_blank" rel="noopener noreferrer">' + url + "</a>");
    });
    text = text
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    return text.replace(/\u0000(\d+)\u0000/g, function (_, index) {
      return tokens[Number(index)] || "";
    });
  }

  function blocks(raw) {
    const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let paragraph = [];
    let list = null;
    let quote = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
      paragraph = [];
    }
    function flushList() {
      if (!list) return;
      out.push("<" + list.type + ">" + list.items.map(function (item) {
        return "<li>" + inline(item) + "</li>";
      }).join("") + "</" + list.type + ">");
      list = null;
    }
    function flushQuote() {
      if (!quote.length) return;
      out.push("<blockquote>" + quote.map(inline).join("<br>") + "</blockquote>");
      quote = [];
    }
    function flushAll() {
      flushParagraph();
      flushList();
      flushQuote();
    }

    lines.forEach(function (line) {
      if (!line.trim()) {
        flushAll();
        return;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushAll();
        out.push("<h4>" + inline(heading[2]) + "</h4>");
        return;
      }
      if (/^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line.trim())) {
        flushAll();
        out.push("<hr>");
        return;
      }
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      if (ordered || unordered) {
        flushParagraph();
        flushQuote();
        const type = ordered ? "ol" : "ul";
        if (!list || list.type !== type) {
          flushList();
          list = { type: type, items: [] };
        }
        list.items.push((ordered || unordered)[1]);
        return;
      }
      const quoted = line.match(/^\s*>\s?(.*)$/);
      if (quoted) {
        flushParagraph();
        flushList();
        quote.push(quoted[1]);
        return;
      }
      if (quote.length) flushQuote();
      if (list) flushList();
      paragraph.push(line);
    });
    flushAll();
    return out.join("");
  }

  function markdown(value) {
    const text = String(value == null ? "" : value)
      .replace(/\r\n/g, "\n")
      .replace(/\u0000/g, "");
    const out = [];
    const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
    let last = 0;
    let match;
    while ((match = fence.exec(text))) {
      if (match.index > last) out.push(blocks(text.slice(last, match.index)));
      const lang = String(match[1] || "").trim().slice(0, 24).toUpperCase() || "CODE";
      const code = match[2].replace(/\n$/, "");
      out.push('<div class="chat-code"><div class="chat-code-head"><span>' + esc(lang) +
        '</span><button type="button" class="chat-code-copy" data-copy-code="' +
        escapeAttr(encodeURIComponent(code)) + '">' + esc(t("chatCopy", "复制")) +
        "</button></div><pre><code>" + esc(code) + "</code></pre></div>");
      last = fence.lastIndex;
    }
    if (last < text.length) out.push(blocks(text.slice(last)));
    return '<div class="chat-markdown">' + (out.join("") || "<p></p>") + "</div>";
  }

  function dateValue(value) {
    if (!value) return null;
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function dayKey(value) {
    const date = dateValue(value);
    if (!date) return "";
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }

  function dayLabel(value, translator) {
    const date = dateValue(value);
    if (!date) return "";
    const now = new Date();
    const today = dayKey(now);
    const key = dayKey(date);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (key === today) return translator ? translator("chatToday") : "今天";
    if (key === dayKey(yesterday)) return translator ? translator("chatYesterday") : "昨天";
    if (AO.lang === "en") {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return (date.getMonth() + 1) + "月" + date.getDate() + "日";
  }

  function clock(value) {
    const date = dateValue(value);
    if (!date) return "";
    return String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0");
  }

  function smartTime(value) {
    const date = dateValue(value);
    if (!date) return "";
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return t("chatJustNow", "刚刚");
    if (dayKey(date) === dayKey(now)) return clock(date);
    if (diff < 86400000 * 2) return t("chatYesterday", "昨天");
    return (date.getMonth() + 1) + "/" + date.getDate();
  }

  function initials(name) {
    const text = String(name || "?").trim();
    if (!text) return "?";
    const parts = text.split(/[\s·._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  function fmtSize(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  function avatar(member, options) {
    const opts = options || {};
    const item = member || {};
    const name = item.titleZh || item.name || item.senderName || item.id || "?";
    const classes = ["chat-avatar"];
    if (opts.className) classes.push(opts.className);
    if (item.logoUrl && AO.logoClass) classes.push(...String(AO.logoClass(item)).split(/\s+/).filter(Boolean));
    const size = opts.size ? ' style="--avatar-size:' + Number(opts.size) + 'px;--c:' +
      esc(item.logoColor || "#55d6c2") + '"' :
      ' style="--c:' + esc(item.logoColor || "#55d6c2") + '"';
    let body;
    if (item.logoUrl && AO.logoMarkHTML) {
      body = AO.logoMarkHTML(item);
    } else if (item.avatar === "emoji" || item.logoText && /\p{Extended_Pictographic}/u.test(item.logoText)) {
      body = esc(item.logoText || initials(name));
    } else {
      body = esc(item.logoText || initials(name));
    }
    return '<span class="' + esc(classes.join(" ")) + '"' + size +
      ' title="' + escapeAttr(name) + '">' + body + "</span>";
  }

  function rawFileUrl(bridge, artifact) {
    const base = String(bridge || "").replace(/\/+$/, "");
    const path = artifact && artifact.url ? artifact.url : "/files/" +
      encodeURIComponent((artifact && artifact.id) || "") + "/raw";
    return /^https?:\/\//i.test(path) ? path : base + path;
  }

  function attachments(items, bridge, options) {
    if (!items || !items.length) return "";
    const opts = options || {};
    return '<div class="chat-attachments">' + items.map(function (item) {
      const url = rawFileUrl(bridge, item);
      const image = item.kind === "image" || /^image\//i.test(item.mime || "");
      if (image) {
        return '<a class="chat-attach chat-attach-image" href="' + escapeAttr(url) +
          '" target="_blank" rel="noopener noreferrer" data-chat-file="' + escapeAttr(item.id || "") +
          '"><img src="' + escapeAttr(url) + '" alt="' + escapeAttr(item.name || "image") +
          '" loading="lazy" /><span>' + esc(item.name || "image") + "</span></a>";
      }
      return '<a class="chat-attach chat-attach-file" href="' + escapeAttr(url) +
        '" target="_blank" rel="noopener noreferrer" download="' + escapeAttr(item.name || "file") +
        '" data-chat-file="' + escapeAttr(item.id || "") + '"><i>' +
        esc(String(item.name || "FILE").split(".").pop().slice(0, 4).toUpperCase()) +
        '</i><span><b>' + esc(item.name || "file") + "</b><em>" +
        esc(fmtSize(item.size)) + "</em></span></a>";
    }).join("") + "</div>";
  }

  function quoteHTML(quote) {
    if (!quote || !quote.text) return "";
    return '<div class="chat-quote"><b>' + esc(quote.senderName || quote.name || "") +
      '</b><span>' + esc(String(quote.text).slice(0, 180)) + "</span></div>";
  }

  function copyText(value) {
    const text = String(value == null ? "" : value);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest("[data-copy-code]");
    if (!button) return;
    event.preventDefault();
    let value = "";
    try { value = decodeURIComponent(button.getAttribute("data-copy-code") || ""); }
    catch (err) { value = ""; }
    copyText(value).then(function () {
      const original = button.textContent;
      button.textContent = t("chatCopied", "已复制");
      button.classList.add("copied");
      window.setTimeout(function () {
        button.textContent = original;
        button.classList.remove("copied");
      }, 1200);
    }).catch(function () {});
  });

  AO.ChatUI = {
    esc: esc,
    markdown: markdown,
    inline: inline,
    dayKey: dayKey,
    dayLabel: dayLabel,
    clock: clock,
    smartTime: smartTime,
    initials: initials,
    fmtSize: fmtSize,
    avatar: avatar,
    attachments: attachments,
    quoteHTML: quoteHTML,
    copyText: copyText,
    rawFileUrl: rawFileUrl
  };
})();
