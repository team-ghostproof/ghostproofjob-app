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
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
SRC = os.path.join(ASSETS, "logo-mark.png")
PLUM = (18, 15, 29, 255)   # Midnight Plum #120F1D
MINT = (0, 245, 160)       # Digital Mint Green #00F5A0 — the .ghost-glow colour


def load_src():
    im = Image.open(SRC).convert("RGBA")
    return im


def _mint_glow(ghost_full, size, blur_frac=0.11, intensity=1.6):
    """A soft mint halo behind the ghost — bakes in the on-page CSS
    filter:drop-shadow(0 0 6px var(--mint)) so the icon matches the logo."""
    glow = Image.new("RGBA", (size, size), MINT + (0,))
    glow.putalpha(ghost_full.split()[3])           # halo has the ghost's silhouette
    r = max(1, int(round(size * blur_frac)))
    glow = glow.filter(ImageFilter.GaussianBlur(r))
    a = glow.split()[3].point(lambda v: min(255, int(v * intensity)))
    glow.putalpha(a)
    return glow


def _trim(im):
    """Crop the source to its opaque bounding box so the ghost fills the frame
    (logo-mark.png has a big transparent margin that made the tab icon look tiny)."""
    bbox = im.split()[3].getbbox()
    return im.crop(bbox) if bbox else im


def _placed(src, size, inner_frac):
    """Trimmed ghost fit (aspect-preserving) to inner_frac of the canvas, centered
    on a transparent full-size layer. inner_frac < 1 leaves room for the glow."""
    inner = max(1, int(round(size * inner_frac)))
    g = _trim(src)
    w, h = g.size
    scale = inner / max(w, h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    ghost = g.resize((nw, nh), Image.LANCZOS)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.alpha_composite(ghost, ((size - nw) // 2, (size - nh) // 2))
    return layer


def resize_transparent(src, size):
    """Transparent icon WITH the mint glow baked in (browser tab + PWA). The ghost
    fills ~92% of the frame; the soft glow occupies the small remaining margin."""
    ghost = _placed(src, size, 0.92)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(_mint_glow(ghost, size, blur_frac=0.07, intensity=1.7))
    out.alpha_composite(ghost)
    return out


def on_brand_bg(src, size, pad_frac):
    """Ghost + mint glow centered on the plum brand bg (iOS/Android home screens)."""
    canvas = Image.new("RGBA", (size, size), PLUM)
    ghost = _placed(src, size, 1 - 2 * pad_frac)
    canvas.alpha_composite(_mint_glow(ghost, size, blur_frac=0.06, intensity=1.3))
    canvas.alpha_composite(ghost)
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
    # a multi-size favicon.ico for bare /favicon.ico requests (transparent + glow)
    ico = os.path.join(ASSETS, "favicon.ico")
    ico48 = resize_transparent(src, 48)
    ico48.save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  wrote favicon.ico             multi-size ({os.path.getsize(ico)} bytes)")
    print("done.")


if __name__ == "__main__":
    main()
