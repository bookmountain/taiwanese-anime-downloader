// ═══════════════════════════════════════════════════════════════════════════
// Anime Downloader — Frontend Application (TypeScript)
// Types are in types.d.ts
// ═══════════════════════════════════════════════════════════════════════════

// ─── State ────────────────────────────────────────────────────────────────

/// <reference path="./types.d.ts" />

interface AppState {
  currentView: "search" | "detail" | "download";
  selectedEpisodes: Set<string>;
  downloadFolder: string | null;
  animeDetail: AnimeDetail | null;
  activeSeason: number;
  downloadEpisodes: DownloadEpisode[];
  episodeProgress: Map<string, ProgressData>;
  isDownloading: boolean;
}

interface DownloadEpisode {
  seasonIndex: number;
  seasonName: string;
  progressId: string;
  episode: Episode;
}

const state: AppState = {
  currentView: "search",
  selectedEpisodes: new Set(),
  downloadFolder: null,
  animeDetail: null,
  activeSeason: 0,
  downloadEpisodes: [],
  episodeProgress: new Map(),
  isDownloading: false,
};

// ─── DOM References ───────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const dom = {
  btnBack: $("#btn-back"),
  btnSearch: $("#btn-search"),
  searchInput: $("#search-input") as HTMLInputElement,
  depStatus: $("#dep-status"),

  viewSearch: $("#view-search"),
  viewDetail: $("#view-detail"),
  viewDownload: $("#view-download"),

  searchWelcome: $("#search-welcome"),
  searchLoading: $("#search-loading"),
  searchError: $("#search-error"),
  searchResults: $("#search-results"),

  detailLoading: $("#detail-loading"),
  detailContent: $("#detail-content"),
  detailImage: $("#detail-image") as HTMLImageElement,
  detailTitle: $("#detail-title"),
  detailDesc: $("#detail-desc"),
  detailUpdate: $("#detail-update"),
  detailStatus: $("#detail-status"),
  detailTags: $("#detail-tags"),
  seasonTabs: $("#season-tabs"),
  episodeList: $("#episode-list"),

  btnFolder: $("#btn-folder"),
  folderPath: $("#folder-path"),
  btnSelectAll: $("#btn-select-all"),
  btnDeselectAll: $("#btn-deselect-all"),
  btnGotoDownload: $("#btn-goto-download"),
  btnDownload: $("#btn-download") as HTMLButtonElement,

  downloadTitle: $("#download-title"),
  btnCancelDownload: $("#btn-cancel-download"),
  overallFill: $("#overall-fill"),
  overallText: $("#overall-text"),
  downloadLog: $("#download-log"),
  downloadEpisodes: $("#download-episodes"),
};

// ─── Utilities ────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Sanitize a string for use as a folder/file name on all OS */
function sanitizeFolderName(name: string): string {
  return (
    name
      // Remove characters invalid on Windows/macOS/Linux
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      // Replace fullwidth variants too
      .replace(/[＜＞：＂／＼｜？＊]/g, "")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
      // Don't end with a dot or space (Windows issue)
      .replace(/[. ]+$/, "")
  );
}

function getEpisodeKey(seasonIndex: number, episode: Episode): string {
  return `${seasonIndex}:${episode.href || episode.number}`;
}

function getSeasonProgressId(seasonIndex: number): string {
  return `${state.animeDetail?.cartoonId || "anime"}-s${seasonIndex}`;
}

function getProgressKey(progressId: string, episodeNumber: number): string {
  return `${progressId}-${episodeNumber}`;
}

function getActiveSeason(): Season | null {
  return state.animeDetail?.seasons[state.activeSeason] || null;
}

function toDownloadEpisode(
  seasonIndex: number,
  season: Season,
  episode: Episode,
): DownloadEpisode {
  return {
    seasonIndex,
    seasonName: season.name,
    progressId: getSeasonProgressId(seasonIndex),
    episode,
  };
}

