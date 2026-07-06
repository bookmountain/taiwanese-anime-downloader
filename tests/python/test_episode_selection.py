import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from download_episodes import Episode, VideoDownloader  # noqa: E402


class ExplicitEpisodeSelectionTest(unittest.TestCase):
    """Regression test for the season-mismatch bug.

    Selecting e.g. Season 6 episodes 1-4 used to download Season 1 episodes 1-4,
    because the script re-scraped the whole series (87 episodes, globally
    numbered) and filtered by a per-season number range. The downloader must
    instead honor the exact episodes it is handed.
    """

    def test_explicit_episodes_are_downloaded_verbatim(self):
        with tempfile.TemporaryDirectory() as tmp:
            dl = VideoDownloader(
                base_url="https://tw.xgcartoon.com/video/foo/bar.html",
                output_dir=tmp,
            )

            # Scraping the global list must NOT happen for an explicit selection.
            def fail_scrape():
                raise AssertionError(
                    "get_episode_list should not be called when episodes are given"
                )

            dl.get_episode_list = fail_scrape

            downloaded: list[tuple[int, str]] = []
            dl.download_episode = lambda ep: (
                downloaded.append((ep.number, ep.page_url)) or True
            )

            season6 = [
                Episode(
                    number=1,
                    title="第01話 天然",
                    page_url="https://tw.xgcartoon.com/video/foo/s6e1.html",
                ),
                Episode(
                    number=2,
                    title="第02話 最強之敵",
                    page_url="https://tw.xgcartoon.com/video/foo/s6e2.html",
                ),
            ]

            dl.download_all(episodes=season6)

            self.assertEqual(
                downloaded,
                [
                    (1, "https://tw.xgcartoon.com/video/foo/s6e1.html"),
                    (2, "https://tw.xgcartoon.com/video/foo/s6e2.html"),
                ],
            )


def _make_sparse_file(path: str, size: int) -> None:
    """Create a file that reports `size` bytes without using the disk."""
    with open(path, "wb") as f:
        if size > 0:
            f.seek(size - 1)
            f.write(b"\0")


class SkipLogicTest(unittest.TestCase):
    """Resume/skip must be content-aware, not just match the episode number."""

    def _downloader(self, tmp: str) -> VideoDownloader:
        dl = VideoDownloader(
            base_url="https://tw.xgcartoon.com/video/foo/bar.html",
            output_dir=tmp,
        )
        dl.get_episode_list = lambda: (_ for _ in ()).throw(
            AssertionError("should not scrape")
        )
        return dl

    def test_leftover_file_with_same_number_but_wrong_title_is_not_skipped(self):
        # A stale download from another episode that shares the number (e.g. an
        # old Season 1 file sitting in the Season 6 folder) must not block the
        # correct episode from downloading.
        with tempfile.TemporaryDirectory() as tmp:
            _make_sparse_file(
                str(Path(tmp) / "002_第02話_復仇宣言.mp4"), 151 * 1024 * 1024
            )
            dl = self._downloader(tmp)

            downloaded: list[int] = []
            dl.download_episode = lambda ep: (downloaded.append(ep.number) or True)

            ep = Episode(number=2, title="第02話_最強之敵",
                         page_url="https://tw.xgcartoon.com/video/foo/s6e2.html")
            dl.download_all(episodes=[ep])

            self.assertEqual(downloaded, [2])

    def test_exact_completed_file_is_skipped(self):
        # Genuine resume: the same episode's own completed file should be skipped.
        with tempfile.TemporaryDirectory() as tmp:
            _make_sparse_file(
                str(Path(tmp) / "002_第02話_最強之敵.mp4"), 151 * 1024 * 1024
            )
            dl = self._downloader(tmp)

            downloaded: list[int] = []
            dl.download_episode = lambda ep: (downloaded.append(ep.number) or True)

            ep = Episode(number=2, title="第02話_最強之敵",
                         page_url="https://tw.xgcartoon.com/video/foo/s6e2.html")
            dl.download_all(episodes=[ep])

            self.assertEqual(downloaded, [])


if __name__ == "__main__":
    unittest.main()
