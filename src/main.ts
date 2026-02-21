import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { spawn, execSync, ChildProcess } from "child_process";
import * as cheerio from "cheerio";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  image: string;
  tags: string[];
  author: string;
  detailUrl: string;
}

interface Episode {
  number: number;
  title: string;
  href: string;
}

interface Season {
  name: string;
  episodes: Episode[];
}

interface AnimeDetail {
  title: string;
  image: string;
  description: string;
  updateDate: string;
  status: string;
  tags: string[];
  seasons: Season[];
  cartoonId: string;
  detailUrl: string;
}

interface DownloadOptions {
  cartoonId: string;
  episodes: Episode[];
  outputDir: string;
  detailUrl: string;
}

interface ProgressData {
  episode: number;
  percent: number;
  downloaded?: string;
  total?: string;
  speed?: string;
  eta?: string;
  status?: string;
  filename?: string;
}

// ─── HTTP helper ────────────────────────────────────────────────────────────

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
          "Accept-Encoding": "identity",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      },
      (res: http.IncomingMessage) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          // Handle relative redirect URLs
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith("/")) {
            const parsed = new URL(url);
            redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
          } else if (!redirectUrl.startsWith("http")) {
            const parsed = new URL(url);
            redirectUrl = `${parsed.protocol}//${parsed.host}/${redirectUrl}`;
          }
          fetchUrl(redirectUrl).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// ─── Scraping API ───────────────────────────────────────────────────────────

const SEARCH_BASE = "https://tw.xgcartoon.com";
const VIDEO_BASE = "https://tw.xgcartoon.com";
const IMAGE_BASE = "https://static-a.xgcartoon.com";

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function searchAnime(query: string): Promise<SearchResult[]> {
  const url = `${SEARCH_BASE}/search?q=${encodeURIComponent(query)}`;
  const html = await fetchUrl(url);
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  // Parse search result items — the site uses amp-img for images
  $('a[href*="/detail/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";

    // Build full detail URL
    let detailUrl = href;
    if (href.startsWith("/")) {
      detailUrl = `${SEARCH_BASE}${href}`;
    } else if (!href.startsWith("http")) {
      detailUrl = `${SEARCH_BASE}/${href}`;
    }

    if (seenUrls.has(detailUrl)) return;
    seenUrls.add(detailUrl);

    // Extract image from amp-img or img
    let image = "";
    const $ampImg = $el.find("amp-img");
    if ($ampImg.length > 0) {
      image = $ampImg.attr("src") || "";
    }
    if (!image) {
      const $img = $el.find("img");
      image = $img.attr("data-src") || $img.attr("src") || "";
    }
    // Fix protocol-relative or relative image URLs
    if (image && !image.startsWith("http")) {
      if (image.startsWith("//")) {
        image = `https:${image}`;
      } else if (image.startsWith("/")) {
        image = `${IMAGE_BASE}${image}`;
      }
    }
    // Decode HTML entities in URL (&amp; → &)
    image = decodeHtmlEntities(image);

    // Extract title — get the deepest text that looks like a title
    let title = "";
    // Try finding specific title elements
    $el
      .find(
        ".search-result-item-title, .one-line-text, h3, .title, .topic-title",
      )
      .each((_, t) => {
        const text = $(t).text().trim();
        if (text.length > title.length) title = text;
      });
    // Fallback: get all text and pick the longest meaningful line
    if (!title) {
      const allText = $el.text().trim();
      const lines = allText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 2);
      // Find the longest line that's likely a title
      title = lines.reduce(
        (best, line) => (line.length > best.length ? line : best),
        "",
      );
    }

    // Extract tags
    const tags: string[] = [];
    $el.find('.tag, .label, span[class*="tag"]').each((_, t) => {
      const text = $(t).text().trim();
      if (text && text.length < 10 && !text.includes("\n")) tags.push(text);
    });

    // Extract author
    const author = $el
      .find('.author, .creator, .search-result-item-author, [class*="author"]')
      .text()
      .trim();

    if (title && title.length > 1) {
      results.push({ title, image, tags, author, detailUrl });
    }
  });

  return results;
}