function getSelectedEpisodesForSeason(seasonIndex: number): DownloadEpisode[] {
  const season = state.animeDetail?.seasons[seasonIndex];
  if (!season) return [];
  return season.episodes
    .filter((ep) => state.selectedEpisodes.has(getEpisodeKey(seasonIndex, ep)))
    .map((ep) => toDownloadEpisode(seasonIndex, season, ep));
}

function getAllSelectedEpisodes(): DownloadEpisode[] {
  if (!state.animeDetail) return [];
  return state.animeDetail.seasons.flatMap((_season, seasonIndex) =>
    getSelectedEpisodesForSeason(seasonIndex),
  );
}

function groupBySeason(episodes: DownloadEpisode[]): DownloadEpisode[][] {
  const groups = new Map<number, DownloadEpisode[]>();
  for (const item of episodes) {
    const seasonGroup = groups.get(item.seasonIndex) || [];
    seasonGroup.push(item);
    groups.set(item.seasonIndex, seasonGroup);
  }
  return Array.from(groups.values());
}

// ─── Navigation ───────────────────────────────────────────────────────────

function showView(view: "search" | "detail" | "download"): void {
  state.currentView = view;

  dom.viewSearch.classList.toggle("active", view === "search");
  dom.viewDetail.classList.toggle("active", view === "detail");
  dom.viewDownload.classList.toggle("active", view === "download");
  // Show/hide the "go to download" button in the header when there are downloads
  const hasDownloads = state.downloadEpisodes.length > 0 || state.isDownloading;
  dom.btnGotoDownload.classList.toggle(
    "hidden",
    !(view !== "download" && hasDownloads),
  );
  dom.btnBack.classList.toggle("hidden", view === "search");
}

dom.btnBack.addEventListener("click", () => {
  if (state.currentView === "download") {
    showView("detail");
  } else {
    showView("search");
  }
});

// ─── Dependency Check ─────────────────────────────────────────────────────

async function checkDeps(): Promise<void> {
  const deps = await window.api.checkDeps();
  dom.depStatus.innerHTML = `
    <span class="dep-badge ${deps.python ? "ok" : "fail"}">Python ${deps.python ? "✓" : "✗"}</span>
    <span class="dep-badge ${deps.ffmpeg ? "ok" : "fail"}">FFmpeg ${deps.ffmpeg ? "✓" : "✗"}</span>
  `;
}

// ─── Search ───────────────────────────────────────────────────────────────

async function performSearch(): Promise<void> {
  const query = dom.searchInput.value.trim();
  if (!query) return;

  showView("search");
  dom.searchWelcome.classList.add("hidden");
  dom.searchError.classList.add("hidden");
  dom.searchResults.innerHTML = "";
  dom.searchLoading.classList.remove("hidden");

  const result = await window.api.search(query);

  dom.searchLoading.classList.add("hidden");

  if (!result.success || !result.data) {
    dom.searchError.textContent = `搜索失敗：${result.error || "未知錯誤"}`;
    dom.searchError.classList.remove("hidden");
    return;
  }

  if (result.data.length === 0) {
    dom.searchError.textContent = `沒有找到 "${query}" 的結果`;
    dom.searchError.classList.remove("hidden");
    return;
  }

  renderSearchResults(result.data);
}

function renderSearchResults(results: SearchResult[]): void {
  dom.searchResults.innerHTML = results
    .map(
      (r) => `
    <div class="result-card" data-url="${escapeHtml(r.detailUrl)}">
      <div class="result-card-tags">
        ${r.tags
          .slice(0, 3)
          .map((t) => `<span class="result-tag">${escapeHtml(t)}</span>`)
          .join("")}
      </div>
      <img class="result-card-image" src="${escapeHtml(r.image)}" alt="${escapeHtml(r.title)}" loading="lazy"
           onerror="this.style.background='var(--bg-secondary)'">
      <div class="result-card-body">
        <div class="result-card-title">${escapeHtml(r.title)}</div>
        ${r.author ? `<div class="result-card-author">${escapeHtml(r.author)}</div>` : ""}
      </div>
    </div>
  `,
    )
    .join("");

  // Click handler for cards
  dom.searchResults.querySelectorAll(".result-card").forEach((card) => {
    card.addEventListener("click", () => {
      const url = (card as HTMLElement).dataset.url;
      if (url) loadDetail(url);
    });
  });
}

