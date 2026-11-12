/**
 * 图搜移动端 · 界面与交互
 */

import { DEFAULT_THRESHOLD, similarity } from "./core.js";
import { extractImage, formatBytes } from "./imageops.js";
import * as db from "./db.js";

const $ = (selector) => document.querySelector(selector);
const MAX_RESULTS = 40;

const state = {
  photos: [],
  photoMap: new Map(),
  scored: [],
  query: null,
  threshold: loadThreshold(),
  view: "search",
  importing: false,
  cancelImport: false,
  lastElapsed: 0,
  thumbUrls: new Map(),
  thumbRequests: new Map(),
  queryUrl: null,
  viewer: null,
  persist: "default",
};

let toastTimer = null;
let importFromHome = false;

function beginGalleryImport(fromHome = false) {
  if (state.importing) return;
  importFromHome = Boolean(fromHome);
  dom.importInput.click();
}

async function chooseFolder() {
  if (state.importing) return;

  if (typeof window.showDirectoryPicker === "function") {
    try {
      showToast("正在读取相册文件夹…");
      const directory = await window.showDirectoryPicker({ mode: "read" });
      const files = [];
      await collectDirectory(directory, "", files);
      if (!files.length) {
        showToast("这个文件夹里没有图片");
        return;
      }
      const confirmed = window.confirm(
        `找到 ${files.length} 张图片，全部勾选并导入？\n\n照片只在本机建立索引，不会上传。`,
      );
      if (!confirmed) return;
      await importFiles(files);
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.warn("目录选择失败，改用文件夹上传", error);
    }
  }
  dom.folderInput.click();
}

async function collectDirectory(handle, prefix, files) {
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === "directory") {
      await collectDirectory(entry, prefix ? `${prefix}/${name}` : name, files);
      continue;
    }
    if (entry.kind !== "file") continue;
    if (!/\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif)$/i.test(name)) continue;
    const file = await entry.getFile();
    if (!isImageFile(file)) continue;
    const relativeName = prefix ? `${prefix}/${name}` : name;
    files.push(
      new File([file], relativeName, {
        type: file.type,
        lastModified: file.lastModified,
      }),
    );
  }
}

const dom = {};

function loadThreshold() {
  const raw = Number(localStorage.getItem("is.threshold"));
  if (!Number.isFinite(raw) || raw < 50 || raw > 95) return DEFAULT_THRESHOLD;
  return raw / 100;
}

