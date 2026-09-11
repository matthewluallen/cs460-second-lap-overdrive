"""Fixed-input security lessons using the deliberately flawed local simulator.

No network, Bluetooth, files, credentials or physical movement are involved.
Each lesson creates a fresh Pilot. Observing the baseline is not a security pass.
"""
import argparse
import json

from .core import ABSOLUTE_SIMULATION_LIMIT, Pilot, digest_profile


def _attempt(operation):
    """Keep policy rejections visible when students later repair their branch."""
    try:
        return {"accepted": True, "result": operation()}
    except (PermissionError, ValueError) as error:
        return {"accepted": False, "error": str(error)}


def _report(case, cwe, policy, observed, baseline_observed):
    return {
        "source": "SIMULATION / fixed synthetic inputs",
        "case": case,
        "cwe": cwe,
        "absolute_simulation_limit": ABSOLUTE_SIMULATION_LIMIT,
        "intended_policy": policy,
        "observed": observed,
        "deliberate_flawed_baseline_observed": baseline_observed,
        "security_pass": False,
    }


def authorization():
    pilot = Pilot()
    before = pilot.status("pilot-blue")["sim-blue"]["speed"]
    request = {"token": "pilot-red", "team": "blue", "vehicle": "sim-blue",
               "action": "drive", "value": 40, "nonce": "authorization-1"}
    outcome = _attempt(lambda: pilot.command(**request))
    after = pilot.status("pilot-blue")["sim-blue"]["speed"]
    return _report(
        "authorization", "CWE-863",
        "A red actor must not change a blue vehicle by claiming the blue team.",
        {"request": request, "outcome": outcome, "blue_speed_before": before,
         "blue_speed_after": after},
        outcome["accepted"] and before == 0 and after == 40,
    )


def repeat():
    pilot = Pilot()
    request = {"token": "pilot-red", "team": "red", "vehicle": "sim-red",
               "action": "advance", "value": 3, "nonce": "one-logical-action"}
    first = _attempt(lambda: pilot.command(**request))
    after_first = pilot.status("pilot-red")["sim-red"]["distance"]
    second = _attempt(lambda: pilot.command(**request))
    after_second = pilot.status("pilot-red")["sim-red"]["distance"]
    return _report(
        "repeat", "CWE-837",
        "Redelivery of one logical action must not apply its distance effect twice.",
        {"request_sent_twice": request, "first_outcome": first,
         "second_outcome": second, "distance_after_first": after_first,
         "distance_after_second": after_second, "event_count": len(pilot.events),
         "unique_nonce_count": len(pilot.seen)},
        first["accepted"] and second["accepted"] and after_first == 3 and after_second == 6,
    )


def profile():
    pilot = Pilot()
    before = pilot.status("pilot-red")["sim-red"]["max_speed"]
    original_digest = digest_profile({"max_speed": 120})
    replacement = {"max_speed": 450}
    replacement_digest = digest_profile(replacement)
    unchanged_digest = _attempt(lambda: pilot.install_profile(
        "pilot-red", "red", "sim-red", replacement, original_digest))
    replaced_digest = _attempt(lambda: pilot.install_profile(
        "pilot-red", "red", "sim-red", replacement, replacement_digest))
    outside_envelope = {"max_speed": 501}
    limit_check = _attempt(lambda: pilot.install_profile(
        "pilot-red", "red", "sim-red", outside_envelope, digest_profile(outside_envelope)))
    after = pilot.status("pilot-red")["sim-red"]["max_speed"]
    return _report(
        "profile", "CWE-345 (educational concept; broad mapping discouraged)",
        "A claim of publisher-authenticated profiles needs a trusted origin beyond the uploader's own checksum.",
        {"replacement_profile": replacement, "replacement_sha256": replacement_digest,
         "publisher_proof_supplied": False, "original_digest_outcome": unchanged_digest,
         "replacement_digest_outcome": replaced_digest, "max_speed_before": before,
         "max_speed_after": after, "above_500_outcome": limit_check},
        not unchanged_digest["accepted"] and replaced_digest["accepted"] and after == 450
        and not limit_check["accepted"],
    )


LESSONS = {"authorization": authorization, "repeat": repeat, "profile": profile}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", nargs="?", default="all", choices=["all", *LESSONS],
                        help="fixed synthetic lesson; defaults to all three")
    args = parser.parse_args(argv)
    names = LESSONS if args.case == "all" else [args.case]
    for name in names:
        print(json.dumps(LESSONS[name](), sort_keys=True))


if __name__ == "__main__":
    main()