// ─── Detail ───────────────────────────────────────────────────────────────

async function loadDetail(url: string): Promise<void> {
  // Clear old cached data immediately so it doesn't flash
  dom.detailImage.src = "";
  dom.detailTitle.textContent = "";
  dom.detailDesc.textContent = "";
  dom.detailUpdate.innerHTML = "";
  dom.detailStatus.innerHTML = "";
  dom.detailTags.innerHTML = "";
  dom.seasonTabs.innerHTML = "";
  dom.episodeList.innerHTML = "";

  showView("detail");
  dom.detailContent.style.opacity = "0.3";
  dom.detailLoading.classList.remove("hidden");

  const result = await window.api.getDetail(url);

  dom.detailLoading.classList.add("hidden");
  dom.detailContent.style.opacity = "1";

  if (!result.success || !result.data) {
    showView("search");
    dom.searchError.textContent = `加載詳情失敗：${result.error || "未知錯誤"}`;
    dom.searchError.classList.remove("hidden");
    return;
  }

  state.animeDetail = result.data;
  state.selectedEpisodes.clear();
  state.activeSeason = 0;

  renderDetail(result.data);
}

function renderDetail(detail: AnimeDetail): void {
  dom.detailImage.src = detail.image;
  dom.detailTitle.textContent = detail.title;
  dom.detailDesc.textContent = detail.description || "暫無簡介";
  dom.detailUpdate.innerHTML = detail.updateDate
    ? `<strong>更新時間：</strong>${escapeHtml(detail.updateDate)}`
    : "";
  dom.detailStatus.innerHTML = detail.status
    ? `<strong>更新狀態：</strong>${escapeHtml(detail.status)}`
    : "";

  // Tags
  dom.detailTags.innerHTML = detail.tags
    .map((t) => `<span class="detail-tag">${escapeHtml(t)}</span>`)
    .join("");

  // Season tabs
  if (detail.seasons.length > 1) {
    dom.seasonTabs.innerHTML = detail.seasons
      .map(
        (s, i) =>
          `<button class="season-tab${i === 0 ? " active" : ""}" data-idx="${i}">${escapeHtml(s.name)}</button>`,
      )
      .join("");

    dom.seasonTabs.querySelectorAll(".season-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const idx = parseInt((tab as HTMLElement).dataset.idx || "0");
        state.activeSeason = idx;
        dom.seasonTabs
          .querySelectorAll(".season-tab")
          .forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        renderEpisodes(detail.seasons[idx].episodes);
        updateFolderPath();
        updateDownloadButton();
      });
    });
  } else {
    dom.seasonTabs.innerHTML = "";
  }

  // Episodes
  if (detail.seasons.length > 0) {
    renderEpisodes(detail.seasons[0].episodes);
  }

  // Auto-update display path if base folder already chosen
  updateFolderPath();

  updateDownloadButton();
}

function renderEpisodes(episodes: Episode[]): void {
  dom.episodeList.innerHTML = episodes
    .map(
      (ep) => {
        const key = getEpisodeKey(state.activeSeason, ep);
        return `
    <div class="episode-item${state.selectedEpisodes.has(key) ? " selected" : ""}" data-num="${ep.number}" data-key="${escapeAttr(key)}">
      <div class="episode-checkbox"></div>
      <span class="episode-title">${escapeHtml(ep.title)}</span>
    </div>
  `;
      },
    )
    .join("");

  dom.episodeList.querySelectorAll(".episode-item").forEach((item) => {
    item.addEventListener("click", () => {
      const key = (item as HTMLElement).dataset.key;
      if (!key) return;
      if (state.selectedEpisodes.has(key)) {
        state.selectedEpisodes.delete(key);
        item.classList.remove("selected");
      } else {
        state.selectedEpisodes.add(key);
        item.classList.add("selected");
      }
      updateDownloadButton();
    });
  });
}

