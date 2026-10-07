#!/usr/bin/env python3
"""Converte os modelos Unity (inclusiapp/modelo3d/*.asset) em GLB para a Web.

Por que é necessário
--------------------
Os arquivos ``.asset`` NÃO são FBX: são assets ``Mesh`` do Unity serializados
em YAML (classe 43). O navegador/Three.js não lê esse formato. Eles também
não trazem texturas, materiais nem animações — apenas a malha com o rig
(pesos de skinning e bind poses).

O que este script faz
---------------------
1. Decodifica vértices, normais, UVs, pesos e índices (``unity_mesh.py``).
2. Converte o sistema de coordenadas do Unity (mão esquerda) para glTF
   (mão direita) e corrige a orientação de cada animal (Y para cima,
   olhando para +Z, patas em y = 0, maior dimensão = 1).
3. Pinta cores por região (cabeça, presas, barriga...) usando os ossos do
   rig original e a geometria, e marca onde aplicar padrões procedurais
   (listras da abelha, rosetas da onça) — ver ``src/ar/animalMaterial.js``.
4. Calcula até 4 "partes" animáveis (asas, orelhas, tromba, cauda, cabeça)
   com pivô na origem do osso correspondente.
5. Grava ``inclusiapp/assets/models/<animal>.glb``.

Uso:  python3 tools/convert_models.py
Requisitos: Python 3.8+ e numpy.
"""
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from unity_mesh import UnityMesh  # noqa: E402
from glb_writer import write_glb  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, "..", "inclusiapp"))
SRC_DIR = os.path.join(ROOT, "modelo3d")
OUT_DIR = os.path.join(ROOT, "assets", "models")


