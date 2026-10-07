"""Leitura de malhas Unity serializadas em texto (YAML, classe 43 = Mesh).

Os arquivos ``modelo3d/*.asset`` do projeto não são FBX: são assets ``Mesh`` do
Unity (``serializedVersion: 11``) em formato YAML. A geometria está em
``m_VertexData._typelessdata`` (hexadecimal, little-endian) organizada em
"streams", e os índices em ``m_IndexBuffer``. Este módulo decodifica esse
formato com numpy, sem depender do Unity.
"""
import re
import numpy as np

# Ordem dos canais do Unity 2019+ (enum VertexAttribute)
ATTRIBUTES = ["position", "normal", "tangent", "color",
              "uv0", "uv1", "uv2", "uv3", "uv4", "uv5", "uv6", "uv7",
              "blendWeight", "blendIndices"]

# Enum VertexAttributeFormat -> (dtype numpy, bytes por componente)
FORMATS = {0: ("f4", 4), 1: ("f2", 2), 2: ("u1", 1), 3: ("i1", 1),
           4: ("u2", 2), 5: ("i2", 2), 6: ("u1", 1), 7: ("i1", 1),
           8: ("u2", 2), 9: ("i2", 2), 10: ("u4", 4), 11: ("i4", 4)}

_CHANNEL_RE = re.compile(r"- stream: (\d+)\n\s+offset: (\d+)\n\s+format: (\d+)\n\s+dimension: (\d+)")
_SUBMESH_RE = re.compile(r"firstByte: (\d+)\n\s+indexCount: (\d+)\n\s+topology: (\d+)\n\s+"
                         r"baseVertex: (\d+)\n\s+firstVertex: (\d+)\n\s+vertexCount: (\d+)")


class UnityMesh:
    def __init__(self, path):
        text = open(path, encoding="utf-8-sig").read()
        if "--- !u!43 " not in text:
            raise ValueError(f"{path}: não é um asset Mesh do Unity (classe 43)")
        if re.search(r"m_MeshCompression: [1-9]", text):
            raise ValueError(f"{path}: malha comprimida (m_CompressedMesh) não suportada")
        self.name = re.search(r"m_Name: (.*)", text).group(1).strip()
        vd = text[text.index("  m_VertexData:"):text.index("  m_CompressedMesh:")]
        self.vertex_count = int(re.search(r"m_VertexCount: (\d+)", vd).group(1))
        self.channels = [tuple(map(int, c)) for c in _CHANNEL_RE.findall(vd)]
        self.data = bytes.fromhex(re.search(r"_typelessdata: ([0-9a-fA-F]*)", vd).group(1))
        index_format = int(re.search(r"m_IndexFormat: (\d+)", text).group(1))
        index_bytes = bytes.fromhex(re.search(r"m_IndexBuffer: ([0-9a-fA-F]*)", text).group(1))
        self.indices = np.frombuffer(index_bytes, dtype="<u2" if index_format == 0 else "<u4").astype(np.uint32)
        self.submeshes = [dict(zip(("firstByte", "indexCount", "topology", "baseVertex",
                                    "firstVertex", "vertexCount"), map(int, s)))
                          for s in _SUBMESH_RE.findall(text)]
        for sm in self.submeshes:
            if sm["topology"] != 0:
                raise ValueError(f"{path}: topologia {sm['topology']} não suportada (apenas triângulos)")
        self._layout()
        declared = int(re.search(r"m_DataSize: (\d+)", vd).group(1))
        if declared != len(self.data) or self._total != len(self.data):
            raise ValueError(f"{path}: tamanho do vertex buffer inconsistente "
                             f"({len(self.data)} bytes, declarado {declared}, calculado {self._total})")

    def _layout(self):
        strides = {}
        for stream, offset, fmt, dim in self.channels:
            if dim:
                strides[stream] = max(strides.get(stream, 0), offset + FORMATS[fmt][1] * dim)
        # Os streams ficam em sequência no buffer, cada um alinhado a 16 bytes.
        offsets, cursor = {}, 0
        for stream in sorted(strides):
            cursor = (cursor + 15) // 16 * 16
            offsets[stream] = cursor
            cursor += strides[stream] * self.vertex_count
        self._strides, self._offsets, self._total = strides, offsets, cursor

    def has(self, attribute):
        return self.channels[ATTRIBUTES.index(attribute)][3] > 0

    def attribute(self, attribute):
        stream, offset, fmt, dim = self.channels[ATTRIBUTES.index(attribute)]
        if not dim:
            return None
        dtype, size = FORMATS[fmt]
        out = np.empty((self.vertex_count, dim), dtype=dtype)
        for k in range(dim):
            out[:, k] = np.ndarray((self.vertex_count,), dtype="<" + dtype, buffer=self.data,
                                   offset=self._offsets[stream] + offset + k * size,
                                   strides=(self._strides[stream],))
        return out

    def triangles(self):
        tris = []
        for sm in self.submeshes:
            first = sm["firstByte"] // self.indices.itemsize
            idx = self.indices[first:first + sm["indexCount"]] + sm["baseVertex"]
            tris.append(idx.reshape(-1, 3))
        return np.concatenate(tris)