function basename(path) {
  return String(path || "").split(/[\\/]/).pop();
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function makeId(file) {
  const name = file.webkitRelativePath || file.name;
  return `${name}|${file.size}|${file.lastModified}`;
}

function isImageFile(file) {
  if (file.type && file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif)$/i.test(file.name || "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/* ============================================================ 启动 */

async function boot() {
  cacheDom();
  bindEvents();
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const directoryApi = typeof window.showDirectoryPicker === "function";
  const folderInputSupported = "webkitdirectory" in document.createElement("input");
  const folderCapable = !isIOS && (directoryApi || folderInputSupported);
  dom.btnImportFolder.hidden = !folderCapable;
  dom.btnSelectAllFolder.hidden = !folderCapable;
  dom.folderNote.hidden = false;
  if (!folderCapable) {
    dom.folderNote.textContent = "iOS 不支持整目录选择，请在系统相册中多选照片";
  } else if (directoryApi) {
    dom.folderNote.textContent = "选择相册文件夹后，会自动勾选并导入其中全部图片";
  } else {
    dom.folderNote.textContent = "选择相册文件夹后导入其中全部图片（取决于浏览器支持）";
  }
  applyTheme(storedTheme());
  syncThresholdUI();

  try {
    await db.openDB();
    state.photos = await db.getAllPhotos();
  } catch (error) {
    console.error(error);
    showToast("本地数据库不可用，请检查浏览器隐私设置");
  }
  indexPhotos();
  await updateLibraryUI();
  updatePersistUI();
  registerServiceWorker();

  const params = new URLSearchParams(location.search);
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") applyTheme(theme);

  if (params.get("demo") === "1") {
    await runDemo();
  }

  const view = params.get("view");
  if (view === "library" || view === "settings" || view === "search") {
    switchView(view);
  }

  document.body.dataset.ready = "1";
}

function cacheDom() {
  Object.assign(dom, {
    app: $("#app"),
    themeBtn: $("#themeBtn"),
    hero: $("#hero"),
    heroEmpty: $("#heroEmpty"),
    queryImage: $("#queryImage"),
    queryBadge: $("#queryBadge"),
    resetQuery: $("#resetQuery"),
    scanOverlay: $("#scanOverlay"),
    btnCamera: $("#btnCamera"),
    btnPick: $("#btnPick"),
    libraryHint: $("#libraryHint"),
    galleryCta: $("#galleryCta"),
    btnSelectAllFolder: $("#btnSelectAllFolder"),
    folderNote: $("#folderNote"),
    resultMeta: $("#resultMeta"),
    results: $("#results"),
    resultsEmpty: $("#resultsEmpty"),
    statCount: $("#statCount"),
    statSize: $("#statSize"),
    libraryList: $("#libraryList"),
    libraryEmpty: $("#libraryEmpty"),
    btnImport: $("#btnImport"),
    btnImportFolder: $("#btnImportFolder"),
    btnClear: $("#btnClear"),
    threshold: $("#threshold"),
    thresholdValue: $("#thresholdValue"),
    btnPersist: $("#btnPersist"),
    persistState: $("#persistState"),
    btnClearSettings: $("#btnClearSettings"),
    tabCount: $("#tabCount"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    views: Array.from(document.querySelectorAll(".view")),
    importOverlay: $("#importOverlay"),
    importTitle: $("#importTitle"),
    importSubtitle: $("#importSubtitle"),
    importBar: $("#importBar"),
    importCount: $("#importCount"),
    btnCancelImport: $("#btnCancelImport"),
    viewer: $("#viewer"),
    viewerName: $("#viewerName"),
    viewerImage: $("#viewerImage"),
    viewerScore: $("#viewerScore"),
    viewerMeta: $("#viewerMeta"),
    viewerClose: $("#viewerClose"),
    viewerShare: $("#viewerShare"),
    viewerUse: $("#viewerUse"),
    toast: $("#toast"),
    queryInput: $("#queryInput"),
    cameraInput: $("#cameraInput"),
    importInput: $("#importInput"),
    folderInput: $("#folderInput"),
  });
}

function bindEvents() {
  dom.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
  dom.themeBtn.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  dom.btnCamera.addEventListener("click", () => dom.cameraInput.click());
  dom.btnPick.addEventListener("click", () => dom.queryInput.click());
  dom.resetQuery.addEventListener("click", resetQuery);
  dom.libraryHint.addEventListener("click", () => {
    if (!state.photos.length) beginGalleryImport(true);
    else switchView("library");
  });
  dom.galleryCta.addEventListener("click", () => beginGalleryImport(true));
  dom.btnSelectAllFolder.addEventListener("click", chooseFolder);

  dom.queryInput.addEventListener("change", () => {
    const file = dom.queryInput.files && dom.queryInput.files[0];
    dom.queryInput.value = "";
    if (file) setQueryFromFile(file);
  });
  dom.cameraInput.addEventListener("change", () => {
    const file = dom.cameraInput.files && dom.cameraInput.files[0];
    dom.cameraInput.value = "";
    if (file) setQueryFromFile(file);
  });
  dom.importInput.addEventListener("change", () => {
    const files = Array.from(dom.importInput.files || []);
    dom.importInput.value = "";
    const fromHome = importFromHome;
    importFromHome = false;
    if (files.length) importFiles(files, { fromHome });
  });
  dom.folderInput.addEventListener("change", () => {
    const files = Array.from(dom.folderInput.files || []);
    dom.folderInput.value = "";
    if (files.length) importFiles(files);
  });

  dom.btnImport.addEventListener("click", () => beginGalleryImport(false));
  dom.btnImportFolder.addEventListener("click", chooseFolder);
  dom.btnClear.addEventListener("click", clearLibrary);
  dom.btnClearSettings.addEventListener("click", clearLibrary);
  dom.btnPersist.addEventListener("click", requestPersistence);

  dom.threshold.addEventListener("input", () => {
    const value = Number(dom.threshold.value);
    state.threshold = value / 100;
    localStorage.setItem("is.threshold", String(value));
    syncThresholdUI();
    if (state.query) renderResults();
  });

  dom.btnCancelImport.addEventListener("click", () => {
    state.cancelImport = true;
    dom.btnCancelImport.textContent = "正在取消…";
  });

  dom.viewerClose.addEventListener("click", closeViewer);
  dom.viewerUse.addEventListener("click", useViewerAsQuery);
  dom.viewerShare.addEventListener("click", shareViewerImage);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!dom.viewer.hidden) closeViewer();
    }
  });
  window.addEventListener("hashchange", () => {
    const view = location.hash.replace("#", "");
    if (["search", "library", "settings"].includes(view)) switchView(view);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!location.protocol.startsWith("http")) return;
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Service Worker 注册失败", error);
  });
}