function updateDownloadButton(): void {
  const selectedCount = getAllSelectedEpisodes().length;
  const hasSelection = selectedCount > 0;
  const hasFolder = !!state.downloadFolder;
  dom.btnDownload.disabled = !(hasSelection && hasFolder);

  const label = dom.btnDownload.querySelector("span");
  if (label) {
    label.textContent = hasSelection
      ? `下載 ${selectedCount} 集`
      : "開始下載";
  }
}

// ─── Selection Controls ───────────────────────────────────────────────────

dom.btnSelectAll.addEventListener("click", () => {
  if (!state.animeDetail) return;

  const season = getActiveSeason();
  if (!season) return;

  season.episodes.forEach((ep) =>
    state.selectedEpisodes.add(getEpisodeKey(state.activeSeason, ep)),
  );

  // Visually mark the currently displayed episodes as selected
  dom.episodeList
    .querySelectorAll(".episode-item")
    .forEach((el) => el.classList.add("selected"));
  updateDownloadButton();
});

dom.btnDeselectAll.addEventListener("click", () => {
  state.selectedEpisodes.clear();
  dom.episodeList
    .querySelectorAll(".episode-item")
    .forEach((el) => el.classList.remove("selected"));
  updateDownloadButton();
});

// ─── Folder Picker ────────────────────────────────────────────────────────

dom.btnFolder.addEventListener("click", async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    state.downloadFolder = folder;
    updateFolderPath();
    updateDownloadButton();
  }
});

function updateFolderPath(): void {
  if (!state.downloadFolder) return;
  const displayPath = getOutputDir(state.downloadFolder);
  dom.folderPath.textContent = displayPath;
  dom.folderPath.title = displayPath;
}

/** Build the output directory root: base folder + sanitized anime title */
function getAnimeOutputDir(baseFolder?: string | null): string {
  const folder = baseFolder || state.downloadFolder;
  if (!folder) return "";
  if (state.animeDetail) {
    const safeName = sanitizeFolderName(state.animeDetail.title);
    if (safeName) {
      return `${folder}/${safeName}`;
    }
  }
  return folder;
}

/** Build the display output directory, including the active season when present. */
function getOutputDir(
  baseFolder?: string | null,
  seasonIndex = state.activeSeason,
): string {
  const basePath = getAnimeOutputDir(baseFolder);
  if (!basePath || !state.animeDetail || state.animeDetail.seasons.length <= 1) {
    return basePath;
  }

  const seasonName = state.animeDetail.seasons[seasonIndex]?.name;
  const safeSeason = seasonName ? sanitizeFolderName(seasonName) : "";
  return safeSeason ? `${basePath}/${safeSeason}` : basePath;
}

// ─── Download ─────────────────────────────────────────────────────────────

dom.btnDownload.addEventListener("click", startDownloadFlow);