async function getAnimeDetail(detailUrl: string): Promise<AnimeDetail> {
  // Ensure URL is absolute
  if (!detailUrl.startsWith("http")) {
    if (detailUrl.startsWith("/")) {
      detailUrl = `${SEARCH_BASE}${detailUrl}`;
    } else {
      detailUrl = `${SEARCH_BASE}/${detailUrl}`;
    }
  }

  console.log("[Detail] Fetching:", detailUrl);
  const html = await fetchUrl(detailUrl);
  const $ = cheerio.load(html);

  // Extract title
  const title =
    $("h1").first().text().trim() ||
    $('[class*="title"]').first().text().trim() ||
    "";

  // Extract cover image
  let image = "";
  const $cover = $("amp-img").first();
  if ($cover.length) {
    image = $cover.attr("src") || "";
  }
  if (!image) {
    const $img = $('img[src*="cover"]').first();
    image = $img.attr("src") || $img.attr("data-src") || "";
  }
  if (image && !image.startsWith("http")) {
    if (image.startsWith("//")) image = `https:${image}`;
    else if (image.startsWith("/")) image = `${IMAGE_BASE}${image}`;
  }
  image = decodeHtmlEntities(image);

  // Extract description
  const description =
    $(
      '[class*="introduction"], [class*="desc"], [class*="synopsis"], [class*="summary"]',
    )
      .text()
      .trim() ||
    $("p")
      .filter((_, el) => $(el).text().length > 50)
      .first()
      .text()
      .trim();

  // Extract update info
  const bodyText = $("body").text();
  const updateDate =
    bodyText.match(/更新時間[：:]*\s*(\d{4}[/.-]\d{2}[/.-]\d{2})/)?.[1] || "";
  const status = bodyText.match(/更新至.*?第\s*(\d+)\s*集/)?.[0]?.trim() || "";

  // Extract tags
  const tags: string[] = [];
  $('[class*="tag"] a, [class*="label"], [class*="genre"]').each((_, t) => {
    const text = $(t).text().trim();
    if (text && text.length < 15 && text.length > 0) tags.push(text);
  });

  // Extract cartoon_id from URL path
  let cartoonId = "";
  try {
    const detailPath = new URL(detailUrl).pathname;
    cartoonId = detailPath.split("/").filter(Boolean).pop() || "";
  } catch {
    // Fallback: extract from the URL string directly
    const parts = detailUrl.split("/").filter(Boolean);
    cartoonId = parts[parts.length - 1] || "";
  }

  // Extract seasons and episodes
  const seasons: Season[] = [];

  // Words that indicate non-episode links (navigation/action buttons)
  const SKIP_WORDS = [
    "播放",
    "收藏",
    "分享",
    "舉報",
    "登入",
    "登錄",
    "注冊",
    "註冊",
  ];
  const seenChapterIds = new Set<string>();

  // The site uses div.volume-title as season headers and a.goto-chapter as episode links.
  // They are all siblings inside #video-volumes-items (or a .row container).
  // Walk through children in DOM order to group episodes under each volume-title.

  // Find the container that holds volume-titles and episode links
  const $container = $(".volume-title").first().parent();

  if ($container.length > 0) {
    // Iterate through all direct children of the container
    let currentSeasonName = "";
    let currentEpisodes: Episode[] = [];

    $container.children().each((_idx, child) => {
      const $child = $(child);

      // Check if this is a volume-title (season header)
      if ($child.hasClass("volume-title")) {
        // Save the previous season if it has episodes
        if (currentEpisodes.length > 0) {
          seasons.push({
            name: currentSeasonName || `全 ${currentEpisodes.length} 話`,
            episodes: currentEpisodes,
          });
        }
        currentSeasonName = $child.text().trim();
        currentEpisodes = [];
        return; // continue
      }

      // Check if this child contains a goto-chapter link
      const $link = $child.find("a.goto-chapter");
      if ($link.length === 0) return;

      const epTitle = $link.text().trim().replace(/\s+/g, " ");
      const epHref = $link.attr("href") || "";

      // Skip non-episode items
      if (!epTitle) return;
      if (SKIP_WORDS.some((w) => epTitle.includes(w))) return;
      if (epTitle.length < 2) return;

      // Deduplicate by chapter_id
      const chapterMatch = epHref.match(/chapter_id=([a-zA-Z0-9]+)/);
      if (chapterMatch) {
        if (seenChapterIds.has(chapterMatch[1])) return;
        seenChapterIds.add(chapterMatch[1]);
      }

      // Skip "latest episode" shortcut entries
      if (/第\s*\d+\s*集\s*第\d+話/.test(epTitle)) return;

      // Parse the actual episode number from the title
      const numMatch = epTitle.match(/第\s*(\d+)\s*[話话集]/);
      const epNumber = numMatch ? parseInt(numMatch[1]) : 0;

      currentEpisodes.push({
        number: epNumber,
        title: epTitle,
        href: epHref,
      });
    });

    // Don't forget the last season group
    if (currentEpisodes.length > 0) {
      seasons.push({
        name: currentSeasonName || `全 ${currentEpisodes.length} 話`,
        episodes: currentEpisodes,
      });
    }
  } else {
    // Fallback: no volume-title found, try the old flat approach with goto-chapter links
    const allEpisodeLinks = $(
      'a[href*="chapter_id="].goto-chapter, a.goto-chapter[href*="chapter_id="]',
    );
    const episodes: Episode[] = [];

    allEpisodeLinks.each((_idx, ep) => {
      const $ep = $(ep);
      const epTitle = $ep.text().trim().replace(/\s+/g, " ");
      const epHref = $ep.attr("href") || "";

      if (!epTitle) return;
      if (SKIP_WORDS.some((w) => epTitle.includes(w))) return;
      if (epTitle.length < 2) return;

      const chapterMatch = epHref.match(/chapter_id=([a-zA-Z0-9]+)/);
      if (chapterMatch) {
        if (seenChapterIds.has(chapterMatch[1])) return;
        seenChapterIds.add(chapterMatch[1]);
      }

      if (/第\s*\d+\s*集\s*第\d+話/.test(epTitle)) return;

      const numMatch = epTitle.match(/第\s*(\d+)\s*[話话集]/);
      const epNumber = numMatch ? parseInt(numMatch[1]) : 0;

      episodes.push({
        number: epNumber,
        title: epTitle,
        href: epHref,
      });
    });

    // Sort and fix numbering
    episodes.sort((a, b) => a.number - b.number);
    let seqNum = 1;
    for (const ep of episodes) {
      if (ep.number === 0) ep.number = seqNum;
      seqNum = ep.number + 1;
    }

    if (episodes.length > 0) {
      seasons.push({ name: `全 ${episodes.length} 話`, episodes });
    }
  }

  // Sort episodes within each season and fix zero-numbered episodes
  for (const season of seasons) {
    season.episodes.sort((a, b) => a.number - b.number);
    let seqNum = 1;
    for (const ep of season.episodes) {
      if (ep.number === 0) ep.number = seqNum;
      seqNum = ep.number + 1;
    }
  }

  return {
    title,
    image,
    description,
    updateDate,
    status,
    tags,
    seasons,
    cartoonId,
    detailUrl,
  };
}

