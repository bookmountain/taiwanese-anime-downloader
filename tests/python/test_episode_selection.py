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


if __name__ == "__main__":
    unittest.main()
