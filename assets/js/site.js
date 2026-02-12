(function () {
  const contentEl = document.getElementById("content");
  const docLinks = Array.from(document.querySelectorAll("[data-md]"));
  const defaultDoc = document.body.dataset.defaultDoc || "";
  const docRoot = document.body.dataset.docRoot || "";

  function getDocFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("doc");
    if (fromQuery) {
      return decodeURIComponent(fromQuery);
    }

    if (window.location.hash.startsWith("#doc=")) {
      return decodeURIComponent(window.location.hash.slice(5));
    }

    return defaultDoc;
  }

  function normalizeDocPath(rawDoc) {
    if (!rawDoc) {
      return "";
    }

    const normalized = rawDoc.replace(/\\/g, "/").replace(/^\.\//, "");
    const isMarkdown = normalized.toLowerCase().endsWith(".md");
    const hasTraversal = normalized.includes("..");
    const isUnderRoot = !docRoot || normalized.startsWith(docRoot);

    if (!isMarkdown || hasTraversal || !isUnderRoot) {
      return "";
    }

    return normalized;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function admonitionLabel(type) {
    const map = {
      info: "信息",
      note: "说明",
      tip: "提示",
      warning: "警告",
      danger: "危险",
      success: "成功"
    };
    return map[type] || "说明";
  }

  function renderAdmonition(type, title, bodyMarkdown) {
    const safeType = /^[a-z0-9_-]+$/.test(type) ? type : "note";
    const safeTitle = (title || "").trim() || admonitionLabel(safeType);
    const bodySource = transformAdmonitions(bodyMarkdown || "");

    let bodyHtml = "";
    if (window.marked) {
      bodyHtml = window.marked.parse(bodySource);
    } else {
      bodyHtml = escapeHtml(bodySource).replace(/\n/g, "<br>");
    }

    return (
      '<div class="md-admonition md-admonition-' +
      safeType +
      '">' +
      '<div class="md-admonition-title">' +
      escapeHtml(safeTitle) +
      "</div>" +
      '<div class="md-admonition-body">' +
      bodyHtml +
      "</div>" +
      "</div>"
    );
  }

  // Supports MkDocs/Python-Markdown style admonition blocks:
  // !!! info Title
  //     content line 1
  //     content line 2
  function transformAdmonitions(markdownText) {
    const normalized = String(markdownText || "").replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const output = [];
    let i = 0;

    while (i < lines.length) {
      const match = lines[i].match(/^!!!\s+([a-zA-Z][\w-]*)(?:\s+(.*))?$/);
      if (!match) {
        output.push(lines[i]);
        i += 1;
        continue;
      }

      const type = match[1].toLowerCase();
      const title = (match[2] || "").trim();
      i += 1;

      const bodyLines = [];
      while (i < lines.length) {
        const line = lines[i];
        if (/^( {4}|\t)/.test(line)) {
          bodyLines.push(line.replace(/^( {4}|\t)/, ""));
          i += 1;
          continue;
        }

        if (line.trim() === "" && i + 1 < lines.length && /^( {4}|\t)/.test(lines[i + 1])) {
          bodyLines.push("");
          i += 1;
          continue;
        }
        break;
      }

      output.push(renderAdmonition(type, title, bodyLines.join("\n").trimEnd()));
    }

    return output.join("\n");
  }

  function setActiveLink(docPath) {
    for (const link of docLinks) {
      const isActive = link.dataset.md === docPath;
      link.classList.toggle("active", isActive);
    }
  }

  function setContentHtml(html) {
    if (!contentEl) {
      return;
    }
    contentEl.innerHTML = html;
  }

  async function loadMarkdownFromUrl() {
    if (!contentEl) {
      return;
    }

    const docPath = normalizeDocPath(getDocFromLocation());
    if (!docPath) {
      setContentHtml('<p class="text-danger mb-0">无效的 Markdown 目标路径。</p>');
      setActiveLink("");
      return;
    }

    try {
      const response = await fetch(docPath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("无法读取文件: " + docPath);
      }

      const markdown = await response.text();
      const transformed = transformAdmonitions(markdown);
      const html = window.marked ? window.marked.parse(transformed) : transformed;
      setContentHtml(html);
      setActiveLink(docPath);
    } catch (error) {
      setContentHtml('<p class="text-danger mb-0">加载失败: ' + error.message + "</p>");
      setActiveLink("");
    }
  }

  function bindDocLinks() {
    for (const link of docLinks) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        const docPath = normalizeDocPath(link.dataset.md || "");
        if (!docPath) {
          return;
        }

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("doc", docPath);
        history.pushState({}, "", nextUrl);
        loadMarkdownFromUrl();
      });
    }
  }

  function bindQuickAnalysis() {
    const inputEl = document.getElementById("dataFileInput");
    const runBtn = document.getElementById("runAnalysisBtn");
    const resultEl = document.getElementById("analysisResult");

    if (!inputEl || !runBtn || !resultEl) {
      return;
    }

    runBtn.addEventListener("click", function () {
      const file = inputEl.files && inputEl.files[0];
      if (!file) {
        resultEl.classList.remove("text-muted");
        resultEl.textContent = "请先选择文件，再运行分析。";
        return;
      }

      const reader = new FileReader();
      reader.onload = function () {
        const text = String(reader.result || "");
        const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const firstLine = lines[0] || "";
        const columns = firstLine ? firstLine.split(",").length : 0;
        const rowCount = Math.max(lines.length - 1, 0);
        const preview = lines.slice(0, 4).join("\n");

        resultEl.classList.remove("text-muted");
        resultEl.textContent =
          "文件名: " +
          file.name +
          "\n估算数据行数（不含表头）: " +
          rowCount +
          "\n估算列数: " +
          columns +
          "\n\n预览内容:\n" +
          preview;
      };

      reader.onerror = function () {
        resultEl.classList.remove("text-muted");
        resultEl.textContent = "文件读取失败。";
      };

      reader.readAsText(file);
    });
  }

  bindDocLinks();
  bindQuickAnalysis();
  loadMarkdownFromUrl();
  window.addEventListener("popstate", loadMarkdownFromUrl);
})();