/* ============================================================ 主题 */

function storedTheme() {
  const stored = localStorage.getItem("is.theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("is.theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0f17" : "#f3f5fa");
}

/* ============================================================ 图库 */

function indexPhotos() {
  state.photoMap = new Map(state.photos.map((photo) => [photo.id, photo]));
}

async function refreshLibrary() {
  state.photos = await db.getAllPhotos();
  indexPhotos();
  await updateLibraryUI();
  if (state.view === "library") renderLibrary();
}

async function updateLibraryUI() {
  const count = state.photos.length;
  dom.statCount.textContent = count.toLocaleString("zh-CN");
  dom.tabCount.textContent = count > 99 ? "99+" : String(count);
  dom.tabCount.hidden = count === 0;
  dom.libraryEmpty.hidden = count > 0;
  dom.galleryCta.hidden = count > 0;

  if (count === 0) {
    dom.libraryHint.textContent = "照片只在本机处理，不会上传";
    dom.libraryHint.classList.remove("action");
  } else {
    dom.libraryHint.textContent = `${count} 张照片已就绪 · 点击管理图库`;
    dom.libraryHint.classList.add("action");
  }

  const estimate = await db.storageEstimate();
  if (estimate && Number.isFinite(estimate.usage)) {
    dom.statSize.textContent = formatBytes(estimate.usage);
  } else {
    dom.statSize.textContent = "—";
  }

  if (state.view === "library") renderLibrary();
}

function renderLibrary() {
  if (!dom.libraryList) return;
  dom.libraryList.innerHTML = "";
  dom.libraryEmpty.hidden = state.photos.length > 0;
  const recent = state.photos.slice(0, 30);

  for (const photo of recent) {
    const item = document.createElement("div");
    item.className = "library-item";

    const image = document.createElement("img");
    image.className = "library-thumb";
    image.alt = "";

    const info = document.createElement("div");
    info.className = "library-info";
    const name = document.createElement("strong");
    name.textContent = basename(photo.name);
    const meta = document.createElement("span");
    meta.textContent = `${photo.width} × ${photo.height} · ${formatBytes(photo.size)}`;
    info.append(name, meta);

    const remove = document.createElement("button");
    remove.className = "library-del";
    remove.type = "button";
    remove.setAttribute("aria-label", "从图库删除");
    remove.innerHTML = '<svg class="icon"><use href="#i-trash"></use></svg>';
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removePhoto(photo.id);
    });

    item.append(image, info, remove);
    item.addEventListener("click", () => openViewer({ kind: "stored", photo }));
    dom.libraryList.appendChild(item);

    thumbUrlFor(photo.id).then((url) => {
      if (url && image.isConnected) image.src = url;
    });
  }
}

