#!/usr/bin/env python3
"""Regenerate every brand icon from assets/logo-mark.png (the transparent ghost).

Browser-tab + PWA icons keep the transparent background (the ghost has a dark
outline, so it stays legible on light AND dark browser chrome). The iOS
apple-touch icon and the Android maskable icon are flattened onto the Midnight
Plum brand background with padding, because a transparent PNG renders as a black
square on an iOS home screen and Android masks the corners.

Run:  python scripts/build_icons.py   (needs Pillow)
Rerun whenever assets/logo-mark.png changes.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
SRC = os.path.join(ASSETS, "logo-mark.png")
PLUM = (18, 15, 29, 255)  # Midnight Plum #120F1D


def load_src():
    im = Image.open(SRC).convert("RGBA")
    return im


def resize_transparent(src, size):
    return src.resize((size, size), Image.LANCZOS)


def on_brand_bg(src, size, pad_frac):
    """Ghost centered on the plum brand bg, with pad_frac padding each side."""
    canvas = Image.new("RGBA", (size, size), PLUM)
    inner = max(1, int(round(size * (1 - 2 * pad_frac))))
    ghost = src.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.paste(ghost, (off, off), ghost)  # alpha-composite the ghost
    return canvas


def save(im, name):
    path = os.path.join(ASSETS, name)
    im.save(path, "PNG")
    print(f"  wrote {name:26s} {im.size[0]}x{im.size[1]}  ({os.path.getsize(path)} bytes)")


def main():
    src = load_src()
    print(f"source: logo-mark.png {src.size} {src.mode}")
    # transparent (browser tab + PWA)
    save(resize_transparent(src, 32), "favicon-32.png")
    save(resize_transparent(src, 192), "icon-192.png")
    save(resize_transparent(src, 512), "icon-512.png")
    # brand-background (home screens)
    save(on_brand_bg(src, 180, 0.08), "apple-touch-icon.png")
    save(on_brand_bg(src, 512, 0.18), "icon-maskable-512.png")
    # a multi-size favicon.ico for bare /favicon.ico requests (transparent)
    ico = os.path.join(ASSETS, "favicon.ico")
    src.save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  wrote favicon.ico             multi-size ({os.path.getsize(ico)} bytes)")
    print("done.")


if __name__ == "__main__":
    main()
