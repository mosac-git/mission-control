#!/usr/bin/env python3
"""
Generate Shadow Collective HQ background image.

Side-view, horizontal-scroll multi-floor building.
Canvas: 1024x576 at 1x, rendered at 2x = 2048x1152 with NEAREST neighbor.
"""

import os
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
BG        = (10, 14, 20)
WALL      = (13, 21, 32)
BORDER    = (26, 42, 58)
CYAN      = (14, 165, 233)
GOLD      = (234, 179, 8)
RED       = (239, 68, 68)
PURPLE    = (168, 85, 247)
GREEN     = (34, 197, 94)
BLUE      = (59, 130, 246)
SILVER    = (148, 163, 184)
ORANGE    = (249, 115, 22)
PINK      = (236, 72, 153)
GREY      = (55, 65, 81)
WHITE     = (226, 232, 240)
DIM_WHITE = (100, 116, 139)

W, H = 1024, 576

# ---------------------------------------------------------------------------
# Room definitions per floor
# ---------------------------------------------------------------------------
UPPER_Y, UPPER_H = 0, 180
LOWER_Y, LOWER_H = 196, 180
BASEMENT_Y, BASEMENT_H = 384, 180

ROOMS = {
    "upper": [
        {"name": "CEO Suite",         "label": "SHADOW",                         "x": 0,   "w": 128, "accent": GOLD,   "y": UPPER_Y, "h": UPPER_H},
        {"name": "Chief of Staff",    "label": "NEXUS",                          "x": 136, "w": 128, "accent": GOLD,   "y": UPPER_Y, "h": UPPER_H},
        {"name": "Operations Center", "label": "FORGE / WARDEN / STACK",         "x": 272, "w": 256, "accent": RED,    "y": UPPER_Y, "h": UPPER_H},
        {"name": "Intelligence Lab",  "label": "ATLAS / ORACLE",                 "x": 536, "w": 192, "accent": CYAN,   "y": UPPER_Y, "h": UPPER_H},
        {"name": "Creative Studio",   "label": "CANVAS / INK",                   "x": 736, "w": 280, "accent": PURPLE, "y": UPPER_Y, "h": UPPER_H},
    ],
    "lower": [
        {"name": "Business District", "label": "LEDGER / APEX / FOUNDRY / MERCHANT", "x": 0,   "w": 256, "accent": GREEN,  "y": LOWER_Y, "h": LOWER_H},
        {"name": "External Affairs",  "label": "DIPLOMAT / WIRE",                     "x": 264, "w": 192, "accent": BLUE,   "y": LOWER_Y, "h": LOWER_H},
        {"name": "Governance",        "label": "JURIS",                               "x": 464, "w": 128, "accent": SILVER, "y": LOWER_Y, "h": LOWER_H},
        {"name": "Personal Office",   "label": "RYDER",                               "x": 600, "w": 128, "accent": ORANGE, "y": LOWER_Y, "h": LOWER_H},
        {"name": "People & Knowledge","label": "HARMONY / ARCHIVE",                   "x": 736, "w": 280, "accent": PINK,   "y": LOWER_Y, "h": LOWER_H},
    ],
    "basement": [
        {"name": "Conference Room",   "label": "ALL AGENTS",   "x": 0,   "w": 256, "accent": CYAN,  "y": BASEMENT_Y, "h": BASEMENT_H},
        {"name": "Activity Board",    "label": "WALL DISPLAY", "x": 264, "w": 200, "accent": CYAN,  "y": BASEMENT_Y, "h": BASEMENT_H},
        {"name": "Lounge",            "label": "IDLE AGENTS",  "x": 472, "w": 240, "accent": GREY,  "y": BASEMENT_Y, "h": BASEMENT_H},
        {"name": "Armory",            "label": "EQUIPMENT",    "x": 720, "w": 296, "accent": GREY,  "y": BASEMENT_Y, "h": BASEMENT_H},
    ],
}

# ---------------------------------------------------------------------------
# Helper: dim a colour for dark furniture
# ---------------------------------------------------------------------------

def dim(color, factor=0.25):
    return tuple(int(c * factor) for c in color)


def glow(color, factor=0.45):
    return tuple(min(255, int(c * factor)) for c in color)

# ---------------------------------------------------------------------------
# Draw a single desk with monitor
# ---------------------------------------------------------------------------

def draw_desk(draw, x, y, accent, desk_w=20, desk_h=6):
    """Draw a small desk with a monitor on top."""
    # Desk surface
    draw.rectangle([x, y, x + desk_w, y + desk_h], fill=dim(accent, 0.35), outline=BORDER)
    # Monitor stand
    stand_x = x + desk_w // 2
    draw.line([stand_x, y - 1, stand_x, y - 4], fill=BORDER)
    # Monitor screen
    mw, mh = 10, 7
    mx = x + (desk_w - mw) // 2
    my = y - 4 - mh
    draw.rectangle([mx, my, mx + mw, my + mh], fill=dim(accent, 0.5), outline=accent)
    # Screen glint (1px highlight)
    draw.rectangle([mx + 1, my + 1, mx + mw - 2, my + 2], fill=glow(accent, 0.7))


