// Type declarations for the Electron preload API bridge

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

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
  seasonName: string;
}

interface ProgressData {
  cartoonId?: string;
  episode: number;
  percent: number;
  downloaded?: string;
  total?: string;
  speed?: string;
  eta?: string;
  status?: "done" | "failed" | "skipped" | "downloading";
  filename?: string;
}

interface DepStatus {
  python: boolean;
  ffmpeg: boolean;
}

interface ElectronApi {
  search: (query: string) => Promise<ApiResult<SearchResult[]>>;
  getDetail: (url: string) => Promise<ApiResult<AnimeDetail>>;
  selectFolder: () => Promise<string | null>;
  startDownload: (options: DownloadOptions) => Promise<ApiResult<void>>;
  cancelDownload: () => Promise<ApiResult<void>>;
  checkDeps: () => Promise<DepStatus>;
  onDownloadProgress: (cb: (data: ProgressData) => void) => void;
  onDownloadLog: (cb: (msg: string) => void) => void;
  onDownloadComplete: (cb: (data: { code: number }) => void) => void;
  onDownloadError: (cb: (msg: string) => void) => void;
  removeAllListeners: () => void;
}

interface Window {
  api: ElectronApi;
}
