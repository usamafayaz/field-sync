#!/usr/bin/env python3
"""Draws the FieldSync icon, splash and in-app logo with Pillow and writes them into the project.

Usage: python3 scripts/generate-icons.py      (needs: pip install pillow)
"""
import os
from PIL import Image, ImageDraw
INK=(27,36,32,255); GREEN=(30,215,96,255); FOLD=(23,156,71,255); S=4

def mark(d, cx, cy, size, sheet=GREEN, cut=INK, behind=INK):
    """A report sheet with a folded corner; an upload arrow and two text lines cut out of it."""
    w, h = size*0.66, size*0.84
    x0, y0, x1, y1 = cx-w/2, cy-h/2, cx+w/2, cy+h/2
    rad, fold = size*0.075, size*0.20
    # sheet body, minus the top-right corner
    d.rounded_rectangle([x0, y0, x1, y1], radius=rad, fill=sheet)
    d.polygon([(x1-fold, y0-1), (x1+1, y0-1), (x1+1, y0+fold)], fill=behind)
    d.polygon([(x1-fold, y0), (x1, y0+fold), (x1-fold, y0+fold)], fill=FOLD)  # the fold
    sw = size*0.085  # stroke
    ax, atop = cx - size*0.02, y0 + h*0.25
    abot = y0 + h*0.56
    ch = size*0.13
    d.line([(ax-ch, atop+ch), (ax, atop), (ax+ch, atop+ch)], fill=cut, width=int(sw), joint='curve')
    d.line([(ax, atop+sw*0.2), (ax, abot)], fill=cut, width=int(sw))
    r = sw/2
    for (x, y) in [(ax-ch, atop+ch), (ax+ch, atop+ch), (ax, abot), (ax, atop)]:
        d.ellipse([x-r, y-r, x+r, y+r], fill=cut)
    lx = x0 + w*0.20
    for i, frac in enumerate((0.60, 0.38)):
        y = y0 + h*0.72 + i*sw*1.75
        d.rounded_rectangle([lx, y-r, lx + w*frac, y+r], radius=r, fill=cut)

def tile(px, shape):
    big = px*S; im = Image.new('RGBA', (big, big), (0,0,0,0)); d = ImageDraw.Draw(im)
    if shape == 'round': d.ellipse([0,0,big-1,big-1], fill=INK); k = 0.56
    elif shape == 'square': d.rounded_rectangle([0,0,big-1,big-1], radius=big*0.22, fill=INK); k = 0.62
    else: d.rectangle([0,0,big,big], fill=INK); k = 0.62
    mark(d, big/2, big/2, big*k)
    return im.resize((px, px), Image.LANCZOS)

def foreground(px):  # adaptive layer: 108dp canvas, art inside the 66dp safe circle
    big = px*S; im = Image.new('RGBA', (big, big), (0,0,0,0)); d = ImageDraw.Draw(im)
    mark(d, big/2, big/2, big*0.46, behind=(0,0,0,0))
    return im.resize((px, px), Image.LANCZOS)


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android/app/src/main/res')
ASSETS = os.path.join(ROOT, 'src/ui/assets')

if __name__ == '__main__':
    for name, k in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
        d = f'{RES}/mipmap-{name}'
        os.makedirs(d, exist_ok=True)
        tile(int(48 * k), 'square').save(f'{d}/ic_launcher.png')
        tile(int(48 * k), 'round').save(f'{d}/ic_launcher_round.png')
        foreground(int(108 * k)).save(f'{d}/ic_launcher_foreground.png')
    # Android 12 splash icon: 288dp canvas, visible circle 192dp. Drawn at xxxhdpi.
    px = 288 * 4; big = px * S
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    mark(ImageDraw.Draw(im), big / 2, big / 2, big * 0.36, behind=(0, 0, 0, 0))
    os.makedirs(f'{RES}/drawable-xxxhdpi', exist_ok=True)
    im.resize((px, px), Image.LANCZOS).save(f'{RES}/drawable-xxxhdpi/splash_logo.png')
    # In-app loading-screen logo, 96dp at @1x/@2x/@3x.
    os.makedirs(ASSETS, exist_ok=True)
    for k, suffix in ((1, ''), (2, '@2x'), (3, '@3x')):
        p = int(96 * k); bg = p * S
        im = Image.new('RGBA', (bg, bg), (0, 0, 0, 0))
        mark(ImageDraw.Draw(im), bg / 2, bg / 2, bg * 0.92, behind=(0, 0, 0, 0))
        im.resize((p, p), Image.LANCZOS).save(f'{ASSETS}/logo{suffix}.png')
    print('icons, splash and logo written')
