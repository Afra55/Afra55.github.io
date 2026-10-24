#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Qwen-VL 质量：把 mmproj 的 image_min 抬到 ≥1024 tokens。

llama-cpp-engine（进程内）不读 LLAMA_ARG_IMAGE_MIN_TOKENS，只认 mmproj 元数据。
本脚本改写 clip.vision.image_min_pixels：
- 已有 key：原地改 4/8 字节（不把整份 GGUF 读进内存）
- 缺 key：流式重写（按块拷贝权重，避免 OOM 拖垮本机桥黑窗口）

失败只打印，不抛给调用方。
"""
from __future__ import annotations

import argparse
import os
import shutil
import struct
import sys
from pathlib import Path

GGUF_MAGIC = b"GGUF"
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
# 元数据通常远小于此；超了再扩读
META_READ_CHUNK = 4 * 1024 * 1024
META_READ_MAX = 64 * 1024 * 1024
COPY_CHUNK = 8 * 1024 * 1024


def _read_string(buf: memoryview, off: int) -> tuple[str, int]:
    (n,) = struct.unpack_from("<Q", buf, off)
    off += 8
    raw = bytes(buf[off : off + n])
    off += n
    return raw.decode("utf-8", errors="replace"), off


def _skip_value(buf: memoryview, off: int, vtype: int) -> int:
    if vtype in (0, 1, 7):
        return off + 1
    if vtype in (2, 3):
        return off + 2
    if vtype in (4, 5, 6):
        return off + 4
    if vtype == 8:
        _, off = _read_string(buf, off)
        return off
    if vtype == 9:
        (atype,) = struct.unpack_from("<I", buf, off)
        off += 4
        (n,) = struct.unpack_from("<Q", buf, off)
        off += 8
        for _ in range(n):
            off = _skip_value(buf, off, atype)
        return off
    if vtype in (10, 11, 12):
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


def _pack_int(vtype: int, value: int) -> bytes:
    if vtype == UINT32:
        return struct.pack("<I", value & 0xFFFFFFFF)
    if vtype == INT32:
        return struct.pack("<i", int(value))
    if vtype == UINT64:
        return struct.pack("<Q", int(value))
    if vtype == INT64:
        return struct.pack("<q", int(value))
    raise ValueError(f"cannot pack type {vtype}")


def _encode_string(s: str) -> bytes:
    raw = s.encode("utf-8")
    return struct.pack("<Q", len(raw)) + raw


def _encode_u32_kv(key: str, value: int) -> bytes:
    return _encode_string(key) + struct.pack("<I", UINT32) + struct.pack("<I", value & 0xFFFFFFFF)


def _load_meta_prefix(path: Path) -> bytes:
    """只读文件头 + KV（必要时扩读），不把整份权重载入内存。"""
    size = path.stat().st_size
    with path.open("rb") as f:
        data = f.read(min(size, META_READ_CHUNK))
        if len(data) < 24 or data[:4] != GGUF_MAGIC:
            raise ValueError("not a GGUF file")
        while True:
            try:
                _kvs, kv_end, tensor_count, _ver = _parse_kvs(data)
                # insert 还要 tensor info：再预读一段
                need = min(size, kv_end + max(META_READ_CHUNK, tensor_count * 256 + 4096))
                if need > len(data):
                    f.seek(len(data))
                    data += f.read(need - len(data))
                return data
            except ValueError:
                if len(data) >= min(size, META_READ_MAX):
                    raise
                f.seek(len(data))
                chunk = f.read(min(META_READ_CHUNK, size - len(data)))
                if not chunk:
                    raise
                data += chunk


def _parse_kvs(data: bytes) -> tuple[dict[str, tuple[int, int, int]], int, int, int]:
    if len(data) < 24 or data[:4] != GGUF_MAGIC:
        raise ValueError("not a GGUF file")
    version = struct.unpack_from("<I", data, 4)[0]
    tensor_count = struct.unpack_from("<Q", data, 8)[0]
    kv_count = struct.unpack_from("<Q", data, 16)[0]
    buf = memoryview(data)
    off = 24
    kvs: dict[str, tuple[int, int, int]] = {}
    for _ in range(kv_count):
        if off + 8 > len(data):
            raise ValueError("truncated GGUF metadata")
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


def _backup_once(path: Path) -> None:
    bak = Path(str(path) + ".bak-imin")
    if bak.exists():
        return
    shutil.copyfile(path, bak)


def _tensor_info_end(data: bytes, kv_end: int, tensor_count: int) -> int:
    buf = memoryview(data)
    off = kv_end
    for _ in range(tensor_count):
        _, off = _read_string(buf, off)
        (n_dims,) = struct.unpack_from("<I", buf, off)
        off += 4 + 8 * n_dims + 4 + 8
    return off


def _first_tensor_offset(data: bytes, kv_end: int, tensor_count: int) -> int | None:
    """GGUF tensor offset 相对数据区；首个张量应为 0。非 0 多为损坏（旧补丁误加了 insert_len）。"""
    if tensor_count <= 0:
        return None
    buf = memoryview(data)
    off = kv_end
    _, off = _read_string(buf, off)
    (n_dims,) = struct.unpack_from("<I", buf, off)
    off += 4 + 8 * n_dims + 4
    (toff,) = struct.unpack_from("<Q", buf, off)
    return int(toff)


def _gguf_looks_corrupt(path: Path) -> bool:
    try:
        meta = _load_meta_prefix(path)
        _kvs, kv_end, tensor_count, _ver = _parse_kvs(meta)
        if tensor_count <= 0:
            return False
        need = _tensor_info_end(meta, kv_end, min(tensor_count, 1))
        if need > len(meta):
            with path.open("rb") as f:
                f.seek(len(meta))
                meta = meta + f.read(need - len(meta))
        first = _first_tensor_offset(meta, kv_end, tensor_count)
        return first is not None and first != 0
    except Exception:
        return True


def _restore_backup(path: Path) -> bool:
    bak = Path(str(path) + ".bak-imin")
    if not bak.is_file():
        return False
    try:
        shutil.copyfile(bak, path)
        marker = Path(str(path) + MARKER_SUFFIX)
        try:
            marker.unlink(missing_ok=True)
        except Exception:
            pass
        return True
    except Exception:
        return False


def _stream_insert_u32_kv(path: Path, meta: bytes, kv_end: int, tensor_count: int, key: str, value: int) -> None:
    """流式插入 KV：元数据在内存里改，权重按块从原文件拷到临时文件。

    重要：GGUF 里 tensor offset 是相对「数据区起点」的，插入 KV 后相对偏移不变，
    绝不能 +insert_len（旧 bug 会导致 first tensor offset=44 一类错误）。
    """
    insert = _encode_u32_kv(key, value)
    old_kv_count = struct.unpack_from("<Q", meta, 16)[0]
    new_header = bytearray(meta[:24])
    struct.pack_into("<Q", new_header, 16, old_kv_count + 1)

    # 确保 meta 覆盖 tensor infos
    info_end = _tensor_info_end(meta, kv_end, tensor_count)
    if info_end > len(meta):
        with path.open("rb") as f:
            f.seek(len(meta))
            meta = meta + f.read(info_end - len(meta))

    buf = memoryview(meta)
    off = kv_end
    infos = bytearray()
    for _ in range(tensor_count):
        name, off = _read_string(buf, off)
        infos += _encode_string(name)
        (n_dims,) = struct.unpack_from("<I", buf, off)
        infos += struct.pack("<I", n_dims)
        off += 4
        for _d in range(n_dims):
            infos += bytes(buf[off : off + 8])
            off += 8
        (ttype,) = struct.unpack_from("<I", buf, off)
        infos += struct.pack("<I", ttype)
        off += 4
        # 保持相对 offset 原样
        infos += bytes(buf[off : off + 8])
        off += 8

    align = 32
    head = bytes(new_header) + meta[24:kv_end] + insert + bytes(infos)
    head += b"\x00" * ((-len(head)) % align)

    old_info_end = off
    old_data_start = old_info_end + ((-old_info_end) % align)

    tmp = Path(str(path) + ".devtools-tmp")
    with path.open("rb") as src, tmp.open("wb") as dst:
        dst.write(head)
        src.seek(old_data_start)
        while True:
            chunk = src.read(COPY_CHUNK)
            if not chunk:
                break
            dst.write(chunk)
    os.replace(tmp, path)


def patch_mmproj(path: Path, min_tokens: int = DEFAULT_MIN_TOKENS) -> str:
    marker = Path(str(path) + MARKER_SUFFIX)

    # 旧版 insert 补丁曾把相对 offset +insert_len，表现为 first tensor offset≠0
    if _gguf_looks_corrupt(path):
        if _restore_backup(path):
            print(f"[image-min] restored corrupt mmproj from .bak-imin: {path}", flush=True)
        else:
            return (
                "fail:corrupt-mmproj: first tensor offset≠0（多为旧补丁损坏）。"
                "请删该 mmproj（及同名 .devtools-imin-1024），让 MinerU 重新下载模型"
            )

    if marker.is_file():
        try:
            if int(marker.read_text(encoding="utf-8").strip() or "0") >= min_tokens:
                # marker 在，但文件又坏了的话上面已处理；再确认一次
                if not _gguf_looks_corrupt(path):
                    return "skip"
        except Exception:
            pass

    try:
        meta = _load_meta_prefix(path)
        kvs, kv_end, tensor_count, _version = _parse_kvs(meta)
        target = _target_pixels(kvs, meta, min_tokens)
    except Exception as err:
        return f"fail:parse:{err}"

    try:
        if KEY_IMAGE_MIN in kvs:
            vtype, v_start, _v_end = kvs[KEY_IMAGE_MIN]
            cur = _read_u32ish(memoryview(meta), v_start, vtype)
            if cur >= target:
                marker.write_text(str(min_tokens), encoding="utf-8")
                return "skip"
            _backup_once(path)
            blob = _pack_int(vtype, target)
            with path.open("r+b") as f:
                f.seek(v_start)
                f.write(blob)
            # 校验：只再读元数据头
            meta2 = _load_meta_prefix(path)
            ck, kv2, tc2, _ = _parse_kvs(meta2)
            vt, vs, _ = ck[KEY_IMAGE_MIN]
            if _read_u32ish(memoryview(meta2), vs, vt) < target:
                _restore_backup(path)
                return "fail:verify"
            if tc2 > 0:
                first = _first_tensor_offset(meta2, kv2, tc2)
                if first is not None and first != 0:
                    _restore_backup(path)
                    return "fail:verify-offset"
            marker.write_text(str(min_tokens), encoding="utf-8")
            return "ok"

        _backup_once(path)
        _stream_insert_u32_kv(path, meta, kv_end, tensor_count, KEY_IMAGE_MIN, target)
        meta2 = _load_meta_prefix(path)
        ck, kv2, tc2, _ = _parse_kvs(meta2)
        if KEY_IMAGE_MIN not in ck:
            _restore_backup(path)
            return "fail:insert-verify"
        vt, vs, _ = ck[KEY_IMAGE_MIN]
        if _read_u32ish(memoryview(meta2), vs, vt) < target:
            _restore_backup(path)
            return "fail:insert-value"
        if tc2 > 0:
            # 可能 meta2 不够覆盖 tensor info
            need = _tensor_info_end(meta2, kv2, min(tc2, 1))
            if need > len(meta2):
                with path.open("rb") as f:
                    f.seek(len(meta2))
                    meta2 = meta2 + f.read(need - len(meta2))
            first = _first_tensor_offset(meta2, kv2, tc2)
            if first is not None and first != 0:
                _restore_backup(path)
                return "fail:insert-offset"
        marker.write_text(str(min_tokens), encoding="utf-8")
        return "ok"
    except Exception as err:
        try:
            Path(str(path) + ".devtools-tmp").unlink(missing_ok=True)
        except Exception:
            pass
        try:
            _restore_backup(path)
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
        lines.append(f"{patch_mmproj(f, min_tokens)}: {f}")
    return lines


def _selftest() -> None:
    import tempfile

    def build(kvs: list[tuple[str, int, bytes]], tensors: list[tuple[str, int]] | None = None) -> bytes:
        """tensors: list of (name, relative_offset). Data blob padded after infos."""
        body = bytearray()
        for key, vtype, val in kvs:
            body += _encode_string(key)
            body += struct.pack("<I", vtype)
            body += val
        tensors = tensors or []
        header = (
            GGUF_MAGIC
            + struct.pack("<I", 3)
            + struct.pack("<Q", len(tensors))
            + struct.pack("<Q", len(kvs))
        )
        infos = bytearray()
        for name, toff in tensors:
            infos += _encode_string(name)
            infos += struct.pack("<I", 1)  # n_dims
            infos += struct.pack("<Q", 4)  # dim0
            infos += struct.pack("<I", 0)  # F32
            infos += struct.pack("<Q", toff)
        head = bytes(header + body + infos)
        align = 32
        head += b"\x00" * ((-len(head)) % align)
        # 每个假张量 16 字节占位
        data = b"\x00" * max((max((t[1] for t in tensors), default=0) + 16), 16 if tensors else 0)
        return head + data

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        patch = 14
        merge = 2
        area = patch * patch * merge * merge
        low = 8 * area
        high = DEFAULT_MIN_TOKENS * area

        p1 = td_path / "a.mmproj.gguf"
        p1.write_bytes(
            build(
                [
                    (KEY_PATCH, UINT32, struct.pack("<I", patch)),
                    (KEY_MERGE, UINT32, struct.pack("<I", merge)),
                    (KEY_IMAGE_MIN, UINT32, struct.pack("<I", low)),
                ]
            )
        )
        assert patch_mmproj(p1) == "ok", patch_mmproj(p1)
        meta = _load_meta_prefix(p1)
        kvs, *_ = _parse_kvs(meta)
        vt, vs, _ = kvs[KEY_IMAGE_MIN]
        assert _read_u32ish(memoryview(meta), vs, vt) == high
        assert patch_mmproj(p1) == "skip"

        p2 = td_path / "b.mmproj.gguf"
        p2.write_bytes(
            build(
                [
                    (KEY_PATCH, UINT32, struct.pack("<I", patch)),
                    (KEY_MERGE, UINT32, struct.pack("<I", merge)),
                ],
                tensors=[("v.blk.0.attn_out.bias", 0), ("v.blk.0.attn_out.weight", 16)],
            )
        )
        assert patch_mmproj(p2) == "ok", patch_mmproj(p2)
        meta = _load_meta_prefix(p2)
        kvs, kv_end, tc, _ = _parse_kvs(meta)
        assert KEY_IMAGE_MIN in kvs
        vt, vs, _ = kvs[KEY_IMAGE_MIN]
        assert _read_u32ish(memoryview(meta), vs, vt) == high
        need = _tensor_info_end(meta, kv_end, tc)
        if need > len(meta):
            with p2.open("rb") as f:
                f.seek(len(meta))
                meta = meta + f.read(need - len(meta))
        assert _first_tensor_offset(meta, kv_end, tc) == 0, "insert 不得改相对 offset"

        # 模拟旧 bug：first offset=44 → 应从 bak 恢复再打补丁
        p3 = td_path / "c.mmproj.gguf"
        good = build(
            [
                (KEY_PATCH, UINT32, struct.pack("<I", patch)),
                (KEY_MERGE, UINT32, struct.pack("<I", merge)),
            ],
            tensors=[("v.blk.0.attn_out.bias", 0)],
        )
        p3.write_bytes(good)
        shutil.copyfile(p3, Path(str(p3) + ".bak-imin"))
        broken = build(
            [
                (KEY_PATCH, UINT32, struct.pack("<I", patch)),
                (KEY_MERGE, UINT32, struct.pack("<I", merge)),
            ],
            tensors=[("v.blk.0.attn_out.bias", 44)],
        )
        p3.write_bytes(broken)
        assert _gguf_looks_corrupt(p3)
        assert patch_mmproj(p3) == "ok", patch_mmproj(p3)
        meta = _load_meta_prefix(p3)
        _kvs, kv_end, tc, _ = _parse_kvs(meta)
        need = _tensor_info_end(meta, kv_end, tc)
        if need > len(meta):
            with p3.open("rb") as f:
                f.seek(len(meta))
                meta = meta + f.read(need - len(meta))
        assert _first_tensor_offset(meta, kv_end, tc) == 0
        assert not _gguf_looks_corrupt(p3)
    print("selftest ok")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Bump Qwen-VL mmproj image_min to ≥1024 tokens")
    ap.add_argument("--models-dir", default="")
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
        raise SystemExit(0)
