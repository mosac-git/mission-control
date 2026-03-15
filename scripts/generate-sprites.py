#!/usr/bin/env python3
"""
Generate 16x32 pixel-art robot spritesheets for 19 Shadow Collective agents.

Each spritesheet contains 10 animation frames laid out horizontally:
  idle_1, idle_2, working_1, working_2, working_3, working_4,
  walking_1, walking_2, walking_3, walking_4

Output is saved at 2x scale (32x64 per frame, 320x64 per sheet) using
NEAREST-neighbor resampling to preserve crisp pixel art.
"""

from pathlib import Path
from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# Agent definitions
# ---------------------------------------------------------------------------
AGENTS = {
    "shadow":   {"color": (245, 158, 11),  "head": "humanoid",      "phase": 1},
    "nexus":    {"color": (245, 158, 11),  "head": "orbital_ring",   "phase": 1},
    "forge":    {"color": (239, 68,  68),  "head": "diamond",        "phase": 1},
    "warden":   {"color": (239, 68,  68),  "head": "hex_shield",     "phase": 1},
    "stack":    {"color": (239, 68,  68),  "head": "code_block",     "phase": 1},
    "atlas":    {"color": (34,  211, 238), "head": "scanning_eye",   "phase": 1},
    "ink":      {"color": (34,  211, 238), "head": "prism",          "phase": 1},
    "canvas":   {"color": (168, 85,  247), "head": "spectrum_ring",  "phase": 2},
    "ledger":   {"color": (16,  185, 129), "head": "vault",          "phase": 2},
    "wire":     {"color": (59,  130, 246), "head": "node_cluster",   "phase": 2},
    "juris":    {"color": (148, 163, 184), "head": "scales",         "phase": 2},
    "diplomat": {"color": (59,  130, 246), "head": "compass",        "phase": 2},
    "ryder":    {"color": (249, 115, 22),  "head": "rocket",         "phase": 2},
    "oracle":   {"color": (34,  211, 238), "head": "reticle",        "phase": 3},
    "apex":     {"color": (16,  185, 129), "head": "trend_arrows",   "phase": 3},
    "foundry":  {"color": (16,  185, 129), "head": "gear",           "phase": 3},
    "merchant": {"color": (16,  185, 129), "head": "barcode",        "phase": 3},
    "harmony":  {"color": (236, 72,  153), "head": "heart",          "phase": 4},
    "archive":  {"color": (236, 72,  153), "head": "infinity",       "phase": 4},
}

# Sprite dimensions (1x)
SPRITE_W = 16
SPRITE_H = 32
HEAD_H = 10      # top 10 rows are the head area
BODY_TOP = 10    # body starts at row 10
SCALE = 2        # output at 2x

FRAME_NAMES = [
    "idle_1", "idle_2",
    "working_1", "working_2", "working_3", "working_4",
    "walking_1", "walking_2", "walking_3", "walking_4",
]
NUM_FRAMES = len(FRAME_NAMES)

# Palette
CHASSIS_DARK  = (40, 40, 48)
CHASSIS_MID   = (55, 55, 65)
CHASSIS_LIGHT = (70, 70, 82)
EYE_GLOW      = (200, 220, 255)
SKIN_TONE     = (210, 170, 130)
SKIN_SHADOW   = (180, 140, 100)
HAIR_COLOR    = (50, 40, 35)

# ---------------------------------------------------------------------------
# Head drawing helpers -- each draws into the 16x10 head region
# ---------------------------------------------------------------------------

def _draw_humanoid_head(draw: ImageDraw.Draw, x0: int, y0: int, color: tuple):
    """SHADOW only -- simple person silhouette head."""
    # Hair / top of head
    draw.rectangle([x0 + 5, y0 + 0, x0 + 10, y0 + 1], fill=HAIR_COLOR)
    draw.rectangle([x0 + 4, y0 + 1, x0 + 11, y0 + 2], fill=HAIR_COLOR)
    # Face
    draw.rectangle([x0 + 4, y0 + 2, x0 + 11, y0 + 7], fill=SKIN_TONE)
    draw.rectangle([x0 + 4, y0 + 7, x0 + 11, y0 + 8], fill=SKIN_SHADOW)
    # Eyes
    draw.point((x0 + 6, y0 + 4), fill=(40, 40, 40))
    draw.point((x0 + 9, y0 + 4), fill=(40, 40, 40))
    # Neck
    draw.rectangle([x0 + 6, y0 + 8, x0 + 9, y0 + 9], fill=SKIN_SHADOW)