def draw_chair(draw, x, y, accent):
    """Draw a tiny chair (side view)."""
    # Seat
    draw.rectangle([x, y, x + 6, y + 3], fill=dim(accent, 0.3))
    # Back
    draw.rectangle([x, y - 5, x + 2, y], fill=dim(accent, 0.3))


def draw_shelf(draw, x, y, w, accent):
    """Draw a wall shelf with items."""
    draw.rectangle([x, y, x + w, y + 2], fill=BORDER)
    # Small items on shelf
    for i in range(0, w - 4, 6):
        item_h = 3 + (i % 5)
        draw.rectangle([x + i + 1, y - item_h, x + i + 4, y], fill=dim(accent, 0.4))


def draw_conference_table(draw, x, y, w, accent):
    """Draw a long conference table."""
    draw.rectangle([x, y, x + w, y + 8], fill=dim(accent, 0.3), outline=BORDER)
    # Chairs around the table
    for cx in range(x + 8, x + w - 8, 14):
        draw_chair(draw, cx, y - 4, accent)
        draw_chair(draw, cx, y + 12, accent)


def draw_board(draw, x, y, w, h, accent):
    """Draw a wall-mounted activity board."""
    draw.rectangle([x, y, x + w, y + h], fill=dim(accent, 0.2), outline=accent)
    # Sticky-note-like items
    colours = [CYAN, GREEN, ORANGE, PINK, RED, BLUE]
    col = 0
    for bx in range(x + 3, x + w - 8, 12):
        for by in range(y + 3, y + h - 8, 10):
            c = colours[col % len(colours)]
            draw.rectangle([bx, by, bx + 8, by + 6], fill=dim(c, 0.6))
            col += 1


def draw_couch(draw, x, y, accent):
    """Draw a couch for the lounge."""
    # Base
    draw.rectangle([x, y, x + 24, y + 8], fill=dim(accent, 0.4), outline=BORDER)
    # Back
    draw.rectangle([x, y - 6, x + 24, y], fill=dim(accent, 0.35), outline=BORDER)
    # Arm rests
    draw.rectangle([x - 2, y - 8, x + 2, y + 8], fill=dim(accent, 0.3))
    draw.rectangle([x + 22, y - 8, x + 26, y + 8], fill=dim(accent, 0.3))


def draw_rack(draw, x, y, h, accent):
    """Draw an equipment rack for the armory."""
    draw.rectangle([x, y, x + 12, y + h], fill=dim(accent, 0.3), outline=BORDER)
    # Horizontal rack shelves
    for ry in range(y + 6, y + h - 2, 8):
        draw.line([x + 1, ry, x + 11, ry], fill=BORDER)
        draw.rectangle([x + 2, ry - 4, x + 10, ry - 1], fill=dim(accent, 0.5))


# ---------------------------------------------------------------------------
# Draw props for a specific room type
# ---------------------------------------------------------------------------

