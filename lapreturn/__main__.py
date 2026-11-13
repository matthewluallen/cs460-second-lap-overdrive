import json
import os
import sys
from .core import Pilot


def pilot_from_environment(environ=None):
    """Optional shell configuration. Defaults: demo tokens, profile install disabled."""
    environ = os.environ if environ is None else environ
    tokens = environ.get("LAPRETURN_TOKENS")
    if tokens is not None:
        try:
            tokens = json.loads(tokens)
        except ValueError:
            raise ValueError("LAPRETURN_TOKENS must be a JSON object of token to team") from None
    return Pilot(tokens=tokens, publisher_key=environ.get("LAPRETURN_PUBLISHER_KEY"))

def dispatch(pilot, request):
    if type(request) is not dict:
        raise ValueError("Each request must be a JSON object")
    request = dict(request)
    if "op" not in request:
        raise ValueError('Each request needs an "op" field')
    operation = request.pop("op")
    if type(operation) is not str:
        raise ValueError("Operation must be a string")
    methods = {"command": pilot.command, "status": pilot.status, "telemetry": pilot.telemetry,
               "install_profile": pilot.install_profile}
    if operation not in methods:
        raise ValueError("Unknown operation")
    return methods[operation](**request)

def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("demo", "shell"):
        raise SystemExit("Usage: python -m lapreturn demo|shell")
    if sys.argv[1] == "demo":
        pilot = Pilot()
    else:
        try:
            pilot = pilot_from_environment()
        except ValueError as exc:
            raise SystemExit(str(exc)) from None
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
        except RecursionError:
            # Parser nesting limits vary by Python version. Keep the session alive
            # without reflecting the payload or a traceback into the evidence log.
            print(json.dumps({"ok":False,"error":"JSON nesting is too deep"}))
        except (KeyError, TypeError, ValueError, PermissionError) as exc:
            print(json.dumps({"ok":False,"error":str(exc)}))

if __name__ == "__main__":
    main()