def _draw_diamond_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 4
    pts = [(cx, cy - 4), (cx + 4, cy), (cx, cy + 4), (cx - 4, cy)]
    draw.polygon(pts, fill=CHASSIS_MID, outline=color)
    draw.point((cx - 1, cy), fill=EYE_GLOW)
    draw.point((cx + 1, cy), fill=EYE_GLOW)


def _draw_hex_shield_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 5
    r = 4
    import math
    pts = []
    for i in range(6):
        angle = math.radians(60 * i - 90)
        pts.append((int(cx + r * math.cos(angle)), int(cy + r * math.sin(angle))))
    draw.polygon(pts, fill=CHASSIS_MID, outline=color)
    draw.point((cx - 1, cy), fill=EYE_GLOW)
    draw.point((cx + 1, cy), fill=EYE_GLOW)


def _draw_code_block_head(draw, x0, y0, color):
    draw.rectangle([x0 + 3, y0 + 1, x0 + 12, y0 + 8], fill=CHASSIS_MID, outline=color)
    # </> symbol
    draw.line([(x0 + 5, y0 + 3), (x0 + 4, y0 + 5), (x0 + 5, y0 + 7)], fill=color)
    draw.line([(x0 + 10, y0 + 3), (x0 + 11, y0 + 5), (x0 + 10, y0 + 7)], fill=color)
    draw.line([(x0 + 8, y0 + 3), (x0 + 7, y0 + 7)], fill=color)


def _draw_orbital_ring_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 5
    draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], outline=color)
    draw.point((cx, cy), fill=EYE_GLOW)
    # ring around it
    draw.arc([cx - 6, cy - 2, cx + 6, cy + 2], 0, 360, fill=color)


def _draw_scanning_eye_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 5
    draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=CHASSIS_MID, outline=color)
    draw.line([(cx - 4, cy), (cx + 4, cy)], fill=color)
    draw.point((cx, cy), fill=EYE_GLOW)
    draw.point((cx - 1, cy), fill=EYE_GLOW)
    draw.point((cx + 1, cy), fill=EYE_GLOW)


def _draw_prism_head(draw, x0, y0, color):
    pts = [(x0 + 7, y0 + 1), (x0 + 12, y0 + 9), (x0 + 3, y0 + 9)]
    draw.polygon(pts, fill=CHASSIS_MID, outline=color)
    draw.point((x0 + 7, y0 + 5), fill=EYE_GLOW)


def _draw_spectrum_ring_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 5
    rainbow = [(255, 0, 0), (255, 165, 0), (255, 255, 0),
               (0, 255, 0), (0, 0, 255), (75, 0, 130)]
    for i, c in enumerate(rainbow):
        start = i * 60
        draw.arc([cx - 4, cy - 4, cx + 4, cy + 4], start, start + 60, fill=c)
    draw.point((cx, cy), fill=EYE_GLOW)


def _draw_vault_head(draw, x0, y0, color):
    draw.rectangle([x0 + 3, y0 + 1, x0 + 12, y0 + 8], fill=CHASSIS_MID, outline=color)
    # $ symbol -- vertical line with S-curve
    draw.line([(x0 + 7, y0 + 2), (x0 + 7, y0 + 7)], fill=color)
    draw.line([(x0 + 6, y0 + 3), (x0 + 9, y0 + 3)], fill=color)
    draw.line([(x0 + 6, y0 + 5), (x0 + 9, y0 + 5)], fill=color)
    draw.line([(x0 + 5, y0 + 4), (x0 + 6, y0 + 4)], fill=color)
    draw.line([(x0 + 9, y0 + 6), (x0 + 10, y0 + 6)], fill=color)


def _draw_node_cluster_head(draw, x0, y0, color):
    nodes = [(x0 + 7, y0 + 3), (x0 + 4, y0 + 6), (x0 + 10, y0 + 6),
             (x0 + 5, y0 + 1), (x0 + 10, y0 + 2)]
    # connections
    for i in range(len(nodes) - 1):
        draw.line([nodes[i], nodes[i + 1]], fill=CHASSIS_LIGHT)
    draw.line([nodes[0], nodes[-1]], fill=CHASSIS_LIGHT)
    # dots
    for n in nodes:
        draw.point(n, fill=color)
        draw.point((n[0], n[1]), fill=color)


