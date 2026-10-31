"""Runnable lesson checks; expected flawed behavior is NOT a security pass."""
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

    def test_cli_default_runs_three_labelled_deliberate_baselines(self):
        result = self.cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        reports = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([r["case"] for r in reports], ["authorization", "repeat", "profile"])
        for report in reports:
            self.assertEqual(report["source"], "SIMULATION / fixed synthetic inputs")
            self.assertTrue(report["deliberate_flawed_baseline_observed"])
            self.assertFalse(report["security_pass"])
            self.assertEqual(report["absolute_simulation_limit"], 500)

    def test_cli_per_case_runs_only_the_selected_lesson(self):
        for case in ("authorization", "repeat", "profile"):
            with self.subTest(case=case):
                result = self.cli(case)
                self.assertEqual(result.returncode, 0, result.stderr)
                lines = result.stdout.splitlines()
                self.assertEqual(len(lines), 1)
                self.assertEqual(json.loads(lines[0])["case"], case)

    def test_cli_rejects_unknown_case_without_running_lessons(self):
        result = self.cli("hardware")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("invalid choice", result.stderr)

    def test_cli_runs_are_deterministic_and_do_not_share_state(self):
        first, second = self.cli("all"), self.cli("all")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(first.stdout, second.stdout)

    def test_lessons_call_actual_methods_on_fresh_pilots(self):
        pilots = []

        def fresh():
            pilot = Pilot()
            pilots.append(pilot)
            return pilot

        with patch("lapreturn.cwe_lab.Pilot", side_effect=fresh):
            reports = [lesson() for lesson in cwe_lab.LESSONS.values()]
        self.assertEqual(len(pilots), 3)
        self.assertEqual(pilots[0].vehicles["sim-blue"]["speed"], 40)
        self.assertEqual(pilots[0].vehicles["sim-red"]["distance"], 0)
        self.assertEqual(pilots[1].vehicles["sim-red"]["distance"], 6)
        self.assertEqual(pilots[1].vehicles["sim-blue"]["speed"], 0)
        self.assertEqual(pilots[2].vehicles["sim-red"]["max_speed"], 450)
        self.assertEqual(pilots[2].events, [])
        self.assertTrue(all(report["deliberate_flawed_baseline_observed"] for report in reports))

    def test_repeat_reports_two_effects_despite_one_nonce(self):
        observed = cwe_lab.repeat()["observed"]
        self.assertEqual(observed["distance_after_first"], 3)
        self.assertEqual(observed["distance_after_second"], 6)
        self.assertEqual(observed["event_count"], 2)
        self.assertEqual(observed["unique_nonce_count"], 1)

    def test_profile_distinguishes_integrity_authenticity_and_absolute_limit(self):
        observed = cwe_lab.profile()["observed"]
        self.assertFalse(observed["original_digest_outcome"]["accepted"])
        self.assertIn("checksum", observed["original_digest_outcome"]["error"])
        self.assertTrue(observed["replacement_digest_outcome"]["accepted"])
        self.assertFalse(observed["publisher_proof_supplied"])
        self.assertFalse(observed["above_500_outcome"]["accepted"])
        self.assertEqual(observed["max_speed_before"], 120)
        self.assertEqual(observed["max_speed_after"], 450)

    def test_report_reflects_repaired_policy_instead_of_canned_success(self):
        class OwnTeamOnly(Pilot):
            def authorize(self, token, team, vehicle):
                if self.authenticate(token) != self.vehicles[vehicle]["team"]:
                    raise PermissionError("Cross-team change denied")
                super().authorize(token, team, vehicle)

        with patch("lapreturn.cwe_lab.Pilot", OwnTeamOnly):
            report = cwe_lab.authorization()
        self.assertFalse(report["deliberate_flawed_baseline_observed"])
        self.assertFalse(report["observed"]["outcome"]["accepted"])
        self.assertEqual(report["observed"]["blue_speed_after"], 0)
        self.assertFalse(report["security_pass"], "one denied probe is not a security assessment")


if __name__ == "__main__":
    unittest.main()
