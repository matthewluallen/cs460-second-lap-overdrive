"""Security regression probes: each must report the original flaw as absent."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from lapreturn import cwe_lab
from lapreturn.core import Pilot


ROOT = Path(__file__).resolve().parents[1]


class CweLabTests(unittest.TestCase):
    def cli(self, *args):
        return subprocess.run([sys.executable, "-m", "lapreturn.cwe_lab", *args],
                              cwd=ROOT, text=True, capture_output=True, timeout=5)

    def test_cli_default_runs_three_passing_probes(self):
        result = self.cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        reports = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([r["case"] for r in reports], ["authorization", "repeat", "profile"])
        for report in reports:
            self.assertEqual(report["source"], "SIMULATION / fixed synthetic inputs")
            self.assertFalse(report["flaw_reproduced"])
            self.assertTrue(report["regression_check_passed"])
            self.assertIn("not a complete security assessment", report["note"])
            self.assertEqual(report["absolute_simulation_limit"], 500)

    def test_cli_per_case_runs_only_the_selected_probe(self):
        for case in ("authorization", "repeat", "profile"):
            with self.subTest(case=case):
                result = self.cli(case)
                self.assertEqual(result.returncode, 0, result.stderr)
                lines = result.stdout.splitlines()
                self.assertEqual(len(lines), 1)
                self.assertEqual(json.loads(lines[0])["case"], case)

    def test_cli_rejects_unknown_case_without_running_probes(self):
        result = self.cli("hardware")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("invalid choice", result.stderr)

    def test_cli_runs_are_deterministic_and_do_not_share_state(self):
        first, second = self.cli("all"), self.cli("all")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, second.stdout)

    def test_authorization_probe_shows_denial_and_no_state_change(self):
        observed = cwe_lab.authorization()["observed"]
        self.assertFalse(observed["outcome"]["accepted"])
        self.assertEqual(observed["blue_speed_after"], 0)
        self.assertEqual(observed["other_team_events_visible_to_red"], 0)

    def test_repeat_probe_shows_one_effect_for_one_nonce(self):
        observed = cwe_lab.repeat()["observed"]
        self.assertEqual(observed["distance_after_first"], 3)
        self.assertEqual(observed["distance_after_second"], 3)
        self.assertEqual(observed["distance_after_changed_request"], 3)
        self.assertFalse(observed["same_nonce_different_value_outcome"]["accepted"])
        self.assertEqual(observed["event_count"], 1)

    def test_profile_probe_distinguishes_checksum_signature_and_limit(self):
        observed = cwe_lab.profile()["observed"]
        self.assertFalse(observed["no_publisher_key_outcome"]["accepted"])
        self.assertFalse(observed["checksum_only_outcome"]["accepted"])
        self.assertFalse(observed["wrong_key_signature_outcome"]["accepted"])
        self.assertEqual(observed["max_speed_after_unsigned_attempts"], 120)
        self.assertTrue(observed["publisher_signed_outcome"]["accepted"])
        self.assertEqual(observed["max_speed_after_signed"], 450)
        self.assertFalse(observed["signed_above_500_outcome"]["accepted"])

    def test_probes_detect_a_reintroduced_flaw_and_cli_fails(self):
        class TrustsClaimedTeam(Pilot):
            def authorize(self, token, team, vehicle):
                self.authenticate(token)
                if self.vehicles[vehicle]["team"] != team:
                    raise PermissionError("Vehicle belongs to a different team")
                return team

        class ReplaysEffects(Pilot):
            def command(self, *args, **kwargs):
                self.seen.clear()
                return super().command(*args, **kwargs)

        with patch("lapreturn.cwe_lab.Pilot", TrustsClaimedTeam):
            report = cwe_lab.authorization()
            self.assertTrue(report["flaw_reproduced"])
            self.assertFalse(report["regression_check_passed"])
            with self.assertRaises(SystemExit):
                with patch("builtins.print"):
                    cwe_lab.main(["authorization"])
        with patch("lapreturn.cwe_lab.Pilot", ReplaysEffects):
            self.assertTrue(cwe_lab.repeat()["flaw_reproduced"])


if __name__ == "__main__":
    unittest.main()
