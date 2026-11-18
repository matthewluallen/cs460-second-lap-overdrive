"""Local teaching simulator. No BLE, sockets, subprocesses or external storage.

Security model (see SECURITY.md):
* The token alone decides which team is acting. A caller-supplied team is only a
  consistency check and can never widen access.
* A nonce names one logical action. Redelivery returns the first result without
  applying the effect again; reusing a nonce for a different action is refused.
* Profiles need a publisher HMAC made with a key the uploader does not hold.
  Without a configured key, profile installation is disabled.
* Event and nonce stores are bounded.
"""
import hashlib
import hmac
import json

ABSOLUTE_SIMULATION_LIMIT = 500
MAX_EVENTS = 10_000
MAX_NONCES = 10_000
MIN_PUBLISHER_KEY_BYTES = 32
TEAMS = ("red", "blue", "green", "gold")
# Public demonstration tokens for disposable local state only. They are not
# secrets; pass tokens= (or LAPRETURN_TOKENS for the shell) for anything shared.
DEMO_TOKENS = {f"pilot-{team}": team for team in TEAMS}


def _canonical(profile):
    return json.dumps(profile, sort_keys=True, separators=(",", ":")).encode()


def digest_profile(profile):
    """Integrity only: anyone can compute this. It is not proof of origin."""
    return hashlib.sha256(_canonical(profile)).hexdigest()


def _key_bytes(key):
    if isinstance(key, str):
        key = key.encode()
    if not isinstance(key, (bytes, bytearray)) or len(key) < MIN_PUBLISHER_KEY_BYTES:
        raise ValueError(f"Publisher key must be at least {MIN_PUBLISHER_KEY_BYTES} bytes")
    return bytes(key)


def sign_profile(profile, publisher_key):
    """Publisher-side helper: HMAC-SHA256 over the canonical profile."""
    return hmac.new(_key_bytes(publisher_key), _canonical(profile), hashlib.sha256).hexdigest()


def _validated_tokens(tokens):
    if not isinstance(tokens, dict) or not tokens:
        raise ValueError("Tokens must be a non-empty mapping of token to team")
    for token, team in tokens.items():
        if not isinstance(token, str) or not token or len(token) > 200:
            raise ValueError("Each token must be a non-empty string of at most 200 characters")
        if team not in TEAMS:
            raise ValueError("Each token must map to a known team")
    return dict(tokens)


class Pilot:
    def __init__(self, tokens=None, publisher_key=None):
        self.tokens = _validated_tokens(DEMO_TOKENS if tokens is None else tokens)
        self._publisher_key = None if publisher_key is None else _key_bytes(publisher_key)
        self.vehicles = {
            f"sim-{team}": {"team": team, "speed": 0, "distance": 0, "max_speed": 120}
            for team in TEAMS
        }
        self.events = []
        # (team, nonce) -> (request fingerprint, first result). Insertion ordered.
        self.seen = {}

    def authenticate(self, token):
        if not isinstance(token, str) or token not in self.tokens:
            raise PermissionError("Unknown pilot token")
        return self.tokens[token]

    def authorize(self, token, team, vehicle):
        """Return the authenticated team, or refuse. The token is the authority."""
        authenticated_team = self.authenticate(token)
        denied = PermissionError("Vehicle is not available to this pilot")
        # One message for unknown and other-team vehicles: no existence oracle.
        if not isinstance(vehicle, str) or vehicle not in self.vehicles:
            raise denied
        if self.vehicles[vehicle]["team"] != authenticated_team:
            raise denied
        if team != authenticated_team:
            raise PermissionError("Requested team does not match the authenticated pilot")
        return authenticated_team

    def command(self, token, team, vehicle, action, value=0, nonce=""):
        authenticated_team = self.authorize(token, team, vehicle)
        if not isinstance(nonce, str) or not nonce or len(nonce) > 100:
            raise ValueError("A bounded nonce string is required")
        if type(value) is not int:
            raise ValueError("Use integer simulation units")
        if not isinstance(action, str):
            raise ValueError("Unknown action")
        key = (authenticated_team, nonce)
        fingerprint = (vehicle, action, value)
        # STOP is naturally idempotent and is never suppressed by replay handling.
        if key in self.seen and action != "stop":
            # Transport retries reuse the original nonce: answer without a second effect.
            first_fingerprint, first_result = self.seen[key]
            if first_fingerprint != fingerprint:
                raise ValueError("Nonce was already used for a different request")
            return dict(first_result)
        car = self.vehicles[vehicle]
        if action == "drive":
            if not 0 <= value <= min(car["max_speed"], ABSOLUTE_SIMULATION_LIMIT):
                raise ValueError("Speed outside simulation envelope")
            car["speed"] = value
        elif action == "advance":
            if not 0 <= value <= 10:
                raise ValueError("Distance outside simulation envelope")
            car["distance"] += value
        elif action == "stop":
            car["speed"] = 0
        else:
            raise ValueError("Unknown action")
        result = dict(car)
        self.seen[key] = (fingerprint, result)
        if len(self.seen) > MAX_NONCES:
            # Bounded replay window: forget the oldest nonce, never refuse STOP.
            del self.seen[next(iter(self.seen))]
        self.events.append({"team": car["team"], "vehicle": vehicle, "action": action,
                            "value": value, "nonce": nonce})
        if len(self.events) > MAX_EVENTS:
            del self.events[0]
        return dict(result)

    def telemetry(self, token):
        team = self.authenticate(token)
        return [dict(e) for e in self.events if e["team"] == team]

    def status(self, token):
        team = self.authenticate(token)
        return {k: dict(v) for k, v in self.vehicles.items() if v["team"] == team}

    def install_profile(self, token, team, vehicle, profile, sha256, signature=None):
        self.authorize(token, team, vehicle)
        if self._publisher_key is None:
            raise PermissionError("Profile installation is disabled: no publisher key is configured")
        if not isinstance(profile, dict) or set(profile) != {"max_speed"}:
            raise ValueError("Only max_speed profiles are supported")
        if not isinstance(sha256, str) or not hmac.compare_digest(
                digest_profile(profile).encode(), sha256.encode()):
            raise ValueError("Profile checksum does not match")
        expected = hmac.new(self._publisher_key, _canonical(profile), hashlib.sha256).hexdigest()
        if not isinstance(signature, str) or not hmac.compare_digest(
                expected.encode(), signature.encode()):
            raise PermissionError("Profile is not signed by the configured publisher")
        limit = profile["max_speed"]
        if type(limit) is not int or not 0 <= limit <= ABSOLUTE_SIMULATION_LIMIT:
            raise ValueError("Profile outside absolute simulation envelope")
        self.vehicles[vehicle]["max_speed"] = limit
        self.vehicles[vehicle]["speed"] = min(self.vehicles[vehicle]["speed"], limit)
        return {"installed": True, "max_speed": limit}
