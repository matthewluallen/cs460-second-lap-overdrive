#!/usr/bin/env python3
"""Derive compact track, vehicle and weapon tables from the original app's own config.

Input: the `basestation/config` directory unpacked from the app's main OBB
(the basestation/config folder inside the app's main OBB file; ANALYSIS.md gives the path).
Output: pieces.json, vehicles.json, weapons.json in the directory given second.

The tables contain derived track measurements plus copied vehicle names, item
identifiers and selected structured gameplay configuration (including targeters,
cooldowns and script parameters). They are not numeric-only. This script does not
bundle executable app binaries, artwork or audio. Its inclusion does not establish
permission to redistribute source-derived data; consult ANALYSIS.md and LICENSE.txt.

    python3 -I tools/extract_config.py <config-dir> data
"""
import json
import math
import re
import sys
from pathlib import Path

KIND = {0: "straight", 1: "curve", 4: "intersection", 5: "jump", 6: "landing"}
NAMED = {33: "finish", 34: "start"}


def load_json(path):
    text = path.read_text(encoding="utf-8-sig")
    return json.loads(re.sub(r"(?m)^\s*//[^\n]*", "", text))


def piece(path):
    lines = [l.split() for l in path.read_text().splitlines() if l.strip()]
    kind_code, piece_id = int(lines[1][0]), int(lines[4][0])
    kind = NAMED.get(piece_id, KIND.get(kind_code, "unknown"))
    # Footprint from the two connector poses (entry faces backwards, exit forwards).
    # Jump and landing pieces have a drivable section shorter than their footprint.
    at = next(i for i in range(13, len(lines) - 2)
              if lines[i] in (["2"], ["4"]) and len(lines[i + 1]) == 3 and len(lines[i + 2]) == 3)
    x0 = float(lines[at + 1][0])
    ex, ey, eth = (float(v) for v in lines[at + 2])
    ex -= x0
    if kind == "intersection":
        x0, ex, ey, eth = 0.0, 0.56, 0.0, 0.0
    locs = {}
    for l in lines:
        if len(l) != 7:
            continue
        try:
            x, y, th = float(l[0]), float(l[1]), float(l[2])
            loc, bit, lane = int(l[3]), int(l[4]), int(l[5])
        except ValueError:
            continue
        if loc < 0:
            continue
        locs.setdefault(loc, []).append((x, y, th, lane))
    table = {}
    for loc, pts in sorted(locs.items()):
        x = sum(p[0] for p in pts) / len(pts)
        y = sum(p[1] for p in pts) / len(pts)
        if kind == "curve":
            radius = abs(ey)
            progress = (sum(p[2] for p in pts) / len(pts)) / (math.pi / 2)
            # Code bits lie along an arc. Its centroid lies inside the arc, so
            # measuring that centroid invents an inward lane displacement.
            # Convert each point to the road frame before averaging offsets.
            lateral = sum(radius - math.hypot(p[0], p[1] - radius) for p in pts) / len(pts)
        else:
            progress = (x - x0) / ex if ex else 0.0
            lateral = y
            if kind == "intersection" and abs(lateral) > 0.1:
                # Codes printed for the crossing road: rotate into that road's frame.
                progress, lateral = (y + 0.28) / 0.56, -(x - 0.28)
        # [progress 0..1 along the piece, lateral mm (left of forward is +)]
        table[str(loc)] = [round(progress, 3), round(lateral * 1000, 1)]
    out = {"raw_kind_code": kind_code, "kind": kind, "exit": [round(ex * 1000, 1), round(ey * 1000, 1), round(eth, 6)], "locs": table}
    if kind == "curve":
        out["radius"] = round(abs(ey) * 1000, 1)
        out["length"] = round(abs(ey) * 1000 * math.pi / 2, 1)
    else:
        out["length"] = round(ex * 1000, 1)
    return piece_id, out


def flatten_items(node, found):
    if isinstance(node, list):
        for child in node:
            flatten_items(child, found)
    elif isinstance(node, dict):
        if "id" in node:
            found[node["id"]] = node
        for child in node.values():
            flatten_items(child, found)


WEAPON_KEYS = ("type", "bay", "interaction_style", "targeter", "energy_use_per_s", "base_energy_cost",
               "damage_per_target_per_s", "damage_per_target", "damage_per_target_per_second_charged",
               "energy_use_in_charge_mode_per_s", "recharge_time_s", "tractor_beam_ratio",
               "boost_speed_addition", "deceleration", "shield_blocked_damage_percent",
               "damage_multiplier_at_max_distance", "cooldown_data", "scripts")


def resolve(item_id, items, depth=0):
    item = items.get(item_id)
    if item is None or depth > 8:
        return {}
    base = resolve(item["extends"], items, depth + 1) if "extends" in item else {}
    merged = dict(base)
    for key, value in item.items():
        if key == "targeter" and isinstance(value, dict):
            merged["targeter"] = {**base.get("targeter", {}), **value}
        else:
            merged[key] = value
    return merged


def main(config_dir, out_dir):
    config_dir, out_dir = Path(config_dir), Path(out_dir)
    pieces = dict(piece(p) for p in sorted((config_dir / "modularRoadPieceDefinitionFiles/racing").glob("*.txt")))
    game = config_dir / "gameData"
    items = {}
    flatten_items(load_json(game / "items.json")["items"], items)
    types = load_json(game / "vehicleTypes.json")
    base = next(v for v in types["abstract_vehicle_types"] if v["id"] == 98)
    energy = {k: base["energy_system"][k] for k in
              ("max_energy", "energy_recharge_rate", "min_energy_to_start_item", "recover_time_s")}
    vehicles, used = {}, set()
    for v in types["vehicle_types"]:
        bays = {bay: spec.get("default_items", []) for bay, spec in v.get("bays", {}).items()}
        for ids in bays.values():
            used.update(ids)
        vehicles[str(v["id"])] = {"name": v["name"], "truck": v.get("extends") in (102, 103), "bays": bays,
                                  "length": round(v.get("dimensions", {}).get("length", 0.083) * 1000, 1)}
    weapons = {}
    for item_id in sorted(used):
        full = resolve(item_id, items)
        if "type" in full:
            weapons[item_id] = {k: full[k] for k in WEAPON_KEYS if k in full}
    out_dir.mkdir(parents=True, exist_ok=True)
    dump = lambda name, data: (out_dir / name).write_text(json.dumps(data, separators=(",", ":"), sort_keys=True) + "\n")
    dump("pieces.json", {str(k): v for k, v in sorted(pieces.items())})
    dump("vehicles.json", {"energy": energy, "speedBounds": types["vehicle_value_bounds"], "models": vehicles})
    dump("weapons.json", weapons)
    print(f"{len(pieces)} pieces, {len(vehicles)} vehicle models, {len(weapons)} weapons")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