async function removePhoto(id) {
  const photo = state.photoMap.get(id);
  if (!photo) return;
  if (!window.confirm(`从图库中删除「${basename(photo.name)}」？`)) return;
  try {
    await db.deletePhoto(id);
  } catch (error) {
    console.error(error);
    showToast("删除失败，请稍后重试");
    return;
  }
  state.photos = state.photos.filter((item) => item.id !== id);
  indexPhotos();
  if (state.query && state.query.sourceId === id) state.query.sourceId = null;
  if (state.viewer && state.viewer.photo && state.viewer.photo.id === id) closeViewer();
  await updateLibraryUI();
  if (state.query) {
    await runSearch();
  } else {
    renderResults();
  }
  showToast("已从图库删除");
}

async function clearLibrary() {
  if (!state.photos.length) {
    showToast("图库已经是空的");
    return;
  }
  if (!window.confirm(`确定清空全部 ${state.photos.length} 张照片的索引？`)) return;
  try {
    await db.clearAll();
  } catch (error) {
    console.error(error);
    showToast("清空失败，请稍后重试");
    return;
  }
  for (const url of state.thumbUrls.values()) URL.revokeObjectURL(url);
  state.thumbUrls.clear();
  state.photos = [];
  state.photoMap.clear();
  state.scored = [];
  closeViewer();
  await updateLibraryUI();
  renderResults();
  showToast("图库已清空");
}

/* ============================================================ 导入 */

async function importFiles(fileList, options = {}) {
  if (state.importing) return { added: 0, skipped: 0, failed: 0 };
  const files = Array.from(fileList).filter(isImageFile);
  if (!files.length) {
    showToast("没有找到可导入的图片");
    return { added: 0, skipped: 0, failed: 0 };
  }

  const existing = new Set(state.photos.map((photo) => photo.id));
  const todo = files.filter((file) => !existing.has(makeId(file)));
  const skipped = files.length - todo.length;
  if (!todo.length) {
    if (!options.demo) showToast("这些照片已经在图库中了");
    return { added: 0, skipped, failed: 0 };
  }

  state.importing = true;
  state.cancelImport = false;
  dom.importOverlay.hidden = false;
  dom.importTitle.textContent = options.demo ? "正在准备演示图库" : "正在建立索引";
  dom.importSubtitle.textContent = "照片越多，需要的时间越长";
  dom.importBar.style.width = "0%";
  dom.importCount.textContent = `0 / ${todo.length}`;
  dom.btnCancelImport.textContent = "取消";

  let added = 0;
  let failed = 0;
  let quotaExceeded = false;
  let cancelled = false;

  try {
    for (let index = 0; index < todo.length; index += 1) {
      if (state.cancelImport) break;
      const file = todo[index];
      dom.importSubtitle.textContent = truncate(basename(file.name), 26);
      dom.importCount.textContent = `${index + 1} / ${todo.length}`;
      dom.importBar.style.width = `${Math.round((index / todo.length) * 100)}%`;

      try {
        const result = await extractImage(file);
        const record = {
          id: makeId(file),
          name: file.webkitRelativePath || file.name,
          size: file.size,
          mtime: file.lastModified,
          width: result.width,
          height: result.height,
          ...result.features,
          added: Date.now() + index,
        };
        await db.putPhoto(record, result.thumb);
        added += 1;
      } catch (error) {
        failed += 1;
        console.error("导入失败", file.name, error);
        if (error && error.name === "QuotaExceededError") {
          quotaExceeded = true;
          break;
        }
      }

      if (index % 2 === 0) await nextFrame();
    }
  } finally {
    cancelled = state.cancelImport;
    dom.importBar.style.width = "100%";
    dom.importCount.textContent = `${Math.min(added + failed, todo.length)} / ${todo.length}`;
    await delay(160);
    dom.importOverlay.hidden = true;
    state.importing = false;
    state.cancelImport = false;
  }

  await refreshLibrary();
  if (state.query) await runSearch();

  if (!options.demo) {
    if (quotaExceeded) {
      showToast("手机存储空间不足，已停止导入");
    } else if (cancelled) {
      showToast(`已取消，导入了 ${added} 张`);
    } else {
      const parts = [`已导入 ${added} 张`];
      if (skipped) parts.push(`跳过 ${skipped} 张重复`);
      if (failed) parts.push(`${failed} 张失败`);
      showToast(parts.join("，"));
    }
  }
  if (options.fromHome && added > 0 && !state.query) {
    switchView("library");
  }
  return { added, skipped, failed };
}

