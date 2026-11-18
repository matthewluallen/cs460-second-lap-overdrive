"""Fixed-input security regression probes for the local simulator.

Each probe replays the request that used to succeed against the original flawed
baseline and reports whether the weakness is still present. No network,
Bluetooth, files, credentials or physical movement are involved. Each probe
creates a fresh Pilot. A passing probe is one fixed check, not a full assessment.
"""
import argparse
import json

from .core import ABSOLUTE_SIMULATION_LIMIT, Pilot, digest_profile, sign_profile

# Fixed lab-only publisher keys. They exist so the probe can show a correctly
# signed profile being accepted and a wrongly signed one refused.
LAB_PUBLISHER_KEY = "lab-only-publisher-key-not-a-secret-0001"
LAB_ATTACKER_KEY = "lab-only-attacker-key-not-the-publisher1"


def _attempt(operation):
    try:
        return {"accepted": True, "result": operation()}
    except (PermissionError, ValueError) as error:
        return {"accepted": False, "error": str(error)}


def _report(case, cwe, policy, observed, flaw_reproduced):
    return {
        "source": "SIMULATION / fixed synthetic inputs",
        "case": case,
        "cwe": cwe,
        "absolute_simulation_limit": ABSOLUTE_SIMULATION_LIMIT,
        "policy": policy,
        "observed": observed,
        "flaw_reproduced": flaw_reproduced,
        "regression_check_passed": not flaw_reproduced,
        "note": "One fixed probe; passing is not a complete security assessment.",
    }


def authorization():
    pilot = Pilot()
    before = pilot.status("pilot-blue")["sim-blue"]["speed"]
    request = {"token": "pilot-red", "team": "blue", "vehicle": "sim-blue",
               "action": "drive", "value": 40, "nonce": "authorization-1"}
    outcome = _attempt(lambda: pilot.command(**request))
    after = pilot.status("pilot-blue")["sim-blue"]["speed"]
    leaked = [e for e in pilot.telemetry("pilot-red") if e["team"] != "red"]
    return _report(
        "authorization", "CWE-863",
        "A red actor must not change a blue vehicle by claiming the blue team.",
        {"request": request, "outcome": outcome, "blue_speed_before": before,
         "blue_speed_after": after, "other_team_events_visible_to_red": len(leaked)},
        outcome["accepted"] or after != before or bool(leaked),
    )


def repeat():
    pilot = Pilot()
    request = {"token": "pilot-red", "team": "red", "vehicle": "sim-red",
               "action": "advance", "value": 3, "nonce": "one-logical-action"}
    first = _attempt(lambda: pilot.command(**request))
    after_first = pilot.status("pilot-red")["sim-red"]["distance"]
    second = _attempt(lambda: pilot.command(**request))
    after_second = pilot.status("pilot-red")["sim-red"]["distance"]
    changed = _attempt(lambda: pilot.command(**{**request, "value": 9}))
    after_changed = pilot.status("pilot-red")["sim-red"]["distance"]
    return _report(
        "repeat", "CWE-837",
        "Redelivery of one logical action must not apply its distance effect twice.",
        {"request_sent_twice": request, "first_outcome": first,
         "second_outcome": second, "distance_after_first": after_first,
         "distance_after_second": after_second,
         "same_nonce_different_value_outcome": changed,
         "distance_after_changed_request": after_changed,
         "event_count": len(pilot.events), "unique_nonce_count": len(pilot.seen)},
        after_second != after_first or after_changed != after_first or changed["accepted"],
    )


def profile():
    replacement = {"max_speed": 450}
    digest = digest_profile(replacement)
    install = lambda pilot, **extra: _attempt(lambda: pilot.install_profile(
        "pilot-red", "red", "sim-red", replacement, digest, **extra))

    unconfigured = Pilot()
    no_key = install(unconfigured)

    pilot = Pilot(publisher_key=LAB_PUBLISHER_KEY)
    before = pilot.status("pilot-red")["sim-red"]["max_speed"]
    checksum_only = install(pilot)
    forged = install(pilot, signature=sign_profile(replacement, LAB_ATTACKER_KEY))
    after_unsigned = pilot.status("pilot-red")["sim-red"]["max_speed"]
    signed = install(pilot, signature=sign_profile(replacement, LAB_PUBLISHER_KEY))
    after_signed = pilot.status("pilot-red")["sim-red"]["max_speed"]
    outside = {"max_speed": 501}
    limit_check = _attempt(lambda: pilot.install_profile(
        "pilot-red", "red", "sim-red", outside, digest_profile(outside),
        signature=sign_profile(outside, LAB_PUBLISHER_KEY)))
    return _report(
        "profile", "CWE-345",
        "A profile needs proof of a trusted publisher beyond the uploader's own checksum.",
        {"replacement_profile": replacement, "replacement_sha256": digest,
         "no_publisher_key_outcome": no_key, "checksum_only_outcome": checksum_only,
         "wrong_key_signature_outcome": forged, "max_speed_before": before,
         "max_speed_after_unsigned_attempts": after_unsigned,
         "publisher_signed_outcome": signed, "max_speed_after_signed": after_signed,
         "signed_above_500_outcome": limit_check},
        no_key["accepted"] or checksum_only["accepted"] or forged["accepted"]
        or after_unsigned != before or limit_check["accepted"],
    )


LESSONS = {"authorization": authorization, "repeat": repeat, "profile": profile}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", nargs="?", default="all", choices=["all", *LESSONS],
                        help="fixed synthetic probe; defaults to all three")
    args = parser.parse_args(argv)
    names = LESSONS if args.case == "all" else [args.case]
    failed = False
    for name in names:
        report = LESSONS[name]()
        failed = failed or report["flaw_reproduced"]
        print(json.dumps(report, sort_keys=True))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
