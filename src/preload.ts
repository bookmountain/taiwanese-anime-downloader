import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

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

interface DownloadOptions {
  cartoonId: string;
  episodes: Array<{ number: number; title: string; href: string }>;
  outputDir: string;
  detailUrl: string;
}

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

contextBridge.exposeInMainWorld("api", {
  search: (query: string): Promise<ApiResult<any[]>> =>
    ipcRenderer.invoke("search", query),

  getDetail: (url: string): Promise<ApiResult<any>> =>
    ipcRenderer.invoke("get-detail", url),

  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("select-folder"),

  startDownload: (options: DownloadOptions): Promise<ApiResult<void>> =>
    ipcRenderer.invoke("start-download", options),

  cancelDownload: (): Promise<ApiResult<void>> =>
    ipcRenderer.invoke("cancel-download"),

  checkDeps: (): Promise<{ python: boolean; ffmpeg: boolean }> =>
    ipcRenderer.invoke("check-deps"),

  onDownloadProgress: (callback: (data: ProgressData) => void): void => {
    ipcRenderer.on(
      "download-progress",
      (_event: IpcRendererEvent, data: ProgressData) => callback(data),
    );
  },

  onDownloadLog: (callback: (msg: string) => void): void => {
    ipcRenderer.on("download-log", (_event: IpcRendererEvent, data: string) =>
      callback(data),
    );
  },

  onDownloadComplete: (callback: (data: { code: number }) => void): void => {
    ipcRenderer.on(
      "download-complete",
      (_event: IpcRendererEvent, data: { code: number }) => callback(data),
    );
  },

  onDownloadError: (callback: (msg: string) => void): void => {
    ipcRenderer.on("download-error", (_event: IpcRendererEvent, data: string) =>
      callback(data),
    );
  },

  removeAllListeners: (): void => {
    ipcRenderer.removeAllListeners("download-progress");
    ipcRenderer.removeAllListeners("download-log");
    ipcRenderer.removeAllListeners("download-complete");
    ipcRenderer.removeAllListeners("download-error");
  },
});
