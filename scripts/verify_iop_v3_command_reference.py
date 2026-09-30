#!/usr/bin/env python3
"""Kiểm fixture trong sổ tay IOP V3 bằng Python và header C/C++ nháp."""
from __future__ import annotations

import argparse
import re
import subprocess
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = 'IOP_V3_COMMAND_REFERENCE_MK-DDC-24_VI.md'
FRAME = re.compile(r'<!-- frame:([A-Z0-9-]+) -->\s*```hex\s*([0-9A-F\s]+)```')


def crc16(data: bytes) -> int:
    # Dạng không phản xạ: độc lập với vòng dịch phải trong header.
    crc = 0xFFFF
    for byte in data:
        reflected = int(f'{byte:08b}'[::-1], 2)
        crc ^= reflected << 8
        for _ in range(8):
            crc = ((crc << 1) ^ (0x8005 if crc & 0x8000 else 0)) & 0xFFFF
    return int(f'{crc:016b}'[::-1], 2)


def verify(document: Path, compile_header: bool = True) -> int:
    header = document.parent / 'iop_protocol_v3_DRAFT.h'
    source = header.read_text(encoding='utf-8')
    commands = {int(value, 16): name for name, value in re.findall(
        r'CMD_(\w+)\s*=\s*(0x[0-9A-Fa-f]+)u', source)}
    lengths = {name: int(value) for name, value in re.findall(
        r'#define IOP_(\w+)_LEN\s+(\d+)u', source)}
    content = document.read_text(encoding='utf-8')
    matches = FRAME.findall(content)
    frames = {name: bytes.fromhex(data) for name, data in matches}
    if len(frames) != len(matches) or len(matches) != content.count('<!-- frame:'):
        raise ValueError('Nhãn frame trùng hoặc block hex không đọc được')
    if not frames or set(frame[2] for frame in frames.values()) != set(commands):
        raise ValueError('Thiếu hoặc thừa CMD so với header')
    for name, frame in frames.items():
        if len(frame) < 6 or frame[0] != 0xAA or len(frame) != frame[1] + 6:
            raise ValueError(f'{name}: SOF/LEN/tổng byte sai')
        if frame[1] != lengths[commands[frame[2]]]:
            raise ValueError(f'{name}: LEN khác header')
        if crc16(frame[:-2]) != int.from_bytes(frame[-2:], 'big'):
            raise ValueError(f'{name}: CRC sai')
        if name.endswith('-ACK'):
            request = frames[name[:-4]]
            if frame[2:5] != bytes([0x12, request[3], request[2]]):
                raise ValueError(f'{name}: ACK không khớp request')
    # Kiểm ý nghĩa các response đọc và cấu hình có digest, không chỉ CRC.
    def payload(name: str) -> bytes:
        return frames[name][4:-2]
    for req, resp in [('HS-REQ', 'HS-44-RESP'), ('HS-REQ', 'HS-88-RESP'),
                      ('HS-OLD-REQ', 'HS-OLD-RESP'), ('GET-IO', 'IO-RESP'),
                      ('GET-STATE', 'STATE-RESP'), ('GET-DIAG', 'DIAG-RESP')]:
        if frames[req][3] != frames[resp][3]:
            raise ValueError(f'{req}/{resp}: SEQ không khớp')
    cfg = payload('UI-CFG') + payload('AO-CFG-44') + payload('SAFE-CFG-44')
    if len(cfg) != 34 or zlib.crc32(cfg) != 0x6E4CCFF2:
        raise ValueError('Digest fixture cấu hình khác mô tả')
    if zlib.crc32(bytes(34)) != 0x41716C2A:
        raise ValueError('Digest mặc định sai')
    state = payload('STATE-RESP')
    if state != bytes.fromhex('0F0106000001FFFF00006E4CCFF2') + bytes(16) + b'\x00\x02':
        raise ValueError('STATE_RESP khác bảng giải thích')
    io = payload('IO-RESP')
    if (int.from_bytes(io[:4], 'big', signed=True),
        int.from_bytes(io[4:8], 'big', signed=True)) != (1048576, -1048576):
        raise ValueError('UI raw signed sai')
    if io[8:64] != bytes(56) or io[64:] != bytes.fromhex('010100FA00000064A505'):
        raise ValueError('IO_RESP khác bảng giải thích')
    if payload('DIAG-RESP') != bytes.fromhex('0100003C03E800020001000003E8012C0CE40000'):
        raise ValueError('DIAG_RESP khác bảng giải thích')
    negative = {name: bytes.fromhex(data) for name, data in re.findall(
        r'<!-- invalid-frame:(\w+) -->\s*```hex\s*([0-9A-F\s]+)```', content)}
    if set(negative) != {'CRC', 'LEN', 'CMD', 'VALUE'}:
        raise ValueError('Thiếu fixture đầu vào lỗi')
    for name, frame in negative.items():
        crc_ok = crc16(frame[:-2]) == int.from_bytes(frame[-2:], 'big')
        if frame[0] != 0xAA or len(frame) != frame[1] + 6 or crc_ok != (name != 'CRC'):
            raise ValueError(f'{name}: fixture lỗi không đúng loại lỗi đã mô tả')
    if negative['LEN'][1:4] != bytes([1, 1, 0x60]):
        raise ValueError('Fixture LEN phải là GET_IO có payload một byte')
    if negative['CMD'][2] in commands or negative['CMD'][3] != 0x61:
        raise ValueError('Fixture CMD phải dùng CMD lạ')
    if negative['VALUE'][4:-2] != payload('UI-CFG')[:-1] + b'\x05':
        raise ValueError('Fixture VALUE phải có UI16=05')
    if compile_header:
        with tempfile.TemporaryDirectory(prefix='iop-v3-guide-') as tmp:
            path = Path(tmp)
            lines = ['#include <assert.h>', '#include "iop_protocol_v3_DRAFT.h"', 'int main(void) {']
            for index, frame in enumerate(frames.values()):
                values = ','.join(str(x) for x in frame)
                lines += [f'const uint8_t f{index}[] = {{{values}}};',
                          f'assert(f{index}[2] == CMD_{commands[frame[2]]});',
                          f'assert(f{index}[1] == IOP_{commands[frame[2]]}_LEN);',
                          f'assert(iop_crc16(f{index}, {len(frame)-2}) == {int.from_bytes(frame[-2:], "big")}u);']
            lines += ['const uint8_t cfg[] = {' + ','.join(str(x) for x in cfg) + '};',
                      'const uint8_t zero[34] = {0};',
                      'const uint8_t negative[] = {0xFF,0xF0,0,0};',
                      'assert(iop_crc32(cfg,34) == 0x6E4CCFF2u);',
                      'assert(iop_crc32(zero,34) == 0x41716C2Au);',
                      'assert(iop_be32s(negative) == -1048576);',
                      'assert(iop_populated_mask(4) == 0x0Fu);',
                      'assert(iop_populated_mask(8) == 0xFFu);', 'return 0; }']
            unit = path / 'check.c'
            unit.write_text('\n'.join(lines), encoding='utf-8')
            for compiler, standard in [('gcc', 'c99'), ('gcc', 'c11'), ('g++', 'c++11'), ('g++', 'c++17')]:
                exe = path / standard
                subprocess.run([compiler, '-x', 'c++' if compiler == 'g++' else 'c',
                                '-std='+standard, '-Wall', '-Wextra', '-Werror', '-pedantic',
                                '-I', str(header.parent), str(unit), '-o', str(exe)], check=True)
                subprocess.run([str(exe)], check=True)
    return len(frames)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('document', nargs='?', type=Path, default=ROOT/'docs/01_specs'/NAME)
    args = parser.parse_args()
    count = verify(args.document.resolve())
    print(f'PASS: {count} frame; 16/16 CMD; 4 đầu vào lỗi; 2 digest; CRC/endian C99/C11/C++11/C++17 khớp Python.')


if __name__ == '__main__':
    main()