// ─── Download Manager ───────────────────────────────────────────────────────

interface QueueItem {
  win: BrowserWindow;
  options: DownloadOptions;
}

const downloadQueue: QueueItem[] = [];
let activeDownloadProcess: ChildProcess | null = null;
let queueProcessing = false;

function startDownload(win: BrowserWindow, options: DownloadOptions): void {
  downloadQueue.push({ win, options });
  if (!queueProcessing) {
    processQueue();
  }
}

function processQueue(): void {
  if (downloadQueue.length === 0) {
    queueProcessing = false;
    return;
  }

  queueProcessing = true;
  const current = downloadQueue[0]; // Peek at the first item
  const { win, options } = current;
  const { cartoonId, episodes, outputDir } = options;

  // Build a video URL from the first episode
  const firstEp = episodes[0];
  let videoUrl: string;

  if (firstEp.href && firstEp.href.includes("/video/")) {
    videoUrl = firstEp.href.startsWith("http")
      ? firstEp.href
      : `${VIDEO_BASE}${firstEp.href}`;
  } else {
    const chapterMatch = firstEp.href.match(/chapter_id=([a-zA-Z0-9]+)/);
    if (chapterMatch) {
      videoUrl = `${VIDEO_BASE}/video/${cartoonId}/${chapterMatch[1]}.html`;
    } else {
      videoUrl = `${VIDEO_BASE}/video/${cartoonId}/${firstEp.href}.html`;
    }
  }

  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const scriptPath = path.join(
    app.getAppPath(),
    "scripts",
    "download_episodes.py",
  );

  const args: string[] = [scriptPath, videoUrl, outputDir];

  if (episodes.length > 0) {
    const numbers = episodes.map((e) => e.number);
    args.push(String(Math.min(...numbers)));
    args.push(String(Math.max(...numbers)));
  }

  console.log(`[Download] Running: ${pythonCmd} ${args.join(" ")}`);

  const proc = spawn(pythonCmd, args, { env: { ...process.env } });
  activeDownloadProcess = proc;

  let buffer = "";

  proc.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString();
    // Split on both \r and \n — Python uses \r for progress bar updates
    const lines = buffer.split(/[\r\n]+/);
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Parse progress: "Ep.001 [█████░░░] 68.0% | 123MB/181MB | 5.2MB/s | 00:24 | ETA: 00:11"
      const progressMatch = line.match(
        /Ep\.(\d+).*?(\d+\.?\d*)%\s*\|\s*(\S+)\/(\S+)\s*\|\s*(\S+\/s)\s*\|.*?\|\s*ETA:\s*(\S+)/,
      );

      if (progressMatch) {
        win.webContents.send("download-progress", {
          cartoonId,
          episode: parseInt(progressMatch[1]),
          percent: parseFloat(progressMatch[2]),
          downloaded: progressMatch[3],
          total: progressMatch[4],
          speed: progressMatch[5],
          eta: progressMatch[6],
        } as ProgressData);
      } else if (line.includes("Done in")) {
        const doneMatch = line.match(/Ep\.(\d+)/);
        if (doneMatch) {
          win.webContents.send("download-progress", {
            cartoonId,
            episode: parseInt(doneMatch[1]),
            percent: 100,
            status: "done",
          } as ProgressData);
        }
      } else if (line.includes("SKIP")) {
        // "[1/3] SKIP 001_Episode.mp4 (245.3MB)"
        const skipIdxMatch = line.match(/\[(\d+)\/(\d+)\]/);
        const skipEpMatch = line.match(/SKIP\s+(\d+)_/);
        const epNum = skipEpMatch
          ? parseInt(skipEpMatch[1])
          : skipIdxMatch
            ? parseInt(skipIdxMatch[1])
            : 0;
        if (epNum > 0) {
          win.webContents.send("download-progress", {
            cartoonId,
            episode: epNum,
            percent: 100,
            status: "skipped",
          } as ProgressData);
        }
      } else if (line.includes("FAILED") || line.includes("X".repeat(10))) {
        const failMatch = line.match(/Ep\.(\d+)/);
        if (failMatch) {
          win.webContents.send("download-progress", {
            cartoonId,
            episode: parseInt(failMatch[1]),
            percent: 0,
            status: "failed",
          } as ProgressData);
        }
      } else if (
        line.includes("[INFO]") ||
        line.includes("[COMPLETE]") ||
        line.includes("[DOWNLOADING]") ||
        line.includes("[ERROR]") ||
        line.includes("[WARNING]")
      ) {
        win.webContents.send("download-log", line);
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) win.webContents.send("download-log", `[ERROR] ${text}`);
  });

  proc.on("close", (code: number | null) => {
    activeDownloadProcess = null;
    win.webContents.send("download-complete", { code: code ?? 1 });

    // Remove the completed item and process the next one
    downloadQueue.shift();
    processQueue();
  });

  proc.on("error", (err: Error) => {
    activeDownloadProcess = null;
    win.webContents.send("download-error", err.message);

    downloadQueue.shift();
    processQueue();
  });
}

