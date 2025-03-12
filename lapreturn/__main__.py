import json
import sys
from .core import Pilot

def dispatch(pilot, request):
    request = dict(request)
    operation = request.pop("op")
    methods = {"command": pilot.command, "status": pilot.status, "telemetry": pilot.telemetry}
    if hasattr(pilot, "install_profile"):
        methods["install_profile"] = pilot.install_profile
    if operation not in methods:
        raise ValueError("Unknown operation")
    return methods[operation](**request)

def main():
    pilot = Pilot()
    if len(sys.argv) != 2 or sys.argv[1] not in ("demo", "shell"):
        raise SystemExit("Usage: python -m lapreturn demo|shell")
    if sys.argv[1] == "demo":
        for action, value, nonce in [("drive",80,"d1"),("advance",5,"d2"),("stop",0,"d3")]:
            result = pilot.command("pilot-red", "red", "sim-red", action, value, nonce)
            print(json.dumps({"mode":"simulation", "action":action, "state":result}))
        return
    print("Local simulation only. Enter JSON lines; Ctrl-D or Ctrl-Z then Enter exits.", file=sys.stderr)
    while True:
        line = sys.stdin.readline(65538)
        if not line:
            break
        if len(line) > 65536:
            print(json.dumps({"ok":False,"error":"Line too long; session closed"}))
            break
        try:
            result = dispatch(pilot, json.loads(line))
            print(json.dumps({"ok":True,"result":result}))
        except (KeyError, TypeError, ValueError, PermissionError) as exc:
            print(json.dumps({"ok":False,"error":str(exc)}))

if __name__ == "__main__":
    main()
