#!/usr/bin/env python3
"""Gera as versões web (WebP) das imagens decorativas do app.

As imagens originais continuam intactas nas pastas do projeto; este script
cria derivados leves em inclusiapp/assets/img/:

  vila-1920.webp / vila-1080.webp   fundo de Signária (original: 4961x3508, 13,8 MB)
  logo.webp                          logotipo SinalizaAção
  aia.webp                           protagonista, com as margens transparentes cortadas
  pagina-exemplo.webp                miniatura de página para a arte explicativa do livro
  carta-exemplo-*.webp               miniaturas de cartas para a arte explicativa do jogo
  icon-*.png                         ícones do app (PWA / tela inicial)

Uso: python3 tools/optimize_images.py   (requer Pillow com suporte a WebP)
"""
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, "..", "inclusiapp"))
OUT = os.path.join(APP, "assets", "img")


def save_webp(img, name, quality=80, **kw):
    path = os.path.join(OUT, name)
    img.save(path, "WEBP", quality=quality, method=6, **kw)
    print(f"{name:28s} {img.size[0]}x{img.size[1]:<5d} {os.path.getsize(path) // 1024:5d} KB")


def fit_width(img, width):
    if img.width <= width:
        return img
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)

    vila = Image.open(os.path.join(APP, "exemplo", "vila.jpg")).convert("RGB")
    save_webp(fit_width(vila, 1920), "vila-1920.webp", quality=72)
    save_webp(fit_width(vila, 1080), "vila-1080.webp", quality=72)

    logo = Image.open(os.path.join(APP, "exemplo", "logo.png")).convert("RGBA")
    save_webp(logo, "logo.webp", quality=92, alpha_quality=95)

    aia = Image.open(os.path.join(APP, "exemplo", "protagonista.png")).convert("RGBA")
    aia = aia.crop(aia.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox())
    save_webp(fit_width(aia, 520), "aia.webp", quality=85, alpha_quality=90)

    page = Image.open(os.path.join(APP, "pag", "Pagina2.png")).convert("RGB")
    save_webp(fit_width(page, 480), "pagina-exemplo.webp", quality=76)

    for n in (2, 7, 16):
        card = Image.open(os.path.join(APP, "cartas", f"carta{n}.png")).convert("RGB")
        save_webp(fit_width(card, 220), f"carta-exemplo-{n}.webp", quality=80)

    # Ícones: logotipo sobre um quadrado verde-floresta com cantos de "AR".
    for size in (180, 192, 512):
        icon = Image.new("RGBA", (size, size))
        draw = ImageDraw.Draw(icon)
        for y in range(size):  # degradê vertical
            t = y / (size - 1)
            color = tuple(round(a + (b - a) * t) for a, b in zip((44, 122, 62), (17, 64, 44))) + (255,)
            draw.line([(0, y), (size, y)], fill=color)
        m, L, w = size * 0.1, size * 0.16, max(2, round(size * 0.035))
        for cx, cy, dx, dy in ((m, m, 1, 1), (size - m, m, -1, 1), (m, size - m, 1, -1), (size - m, size - m, -1, -1)):
            draw.line([(cx, cy), (cx + dx * L, cy)], fill=(255, 214, 92, 255), width=w)
            draw.line([(cx, cy), (cx, cy + dy * L)], fill=(255, 214, 92, 255), width=w)
        mark = fit_width(logo, round(size * 0.84)) if logo.width > size * 0.84 else \
            logo.resize((round(size * 0.84), round(logo.height * size * 0.84 / logo.width)), Image.LANCZOS)
        shadow = Image.new("RGBA", mark.size, (0, 0, 0, 0))
        shadow.putalpha(mark.getchannel("A").point(lambda a: a * 0.45))
        shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.012))
        pos = ((size - mark.width) // 2, (size - mark.height) // 2)
        icon.alpha_composite(shadow, (pos[0], pos[1] + round(size * 0.012)))
        icon.alpha_composite(mark, pos)
        path = os.path.join(OUT, f"icon-{size}.png")
        icon.convert("RGB").save(path, optimize=True)
        print(f"icon-{size}.png{'':16s} {size}x{size:<5d} {os.path.getsize(path) // 1024:5d} KB")


if __name__ == "__main__":
    main()