def _draw_scales_head(draw, x0, y0, color):
    cx = x0 + 7
    # vertical post
    draw.line([(cx, y0 + 1), (cx, y0 + 5)], fill=color)
    # horizontal bar
    draw.line([(x0 + 3, y0 + 3), (x0 + 12, y0 + 3)], fill=color)
    # left pan (arc hanging down)
    draw.arc([x0 + 2, y0 + 4, x0 + 6, y0 + 8], 0, 180, fill=color)
    # right pan
    draw.arc([x0 + 9, y0 + 4, x0 + 13, y0 + 8], 0, 180, fill=color)
    # fulcrum
    draw.point((cx, y0 + 1), fill=EYE_GLOW)


def _draw_compass_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 5
    draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=CHASSIS_MID, outline=color)
    # diamond pointer (north)
    pts = [(cx, cy - 3), (cx + 1, cy), (cx, cy + 1), (cx - 1, cy)]
    draw.polygon(pts, fill=color)
    draw.point((cx, cy - 3), fill=EYE_GLOW)


def _draw_rocket_head(draw, x0, y0, color):
    cx = x0 + 7
    # pointed nose
    draw.point((cx, y0 + 0), fill=color)
    draw.line([(cx - 1, y0 + 1), (cx + 1, y0 + 1)], fill=color)
    # body
    draw.rectangle([cx - 2, y0 + 2, cx + 2, y0 + 7], fill=CHASSIS_MID, outline=color)
    # fins
    draw.point((cx - 3, y0 + 7), fill=color)
    draw.point((cx + 3, y0 + 7), fill=color)
    draw.point((cx - 3, y0 + 8), fill=color)
    draw.point((cx + 3, y0 + 8), fill=color)
    # window
    draw.point((cx, y0 + 4), fill=EYE_GLOW)


def _draw_reticle_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 5
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], outline=color)
    # crosshair
    draw.line([(cx, cy - 5), (cx, cy + 5)], fill=color)
    draw.line([(cx - 5, cy), (cx + 5, cy)], fill=color)
    draw.point((cx, cy), fill=EYE_GLOW)


def _draw_trend_arrows_head(draw, x0, y0, color):
    # up arrow
    draw.line([(x0 + 5, y0 + 8), (x0 + 5, y0 + 2)], fill=color)
    draw.point((x0 + 4, y0 + 3), fill=color)
    draw.point((x0 + 6, y0 + 3), fill=color)
    # down arrow
    draw.line([(x0 + 10, y0 + 2), (x0 + 10, y0 + 8)], fill=color)
    draw.point((x0 + 9, y0 + 7), fill=color)
    draw.point((x0 + 11, y0 + 7), fill=color)


def _draw_gear_head(draw, x0, y0, color):
    cx, cy = x0 + 7, y0 + 5
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=CHASSIS_MID, outline=color)
    # teeth (4 cardinal + 4 diagonal)
    for dx, dy in [(-4, 0), (4, 0), (0, -4), (0, 4),
                   (-3, -3), (3, -3), (-3, 3), (3, 3)]:
        draw.point((cx + dx, cy + dy), fill=color)
    draw.point((cx, cy), fill=EYE_GLOW)


def _draw_barcode_head(draw, x0, y0, color):
    draw.rectangle([x0 + 3, y0 + 1, x0 + 12, y0 + 8], fill=CHASSIS_MID)
    # vertical bars
    for bx in [4, 5, 7, 8, 10, 11]:
        draw.line([(x0 + bx, y0 + 2), (x0 + bx, y0 + 7)], fill=color)


def _draw_heart_head(draw, x0, y0, color):
    # pixelated heart
    heart_rows = [
        (5, 6, 9, 10),         # row 2: two bumps
        (4, 5, 6, 7, 8, 9, 10, 11),  # row 3
        (4, 5, 6, 7, 8, 9, 10, 11),  # row 4
        (5, 6, 7, 8, 9, 10),         # row 5
        (6, 7, 8, 9),                # row 6
        (7, 8),                       # row 7
    ]
    for ri, cols in enumerate(heart_rows):
        for c in cols:
            draw.point((x0 + c, y0 + 2 + ri), fill=color)
    draw.point((x0 + 7, y0 + 4), fill=EYE_GLOW)


def _draw_infinity_head(draw, x0, y0, color):
    # figure-8 from two small ellipses
    draw.arc([x0 + 2, y0 + 3, x0 + 8, y0 + 8], 0, 360, fill=color)
    draw.arc([x0 + 7, y0 + 3, x0 + 13, y0 + 8], 0, 360, fill=color)
    draw.point((x0 + 7, y0 + 5), fill=EYE_GLOW)


