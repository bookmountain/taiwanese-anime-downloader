import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class DownloadEpisodesEncodingTest(unittest.TestCase):
    def test_progress_output_supports_unicode_when_stdout_is_cp1252(self):
        script = textwrap.dedent(
            """
            import sys
            from pathlib import Path

            sys.path.insert(0, str(Path.cwd() / "scripts"))
            from download_episodes import ProgressBar

            progress = ProgressBar("001 幫媽媽買東西哦、媽媽的清晨很忙碌哦")
            progress.duration = 100
            progress.is_tty = False
            progress.last_update = -1
            progress.update(size=1024, current_time=50)
            """
        )

        env = {
            **os.environ,
            "PYTHONIOENCODING": "cp1252",
        }

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=ROOT,
            env=env,
            capture_output=True,
        )

        stdout = result.stdout.decode("utf-8", errors="replace")
        stderr = result.stderr.decode("utf-8", errors="replace")

        self.assertEqual(result.returncode, 0, stderr)
        self.assertIn("001", stdout)


if __name__ == "__main__":
    unittest.main()
