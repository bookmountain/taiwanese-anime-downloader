import json
import os
import re
import signal
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# Global reference to the file currently being downloaded, for cleanup on SIGTERM
_current_download_path: Optional[str] = None


def _sigterm_handler(signum, frame):
    """Handle SIGTERM by cleaning up the in-progress download file."""
    global _current_download_path
    if _current_download_path and os.path.exists(_current_download_path):
        try:
            os.remove(_current_download_path)
            print(f"\n[SIGTERM] Deleted incomplete file: {_current_download_path}", flush=True)
        except Exception:
            pass
    sys.exit(143)  # 128 + 15 (SIGTERM)


signal.signal(signal.SIGTERM, _sigterm_handler)

class ProgressBar:
    """Single-line console progress bar for downloads."""
    
    def __init__(self, title: str, duration: float = 0):
        self.title = title
        self.duration = duration
        self.start_time = time.time()
        self.last_update = 0
        self.downloaded_bytes = 0
        self.current_time = 0
        self.is_tty = sys.stdout.isatty()
        
        try:
            self.term_width = shutil.get_terminal_size().columns
        except:
            self.term_width = 80
    
    def update(self, size: int = None, current_time: float = None):
        """Update progress bar."""
        now = time.time()
        if now - self.last_update < 0.2:
            return
        self.last_update = now
        
        if size:
            self.downloaded_bytes = size
        if current_time is not None:
            self.current_time = current_time
        
        elapsed = now - self.start_time
        elapsed_str = self._format_time(int(elapsed))
        
        # Progress based on video time (this is accurate)
        progress = min(self.current_time / self.duration, 1.0) if self.duration > 0 else 0
        
        # Calculate total size from progress (since progress % is accurate)
        if progress > 0.01:
            estimated_total = int(self.downloaded_bytes / progress)
            size_str = f"{self._format_size(self.downloaded_bytes)}/{self._format_size(estimated_total)}"
        else:
            size_str = self._format_size(self.downloaded_bytes)
        
        # Speed
        speed_str = f"{self._format_size(self.downloaded_bytes / elapsed)}/s" if elapsed > 0 else "---"
        
        # ETA
        if progress > 0.01:
            eta_str = self._format_time(int((elapsed / progress) - elapsed))
        else:
            eta_str = "--:--"
        
        # Progress bar
        bar_w = 25
        filled = int(bar_w * progress)
        bar = "█" * filled + "░" * (bar_w - filled)
        
        line = f"\r{self.title} [{bar}] {progress*100:5.1f}% | {size_str} | {speed_str:>9} | {elapsed_str} | ETA: {eta_str}"
        if self.is_tty:
            print(line[:self.term_width], end="", flush=True)
        else:
            # When piped (e.g. from Electron), don't truncate and use newlines
            print(line.lstrip('\r'), flush=True)
    
    def finish(self, success: bool = True):
        elapsed = time.time() - self.start_time
        size_str = self._format_size(self.downloaded_bytes)
        time_str = self._format_time(int(elapsed))
        
        if success:
            bar = "█" * 25
            line = f"\r{self.title} [{bar}] 100.0% | {size_str} | Done in {time_str}"
        else:
            line = f"\r{self.title} [{'X' * 25}] FAILED"
        if self.is_tty:
            print(line + " " * 20)
        else:
            print(line.lstrip('\r'))
    
    @staticmethod
    def _format_size(b: float) -> str:
        for u in ['B', 'KB', 'MB', 'GB']:
            if b < 1024:
                return f"{b:.1f}{u}"
            b /= 1024
        return f"{b:.1f}TB"
    
    @staticmethod
    def _format_time(s: int) -> str:
        if s < 0:
            return "--:--"
        return f"{s//3600}:{(s%3600)//60:02d}:{s%60:02d}" if s >= 3600 else f"{s//60:02d}:{s%60:02d}"
    
    @staticmethod
    def parse_ffmpeg_time(t: str) -> float:
        try:
            p = t.split(':')
            if len(p) == 3:
                return int(p[0]) * 3600 + int(p[1]) * 60 + float(p[2])
            return float(t)
        except:
            return 0


@dataclass
class Episode:
    """Represents an episode with its metadata."""
    number: int
    title: str
    page_url: str
    vid: Optional[str] = None
    m3u8_url: Optional[str] = None