HEAD_DRAWERS = {
    "humanoid":      _draw_humanoid_head,
    "diamond":       _draw_diamond_head,
    "hex_shield":    _draw_hex_shield_head,
    "code_block":    _draw_code_block_head,
    "orbital_ring":  _draw_orbital_ring_head,
    "scanning_eye":  _draw_scanning_eye_head,
    "prism":         _draw_prism_head,
    "spectrum_ring": _draw_spectrum_ring_head,
    "vault":         _draw_vault_head,
    "node_cluster":  _draw_node_cluster_head,
    "scales":        _draw_scales_head,
    "compass":       _draw_compass_head,
    "rocket":        _draw_rocket_head,
    "reticle":       _draw_reticle_head,
    "trend_arrows":  _draw_trend_arrows_head,
    "gear":          _draw_gear_head,
    "barcode":       _draw_barcode_head,
    "heart":         _draw_heart_head,
    "infinity":      _draw_infinity_head,
}


# ---------------------------------------------------------------------------
# Body drawing
# ---------------------------------------------------------------------------

def _draw_robot_body(draw: ImageDraw.Draw, x0: int, y0: int, color: tuple,
                     frame_type: str, frame_idx: int):
    """Draw the shared robot body (22px tall, starting at y0+10).

    frame_type: 'idle', 'working', 'walking'
    frame_idx:  sub-index within that type (0-based)
    """
    by = y0 + BODY_TOP  # body y origin

    # Typing bob for working frames: shift 1px down on even sub-indices
    bob = 0
    if frame_type == "working" and frame_idx % 2 == 0:
        bob = 1

    # -- Torso -----------------------------------------------------------
    # Shoulders / collar  (row 0-1 of body)
    draw.rectangle([x0 + 3, by + 0 + bob, x0 + 12, by + 1 + bob], fill=color)
    # Main torso (rows 2-10)
    draw.rectangle([x0 + 4, by + 2 + bob, x0 + 11, by + 10 + bob], fill=CHASSIS_DARK)
    # Trim lines on sides
    draw.line([(x0 + 4, by + 2 + bob), (x0 + 4, by + 10 + bob)], fill=color)
    draw.line([(x0 + 11, by + 2 + bob), (x0 + 11, by + 10 + bob)], fill=color)
    # Chest detail (center line)
    draw.line([(x0 + 7, by + 3 + bob), (x0 + 7, by + 8 + bob)], fill=CHASSIS_LIGHT)
    draw.line([(x0 + 8, by + 3 + bob), (x0 + 8, by + 8 + bob)], fill=CHASSIS_LIGHT)
    # Core light
    draw.point((x0 + 7, by + 5 + bob), fill=color)
    draw.point((x0 + 8, by + 5 + bob), fill=color)

    # -- Arms ------------------------------------------------------------
    if frame_type == "working":
        # Arms extend forward (shorter)
        # Left arm
        draw.rectangle([x0 + 2, by + 2 + bob, x0 + 3, by + 7 + bob], fill=CHASSIS_MID)
        draw.point((x0 + 2, by + 2 + bob), fill=color)
        # Right arm
        draw.rectangle([x0 + 12, by + 2 + bob, x0 + 13, by + 7 + bob], fill=CHASSIS_MID)
        draw.point((x0 + 13, by + 2 + bob), fill=color)
        # Hands forward (typing)
        if frame_idx % 2 == 0:
            draw.point((x0 + 1, by + 7 + bob), fill=color)
            draw.point((x0 + 14, by + 8 + bob), fill=color)
        else:
            draw.point((x0 + 1, by + 8 + bob), fill=color)
            draw.point((x0 + 14, by + 7 + bob), fill=color)
    else:
        # Arms at sides
        draw.rectangle([x0 + 2, by + 2 + bob, x0 + 3, by + 9 + bob], fill=CHASSIS_MID)
        draw.point((x0 + 2, by + 2 + bob), fill=color)
        draw.rectangle([x0 + 12, by + 2 + bob, x0 + 13, by + 9 + bob], fill=CHASSIS_MID)
        draw.point((x0 + 13, by + 2 + bob), fill=color)

    # -- Waist / belt ----------------------------------------------------
    draw.rectangle([x0 + 4, by + 11 + bob, x0 + 11, by + 12 + bob], fill=color)

    # -- Legs ------------------------------------------------------------
    if frame_type == "walking":
        # Alternate legs: 0,2 = left forward; 1,3 = right forward
        left_forward = frame_idx % 2 == 0
        if left_forward:
            # Left leg forward
            draw.rectangle([x0 + 5, by + 13, x0 + 7, by + 19], fill=CHASSIS_DARK)
            draw.rectangle([x0 + 5, by + 17, x0 + 7, by + 19], fill=CHASSIS_MID)
            # Right leg back
            draw.rectangle([x0 + 9, by + 13, x0 + 11, by + 18], fill=CHASSIS_DARK)
            draw.rectangle([x0 + 9, by + 17, x0 + 11, by + 18], fill=CHASSIS_MID)
            # Feet
            draw.rectangle([x0 + 4, by + 20, x0 + 7, by + 21], fill=color)
            draw.rectangle([x0 + 9, by + 19, x0 + 11, by + 20], fill=color)
        else:
            # Right leg forward
            draw.rectangle([x0 + 9, by + 13, x0 + 11, by + 19], fill=CHASSIS_DARK)
            draw.rectangle([x0 + 9, by + 17, x0 + 11, by + 19], fill=CHASSIS_MID)
            # Left leg back
            draw.rectangle([x0 + 5, by + 13, x0 + 7, by + 18], fill=CHASSIS_DARK)
            draw.rectangle([x0 + 5, by + 17, x0 + 7, by + 18], fill=CHASSIS_MID)
            # Feet
            draw.rectangle([x0 + 9, by + 20, x0 + 12, by + 21], fill=color)
            draw.rectangle([x0 + 5, by + 19, x0 + 7, by + 20], fill=color)
    else:
        # Standing legs
        draw.rectangle([x0 + 5, by + 13 + bob, x0 + 7, by + 19 + bob], fill=CHASSIS_DARK)
        draw.rectangle([x0 + 5, by + 18 + bob, x0 + 7, by + 19 + bob], fill=CHASSIS_MID)
        draw.rectangle([x0 + 9, by + 13 + bob, x0 + 11, by + 19 + bob], fill=CHASSIS_DARK)
        draw.rectangle([x0 + 9, by + 18 + bob, x0 + 11, by + 19 + bob], fill=CHASSIS_MID)
        # Feet
        draw.rectangle([x0 + 4, by + 20 + bob, x0 + 7, by + 21 + bob], fill=color)
        draw.rectangle([x0 + 9, by + 20 + bob, x0 + 12, by + 21 + bob], fill=color)


