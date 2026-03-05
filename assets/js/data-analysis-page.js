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
  const calcScriptSelect = document.getElementById("calcScriptSelect");
  const calcParamRow = document.getElementById("calcParamRow");
  const calcWorkbenchPanel = document.getElementById("calcWorkbenchPanel");
  const runCalcBtn = document.getElementById("runCalcBtn");
  const exportCalcBtn = document.getElementById("exportCalcBtn");
  const calcResult = document.getElementById("calcResult");
  const calcStatus = document.getElementById("calcStatus");

  const missingPlotWorkbench = (
    !workbookInput || !workbookStatus || !sheetTabList || !sheetPreviewTable ||
    !plotScriptSelect || !scriptParamRow || !scriptDoc || !generatePlotBtn ||
    !downloadPlotBtn || !plotStatus || !plotResult
  );
  if (missingPlotWorkbench) return;

  const hasCalcWorkbench = Boolean(
    calcScriptSelect && calcParamRow && calcWorkbenchPanel && runCalcBtn && calcResult && calcStatus
  );

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
  const calcRegistry = [
    {
      id: "qpcr_quant",
      label: "qPCR定量",
      run: async function () {
        renderQpcrWorkbench();
        return "已加载 qPCR 96孔板，可进行区域标注。";
      }
    }
  ];
  const calcSchemeRegistry = [
    {
      id: "qpcr_scheme_v1",
      label: "方案1（μL/孔）：mix=5；水=3.6；引物=0.4；cDNA=1",
      mixPerWell: 5,
      waterPerWell: 3.6,
      primerPerWell: 0.4,
      cdnaPerWell: 1
    }
  ];
  const qpcrGeneColorPalette = [
    "#2f7de1",
    "#22a061",
    "#f59e0b",
    "#c257d6",
    "#e55353",
    "#00a8b5",
    "#5f6af2",
    "#bc7f21"
  ];
  const qpcrState = {
    rows: 8,
    cols: 12,
    selecting: false,
    anchor: null,
    hover: null,
    selectedKeys: new Set(),
    pairs: [],
    selectedPairId: "",
    geneAssignments: new Map(),
    primerAssignments: new Map(),
    volumeByPairId: new Map(),
    lastCalcWarnings: [],
    geneColorMap: new Map(),
    primerColorMap: new Map(),
    primerCountByGene: new Map(),
    wellNodes: new Map(),
    globalMouseUpBound: false,
    globalResizeBound: false,
    seq: 0
  };

  const state = {
    workbook: null,
    sheetNames: [],
    activePreviewSheet: "",
    selectedScriptId: "",
    params: {},
    hasPlot: false,
    selectedCalcId: "",
    selectedCalcScheme: "",
    qpcrRepeatN: 3,
    qpcrCdnaTypeCount: 1,
    calcResultReady: false
  };

  function currentScript() {
    return scriptRegistry.find((item) => item.id === state.selectedScriptId) || null;
  }

  function currentCalcScript() {
    return calcRegistry.find((item) => item.id === state.selectedCalcId) || null;
  }

  function currentCalcScheme() {
    return calcSchemeRegistry.find((item) => item.id === state.selectedCalcScheme) || calcSchemeRegistry[0] || null;
  }

  function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function parsePositiveInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : NaN;
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function formatMicroliter(value) {
    return round2(value).toFixed(2);
  }

  function normalizeIdentity(text) {
    return String(text || "").trim().toLowerCase();
  }

  function hashString(text) {
    let hash = 0;
    const source = String(text || "");
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) >>> 0;
    return hash;
  }

  function hslToHex(h, s, l) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(100, Number(s))) / 100;
    const light = Math.max(0, Math.min(100, Number(l))) / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = light - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) {
      r = c; g = x; b = 0;
    } else if (hue < 120) {
      r = x; g = c; b = 0;
    } else if (hue < 180) {
      r = 0; g = c; b = x;
    } else if (hue < 240) {
      r = 0; g = x; b = c;
    } else if (hue < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    const toHex = function (value) {
      return Math.round((value + m) * 255).toString(16).padStart(2, "0");
    };
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function getGeneColor(geneName) {
    const key = normalizeIdentity(geneName);
    if (!key) return qpcrGeneColorPalette[0];
    if (qpcrState.geneColorMap.has(key)) return qpcrState.geneColorMap.get(key);

    const idx = qpcrState.geneColorMap.size;
    const color = qpcrGeneColorPalette[idx % qpcrGeneColorPalette.length];
    qpcrState.geneColorMap.set(key, color);
    return color;
  }

  function getPrimerColor(geneName, primerName) {
    const geneKey = normalizeIdentity(geneName);
    const primerKey = normalizeIdentity(primerName);
    const key = geneKey + "||" + primerKey;
    if (!geneKey || !primerKey) return "#2f7de1";
    if (qpcrState.primerColorMap.has(key)) return qpcrState.primerColorMap.get(key);

    const count = qpcrState.primerCountByGene.get(geneKey) || 0;
    const seed = hashString(geneKey) % 360;
    const hue = (seed + count * 53) % 360;
    const color = hslToHex(hue, 72, 46);
    qpcrState.primerColorMap.set(key, color);
    qpcrState.primerCountByGene.set(geneKey, count + 1);
    return color;
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

  function setCalcStatus(text, isError) {
    if (!hasCalcWorkbench) return;
    calcStatus.textContent = text;
    calcStatus.classList.toggle("text-danger", Boolean(isError));
    calcStatus.classList.toggle("text-muted", !isError);
  }

  function setCalcExportEnabled(enabled) {
    if (!exportCalcBtn) return;
    exportCalcBtn.disabled = !enabled;
  }

  function markCalcResultDirty() {
    state.calcResultReady = false;
    setCalcExportEnabled(false);
  }

  function buildCalcExportFilename() {
    const now = new Date();
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return "qpcr-calc-export-" +
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) + "-" +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds()) + ".png";
  }

  function composeCalcExportCanvas(boardCanvas, resultCanvas) {
    const pad = 24;
    const titleH = 42;
    const blockTitleH = 30;
    const gap = 16;
    const boardBlockH = boardCanvas ? (blockTitleH + boardCanvas.height + gap) : 0;
    const resultBlockH = blockTitleH + resultCanvas.height;
    const width = Math.max(
      boardCanvas ? boardCanvas.width : 0,
      resultCanvas.width,
      1100
    ) + pad * 2;
    const height = pad + titleH + gap + boardBlockH + resultBlockH + pad;

    const out = document.createElement("canvas");
    out.width = Math.ceil(width);
    out.height = Math.ceil(height);
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);

    let y = pad;
    ctx.fillStyle = "#1f2f43";
    ctx.font = '700 30px "HarmonyOS Sans Black", sans-serif';
    ctx.fillText("qPCR定量计算结果", pad, y + 30);
    y += titleH + gap;

    if (boardCanvas) {
      ctx.font = '700 22px "HarmonyOS Sans Black", sans-serif';
      ctx.fillText("96孔板图", pad, y + 22);
      y += blockTitleH;
      ctx.drawImage(boardCanvas, pad, y);
      y += boardCanvas.height + gap;
    }

    ctx.font = '700 22px "HarmonyOS Sans Black", sans-serif';
    ctx.fillText("计算结果表", pad, y + 22);
    y += blockTitleH;
    ctx.drawImage(resultCanvas, pad, y);
    return out;
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
    if (!scriptDef) {
      scriptDoc.innerHTML = '<p class="text-muted mb-0">请选择绘图脚本后查看使用说明。</p>';
      return;
    }
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
    if (!scriptDef) {
      const note = document.createElement("div");
      note.className = "col-12";
      note.innerHTML = '<div class="small text-muted">请先选择绘图脚本。</div>';
      scriptParamRow.appendChild(note);
      return;
    }
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
      setPlotStatus("请先选择绘图脚本。", true);
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
        if (currentScript()) setPlotStatus("已就绪，请设置参数并点击“生成图像”。", false);
        else setPlotStatus("请先选择绘图脚本。", false);
      })
      .catch(function (err) {
        clearWorkbookView();
        setWorkbookStatus("读取失败: " + (err && err.message ? err.message : String(err)), true);
        setPlotStatus("尚未生成图像", false);
      });
  }

  function renderScriptSelect() {
    plotScriptSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择绘图脚本";
    plotScriptSelect.appendChild(placeholder);
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
    generatePlotBtn.disabled = !currentScript();
    loadScriptDoc(currentScript());
    if (currentScript()) {
      if (state.workbook) setPlotStatus("已选择脚本，请设置参数并点击“生成图像”。", false);
      else setPlotStatus("已选择脚本，请先上传 xlsx 文件。", false);
    } else {
      setPlotStatus("请先选择绘图脚本。", false);
      downloadPlotBtn.disabled = true;
    }
  }

  function wellKey(row, col) {
    return row + ":" + col;
  }

  function getCurrentCalcPair() {
    return qpcrState.pairs.find((item) => item.id === qpcrState.selectedPairId) || null;
  }

  function hasQpcrPair(geneName, primerName) {
    const geneKey = normalizeIdentity(geneName);
    const primerKey = normalizeIdentity(primerName);
    return qpcrState.pairs.some((pair) =>
      normalizeIdentity(pair.geneName) === geneKey &&
      normalizeIdentity(pair.primerName) === primerKey
    );
  }

  function appendQpcrPair(geneName, primerName) {
    const sampleName = String(geneName || "").trim();
    const primer = String(primerName || "").trim();
    if (!sampleName || !primer) return null;
    if (hasQpcrPair(sampleName, primer)) return null;

    qpcrState.seq += 1;
    const geneColor = getGeneColor(sampleName);
    const primerColor = getPrimerColor(sampleName, primer);
    const pair = {
      id: "pair_" + qpcrState.seq,
      geneName: sampleName,
      primerName: primer,
      geneColor: geneColor,
      primerColor: primerColor
    };
    qpcrState.pairs.push(pair);
    qpcrState.selectedPairId = pair.id;
    return pair;
  }

  function parseQpcrPairsFromRows(rows) {
    const out = [];
    if (!rows || rows.length === 0) return out;
    const trimmedRows = rows.map((row) => (row || []).map((cell) => String(cell ?? "").trim()));
    const firstRow = trimmedRows[0] || [];
    const firstToken = normalizeIdentity(firstRow[0] || "");
    const maybeHeader = (firstToken.includes("样本") || firstToken.includes("sample")) &&
      firstRow.slice(1).some((cell) => {
        const token = normalizeIdentity(cell);
        return token.includes("引物") || token.includes("primer");
      });
    const startRow = maybeHeader ? 1 : 0;

    const seen = new Set();
    for (let i = startRow; i < trimmedRows.length; i += 1) {
      const row = trimmedRows[i] || [];
      const sampleName = String(row[0] ?? "").trim();
      if (!sampleName) continue;
      for (let j = 1; j < row.length; j += 1) {
        const primerName = String(row[j] ?? "").trim();
        if (!primerName) continue;
        const key = normalizeIdentity(sampleName) + "||" + normalizeIdentity(primerName);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ geneName: sampleName, primerName: primerName });
      }
    }
    return out;
  }

  function parseQpcrPairsFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("请选择一个 xlsx/xls 文件。"));
        return;
      }
      if (typeof XLSX === "undefined" || !XLSX || !XLSX.read) {
        reject(new Error("导入失败：未找到 XLSX 解析库。"));
        return;
      }
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("读取文件失败。"));
      };
      reader.onload = function (evt) {
        try {
          const wb = XLSX.read(evt.target.result, { type: "array" });
          const firstName = wb.SheetNames && wb.SheetNames[0];
          if (!firstName) throw new Error("文件中没有可用 Sheet。");
          const ws = wb.Sheets[firstName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const pairs = parseQpcrPairsFromRows(rows);
          resolve(pairs);
        } catch (err) {
          reject(new Error("解析文件失败：" + (err && err.message ? err.message : String(err))));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function currentCalcSchemeLabel() {
    const scheme = calcSchemeRegistry.find((item) => item.id === state.selectedCalcScheme);
    return scheme ? scheme.label : "未选择定量方案";
  }

  function clampQpcrRect(a, b) {
    const r1 = Math.max(1, Math.min(a.row, b.row));
    const r2 = Math.min(qpcrState.rows, Math.max(a.row, b.row));
    const c1 = Math.max(1, Math.min(a.col, b.col));
    const c2 = Math.min(qpcrState.cols, Math.max(a.col, b.col));
    return { r1: r1, r2: r2, c1: c1, c2: c2 };
  }

  function keysFromRect(rect) {
    const out = [];
    for (let row = rect.r1; row <= rect.r2; row += 1) {
      for (let col = rect.c1; col <= rect.c2; col += 1) out.push(wellKey(row, col));
    }
    return out;
  }

  function toRgba(hex, alpha) {
    const raw = String(hex || "").replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return "rgba(47,125,225," + alpha + ")";
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function getQpcrParams() {
    return {
      n: parsePositiveInt(state.qpcrRepeatN),
      type: parsePositiveInt(state.qpcrCdnaTypeCount)
    };
  }

  function expectedPairWellCount(n, type) {
    return n * type;
  }

  function buildQpcrVolumeRows(scheme, n, type, pairs) {
    const redundancy = 1.2;
    const pairWellCount = expectedPairWellCount(n, type);
    return pairs.map((pair) => {
      const mixVol = scheme.mixPerWell * pairWellCount * redundancy;
      const waterVol = scheme.waterPerWell * pairWellCount * redundancy;
      const primerVol = scheme.primerPerWell * pairWellCount * redundancy;
      const vt = mixVol + waterVol + primerVol;
      return {
        pairId: pair.id,
        geneName: pair.geneName,
        primerName: pair.primerName,
        pairWellCountExpected: pairWellCount,
        mixVol: mixVol,
        waterVol: waterVol,
        primerVol: primerVol,
        vt: vt
      };
    });
  }

  function buildCdnaRows(scheme, n, type) {
    const redundancy = 1.1;
    const cdnaVolPerType = scheme.cdnaPerWell * n * redundancy;
    const rows = [];
    for (let i = 1; i <= type; i += 1) rows.push({ typeName: "type" + i, cdnaVol: cdnaVolPerType });
    return { rows: rows, cdnaVolPerType: cdnaVolPerType };
  }

  function calcPairV(vt, cdnaVolPerType, type) {
    return (((vt / type) / 3) * 1.1 / 1.2) + (cdnaVolPerType / 3);
  }

  function buildPairActualWellCountMap() {
    const map = new Map();
    qpcrState.primerAssignments.forEach((assignment) => {
      const pairId = assignment.pairId;
      map.set(pairId, (map.get(pairId) || 0) + 1);
    });
    return map;
  }

  function buildWellCountWarnings(pairs, expectedCount, actualMap) {
    const warnings = [];
    pairs.forEach((pair) => {
      const actual = actualMap.get(pair.id) || 0;
      if (actual !== expectedCount) {
        warnings.push({
          pairId: pair.id,
          geneName: pair.geneName,
          primerName: pair.primerName,
          expected: expectedCount,
          actual: actual
        });
      }
    });
    return warnings;
  }

  function validateQpcrInputAndToggleRun(showStatus) {
    if (!hasCalcWorkbench || state.selectedCalcId !== "qpcr_quant") return false;
    const params = getQpcrParams();
    const valid = Number.isFinite(params.n) && Number.isFinite(params.type);
    runCalcBtn.disabled = !valid;
    if (showStatus) {
      if (valid) setCalcStatus("参数已更新，可执行计算。", false);
      else setCalcStatus("重复数 n 与 cDNA种类数 type 必须为正整数。", true);
    }
    return valid;
  }

  function renderCalcTablesAndWarnings(volumeRows, cdnaRows, warnings, n, type, schemeLabel) {
    const volumeBody = volumeRows.map((row) =>
      "<tr>" +
      "<td>" + escapeHtml(row.geneName) + "</td>" +
      "<td>" + escapeHtml(row.primerName) + "</td>" +
      "<td>" + row.pairWellCountExpected + "</td>" +
      "<td>" + formatMicroliter(row.mixVol) + "</td>" +
      "<td>" + formatMicroliter(row.waterVol) + "</td>" +
      "<td>" + formatMicroliter(row.primerVol) + "</td>" +
      "<td>" + formatMicroliter(row.vt) + "</td>" +
      "</tr>"
    ).join("");

    const cdnaBody = cdnaRows.map((row) =>
      "<tr>" +
      "<td>" + escapeHtml(row.typeName) + "</td>" +
      "<td>" + formatMicroliter(row.cdnaVol) + "</td>" +
      "</tr>"
    ).join("");

    const warningsHtml = warnings.length === 0
      ? ""
      : (
        '<h3 class="h6 mb-2">孔位校验警告</h3>' +
        '<div class="small text-warning">' +
        warnings.map((item) =>
          escapeHtml(item.geneName + " / " + item.primerName) +
          "：实际孔数 " + item.actual + "，期望孔数 " + item.expected
        ).join("<br />") +
        "</div>"
      );

    calcResult.innerHTML =
      '<div class="small text-muted mb-2">方案：' + escapeHtml(schemeLabel) + "；n=" + n + "；type=" + type + "</div>" +
      '<h3 class="h6 mb-2">总体积表（单位：μL）</h3>' +
      '<div class="table-responsive mb-3">' +
      '<table class="table table-sm table-bordered align-middle mb-0">' +
      "<thead><tr><th>样本</th><th>引物</th><th>孔数(n×type)</th><th>mix</th><th>水</th><th>引物</th><th>VT</th></tr></thead>" +
      "<tbody>" + volumeBody + "</tbody>" +
      "</table>" +
      "</div>" +
      '<h3 class="h6 mb-2">cDNA体积表（单位：μL）</h3>' +
      '<div class="table-responsive mb-3">' +
      '<table class="table table-sm table-bordered align-middle mb-0">' +
      "<thead><tr><th>cDNA类型</th><th>体积</th></tr></thead>" +
      "<tbody>" + cdnaBody + "</tbody>" +
      "</table>" +
      "</div>" +
      warningsHtml;
  }

  function clearQpcrSelection() {
    qpcrState.selectedKeys = new Set();
    qpcrState.anchor = null;
    qpcrState.hover = null;
    repaintQpcrBoard();
  }

  function renderQpcrPairSelect() {
    const pairSelect = document.getElementById("qpcrPairSelect");
    if (!pairSelect) return;
    pairSelect.innerHTML = "";

    if (qpcrState.pairs.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "请先添加样本/引物名称对";
      pairSelect.appendChild(option);
      pairSelect.value = "";
      qpcrState.selectedPairId = "";
      pairSelect.disabled = true;
      return;
    }

    pairSelect.disabled = false;
    qpcrState.pairs.forEach((pair) => {
      const option = document.createElement("option");
      option.value = pair.id;
      option.textContent = pair.geneName + " | " + pair.primerName;
      pairSelect.appendChild(option);
    });
    if (!qpcrState.selectedPairId || !qpcrState.pairs.some((p) => p.id === qpcrState.selectedPairId)) {
      qpcrState.selectedPairId = qpcrState.pairs[0].id;
    }
    pairSelect.value = qpcrState.selectedPairId;
  }

  function renderQpcrLegend() {
    const legend = document.getElementById("qpcrPairLegend");
    if (!legend) return;
    legend.innerHTML = "";
    if (qpcrState.pairs.length === 0) {
      legend.innerHTML = '<span class="small text-muted">尚未添加名称对。</span>';
      return;
    }

    qpcrState.pairs.forEach((pair) => {
      const item = document.createElement("div");
      item.className = "qpcr-legend-item";

      const swatch = document.createElement("span");
      swatch.className = "qpcr-legend-swatch";
      swatch.style.backgroundColor = toRgba(pair.primerColor, 0.22);
      swatch.style.borderColor = pair.geneColor;

      const text = document.createElement("span");
      text.className = "small";
      text.textContent = pair.geneName + " / " + pair.primerName;

      item.appendChild(swatch);
      item.appendChild(text);
      legend.appendChild(item);
    });
  }

  function renderQpcrGeneOverlays() {
    const board = document.getElementById("qpcrBoard");
    const overlayHost = document.getElementById("qpcrGeneOverlay");
    if (!board || !overlayHost) return;
    overlayHost.innerHTML = "";
    if (qpcrState.geneAssignments.size === 0) return;

    const boardRect = board.getBoundingClientRect();
    const strokeWidth = 3.4;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(Math.max(1, Math.round(boardRect.width))));
    svg.setAttribute("height", String(Math.max(1, Math.round(boardRect.height))));
    svg.setAttribute("viewBox", "0 0 " + Math.max(1, boardRect.width) + " " + Math.max(1, boardRect.height));
    svg.classList.add("qpcr-gene-svg");
    overlayHost.appendChild(svg);

    const xGrid = [];
    const yGrid = [];
    for (let col = 1; col <= qpcrState.cols; col += 1) {
      const node = qpcrState.wellNodes.get(wellKey(1, col)) || qpcrState.wellNodes.get(wellKey(qpcrState.rows, col));
      if (!node) continue;
      xGrid[col - 1] = node.offsetLeft;
      xGrid[col] = node.offsetLeft + node.offsetWidth;
    }
    for (let row = 1; row <= qpcrState.rows; row += 1) {
      const node = qpcrState.wellNodes.get(wellKey(row, 1)) || qpcrState.wellNodes.get(wellKey(row, qpcrState.cols));
      if (!node) continue;
      yGrid[row - 1] = node.offsetTop;
      yGrid[row] = node.offsetTop + node.offsetHeight;
    }
    if (xGrid.length < qpcrState.cols + 1 || yGrid.length < qpcrState.rows + 1) return;

    const geneGroups = new Map();
    qpcrState.geneAssignments.forEach((assignment, key) => {
      const geneKey = assignment.geneKey;
      if (!geneGroups.has(geneKey)) {
        geneGroups.set(geneKey, {
          geneName: assignment.geneName,
          color: assignment.color,
          cells: new Set()
        });
      }
      const group = geneGroups.get(geneKey);
      group.cells.add(key);
    });

    const vKey = function (x, y) { return x + "," + y; };
    const hasCellFactory = function (cells) {
      return function (row, col) {
        if (row < 1 || row > qpcrState.rows || col < 1 || col > qpcrState.cols) return false;
        return cells.has(wellKey(row, col));
      };
    };

    geneGroups.forEach((group) => {
      const hasCell = hasCellFactory(group.cells);
      const edges = [];
      const edgesFromStart = new Map();
      const pushEdge = function (sx, sy, ex, ey) {
        const edge = { sx: sx, sy: sy, ex: ex, ey: ey, used: false };
        edges.push(edge);
        const key = vKey(sx, sy);
        if (!edgesFromStart.has(key)) edgesFromStart.set(key, []);
        edgesFromStart.get(key).push(edge);
      };

      group.cells.forEach((cellKey) => {
        const parts = cellKey.split(":");
        const row = Number(parts[0]);
        const col = Number(parts[1]);
        if (!Number.isFinite(row) || !Number.isFinite(col)) return;

        if (!hasCell(row - 1, col)) pushEdge(col - 1, row - 1, col, row - 1);
        if (!hasCell(row, col + 1)) pushEdge(col, row - 1, col, row);
        if (!hasCell(row + 1, col)) pushEdge(col, row, col - 1, row);
        if (!hasCell(row, col - 1)) pushEdge(col - 1, row, col - 1, row - 1);
      });

      const loops = [];
      edges.forEach((edge) => {
        if (edge.used) return;
        const loop = [];
        let current = edge;
        const startKey = vKey(current.sx, current.sy);
        while (current && !current.used) {
          current.used = true;
          if (loop.length === 0) loop.push({ x: current.sx, y: current.sy });
          loop.push({ x: current.ex, y: current.ey });
          const nextKey = vKey(current.ex, current.ey);
          if (nextKey === startKey) break;
          const nextCandidates = edgesFromStart.get(nextKey) || [];
          current = nextCandidates.find((item) => !item.used) || null;
        }
        if (loop.length > 2) loops.push(loop);
      });

      loops.forEach((loop, loopIndex) => {
        const d = loop.map((pt, idx) => {
          const x = xGrid[pt.x];
          const y = yGrid[pt.y];
          return (idx === 0 ? "M " : "L ") + x + " " + y;
        }).join(" ") + " Z";
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", group.color);
        path.setAttribute("stroke-width", String(strokeWidth));
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("vector-effect", "non-scaling-stroke");
        svg.appendChild(path);

        if (group.geneName && loopIndex === 0) {
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          loop.forEach((pt) => {
            const x = xGrid[pt.x];
            const y = yGrid[pt.y];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
          });
          if (Number.isFinite(minX) && Number.isFinite(minY)) {
            const label = document.createElement("div");
            label.className = "qpcr-gene-label";
            label.textContent = group.geneName;
            label.style.borderColor = toRgba(group.color, 0.6);
            label.style.color = group.color;
            label.style.left = Math.max(2, minX + 4) + "px";
            label.style.top = Math.max(2, minY - 22) + "px";
            overlayHost.appendChild(label);
          }
        }
      });
    });

  }

  function repaintQpcrBoard() {
    if (qpcrState.wellNodes.size === 0) return;
    qpcrState.wellNodes.forEach((wellNode) => {
      wellNode.classList.remove("qpcr-well-selected", "qpcr-well-primer");
      wellNode.removeAttribute("style");
      wellNode.title = "";
      wellNode.querySelectorAll(".qpcr-well-volume").forEach((node) => node.remove());
    });

    qpcrState.primerAssignments.forEach((assignment, key) => {
      const node = qpcrState.wellNodes.get(key);
      if (!node) return;
      node.classList.add("qpcr-well-primer");
      node.style.backgroundColor = toRgba(assignment.color, 0.28);
      node.style.borderColor = assignment.color;
      node.title = assignment.primerName;
    });

    qpcrState.selectedKeys.forEach((key) => {
      const node = qpcrState.wellNodes.get(key);
      if (!node) return;
      node.classList.add("qpcr-well-selected");
    });

    qpcrState.primerAssignments.forEach((assignment, key) => {
      const node = qpcrState.wellNodes.get(key);
      if (!node) return;
      const v = qpcrState.volumeByPairId.get(assignment.pairId);
      if (!Number.isFinite(v)) return;
      const label = document.createElement("span");
      label.className = "qpcr-well-volume";
      label.textContent = formatMicroliter(v);
      node.appendChild(label);
      node.title = assignment.primerName + " | V=" + formatMicroliter(v) + " μL";
    });

    renderQpcrGeneOverlays();
  }

  function updateQpcrRectSelection() {
    if (!qpcrState.anchor || !qpcrState.hover) return;
    const rect = clampQpcrRect(qpcrState.anchor, qpcrState.hover);
    qpcrState.selectedKeys = new Set(keysFromRect(rect));
    repaintQpcrBoard();
  }

  function onQpcrGlobalMouseUp() {
    if (!qpcrState.selecting) return;
    qpcrState.selecting = false;
    setCalcStatus("已选择 " + qpcrState.selectedKeys.size + " 个孔位。", false);
  }

  function bindQpcrGlobalMouseUp() {
    if (qpcrState.globalMouseUpBound) return;
    qpcrState.globalMouseUpBound = true;
    window.addEventListener("mouseup", onQpcrGlobalMouseUp);
  }

  function bindQpcrGlobalResize() {
    if (qpcrState.globalResizeBound) return;
    qpcrState.globalResizeBound = true;
    window.addEventListener("resize", function () {
      if (!document.getElementById("qpcrBoard")) return;
      renderQpcrGeneOverlays();
    });
  }

  function buildQpcrBoard(container) {
    if (!container) return;
    qpcrState.wellNodes = new Map();
    container.innerHTML = "";

    const topHeaders = document.createElement("div");
    topHeaders.className = "qpcr-col-headers";
    for (let c = 1; c <= qpcrState.cols; c += 1) {
      const cell = document.createElement("span");
      cell.textContent = String(c);
      topHeaders.appendChild(cell);
    }

    const body = document.createElement("div");
    body.className = "qpcr-board-body";

    const rowHeaders = document.createElement("div");
    rowHeaders.className = "qpcr-row-headers";
    for (let r = 0; r < qpcrState.rows; r += 1) {
      const cell = document.createElement("span");
      cell.textContent = String.fromCharCode(65 + r);
      rowHeaders.appendChild(cell);
    }

    const boardCanvas = document.createElement("div");
    boardCanvas.className = "qpcr-board-canvas";
    const board = document.createElement("div");
    board.className = "qpcr-board";
    board.id = "qpcrBoard";

    for (let r = 1; r <= qpcrState.rows; r += 1) {
      for (let c = 1; c <= qpcrState.cols; c += 1) {
        const well = document.createElement("div");
        well.className = "qpcr-well";
        well.dataset.row = String(r);
        well.dataset.col = String(c);
        well.dataset.key = wellKey(r, c);
        well.addEventListener("mousedown", function (evt) {
          if (evt.button !== 0) return;
          evt.preventDefault();
          qpcrState.selecting = true;
          qpcrState.anchor = { row: Number(well.dataset.row), col: Number(well.dataset.col) };
          qpcrState.hover = { row: Number(well.dataset.row), col: Number(well.dataset.col) };
          updateQpcrRectSelection();
        });
        well.addEventListener("mouseenter", function () {
          if (!qpcrState.selecting) return;
          qpcrState.hover = { row: Number(well.dataset.row), col: Number(well.dataset.col) };
          updateQpcrRectSelection();
        });
        board.appendChild(well);
        qpcrState.wellNodes.set(well.dataset.key, well);
      }
    }

    const overlayHost = document.createElement("div");
    overlayHost.className = "qpcr-gene-overlay";
    overlayHost.id = "qpcrGeneOverlay";

    boardCanvas.appendChild(board);
    boardCanvas.appendChild(overlayHost);
    body.appendChild(rowHeaders);
    body.appendChild(boardCanvas);
    container.appendChild(topHeaders);
    container.appendChild(body);

    bindQpcrGlobalMouseUp();
    bindQpcrGlobalResize();
  }

  function renderQpcrWorkbench() {
    if (!hasCalcWorkbench || !calcWorkbenchPanel) return;
    qpcrState.selecting = false;
    qpcrState.anchor = null;
    qpcrState.hover = null;
    qpcrState.selectedKeys = new Set();
    qpcrState.pairs = [];
    qpcrState.selectedPairId = "";
    qpcrState.geneAssignments = new Map();
    qpcrState.primerAssignments = new Map();
    qpcrState.volumeByPairId = new Map();
    qpcrState.lastCalcWarnings = [];
    qpcrState.geneColorMap = new Map();
    qpcrState.primerColorMap = new Map();
    qpcrState.primerCountByGene = new Map();
    qpcrState.seq = 0;
    markCalcResultDirty();

    calcWorkbenchPanel.innerHTML =
      '<div class="qpcr-workbench">' +
      '<div id="qpcrSchemeLabel" class="small text-muted mb-2">当前定量方案：' + escapeHtml(currentCalcSchemeLabel()) + "</div>" +
      '<div class="row g-3 align-items-end">' +
      '<div class="col-lg-4"><label for="qpcrPairSelect" class="form-label">名称对</label><select id="qpcrPairSelect" class="form-select"></select></div>' +
      '<div class="col-lg-4"><label for="qpcrGeneInput" class="form-label">样本名称</label><input id="qpcrGeneInput" class="form-control" type="text" placeholder="例如: sample_A" /></div>' +
      '<div class="col-lg-4"><label for="qpcrPrimerInput" class="form-label">引物名称</label><input id="qpcrPrimerInput" class="form-control" type="text" placeholder="例如: GAPDH-F/R" /></div>' +
      '<div class="col-lg-8"><label for="qpcrPairFileInput" class="form-label">导入样本-引物文件</label><input id="qpcrPairFileInput" class="form-control" type="file" accept=".xlsx,.xls" /></div>' +
      '<div class="col-lg-4 d-flex"><button id="qpcrImportPairsBtn" class="btn btn-outline-primary btn-sm w-100" type="button">从文件导入名称对</button></div>' +
      '<div class="col-12 d-flex flex-wrap gap-2">' +
      '<button id="qpcrAddPairBtn" class="btn btn-outline-primary btn-sm" type="button">添加名称对</button>' +
      '<button id="qpcrApplyGeneBtn" class="btn btn-outline-primary btn-sm" type="button">样本边框应用到选区</button>' +
      '<button id="qpcrApplyPrimerBtn" class="btn btn-outline-primary btn-sm" type="button">引物填充应用到选区</button>' +
      '<button id="qpcrClearSelectionBtn" class="btn btn-outline-secondary btn-sm" type="button">清空当前选区</button>' +
      '<button id="qpcrResetMarksBtn" class="btn btn-outline-secondary btn-sm" type="button">清空全部标注</button>' +
      "</div>" +
      '<div class="col-12"><div id="qpcrPairLegend" class="qpcr-legend"></div></div>' +
      "</div>" +
      '<div class="qpcr-board-host mt-3"><div id="qpcrBoardRoot" class="qpcr-board-root"></div></div>' +
      '<div class="small text-muted mt-2">提示：按住鼠标左键拖拽可框选矩形区域，先添加名称对，再应用“样本边框”或“引物填充”。导入文件默认读取首个Sheet：每行第1列为样本，后续每列为该样本的引物。</div>' +
      "</div>";

    const pairSelect = document.getElementById("qpcrPairSelect");
    const geneInput = document.getElementById("qpcrGeneInput");
    const primerInput = document.getElementById("qpcrPrimerInput");
    const pairFileInput = document.getElementById("qpcrPairFileInput");
    const addPairBtn = document.getElementById("qpcrAddPairBtn");
    const importPairsBtn = document.getElementById("qpcrImportPairsBtn");
    const applyGeneBtn = document.getElementById("qpcrApplyGeneBtn");
    const applyPrimerBtn = document.getElementById("qpcrApplyPrimerBtn");
    const clearSelectionBtn = document.getElementById("qpcrClearSelectionBtn");
    const resetMarksBtn = document.getElementById("qpcrResetMarksBtn");
    buildQpcrBoard(document.getElementById("qpcrBoardRoot"));

    if (pairSelect) {
      pairSelect.addEventListener("change", function () {
        qpcrState.selectedPairId = pairSelect.value;
      });
    }

    if (addPairBtn) {
      addPairBtn.addEventListener("click", function () {
        const geneName = geneInput ? geneInput.value.trim() : "";
        const primerName = primerInput ? primerInput.value.trim() : "";
        if (!geneName || !primerName) {
          setCalcStatus("请同时填写样本名称和引物名称。", true);
          return;
        }
        const pair = appendQpcrPair(geneName, primerName);
        if (!pair) {
          setCalcStatus("该样本-引物名称对已存在。", true);
          return;
        }
        renderQpcrPairSelect();
        renderQpcrLegend();
        repaintQpcrBoard();
        markCalcResultDirty();

        if (geneInput) geneInput.value = "";
        if (primerInput) primerInput.value = "";
        setCalcStatus("已添加名称对：" + pair.geneName + " / " + pair.primerName, false);
      });
    }

    if (importPairsBtn) {
      importPairsBtn.addEventListener("click", async function () {
        try {
          const file = pairFileInput && pairFileInput.files ? pairFileInput.files[0] : null;
          if (!file) {
            setCalcStatus("请先选择要导入的 xlsx/xls 文件。", true);
            return;
          }
          const parsed = await parseQpcrPairsFromFile(file);
          if (!parsed || parsed.length === 0) {
            setCalcStatus("文件中未识别到有效的样本-引物名称对。", true);
            return;
          }

          let added = 0;
          let skipped = 0;
          parsed.forEach((item) => {
            const pair = appendQpcrPair(item.geneName, item.primerName);
            if (pair) added += 1;
            else skipped += 1;
          });
          if (added === 0) {
            setCalcStatus("导入完成：未新增名称对（可能全部重复）。", true);
            return;
          }

          renderQpcrPairSelect();
          renderQpcrLegend();
          repaintQpcrBoard();
          markCalcResultDirty();
          setCalcStatus("导入完成：新增 " + added + " 对，跳过 " + skipped + " 对。", false);
        } catch (err) {
          setCalcStatus(err && err.message ? err.message : "导入失败。", true);
        }
      });
    }

    if (applyGeneBtn) {
      applyGeneBtn.addEventListener("click", function () {
        const pair = getCurrentCalcPair();
        if (!pair) {
          setCalcStatus("请先添加并选择一个名称对。", true);
          return;
        }
        if (qpcrState.selectedKeys.size === 0) {
          setCalcStatus("请先在96孔板上选择区域。", true);
          return;
        }

        const geneKey = normalizeIdentity(pair.geneName);
        qpcrState.selectedKeys.forEach((key) => {
          qpcrState.geneAssignments.set(key, {
            geneKey: geneKey,
            geneName: pair.geneName,
            color: pair.geneColor
          });
        });
        clearQpcrSelection();
        markCalcResultDirty();
        setCalcStatus("已应用样本边框：" + pair.geneName, false);
      });
    }

    if (applyPrimerBtn) {
      applyPrimerBtn.addEventListener("click", function () {
        const pair = getCurrentCalcPair();
        if (!pair) {
          setCalcStatus("请先添加并选择一个名称对。", true);
          return;
        }
        if (qpcrState.selectedKeys.size === 0) {
          setCalcStatus("请先在96孔板上选择区域。", true);
          return;
        }

        qpcrState.selectedKeys.forEach((key) => {
          qpcrState.primerAssignments.set(key, {
            pairId: pair.id,
            primerName: pair.primerName,
            color: pair.primerColor
          });
        });
        clearQpcrSelection();
        markCalcResultDirty();
        setCalcStatus("已应用引物填充：" + pair.primerName, false);
      });
    }

    if (clearSelectionBtn) {
      clearSelectionBtn.addEventListener("click", function () {
        clearQpcrSelection();
        setCalcStatus("已清空当前选区。", false);
      });
    }

    if (resetMarksBtn) {
      resetMarksBtn.addEventListener("click", function () {
        qpcrState.geneAssignments = new Map();
        qpcrState.primerAssignments = new Map();
        qpcrState.volumeByPairId = new Map();
        qpcrState.lastCalcWarnings = [];
        clearQpcrSelection();
        markCalcResultDirty();
        setCalcStatus("已清空全部标注。", false);
      });
    }

    renderQpcrPairSelect();
    renderQpcrLegend();
    repaintQpcrBoard();
    window.requestAnimationFrame(renderQpcrGeneOverlays);
  }

  function clearCalcWorkbenchPanel() {
    if (!hasCalcWorkbench || !calcWorkbenchPanel) return;
    calcWorkbenchPanel.innerHTML = "";
  }

  function renderCalcResultPlaceholder(text) {
    if (!hasCalcWorkbench) return;
    calcResult.innerHTML = '<span class="text-muted">' + escapeHtml(text) + "</span>";
    markCalcResultDirty();
  }

  function renderCalcParamControls() {
    if (!hasCalcWorkbench) return;
    calcParamRow.innerHTML = "";
    if (!state.selectedCalcId) {
      const note = document.createElement("div");
      note.className = "col-12";
      note.innerHTML = '<div class="small text-muted">请先选择计算项目。</div>';
      calcParamRow.appendChild(note);
      return;
    }

    if (state.selectedCalcId !== "qpcr_quant") {
      const note = document.createElement("div");
      note.className = "col-12";
      note.innerHTML = '<div class="small text-muted">当前计算项暂未配置参数。</div>';
      calcParamRow.appendChild(note);
      return;
    }

    const schemeCol = document.createElement("div");
    schemeCol.className = "col-lg-5";
    const schemeLabel = document.createElement("label");
    schemeLabel.className = "form-label";
    schemeLabel.setAttribute("for", "calcSchemeSelect");
    schemeLabel.textContent = "定量方案";
    const schemeSelect = document.createElement("select");
    schemeSelect.id = "calcSchemeSelect";
    schemeSelect.className = "form-select";
    calcSchemeRegistry.forEach((scheme) => {
      const option = document.createElement("option");
      option.value = scheme.id;
      option.textContent = scheme.label;
      schemeSelect.appendChild(option);
    });
    if (!state.selectedCalcScheme && calcSchemeRegistry.length > 0) state.selectedCalcScheme = calcSchemeRegistry[0].id;
    schemeSelect.value = state.selectedCalcScheme;
    schemeSelect.addEventListener("change", function () {
      state.selectedCalcScheme = schemeSelect.value;
      markCalcResultDirty();
      const schemeLabel = document.getElementById("qpcrSchemeLabel");
      if (schemeLabel) schemeLabel.textContent = "当前定量方案：" + currentCalcSchemeLabel();
      if (validateQpcrInputAndToggleRun(false)) setCalcStatus("已切换定量方案。", false);
      else setCalcStatus("请填写有效的重复数 n 与 cDNA种类数 type。", true);
    });
    schemeCol.appendChild(schemeLabel);
    schemeCol.appendChild(schemeSelect);
    calcParamRow.appendChild(schemeCol);

    const repeatCol = document.createElement("div");
    repeatCol.className = "col-lg-3";
    const repeatLabel = document.createElement("label");
    repeatLabel.className = "form-label";
    repeatLabel.setAttribute("for", "qpcrRepeatInput");
    repeatLabel.textContent = "重复数 n";
    const repeatInput = document.createElement("input");
    repeatInput.id = "qpcrRepeatInput";
    repeatInput.type = "number";
    repeatInput.min = "1";
    repeatInput.step = "1";
    repeatInput.className = "form-control";
    repeatInput.value = String(state.qpcrRepeatN || 3);
    repeatInput.addEventListener("input", function () {
      state.qpcrRepeatN = repeatInput.value;
      markCalcResultDirty();
      validateQpcrInputAndToggleRun(true);
    });
    repeatCol.appendChild(repeatLabel);
    repeatCol.appendChild(repeatInput);
    calcParamRow.appendChild(repeatCol);

    const typeCol = document.createElement("div");
    typeCol.className = "col-lg-4";
    const typeLabel = document.createElement("label");
    typeLabel.className = "form-label";
    typeLabel.setAttribute("for", "qpcrTypeInput");
    typeLabel.textContent = "cDNA种类数 type";
    const typeInput = document.createElement("input");
    typeInput.id = "qpcrTypeInput";
    typeInput.type = "number";
    typeInput.min = "1";
    typeInput.step = "1";
    typeInput.className = "form-control";
    typeInput.value = String(state.qpcrCdnaTypeCount || 1);
    typeInput.addEventListener("input", function () {
      state.qpcrCdnaTypeCount = typeInput.value;
      markCalcResultDirty();
      validateQpcrInputAndToggleRun(true);
    });
    typeCol.appendChild(typeLabel);
    typeCol.appendChild(typeInput);
    calcParamRow.appendChild(typeCol);

    const hintCol = document.createElement("div");
    hintCol.className = "col-12";
    hintCol.innerHTML =
      '<div class="small text-muted">单个样本-引物对的期望孔数 = n × type。若板面实际引物孔数不一致，将警告但继续计算。</div>';
    calcParamRow.appendChild(hintCol);

    validateQpcrInputAndToggleRun(false);
  }

  function renderCalcSelect() {
    if (!hasCalcWorkbench) return;
    calcScriptSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择计算项目";
    calcScriptSelect.appendChild(placeholder);
    calcRegistry.forEach((calcDef) => {
      const option = document.createElement("option");
      option.value = calcDef.id;
      option.textContent = calcDef.label;
      calcScriptSelect.appendChild(option);
    });
    calcScriptSelect.value = state.selectedCalcId;
  }

  function handleCalcChange() {
    if (!hasCalcWorkbench) return;
    state.selectedCalcId = calcScriptSelect.value;
    renderCalcParamControls();
    if (!state.selectedCalcId) {
      clearCalcWorkbenchPanel();
      renderCalcResultPlaceholder("请选择计算项目后展示内容。");
      runCalcBtn.disabled = true;
      setCalcStatus("请先选择计算项目。", false);
      return;
    }

    if (state.selectedCalcId === "qpcr_quant") {
      renderQpcrWorkbench();
      renderCalcResultPlaceholder("qPCR板面已加载，点击“执行计算”生成结果。");
      if (validateQpcrInputAndToggleRun(false)) {
        setCalcStatus("已加载 qPCR 96孔板，可直接进行区域标注并执行计算。", false);
      } else {
        setCalcStatus("请填写有效的重复数 n 与 cDNA种类数 type。", true);
      }
      return;
    }

    runCalcBtn.disabled = false;
    clearCalcWorkbenchPanel();
    renderCalcResultPlaceholder("已选择计算项目。");
    setCalcStatus("已选择计算项目。", false);
  }

  async function handleRunCalc() {
    if (!hasCalcWorkbench) return;
    const calcDef = currentCalcScript();
    if (!calcDef) {
      setCalcStatus("请先选择计算项目。", true);
      return;
    }

    try {
      if (state.selectedCalcId !== "qpcr_quant") {
        setCalcStatus("该计算项暂未实现。", true);
        return;
      }

      const scheme = currentCalcScheme();
      if (!scheme) {
        setCalcStatus("未找到可用定量方案。", true);
        return;
      }

      const params = getQpcrParams();
      if (!Number.isFinite(params.n) || !Number.isFinite(params.type)) {
        runCalcBtn.disabled = true;
        setCalcStatus("重复数 n 与 cDNA种类数 type 必须为正整数。", true);
        return;
      }

      if (qpcrState.pairs.length === 0) {
        setCalcStatus("请先添加至少一个样本-引物名称对。", true);
        return;
      }

      const volumeRows = buildQpcrVolumeRows(scheme, params.n, params.type, qpcrState.pairs);
      const cdnaData = buildCdnaRows(scheme, params.n, params.type);
      volumeRows.forEach((row) => {
        row.v = calcPairV(row.vt, cdnaData.cdnaVolPerType, params.type);
      });

      qpcrState.volumeByPairId = new Map(volumeRows.map((row) => [row.pairId, row.v]));
      const actualMap = buildPairActualWellCountMap();
      const expectedCount = expectedPairWellCount(params.n, params.type);
      const warnings = buildWellCountWarnings(qpcrState.pairs, expectedCount, actualMap);
      qpcrState.lastCalcWarnings = warnings;

      renderCalcTablesAndWarnings(volumeRows, cdnaData.rows, warnings, params.n, params.type, scheme.label);
      repaintQpcrBoard();
      state.calcResultReady = true;
      setCalcExportEnabled(true);

      if (warnings.length > 0) setCalcStatus("计算完成，存在 " + warnings.length + " 条孔位警告。", false);
      else setCalcStatus("计算完成。", false);
    } catch (err) {
      state.calcResultReady = false;
      setCalcExportEnabled(false);
      setCalcStatus("计算失败: " + (err && err.message ? err.message : String(err)), true);
    }
  }

  async function handleExportCalcPng() {
    if (!hasCalcWorkbench) return;
    if (!state.calcResultReady) {
      setCalcStatus("请先执行计算，再导出PNG。", true);
      return;
    }
    if (typeof window.html2canvas !== "function") {
      setCalcStatus("导出失败：未加载html2canvas。", true);
      return;
    }
    const tableCount = calcResult.querySelectorAll("table").length;
    if (tableCount < 2) {
      setCalcStatus("导出失败：结果区表格不足，请先完成计算。", true);
      return;
    }

    try {
      setCalcExportEnabled(false);
      setCalcStatus("正在生成PNG，请稍候…", false);
      let boardCanvas = null;
      const boardRoot = document.getElementById("qpcrBoardRoot");
      if (boardRoot) {
        boardCanvas = await window.html2canvas(boardRoot, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          logging: false
        });
      }
      const resultCanvas = await window.html2canvas(calcResult, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false
      });
      const canvas = composeCalcExportCanvas(boardCanvas, resultCanvas);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = buildCalcExportFilename();
      link.click();
      setCalcStatus("导出成功：PNG已下载。", false);
    } catch (err) {
      setCalcStatus("导出失败: " + (err && err.message ? err.message : String(err)), true);
    } finally {
      setCalcExportEnabled(state.calcResultReady);
    }
  }

  workbookInput.addEventListener("change", handleWorkbookInputChange);
  generatePlotBtn.addEventListener("click", handleGeneratePlot);
  downloadPlotBtn.addEventListener("click", handleDownloadPlot);
  plotScriptSelect.addEventListener("change", handleScriptChange);

  renderScriptSelect();
  renderParamControls();
  loadScriptDoc(null);
  generatePlotBtn.disabled = true;
  setWorkbookStatus("尚未加载文件", false);
  setPlotStatus("请先选择绘图脚本。", false);

  if (hasCalcWorkbench) {
    calcScriptSelect.addEventListener("change", handleCalcChange);
    runCalcBtn.addEventListener("click", handleRunCalc);
    if (exportCalcBtn) exportCalcBtn.addEventListener("click", handleExportCalcPng);
    renderCalcSelect();
    renderCalcParamControls();
    clearCalcWorkbenchPanel();
    runCalcBtn.disabled = true;
    setCalcExportEnabled(false);
    renderCalcResultPlaceholder("请选择计算项目后展示内容。");
    setCalcStatus("请先选择计算项目。", false);
  }
})();