class VideoDownloader:
    """Downloads videos from twxgct.com using m3u8 streams."""
    
    M3U8_BASE_URL = "https://xgct-video.bzcdn.net/{vid}/playlist.m3u8"
    METADATA_FILE = ".download_metadata.json"
    
    def __init__(self, base_url: str, output_dir: str = "./downloads", 
                 max_workers: int = 3, retry_count: int = 3):
        self.base_url = base_url
        self.output_dir = output_dir
        self.max_workers = max_workers
        self.retry_count = retry_count
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.twxgct.com/",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        })
        
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        
        # Load metadata
        self.metadata_path = os.path.join(output_dir, self.METADATA_FILE)
        self.metadata = self._load_metadata()
    
    def _load_metadata(self) -> dict:
        """Load download metadata from file."""
        if os.path.exists(self.metadata_path):
            try:
                with open(self.metadata_path, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {"completed": {}}
    
    def _save_metadata(self):
        """Save download metadata to file."""
        try:
            with open(self.metadata_path, 'w') as f:
                json.dump(self.metadata, f, indent=2)
        except:
            pass
    
    def _mark_complete(self, filename: str, file_size: int):
        """Mark a file as successfully downloaded."""
        self.metadata["completed"][filename] = {"size": file_size}
        self._save_metadata()
    
    def _is_complete(self, filename: str, filepath: str) -> bool:
        """Check if a file was previously completed successfully."""
        if not os.path.exists(filepath):
            return False
        
        # Check if we have metadata for this file
        if filename in self.metadata["completed"]:
            expected_size = self.metadata["completed"][filename]["size"]
            actual_size = os.path.getsize(filepath)
            # Allow 1% tolerance for filesystem differences
            return actual_size >= expected_size * 0.99
        
        return False
    
    
    def get_episode_list(self) -> list[Episode]:
        """Fetch and parse the episode list from the main page."""
        print(f"[INFO] Fetching episode list from: {self.base_url}")
        
        try:
            response = self.session.get(self.base_url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            print(f"[ERROR] Failed to fetch episode list: {e}")
            return []
        
        soup = BeautifulSoup(response.text, "html.parser")
        
        # Find episode links in the sidebar
        episode_links = soup.select("#video-volumes-items a.goto-chapter")
        
        if not episode_links:
            # Try alternative selector
            episode_links = soup.select("a[href*='chapter_id=']")
        
        episodes = []
        
        # Extract cartoon_id from the URL for building direct URLs
        parsed_url = urlparse(self.base_url)
        path_parts = parsed_url.path.strip("/").split("/")
        # Path format: /video/{cartoon_id}/{chapter_id}.html
        cartoon_id = path_parts[1] if len(path_parts) > 1 else None
        
        for idx, link in enumerate(episode_links, start=1):
            href = link.get("href", "")
            title = link.get_text(strip=True) or f"Episode {idx:03d}"
            
            # Extract chapter_id from the href
            # Format: /user/page_direct?cartoon_id=xxx&chapter_id=yyy
            chapter_id_match = re.search(r'chapter_id=([a-zA-Z0-9]+)', href)
            
            if chapter_id_match and cartoon_id:
                chapter_id = chapter_id_match.group(1)
                # Build direct video page URL
                page_url = f"https://tw.xgcartoon.com/video/{cartoon_id}/{chapter_id}.html"
            elif href.startswith("http"):
                page_url = href
            elif href.startswith("/"):
                page_url = urljoin(self.base_url, href)
            else:
                page_url = urljoin(self.base_url, href)
            
            episodes.append(Episode(
                number=idx,
                title=self._sanitize_filename(title),
                page_url=page_url
            ))
        
        print(f"[INFO] Found {len(episodes)} episodes")
        return episodes
    
    def extract_vid(self, episode: Episode) -> Optional[str]:
        """Extract the video ID from an episode page."""
        for attempt in range(self.retry_count):
            try:
                response = self.session.get(episode.page_url, timeout=30)
                response.raise_for_status()
                
                # Look for vid in iframe src
                # Pattern: player.htm?vid=086141b4-b1dc-426f-8233-cd93d22cf52a
                vid_match = re.search(r'vid=([a-f0-9\-]{36})', response.text, re.IGNORECASE)
                
                if vid_match:
                    episode.vid = vid_match.group(1)
                    episode.m3u8_url = self.M3U8_BASE_URL.format(vid=episode.vid)
                    return episode.vid
                
                # Try alternative patterns
                vid_match = re.search(r'"vid"\s*:\s*"([a-f0-9\-]{36})"', response.text, re.IGNORECASE)
                if vid_match:
                    episode.vid = vid_match.group(1)
                    episode.m3u8_url = self.M3U8_BASE_URL.format(vid=episode.vid)
                    return episode.vid
                
                print(f"[WARNING] Could not find vid for episode {episode.number}: {episode.title}")
                return None
                
            except requests.RequestException as e:
                if attempt < self.retry_count - 1:
                    print(f"[WARNING] Retry {attempt + 1}/{self.retry_count} for episode {episode.number}")
                    time.sleep(2 ** attempt)
                else:
                    print(f"[ERROR] Failed to extract vid for episode {episode.number}: {e}")
                    return None
        
        return None
    
    def _get_m3u8_duration(self, m3u8_url: str) -> float:
        """Get total video duration from m3u8 playlist by summing EXTINF values."""
        try:
            response = self.session.get(m3u8_url, timeout=10)
            if not response.ok:
                return 0
            
            content = response.text
            base_url = m3u8_url.rsplit('/', 1)[0]
            
            # If master playlist, follow to variant
            if '#EXT-X-STREAM-INF' in content:
                for line in content.split('\n'):
                    if line.strip() and not line.startswith('#'):
                        variant_url = line.strip()
                        if not variant_url.startswith('http'):
                            variant_url = f"{base_url}/{variant_url}"
                        return self._get_m3u8_duration(variant_url)
            
            # Sum up EXTINF durations
            total_duration = 0
            for line in content.split('\n'):
                if line.startswith('#EXTINF:'):
                    try:
                        duration_str = line.split(':')[1].split(',')[0]
                        total_duration += float(duration_str)
                    except:
                        pass
            
            return total_duration
            
        except Exception:
            return 0
    
    def _estimate_total_size(self, m3u8_url: str) -> int:
        """Estimate total file size by sampling m3u8 segments."""
        try:
            response = self.session.get(m3u8_url, timeout=10)
            if not response.ok:
                return 0
            
            content = response.text
            base_url = m3u8_url.rsplit('/', 1)[0]
            
            # If master playlist, follow to variant
            if '#EXT-X-STREAM-INF' in content:
                for line in content.split('\n'):
                    if line.strip() and not line.startswith('#'):
                        variant_url = line.strip()
                        if not variant_url.startswith('http'):
                            variant_url = f"{base_url}/{variant_url}"
                        return self._estimate_total_size(variant_url)
            
            # Get all segment URLs
            segment_urls = []
            for line in content.split('\n'):
                line = line.strip()
                if line and not line.startswith('#'):
                    if not line.startswith('http'):
                        line = f"{base_url}/{line}"
                    segment_urls.append(line)
            
            if not segment_urls:
                return 0
            
            # Sample segments from beginning, middle, and end for better accuracy
            num_segments = len(segment_urls)
            sample_indices = []
            
            # Get 2 from start, 2 from middle, 2 from end (or fewer if not enough segments)
            if num_segments >= 6:
                sample_indices = [0, 1, num_segments//2, num_segments//2 + 1, num_segments-2, num_segments-1]
            elif num_segments >= 3:
                sample_indices = [0, num_segments//2, num_segments-1]
            else:
                sample_indices = list(range(num_segments))
            
            sample_total = 0
            sample_count = 0
            
            for i in sample_indices:
                try:
                    head = self.session.head(segment_urls[i], timeout=5)
                    if 'content-length' in head.headers:
                        sample_total += int(head.headers['content-length'])
                        sample_count += 1
                except:
                    pass
            
            if sample_count > 0:
                avg_size = sample_total / sample_count
                return int(avg_size * num_segments)
            
            return 0
            
        except Exception:
            return 0
    
    def download_episode(self, episode: Episode) -> bool:
        """Download a single episode using ffmpeg with progress bar."""
        if not episode.m3u8_url:
            if not self.extract_vid(episode):
                return False
        
        # Build output filename
        filename = f"{episode.number:03d}_{episode.title}.mp4"
        output_path = os.path.join(self.output_dir, filename)
        
        # Track current file for SIGTERM cleanup
        global _current_download_path
        _current_download_path = output_path
        
        # Get video duration from m3u8 playlist
        duration = self._get_m3u8_duration(episode.m3u8_url)
        
        # Create progress bar
        progress = ProgressBar(f"Ep.{episode.number:03d}", duration=duration)
        
        # Use ffmpeg to download with progress output
        cmd = [
            "ffmpeg",
            "-i", episode.m3u8_url,
            "-c", "copy",
            "-bsf:a", "aac_adtstoasc",
            "-y",  # Overwrite output file
            "-progress", "pipe:1",  # Output progress to stdout
            "-loglevel", "error",
            output_path
        ]
        
        try:
            process = subprocess.Popen(
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            # Parse ffmpeg progress output
            current_size = 0
            current_time = 0
            
            while True:
                line = process.stdout.readline()
                if not line and process.poll() is not None:
                    break
                
                line = line.strip()
                if line.startswith('total_size='):
                    try:
                        current_size = int(line.split('=')[1])
                    except:
                        pass
                elif line.startswith('out_time='):
                    time_val = line.split('=')[1]
                    if time_val and time_val != 'N/A':
                        current_time = ProgressBar.parse_ffmpeg_time(time_val)
                
                # Update progress with both size and time
                if current_size > 0 or current_time > 0:
                    progress.update(size=current_size, current_time=current_time)
            
            # Wait for process to complete
            process.wait()
            
            if process.returncode == 0:
                # Get final file size and mark as complete
                if os.path.exists(output_path):
                    final_size = os.path.getsize(output_path)
                    progress.downloaded_bytes = final_size
                    # Save to metadata for resume detection
                    self._mark_complete(filename, final_size)
                progress.finish(success=True)
                _current_download_path = None
                return True
            else:
                stderr = process.stderr.read()
                progress.finish(success=False)
                print(f"  [ERROR] {stderr[:100]}" if stderr else "  [ERROR] Download failed")
                # Clean up partial file
                if os.path.exists(output_path):
                    os.remove(output_path)
                _current_download_path = None
                return False
                
        except subprocess.TimeoutExpired:
            progress.finish(success=False)
            print(f"  [ERROR] Timeout")
            if os.path.exists(output_path):
                os.remove(output_path)
            _current_download_path = None
            return False
        except FileNotFoundError:
            print("[ERROR] ffmpeg not found. Please install ffmpeg and add it to PATH.")
            sys.exit(1)
    
    def download_all(self, start: int = 1, end: Optional[int] = None, 
                     sequential: bool = False) -> tuple[int, int]:
        """Download all episodes within the specified range."""
        episodes = self.get_episode_list()
        
        if not episodes:
            print("[ERROR] No episodes found!")
            return 0, 0
        
        # Filter by range
        if end is None:
            end = len(episodes)
        
        episodes = [ep for ep in episodes if start <= ep.number <= end]
        print(f"[INFO] Will download {len(episodes)} episodes (#{start} to #{end})")
        
        # Download episodes (video IDs extracted on-demand)
        print("\n[DOWNLOADING]")
        success_count = 0
        fail_count = 0
        skip_count = 0
        
        for idx, ep in enumerate(episodes, 1):
            # Expected filename pattern
            ep_prefix = f"{ep.number:03d}_"
            filename = f"{ep_prefix}{self._sanitize_filename(ep.title)}.mp4"
            output_path = os.path.join(self.output_dir, filename)
            
            # Check if a file with this episode number already exists
            existing_file = None
            for f in os.listdir(self.output_dir):
                if f.startswith(ep_prefix) and f.endswith('.mp4'):
                    existing_file = os.path.join(self.output_dir, f)
                    break
            
            if existing_file and os.path.exists(existing_file):
                file_size = os.path.getsize(existing_file)
                # Skip if file is > 150MB (reasonable video size)
                if file_size > 150 * 1024 * 1024:
                    size_str = ProgressBar._format_size(file_size)
                    print(f"  [{idx}/{len(episodes)}] SKIP {os.path.basename(existing_file)} ({size_str})")
                    skip_count += 1
                    success_count += 1
                    continue
                else:
                    # File too small, likely incomplete - remove it
                    os.remove(existing_file)
            
            # Download
            print(f"  [{idx}/{len(episodes)}] ", end="", flush=True)
            if self.download_episode(ep):
                success_count += 1
            else:
                fail_count += 1
        
        print(f"\n[COMPLETE] Downloaded: {success_count - skip_count}, Skipped: {skip_count}, Failed: {fail_count}")
        return success_count, fail_count
    
    @staticmethod
    def _sanitize_filename(name: str) -> str:
        """Remove or replace characters that aren't safe for filenames."""
        # Remove or replace unsafe characters
        name = re.sub(r'[<>:"/\\|?*]', '', name)
        name = re.sub(r'\s+', '_', name)
        name = name.strip('._')
        return name[:100] if name else "untitled"


def check_ffmpeg():
    """Check if ffmpeg is available."""
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def main():
    if len(sys.argv) < 3:
        print("[ERROR] Usage: download_episodes.py <url> <output_dir> [start] [end]")
        sys.exit(1)
        
    url = sys.argv[1]
    output_dir = sys.argv[2]
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    end = int(sys.argv[4]) if len(sys.argv) > 4 else None
    
    if not check_ffmpeg():
        print("[ERROR] ffmpeg is not installed or not in PATH.")
        sys.exit(1)
    
    downloader = VideoDownloader(base_url=url, output_dir=output_dir)
    downloader.download_all(start=start, end=end)


if __name__ == "__main__":
    main()