/* ============================================================ 查询与搜索 */

async function setQueryFromFile(file) {
  if (!file || !isImageFile(file)) {
    showToast("请选择图片文件");
    return;
  }
  setScanning(true);
  try {
    const result = await extractImage(file);
    applyQuery({
      features: result.features,
      thumb: result.thumb,
      width: result.width,
      height: result.height,
      name: basename(file.name),
      sourceId: null,
    });
    await runSearch();
  } catch (error) {
    console.error(error);
    showToast("无法读取这张图片");
  } finally {
    setScanning(false);
  }
}

async function setQueryFromRecord(photo) {
  const url = await thumbUrlFor(photo.id);
  if (!url) {
    showToast("缩略图已丢失，请重新导入");
    return;
  }
  applyQuery({
    features: photo,
    url,
    width: photo.width,
    height: photo.height,
    name: basename(photo.name),
    sourceId: photo.id,
  });
  await runSearch();
}

function releaseQueryUrl() {
  if (!state.queryUrl) return;
  if (![...state.thumbUrls.values()].includes(state.queryUrl)) {
    URL.revokeObjectURL(state.queryUrl);
  }
  state.queryUrl = null;
}

function applyQuery({ features, thumb, url, width, height, name, sourceId }) {
  releaseQueryUrl();
  state.queryUrl = url || URL.createObjectURL(thumb);
  state.query = {
    features,
    url: state.queryUrl,
    width,
    height,
    name,
    sourceId,
  };
  dom.queryImage.src = state.queryUrl;
  dom.queryImage.hidden = false;
  dom.heroEmpty.hidden = true;
  dom.queryBadge.hidden = false;
  dom.resetQuery.hidden = false;
  dom.resultMeta.textContent = "正在搜索…";
}

function setScanning(active) {
  dom.scanOverlay.hidden = !active;
  dom.btnCamera.disabled = active;
  dom.btnPick.disabled = active;
  dom.btnCamera.style.opacity = active ? "0.7" : "";
  dom.btnPick.style.opacity = active ? "0.7" : "";
}

function resetQuery() {
  releaseQueryUrl();
  state.query = null;
  state.scored = [];
  dom.queryImage.src = "";
  dom.queryImage.hidden = true;
  dom.heroEmpty.hidden = false;
  dom.queryBadge.hidden = true;
  dom.resetQuery.hidden = true;
  dom.resultMeta.textContent = "等待搜索";
  renderResults();
}

async function runSearch() {
  if (!state.query) return;
  const started = performance.now();
  const queryFeatures = state.query.features;
  const sourceId = state.query.sourceId;
  const scored = [];
  for (const photo of state.photos) {
    if (photo.id === sourceId) continue;
    scored.push({ photo, score: similarity(queryFeatures, photo) });
  }
  scored.sort((a, b) => b.score - a.score);
  state.scored = scored.slice(0, 500);
  state.lastElapsed = performance.now() - started;
  renderResults();
}

function scoreClass(score) {
  if (score >= 0.85) return "";
  if (score >= 0.72) return "mid";
  return "low";
}

function renderResults() {
  dom.results.innerHTML = "";
  const hasQuery = Boolean(state.query);
  const threshold = state.threshold;
  const visible = hasQuery
    ? state.scored.filter((item) => item.score >= threshold)
    : [];

  if (!hasQuery) {
    dom.resultMeta.textContent = "等待搜索";
    showResultsEmpty("no-query");
    return;
  }
  if (!state.photos.length) {
    dom.resultMeta.textContent = "图库为空";
    showResultsEmpty("no-library");
    return;
  }
  if (!visible.length) {
    dom.resultMeta.textContent = `0 张 · ${Math.max(0, Math.round(state.lastElapsed))} 毫秒`;
    showResultsEmpty("no-match");
    return;
  }

  dom.resultsEmpty.hidden = true;
  dom.resultMeta.textContent = `${visible.length} 张 · ${Math.max(
    1,
    Math.round(state.lastElapsed),
  )} 毫秒`;

  const fragment = document.createDocumentFragment();
  for (const hit of visible.slice(0, MAX_RESULTS)) {
    fragment.appendChild(createResultCard(hit));
  }
  dom.results.appendChild(fragment);
}

