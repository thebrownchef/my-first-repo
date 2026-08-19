#!/usr/bin/env python3
"""Generates original SVG portrait/icon art for characters and weapons.

No external API calls — everything is composed procedurally from simple
shapes so the app has real, distinct artwork without needing a Gemini key.
"""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(ROOT, "src/data/characters.json")) as f:
    characters = json.load(f)
with open(os.path.join(ROOT, "src/data/weapons.json")) as f:
    weapons = json.load(f)

# Palette keyed by the character's dominant stat — grim, muted, earthy,
# matching the game's dark-fantasy tone.
STAT_PALETTES = {
    "attack":   ("#5c1f1f", "#8a2f2f", "#e8b4a0"),   # rust red
    "defense":  ("#233a52", "#345677", "#bcd3e8"),   # steel blue
    "movement": ("#2f3d24", "#4a6136", "#c9dba8"),   # moss green
    "toughness":("#3d3020", "#5c4a30", "#e0c9a0"),   # bronze
    "arcana":   ("#3a1f4d", "#5c3480", "#d9b8f0"),   # arcane violet
}

def dominant_stat(c):
    stats = {k: c.get(k, 0) for k in ["attack", "defense", "movement", "toughness", "arcana"]}
    return max(stats, key=lambda k: stats[k] if k != "movement" else stats[k] / 6)

def badge_svg(symbol, dark, mid, light, size=256, portrait=False):
    h = size if not portrait else int(size * 1.25)
    ring = size * 0.46
    cx, cy = size / 2, h / 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{h}" viewBox="0 0 {size} {h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="{mid}"/>
      <stop offset="100%" stop-color="{dark}"/>
    </radialGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/>
    </filter>
  </defs>
  <rect width="{size}" height="{h}" fill="{dark}"/>
  <rect width="{size}" height="{h}" fill="url(#bg)"/>
  <rect width="{size}" height="{h}" filter="url(#grain)"/>
  <circle cx="{cx}" cy="{cy}" r="{ring}" fill="none" stroke="{light}" stroke-width="3" opacity="0.55"/>
  <circle cx="{cx}" cy="{cy}" r="{ring-10}" fill="none" stroke="{light}" stroke-width="1" opacity="0.3"/>
  <text x="{cx}" y="{cy}" font-size="{size*0.44}" text-anchor="middle" dominant-baseline="central">{symbol}</text>
  <rect x="2" y="2" width="{size-4}" height="{h-4}" fill="none" stroke="{light}" stroke-width="2" opacity="0.35"/>
</svg>'''

os.makedirs(f"{ROOT}/src/assets/portraits", exist_ok=True)
os.makedirs(f"{ROOT}/src/assets/icons", exist_ok=True)
os.makedirs(f"{ROOT}/src/assets/weapons", exist_ok=True)

for c in characters:
    dark, mid, light = STAT_PALETTES[dominant_stat(c)]
    with open(f"{ROOT}/src/assets/portraits/{c['id']}.svg", "w") as f:
        f.write(badge_svg(c["emoji"], dark, mid, light, size=256, portrait=True))
    with open(f"{ROOT}/src/assets/icons/{c['id']}.svg", "w") as f:
        f.write(badge_svg(c["emoji"], dark, mid, light, size=96))

WEAPON_SYMBOLS = {
    "spear": "\U0001F531", "pike": "\U0001F531", "bow": "\U0001F3F9", "crossbow": "\U0001F3F9",
    "buckler": "\U0001F6E1️", "tower_shield": "\U0001F6E1️", "holy_scriptures": "\U0001F4D6",
    "sword": "\U0001F5E1️", "sling": "\U0001F300", "rapier": "\U0001F5E1️",
    "club": "\U0001F3CF", "battleaxe": "\U0001FA93", "polearm": "\U0001FA93",
    "fire_brand": "\U0001F525", "flying_embers": "\U0001F525", "burning_hands": "\U0001F525",
    "scorching_ray": "⚡", "dragons_breath": "\U0001F409",
}

for w in weapons:
    dark, mid, light = STAT_PALETTES[w["requirement"]]
    symbol = WEAPON_SYMBOLS.get(w["id"], "⚔️")
    with open(f"{ROOT}/src/assets/weapons/{w['id']}.svg", "w") as f:
        f.write(badge_svg(symbol, dark, mid, light, size=96))

print(f"Generated {len(characters)*2 + len(weapons)} SVG assets.")