async function startDownloadFlow(): Promise<void> {
  if (!state.animeDetail || !state.downloadFolder) return;

  const selectedEps = getAllSelectedEpisodes();
  if (selectedEps.length === 0) return;

  // Immediately disable button to prevent double-click double-queueing
  dom.btnDownload.disabled = true;

  // Switch to download view
  showView("download");

  const shouldResetLog = state.downloadEpisodes.length === 0;

  // Split selection into episodes not yet in the queue vs. re-selected ones.
  // Each row's DOM id is `progressId-number`; appending a re-selected episode
  // would create a duplicate row AND a colliding id (progress would render onto
  // the first matching element). So we only append genuinely new episodes, and
  // reset the existing rows for re-downloads to re-run in place.
  const queuedKeys = new Set(
    state.downloadEpisodes.map((item) =>
      getProgressKey(item.progressId, item.episode.number),
    ),
  );
  const freshEps = selectedEps.filter(
    (item) =>
      !queuedKeys.has(getProgressKey(item.progressId, item.episode.number)),
  );
  const repeatEps = selectedEps.filter((item) =>
    queuedKeys.has(getProgressKey(item.progressId, item.episode.number)),
  );

  // Track the *newly added* episodes globally
  state.downloadEpisodes.push(...freshEps);
  state.isDownloading = true;

  // Reset progress text (only overall text, bars are appended)
  dom.overallFill.style.width = "0%";
  dom.overallText.textContent = "0%";
  // Only clear the log if this is the FIRST item in the queue,
  // otherwise let the log keep appending.
  if (shouldResetLog) {
    dom.downloadLog.innerHTML = "";
    state.episodeProgress.clear();
  }

  // Reset the rows of re-selected episodes so they re-download in place.
  for (const item of repeatEps) {
    const rowId = getProgressKey(item.progressId, item.episode.number);
    state.episodeProgress.delete(rowId);
    const fill = document.getElementById(`fill-${rowId}`);
    const info = document.getElementById(`info-${rowId}`);
    const statusEl = document.getElementById(`status-${rowId}`);
    if (fill) {
      fill.style.width = "0%";
      fill.className = "dl-ep-fill";
    }
    if (info) info.textContent = "等待開始";
    if (statusEl) {
      statusEl.className = "dl-ep-status";
      statusEl.textContent = "等待中...";
    }
  }

  // Reset cancel button text
  const cancelSpan = dom.btnCancelDownload.querySelector("span");
  if (cancelSpan) cancelSpan.textContent = "取消下載";

  // Append only the genuinely new episodes to the list
  const newHtml = freshEps
    .map(
      (item) => {
        const rowId = getProgressKey(item.progressId, item.episode.number);
        const seasonPrefix =
          state.animeDetail!.seasons.length > 1
            ? `${item.seasonName} - `
            : "";
        return `
    <div class="dl-ep-item">
      <div class="dl-ep-header">
        <span class="dl-ep-title">${escapeHtml(state.animeDetail!.title)} - ${escapeHtml(seasonPrefix)}${escapeHtml(item.episode.title)}</span>
        <span class="dl-ep-status" id="status-${escapeAttr(rowId)}">等待中...</span>
      </div>
      <div class="dl-ep-bar">
        <div class="dl-ep-fill" id="fill-${escapeAttr(rowId)}"></div>
      </div>
      <div class="dl-ep-info" id="info-${escapeAttr(rowId)}">等待開始</div>
    </div>
  `;
      },
    )
    .join("");

  dom.downloadEpisodes.insertAdjacentHTML("beforeend", newHtml);

  // Switch to download view
  showView("download");
  dom.downloadTitle.textContent = `下載陣列 (共 ${state.downloadEpisodes.length} 集)`;

  state.isDownloading = true;

  // Remove local listener setups. We will do this globally once.

  // Build output dir with title subfolder. Main process appends season folders.
  const outputDir = getAnimeOutputDir();

  for (const seasonGroup of groupBySeason(selectedEps)) {
    const first = seasonGroup[0];
    const result = await window.api.startDownload({
      cartoonId: state.animeDetail.cartoonId,
      progressId: first.progressId,
      episodes: seasonGroup.map((item) => item.episode),
      outputDir: outputDir,
      detailUrl: state.animeDetail.detailUrl,
      seasonName: first.seasonName,
    });

    if (!result.success) {
      addLogLine(`[錯誤] ${result.error}`, true);
    }
  }
}

function updateEpisodeProgress(data: ProgressData, progressId: string): void {
  const rowId = getProgressKey(progressId, data.episode);
  const fill = document.getElementById(`fill-${rowId}`);
  const info = document.getElementById(`info-${rowId}`);
  const statusEl = document.getElementById(`status-${rowId}`);

  if (!fill || !info || !statusEl) return;

  fill.style.width = `${data.percent}%`;

  if (data.status === "done" || (data.percent >= 100 && !data.status)) {
    fill.className = "dl-ep-fill done";
    statusEl.className = "dl-ep-status done";
    statusEl.textContent = "完成";
    info.textContent = "";
  } else if (data.status === "failed") {
    fill.className = "dl-ep-fill failed";
    statusEl.className = "dl-ep-status failed";
    statusEl.textContent = "失敗";
  } else if (data.status === "skipped") {
    fill.style.width = "100%";
    fill.className = "dl-ep-fill skipped";
    statusEl.className = "dl-ep-status skipped";
    statusEl.textContent = "已跳過";
  } else {
    fill.className = "dl-ep-fill";
    statusEl.className = "dl-ep-status downloading";
    statusEl.textContent = `${data.percent.toFixed(1)}%`;
    const parts: string[] = [];
    if (data.speed) parts.push(data.speed);
    if (data.eta && data.eta !== "--:--") parts.push(`ETA: ${data.eta}`);
    info.textContent = parts.join(" | ");
  }
}

