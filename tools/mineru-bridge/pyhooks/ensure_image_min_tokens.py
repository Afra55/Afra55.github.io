#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Qwen-VL 质量：把 mmproj 的 image_min 抬到 ≥1024 tokens。

llama-cpp-engine（进程内）不读 LLAMA_ARG_IMAGE_MIN_TOKENS，只认 mmproj 元数据 /
mtmd 的 image_min_tokens。本脚本在模型目录里安全改写
clip.vision.image_min_pixels（先写临时文件再替换；首次留 .bak）。

失败只打印，不抛给调用方——转换仍可继续。
"""
from __future__ import annotations

import argparse
import os
import struct
import sys
from pathlib import Path

GGUF_MAGIC = b"GGUF"
# gguf.Constants.GGUFValueType
UINT32 = 4
INT32 = 5
STRING = 8
UINT64 = 10
INT64 = 11

KEY_IMAGE_MIN = "clip.vision.image_min_pixels"
KEY_PATCH = "clip.vision.patch_size"
KEY_MERGE = "clip.vision.spatial_merge_size"
MARKER_SUFFIX = ".devtools-imin-1024"
DEFAULT_MIN_TOKENS = 1024
DEFAULT_MERGE = 2


def _read_string(buf: memoryview, off: int) -> tuple[str, int]:
    (n,) = struct.unpack_from("<Q", buf, off)
    off += 8
    raw = bytes(buf[off : off + n])
    off += n
    return raw.decode("utf-8", errors="replace"), off


def _skip_value(buf: memoryview, off: int, vtype: int) -> int:
    if vtype == 0:  # UINT8
        return off + 1
    if vtype == 1:  # INT8
        return off + 1
    if vtype == 2:  # UINT16
        return off + 2
    if vtype == 3:  # INT16
        return off + 2
    if vtype == 4:  # UINT32
        return off + 4
    if vtype == 5:  # INT32
        return off + 4
    if vtype == 6:  # FLOAT32
        return off + 4
    if vtype == 7:  # BOOL
        return off + 1
    if vtype == 8:  # STRING
        _, off = _read_string(buf, off)
        return off
    if vtype == 9:  # ARRAY
        (atype,) = struct.unpack_from("<I", buf, off)
        off += 4
        (n,) = struct.unpack_from("<Q", buf, off)
        off += 8
        for _ in range(n):
            off = _skip_value(buf, off, atype)
        return off
    if vtype == 10:  # UINT64
        return off + 8
    if vtype == 11:  # INT64
        return off + 8
    if vtype == 12:  # FLOAT64
        return off + 8
    raise ValueError(f"unsupported GGUF value type {vtype}")


def _read_u32ish(buf: memoryview, off: int, vtype: int) -> int:
    if vtype == UINT32:
        return struct.unpack_from("<I", buf, off)[0]
    if vtype == INT32:
        return struct.unpack_from("<i", buf, off)[0]
    if vtype == UINT64:
        return int(struct.unpack_from("<Q", buf, off)[0])
    if vtype == INT64:
        return int(struct.unpack_from("<q", buf, off)[0])
    raise ValueError(f"key is not integer type ({vtype})")


def _parse_kvs(data: bytes) -> tuple[dict[str, tuple[int, int, int]], int, int, int]:
    """返回 {key: (vtype, value_offset, value_end)}, kv_end, tensor_count, version."""
    if len(data) < 24 or data[:4] != GGUF_MAGIC:
        raise ValueError("not a GGUF file")
    version = struct.unpack_from("<I", data, 4)[0]
    tensor_count = struct.unpack_from("<Q", data, 8)[0]
    kv_count = struct.unpack_from("<Q", data, 16)[0]
    buf = memoryview(data)
    off = 24
    kvs: dict[str, tuple[int, int, int]] = {}
    for _ in range(kv_count):
        key, off = _read_string(buf, off)
        (vtype,) = struct.unpack_from("<I", buf, off)
        off += 4
        v_start = off
        off = _skip_value(buf, off, vtype)
        kvs[key] = (vtype, v_start, off)
    return kvs, off, tensor_count, version


def _target_pixels(kvs: dict[str, tuple[int, int, int]], data: bytes, min_tokens: int) -> int:
    buf = memoryview(data)
    patch = 14
    merge = DEFAULT_MERGE
    if KEY_PATCH in kvs:
        vt, vs, _ = kvs[KEY_PATCH]
        try:
            patch = max(1, _read_u32ish(buf, vs, vt))
        except Exception:
            pass
    if KEY_MERGE in kvs:
        vt, vs, _ = kvs[KEY_MERGE]
        try:
            merge = max(1, _read_u32ish(buf, vs, vt))
        except Exception:
            pass
    return int(min_tokens) * patch * patch * merge * merge


def _update_in_place(path: Path, value_off: int, vtype: int, new_val: int) -> None:
    if vtype == UINT32:
        blob = struct.pack("<I", new_val & 0xFFFFFFFF)
    elif vtype == INT32:
        blob = struct.pack("<i", int(new_val))
    elif vtype == UINT64:
        blob = struct.pack("<Q", int(new_val))
    elif vtype == INT64:
        blob = struct.pack("<q", int(new_val))
    else:
        raise ValueError(f"cannot in-place update type {vtype}")
    with path.open("r+b") as f:
        f.seek(value_off)
        f.write(blob)


def _encode_string(s: str) -> bytes:
    raw = s.encode("utf-8")
    return struct.pack("<Q", len(raw)) + raw


def _encode_u32_kv(key: str, value: int) -> bytes:
    return _encode_string(key) + struct.pack("<I", UINT32) + struct.pack("<I", value & 0xFFFFFFFF)


def _insert_u32_kv(data: bytes, kv_end: int, tensor_count: int, key: str, value: int) -> bytes:
    """在 KV 区末尾插入一个 UINT32，并上调后续 tensor 数据偏移。"""
    insert = _encode_u32_kv(key, value)
    insert_len = len(insert)
    # header: magic(4)+ver(4)+tensor_count(8)+kv_count(8)
    old_kv_count = struct.unpack_from("<Q", data, 16)[0]
    new_header = bytearray(data[:24])
    struct.pack_into("<Q", new_header, 16, old_kv_count + 1)

    # tensor infos start at kv_end; each has name, n_dims, dims[n], type, offset
    buf = memoryview(data)
    off = kv_end
    infos = bytearray()
    for _ in range(tensor_count):
        name, off = _read_string(buf, off)
        infos += _encode_string(name)
        (n_dims,) = struct.unpack_from("<I", buf, off)
        infos += struct.pack("<I", n_dims)
        off += 4
        for _d in range(n_dims):
            dim = buf[off : off + 8]
            infos += bytes(dim)
            off += 8
        (ttype,) = struct.unpack_from("<I", buf, off)
        infos += struct.pack("<I", ttype)
        off += 4
        (toff,) = struct.unpack_from("<Q", buf, off)
        off += 8
        infos += struct.pack("<Q", toff + insert_len)

    # alignment padding before tensor data: GGUF aligns to 32
    # After new KV + tensor infos, pad so data starts at align
    meta = bytes(new_header) + data[24:kv_end] + insert + bytes(infos)
    align = 32
    pad = (-len(meta)) % align
    meta += b"\x00" * pad

    # Original tensor payload: from old aligned start
    old_meta_len = kv_end
    # Recompute old tensor-info end
    off = kv_end
    for _ in range(tensor_count):
        _, off = _read_string(buf, off)
        (n_dims,) = struct.unpack_from("<I", buf, off)
        off += 4 + 8 * n_dims + 4 + 8
    old_info_end = off
    old_pad = (-old_info_end) % align
    old_data_start = old_info_end + old_pad
    payload = data[old_data_start:]
    return meta + payload


def patch_mmproj(path: Path, min_tokens: int = DEFAULT_MIN_TOKENS) -> str:
    """返回 'ok' | 'skip' | 'fail:…'。"""
    marker = Path(str(path) + MARKER_SUFFIX)
    if marker.is_file():
        try:
            if int(marker.read_text(encoding="utf-8").strip() or "0") >= min_tokens:
                return "skip"
        except Exception:
            pass

    try:
        data = path.read_bytes()
    except Exception as err:
        return f"fail:read:{err}"

    try:
        kvs, kv_end, tensor_count, _version = _parse_kvs(data)
        target = _target_pixels(kvs, data, min_tokens)
    except Exception as err:
        return f"fail:parse:{err}"

    try:
        if KEY_IMAGE_MIN in kvs:
            vtype, v_start, _v_end = kvs[KEY_IMAGE_MIN]
            cur = _read_u32ish(memoryview(data), v_start, vtype)
            if cur >= target:
                marker.write_text(str(min_tokens), encoding="utf-8")
                return "skip"
            bak = Path(str(path) + ".bak-imin")
            if not bak.exists():
                bak.write_bytes(data)
            # 优先原地写；类型不匹配则整文件重写插入路径不走
            tmp = Path(str(path) + ".devtools-tmp")
            tmp.write_bytes(data)
            _update_in_place(tmp, v_start, vtype, target)
            # 校验
            check = tmp.read_bytes()
            ck, *_ = _parse_kvs(check)
            vt, vs, _ = ck[KEY_IMAGE_MIN]
            if _read_u32ish(memoryview(check), vs, vt) < target:
                tmp.unlink(missing_ok=True)
                return "fail:verify"
            os.replace(tmp, path)
            marker.write_text(str(min_tokens), encoding="utf-8")
            return "ok"
        # 缺 key：插入
        bak = Path(str(path) + ".bak-imin")
        if not bak.exists():
            bak.write_bytes(data)
        new_data = _insert_u32_kv(data, kv_end, tensor_count, KEY_IMAGE_MIN, target)
        tmp = Path(str(path) + ".devtools-tmp")
        tmp.write_bytes(new_data)
        check = tmp.read_bytes()
        ck, *_ = _parse_kvs(check)
        if KEY_IMAGE_MIN not in ck:
            tmp.unlink(missing_ok=True)
            return "fail:insert-verify"
        vt, vs, _ = ck[KEY_IMAGE_MIN]
        if _read_u32ish(memoryview(check), vs, vt) < target:
            tmp.unlink(missing_ok=True)
            return "fail:insert-value"
        os.replace(tmp, path)
        marker.write_text(str(min_tokens), encoding="utf-8")
        return "ok"
    except Exception as err:
        try:
            Path(str(path) + ".devtools-tmp").unlink(missing_ok=True)
        except Exception:
            pass
        return f"fail:write:{err}"


def find_mmproj(models_dir: Path) -> list[Path]:
    if not models_dir.is_dir():
        return []
    out: list[Path] = []
    for root, _dirs, files in os.walk(models_dir):
        for name in files:
            low = name.lower()
            if not low.endswith(".gguf"):
                continue
            if "mmproj" in low or "mm_proj" in low or "projector" in low:
                out.append(Path(root) / name)
    return out


def patch_models_dir(models_dir: Path, min_tokens: int = DEFAULT_MIN_TOKENS) -> list[str]:
    lines = []
    files = find_mmproj(models_dir)
    if not files:
        lines.append(f"skip: no mmproj under {models_dir}")
        return lines
    for f in files:
        status = patch_mmproj(f, min_tokens)
        lines.append(f"{status}: {f}")
    return lines


def _selftest() -> None:
    """构造最小 GGUF（无 tensor）测 update / insert。"""
    import tempfile

    def build(kvs: list[tuple[str, int, bytes]]) -> bytes:
        body = bytearray()
        for key, vtype, val in kvs:
            body += _encode_string(key)
            body += struct.pack("<I", vtype)
            body += val
        header = GGUF_MAGIC + struct.pack("<I", 3) + struct.pack("<Q", 0) + struct.pack("<Q", len(kvs))
        return bytes(header + body)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        # case: update existing low min pixels
        p1 = td_path / "a.mmproj.gguf"
        patch = 14
        merge = 2
        area = patch * patch * merge * merge
        low = 8 * area
        high = DEFAULT_MIN_TOKENS * area
        p1.write_bytes(
            build(
                [
                    (KEY_PATCH, UINT32, struct.pack("<I", patch)),
                    (KEY_MERGE, UINT32, struct.pack("<I", merge)),
                    (KEY_IMAGE_MIN, UINT32, struct.pack("<I", low)),
                ]
            )
        )
        assert patch_mmproj(p1) == "ok"
        data = p1.read_bytes()
        kvs, *_ = _parse_kvs(data)
        vt, vs, _ = kvs[KEY_IMAGE_MIN]
        assert _read_u32ish(memoryview(data), vs, vt) == high
        assert patch_mmproj(p1) == "skip"

        # case: insert missing key
        p2 = td_path / "b.mmproj.gguf"
        p2.write_bytes(
            build(
                [
                    (KEY_PATCH, UINT32, struct.pack("<I", patch)),
                    (KEY_MERGE, UINT32, struct.pack("<I", merge)),
                ]
            )
        )
        assert patch_mmproj(p2) == "ok"
        data = p2.read_bytes()
        kvs, *_ = _parse_kvs(data)
        assert KEY_IMAGE_MIN in kvs
        vt, vs, _ = kvs[KEY_IMAGE_MIN]
        assert _read_u32ish(memoryview(data), vs, vt) == high
    print("selftest ok")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Bump Qwen-VL mmproj image_min to ≥1024 tokens")
    ap.add_argument("--models-dir", required=False, default="", help="MINERU_MODEL_BASE_DIR")
    ap.add_argument("--min-tokens", type=int, default=DEFAULT_MIN_TOKENS)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)
    if args.selftest:
        _selftest()
        return 0
    models = Path(args.models_dir or os.environ.get("MINERU_MODEL_BASE_DIR") or "")
    if not models:
        print("skip: no models dir", flush=True)
        return 0
    for line in patch_models_dir(models, args.min_tokens):
        print(line, flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as err:
        print(f"fail:fatal:{err}", file=sys.stderr, flush=True)
        raise SystemExit(0)  # 不阻断转换