function createResultCard(hit) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "result-card";

  const media = document.createElement("div");
  media.className = "result-media";

  const image = document.createElement("img");
  image.alt = basename(hit.photo.name);
  image.loading = "lazy";
  image.decoding = "async";

  const badge = document.createElement("span");
  badge.className = `result-score ${scoreClass(hit.score)}`.trim();
  badge.textContent = `${Math.round(hit.score * 100)}%`;

  media.append(image, badge);

  const name = document.createElement("div");
  name.className = "result-name";
  name.textContent = truncate(basename(hit.photo.name), 24);

  card.append(media, name);
  card.addEventListener("click", () => openViewer({ kind: "result", hit }));

  thumbUrlFor(hit.photo.id).then((url) => {
    if (!url || !image.isConnected) return;
    image.src = url;
    image.addEventListener("load", () => media.classList.add("loaded"), { once: true });
    if (image.complete) media.classList.add("loaded");
  });

  return card;
}

function showResultsEmpty(kind) {
  dom.resultsEmpty.hidden = false;
  const content = {
    "no-query": {
      icon: "i-search",
      title: "还没有搜索结果",
      text: "选择照片后，这里会自动显示相似图片",
      action: "",
      label: "",
    },
    "no-library": {
      icon: "i-image",
      title: "图库还是空的",
      text: "点下面按钮打开手机相册，选择照片建立本地索引",
      action: "import",
      label: "一键导入手机相册",
    },
    "no-match": {
      icon: "i-search",
      title: "没有找到相似图片",
      text: `当前阈值为 ${Math.round(state.threshold * 100)}%，试试调低一点`,
      action: "settings",
      label: "调整阈值",
    },
  }[kind];

  dom.resultsEmpty.innerHTML = `
    <div class="empty-art"><svg class="icon"><use href="#${content.icon}"></use></svg></div>
    <h3></h3>
    <p></p>
    ${content.action ? '<button class="btn btn-soft small" type="button"></button>' : ""}
  `;
  dom.resultsEmpty.querySelector("h3").textContent = content.title;
  dom.resultsEmpty.querySelector("p").textContent = content.text;
  if (content.action) {
    const button = dom.resultsEmpty.querySelector("button");
    button.textContent = content.label;
    button.addEventListener("click", () => {
      if (content.action === "import") beginGalleryImport(true);
      else switchView("settings");
    });
  }
}

/* ============================================================ 缩略图 */

function thumbUrlFor(id) {
  if (state.thumbUrls.has(id)) return Promise.resolve(state.thumbUrls.get(id));
  if (state.thumbRequests.has(id)) return state.thumbRequests.get(id);

  const request = db
    .getThumb(id)
    .then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      state.thumbUrls.set(id, url);
      if (state.thumbUrls.size > 240) {
        const viewerId = state.viewer && state.viewer.photo ? state.viewer.photo.id : null;
        for (const [key, value] of state.thumbUrls) {
          if (key === id || key === viewerId) continue;
          if (value === state.queryUrl) continue;
          state.thumbUrls.delete(key);
          URL.revokeObjectURL(value);
          break;
        }
      }
      return url;
    })
    .finally(() => state.thumbRequests.delete(id));

  state.thumbRequests.set(id, request);
  return request;
}

/* ============================================================ 查看器 */

