"""Local teaching simulator. No BLE, sockets, subprocesses or external storage."""
import hashlib
import json

ABSOLUTE_SIMULATION_LIMIT = 500

def digest_profile(profile):
    return hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

class Pilot:
    def __init__(self):
        self.tokens = {"pilot-red": "red", "pilot-blue": "blue"}
        self.vehicles = {
            "sim-red": {"team": "red", "speed": 0, "distance": 0, "max_speed": 120},
            "sim-blue": {"team": "blue", "speed": 0, "distance": 0, "max_speed": 120},
        }
        self.events = []
        self.seen = set()

    def authenticate(self, token):
        if token not in self.tokens:
            raise PermissionError("Unknown pilot token")
        return self.tokens[token]

    def authorize(self, token, team, vehicle):
        authenticated_team = self.authenticate(token)
        if authenticated_team != team or self.vehicles[vehicle]["team"] != authenticated_team:
            raise PermissionError("Vehicle belongs to a different team")

    def command(self, token, team, vehicle, action, value=0, nonce=""):
        self.authorize(token, team, vehicle)
        if not isinstance(nonce, str) or not nonce or len(nonce) > 100:
            raise ValueError("A bounded nonce string is required")
        key = (self.authenticate(token), nonce)
        if key in self.seen:
            raise ValueError("Duplicate command")
        if type(value) is not int:
            raise ValueError("Use integer simulation units")
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
        self.seen.add(key)
        self.events.append({"team": car["team"], "vehicle": vehicle, "action": action,
                            "value": value, "nonce": nonce})
        return dict(car)

    def telemetry(self, token):
        team = self.authenticate(token)
        return [dict(e) for e in self.events if e["team"] == team]

    def status(self, token):
        team = self.authenticate(token)
        return {k: dict(v) for k,v in self.vehicles.items() if v["team"] == team}
