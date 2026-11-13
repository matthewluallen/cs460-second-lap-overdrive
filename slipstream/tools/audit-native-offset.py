#!/usr/bin/env python3
"""Read-only verification of one native offset conversion; never loads the ELF.

Optional audit dependencies: pip install capstone pyelftools
Usage: python audit-native-offset.py /private/path/libDriveEngine.so
Output contains hashes, addresses and scalar facts, not proprietary code bodies.
An unrecognized instruction pattern fails closed; it is not a general decompiler.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import capstone
from capstone.arm import ARM_OP_MEM, ARM_REG_PC
from elftools.elf.elffile import ELFFile

SYMBOL = "_ZN11BaseStation6CarMsg32ConvertOffsetFromRoadCenter_mm2mEf"


def inspect(path):
    with path.open("rb") as stream:
        elf = ELFFile(stream)
        if elf["e_machine"] != "EM_ARM" or not elf.little_endian or elf.elfclass != 32:
            raise ValueError("Expected a little-endian ARM32 ELF")
        symbols = elf.get_section_by_name(".dynsym")
        matches = symbols.get_symbol_by_name(SYMBOL) if symbols else None
        if not matches:
            raise ValueError("Named native offset converter is absent")
        symbol = matches[0]
        address, size = symbol["st_value"] & ~1, symbol["st_size"]

        def read_va(va, count):
            for segment in elf.iter_segments():
                start = segment["p_vaddr"]
                if segment["p_type"] == "PT_LOAD" and start <= va and va + count <= start + segment["p_filesz"]:
                    stream.seek(segment["p_offset"] + va - start)
                    return stream.read(count)
            raise ValueError("Address is outside file-backed ELF segments")

        disassembler = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
        disassembler.detail = True
        operations, literals = [], {}
        for instruction in disassembler.disasm(read_va(address, size), address):
            operations.append((instruction.mnemonic, instruction.op_str))
            if instruction.mnemonic == "vldr":
                target, source = instruction.operands
                if source.type != ARM_OP_MEM or source.mem.base != ARM_REG_PC:
                    raise ValueError("Unexpected literal addressing")
                literal_va = ((instruction.address + 4) & ~3) + source.mem.disp
                literals[instruction.reg_name(target.reg)] = struct.unpack("<f", read_va(literal_va, 4))[0]
            if (instruction.mnemonic, instruction.op_str) == ("bx", "lr"):
                break
        required = [("vmov", "s2, r0"), ("vcmpe.f32", "s2, s4"),
                    ("vmrs", "apsr_nzcv, fpscr"), ("vmul.f32", "s0, s2, s0"),
                    ("it", "gt"), ("vmovgt.f32", "s0, s6"), ("vmov", "r0, s0"), ("bx", "lr")]
        semantic_operations = [op for op in operations if op[0] != "vldr"]
        if semantic_operations != required or set(literals) != {"s0", "s4", "s6"}:
            raise ValueError("Converter instruction pattern is not the reviewed scalar operation")
        return {"librarySha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "symbol": SYMBOL, "elfVirtualAddress": hex(address), "functionBytes": size,
                "technique": "ELF symbol lookup + Capstone Thumb instructions + PC-relative float literals",
                "capstoneVersion": capstone.__version__, "executedNativeCode": False,
                "unknownComparison": "rawOffsetMm > thresholdMm", "thresholdMm": literals["s4"],
                "unknownValue": literals["s6"], "knownOffsetMultiplier": literals["s0"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.library), indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"Native converter not verified: {error}\n")
