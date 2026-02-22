(function () {
  const workbookInput = document.getElementById("workbookInput");
  const workbookStatus = document.getElementById("workbookStatus");
  const sheetTabList = document.getElementById("sheetTabList");
  const sheetPreviewTable = document.getElementById("sheetPreviewTable");
  const plotScriptSelect = document.getElementById("plotScriptSelect");
  const scriptParamRow = document.getElementById("scriptParamRow");
  const scriptDoc = document.getElementById("scriptDoc");
  const generatePlotBtn = document.getElementById("generatePlotBtn");
  const downloadPlotBtn = document.getElementById("downloadPlotBtn");
  const plotStatus = document.getElementById("plotStatus");
  const plotResult = document.getElementById("plotResult");

  if (
    !workbookInput || !workbookStatus || !sheetTabList || !sheetPreviewTable ||
    !plotScriptSelect || !scriptParamRow || !scriptDoc || !generatePlotBtn ||
    !downloadPlotBtn || !plotStatus || !plotResult
  ) return;

  const summaryLabels = new Set(["total", "sum", "总计", "总和", "合计"]);
  let mathJaxLoader = null;
  let mermaidLoader = null;

  const scriptRegistry = [
    {
      id: "pathway_compare",
      label: "通路对比",
      docName: "通路对比",
      params: [
        { key: "sheetA", label: "样本 Sheet A", type: "sheet", col: "col-lg-4" },
        { key: "sheetB", label: "样本 Sheet B", type: "sheet", col: "col-lg-4" },
        { key: "title", label: "图像标题", type: "text", col: "col-lg-4", placeholder: "留空则使用默认标题" }
      ],
      run: async function (params) {
        await drawPathwayCompare(params.sheetA, params.sheetB, params.title);
      }
    },
    {
      id: "corr_heatmap",
      label: "相关性热图",
      docName: "相关性热图",
      params: [
        { key: "sheetA", label: "样本 Sheet A", type: "sheet", col: "col-lg-3" },
        { key: "sheetB", label: "样本 Sheet B", type: "sheet", col: "col-lg-3" },
        {
          key: "corrMode",
          label: "相关范围",
          type: "select",
          col: "col-lg-3",
          options: [
            { value: "all", label: "全部 (-1 ~ 1)" },
            { value: "positive", label: "仅正相关 (> 0)" },
            { value: "negative", label: "仅负相关 (< 0)" }
          ],
          default: "all"
        },
        {
          key: "avgReplicate",
          label: "重复列均值化",
          hint: "按列名前缀合并重复列（可选）",
          type: "checkbox",
          col: "col-lg-3",
          default: false
        },
        { key: "title", label: "图像标题", type: "text", col: "col-lg-6", placeholder: "留空则使用默认标题" }
      ],
      run: async function (params) {
        await drawCorrHeatmap(params.sheetA, params.sheetB, params.corrMode || "all", Boolean(params.avgReplicate), params.title);
      }
    }
  ];

  const state = {
    workbook: null,
    sheetNames: [],
    activePreviewSheet: "",
    selectedScriptId: scriptRegistry[0].id,
    params: {},
    hasPlot: false
  };

  function currentScript() {
    return scriptRegistry.find((item) => item.id === state.selectedScriptId) || scriptRegistry[0];
  }

  function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function setWorkbookStatus(text, isError) {
    workbookStatus.textContent = text;
    workbookStatus.classList.toggle("text-danger", Boolean(isError));
    workbookStatus.classList.toggle("text-muted", !isError);
  }

  function setPlotStatus(text, isError) {
    plotStatus.textContent = text;
    plotStatus.classList.toggle("text-danger", Boolean(isError));
    plotStatus.classList.toggle("text-muted", !isError);
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function nonEmptyRows(rows) {
    return rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  }

  function getSheetRows(sheetName) {
    if (!state.workbook) return [];
    const ws = state.workbook.Sheets[sheetName];
    if (!ws) return [];
    return nonEmptyRows(XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }));
  }

  function renderSheetPreview(sheetName) {
    const rows = getSheetRows(sheetName);
    const thead = sheetPreviewTable.querySelector("thead");
    const tbody = sheetPreviewTable.querySelector("tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td class="text-muted text-center">该 Sheet 为空</td></tr>';
      return;
    }

    const maxCols = Math.min(12, Math.max(...rows.map((r) => r.length)));
    const maxRows = Math.min(12, rows.length);
    const headerRow = rows[0];

    const th = [];
    for (let c = 0; c < maxCols; c += 1) {
      const label = String(headerRow[c] ?? "").trim() || "列 " + (c + 1);
      th.push("<th>" + escapeHtml(label) + "</th>");
    }
    thead.innerHTML = "<tr>" + th.join("") + "</tr>";

    for (let r = 1; r < maxRows; r += 1) {
      const row = rows[r];
      const td = [];
      for (let c = 0; c < maxCols; c += 1) td.push("<td>" + escapeHtml(String(row[c] ?? "")) + "</td>");
      tbody.insertAdjacentHTML("beforeend", "<tr>" + td.join("") + "</tr>");
    }
  }

  function setActivePreviewButton(sheetName) {
    sheetTabList.querySelectorAll("button[data-sheet]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sheet === sheetName);
    });
  }

  function renderSheetButtons() {
    sheetTabList.innerHTML = "";
    state.sheetNames.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline-primary";
      btn.dataset.sheet = name;
      btn.textContent = name;
      btn.addEventListener("click", function () {
        state.activePreviewSheet = name;
        setActivePreviewButton(name);
        renderSheetPreview(name);
      });
      sheetTabList.appendChild(btn);
    });
  }
  function normalizeMdPath(path) {
    const normalized = String(path || "").replaceAll("\\", "/").replace(/^\.\//, "");
    if (!normalized || !normalized.toLowerCase().endsWith(".md") || normalized.includes("..")) return "";
    return normalized;
  }

  function isExternalLike(url) {
    return /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(url);
  }

  function resolveUrlFromMd(url, docPath) {
    const raw = String(url || "").trim();
    if (!raw || isExternalLike(raw) || raw.startsWith("data:")) return raw;
    try {
      const mdBase = new URL(docPath, window.location.href);
      return new URL(raw, mdBase).href;
    } catch (_) {
      return raw;
    }
  }

  function rewriteAssetUrlsByDocPath(html, docPath) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html || "";

    wrapper.querySelectorAll("img[src], source[src]").forEach((node) => {
      const src = node.getAttribute("src");
      const resolved = resolveUrlFromMd(src, docPath);
      if (resolved) node.setAttribute("src", resolved);
    });

    wrapper.querySelectorAll("img[srcset], source[srcset]").forEach((node) => {
      const srcset = node.getAttribute("srcset");
      if (!srcset) return;
      const rebuilt = srcset
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const chunks = part.split(/\s+/);
          const url = chunks[0];
          const desc = chunks.slice(1).join(" ");
          const resolved = resolveUrlFromMd(url, docPath);
          return desc ? resolved + " " + desc : resolved;
        })
        .join(", ");
      node.setAttribute("srcset", rebuilt);
    });

    return wrapper.innerHTML;
  }

  function admonitionLabel(type) {
    const map = { info: "信息", note: "说明", tip: "提示", warning: "警告", danger: "危险", success: "成功", error: "错误" };
    return map[type] || "说明";
  }

  function renderAdmonition(type, title, bodyMarkdown) {
    const safeType = /^[a-z0-9_-]+$/.test(type) ? type : "note";
    const safeTitle = (title || "").trim() || admonitionLabel(safeType);
    const bodySource = transformAdmonitions(bodyMarkdown || "");
    const bodyHtml = window.marked ? window.marked.parse(bodySource) : escapeHtml(bodySource).replace(/\n/g, "<br>");
    return (
      '<div class="md-admonition md-admonition-' + safeType + '">' +
      '<div class="md-admonition-title">' + escapeHtml(safeTitle) + "</div>" +
      '<div class="md-admonition-body">' + bodyHtml + "</div>" +
      "</div>"
    );
  }

  function transformAdmonitions(markdownText) {
    const lines = String(markdownText || "").replace(/\r\n?/g, "\n").split("\n");
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
      const title = (match[2] || "").trim().replace(/^["']|["']$/g, "");
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

  function ensureMathJaxConfig() {
    if (window.MathJax) return;
    window.MathJax = {
      tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] },
      options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"] }
    };
  }

  function ensureMathJaxLoaded() {
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") return Promise.resolve();
    if (mathJaxLoader) return mathJaxLoader;

    ensureMathJaxConfig();
    mathJaxLoader = new Promise((resolve) => {
      const existing = document.querySelector('script[data-role="mathjax-tex"]');
      if (existing) {
        if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
          resolve();
          return;
        }
        let attempts = 0;
        const timer = window.setInterval(() => {
          attempts += 1;
          if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
            window.clearInterval(timer);
            resolve();
            return;
          }
          if (attempts >= 40) {
            window.clearInterval(timer);
            resolve();
          }
        }, 100);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      script.dataset.role = "mathjax-tex";
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => resolve(), { once: true });
      document.head.appendChild(script);
    });
    return mathJaxLoader;
  }

  async function renderMathIn(element) {
    if (!element) return;
    await ensureMathJaxLoaded();
    if (!window.MathJax || typeof window.MathJax.typesetPromise !== "function") return;
    try {
      if (typeof window.MathJax.typesetClear === "function") window.MathJax.typesetClear([element]);
      await window.MathJax.typesetPromise([element]);
    } catch (_) {}
  }

  function extractMermaidBlocks(container) {
    if (!container) return [];
    const blocks = container.querySelectorAll(
      "pre > code.language-mermaid, pre > code.lang-mermaid, pre > code[data-lang='mermaid']"
    );
    const converted = [];
    blocks.forEach((code) => {
      const pre = code.parentElement;
      if (!pre) return;
      const host = document.createElement("div");
      host.className = "mermaid";
      host.textContent = code.textContent || "";
      pre.replaceWith(host);
      converted.push(host);
    });
    return converted;
  }

  function ensureMermaidLoaded() {
    if (window.mermaid && typeof window.mermaid.run === "function") {
      return Promise.resolve(window.mermaid);
    }
    if (mermaidLoader) return mermaidLoader;

    mermaidLoader = new Promise((resolve) => {
      const existing = document.querySelector('script[data-role="mermaid-lib"]');
      if (existing) {
        let attempts = 0;
        const timer = window.setInterval(() => {
          attempts += 1;
          if (window.mermaid && typeof window.mermaid.run === "function") {
            window.clearInterval(timer);
            resolve(window.mermaid);
            return;
          }
          if (attempts >= 40) {
            window.clearInterval(timer);
            resolve(null);
          }
        }, 100);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
      script.async = true;
      script.dataset.role = "mermaid-lib";
      script.addEventListener("load", function () {
        if (window.mermaid && typeof window.mermaid.initialize === "function") {
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: "loose",
            theme: "base",
            themeVariables: {
              background: "#ffffff",
              primaryColor: "#e8f3f7",
              primaryTextColor: "#1d2833",
              primaryBorderColor: "#1f6f8b",
              secondaryColor: "#e8eef9",
              secondaryTextColor: "#1d2833",
              secondaryBorderColor: "#2f5ea8",
              tertiaryColor: "#e7f6f1",
              tertiaryTextColor: "#1d2833",
              tertiaryBorderColor: "#2f8f73",
              lineColor: "#4e6273",
              defaultLinkColor: "#4e6273",
              edgeLabelBackground: "#ffffff",
              clusterBkg: "#f8fbff",
              clusterBorder: "#c5882a",
              nodeBorder: "#1f6f8b",
              mainBkg: "#ffffff",
              fontFamily: "HarmonyOS Sans Black, sans-serif"
            }
          });
        }
        resolve(window.mermaid || null);
      });
      script.addEventListener("error", function () {
        resolve(null);
      });
      document.head.appendChild(script);
    });

    return mermaidLoader;
  }

  async function renderMermaidIn(element) {
    if (!element) return;
    const converted = extractMermaidBlocks(element);
    const hosts = converted.length > 0 ? converted : Array.from(element.querySelectorAll(".mermaid"));
    if (hosts.length === 0) return;

    const mermaid = await ensureMermaidLoaded();
    if (!mermaid || typeof mermaid.run !== "function") return;

    hosts.forEach((node) => node.removeAttribute("data-processed"));
    try {
      await mermaid.run({ nodes: hosts });
    } catch (_) {
      // Keep page usable if mermaid parse fails.
    }
  }

  async function loadScriptDoc(scriptDef) {
    const docPath = normalizeMdPath("scripts/" + scriptDef.docName + ".md");
    if (!docPath) {
      scriptDoc.innerHTML = '<p class="text-danger mb-0">脚本说明路径无效。</p>';
      return;
    }

    try {
      const resp = await fetch(encodeURI(docPath), { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const md = await resp.text();
      const transformed = transformAdmonitions(md);
      const html = window.marked ? window.marked.parse(transformed) : escapeHtml(transformed);
      scriptDoc.innerHTML = rewriteAssetUrlsByDocPath(html, docPath);
      await renderMermaidIn(scriptDoc);
      await renderMathIn(scriptDoc);
    } catch (_) {
      scriptDoc.innerHTML = '<p class="text-muted mb-0">未找到脚本说明文件：<code>' + escapeHtml(docPath) + "</code></p>";
    }
  }
  function defaultSheetValue(index) {
    if (state.sheetNames.length === 0) return "";
    return state.sheetNames[Math.min(index, state.sheetNames.length - 1)];
  }

  function createSelectControl(param, value, options, disabled) {
    const col = document.createElement("div");
    col.className = param.col || "col-lg-4";

    const label = document.createElement("label");
    label.className = "form-label";
    label.setAttribute("for", "param-" + param.key);
    label.textContent = param.label;

    const select = document.createElement("select");
    select.className = "form-select";
    select.id = "param-" + param.key;
    select.dataset.paramKey = param.key;
    select.disabled = Boolean(disabled);

    options.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });

    if (value != null && options.some((item) => item.value === value)) select.value = value;
    else if (param.default != null && options.some((item) => item.value === param.default)) select.value = param.default;

    select.addEventListener("change", function () {
      state.params[param.key] = select.value;
    });

    col.appendChild(label);
    col.appendChild(select);
    return col;
  }

  function createCheckboxControl(param, value, disabled) {
    const col = document.createElement("div");
    col.className = param.col || "col-lg-3";

    const wrapper = document.createElement("div");
    wrapper.className = "form-check mt-4 pt-1";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.id = "param-" + param.key;
    input.dataset.paramKey = param.key;
    input.disabled = Boolean(disabled);
    input.checked = value == null ? Boolean(param.default) : Boolean(value);
    input.addEventListener("change", function () {
      state.params[param.key] = input.checked;
    });

    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", input.id);
    label.textContent = param.label;

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    col.appendChild(wrapper);

    if (param.hint) {
      const hint = document.createElement("div");
      hint.className = "small text-muted mt-1";
      hint.textContent = param.hint;
      col.appendChild(hint);
    }

    return col;
  }

  function createTextControl(param, value, disabled) {
    const col = document.createElement("div");
    col.className = param.col || "col-lg-4";

    const label = document.createElement("label");
    label.className = "form-label";
    label.setAttribute("for", "param-" + param.key);
    label.textContent = param.label;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    input.id = "param-" + param.key;
    input.dataset.paramKey = param.key;
    input.disabled = Boolean(disabled);
    input.placeholder = param.placeholder || "";
    input.value = value == null ? param.default || "" : String(value);
    input.addEventListener("input", function () {
      state.params[param.key] = input.value;
    });

    col.appendChild(label);
    col.appendChild(input);
    return col;
  }

  function renderParamControls() {
    scriptParamRow.innerHTML = "";
    const scriptDef = currentScript();
    const hasWorkbook = Boolean(state.workbook && state.sheetNames.length > 0);
    const memo = { ...state.params };

    scriptDef.params.forEach((param, idx) => {
      const oldValue = memo[param.key];

      if (param.type === "sheet") {
        const options = state.sheetNames.map((name) => ({ value: name, label: name }));
        if (options.length === 0) options.push({ value: "", label: "请先上传 Excel 文件" });
        const fallback = idx === 0 ? defaultSheetValue(0) : defaultSheetValue(1);
        scriptParamRow.appendChild(createSelectControl(param, oldValue != null ? oldValue : fallback, options, !hasWorkbook));
        return;
      }

      if (param.type === "select") {
        const options = (param.options || []).map((item) => ({ value: String(item.value), label: item.label }));
        scriptParamRow.appendChild(createSelectControl(param, oldValue != null ? String(oldValue) : param.default, options, false));
        return;
      }

      if (param.type === "checkbox") {
        scriptParamRow.appendChild(createCheckboxControl(param, oldValue, false));
        return;
      }

      if (param.type === "text") {
        scriptParamRow.appendChild(createTextControl(param, oldValue, false));
      }
    });

    const note = document.createElement("div");
    note.className = "col-12";
    note.innerHTML = hasWorkbook
      ? '<div class="small text-muted">参数根据脚本自动生成，可直接切换脚本查看不同参数。</div>'
      : '<div class="small text-muted">先上传 Excel 文件后，Sheet 参数会自动可选。</div>';
    scriptParamRow.appendChild(note);
  }

  function collectParamsFromDom(scriptDef) {
    const params = {};
    scriptDef.params.forEach((param) => {
      const el = document.getElementById("param-" + param.key);
      if (!el) return;
      if (param.type === "checkbox") params[param.key] = el.checked;
      else params[param.key] = el.value;
      state.params[param.key] = params[param.key];
    });
    return params;
  }

  function parsePathwaySheet(sheetName) {
    const rows = getSheetRows(sheetName);
    if (rows.length === 0) return [];

    let start = 0;
    if (!Number.isFinite(safeNumber(rows[0][1]))) start = 1;

    const out = [];
    for (let i = start; i < rows.length; i += 1) {
      const row = rows[i];
      const pathway = String(row[0] ?? "").trim();
      const value = safeNumber(row[1]);
      if (!pathway || !Number.isFinite(value)) continue;
      if (summaryLabels.has(pathway.toLowerCase())) continue;
      out.push({ pathway: pathway, probability: value });
    }
    return out;
  }

  function buildPathwayData(sheetA, sheetB) {
    const aRows = parsePathwaySheet(sheetA);
    const bRows = parsePathwaySheet(sheetB);
    if (aRows.length === 0 || bRows.length === 0) {
      throw new Error("通路对比要求两个 Sheet 都包含至少两列有效数据（通路名 + 数值）。");
    }

    const mapA = new Map();
    const mapB = new Map();
    aRows.forEach((row) => mapA.set(row.pathway, (mapA.get(row.pathway) || 0) + row.probability));
    bRows.forEach((row) => mapB.set(row.pathway, (mapB.get(row.pathway) || 0) + row.probability));

    return Array.from(new Set([...mapA.keys(), ...mapB.keys()]))
      .map((name) => {
        const a = mapA.get(name) || 0;
        const b = mapB.get(name) || 0;
        const total = a + b;
        if (total <= 0) return null;
        return { pathway: name, aRatio: a / total, bRatio: b / total };
      })
      .filter(Boolean)
      .sort((x, y) => y.aRatio - x.aRatio);
  }

  function extractExpressionRows(sheetName) {
    const rows = getSheetRows(sheetName);
    if (rows.length < 2) throw new Error("相关性热图至少需要：表头行 + 1 行数据。");

    const headers = rows[0].slice(1).map((h, i) => {
      const v = String(h ?? "").trim();
      return v || "Col_" + (i + 1);
    });

    const outRows = [];
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const gene = String(row[0] ?? "").trim();
      if (!gene) continue;
      const values = headers.map((_, idx) => safeNumber(row[idx + 1]));
      if (values.every((v) => Number.isNaN(v))) continue;
      outRows.push({ gene: gene, values: values });
    }

    if (outRows.length === 0) throw new Error("未找到有效表达数据行。");
    return { headers: headers, rows: outRows };
  }
  function groupLabel(colName) {
    const name = String(colName || "");
    const base = name.split(":", 1)[0];
    if (base.includes("_")) {
      const idx = base.lastIndexOf("_");
      const left = base.slice(0, idx);
      const right = base.slice(idx + 1);
      if (/^\d+$/.test(right)) return left;
    }
    if (base.includes("-")) {
      const idx = base.lastIndexOf("-");
      return base.slice(idx + 1) || base;
    }
    return base;
  }

  function averageByGroup(parsed) {
    const groups = [];
    const groupToIndices = new Map();

    parsed.headers.forEach((header, index) => {
      const group = groupLabel(header);
      if (!groupToIndices.has(group)) {
        groupToIndices.set(group, []);
        groups.push(group);
      }
      groupToIndices.get(group).push(index);
    });

    const rows = parsed.rows.map((item) => {
      const values = groups.map((group) => {
        const indices = groupToIndices.get(group) || [];
        const finite = indices.map((i) => item.values[i]).filter((v) => Number.isFinite(v));
        if (finite.length === 0) return NaN;
        return finite.reduce((acc, v) => acc + v, 0) / finite.length;
      });
      return { gene: item.gene, values: values };
    });

    return { headers: groups, rows: rows };
  }

  function rowsToGeneMap(parsed) {
    const map = new Map();
    parsed.rows.forEach((row) => map.set(row.gene, row.values));
    return map;
  }

  function pearson(xs, ys) {
    const pairs = [];
    for (let i = 0; i < xs.length; i += 1) {
      const x = xs[i];
      const y = ys[i];
      if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
    }
    if (pairs.length < 2) return NaN;

    const meanX = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
    const meanY = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;

    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    pairs.forEach((p) => {
      const dx = p[0] - meanX;
      const dy = p[1] - meanY;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    });

    const den = Math.sqrt(dx2 * dy2);
    if (den === 0) return NaN;
    return num / den;
  }

  function buildCorrData(sheetA, sheetB, mode, useAverage) {
    const parsedA = extractExpressionRows(sheetA);
    const parsedB = extractExpressionRows(sheetB);
    const exprA = useAverage ? averageByGroup(parsedA) : parsedA;
    const exprB = useAverage ? averageByGroup(parsedB) : parsedB;

    const mapA = rowsToGeneMap(exprA);
    const mapB = rowsToGeneMap(exprB);
    const commonGenes = Array.from(mapA.keys()).filter((g) => mapB.has(g));
    if (commonGenes.length < 2) throw new Error("两个 Sheet 的首列基因名交集不足，无法计算相关性。");

    const colsA = exprA.headers.map(() => []);
    const colsB = exprB.headers.map(() => []);
    commonGenes.forEach((gene) => {
      const va = mapA.get(gene);
      const vb = mapB.get(gene);
      for (let i = 0; i < exprA.headers.length; i += 1) colsA[i].push(va[i]);
      for (let j = 0; j < exprB.headers.length; j += 1) colsB[j].push(vb[j]);
    });

    const z = exprA.headers.map((_, i) =>
      exprB.headers.map((_, j) => {
        const r = pearson(colsA[i], colsB[j]);
        if (!Number.isFinite(r)) return null;
        if (mode === "positive" && r <= 0) return null;
        if (mode === "negative" && r >= 0) return null;
        return r;
      })
    );

    return { x: exprB.headers, y: exprA.headers, z: z };
  }

  async function drawPathwayCompare(sheetA, sheetB, titleText) {
    const rows = buildPathwayData(sheetA, sheetB);
    const labels = rows.map((r) => r.pathway);
    const count = rows.length;
    const plotHeight = Math.max(420, count * 26 + 140);

    plotResult.style.width = "100%";
    plotResult.style.maxWidth = "560px";
    plotResult.style.margin = "0 auto";
    plotResult.style.height = plotHeight + "px";

    const containerWidth = plotResult.clientWidth || 520;
    const plotWidth = Math.max(360, Math.min(560, containerWidth));
    const title = String(titleText || "").trim() || "Relative information flow";

    const traces = [
      { type: "bar", orientation: "h", y: labels, x: rows.map((r) => r.aRatio), name: sheetA, marker: { color: "rgba(244,122,122,0.90)" } },
      { type: "bar", orientation: "h", y: labels, x: rows.map((r) => r.bRatio), name: sheetB, marker: { color: "rgba(18,181,190,0.90)" } }
    ];

    await Plotly.newPlot(
      plotResult,
      traces,
      {
        barmode: "stack",
        title: { text: title, x: 0.5, xanchor: "center" },
        xaxis: { title: "Relative information flow", range: [0, 1], dtick: 0.25, tickformat: ".2f", zeroline: false },
        yaxis: { automargin: true, categoryorder: "array", categoryarray: labels },
        shapes: [{ type: "line", xref: "x", yref: "paper", x0: 0.5, x1: 0.5, y0: 0, y1: 1, line: { color: "rgba(90,90,90,0.50)", width: 1, dash: "dot" } }],
        width: plotWidth,
        height: plotHeight,
        legend: { x: 1.02, y: 0.5, xanchor: "left", yanchor: "middle", bgcolor: "rgba(255,255,255,0.62)" },
        margin: { l: 120, r: 80, t: 70, b: 70 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)"
      },
      { responsive: true, displayModeBar: false }
    );
  }

  async function drawCorrHeatmap(sheetA, sheetB, mode, useAverage, titleText) {
    const corr = buildCorrData(sheetA, sheetB, mode, useAverage);
    const title = String(titleText || "").trim() || ("Correlation Heatmap: " + sheetA + " vs " + sheetB);
    const plotHeight = Math.max(460, Math.min(960, corr.y.length * 20 + 200));

    plotResult.style.width = "100%";
    plotResult.style.maxWidth = "";
    plotResult.style.margin = "";
    plotResult.style.height = plotHeight + "px";

    const trace = {
      type: "heatmap",
      x: corr.x,
      y: corr.y,
      z: corr.z,
      colorscale: mode === "all" ? "RdBu" : "Magma",
      reversescale: mode === "negative",
      zmin: mode === "all" ? -1 : mode === "negative" ? -1 : 0,
      zmax: mode === "all" ? 1 : mode === "negative" ? 0 : 1,
      colorbar: { title: "Pearson r" },
      hovertemplate: "A: %{y}<br>B: %{x}<br>r=%{z:.3f}<extra></extra>"
    };

    await Plotly.newPlot(
      plotResult,
      [trace],
      { title: { text: title, x: 0.5, xanchor: "center" }, xaxis: { automargin: true }, yaxis: { automargin: true }, margin: { l: 140, r: 30, t: 70, b: 90 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)" },
      { responsive: true, displayModeBar: false }
    );
  }

  async function handleGeneratePlot() {
    const scriptDef = currentScript();
    if (!scriptDef) {
      setPlotStatus("未找到可用脚本。", true);
      return;
    }
    if (!state.workbook) {
      setPlotStatus("请先上传 xlsx 文件。", true);
      return;
    }

    const params = collectParamsFromDom(scriptDef);
    for (const param of scriptDef.params) {
      if ((param.type === "sheet" || param.type === "select") && !params[param.key]) {
        setPlotStatus("参数不完整: " + param.label, true);
        return;
      }
    }

    try {
      setPlotStatus("正在生成图像...", false);
      await scriptDef.run(params);
      state.hasPlot = true;
      downloadPlotBtn.disabled = false;
      setPlotStatus("图像已生成。", false);
    } catch (err) {
      state.hasPlot = false;
      downloadPlotBtn.disabled = true;
      setPlotStatus("生成失败: " + (err && err.message ? err.message : String(err)), true);
    }
  }

  async function handleDownloadPlot() {
    if (!state.hasPlot) return;
    try {
      const rect = plotResult.getBoundingClientRect();
      const width = Math.max(900, Math.min(2400, Math.round(rect.width * 2)));
      const height = Math.max(700, Math.min(4200, Math.round(rect.height * 2)));
      const prevPaper = plotResult.layout && plotResult.layout.paper_bgcolor ? plotResult.layout.paper_bgcolor : "rgba(0,0,0,0)";
      const prevPlot = plotResult.layout && plotResult.layout.plot_bgcolor ? plotResult.layout.plot_bgcolor : "rgba(0,0,0,0)";

      let dataUrl = "";
      try {
        // Export with white background while keeping on-page chart style unchanged.
        await Plotly.relayout(plotResult, {
          paper_bgcolor: "#ffffff",
          plot_bgcolor: "#ffffff"
        });
        dataUrl = await Plotly.toImage(plotResult, { format: "png", width: width, height: height, scale: 1 });
      } finally {
        await Plotly.relayout(plotResult, {
          paper_bgcolor: prevPaper,
          plot_bgcolor: prevPlot
        });
      }

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "analysis_plot_" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
      a.click();
    } catch (err) {
      setPlotStatus("下载失败: " + (err && err.message ? err.message : String(err)), true);
    }
  }

  async function loadWorkbook(file) {
    const data = await file.arrayBuffer();
    state.workbook = XLSX.read(data, { type: "array" });
    state.sheetNames = state.workbook.SheetNames || [];
    if (state.sheetNames.length === 0) throw new Error("该文件未检测到可用 Sheet。");

    renderSheetButtons();
    state.activePreviewSheet = state.sheetNames[0];
    setActivePreviewButton(state.activePreviewSheet);
    renderSheetPreview(state.activePreviewSheet);
    renderParamControls();
  }

  function clearWorkbookView() {
    state.workbook = null;
    state.sheetNames = [];
    state.activePreviewSheet = "";
    sheetTabList.innerHTML = "";
    sheetPreviewTable.querySelector("thead").innerHTML = "";
    sheetPreviewTable.querySelector("tbody").innerHTML = "";
    renderParamControls();
  }

  function handleWorkbookInputChange() {
    const file = workbookInput.files && workbookInput.files[0];
    if (!file) return;

    setWorkbookStatus("正在读取文件: " + file.name, false);
    loadWorkbook(file)
      .then(function () {
        setWorkbookStatus("已加载 " + file.name + "（" + state.sheetNames.length + " 个 Sheet）", false);
        setPlotStatus("已就绪，请设置参数并点击“生成图像”。", false);
      })
      .catch(function (err) {
        clearWorkbookView();
        setWorkbookStatus("读取失败: " + (err && err.message ? err.message : String(err)), true);
        setPlotStatus("尚未生成图像", false);
      });
  }

  function renderScriptSelect() {
    plotScriptSelect.innerHTML = "";
    scriptRegistry.forEach((scriptDef) => {
      const option = document.createElement("option");
      option.value = scriptDef.id;
      option.textContent = scriptDef.label;
      plotScriptSelect.appendChild(option);
    });
    plotScriptSelect.value = state.selectedScriptId;
  }

  function handleScriptChange() {
    state.selectedScriptId = plotScriptSelect.value;
    state.params = {};
    renderParamControls();
    loadScriptDoc(currentScript());
  }

  workbookInput.addEventListener("change", handleWorkbookInputChange);
  generatePlotBtn.addEventListener("click", handleGeneratePlot);
  downloadPlotBtn.addEventListener("click", handleDownloadPlot);
  plotScriptSelect.addEventListener("change", handleScriptChange);

  renderScriptSelect();
  renderParamControls();
  loadScriptDoc(currentScript());
  setWorkbookStatus("尚未加载文件", false);
  setPlotStatus("尚未生成图像", false);
})();