def _draw_humanoid_body(draw: ImageDraw.Draw, x0: int, y0: int, color: tuple,
                        frame_type: str, frame_idx: int):
    """SHADOW only -- simple person body instead of a robot."""
    by = y0 + BODY_TOP

    bob = 0
    if frame_type == "working" and frame_idx % 2 == 0:
        bob = 1

    # Jacket / torso
    draw.rectangle([x0 + 4, by + 0 + bob, x0 + 11, by + 10 + bob], fill=(45, 45, 55))
    # Collar highlight
    draw.rectangle([x0 + 5, by + 0 + bob, x0 + 10, by + 1 + bob], fill=color)
    # Center line
    draw.line([(x0 + 7, by + 1 + bob), (x0 + 7, by + 10 + bob)], fill=color)

    # Arms
    if frame_type == "working":
        draw.rectangle([x0 + 2, by + 1 + bob, x0 + 3, by + 7 + bob], fill=(45, 45, 55))
        draw.rectangle([x0 + 12, by + 1 + bob, x0 + 13, by + 7 + bob], fill=(45, 45, 55))
        draw.point((x0 + 2, by + 7 + bob), fill=SKIN_TONE)
        draw.point((x0 + 13, by + 7 + bob), fill=SKIN_TONE)
    else:
        draw.rectangle([x0 + 2, by + 1 + bob, x0 + 3, by + 9 + bob], fill=(45, 45, 55))
        draw.rectangle([x0 + 12, by + 1 + bob, x0 + 13, by + 9 + bob], fill=(45, 45, 55))
        draw.point((x0 + 2, by + 9 + bob), fill=SKIN_TONE)
        draw.point((x0 + 13, by + 9 + bob), fill=SKIN_TONE)

    # Belt
    draw.rectangle([x0 + 4, by + 11 + bob, x0 + 11, by + 11 + bob], fill=color)

    # Legs
    if frame_type == "walking":
        left_forward = frame_idx % 2 == 0
        if left_forward:
            draw.rectangle([x0 + 5, by + 12, x0 + 7, by + 19], fill=(35, 35, 50))
            draw.rectangle([x0 + 9, by + 12, x0 + 11, by + 18], fill=(35, 35, 50))
            draw.rectangle([x0 + 4, by + 20, x0 + 7, by + 21], fill=(60, 50, 40))
            draw.rectangle([x0 + 9, by + 19, x0 + 11, by + 20], fill=(60, 50, 40))
        else:
            draw.rectangle([x0 + 9, by + 12, x0 + 11, by + 19], fill=(35, 35, 50))
            draw.rectangle([x0 + 5, by + 12, x0 + 7, by + 18], fill=(35, 35, 50))
            draw.rectangle([x0 + 9, by + 20, x0 + 12, by + 21], fill=(60, 50, 40))
            draw.rectangle([x0 + 5, by + 19, x0 + 7, by + 20], fill=(60, 50, 40))
    else:
        draw.rectangle([x0 + 5, by + 12 + bob, x0 + 7, by + 19 + bob], fill=(35, 35, 50))
        draw.rectangle([x0 + 9, by + 12 + bob, x0 + 11, by + 19 + bob], fill=(35, 35, 50))
        draw.rectangle([x0 + 4, by + 20 + bob, x0 + 7, by + 21 + bob], fill=(60, 50, 40))
        draw.rectangle([x0 + 9, by + 20 + bob, x0 + 12, by + 21 + bob], fill=(60, 50, 40))


