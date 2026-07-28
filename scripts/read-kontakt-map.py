#!/usr/bin/env python3
"""Read a Kontakt keyboard screenshot and report each key's mapping tint.

    scripts/read-kontakt-map.py <screenshot.png> [--left-label N]

Point it at a screenshot that includes the Kontakt keyboard strip along the
bottom (the whole Kontakt window is fine). It finds the keyboard, walks the
keys, samples their pixels, and prints every key as mapped-blue, performance-
green, split-marker, or EMPTY, with note names in Kontakt's convention
(C3 = middle C = MIDI 60).

--left-label says which octave number sits at the left edge of the visible
keyboard (default 0, i.e. the leftmost visible C is C0 = MIDI 24). Read it off
the screenshot's own octave labels.

Written because eyeballing tinted-vs-plain black keys in a chat screenshot is
guesswork, and FHP has a patch map to capture per instrument. Pixel sampling
is exact where squinting is not.
"""

import sys
from PIL import Image
import numpy as np

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Which semitones within an octave are black keys, and which white key each
# black key follows (for horizontal placement).
BLACKS = {1: 0, 3: 1, 6: 3, 8: 4, 10: 5}
WHITES = [0, 2, 4, 5, 7, 9, 11]


def classify(rgb: np.ndarray, is_black_key: bool) -> str:
    """Classify a mean key colour as blue / green / empty / dark."""
    r, g, b = (float(v) for v in rgb)
    # Tints in Kontakt are unmistakable relative to the neutral key colour:
    # blue keys read blue-dominant, green keys green-dominant. Neutral white
    # keys are grey (all channels close); neutral black keys are just dark.
    if b > g + 12 and b > r + 12:
        return "blue"
    if g > r + 12 and g > b + 12:
        return "green"
    brightness = (r + g + b) / 3
    if is_black_key:
        return "empty" if brightness < 70 else "tinted?"
    return "empty" if brightness > 120 else "dark"


def find_keyboard(img: np.ndarray) -> tuple[int, int]:
    """Return (top, bottom) rows of the keyboard strip.

    The white-key region is the widest run of rows near the bottom whose pixels
    are mostly bright or tint-saturated; scan up from the bottom edge.
    """
    height = img.shape[0]
    rows = []
    for y in range(height - 1, int(height * 0.5), -1):
        row = img[y]
        bright = np.mean(np.max(row, axis=1) > 110)
        rows.append((y, bright))
    ys = [y for y, frac in rows if frac > 0.5]
    if not ys:
        sys.exit("Could not find a keyboard strip; crop closer to the keyboard.")
    bottom, top = max(ys), min(ys)
    return top, bottom


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    left_label = 0
    if "--left-label" in sys.argv:
        left_label = int(sys.argv[sys.argv.index("--left-label") + 1])

    img = np.asarray(Image.open(path).convert("RGB"))
    top, bottom = find_keyboard(img)
    strip_h = bottom - top
    # Sample whites low (below the black keys), blacks high.
    white_y = bottom - max(2, strip_h // 6)
    black_y = top + max(2, strip_h // 4)

    # White-key boundaries: dark vertical separator lines in the low band.
    band = img[white_y - 2 : white_y + 3].mean(axis=(0, 2))
    dark = band < 90
    edges = [x for x in range(1, len(dark)) if dark[x] and not dark[x - 1]]
    if len(edges) < 8:
        sys.exit("Could not find key separators; use a sharper/larger screenshot.")
    widths = np.diff(edges)
    key_w = float(np.median(widths))
    x0 = edges[0]

    total_whites = int((len(dark) - x0) / key_w)
    results = []
    for w in range(total_whites):
        octave, pos = divmod(w, 7)
        semitone = WHITES[pos]
        midi = (left_label + octave + 2) * 12 + semitone  # C0 label = MIDI 24
        cx = int(x0 + (w + 0.5) * key_w)
        if cx + 2 >= img.shape[1]:
            break
        rgb = img[white_y - 1 : white_y + 2, cx - 2 : cx + 3].reshape(-1, 3).mean(0)
        results.append((midi, False, classify(rgb, False)))

        # Black key after this white one, if the octave has one there.
        for black_semi, after_white in BLACKS.items():
            if after_white == pos:
                bx = int(x0 + (w + 1.0) * key_w)
                if bx + 2 >= img.shape[1]:
                    continue
                rgb = img[black_y - 1 : black_y + 2, bx - 2 : bx + 3].reshape(-1, 3).mean(0)
                results.append((midi - semitone + black_semi, True, classify(rgb, True)))

    results.sort()
    name = lambda m: f"{NOTE_NAMES[m % 12]}{m // 12 - 2}"
    print(f"{'key':<5} {'midi':<5} kind   reading")
    empties, blues, greens = [], [], []
    for midi, is_black, cls in results:
        kind = "black" if is_black else "white"
        print(f"{name(midi):<5} {midi:<5} {kind}  {cls}")
        (empties if cls in ("empty", "dark") else blues if cls == "blue" else greens
         if cls == "green" else []).append(name(midi))
    print(f"\nblue (mapped):   {' '.join(blues) or '-'}")
    print(f"green (perf):    {' '.join(greens) or '-'}")
    print(f"plain (no map):  {' '.join(empties) or '-'}")


if __name__ == "__main__":
    main()
