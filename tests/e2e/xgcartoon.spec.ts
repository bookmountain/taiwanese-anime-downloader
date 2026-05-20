import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const SEARCH_TIMEOUT = 45_000;

async function launchApp(
  testInfo: { outputPath: (segment: string) => string },
  options: { env?: Record<string, string> } = {},
) {
  const downloadDir = testInfo.outputPath("downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WSL_DISTRO_NAME;
  delete env.WSL_INTEROP;
  delete env.WSLENV;
  delete env.WSL2_GUI_APPS_ENABLED;

  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...env,
      ...options.env,
      E2E_FAKE_DOWNLOAD: "1",
      E2E_DOWNLOAD_DIR: downloadDir,
    },
  });

  const page = await app.firstWindow();
  page.setDefaultTimeout(SEARCH_TIMEOUT);
  await page.locator("#search-input").waitFor();
  return { app, page, downloadDir };
}

async function appWindowBounds(app: ElectronApplication, page: Page) {
  const browserWindow = await app.browserWindow(page);
  return browserWindow.evaluate((win) => win.getBounds());
}

async function hasCommandLineSwitch(app: ElectronApplication, name: string) {
  return app.evaluate(
    ({ app: electronApp }, switchName) =>
      electronApp.commandLine.hasSwitch(switchName),
    name,
  );
}

async function resizeAppWindow(app: ElectronApplication, page: Page, width: number, height: number) {
  const browserWindow = await app.browserWindow(page);
  await browserWindow.evaluate(
    (win, size) => win.setBounds({ x: 0, y: 0, width: size.width, height: size.height }),
    { width, height },
  );
  await page.waitForTimeout(100);
}

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const navbar = document.querySelector("#navbar");
    const content = document.querySelector("#content");

    return {
      viewportWidth: doc.clientWidth,
      viewportHeight: doc.clientHeight,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      navbarWidth: navbar?.scrollWidth ?? 0,
      contentWidth: content?.scrollWidth ?? 0,
    };
  });
}

async function appRegionsForSearchInput(page: Page) {
  return page.locator("#search-input").evaluate((input) => {
    const regions: Array<{ id: string; tagName: string; appRegion: string }> = [];
    let current: Element | null = input;

    while (current) {
      const styles = window.getComputedStyle(current);
      const appRegion =
        styles.getPropertyValue("-webkit-app-region") ||
        styles.getPropertyValue("app-region");
      regions.push({
        id: current.id,
        tagName: current.tagName.toLowerCase(),
        appRegion,
      });
      current = current.parentElement;
    }

    return regions;
  });
}