# ---------------------------------------------------------------------------
# Idle animation helper
# ---------------------------------------------------------------------------

def _draw_idle_variant(draw, x0, y0, color, head_type, variant):
    """idle_2 adds a subtle antenna / glow blink compared to idle_1."""
    if variant == 1 and head_type != "humanoid":
        # Small antenna blink: draw a bright pixel at top center
        draw.point((x0 + 7, y0), fill=color)


# ---------------------------------------------------------------------------
# Main generation
# ---------------------------------------------------------------------------

def generate_spritesheet(name: str, info: dict, output_dir: Path):
    """Generate a 10-frame spritesheet for one agent."""
    color = info["color"]
    head_type = info["head"]
    phase = info["phase"]
    is_humanoid = head_type == "humanoid"

    sheet_w = SPRITE_W * NUM_FRAMES
    sheet_h = SPRITE_H
    img = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    head_draw = HEAD_DRAWERS[head_type]

    for fi, fname in enumerate(FRAME_NAMES):
        x0 = fi * SPRITE_W
        y0 = 0

        # Determine frame type and sub-index
        if fname.startswith("idle"):
            frame_type = "idle"
            frame_idx = int(fname.split("_")[1]) - 1
        elif fname.startswith("working"):
            frame_type = "working"
            frame_idx = int(fname.split("_")[1]) - 1
        else:
            frame_type = "walking"
            frame_idx = int(fname.split("_")[1]) - 1

        # Draw body
        if is_humanoid:
            _draw_humanoid_body(draw, x0, y0, color, frame_type, frame_idx)
        else:
            _draw_robot_body(draw, x0, y0, color, frame_type, frame_idx)

        # Draw head
        head_draw(draw, x0, y0, color)

        # Idle variant
        if frame_type == "idle":
            _draw_idle_variant(draw, x0, y0, color, head_type, frame_idx)

    # Apply locked dimming for phase 3-4
    if phase >= 3:
        # Reduce to 40% opacity
        data = img.getdata()
        new_data = []
        for r, g, b, a in data:
            new_data.append((r, g, b, int(a * 0.4)))
        img.putdata(new_data)

    # Scale up 2x with nearest neighbor
    scaled = img.resize((sheet_w * SCALE, sheet_h * SCALE), Image.NEAREST)

    out_path = output_dir / f"{name}.png"
    scaled.save(out_path)
    return out_path


def main():
    project_root = Path(__file__).resolve().parent.parent
    output_dir = project_root / "frontend" / "assets" / "sprites"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating {len(AGENTS)} agent spritesheets...")
    print(f"Output directory: {output_dir}")
    print()

    for name, info in AGENTS.items():
        out = generate_spritesheet(name, info, output_dir)
        scaled_w = SPRITE_W * NUM_FRAMES * SCALE
        scaled_h = SPRITE_H * SCALE
        print(f"  {name:12s}  head={info['head']:16s}  phase={info['phase']}  "
              f"=> {out.name}  ({scaled_w}x{scaled_h})")

    print()
    print("Done.")


if __name__ == "__main__":
    main()
