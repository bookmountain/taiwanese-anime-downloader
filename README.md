# 西瓜卡通下載器

專門給 `tw.xgcartoon.com` 使用的桌面下載器。可以直接搜尋西瓜卡通上的作品、瀏覽季數與集數，選好多集後交給 Python + FFmpeg 下載。

本專案使用 **Electron + TypeScript + Python**，目標是讓 macOS、Windows、Linux 都能用同一套介面下載西瓜卡通影片。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Electron](https://img.shields.io/badge/Electron-33-47848f.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)

## 特色

- **西瓜卡通專用搜尋**：直接搜尋繁體中文作品名稱，讀取西瓜卡通搜尋結果。
- **作品詳情解析**：顯示封面、簡介、更新狀態、季數與集數列表。
- **多集下載**：一次選取多集，交給下載佇列處理。
- **季數資料夾**：作品與季數會自動建立資料夾，避免檔案混在一起。
- **下載進度表**：每集獨立顯示進度、狀態、速度與 ETA。
- **跨作品佇列驗證**：E2E 測試會檢查先下載一部作品多集，再切換另一部作品多集時，進度列不會更新錯位。
- **繁中輸入檢查**：E2E 測試會啟動 Electron app，確認搜尋欄可以輸入繁體中文並打到真實西瓜卡通搜尋頁。

## 系統需求

- Node.js 18+
- Python 3.7+
- FFmpeg，且 `ffmpeg` 必須能在終端機的 `PATH` 中執行

Python 套件：

```bash
pip3 install requests beautifulsoup4
```

## 安裝與啟動

```bash
npm install
npm run start
```

如果只是開發時重跑：

```bash
npm run dev
```

### Windows 原生啟動

如果要確認 Windows 中文輸入法與縮放，請在 **PowerShell / CMD / Windows Terminal** 裡用 Windows 版 Node.js 執行，不要在 VS Code Remote WSL 終端機裡啟動。

```powershell
where node
npm install
npm run start
```

在 WSL 裡執行 `npm run start` 會啟動 Linux Electron，畫面經由 WSLg 顯示到 Windows 桌面。這不是原生 Windows app，Windows IME 組字、DPI scaling 與 GPU 初始化行為都可能不同。

如果你的桌面環境回報的工作區尺寸不準，可以指定初始視窗大小：

```powershell
$env:ANIME_DOWNLOADER_WINDOW_SIZE="1200x800"
npm run start
```

## 使用方式

1. 在搜尋欄輸入作品名稱，例如 `蠟筆小新`、`海賊王`、`名偵探柯南`。
2. 點選搜尋結果進入作品詳情。
3. 切換季數，選擇要下載的集數。
4. 點擊「選擇下載位置」。
5. 點擊「開始下載」，到下載進度頁查看每集狀態。

下載資料夾會以「作品名稱 / 季數」分層建立。

## E2E 測試

這個專案的 E2E 測試不是純 mock。它會真的啟動 Electron app，真的打 `tw.xgcartoon.com` 搜尋與詳情頁，確保西瓜卡通 API / HTML 結構仍可被 app 解析。

```bash
npm run test:e2e
```

測試涵蓋：

- 繁體中文搜尋輸入。
- 真站搜尋結果與作品詳情載入。
- 搜尋欄不放在 Electron draggable region，避免攔截 Windows IME 組字。
- 預設停用 GPU 硬體加速，降低 Chromium GPU process 初始化失敗對輸入與渲染的影響。
- Windows 高縮放等效的小視窗不會產生水平溢位。
- WSLg runtime 不信任縮放後工作區尺寸，避免初始視窗被縮得過小。
- 切換季數後，前一季選取的集數不會套到新季數。
- 第一部作品選多集下載後，切換第二部作品再次選多集下載，下載進度表不會把不同作品的集數更新錯位。

為了讓測試穩定、快速且不產生大型影片檔，E2E 只把「搜尋 / 詳情」打到真站；下載階段會由測試模式送出假進度事件，驗證 UI 佇列與進度列邏輯。

需要看 Electron 視窗互動時：

```bash
npm run test:e2e:headed
```

## 專案結構

```text
anime-downloader/
├── package.json
├── playwright.config.ts
├── scripts/
│   └── download_episodes.py
├── src/
│   ├── main.ts
│   └── preload.ts
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── src/
│       ├── app.ts
│       └── types.d.ts
└── tests/
    └── e2e/
        └── xgcartoon.spec.ts
```

## 常見問題

**Windows 搜尋欄不能輸入中文**

請先確認你是在 Windows 原生終端機啟動，而不是在 WSL 裡啟動。VS Code 標題列若顯示 `WSL: Ubuntu`，代表目前跑的是 Linux Electron over WSLg，不能拿來判斷原生 Windows 中文輸入法。

接著確認系統已安裝中文輸入法，並執行 `npm run test:e2e`。測試會檢查 Electron 搜尋欄是否能接受繁體中文、搜尋欄沒有被 Electron draggable region 包住，且預設停用 GPU 硬體加速。

如果終端機出現 `Exiting GPU process due to errors during initialization`，通常是 Chromium/Electron GPU process 在顯卡驅動、遠端桌面、VM 或 WSLg 環境初始化失敗。此專案預設呼叫 `app.disableHardwareAcceleration()`，且 `npm run start` 會帶上 `--disable-gpu --disable-gpu-compositing` 來避開這類問題。

**Windows / WSL 畫面比例很怪**

原生 Windows 會依主要螢幕工作區自動縮小初始視窗，避免高縮放或小螢幕一開就超出畫面。WSLg 回報的工作區尺寸常常已經被二次縮放，本專案會在 WSL runtime 固定使用 `1200x800` 初始視窗，避免被縮得過小。

需要手動指定時：

```bash
ANIME_DOWNLOADER_WINDOW_SIZE=1200x800 npm run start
```

**測試突然失敗**

本專案會打真實西瓜卡通頁面。若西瓜卡通改版、封鎖、網路不穩或查詢結果改變，E2E 會失敗，這通常表示 scraper 或等待條件需要更新。

**下載失敗**

先確認：

- `python3 --version` 或 Windows 的 `python --version` 可執行。
- `ffmpeg -version` 可執行。
- 下載位置有寫入權限。
- 西瓜卡通該集數仍可播放。

## 注意事項

請只下載你有權觀看、保存或備份的內容。本專案只提供技術工具，使用者需自行遵守所在地法律與網站規範。

## 授權

MIT
