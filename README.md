# 🍉 Anime Downloader

A cross-platform desktop application for searching, browsing, and downloading anime episodes.

Built with **Electron** + **TypeScript** + **Python** — runs on macOS, Windows, and Linux.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **Search**: Search anime by name (Traditional Chinese results).
- **Browse**: View anime details, seasons, and episode lists.
- **Smart Downloads**: Automatically creates subfolders named after the anime title.
- **Fast Streaming**: Uses Python to parse `m3u8` playlists and download directly with `ffmpeg`.
- **Progress Tracking**: Real-time progress bars showing download percentage, speed, and ETA.
- **Resume Capability**: Detects existing completed files and skips them automatically.
- **Light Theme**: Clean, modern light theme interface.

## Prerequisites

Make sure the following are installed on your system:

- **Node.js** (18+)
- **Python 3.7+**
- **FFmpeg** (Must be accessible in your system `PATH`)

Install the required Python packages:

```bash
pip3 install requests beautifulsoup4
```

## Getting Started

1. Clone or navigate to the project directory:

   ```bash
   cd anime-downloader
   ```

2. Install Node dependencies:

   ```bash
   npm install
   ```

3. Build and launch the app:
   ```bash
   npm run start
   ```

## Usage

1. **Search** — Type an anime name in the search bar and press Enter.
2. **Browse** — Click a result card to view details and available seasons.
3. **Select Episodes** — Check the boxes next to the episodes you want to download.
4. **Choose Folder** — Click "選擇下載位置" to pick a base directory. _Note: A subfolder with the anime's title will be created automatically inside this base directory to prevent series from mixing._
5. **Download** — Click the download button (開始下載) to begin.

The app will transition to the progress screen where you can track each download.

## Project Structure

```
anime-downloader/
├── package.json
├── tsconfig.json            # Unified TypeScript configuration
├── scripts/
│   └── download_episodes.py # Python download worker script
├── src/
│   ├── main.ts              # Electron main process (API, download mgmt)
│   └── preload.ts           # Secure IPC bridge
├── renderer/
│   ├── index.html           # App UI
│   ├── styles.css           # Light theme styling
│   └── src/
│       ├── app.ts           # Frontend logic
│       └── types.d.ts       # Type definitions
└── dist/                    # Compiled Output
```

## How It Works

1. The Electron main process scrapes `tw.xgcartoon.com` to provide search results and anime details.
2. When a download is started, the app spawns `scripts/download_episodes.py` as a child process.
3. The Python script fetches the `m3u8` playlist, calculates the total duration, and pipes the stream directly into `ffmpeg` for high-speed segment downloading.
4. Progress output from Python is parsed by the main process and sent back to the frontend UI via secure IPC.

## License

MIT