async function openViewer({ kind, hit, photo }) {
  const item = hit ? hit.photo : photo;
  if (!item) return;
  const url = await thumbUrlFor(item.id);
  if (!url) {
    showToast("无法读取这张图片");
    return;
  }

  state.viewer = { kind, photo: item, score: hit ? hit.score : null };
  dom.viewerName.textContent = basename(item.name);
  dom.viewerImage.src = url;
  dom.viewerMeta.textContent = `${item.width} × ${item.height} · ${formatBytes(item.size)}`;
  dom.viewerScore.textContent =
    kind === "result"
      ? `${Math.round(hit.score * 100)}% 相似`
      : kind === "stored"
        ? "图库照片"
        : "查询图片";
  dom.viewerUse.hidden = kind === "query";
  dom.viewerShare.hidden = !navigator.share;
  dom.viewer.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeViewer() {
  dom.viewer.hidden = true;
  dom.viewerImage.src = "";
  state.viewer = null;
  document.body.style.overflow = "";
}

function useViewerAsQuery() {
  const viewer = state.viewer;
  if (!viewer || !viewer.photo) return;
  const photo = viewer.photo;
  closeViewer();
  setQueryFromRecord(photo);
}

async function shareViewerImage() {
  const viewer = state.viewer;
  if (!viewer || !navigator.share) {
    showToast("当前浏览器不支持系统分享");
    return;
  }
  try {
    const blob = await db.getThumb(viewer.photo.id);
    if (!blob) throw new Error("没有可分享的图片");
    const file = new File([blob], basename(viewer.photo.name), { type: blob.type });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      showToast("当前浏览器不支持分享图片");
      return;
    }
    await navigator.share({ files: [file], title: "图搜 · 相似图片" });
  } catch (error) {
    if (error && error.name === "AbortError") return;
    console.error(error);
    showToast("分享失败");
  }
}

/* ============================================================ 设置 / 视图 */

function syncThresholdUI() {
  const value = Math.round(state.threshold * 100);
  dom.threshold.value = String(value);
  dom.thresholdValue.textContent = `${value}%`;
  const fill = ((value - 50) / 45) * 100;
  dom.threshold.style.setProperty("--fill", `${fill}%`);
}

async function updatePersistUI() {
  const value = await db.persistenceState();
  state.persist = value;
  const labels = {
    granted: "已开启",
    default: "未开启",
    denied: "未开启",
    unsupported: "不支持",
  };
  dom.persistState.textContent = labels[value] || "未开启";
  dom.btnPersist.disabled = value === "granted" || value === "unsupported";
  dom.btnPersist.style.opacity = dom.btnPersist.disabled ? "0.65" : "";
}

async function requestPersistence() {
  if (state.persist === "granted") {
    showToast("持久化存储已开启");
    return;
  }
  const result = await db.requestPersistence();
  await updatePersistUI();
  if (result === "granted") showToast("已开启，浏览器不会自动清理索引");
  else if (result === "denied") showToast("浏览器拒绝了持久化请求");
  else showToast("当前浏览器不支持该功能");
}

function switchView(view) {
  if (!["search", "library", "settings"].includes(view)) return;
  state.view = view;
  for (const section of dom.views) {
    section.hidden = section.id !== `view-${view}`;
  }
  for (const tab of dom.tabs) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
  if (view === "library") renderLibrary();
  if (view === "settings") updatePersistUI();
  window.scrollTo(0, 0);
  history.replaceState(null, "", `#${view}`);
}

/* ============================================================ 提示 */

function showToast(message) {
  if (!dom.toast) return;
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  void dom.toast.offsetWidth;
  dom.toast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("show");
    window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 220);
  }, 2400);
}

/* ============================================================ 演示模式 */

async function runDemo() {
  try {
    const { createDemoFiles } = await import("./demo.js");
    const files = await createDemoFiles();
    await importFiles(files, { demo: true });
    const base = files.find((file) => file.name.endsWith("original.jpg"));
    const record = base ? state.photoMap.get(makeId(base)) : null;
    if (record) {
      await setQueryFromRecord(record);
    } else if (base) {
      await setQueryFromFile(base);
    }
    switchView("search");
  } catch (error) {
    console.error("演示模式加载失败", error);
    showToast("演示图库加载失败");
  }
}

/* ============================================================ 导出（调试/测试） */

window.__imageSeek = {
  state,
  importFiles,
  setQueryFromFile,
  runSearch,
  switchView,
  refreshLibrary,
  renderResults,
};

boot().catch((error) => {
  console.error(error);
  document.body.dataset.ready = "error";
  if (dom.toast) showToast("应用加载失败，请刷新重试");
});
