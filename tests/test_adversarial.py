"""Local simulator review: operational guardrails and deliberate flawed baseline.

DeliberateScenarioCharacterizationTests preserve the supplied investigation.
Their success is NOT a security pass; student repairs replace those expectations.
No test opens a network connection or addresses physical hardware.
"""
import contextlib
import copy
import io
import itertools
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from lapreturn.__main__ import dispatch, main
from lapreturn.core import ABSOLUTE_SIMULATION_LIMIT, Pilot, digest_profile


TEAMS = ("red", "blue", "green", "gold")
ROOT = Path(__file__).resolve().parents[1]
STATUS = {"op": "status", "token": "pilot-red"}
DRIVE = {"op": "command", "token": "pilot-red", "team": "red",
         "vehicle": "sim-red", "action": "drive", "value": 80, "nonce": "start"}


def snapshot(pilot):
    return copy.deepcopy((pilot.vehicles, pilot.events, pilot.seen))


class ShellGuardrailTests(unittest.TestCase):
    def run_shell(self, lines):
        result = subprocess.run(
            [sys.executable, "-m", "lapreturn", "shell"],
            cwd=ROOT, input="\n".join(lines) + "\n", text=True,
            capture_output=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_dispatch_requires_object_without_coercing_pair_arrays(self):
        pilot = Pilot()
        before = snapshot(pilot)
        for request in (None, True, 7, "status", [], [["op", "status"], ["token", "pilot-red"]]):
            with self.subTest(request=request), self.assertRaisesRegex(ValueError, "JSON object"):
                dispatch(pilot, request)
        self.assertEqual(snapshot(pilot), before)

    def test_dispatch_requires_string_operation_and_preserves_request(self):
        pilot = Pilot()
        for operation in (None, True, 1, [], {}):
            with self.subTest(operation=operation), self.assertRaisesRegex(ValueError, "Operation must be a string"):
                dispatch(pilot, {"op": operation, "token": "pilot-red"})
        request = dict(STATUS)
        self.assertIn("sim-red", dispatch(pilot, request))
        self.assertEqual(request, STATUS)

    def test_shell_malformed_inputs_leave_state_and_next_request_usable(self):
        invalid = [
            "{", "null", "true", "12", "[]",
            '[["op","status"],["token","pilot-red"]]',
            '{}', '{"op":[]}', '{"op":{}}', '{"op":null}',
            '{"op":"__class__"}',
            '{"op":"status","token":[]}',
            '{"op":"status","token":{}}',
            '{"op":"status","token":"pilot-red","unexpected":true}',
            json.dumps({**DRIVE, "vehicle": []}),
            json.dumps({**DRIVE, "vehicle": {}}),
            json.dumps({**DRIVE, "value": True}),
        ]
        lines = [json.dumps(DRIVE)]
        for line in invalid:
            lines.extend([line, json.dumps(STATUS)])
        replies = self.run_shell(lines)
        self.assertEqual(len(replies), 1 + 2 * len(invalid))
        for index in range(1, len(replies), 2):
            self.assertFalse(replies[index]["ok"], invalid[(index - 1) // 2])
            self.assertTrue(replies[index + 1]["ok"])
            self.assertEqual(replies[index + 1]["result"]["sim-red"]["speed"], 80)

    def test_shell_deep_json_is_rejected_and_prior_state_survives(self):
        # Some runtimes reject this in json.loads; others decode it successfully.
        # Both paths must produce one structured error and retain the session.
        nested = "[" * 10_000 + "0" + "]" * 10_000
        self.assertLess(len(nested), 65536)
        replies = self.run_shell([json.dumps(DRIVE), nested, json.dumps(STATUS)])
        self.assertEqual(len(replies), 3)
        self.assertFalse(replies[1]["ok"])
        self.assertIn(replies[1]["error"],
                      ("JSON nesting is too deep", "Each request must be a JSON object"))
        self.assertEqual(replies[2]["result"]["sim-red"]["speed"], 80)

    def test_recursion_error_response_is_bounded_and_next_request_runs(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("sys.argv", ["lapreturn", "shell"]), \
                patch("sys.stdin", io.StringIO("ignored\nignored\n")), \
                patch("lapreturn.__main__.json.loads", side_effect=[RecursionError("untrusted details"), dict(STATUS)]), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            main()
        replies = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(replies[0], {"ok": False, "error": "JSON nesting is too deep"})
        self.assertTrue(replies[1]["ok"])
        self.assertNotIn("untrusted details", stdout.getvalue() + stderr.getvalue())

    def test_oversize_line_closes_without_processing_following_request(self):
        replies = self.run_shell([json.dumps(DRIVE), " " * 65537, json.dumps(STATUS)])
        self.assertEqual(len(replies), 2)
        self.assertEqual(replies[1], {"ok": False, "error": "Line too long; session closed"})

    def test_line_at_existing_limit_is_accepted(self):
        # The existing limit includes the newline read by readline.
        line = json.dumps(STATUS).ljust(65535)
        replies = self.run_shell([line])
        self.assertTrue(replies[0]["ok"])


class DeliberateScenarioCharacterizationTests(unittest.TestCase):
    """Expected vulnerabilities: these passing cases are evidence, not assurance."""

    def test_deliberate_requested_team_bypasses_authenticated_team(self):
        for actor, target in itertools.permutations(TEAMS, 2):
            with self.subTest(actor=actor, target=target):
                pilot = Pilot()
                pilot.command(f"pilot-{actor}", target, f"sim-{target}", "drive", 40, "cross-team")
                self.assertEqual(pilot.status(f"pilot-{target}")[f"sim-{target}"]["speed"], 40)
                self.assertNotIn(f"sim-{target}", pilot.status(f"pilot-{actor}"))

    def test_deliberate_duplicate_nonce_repeats_non_idempotent_advance(self):
        for team in TEAMS:
            with self.subTest(team=team):
                pilot = Pilot()
                for _ in range(2):
                    pilot.command(f"pilot-{team}", team, f"sim-{team}", "advance", 2, "retry")
                self.assertEqual(pilot.vehicles[f"sim-{team}"]["distance"], 4)
                self.assertEqual(len(pilot.events), 2)
                self.assertEqual(len(pilot.seen), 1)

    def test_deliberate_telemetry_exposes_every_teams_events(self):
        pilot = Pilot()
        for team in TEAMS:
            pilot.command(f"pilot-{team}", team, f"sim-{team}", "advance", 1, "event")
        for actor in TEAMS:
            with self.subTest(actor=actor):
                events = pilot.telemetry(f"pilot-{actor}")
                self.assertEqual({event["team"] for event in events}, set(TEAMS))

    def test_deliberate_caller_recomputed_checksum_is_not_publisher_authentication(self):
        # No secret or trusted signature is involved; cross-team profile changes
        # share the same deliberately defective authorization as commands.
        for actor, target in itertools.permutations(TEAMS, 2):
            with self.subTest(actor=actor, target=target):
                pilot = Pilot()
                profile = {"max_speed": 450}
                result = pilot.install_profile(f"pilot-{actor}", target, f"sim-{target}",
                                               profile, digest_profile(profile))
                self.assertEqual(result, {"installed": True, "max_speed": 450})


class SimulatorEnvelopeTests(unittest.TestCase):
    def test_profile_and_command_keep_absolute_500_bound(self):
        self.assertEqual(ABSOLUTE_SIMULATION_LIMIT, 500)
        for team in TEAMS:
            with self.subTest(team=team):
                pilot = Pilot()
                for limit in (0, 120, 500):
                    profile = {"max_speed": limit}
                    pilot.install_profile(f"pilot-{team}", team, f"sim-{team}", profile, digest_profile(profile))
                    pilot.command(f"pilot-{team}", team, f"sim-{team}", "drive", limit, "permitted")
                    before = snapshot(pilot)
                    with self.assertRaises(ValueError):
                        pilot.command(f"pilot-{team}", team, f"sim-{team}", "drive", limit + 1, "denied")
                    self.assertEqual(snapshot(pilot), before)

    def test_invalid_profiles_do_not_change_state(self):
        pilot = Pilot()
        pilot.command("pilot-red", "red", "sim-red", "drive", 80, "start")
        before = snapshot(pilot)
        profiles = [{}, {"max_speed": 120, "extra": True}]
        profiles += [{"max_speed": value} for value in (-1, 501, True, 80.5, None, [], {"nested": 120})]
        for profile in profiles:
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                pilot.install_profile("pilot-red", "red", "sim-red", profile, digest_profile(profile))
            self.assertEqual(snapshot(pilot), before)
        with self.assertRaisesRegex(ValueError, "checksum"):
            pilot.install_profile("pilot-red", "red", "sim-red", {"max_speed": 120}, "incorrect")
        self.assertEqual(snapshot(pilot), before)

    def test_profile_reduction_clamps_speed_and_stop_still_works(self):
        pilot = Pilot()
        pilot.command("pilot-red", "red", "sim-red", "drive", 80, "start")
        profile = {"max_speed": 30}
        pilot.install_profile("pilot-red", "red", "sim-red", profile, digest_profile(profile))
        self.assertEqual(pilot.vehicles["sim-red"]["speed"], 30)
        pilot.command("pilot-red", "red", "sim-red", "stop", 0, "stop")
        self.assertEqual(pilot.vehicles["sim-red"]["speed"], 0)

    def test_invalid_commands_are_atomic(self):
        pilot = Pilot()
        before = snapshot(pilot)
        cases = [("drive", value, "n") for value in (-1, 121, True, 2.5, None, [], {})]
        cases += [("advance", value, "n") for value in (-1, 11, False)]
        cases += [("drive", 10, nonce) for nonce in ("", "x" * 101, None, [])]
        cases += [("unknown", 10, "n")]
        for action, value, nonce in cases:
            with self.subTest(action=action, value=value, nonce=nonce), self.assertRaises(ValueError):
                pilot.command("pilot-red", "red", "sim-red", action, value, nonce)
            self.assertEqual(snapshot(pilot), before)

    def test_process_state_and_returned_copies_are_isolated(self):
        pilot, other = Pilot(), Pilot()
        pilot.command("pilot-red", "red", "sim-red", "drive", 40, "n")
        status = pilot.status("pilot-red")
        status["sim-red"]["speed"] = 500
        events = pilot.telemetry("pilot-red")
        events[0]["team"] = "gold"
        events.clear()
        self.assertEqual(pilot.vehicles["sim-red"]["speed"], 40)
        self.assertEqual(pilot.events[0]["team"], "red")
        self.assertEqual(other.vehicles["sim-red"]["speed"], 0)
        self.assertEqual(other.events, [])


if __name__ == "__main__":
    unittest.main()