function updateOverallProgress(): void {
  if (state.downloadEpisodes.length === 0) return;

  let totalPercent = 0;
  for (const item of state.downloadEpisodes) {
    const key = getProgressKey(item.progressId, item.episode.number);
    totalPercent += state.episodeProgress.get(key)?.percent || 0;
  }

  const overall = totalPercent / state.downloadEpisodes.length;
  dom.overallFill.style.width = `${overall}%`;
  dom.overallText.textContent = `${overall.toFixed(1)}%`;
}

function addLogLine(msg: string, isError = false): void {
  const div = document.createElement("div");
  div.className = `log-line${isError ? " error" : msg.includes("[INFO]") ? " info" : ""}`;
  div.textContent = msg;
  dom.downloadLog.appendChild(div);
  dom.downloadLog.scrollTop = dom.downloadLog.scrollHeight;
}

// ─── Cancel Download ──────────────────────────────────────────────────────

dom.btnCancelDownload.addEventListener("click", async () => {
  await window.api.cancelDownload();
  state.isDownloading = false;
  state.downloadEpisodes = [];
  state.episodeProgress.clear();
  dom.downloadEpisodes.innerHTML = "";
  dom.overallFill.style.width = "0%";
  dom.overallText.textContent = "0%";
  dom.downloadTitle.textContent = "下載陣列";
  showView("detail");
  updateDownloadButton();
});

// "Go to download" button — returns to download view
dom.btnGotoDownload.addEventListener("click", () => {
  showView("download");
});

// ─── Search Event Listeners ───────────────────────────────────────────────

dom.btnSearch.addEventListener("click", performSearch);
dom.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") performSearch();
});

// ─── Initialize ───────────────────────────────────────────────────────────

function setupIpcListeners() {
  window.api.onDownloadProgress((data: ProgressData) => {
    if (!data.cartoonId) return;
    const key = getProgressKey(data.cartoonId, data.episode);
    state.episodeProgress.set(key, data);
    updateEpisodeProgress(data, data.cartoonId);
    updateOverallProgress();
  });

  window.api.onDownloadLog((msg: string) => {
    addLogLine(msg);
  });

  window.api.onDownloadComplete(({ code }) => {
    // Only mark as completely finished if no more episodes are left in queue
    // Actually, main.ts tells us when ONE process finishes. There might be more in queue.
    // For now, we'll just log it. We won't blindly show "返回" unless everything is 100%.
    addLogLine(
      code === 0 ? "[完成] 該系列下載已完成" : `[結束] 進程退出代碼: ${code}`,
    );

    // Check if ALL globally tracked episodes are done/skipped/failed
    const allDone =
      state.downloadEpisodes.length > 0 &&
      state.downloadEpisodes.every((item) => {
        const key = getProgressKey(item.progressId, item.episode.number);
        const p = state.episodeProgress.get(key);
        return (
          !!p &&
          (p.status === "done" ||
            p.status === "skipped" ||
            p.status === "failed")
        );
      });

    if (allDone) {
      state.isDownloading = false;
      const span = dom.btnCancelDownload.querySelector("span");
      if (span) span.textContent = "返回";
    }
  });

  window.api.onDownloadError((msg: string) => {
    addLogLine(`[錯誤] ${msg}`, true);
  });
}

checkDeps();
setupIpcListeners();
dom.searchInput.focus();
