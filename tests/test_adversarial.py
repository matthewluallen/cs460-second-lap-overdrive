"""Local simulator review: operational guardrails and security regressions.

SecurityRegressionTests replay requests that the original flawed baseline
accepted and require the repaired behavior. See SECURITY.md.
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

from lapreturn.__main__ import dispatch, main, pilot_from_environment
from lapreturn.core import ABSOLUTE_SIMULATION_LIMIT, Pilot, digest_profile, sign_profile


TEAMS = ("red", "blue", "green", "gold")
ROOT = Path(__file__).resolve().parents[1]
STATUS = {"op": "status", "token": "pilot-red"}
KEY = "unit-test-publisher-key-0123456789abcdef"
OTHER_KEY = "unit-test-other-key-0123456789abcdef0000"
DRIVE = {"op": "command", "token": "pilot-red", "team": "red",
         "vehicle": "sim-red", "action": "drive", "value": 80, "nonce": "start"}


def signed_install(pilot, token, team, vehicle, profile, key=KEY):
    return pilot.install_profile(token, team, vehicle, profile, digest_profile(profile),
                                 sign_profile(profile, key))


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


class SecurityRegressionTests(unittest.TestCase):
    """Each case replays a request the original flawed baseline accepted."""

    def test_token_team_is_the_authority_for_commands(self):
        for actor, target in itertools.permutations(TEAMS, 2):
            for claimed in (target, actor):
                with self.subTest(actor=actor, target=target, claimed=claimed):
                    pilot = Pilot()
                    before = snapshot(pilot)
                    with self.assertRaises(PermissionError):
                        pilot.command(f"pilot-{actor}", claimed, f"sim-{target}", "drive", 40, "cross-team")
                    self.assertEqual(snapshot(pilot), before)

    def test_claimed_team_must_match_token_even_for_own_vehicle(self):
        pilot = Pilot()
        with self.assertRaisesRegex(PermissionError, "does not match"):
            pilot.command("pilot-red", "blue", "sim-red", "drive", 40, "n")
        self.assertEqual(pilot.vehicles["sim-red"]["speed"], 0)

    def test_unknown_and_other_team_vehicles_are_indistinguishable(self):
        pilot = Pilot()
        messages = set()
        for vehicle in ("sim-blue", "sim-missing", "", None, [], {}):
            with self.subTest(vehicle=vehicle), self.assertRaises(PermissionError) as caught:
                pilot.command("pilot-red", "red", vehicle, "drive", 10, "n")
            messages.add(str(caught.exception))
        self.assertEqual(len(messages), 1)

    def test_duplicate_nonce_is_idempotent_for_identical_request(self):
        for team in TEAMS:
            with self.subTest(team=team):
                pilot = Pilot()
                results = [pilot.command(f"pilot-{team}", team, f"sim-{team}", "advance", 2, "retry")
                           for _ in range(3)]
                self.assertEqual(pilot.vehicles[f"sim-{team}"]["distance"], 2)
                self.assertEqual(results[0], results[1])
                self.assertEqual(results[0], results[2])
                self.assertEqual(len(pilot.events), 1)
                self.assertEqual(len(pilot.seen), 1)

    def test_nonce_reuse_for_a_different_request_is_refused_atomically(self):
        pilot = Pilot()
        pilot.command("pilot-red", "red", "sim-red", "advance", 2, "n")
        before = snapshot(pilot)
        for action, value in (("advance", 3), ("drive", 2)):
            with self.subTest(action=action), self.assertRaisesRegex(ValueError, "different request"):
                pilot.command("pilot-red", "red", "sim-red", action, value, "n")
            self.assertEqual(snapshot(pilot), before)

    def test_nonces_are_scoped_to_the_authenticated_team(self):
        pilot = Pilot()
        pilot.command("pilot-red", "red", "sim-red", "advance", 2, "shared")
        pilot.command("pilot-blue", "blue", "sim-blue", "advance", 5, "shared")
        self.assertEqual(pilot.vehicles["sim-red"]["distance"], 2)
        self.assertEqual(pilot.vehicles["sim-blue"]["distance"], 5)

    def test_stop_is_never_suppressed_by_a_replayed_nonce(self):
        pilot = Pilot()
        pilot.command("pilot-red", "red", "sim-red", "stop", 0, "s")
        pilot.command("pilot-red", "red", "sim-red", "drive", 60, "d")
        pilot.command("pilot-red", "red", "sim-red", "stop", 0, "s")
        self.assertEqual(pilot.vehicles["sim-red"]["speed"], 0)
        pilot.command("pilot-red", "red", "sim-red", "drive", 60, "d2")
        pilot.command("pilot-red", "red", "sim-red", "stop", 0, "d")
        self.assertEqual(pilot.vehicles["sim-red"]["speed"], 0)

    def test_event_and_nonce_stores_are_bounded(self):
        pilot = Pilot()
        with patch("lapreturn.core.MAX_EVENTS", 5), patch("lapreturn.core.MAX_NONCES", 5):
            for index in range(20):
                pilot.command("pilot-red", "red", "sim-red", "advance", 1, f"n{index}")
        self.assertEqual(len(pilot.events), 5)
        self.assertEqual(len(pilot.seen), 5)
        self.assertEqual(pilot.events[-1]["nonce"], "n19")
        self.assertEqual(pilot.vehicles["sim-red"]["distance"], 20)

    def test_telemetry_shows_only_the_callers_team(self):
        pilot = Pilot()
        for team in TEAMS:
            pilot.command(f"pilot-{team}", team, f"sim-{team}", "advance", 1, "event")
        for actor in TEAMS:
            with self.subTest(actor=actor):
                events = pilot.telemetry(f"pilot-{actor}")
                self.assertEqual({event["team"] for event in events}, {actor})
                self.assertEqual(len(events), 1)

    def test_profile_install_is_disabled_without_a_publisher_key(self):
        pilot = Pilot()
        profile = {"max_speed": 450}
        with self.assertRaisesRegex(PermissionError, "no publisher key"):
            pilot.install_profile("pilot-red", "red", "sim-red", profile, digest_profile(profile))
        with self.assertRaisesRegex(PermissionError, "no publisher key"):
            pilot.install_profile("pilot-red", "red", "sim-red", profile, digest_profile(profile),
                                  sign_profile(profile, OTHER_KEY))
        self.assertEqual(pilot.vehicles["sim-red"]["max_speed"], 120)

    def test_caller_checksum_or_wrong_key_is_not_publisher_authentication(self):
        profile = {"max_speed": 450}
        digest = digest_profile(profile)
        forged = [None, "", digest, sign_profile(profile, OTHER_KEY),
                  sign_profile({"max_speed": 449}, KEY), 7, [], {}]
        for signature in forged:
            with self.subTest(signature=signature):
                pilot = Pilot(publisher_key=KEY)
                before = snapshot(pilot)
                with self.assertRaises(PermissionError):
                    pilot.install_profile("pilot-red", "red", "sim-red", profile, digest, signature)
                self.assertEqual(snapshot(pilot), before)

    def test_signed_profile_still_cannot_cross_teams(self):
        profile = {"max_speed": 450}
        for actor, target in itertools.permutations(TEAMS, 2):
            with self.subTest(actor=actor, target=target):
                pilot = Pilot(publisher_key=KEY)
                with self.assertRaises(PermissionError):
                    pilot.install_profile(f"pilot-{actor}", target, f"sim-{target}", profile,
                                          digest_profile(profile), sign_profile(profile, KEY))
                self.assertEqual(pilot.vehicles[f"sim-{target}"]["max_speed"], 120)

    def test_publisher_key_and_token_configuration_are_validated(self):
        for key in ("short", b"x" * 31, 7, [], ""):
            with self.subTest(key=key), self.assertRaises(ValueError):
                Pilot(publisher_key=key)
        for tokens in ({}, [], {"t": "purple"}, {"": "red"}, {7: "red"}, {"x" * 201: "red"}):
            with self.subTest(tokens=tokens), self.assertRaises(ValueError):
                Pilot(tokens=tokens)
        pilot = Pilot(tokens={"s3cret-red": "red"})
        self.assertIn("sim-red", pilot.status("s3cret-red"))
        with self.assertRaises(PermissionError):
            pilot.status("pilot-red")
        for token in (None, [], {}, 7):
            with self.subTest(token=token), self.assertRaises(PermissionError):
                pilot.status(token)

    def test_shell_environment_configures_tokens_and_publisher_key(self):
        pilot = pilot_from_environment({})
        self.assertIn("sim-red", pilot.status("pilot-red"))
        pilot = pilot_from_environment({"LAPRETURN_TOKENS": '{"t-blue":"blue"}',
                                        "LAPRETURN_PUBLISHER_KEY": KEY})
        profile = {"max_speed": 200}
        result = dispatch(pilot, {"op": "install_profile", "token": "t-blue", "team": "blue",
                                  "vehicle": "sim-blue", "profile": profile,
                                  "sha256": digest_profile(profile),
                                  "signature": sign_profile(profile, KEY)})
        self.assertEqual(result, {"installed": True, "max_speed": 200})
        for bad in ("{", "[]", '{"t":"purple"}'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                pilot_from_environment({"LAPRETURN_TOKENS": bad})
        with self.assertRaises(ValueError):
            pilot_from_environment({"LAPRETURN_PUBLISHER_KEY": "short"})


class SimulatorEnvelopeTests(unittest.TestCase):
    def test_profile_and_command_keep_absolute_500_bound(self):
        self.assertEqual(ABSOLUTE_SIMULATION_LIMIT, 500)
        for team in TEAMS:
            with self.subTest(team=team):
                pilot = Pilot(publisher_key=KEY)
                for limit in (0, 120, 500):
                    profile = {"max_speed": limit}
                    signed_install(pilot, f"pilot-{team}", team, f"sim-{team}", profile)
                    pilot.command(f"pilot-{team}", team, f"sim-{team}", "drive", limit, f"permitted-{limit}")
                    before = snapshot(pilot)
                    with self.assertRaises(ValueError):
                        pilot.command(f"pilot-{team}", team, f"sim-{team}", "drive", limit + 1, f"denied-{limit}")
                    self.assertEqual(snapshot(pilot), before)

    def test_invalid_profiles_do_not_change_state(self):
        pilot = Pilot(publisher_key=KEY)
        pilot.command("pilot-red", "red", "sim-red", "drive", 80, "start")
        before = snapshot(pilot)
        profiles = [{}, {"max_speed": 120, "extra": True}]
        profiles += [{"max_speed": value} for value in (-1, 501, True, 80.5, None, [], {"nested": 120})]
        for profile in profiles:
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                signed_install(pilot, "pilot-red", "red", "sim-red", profile)
            self.assertEqual(snapshot(pilot), before)
        with self.assertRaisesRegex(ValueError, "checksum"):
            pilot.install_profile("pilot-red", "red", "sim-red", {"max_speed": 120}, "incorrect",
                                  sign_profile({"max_speed": 120}, KEY))
        self.assertEqual(snapshot(pilot), before)

    def test_profile_reduction_clamps_speed_and_stop_still_works(self):
        pilot = Pilot(publisher_key=KEY)
        pilot.command("pilot-red", "red", "sim-red", "drive", 80, "start")
        profile = {"max_speed": 30}
        signed_install(pilot, "pilot-red", "red", "sim-red", profile)
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