async function search(page: Page, query: string) {
  await page.locator("#search-input").fill(query);
  await expect(page.locator("#search-input")).toHaveValue(query);
  await page.locator("#btn-search").click();
  await expect(page.locator("#search-loading")).toBeHidden({ timeout: SEARCH_TIMEOUT });
  await expect(page.locator("#search-error")).toBeHidden();
  await expect(page.locator(".result-card").first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
}

async function openFirstResult(page: Page) {
  await page.locator(".result-card").first().click();
  await expect(page.locator("#detail-loading")).toBeHidden({ timeout: SEARCH_TIMEOUT });
  await expect(page.locator("#view-detail")).toHaveClass(/active/);
  await expect(page.locator("#detail-title")).not.toHaveText("");
  await expect(page.locator(".episode-item").first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
}

async function searchAndOpenFirstResult(page: Page, query: string) {
  await search(page, query);
  await openFirstResult(page);
}

async function selectFirstEpisodes(page: Page, count: number) {
  const items = page.locator(".episode-item");
  await expect
    .poll(() => items.count(), { message: `expected at least ${count} episodes` })
    .toBeGreaterThanOrEqual(count);

  const episodeNumbers = await items.evaluateAll((elements, needed) => {
    const uniqueNumbers = new Set<number>();
    for (const element of elements) {
      const value = Number((element as HTMLElement).dataset.num);
      if (Number.isInteger(value) && value > 0) uniqueNumbers.add(value);
    }
    return Array.from(uniqueNumbers)
      .sort((a, b) => a - b)
      .slice(0, needed as number);
  }, count);

  expect(episodeNumbers.length).toBe(count);
  for (const number of episodeNumbers) {
    await page.locator(`.episode-item[data-num="${number}"]`).first().click();
  }
  await expect(page.locator(".episode-item.selected")).toHaveCount(count);
}

async function startSelectedDownload(page: Page) {
  await page.locator("#btn-folder").click();
  await expect(page.locator("#folder-path")).not.toHaveText("未選擇");
  await expect(page.locator("#btn-download")).toBeEnabled();
  await page.locator("#btn-download").click();
  await expect(page.locator("#view-download")).toHaveClass(/active/);
}

test.describe("西瓜卡通真站 E2E", () => {
  let app: ElectronApplication;
  let page: Page;

  test.afterEach(async () => {
    await app?.close();
  });

  test("可以輸入繁體中文並從真站載入搜尋結果與詳情", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo));

    await searchAndOpenFirstResult(page, "蠟筆小新");

    await expect(page.locator("#detail-title")).toContainText(/蠟筆|小新/);
    await expect(page.locator(".episode-item").first()).toHaveAttribute("data-num", /\d+/);
  });

  test("搜尋輸入框不在 Electron draggable region 裡，避免 Windows IME 組字被攔截", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo));

    const regions = await appRegionsForSearchInput(page);
    expect(regions).not.toContainEqual(
      expect.objectContaining({ appRegion: "drag" }),
    );
  });

  test("停用硬體加速，避免 Windows GPU process 初始化失敗影響輸入法", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo));

    await expect.poll(() => hasCommandLineSwitch(app, "disable-gpu")).toBe(true);
    await expect.poll(() => hasCommandLineSwitch(app, "disable-gpu-compositing")).toBe(true);
  });

  test("Windows 高縮放等效的小視窗不會產生水平溢位", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo));
    await resizeAppWindow(app, page, 780, 560);

    const metrics = await layoutMetrics(page);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.navbarWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.contentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    await expect(page.locator("#search-input")).toBeVisible();
    await expect(page.locator("#btn-search")).toBeVisible();
  });

  test("Windows 高縮放等效工作區會縮小初始視窗", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo, {
      env: { E2E_WORK_AREA_SIZE: "1280x720" },
    }));

    const bounds = await appWindowBounds(app, page);
    expect(bounds.width).toBeLessThanOrEqual(1152);
    expect(bounds.height).toBeLessThanOrEqual(648);
  });

  test("WSLg runtime 不信任縮放後工作區尺寸，避免初始視窗過小", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo, {
      env: {
        E2E_WORK_AREA_SIZE: "1280x720",
        WSL_DISTRO_NAME: "Ubuntu",
      },
    }));

    const bounds = await appWindowBounds(app, page);
    expect(bounds.width).toBe(1200);
    expect(bounds.height).toBe(800);
  });

  test("切換季數後不會沿用前一季選取的集數", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo));

    await searchAndOpenFirstResult(page, "蠟筆小新");
    await expect
      .poll(() => page.locator(".season-tab").count(), {
        message: "expected multiple seasons",
      })
      .toBeGreaterThan(1);

    const firstSeasonFirstEpisode = await page.locator(".episode-item").first().textContent();
    await page.locator(".episode-item").first().click();
    await expect(page.locator(".episode-item.selected")).toHaveCount(1);

    await page.locator(".season-tab").nth(1).click();
    await expect(page.locator(".season-tab").nth(1)).toHaveClass(/active/);
    await expect(page.locator(".episode-item").first()).not.toHaveText(firstSeasonFirstEpisode ?? "");
    await expect(page.locator(".episode-item.selected")).toHaveCount(0);
    await expect(page.locator("#btn-download span")).toHaveText("開始下載");
  });

  test("連續下載兩部作品的多集時，下載進度列不會互相更新錯位", async ({}, testInfo) => {
    ({ app, page } = await launchApp(testInfo));

    await searchAndOpenFirstResult(page, "海賊王");
    const firstTitle = (await page.locator("#detail-title").textContent())?.trim() ?? "";
    await selectFirstEpisodes(page, 2);
    await startSelectedDownload(page);

    await expect(page.locator(".dl-ep-item")).toHaveCount(2);
    await expect(page.locator(".dl-ep-item .dl-ep-status")).toHaveText(["完成", "完成"]);
    await expect(page.locator(".dl-ep-title").first()).toContainText(firstTitle);

    await searchAndOpenFirstResult(page, "名偵探柯南");
    const secondTitle = (await page.locator("#detail-title").textContent())?.trim() ?? "";
    expect(secondTitle).not.toBe(firstTitle);
    await selectFirstEpisodes(page, 2);
    await startSelectedDownload(page);

    await expect(page.locator(".dl-ep-item")).toHaveCount(4);
    await expect(page.locator(".dl-ep-item .dl-ep-status")).toHaveText([
      "完成",
      "完成",
      "完成",
      "完成",
    ]);

    const rowTitles = await page.locator(".dl-ep-title").allTextContents();
    expect(rowTitles.slice(0, 2).every((title) => title.includes(firstTitle))).toBe(true);
    expect(rowTitles.slice(2, 4).every((title) => title.includes(secondTitle))).toBe(true);
  });
});
