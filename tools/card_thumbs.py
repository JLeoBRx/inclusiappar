#!/usr/bin/env python3
"""Miniaturas das cartas para o Livro de Magias do Bichinho Virtual.

Lê inclusiapp/cartas/cartaN.png (as originais continuam intactas) e grava
inclusiapp/assets/img/cartas-mini/cartaN.webp com 120 px de largura
(≈ 5 KB cada, contra 100–500 KB das originais).

Ao adicionar cartas novas na pasta, rode de novo:
    python3 tools/card_thumbs.py      (requer Pillow com suporte a WebP)

Se faltar uma miniatura, o app mostra a carta original no lugar.
"""
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, "..", "inclusiapp"))
SRC = os.path.join(APP, "cartas")
OUT = os.path.join(APP, "assets", "img", "cartas-mini")
WIDTH = 120


def main():
    os.makedirs(OUT, exist_ok=True)
    names = [n for n in os.listdir(SRC) if re.fullmatch(r"carta\d+\.png", n, re.I)]
    names.sort(key=lambda n: int(re.search(r"\d+", n).group()))
    total = 0
    for name in names:
        img = Image.open(os.path.join(SRC, name)).convert("RGB")
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
        out = os.path.join(OUT, os.path.splitext(name)[0].lower() + ".webp")
        img.save(out, "WEBP", quality=78, method=6)
        total += os.path.getsize(out)
    print(f"{len(names)} miniaturas em {os.path.relpath(OUT, APP)} ({total // 1024} KB no total)")


if __name__ == "__main__":
    main()
