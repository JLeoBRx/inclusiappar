"""Gravação mínima de arquivos glTF 2.0 binários (.glb) com numpy.

Suporta uma malha com várias primitivas (ex.: corpo opaco + asas
translúcidas) compartilhando os mesmos atributos de vértice, cores por
vértice, UVs e atributos customizados (prefixo ``_``).
"""
import json
import struct

import numpy as np

FLOAT, UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT = 5126, 5121, 5123, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
TYPES = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4"}


def write_glb(path, name, positions, normals, primitives, colors=None, uvs=None,
              custom=None, extras=None):
    """Grava um .glb.

    ``primitives``: lista de dicts ``{name, triangles (N x 3), transparent?}``.
    ``custom``: atributos extras ``{"_NOME": array 0..1}``; arrays com 4
    colunas viram UNSIGNED_BYTE normalizado, os demais float32.
    """
    blobs, views, accessors = [], [], []

    def add(array, component, target, normalized=False, minmax=False):
        array = np.ascontiguousarray(array)
        if array.ndim == 1:
            array = array[:, None]
        offset = sum(len(b) for b in blobs)
        data = array.tobytes()
        blobs.append(data + b"\0" * (-len(data) % 4))
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        acc = {"bufferView": len(views) - 1, "componentType": component,
               "count": int(array.shape[0]), "type": TYPES[array.shape[1]]}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = array.min(0).astype(float).tolist()
            acc["max"] = array.max(0).astype(float).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    def unorm(values, dtype, scale):
        return np.clip(np.round(np.asarray(values, dtype=np.float64) * scale), 0, scale).astype(dtype)

    attributes = {
        "POSITION": add(positions.astype("<f4"), FLOAT, ARRAY_BUFFER, minmax=True),
        "NORMAL": add(normals.astype("<f4"), FLOAT, ARRAY_BUFFER),
    }
    if uvs is not None:
        attributes["TEXCOORD_0"] = add(uvs.astype("<f4"), FLOAT, ARRAY_BUFFER)
    # Todo elemento de atributo precisa ocupar múltiplos de 4 bytes (regra do glTF).
    if colors is not None:
        attributes["COLOR_0"] = add(np.asarray(colors).astype("<f4"), FLOAT, ARRAY_BUFFER)
    for key, values in (custom or {}).items():
        values = np.asarray(values, dtype=np.float64)
        if values.ndim == 2 and values.shape[1] == 4:
            attributes[key] = add(unorm(values, "<u1", 255), UNSIGNED_BYTE, ARRAY_BUFFER, normalized=True)
        else:
            attributes[key] = add(values.astype("<f4"), FLOAT, ARRAY_BUFFER)

    materials, prims = [], []
    for prim in primitives:
        tris = np.asarray(prim["triangles"]).reshape(-1)
        if tris.size == 0:
            continue
        if tris.max() < 65536:
            index = add(tris.astype("<u2"), UNSIGNED_SHORT, ELEMENT_ARRAY_BUFFER)
        else:
            index = add(tris.astype("<u4"), UNSIGNED_INT, ELEMENT_ARRAY_BUFFER)
        material = {"name": prim["name"], "pbrMetallicRoughness": {
            "baseColorFactor": [1, 1, 1, 0.45 if prim.get("transparent") else 1],
            "metallicFactor": 0.0, "roughnessFactor": 0.7}}
        if prim.get("transparent"):
            material["alphaMode"] = "BLEND"
            material["doubleSided"] = True
        materials.append(material)
        prims.append({"attributes": attributes, "indices": index, "material": len(materials) - 1})

    binary = b"".join(blobs)
    gltf = {
        "asset": {"version": "2.0", "generator": "inclusiapp tools/convert_models.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": prims}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    if extras:
        gltf["nodes"][0]["extras"] = extras
    js = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(binary), b"BIN\0") + binary)
