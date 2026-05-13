#!/usr/bin/env python3
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image


def pad4(data: bytes, pad_byte: bytes = b" ") -> bytes:
    return data + pad_byte * ((4 - len(data) % 4) % 4)


def read_glb(path: Path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError(f"{path} is not a glTF 2.0 GLB")
    offset = 12
    chunks = {}
    while offset < len(data):
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks[chunk_type] = data[offset : offset + chunk_len]
        offset += chunk_len
    return json.loads(chunks[0x4E4F534A].rstrip(b" \0")), chunks[0x004E4942]


def write_glb(path: Path, gltf: dict, bin_chunk: bytes):
    json_chunk = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bin_chunk = pad4(bin_chunk, b"\0")
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(json_chunk), 0x4E4F534A)
    out += json_chunk
    out += struct.pack("<II", len(bin_chunk), 0x004E4942)
    out += bin_chunk
    path.write_bytes(out)


def compress_image(data: bytes, max_size: int, quality: int) -> bytes:
    image = Image.open(io.BytesIO(data)).convert("RGB")
    image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
    return out.getvalue()


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: compress_glb_images.py input.glb output.glb [max_size] [quality]")
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    max_size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    quality = int(sys.argv[4]) if len(sys.argv) > 4 else 76

    gltf, bin_chunk = read_glb(src)
    replacements = {}
    for image in gltf.get("images", []):
        view_index = image.get("bufferView")
        if view_index is None:
            continue
        view = gltf["bufferViews"][view_index]
        start = view.get("byteOffset", 0)
        end = start + view["byteLength"]
        original = bin_chunk[start:end]
        replacement = compress_image(original, max_size, quality)
        if len(replacement) < len(original):
            replacements[view_index] = replacement
            image["mimeType"] = "image/jpeg"

    new_bin = bytearray()
    for index, view in enumerate(gltf["bufferViews"]):
        start = view.get("byteOffset", 0)
        end = start + view["byteLength"]
        payload = replacements.get(index, bin_chunk[start:end])
        while len(new_bin) % 4:
            new_bin.append(0)
        view["byteOffset"] = len(new_bin)
        view["byteLength"] = len(payload)
        new_bin += payload

    gltf["buffers"][0]["byteLength"] = len(new_bin)
    write_glb(dst, gltf, bytes(new_bin))
    print(f"{src} -> {dst}: {src.stat().st_size} -> {dst.stat().st_size} bytes")


if __name__ == "__main__":
    main()