def draw_room_props(draw, room):
    x, y, w, h = room["x"], room["y"], room["w"], room["h"]
    accent = room["accent"]
    name = room["name"]

    floor_y = y + h - 14  # floor line position

    if name == "Conference Room":
        draw_conference_table(draw, x + 40, y + 70, w - 80, accent)
        draw_shelf(draw, x + 10, y + 30, 60, accent)
        return

    if name == "Activity Board":
        draw_board(draw, x + 16, y + 24, w - 32, h - 60, accent)
        return

    if name == "Lounge":
        draw_couch(draw, x + 20, floor_y - 20, accent)
        draw_couch(draw, x + 80, floor_y - 20, accent)
        draw_couch(draw, x + 150, floor_y - 20, accent)
        # Small table
        draw.rectangle([x + 56, floor_y - 12, x + 72, floor_y - 6], fill=dim(accent, 0.35), outline=BORDER)
        return

    if name == "Armory":
        for rx in range(x + 16, x + w - 20, 22):
            draw_rack(draw, rx, y + 30, h - 60, accent)
        return

    # --- Default: office rooms with desks ---
    desk_y = floor_y - 10
    num_desks = max(1, w // 50)
    spacing = w // (num_desks + 1)
    for i in range(num_desks):
        dx = x + spacing * (i + 1) - 10
        draw_desk(draw, dx, desk_y, accent)
        draw_chair(draw, dx + 4, desk_y + 10, accent)

    # Shelf on wall
    if w >= 120:
        draw_shelf(draw, x + 10, y + 30, min(60, w - 20), accent)


# ---------------------------------------------------------------------------
# Draw a room outline and accent bar
# ---------------------------------------------------------------------------

def draw_room(draw, room):
    x, y, w, h = room["x"], room["y"], room["w"], room["h"]
    accent = room["accent"]

    # Room background fill
    draw.rectangle([x + 1, y + 1, x + w - 1, y + h - 1], fill=WALL)

    # Border
    draw.rectangle([x, y, x + w, y + h], outline=BORDER)

    # Accent line at top (3px thick)
    for t in range(3):
        draw.line([x + 1, y + 1 + t, x + w - 1, y + 1 + t], fill=accent)

    # Floor line
    floor_y = y + h - 14
    draw.line([x + 4, floor_y, x + w - 4, floor_y], fill=dim(accent, 0.5))

    # Floor tiles / texture
    for tx in range(x + 8, x + w - 8, 16):
        draw.line([tx, floor_y + 1, tx, floor_y + 4], fill=dim(BORDER, 0.6))

    # Room name label (top-left, below accent line)
    draw.text((x + 4, y + 6), room["name"].upper(), fill=accent)

    # Agent label (smaller, below name)
    draw.text((x + 4, y + 16), room["label"], fill=DIM_WHITE)

    # Room props
    draw_room_props(draw, room)


# ---------------------------------------------------------------------------
# Draw floor dividers and labels
# ---------------------------------------------------------------------------

def draw_floor_dividers(draw):
    # Horizontal divider lines between floors
    for div_y in [UPPER_Y + UPPER_H + 2, LOWER_Y + LOWER_H + 2]:
        for dx in range(0, W, 4):
            draw.line([dx, div_y, dx + 2, div_y], fill=BORDER)

    # Floor labels (left edge, rotated text not easy -- use horizontal)
    labels = [
        ("UPPER DECK", UPPER_Y + UPPER_H // 2 - 4),
        ("LOWER DECK", LOWER_Y + LOWER_H // 2 - 4),
        ("BASEMENT",   BASEMENT_Y + BASEMENT_H // 2 - 4),
    ]
    # We'll draw them vertically by stacking characters
    for label, cy in labels:
        # Actually draw them as small vertical text at x=2
        char_y = cy - len(label) * 4
        for i, ch in enumerate(label):
            draw.text((2, char_y + i * 8), ch, fill=DIM_WHITE)


# ---------------------------------------------------------------------------
# Draw elevator shaft
# ---------------------------------------------------------------------------

def draw_elevator(draw):
    """Thin vertical elevator shaft spanning all floors."""
    ex = 130  # Between CEO Suite and Chief of Staff gap area
    ew = 4

    # Shaft runs the full height
    for fy in range(0, H - 12):
        if fy % 6 < 4:
            draw.line([ex, fy, ex, fy], fill=dim(CYAN, 0.3))
            draw.line([ex + ew, fy, ex + ew, fy], fill=dim(CYAN, 0.3))

    # Floor connection dots
    for fy in [UPPER_Y + UPPER_H, LOWER_Y, LOWER_Y + LOWER_H, BASEMENT_Y]:
        draw.rectangle([ex - 1, fy - 2, ex + ew + 1, fy + 2], fill=dim(CYAN, 0.5), outline=CYAN)

    # Elevator car
    car_y = LOWER_Y + 40
    draw.rectangle([ex - 1, car_y, ex + ew + 1, car_y + 14], fill=dim(CYAN, 0.4), outline=CYAN)


# ---------------------------------------------------------------------------
# Draw HQ title bar
# ---------------------------------------------------------------------------

def draw_title_bar(draw):
    bar_y = H - 12
    draw.rectangle([0, bar_y, W, H], fill=(8, 10, 15))
    draw.line([0, bar_y, W, bar_y], fill=BORDER)

    draw.text((8, bar_y + 2), "SHADOW COLLECTIVE HQ v3.0", fill=CYAN)
    # Right-aligned label
    draw.text((W - 130, bar_y + 2), "MISSION CONTROL", fill=DIM_WHITE)


# ---------------------------------------------------------------------------
# Ambient details: scan lines, glow dots
# ---------------------------------------------------------------------------

def draw_ambience(draw):
    """Subtle scan-line overlay and glow dots on walls."""
    import random
    random.seed(42)  # deterministic
    # Faint horizontal scan lines every 4px
    for sy in range(0, H - 12, 4):
        draw.line([0, sy, W, sy], fill=(255, 255, 255, 3))  # nearly invisible in RGBA

    # Tiny glow dots scattered in rooms
    for _ in range(80):
        gx = random.randint(10, W - 10)
        gy = random.randint(10, H - 20)
        draw.point((gx, gy), fill=dim(CYAN, 0.15))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Try to load a small built-in font; fall back to default
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 8)
        draw.font = font
    except (OSError, IOError):
        pass  # use Pillow default bitmap font

    # Draw all rooms
    for floor_key in ("upper", "lower", "basement"):
        for room in ROOMS[floor_key]:
            draw_room(draw, room)

    draw_floor_dividers(draw)
    draw_elevator(draw)
    draw_title_bar(draw)
    draw_ambience(draw)

    # Scale to 2x with NEAREST neighbor for pixel-art look
    img2x = img.resize((2048, 1152), Image.NEAREST)

    # Save
    out_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "assets", "backgrounds")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "hq-bg.png")
    img2x.save(out_path)
    print(f"Saved HQ background to {os.path.abspath(out_path)}")
    print(f"Dimensions: {img2x.size[0]}x{img2x.size[1]}")


if __name__ == "__main__":
    main()