// ─── Electron App ───────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Anime Downloader",
    backgroundColor: "#f5f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(
    path.join(__dirname, "..", "..", "renderer", "index.html"),
  );

  // Uncomment for dev tools:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ─── IPC Handlers ───────────────────────────────────────────────────────────

ipcMain.handle("search", async (_event, query: string) => {
  try {
    return { success: true, data: await searchAnime(query) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-detail", async (_event, url: string) => {
  try {
    return { success: true, data: await getAnimeDetail(url) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("select-folder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Select Download Location",
    buttonLabel: "Choose Folder",
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("start-download", async (_event, options: DownloadOptions) => {
  if (!mainWindow) return { success: false, error: "No window" };
  try {
    startDownload(mainWindow, options);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("cancel-download", async () => {
  // Clear the queue so we don't start the next one
  downloadQueue.length = 0;

  if (activeDownloadProcess) {
    activeDownloadProcess.kill("SIGTERM");
    activeDownloadProcess = null;
    return { success: true };
  }
  return { success: false, error: "No active download" };
});

ipcMain.handle("check-deps", async () => {
  const results = { python: false, ffmpeg: false };
  try {
    const pyCmd =
      process.platform === "win32" ? "python --version" : "python3 --version";
    execSync(pyCmd, { stdio: "pipe" });
    results.python = true;
  } catch {
    /* not installed */
  }
  try {
    execSync("ffmpeg -version", { stdio: "pipe" });
    results.ffmpeg = true;
  } catch {
    /* not installed */
  }
  return results;
});
