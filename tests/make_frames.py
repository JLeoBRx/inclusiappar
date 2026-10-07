#!/usr/bin/env python3
"""Gera quadros sintéticos de câmera (640x480) para testar o reconhecimento.

Cada imagem-alvo (página ou carta) é colocada sobre um fundo com distrações,
com perspectiva, rotação, escala, desfoque, variação de luz e ruído — imitando
a foto de um celular. Saída: tests/fixtures/frames/<conjunto>/<alvo>_<variante>.jpg

Uso: python3 tests/make_frames.py
"""
import glob
import os
import re

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, "..", "inclusiapp"))
OUT = os.path.join(HERE, "fixtures", "frames")
W, H = 640, 480
rng = np.random.RandomState(42)


def numbered(pattern):
    files = glob.glob(os.path.join(APP, pattern))
    return sorted(files, key=lambda f: int(re.findall(r"(\d+)\.\w+$", f)[0]))


def background():
    """Mesa de madeira procedural + manchas: textura sem relação com os alvos."""
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    grain = np.sin((x * 3 + y * 0.4 + rng.rand() * 5) * 40 + np.sin(y * 9 + rng.rand() * 3) * 3)
    base = np.array([150, 110, 75]) + rng.randint(-20, 20, 3)
    img = base[None, None, :] + grain[..., None] * 14 + rng.randn(H, W, 1) * 4
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))


def perspective_coeffs(src, dst):
    """Coeficientes para Image.transform(PERSPECTIVE): mapeia dst -> src."""
    a = []
    for (xs, ys), (xd, yd) in zip(src, dst):
        a.append([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd])
        a.append([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd])
    b = np.array(src).reshape(8)
    return np.linalg.solve(np.array(a, dtype=np.float64), b)


def frame(target, fill, tilt, angle, blur, light, noise):
    """fill: fração da altura do quadro ocupada pelo alvo."""
    img = target.convert("RGB")
    w, h = img.size
    aspect = w / h
    th = H * fill
    tw = th * aspect
    if tw > W * 0.95:
        tw = W * 0.95
        th = tw / aspect
    cx = W / 2 + rng.uniform(-0.12, 0.12) * W * (1 - fill)
    cy = H / 2 + rng.uniform(-0.12, 0.12) * H * (1 - fill)
    corners = np.array([[-tw / 2, -th / 2], [tw / 2, -th / 2], [tw / 2, th / 2], [-tw / 2, th / 2]])
    # inclinação: lado de cima mais estreito (celular inclinado em relação ao papel)
    corners[:2, 0] *= (1 - tilt)
    corners[:2, 1] *= (1 - tilt * 0.5)
    a = np.radians(angle)
    rot = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    dst = corners @ rot.T + [cx, cy]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = perspective_coeffs(src, [tuple(p) for p in dst])
    warped = img.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", img.size, 255).transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    out = background()
    out.paste(warped, (0, 0), mask)
    out = ImageEnhance.Brightness(out).enhance(light)
    # gradiente de luz (sombra da mão/celular)
    arr = np.asarray(out).astype(np.float64)
    shade = 1 - 0.25 * np.clip(np.linspace(-0.5, 1, W)[None, :] * rng.uniform(0.3, 1), 0, 1)
    arr *= shade[..., None]
    arr += rng.randn(H, W, 3) * noise
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if blur:
        out = out.filter(ImageFilter.GaussianBlur(blur))
    return out


VARIANTS = {
    # nome: (ocupação, inclinação, rotação, desfoque, luz, ruído)
    "frente": (0.82, 0.0, 3, 0.4, 1.0, 3),
    "inclinada": (0.75, 0.22, -12, 0.6, 0.9, 4),
    "longe": (0.45, 0.08, 20, 0.5, 1.05, 4),
    "escura": (0.7, 0.12, -25, 0.9, 0.62, 6),
}
CARD_VARIANTS = {
    "frente": (0.62, 0.0, 4, 0.4, 1.0, 3),
    "inclinada": (0.55, 0.2, -15, 0.6, 0.9, 4),
    "longe": (0.36, 0.08, 25, 0.5, 1.05, 4),
    "escura": (0.5, 0.12, -30, 0.9, 0.62, 6),
}

if __name__ == "__main__":
    for name, pattern, variants in [("paginas", "pag/Pagina*.png", VARIANTS),
                                    ("cartas", "cartas/carta*.png", CARD_VARIANTS)]:
        folder = os.path.join(OUT, name)
        os.makedirs(folder, exist_ok=True)
        files = numbered(pattern)
        for index, path in enumerate(files):
            target = Image.open(path)
            for vname, args in variants.items():
                frame(target, *args).save(os.path.join(folder, f"{index}_{vname}.jpg"), quality=88)
        print(f"{name}: {len(files)} alvos x {len(variants)} variantes -> {os.path.relpath(folder)}")
