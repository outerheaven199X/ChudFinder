"""The retired helper must never accept cookie-authenticated lookup."""
import subprocess
import sys
import unittest
class RetiredLookup(unittest.TestCase):
    def test_retired(self):
        result = subprocess.run([sys.executable, 'bot/lookup.py', 'NASA'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('unavailable', result.stdout)
        self.assertIn('approved server-side API credential', result.stdout)
if __name__ == '__main__':
    unittest.main()
