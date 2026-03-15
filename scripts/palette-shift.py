#!/usr/bin/env python3
"""Batch palette-shift tileset PNGs to cyan tactical color scheme."""
from PIL import Image, ImageEnhance
import os, sys, colorsys, shutil

TARGET_HUE = 0.52  # cyan in HSV (187 degrees)

def shift_to_cyan(img_path, output_path):
    """Shift image hue TOWARD cyan (not rotate), darken for tactical feel."""
    img = Image.open(img_path).convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            h_val, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
            # Blend hue toward cyan target (70% toward cyan, keep 30% original)
            h_val = h_val * 0.3 + TARGET_HUE * 0.7
            s = min(s * 1.1, 1.0)
            v = v * 0.7  # darken for tactical feel
            r2, g2, b2 = colorsys.hsv_to_rgb(h_val, s, v)
            pixels[x, y] = (int(r2*255), int(g2*255), int(b2*255), a)
    img.save(output_path)
    print(f"  Shifted: {output_path}")

if __name__ == "__main__":
    src_dir = sys.argv[1] if len(sys.argv) > 1 else "frontend/assets/tilesets"
    # Backup originals first
    backup_dir = src_dir + "_originals"
    if not os.path.exists(backup_dir):
        shutil.copytree(src_dir, backup_dir)
        print(f"Backed up originals to {backup_dir}")
    count = 0
    for root, dirs, files in os.walk(src_dir):
        for f in files:
            if f.lower().endswith(('.png', '.webp')):
                path = os.path.join(root, f)
                shift_to_cyan(path, path)
                count += 1
    print(f"\nDone. {count} files shifted to cyan tactical palette.")
    print(f"Originals preserved in {backup_dir}")