# ---------------------------------------------------------------- utilidades
def rot(axis, degrees):
    a = np.radians(degrees)
    c, s = np.cos(a), np.sin(a)
    return {"x": np.array([[1, 0, 0], [0, c, -s], [0, s, c]]),
            "y": np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            "z": np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def bind_poses(path):
    text = open(path, encoding="utf-8-sig").read()
    section = text[text.index("m_BindPose:"):text.index("m_BoneNameHashes")]
    mats = []
    for block in section.split("- e00:")[1:]:
        values = [float(v) for v in re.findall(r"e\d\d: ([-0-9.eE+]+)", "- e00:" + block)]
        mats.append(np.array(values).reshape(4, 4))
    return mats


class Ctx:
    """Dados de um modelo já normalizado, oferecidos às regras de cor/partes."""

    def __init__(self, positions, normals, weights, bones, bone_origins, triangles):
        self.p, self.n, self.w, self.bi = positions, normals, weights, bones
        self.origins = bone_origins
        self.triangles = triangles
        self.count = len(positions)
        self.x, self.y, self.z = positions[:, 0], positions[:, 1], positions[:, 2]
        self._islands = None

    def islands(self):
        """Rótulo da "ilha" (componente conexo) de cada vértice.

        Vértices na mesma posição (costuras de normal/UV) contam como ligados.
        """
        if self._islands is None:
            parent = np.arange(self.count)

            def find(a):
                while parent[a] != a:
                    parent[a] = parent[parent[a]]
                    a = parent[a]
                return a

            def union(a, b):
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[ra] = rb

            for a, b, c in self.triangles:
                union(a, b)
                union(b, c)
            seen = {}
            for i, key in enumerate(map(tuple, np.round(self.p, 6))):
                if key in seen:
                    union(i, seen[key])
                else:
                    seen[key] = i
            self._islands = np.array([find(i) for i in range(self.count)])
        return self._islands

    def island_mean(self, values):
        """Média de ``values`` em cada ilha, devolvida por vértice."""
        labels = self.islands()
        _, inverse = np.unique(labels, return_inverse=True)
        sums = np.bincount(inverse, weights=values)
        counts = np.bincount(inverse)
        return (sums / counts)[inverse]

    def bones(self, ids):
        """Soma dos pesos de skinning dos ossos em ``ids`` (0..1 por vértice)."""
        ids = np.array(sorted(ids))
        hit = self.bi[:, :, None] == ids[None, None, :]
        return np.clip((self.w[:, :, None] * hit).sum(axis=(1, 2)), 0.0, 1.0)

    def origin(self, bone):
        return self.origins[bone].tolist()


class Painter:
    """Acumula cores (sRGB) por máscara suave."""

    def __init__(self, count, base):
        self.c = np.tile(hex_rgb(base), (count, 1))

    def paint(self, mask, color):
        m = np.clip(np.asarray(mask, dtype=np.float64), 0, 1)[:, None]
        self.c = self.c * (1 - m) + hex_rgb(color)[None, :] * m

    def shade(self, factor):
        self.c = self.c * np.asarray(factor)[:, None]


# ------------------------------------------------- especificação por animal
def bee(ctx):
    # As asas são ilhas de malha separadas (anterior + posterior de cada lado);
    # a ilha inteira vira asa, mesmo os vértices da raiz pesados no tórax.
    wings = (ctx.island_mean(ctx.bones({38, 39, 40, 44, 45, 46})) > 0.3).astype(np.float64)
    body = 1 - wings
    head = ctx.bones({3}) * body
    thorax = ctx.bones({35, 37, 43}) * body
    abdomen = ctx.bones({30, 31, 32, 33}) * body
    antennae = ctx.bones(set(range(10, 20))) * body
    mouth = ctx.bones({2, 4, 5, 7, 8, 20, 21, 23, 25, 26}) * body
    legs = np.clip(body - head - thorax - abdomen - antennae - mouth, 0, 1)

    paint = Painter(ctx.count, "#F4B81C")
    paint.paint(thorax, "#E59A16")
    paint.paint(head, "#3A2A1B")
    # olhos compostos: laterais da cabeça
    eyes = head * smooth(0.06, 0.09, np.abs(ctx.x)) * smooth(0.17, 0.21, ctx.y)
    paint.paint(eyes, "#120F0C")
    paint.paint(legs, "#2E2318")
    paint.paint(antennae, "#21180F")
    paint.paint(mouth, "#4A3320")
    paint.paint(abdomen * smooth(-0.43, -0.47, ctx.z), "#2B1D12")  # ferrão
    paint.paint(wings, "#EEF7FF")

    return dict(
        colors=paint.c,
        pattern=abdomen * (1 - smooth(-0.43, -0.47, ctx.z)),
        groups=(wings > 0.5).astype(np.int32),
        parts=[
            dict(name="asa-direita", weights=wings * (ctx.x > 0), pivot=ctx.origin(44),
                 axis=[0, 0, 1], amplitude=28, frequency=9, phase=0, offset=-6),
            dict(name="asa-esquerda", weights=wings * (ctx.x < 0), pivot=ctx.origin(38),
                 axis=[0, 0, 1], amplitude=-28, frequency=9, phase=0, offset=6),
        ],
        pattern_info=dict(type="stripes", params=[7.2, 0.012, 0.15, 0], color=[0.02, 0.014, 0.008]),
        hover=True,
    )


def elephant(ctx):
    ears = ctx.bones({22, 25})
    trunk = ctx.bones({16, 17, 18, 19, 20, 21, 24})
    tail = ctx.bones({36, 37, 38})
    head = ctx.bones({15})
    # presas: pontas curvas e finas à frente da cabeça, dos dois lados da tromba
    tusk = head * smooth(0.032, 0.045, np.abs(ctx.x)) * (1 - smooth(0.37, 0.40, ctx.y)) * smooth(0.16, 0.2, ctx.z)

    paint = Painter(ctx.count, "#8F9AA5")
    paint.shade(0.88 + 0.2 * np.clip(ctx.y / 0.6, 0, 1))  # leve gradiente: mais claro no dorso
    inner_ear = ears * smooth(0.1, 0.5, ctx.n[:, 2])
    paint.paint(inner_ear * 0.7, "#B49A9F")
    paint.paint(tusk, "#F4EBDA")
    paint.paint(ctx.bones({38}) * smooth(-0.47, -0.49, ctx.z), "#4A4F55")  # tufo da cauda
    paint.paint(smooth(0.03, 0.012, ctx.y) * smooth(-0.2, 0.2, ctx.n[:, 2]), "#CFC6B6")  # unhas

    return dict(
        colors=paint.c,
        parts=[
            dict(name="orelha-direita", weights=ears * (ctx.x > 0), pivot=ctx.origin(25),
                 axis=[0, 1, 0], amplitude=10, frequency=0.55, phase=0, offset=0),
            dict(name="orelha-esquerda", weights=ears * (ctx.x < 0), pivot=ctx.origin(22),
                 axis=[0, 1, 0], amplitude=-10, frequency=0.55, phase=0, offset=0),
            dict(name="tromba", weights=trunk, pivot=ctx.origin(17),
                 axis=[0, 0, 1], amplitude=9, frequency=0.35, phase=1.2),
            dict(name="cauda", weights=tail, pivot=ctx.origin(36),
                 axis=[0, 0, 1], amplitude=22, frequency=1.1, phase=0.4, burst=0.18),
        ],
    )


def iguana(ctx):
    tail = ctx.bones({1, 2, 3, 4, 5})
    head = np.clip(ctx.bones({15, 18}) + 0.5 * ctx.bones({14}), 0, 1)
    up = ctx.n[:, 1]

    paint = Painter(ctx.count, "#4FA544")
    paint.paint(smooth(0.35, 0.85, up) * 0.75, "#3A7E33")      # dorso mais escuro
    paint.paint(smooth(-0.3, -0.75, up), "#B5D777")            # barriga clara
    paint.paint(ctx.bones({15}) * 0.35, "#6CC07A")             # cabeça levemente turquesa
    paint.paint(smooth(0.012, 0.004, ctx.y) * 0.8, "#2F5E2A")  # dedos

    return dict(
        colors=paint.c,
        pattern=tail * smooth(-0.22, -0.3, ctx.z),
        parts=[
            dict(name="cabeca", weights=head, pivot=ctx.origin(14),
                 axis=[1, 0, 0], amplitude=7, frequency=0.9, phase=0, burst=0.22),
            dict(name="cauda", weights=tail, pivot=ctx.origin(1),
                 axis=[0, 1, 0], amplitude=10, frequency=0.45, phase=0.8),
        ],
        pattern_info=dict(type="stripes", params=[9.0, 0.0, 0.35, 0], color=[0.05, 0.13, 0.04]),
    )


def jaguar(ctx):
    tail = ctx.bones({257, 258, 259, 260, 261, 262, 263, 264, 265})
    down = ctx.n[:, 1]
    head = smooth(0.3, 0.36, ctx.z) * smooth(0.18, 0.24, ctx.y)

    paint = Painter(ctx.count, "#E0A136")
    belly = smooth(-0.15, -0.6, down) * (1 - tail)
    paint.paint(belly, "#F3E4C7")
    paint.paint(smooth(0.06, 0.02, ctx.y) * 0.5, "#E9D2A8")                  # patas mais claras
    chin = head * smooth(-0.1, -0.6, down)
    paint.paint(chin, "#F6EBD6")
    muzzle = head * smooth(0.465, 0.49, ctx.z) * smooth(0.36, 0.33, ctx.y)
    paint.paint(muzzle * 0.8, "#F1E2C8")
    nose = smooth(0.488, 0.497, ctx.z) * smooth(0.33, 0.35, ctx.y) * (1 - smooth(0.37, 0.39, ctx.y))
    paint.paint(nose, "#6B3B30")
    paint.paint(tail * smooth(-0.47, -0.49, ctx.z), "#1B1410")               # ponta da cauda

    pattern = np.clip(1 - 0.75 * belly - 0.8 * chin - muzzle - nose, 0, 1)
    return dict(
        colors=paint.c,
        pattern=pattern,
        parts=[
            dict(name="cauda", weights=tail, pivot=ctx.origin(257),
                 axis=[0, 1, 0], amplitude=16, frequency=0.6, phase=0),
            dict(name="cabeca", weights=head, pivot=[0.0, 0.40, 0.33],
                 axis=[0, 1, 0], amplitude=9, frequency=0.18, phase=0.6),
        ],
        pattern_info=dict(type="rosettes", params=[24.0, 0.33, 0.1, 0.35],
                          color=[0.02, 0.016, 0.012], color2=[0.62, 0.42, 0.24]),
    )


def bear(ctx):
    head = smooth(0.27, 0.34, ctx.z) * smooth(0.33, 0.4, ctx.y)

    paint = Painter(ctx.count, "#7A4A2A")
    paint.shade(0.78 + 0.32 * smooth(0.02, 0.35, ctx.y))                     # patas mais escuras
    muzzle = head * smooth(0.445, 0.47, ctx.z) * (1 - smooth(0.5, 0.53, ctx.y))
    paint.paint(muzzle, "#B78A5F")
    nose = smooth(0.485, 0.497, ctx.z) * smooth(0.445, 0.46, ctx.y) * (1 - smooth(0.49, 0.5, ctx.y))
    paint.paint(nose, "#1A1310")
    paint.paint(smooth(0.012, 0.004, ctx.y) * smooth(0.0, 0.5, ctx.n[:, 2]), "#D8C8AE")  # garras

    return dict(
        colors=paint.c,
        parts=[
            dict(name="cabeca-gira", weights=head, pivot=[0.0, 0.52, 0.28],
                 axis=[0, 1, 0], amplitude=11, frequency=0.16, phase=0),
            dict(name="cabeca-acena", weights=head, pivot=[0.0, 0.52, 0.28],
                 axis=[1, 0, 0], amplitude=5, frequency=0.3, phase=1.0),
        ],
    )


SPECS = {
    "abelha": dict(source="Abelha.asset", rotation=[("x", -90)], build=bee, name="Abelha"),
    "elefante": dict(source="Elefante.asset", rotation=[("y", -90)], build=elephant, name="Elefante"),
    "iguana": dict(source="Iguana.asset", rotation=[], build=iguana, name="Iguana"),
    "onca": dict(source="Onca.asset", rotation=[("z", 30), ("x", -90)], build=jaguar, name="Onça"),
    "urso": dict(source="Urso.asset", rotation=[("x", -90)], build=bear, name="Urso"),
}


# ---------------------------------------------------------------- conversão
def convert(key, spec):
    path = os.path.join(SRC_DIR, spec["source"])
    mesh = UnityMesh(path)
    matrix = np.eye(3)
    for axis, degrees in spec["rotation"]:
        matrix = rot(axis, degrees) @ matrix

    flip = np.array([-1.0, 1.0, 1.0])  # Unity (mão esquerda) -> glTF (mão direita)
    positions = (mesh.attribute("position").astype(np.float64) * flip) @ matrix.T
    normals = (mesh.attribute("normal").astype(np.float64) * flip) @ matrix.T
    normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-12
    triangles = mesh.triangles()[:, [0, 2, 1]]  # inverter a ordem mantém a face para fora

    lo, hi = positions.min(0), positions.max(0)
    center = (lo + hi) / 2
    center[1] = lo[1]
    scale = (hi - lo).max()
    positions = (positions - center) / scale

    origins = []
    for bind in bind_poses(path):
        o = np.linalg.inv(bind)[:3, 3] * flip
        origins.append((matrix @ o - center) / scale)

    uvs = mesh.attribute("uv0")
    if uvs is not None:
        uvs = uvs.astype(np.float64).copy()
        uvs[:, 1] = 1.0 - uvs[:, 1]

    ctx = Ctx(positions, normals, mesh.attribute("blendWeight").astype(np.float64),
              mesh.attribute("blendIndices").astype(np.int64), np.array(origins), triangles)
    result = spec["build"](ctx)

    parts = result.get("parts", [])
    anim = np.zeros((ctx.count, 4))
    meta = []
    for i, part in enumerate(parts[:4]):
        anim[:, i] = np.clip(np.asarray(part.pop("weights"), dtype=np.float64), 0, 1)
        part["pivot"] = [round(float(v), 5) for v in part["pivot"]]
        meta.append(part)
    pattern = result.get("pattern")
    if pattern is None:
        pattern = np.zeros(ctx.count)
    groups = result.get("groups")
    if groups is None:
        groups = np.zeros(ctx.count, dtype=np.int32)

    # um triângulo vai para o grupo "asas" quando a maioria dos seus vértices é de asa
    tri_group = (groups[triangles].sum(axis=1) >= 2).astype(np.int32)
    primitives = [dict(name="corpo", triangles=triangles[tri_group == 0])]
    if (tri_group == 1).any():
        primitives.append(dict(name="asas", triangles=triangles[tri_group == 1], transparent=True))

    size = (positions.max(0) - positions.min(0))
    extras = dict(animal=spec["name"], parts=meta, size=[round(float(v), 4) for v in size],
                  pattern=result.get("pattern_info"), hover=bool(result.get("hover", False)),
                  source=f"modelo3d/{spec['source']} ({mesh.name})")
    out = os.path.join(OUT_DIR, f"{key}.glb")
    write_glb(out, spec["name"], positions, normals, primitives,
              colors=srgb_to_linear(np.clip(result["colors"], 0, 1)), uvs=uvs,
              custom={"_ANIMWEIGHTS": anim, "_PATTERN": pattern}, extras=extras)
    print(f"{key:9s} {mesh.vertex_count:5d} vértices {len(triangles):6d} triângulos "
          f"{len(meta)} partes  -> {os.path.relpath(out, ROOT)} ({os.path.getsize(out) // 1024} KB)")
    return extras


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {key: convert(key, spec) for key, spec in SPECS.items()}
    with open(os.path.join(OUT_DIR, "models.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
