#!/usr/bin/env python3
"""Makes worst-case test photos (24–35 MB JPEGs, noise that barely compresses) and pushes them to
the connected Android device's gallery.

Usage: python3 scripts/make-test-photos.py [--no-push]      (needs: pip install pillow)
"""
import os, subprocess, sys
from PIL import Image, ImageChops

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test-photos')
ADB = os.path.expanduser('~/Library/Android/sdk/platform-tools/adb')

def make(name, w, h, quality, orientation=None):
    noise = Image.merge('RGB', [Image.effect_noise((w, h), 60) for _ in range(3)])
    gradient = Image.linear_gradient('L').resize((w, h)).convert('RGB')
    im = ImageChops.blend(noise, gradient, 0.35)
    exif = im.getexif()
    if orientation:
        exif[0x0112] = orientation  # 6 = "rotate 90°": the app must apply it
    path = os.path.join(OUT, name)
    im.save(path, quality=quality, exif=exif.tobytes())
    print(f'{name}: {os.path.getsize(path) / 1e6:.1f} MB, {w}x{h}')
    return path

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    photos = [
        make('site_huge_1.jpg', 8000, 6000, 92),
        make('site_huge_2_rotated.jpg', 8000, 6000, 90, orientation=6),
        make('site_big_3.jpg', 6000, 4500, 95),
        make('site_small_4.jpg', 2400, 1800, 70),
        make('site_big_5.jpg', 6000, 4500, 93),
    ]
    if '--no-push' not in sys.argv:
        for p in photos:
            name = os.path.basename(p)
            subprocess.run([ADB, 'push', p, '/sdcard/Pictures/'], check=True, capture_output=True)
            subprocess.run([ADB, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
                            '-d', f'file:///sdcard/Pictures/{name}'], capture_output=True)
        print('pushed to /sdcard/Pictures (open Gallery in the app to pick them)')
