# Clay Pot Percussion

**Traditions covered:** ghatam (South Indian Carnatic) · udu (Igbo Nigerian, and
the separate modern Western instrument) · clay darbuka / tabla baladi (Egyptian
and Middle Eastern) · botija (Cuban) · cántaro percutido (Spanish and Mexican) ·
zambomba (Andalusian) · ghara (Punjabi) · matka (Rajasthani) · kudam (Tamil
Villu Paatu) · bu (Korean court ritual) · zarb-e zurkhaneh (Persian) ·
tarambuka (Balkan).

Ask for any of those by name. Ghatam and udu are the deep sections; the rest are
shorter but real.

---

## 0. How to read this document

**Confidence markers.** The literature on clay pot percussion is uneven. Some of
it is peer-reviewed acoustics; some of it is retail copy recycling four
sentences. Every claim below carries one of these:

- **[DOC]** — documented, corroborated, safe to build on.
- **[ONE]** — one real source, plausible, not independently corroborated.
- **[INFER]** — reasoning from a documented physical or musical constraint. Sound,
  but nobody wrote it down.
- **[GAP]** — searched for, not found. Named so you do not fill it with invention.

**When a stroke name is marked [ONE] or [GAP], do not present it to the artist as
established fact.** A plausible fake name is worse than an honest gap, because it
will be repeated with total confidence and nobody will catch it.

**Grid notation.** Sixteenth-note grid unless stated otherwise:

```
1 e & a 2 e & a 3 e & a 4 e & a
```

Twelve-pulse (12/8) grids are numbered `1..12`. Carnatic material is indexed by
**pulse within the cycle**, 1-based, because that is the only grid that makes the
arithmetic work.

**No MIDI note numbers appear in this document, on purpose.** Note numbers are
specific to a sample library and belong in an instrument doc. This document names
strokes in the abstract. Join the two: for each stroke called for here, pick the
pitch whose documented sound matches, and say which mapping you chose.

---

## 1. Three mechanically distinct instruments. Never blur them.

"Clay pot" names three unrelated sound-production mechanisms. Choosing the wrong
one is the largest available mistake, and it is silent — the part will look fine
and be wrong.

| Type | Mechanism | Members | What it demands |
|---|---|---|---|
| **Open Helmholtz resonator, struck** | Air in the vessel's apertures; pitch changes as apertures are covered and uncovered | **udu**, **ghatam**, cántaro, ghara, kudam | **The pitch bend is the instrument.** A fixed-pitch one-shot is a wrong reproduction. |
| **Membrane over a clay body** | Skin vibrates; clay is only the resonating shell | **clay darbuka**, zarb-e zurkhaneh, tarambuka, Rajasthani matka | Conventional drum writing. Clay shell = darker and shorter than metal. Bass/treble binary. |
| **Struck or blown vessel, no bend** | Impact on the ceramic wall, or breath across the mouth | Korean **bu**, Cuban **botija** (blown), **zambomba** (friction) | None of the above. Each is its own thing. |

Two consequences that catch people out:

- **The botija is an aerophone.** It is blown, not struck. Writing it as a drum is
  simply incorrect. [DOC]
- **The zambomba is a friction drum.** A rod rubbed through a membrane. It is a
  sustained growl, not a hit. [DOC]

---

## 2. The physics both deep traditions share

Ghatam and udu are the same acoustic machine solved twice, and understanding the
machine tells you what a part can and cannot contain.

**Two independent resonators live in one pot.** [DOC]

1. **Shell modes.** Strike the ceramic wall and the clay itself rings. This pitch
   is **fixed at firing** and cannot be changed by the player. Wall thickness is
   deliberately varied across the body, so *different regions of the same pot ring
   at different pitches*. This is why "tap the body" is not one sound but a family.
2. **Cavity mode (Helmholtz).** The air inside, speaking through the apertures.
   This pitch is **continuously variable in performance**, because the player
   changes the effective aperture.

**The rule that follows, and it governs everything below:**

> The bass register bends. The shell strokes do not.

**Aperture arithmetic.** Each opening is an acoustic mass; openings sit in
parallel across one compliance. Two open apertures = less total mass = **higher**
pitch. Seal one = **lower** pitch. [DOC, from the equivalent-circuit model of the
udu published in *JASA* 133(3), 2013]

Therefore, and this resolves a genuine contradiction in the popular sources:

- **Hand leaving an aperture → pitch glides UP.**
- **Hand arriving at an aperture → pitch glides DOWN.**

Both gestures exist. Which one you get is determined entirely by whether the hand
is arriving or departing. Sources that state a single direction as "the" udu bend
are describing one gesture and generalising. [INFER, from the documented model]

**How the two traditions get their variable aperture differs, and it matters:**

- **Ghatam:** the pot's mouth is pressed against the player's **bare belly**. The
  torso is the valve. Continuous, two-directional, and it can be held mid-glide.
  [DOC]
- **Udu:** a **side hole** cut in the shoulder, sealed and released by the palm.
  Faster and more percussive, but it is a gesture with a beginning and an end
  rather than a continuously held position. [DOC]

**The single most important programming consequence, documented independently of
either tradition:** on the udu, **the release of the bass hand is its own audible
event**. Sample libraries ship dedicated release samples for exactly this reason.
A bass note that ends in clean silence is the number one giveaway of a programmed
part. [DOC]

---

# PART ONE — GHATAM

South Indian, Carnatic classical. The most rhythmically sophisticated clay pot
tradition in the world, and the one with the most explicit theory attached.

## 3. The instrument

**Construction.** Clay fired with **brass, copper and iron filings** mixed in.
The Manamadurai process adds river sand, graphite and lead; the clay is stamped
underfoot for hours, the pot built over days, then kiln-fired and sun-dried.
A potter taps the outer surface thousands of times to even the wall thickness and
set the tone. Anatomy: **a mouth, a slanting shoulder, and a rounded lower
belly**, moulded seamlessly. [DOC]

**Regional types — the sources genuinely disagree, so hold this loosely.** [ONE
each, conflicting]

- One account: **Madras/Chennai** pots are lighter, need less force, suit fast
  passages; **Manamadurai** pots are heavy and thick with a sharp metallic ring.
- Another: the split is **lighter and spherical** (Karnataka, Andhra, northern
  Tamil Nadu) versus **heavier and cylindrical** (Manamadurai, Palghat).

These may be the same category cut two ways. Do not present the Madras/Manamadurai
binary as settled taxonomy. **The musically useful part is agreed:** heavier pot =
more force = slower maximum passage speed.

**Pitch is fired in and can only be lowered.** [DOC]

- Range across instruments: roughly a low B to a high A, chromatically.
- The pot is chosen to match the concert's **adhara sruti** (the tonic). Working
  players carry several and pick the one that fits the day's key.
- Lowering methods, all documented, all costing something: wet clay or soap on the
  neck (down a half or whole step); beeswax around the mouth; **filling it with
  water for ten minutes and draining it** (immediate drop, but volume falls).
- **There is no way to raise the pitch.**

**For writing:** pick one tonic and never transpose the shell strokes. Only the
cavity/bass layer moves. A "melodic" ghatam line is not a thing on one pot.

**The pot gets repositioned mid-performance** — turned so the mouth faces outward
and the neck is played, for a different resonance. [ONE]

## 4. Stroke vocabulary

**Read this before using any name below.** There is **no authoritative English
stroke-name table for the ghatam.** Exactly one named list circulates, and the
sites carrying it share a common ancestor. Its transliterations are inconsistent
with Carnatic convention, it lists one syllable twice, and no independent source
corroborates three of its names. [GAP — this is a real hole in the literature]

Use the *zones and hand-parts*, which are well corroborated. Use the *names* with
a hedge.

### 4.1 The zone map — well corroborated [DOC]

Strokes are taken on **the neck, the belly (upper, middle and lower), and the
base**, with **palms, wrists, fingers, thumbs, the heels of the hands, and
nails** of both hands.

- **Treble** = fingers on the belly and upper areas.
- **Bass** = wrists and heels low down, plus abdominal pressure at the mouth.

### 4.2 The named list — [ONE], hedge it

| Name | Hand | Hand part | Zone |
|---|---|---|---|
| Tha / Kha | L / R | middle+ring+little together | upper belly |
| Ti / Na | L / R | index finger | upper belly |
| Ku / (Na or Nam) | L / R | thumb | neck |
| Thom / Ghum | L / R | wrist | neck |
| **Gumki** | either | open flat palm | **mouth** |

**Structural fact this reveals, and it is the useful part:** every stroke except
gumki is a **left/right mirror pair at the same zone with the same hand-part**.

The mridangam separates registers across two drumheads. **The ghatam separates
them across zones of one pot, and the hands are largely interchangeable.** That is
the sticking model. [INFER, but strongly implied by the structure of the list]

### 4.3 Gumki — the bass, and two things share the name [DOC]

Keep these separate:

1. **Gumki as a strike.** Open, fully flattened hand on the **mouth** of the pot.
   The palm seals and releases the cavity: a low, airy Helmholtz thump. Little
   shell ring, short-to-medium decay.
2. **Gumki as modulation.** The mouth pressed against the **bare stomach**, with
   pressure varied continuously. Deepens the bass and produces glides and "wah"
   inflections under any sustaining low note.

Named ghatam specialities, from a lecture-demonstration: **double stroke with both
hands**, **gumki with both hands**, **wrist and thumb combined**, and **double
gumki with stomach and wrists**. [ONE]

**A documented physical limit worth honouring.** The mridangam's equivalent
bass-bend stroke cannot be sustained over long stretches — the player tires. The
ghatam version demands abdominal control on top of that. **Gumki lines are
interspersed, never continuous.** [DOC for the mridangam, [INFER] for the ghatam]

### 4.4 Damping [GAP]

No source assigns ring-versus-damp status stroke by stroke. What is safe:

- **Ringing:** wrist strokes on the neck, full-hand belly strokes, open-mouth gumki.
- **Damped:** any stroke where the hand stays on the shell; **any stroke played
  while the mouth is sealed against the belly**, because the cavity is stopped and
  the sustain collapses. [INFER, physically necessary]

### 4.5 Throwing the pot

In the tani avartanam, the player throws the ghatam in the air and catches it
without missing a beat, on the **third statement** of the closing korvai. **Largely
obsolete** — it was the high point of a tani until a few decades ago and has gone
out of fashion. [ONE]

**For writing: the throw is a silence, not a sound.** If you evoke it, write a
conspicuous ghatam rest across the final statement of a closing korvai and land
hard on the last stroke.

## 5. Konnakol — the syllable system

The ghatam shares the mridangam's syllables. All mridangam patterns can be played
on it. [DOC]

**Honesty flag:** the syllable-to-stroke relation is **not a straightforward
mapping**. Researchers building transcription systems had to abandon exact stroke
labels for a reduced five-or-six-class set because the real vocabulary varies by
school. Any syllable→stroke table is a convention, not a fact. [DOC]

### 5.1 The five jatis and their syllables [DOC]

| Jati | Count | Syllables |
|---|---|---|
| Tisra | 3 | `tha ke ta` |
| Chatusra | 4 | `tha ka dhi mi` |
| Khanda | 5 | `tha ka tha ke da` |
| Misra | 7 | `tha ke ta tha ka dhi mi` (3+4) |
| Sankeerna | 9 | `tha ka dhi mi tha ka tha ke ta` (4+2+3) |

**A live discrepancy, not an error:** khanda-5 is `tha ka tha ke da` in one major
lineage and `ta ka ta ki ta` in the dance tradition. Both are current. [DOC]

### 5.2 The counting series — genuinely algorithmic [DOC]

Counts five through nine are the **same five syllables with gaps inserted**
(`–` = one silent pulse). This is the backbone of phrase construction:

```
1  tha
2  tha ka
3  tha ki ta
4  tha ka di mi
5  tha di gi na thom
6  tha dim –  gi na thom
7  tha –  dim –  gi na thom
8  tha dim –  gi –  na –  thom
9  tha –  dim –  gi –  na –  thom
```

Composite alternatives, all documented: 5 as `tha ka tha ki ta` (2+3), 6 as
`tha ki ta tha ki ta` (3+3), 7 as `tha ki ta tha ka di mi` (3+4), 8 as
`tha ka di mi tha ka jha nu` (4+4), 9 as `tha ka di mi tha ka tha ki ta` (4+2+3).

### 5.3 Karvai — the highest-leverage rule in this document [DOC]

> Players learn the complete syllable string, then **omit syllables in
> performance**, so that pulses land in silence or immediately after it.

A mechanically complete `ta ka di mi ta ka di mi` sounds like an exercise, not
music. The documented effect of the omissions is that beats fall in the space just
before a new syllable, which "kicks the rhythm along."

**Leave holes. Deliberately. This is the difference between a written part and a
played one.**

## 6. Tala — the cycles

### 6.1 A terminology trap that will cause a bug [DOC]

The word **akshara** means two incompatible things: a *beat* in classical
pedagogy, a *subdivision* in the research literature. Both are correct in their own
convention.

**Avoid the word entirely.** Generate on:

```
cycle  = beats × gati        (gati = pulses per beat: 3, 4, 5, 7 or 9)
```

### 6.2 Beat maps for the talas actually used [DOC]

`S` = sam, the strongest position. `A` = anga head, secondary accent.

**Adi tala — 8 beats, grouped 4+2+2.** The default.
```
beat:    1    2    3    4    5    6    7    8
group:  |------ 4 -------|-- 2 --|-- 2 --|
accent:  S    ·    ·    ·    A    ·    A    ·
```
Chatusra gati: 8 × 4 = **32 pulses**. Two-kalai variant: 16 beats, 64 pulses.

**Misra Chapu — 7 beats, grouped 3+2+2.** Accents at beats **1, 4, 6**.
```
beat:    1    2    3    4    5    6    7
group:  |---- 3 ----|-- 2 --|-- 2 --|
accent:  S    ·    ·    A    ·    A    ·
```
Chatusra gati: **28 pulses**. **If you get only one thing right in misra chapu,
make it the accents at pulses 1, 13 and 21.** It is not 4+3, and it is not an
undifferentiated 7.

**Khanda Chapu — 5 beats, grouped 2+3.** Accents at beats **1, 3, 4**.
```
beat:    1    2    3    4    5
group:  |-- 2 --|---- 3 ----|
accent:  S    ·    A    A    ·
```
Chatusra gati: **20 pulses**.

**Rupaka (concert usage) — 3 beats**, sam on 1. Chatusra gati: **12 pulses**. Also
performed at 6 beats. A theoretical six-beat form grouped 2+4 exists and is the
only sapta tala starting with a drutam; the concert form is what you will be asked
for. [DOC that both exist]

**Tisra Triputa — 7 beats, grouped 3+2+2.** Same grouping as misra chapu, but each
beat is a full beat, so at the same tempo the cycle is twice as long.

**Chapu talas cannot be derived from the anga formulas.** They sit outside the
35-tala scheme and have half-integral components. **Hardcode them as literal beat
maps.** [DOC]

### 6.3 Gati — pulses per beat [DOC]

*Jati* sizes the cycle. *Gati* sizes the subdivision. They are independent axes.

| Tala | Beats | ×3 | ×4 | ×5 | ×7 | ×9 |
|---|---|---|---|---|---|---|
| Adi | 8 | 24 | **32** | 40 | 56 | 72 |
| Misra Chapu | 7 | 21 | **28** | 35 | 49 | 63 |
| Khanda Chapu | 5 | 15 | **20** | 25 | 35 | 45 |
| Rupaka | 3 | 9 | **12** | 15 | 21 | 27 |

**A gati change is not a tempo change.** The beat stays exactly where it is; the
number of pulses inside it changes, so the texture density changes. Switch at a
beat or anga boundary, and restate the same phrase in the new gati so the ear
hears re-metering rather than a new idea. [DOC]

### 6.4 Eduppu — where the phrase enters [DOC]

The entry point relative to sam. Three types: **sama** (on sam), **anagata**
(after sam — the common one), **atita** (before sam — rare).

Documented values run from 2 to 6 pulses after sam. One tala variant has a fixed
entry at **1.5 beats after sam**.

**Two rules follow, and they matter more than they look:**

1. **Do not automatically accent beat 1.** Many compositions do not start there.
2. **Percussionists count backwards from the landing point.** Phrases are designed
   by their arrival, not their launch. The strongest stroke belongs to the
   resolution, and everything is offset backwards from it.

## 7. Cadences — the arithmetic

This is the part a model can be held to, because it is checkable integer math.

### 7.1 Mora [DOC]

Three statements of one phrase, separated by two equal gaps:

```
L = 3P + 2G
```

`P` = phrase length in pulses, `G` = gap length.

### 7.2 Korvai [DOC]

The full cadence, spanning 1, 2 or 4 cycles, in two sections — a *purvangam*
("the question") and an *uttarangam* ("the answer"), the answer usually built on
`tha di gi na thom` (5), resolving on sam.

```
L = (3P + 2G) + (3Q + 2H) = k × cycle_pulses
```

**Landing condition.** With `C` pulses per cycle and a 1-indexed start pulse `s`:

```
s + L - 1 ≡ 0  (mod C)
```

**Flag:** sources genuinely disagree by one pulse about whether the final syllable
*sounds on* sam or *fills up to* it. Both conventions are in print. The agreed
musical fact is that the resolution coincides with sam — or with the soloist's
eduppu, if handing back. Do not treat the ±1 as settled. [DOC that they disagree]

### 7.3 Worked examples — verify your arithmetic against these

**Documented, two cycles of Adi (64 pulses):**
```
purvangam:  8 (3) 8 (3) 8 (3)  = 24 + 9  = 33
uttarangam: 7 (5) 7 (5) 7      = 21 + 10 = 31
                                 total     64  ✓
```
```
purvangam:  9 (3) 9 (3) 9 (3)  = 27 + 9  = 36
uttarangam: 6 (5) 6 (5) 6      = 18 + 10 = 28
                                 total     64  ✓
```
Note the shared design logic: the purvangam phrase shortens while its gap holds,
then the uttarangam phrase shortens further while its gap **lengthens**. An
accelerate-then-brake shape.

**Single cycle of Adi (32 pulses), sama eduppu**, using `tha di gi na thom` = 5:
```
purvangam:  5 (1) 5 (1) 5   = 17
uttarangam: 5     5     5   = 15
                              32  ✓

pulses  1– 5 : tha di gi na thom
pulse      6 : (karvai)
pulses  7–11 : tha di gi na thom
pulse     12 : (karvai)
pulses 13–17 : tha di gi na thom
pulses 18–22 : tha di gi na thom
pulses 23–27 : tha di gi na thom
pulses 28–32 : tha di gi na thom
```
The purvangam statements start on beats 1.0, 2.5 and 4.0 — deliberately walking
off the beat grid — while the gapless uttarangam resolves exactly at the cycle
end. **That off-grid walk is the effect.**

**Misra Chapu, two cycles (56 pulses):**
```
purvangam:  7 (2) 7 (2) 7 (2)  = 27
uttarangam: 7 (4) 7 (4) 7      = 29
                                 56  ✓
```
Each 7-pulse statement is exactly 1.75 beats, so it rotates through the 3+2+2
accent map and hits a different anga head every time.

**Anagata eduppu, Adi, entering at pulse 5:** landing requires `L ≡ 28 (mod 32)`.
```
purvangam:  4 (2) 4 (2) 4  = 16
uttarangam: 4     4     4  = 12
                             28  ✓   (occupies pulses 5–32)
```

### 7.4 Yati — the shape of a phrase-length sequence [DOC]

Used mainly as the purvangam, the shaped opening that sets up the threefold answer.

| Yati | Shape | Example |
|---|---|---|
| Sama | equal | 4 4 4 4 |
| Srotovaha | expanding | 1 2 3 4 5 |
| Gopuchcha | contracting | 5 4 3 2 1 |
| Mridanga | expand then contract | 5 6 7 6 5 |
| Damaru | contract then expand | 5 4 3 2 3 4 5 |

**The shapes are consistent across sources; the specific numbers are illustrative,
and sources disagree on what to call the hourglass form.** Generate from the shape,
not from a memorised digit list. [DOC for shapes, [ONE] and conflicting for names]

**Recipe:** pick a shape and a karvai, sum it to `Y`, then solve `3Q + 2H = kC − Y`
for the answer. Prefer `Q` in {3, 5, 7, 9} — those map onto idiomatic syllables.
Worked, one cycle of Adi:
```
srotovaha:  5 (3) 7 (3) 9        = 27  +  1 (1) 1 (1) 1  =  5   →  32  ✓
damaru:     5 (1) 4 (1) 3 (1) 4 (1) 5 = 25  +  1 (2) 1 (2) 1 = 7 →  32  ✓
mridanga:   3 (1) 5 (1) 7 (1) 5 (1) 3 = 27  +  1 (1) 1 (1) 1 = 5 →  32  ✓
```

## 8. Sarvalaghu versus kanakku — the texture decision

This governs everything and is the best single guard against writing a showpiece
when accompaniment was asked for. [DOC]

| | **Sarvalaghu** | **Kanakku** |
|---|---|---|
| Meaning | "all light units"; flowing | "calculation" |
| Rhythm | steady, smooth, no pauses; notes mostly 1, 2 or 4 pulses | atypical lengths, non-intuitive groupings |
| Relation to tala | **follows** it, reinforces the beat | plays **around** it, obscures then resolves |
| Where | most of the piece; supporting the soloist | cadences, solos, korvais |
| Timbre | resonant strokes, less damping | full arsenal, dense |

> Sarvalaghu follows on the rhythm, rather than playing calculations around the
> rhythm of the song.

**Most of a performance is sarvalaghu.** Calculation is a cadential and solo
device, not a default texture. Default to flowing unless the brief asks for a
cadence or a solo.

### 8.1 Sarvalaghu patterns

**Honest gap:** beat-positioned sarvalaghu grooves are not available free online.
They live in print, in the standard drumming method books. What follows is one
documented cell plus constructed templates. [GAP]

**Documented 8-pulse cell** [ONE] — in Adi chatusra gati it fills 2 beats and
repeats four times per cycle:
```
na  ta  ta  dhin | na  ta  ta  dhin
```
This is exactly the character the sources describe: no heavy damped strokes,
sitting on the resonant tones, the flow carried by light fills.

**Constructed template, Adi tala, 32 pulses.** [INFER — idiomatic scaffolding, not
a transcription.] Anga heads at pulses 1, 17, 25.
```
pulse:   1  2  3  4 | 5  6  7  8 | 9 10 11 12 |13 14 15 16
solk:   tha ka dhi mi tha ka jha nu tha ka dhi mi tha ka dhi mi
accent:  S  ·  ·  ·   ·  ·  ·  ·   ·  ·  ·  ·   ·  ·  ·  ·

pulse:  17 18 19 20 |21 22 23 24 |25 26 27 28 |29 30 31 32
solk:   thom ka dhi mi tha ka dhi mi thom ka dhi mi tha ka dhi nam
accent:  A  ·  ·  ·   ·  ·  ·  ·   A  ·  ·  ·   ·  ·  ·  ·
```
Rules encoded: bass on the two anga heads (pulses 17 and 25); a resonant stroke on
the final pulse to lead back to sam; light continuation filling the rest. **Then
apply karvai and delete some of it.**

**Constructed template, Misra Chapu, 28 pulses.** Anga heads at pulses 1, 13, 21.
```
pulse:   1  2  3  4  5  6  7  8  9 10 11 12 |13 14 15 16 17 18 19 20 |21 22 23 24 25 26 27 28
group:  |------------- 3 -------------------|--------- 2 -----------|--------- 2 -----------|
accent:  S  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·   A  ·  ·  ·  ·  ·  ·  ·   A  ·  ·  ·  ·  ·  ·  ·
```
The asymmetry — a 12-pulse anga followed by two 8-pulse angas — is what makes
misra chapu recognisable.

## 9. Ensemble role

The ghatam is an **upa-pakkavadyam**, secondary percussion. The mridangam leads.
The ghatam player moulds their style to follow. [DOC]

| Situation | What the ghatam does | Confidence |
|---|---|---|
| Melodic sections | Shadows the mridangam's sarvalaghu at reduced density. Supplies crisp high attack over the mridangam's low resonance. Doubling, not initiating. | [ONE] |
| Mridangam plays a cadence | **In unison.** Cadences are executed together. | [ONE] |
| Kuraippu (in the solo) | **Answers.** Strict call-and-response, statements of decreasing length — four cycles each, then two, then one, then half. Mechanically explicit and directly programmable. | [DOC] |
| Its own solo statements | Full material, its own sarvalaghu and kanakku. | [DOC] |
| Dropping out entirely | No authoritative rule found. | [GAP] |

**Structure of a tani avartanam (percussion solo)** [DOC]: opening sarvalaghu to
establish groove and tala → thematic development, each statement ending in a
cadence → **nadai bhedam**, moving through tisra, khanda, misra and back to
chatusra → **kuraippu**, the halving conversation → dense fast figures → a long
extended cadence → the final **korvai**, all instruments in unison, resolving on
sam. The soloist re-enters exactly where they left off.

## 10. What a ghatam player never does

- **Never a metronomic, complete syllable string.** Omit syllables. Leave holes.
- **Never a continuous gumki line.** The player tires; it is interspersed.
- **Never two bass strokes at sixteenth spacing.** Wrist strokes are large-mass
  gestures and the slowest in the vocabulary. Give them an eighth at moderate
  tempo, minimum.
- **Never transpose the shell strokes.** One pot, one tonic. Only the cavity bends.
- **Never accent beat 1 by default.** Aim phrases at their landing.
- **Never one sample at two velocities where the tradition has two strokes.** The
  loud and soft versions at the same spot are *different strokes* with different
  release characteristics. That pairing is the core dynamic device.
- **Never kanakku everywhere.** Most playing is flowing accompaniment.
- **Never four identical velocities in a row on one zone.** Alternate hands.
- **Above a threshold speed, stop alternating and substitute a one-hand finger
  ripple** — the tradition itself does this. Write it as a tight, *unequal*
  three-note drag with descending velocity, not three equal thirty-seconds.

---

# PART TWO — UDU

Nigerian, Igbo. **There are two udus, and they are different instruments that
share a name.** Establish which one the brief wants before writing a note.

## 11. The two traditions

| | **Traditional Igbo** | **Modern Western** |
|---|---|---|
| Instrument | Large pot, often **one hole** | Two-hole, or multi-chambered designs |
| Struck with | A **foam or sponge paddle** at the mouth | Bare hands, fingertips |
| Sound set | **Three:** open, half, muted | Full multi-timbral vocabulary |
| Volume | Room-shaking sub-bass | Quiet; needs amplification |
| Part | Slow, steady, sub-bass pulse holding the ensemble together | Busy, virtuosic, borrowed technique |
| Technique origin | Indigenous | **Borrowed** from darbuka, tabla and ghatam |

**Documented for the traditional instrument:** in an Igbo ensemble recording from
Enugu state, filmed before ritual funeral music, the udu supplies "the steady deep
whoomp-whoomp-whoomp that coheres" the group, with the slit drum's rapid clicks
accenting "the slow udu beat." Overall meter **6/8**, interlocking polyrhythm.
[DOC]

Also documented, and it is the correction most worth carrying: **traditional
players use the airy hole sound sparingly**, playing mostly the outside of the pot.
Traditional Nigerian pot-drum rhythms accompany singing and are described by a
Nigerian master potter as "simple and straightforward." [DOC]

**So: a traditional Igbo udu part that is wall-to-wall pitch-bend whoops is the
most common fake there is.**

**The modern instrument's lineage** [DOC]: an American ceramicist encountered pot
drums on a 1974 trip to **Zaria, in northern Nigeria**, learning from a ceramics
professor there, and developed the contemporary instrument in collaboration with a
percussionist. Note the geography — **Zaria is not in Igboland, and the teacher was
an academic ceramicist, not a village tradition-bearer.** [INFER on the
significance] The modern instrument is a designed studio object, not a continuation
of village practice, and its technique is openly imported: the standard courses
teach **darbuka rhythms** and **split-hand tabla technique** on it.

## 12. Names [DOC]

| People | Name | Meaning |
|---|---|---|
| Igbo | **ùdù** | "vessel" / "pot" — Igbo call *all* pots this; the drum is not lexically distinguished |
| Ibibio | **abang mbre** (or **abang**) | "pot for playing" |
| Yoruba | **ikoko-ilu** | "container drum" |

**"Kim Kim" is a modern trade name**, not established indigenous nomenclature.
[ONE, weak] The origin story about an accidentally punctured water jug is presented
as **legend** by its own sources; so is the claim about ancestors' ashes in the
clay. Do not repeat either as history. [ONE]

## 13. Construction and shape

Roughly spherical body, **neck about two inches tall with a one-inch opening**, and
a **second hole about an inch across cut into the upper shoulder**. Coil-built over
a form, paddled smooth, bonfire-fired. **No membrane** — classified as a plosive
aerophone and idiophone, not a membranophone. [DOC]

**Wall thickness is deliberately varied**, which is why different regions of the
body ring at different pitches. "Tap the body" is a family of pitched sounds, not
one sound. [DOC]

**Shape determines what strokes exist:** [DOC for the models, [INFER] for the
consequences]

- **Single-chamber round:** one bass port, one neck, whole shell for taps. Maximum
  glissando expressivity, **minimum simultaneity**.
- **Dual-chambered designs** (two chambers, one rounded and one flat or triangular):
  two independent pitched surfaces reachable by two hands, so **real bass/treble
  interlock becomes possible** — which it is not on a classic single-chamber pot.
- **Models with a flat auxiliary playing surface:** import the darbuka vocabulary
  wholesale; players report a usable bass and very good rim strokes.
- **Textured shells:** enable friction and rub strokes as a sustained-noise layer.
- **A Persian hybrid design** adds a skin membrane between the holes specifically so
  both can be played at once. That simultaneity had to be *designed in* is the
  strongest evidence it was not available before. [DOC]

**Not tunable.** Pitch is fixed at firing; players choose an instrument for the
note it already has. **A multi-pitch udu part implies a set of pots, one note
each** — which is real practice, and there are documented performances on a tuned
set of four. [DOC]

## 14. Stroke vocabulary

**Terminology warning, and it is stronger here than for the ghatam.** Udu stroke
names are **not standardised at all**. No two instructional sources agree. Major
teaching syllabi use generic percussion terms with **no udu-specific stroke names
whatsoever**. Where players do use names, they are **imported** from darbuka or
ghatam. The closest thing to a standard is a *sampler* convention: bass, bass
muted, side, fingertips, plus **bass release**. [DOC that no naming system exists]

**Do not invent or assert udu stroke names.** Descriptive labels below.

| # | Stroke | Register | Attack | Decay | Pitch behaviour |
|---|---|---|---|---|---|
| 1 | Side-hole bass, sealed and held | sub | soft, airy | long | static low |
| 2 | **Side-hole bass with release** | sub → low-mid | soft, airy | long | **glides UP; the release is its own event** |
| 3 | Side-hole bass, muted | low | soft | very short | pitchless thud |
| 4 | Neck/mouth bass (hand or paddle) | sub, darker | soft, "blown" | long | static; bends via thigh or second hand |
| 5 | Open strike then close | low-mid → low | soft | medium | **glides DOWN** |
| 6 | Body fingertip tap | mid | crisp | very short | pitched by strike location |
| 7 | Fingertip roll | mid | crisp, repeated | very short each | as above |
| 8 | Body or neck slap | mid-high | sharp crack | short | bright, "wet" |
| 9 | Rim / lip-of-neck stroke | high | very sharp | negligible | thin; the *tek* role |
| 10 | Knuckle rap, ring click | high | very sharp | negligible | metallic ping |
| 11 | Rub, brush, swirl | broadband noise | none | sustained while moving | unpitched |
| 12 | Ghost note (any of 6–9, very soft) | as above | soft | short | as above |

**Attested onomatopoeia** for the bass: "woomp," "whoof," "whoomp." **"Boop" is
not attested — do not use it.** [DOC / GAP]

**Pitch control by the other hand and by the body** [DOC]: one documented division
of labour is **the top hand controls pitch at the neck while the other plays over
the side hole**. Also documented, from a museum object record: the seated player
**presses the large opening against the left thigh** to vary pitch — the same
principle as the ghatam's belly.

**Which hole is "the bass hole" is model-dependent and the sources contradict each
other.** Both assignments are practised. [DOC that they conflict]

**Internal loading is real practice** [DOC]: water, ball bearings, or dried beans
inside the pot. Water makes the bass note **glide and burble** as it sloshes after
a stroke — a decaying, unstable pitch. That is the "liquid" quality people reach
for. One manufacturer sells a model with a dedicated water compartment.

## 15. Physical constraints — the part that makes MIDI believable

1. **Bass and treble are largely mutually exclusive on a single-chamber udu.** One
   hand is committed to the port; the other does everything else. You cannot get a
   full bass whoop and a busy finger roll at the same instant from one player.
   [INFER, but strongly supported — simultaneity had to be engineered into a later
   design]
2. **Available on dual-chambered models** and on flat auxiliary surfaces. [INFER]
3. **The bass hole cannot be repeated fast.** Strike → seal or lift → reset, and
   the resonance needs time to speak. Consecutive bass notes read naturally at
   **eighth-note spacing and slower**. A sixteenth pair works as a deliberate
   figure, never as a stream. [INFER]
4. **The release is not free.** Every whoop costs a lift. Back-to-back bend-up
   gestures with no gap stop sounding like a hand.
5. **Fast passages must be split-hand alternated**, tabla-style. A fast one-handed
   run in one region is not physical. [DOC]
6. **Ceramic hurts.** Players describe a painful toughening-up period striking clay
   barehanded. **Fast means quiet.** Loud sustained fingerwork has a real physical
   ceiling. [DOC]
7. **No retuning mid-piece.** One pot, one fundamental. [DOC]

## 16. Patterns

### 16.1 Traditional Igbo — 12/8

Documented function: a steady deep pulse cohering the ensemble. The realisation
below is the obvious reading of "steady whoomp" in 6/8, **not a transcription**.
[INFER]

```
pulse:  1  2  3  4  5  6  7  8  9 10 11 12
udu:    B  .  .  B  .  .  B  .  .  B  .  .
```
A slower reading — bass on pulses 1 and 7 only — is equally plausible given "slow
udu beat," and is often the better choice.

The rest of the ensemble interlocks against the **standard 12/8 bell pattern**
[DOC]:
```
pulse:  1  2  3  4  5  6  7  8  9 10 11 12
bell:   x  .  x  .  x  x  .  x  .  x  .  x
```

**No published transcription of a named traditional Igbo udu pattern exists on the
open web.** Not in the encyclopedias, not in the ethnomusicology seminar notes, not
in commercial material. Closing this properly means the ethnomusicology journals.
**Never present an Igbo udu pattern as traditional; present it as reconstruction.**
[GAP]

### 16.2 The one published beginner pattern [DOC]

Verbatim from a teaching source: **"palm – tap – tap – palm – tap – tap."** A good
default for a 6/8 udu part.
```
pulse:  1  2  3  4  5  6
        B  t  t  B  t  t        B = palm bass on hole, t = fingertip tap on body
```

### 16.3 The actually-taught modern repertoire: darbuka rhythms

**Documented:** the standard udu courses teach, by name, maqsoum, baladi, saidi,
khaleegy, chiftetelli, ayoub and rumba. One major udu DVD applies Afro-Cuban,
South Indian and Middle Eastern material; its author studied ghatam in Madras.
[DOC]

Assignment on a classic udu [INFER]: **D → bass hole · T → slap or rim with the
strong hand · k → fingertip with the weak hand.** Grids in §18.

**Why these work:** they are **D-sparse**. Maqsoum has two bass strokes per bar,
baladi three, ayoub two — matching the constraint that the bass hand is slow and
committed. **Ayoub and baladi are the most idiomatic.** **Malfuf and fellahi are
the least** on a single-chamber pot: fellahi's `D t . t` demands a bass and two
teks inside one beat, which needs a second playing surface.

### 16.4 As a bass or kick substitute [INFER]

Documented premise: the udu anchors without overpowering, and has a bass function.
```
16ths:  1 e & a 2 e & a 3 e & a 4 e & a
bass:   B . . . . . . . B . . . . . . .     whoop on 1 and 3, release-glide on the 3
finger: . . t . . . t . . . t . . . t .     weak-hand offbeat ghosts
```

### 16.5 Ambient [DOC for context, [INFER] for the pattern]

Documented home of the modern instrument: meditative, new-age, film scoring, world
fusion. One bass whoop every one to two bars, full decay left to ring, occasional
fingertip ghost cluster, rub and brush textures underneath. **Density is the
enemy.**

## 17. Tempo, dynamics, role

**Tempo — no source states a range anywhere. All [INFER].** Traditional 6/8
ensemble: dotted-quarter roughly 70–110. Modern, inheriting darbuka tempi: maqsoum
90–140, baladi 70–110, ayoub 100–160, chiftetelli 60–90. Ambient: 50–90 or free.
**Ceiling:** the bass port limits sustained repetition to about eighths at moderate
tempo; body fingerwork reaches sixteenths with split hands, but only quietly.

**Volume — documented and important.** The modern hand-played ceramic udu is
"definitely limited" acoustically and **needs amplification** to sit with other
instruments; manufacturers build in microphone ports. It is mostly an indoor and
studio instrument. **The exception is the large traditional pot with a sponge
paddle, which produces room-shaking sub-bass.** [DOC]

**Role: a bass and pulse voice, not a lead.** The udu has a bass function in Igbo
music; it anchors without overpowering. Modern solo udu with loop pedals exists but
is a virtuoso specialty, not the default. [DOC]

**Spectral placement** [INFER, the measured figures are behind a paywall]: bass
port low, body taps in the low-mids and above, rim and ring clicks high. There is a
real hole between the airy bass and the dry taps, which is why the instrument sits
so well under other percussion.

## 18. What an udu player never does

1. **Never machine-gun the bass hole.** Continuous sixteenth bass strokes are
   physically impossible.
2. **Never a bass whoop with no release event.** The lift is audible. A bass note
   ending in clean silence is the number one giveaway.
3. **Never bend the wrong way for the gesture.** Palm *leaving* = up. Palm
   *arriving* = down. Random bidirectional bends read as fake.
4. **Never simultaneous full bass and busy fingerwork on a single-chamber pot.**
5. **Never retune mid-piece.** A melodic line implies a set of pots.
6. **Never loud sustained fast fingerwork.** Fast is quiet.
7. **Never a busy fortissimo part over a full band.** Unamplified, it loses.
8. **Never all whoops in a traditional context.** Traditional players use the hole
   sparingly and play the outside of the pot.
9. **Never one-handed speed.** Split-hand or it is not real.
10. **Never identical repeated hits.** Every stroke differs by strike location and
    hand shape. Rotate between two to four body regions.
11. **Never rigid quantisation in a traditional 6/8 setting.** The ensemble is
    interlocking and human.
12. **Never busy in an ambient context.**

---

# PART THREE — THE OTHER TRADITIONS

## 19. Clay darbuka / tabla baladi — Egypt and the Middle East

**Membrane over a clay body.** Traditional shell is fired clay (*fakhar*) with a
fish-skin head; the modern instrument is spun aluminium with a synthetic head, a
mid-twentieth-century Cairo change driven by weight and humidity. [DOC]

**Clay versus metal, and this is the most actionable sound note here** [DOC, though
stated in trade sources]: clay absorbs high frequencies where metal reflects them,
and reinforces the low-mids. Result — **warmer, earthier, a shorter and less
ringing rim stroke, a fatter and slower bass**. Fish skin adds further high-end
damping and a slower attack.

To make a sampled aluminium darbuka read as clay: roll off the top on the rim
strokes, lengthen the bass decay slightly, cut the metallic ring, and **increase
pitch variance between round-robins** — clay shells are less consistent.

**Strokes** [DOC]:

| Stroke | Hand | Where | Sound |
|---|---|---|---|
| **doum** | dominant | centre, cupped hand lifted immediately | low, resonant, full |
| **tek** | dominant | near the rim, fingertips | high, sharp, ringing |
| **ka** | **non-dominant** | rim | *a tek played with the other hand* — same pitch, weaker |
| **pa** | either | flat hand laid on the head | muted, pitchless |
| **slap** | dominant | looser fingers, other hand resting on the skin | bright, cracking, damped |

**The doum–tek–ka alternation is a hand alternation, not a free choice.** Fast
`t k t k` figures are *sticking patterns*. **Always program `ka` slightly quieter
and with a different round-robin than `tek`.** Getting this wrong is the single
thing that makes programmed darbuka sound fake.

**The rhythms.** `D` = doum, `T` = tek, `k` = ka, `t` = light tek, `S` = slap.
One character = one sixteenth. [DOC]

```
MAQSOUM        4/4   D . T . . . T . D . . . T . . .
BALADI         4/4   D . D . . . T . D . . . T . . .
SAIDI          4/4   D . T . . . D . D . . . T . . .
FELLAHI        2/4   D t . t D . t .
AYOUB          2/4   D . . . D . T .
MALFUF         2/4   D . . T . . T .
KHALEEGY       2/4   D . . D . . T .
WAHDA          8/4   D . k t . k t . D . D . T . . .
CHIFTETELLI    8/4   D . . . . . T . . . . . T . . . D . . . D . . . T . . . . . . .
MASMOUDI KEBIR 8/4   D . . . D . . . . . . . T . . . D . . . . . . . T . . . . . . .
```

Relationships worth knowing: **baladi differs from maqsoum by a second doum on the
"and" of 1** where maqsoum has a tek. **Saidi is maqsoum with the middle doum
doubled** — sometimes called upside-down baladi. Fellahi is a fast maqsoum variant.

Filled variants: maqsoum `D . T . t k T . D . t k T . t k`; baladi
`D . D . t k T . D . t k T . t k`; ayoub `D . k k D . t .`; malfuf `D . k T . k T .`.

**Malfuf's identity is its placement** — the two teks land on the "a" of 1 and the
"and" of 2. On-grid, it dies.

**KARSILAMA — 9/8 as 2+2+2+3.** Each character one eighth:
```
count:  1 + | 2 + | 3 + | 4 + +
        D . | T . | D . | T T T
```
**Must be written as 9/8 with that grouping, never as a swung 4/4.** The closing
group of three is the whole identity.

Tempo ranges are practitioner consensus, not documented: maqsoum 100–140, baladi
90–120, saidi 95–125, ayoub 70–90 in ritual use and 120–160 for show tempo, malfuf
120–180, chiftetelli 55–80 slow or 100–130 light. [ONE]

## 20. Botija — Cuba. **Blown, not struck.**

A potbellied earthenware jug with two openings, originally a **Spanish shipping
amphora** for wine and oil, dug up in late-nineteenth-century Cuba and repurposed.
**It is an aerophone.** [DOC]

**Played by blowing across an opening**, like a bottle. **Pitch is set by the water
level inside**, with the player changing note by embouchure and air pressure across
a narrow set of available pitches. A reed or tube is sometimes inserted and blown
through. [DOC]

**For writing: narrow pitch range — often just tonic and dominant — breathy, slow
attack, audible air noise. Do not program it like a plucked bass.**

**Role:** the bass voice in **changüí** and the early son sextets, chosen because it
could deliver son's **anticipated bass**, which falls between the downbeats.
Replaced first by the marímbula, then by the double bass. [DOC]

```
16ths:  1 e & a 2 e & a 3 e & a 4 e & a
bar 1:  . . . . . . 1 . . . . . 5 . . .
bar 2:  . . . . . . 5 . . . . . 1 . . .
```
[INFER for the realisation; the anticipated-bass placement is [DOC]]

**Critical negative: changüí has no son clave.** Clave had not been invented yet;
the scraper plays the downbeats. **Do not lay clave under changüí material.** [DOC]

## 21. Cántaro percutido — Spain and Mexico

**Spain** [DOC]: an ordinary clay water pitcher, **struck at the mouth, not the
body**, with the **flat of the hand**, an **espadrille sandal**, an **esparto-grass
fan**, or a **beret**. The sound is dry and low, and **pitch varies with the
position of the striking object over the mouth** — a struck Helmholtz resonator,
mechanically closer to the udu than to the ghatam. Also blown, with short dry puffs
across the mouth. Water-tuned.

**Largely extinct in its old contexts, surviving in Andalusian Christmas carol
choirs and in *sevillanas corraleras*.**

**Negative finding: there is no flamenco cántaro tradition.** The Andalusian clay
connection runs through the *villancico* and *zambomba* repertoire, which is
flamenco-adjacent socially but not flamenco. **Do not claim one.** [DOC]

**Mexico** [DOC] — the stronger surviving tradition. Found in **Tixtla (Guerrero),
the Mixteca Alta, the Costa Chica, and Puebla**, accompanying **chilenas, sones,
gustos, jarabes oaxaqueños and fandangos mixtecos** as the rhythmic anchor under a
violin-and-guitar ensemble.

A chilena is 6/8 with 3/4 hemiola. Eighth grid: [INFER]
```
count:  1 2 3 4 5 6
6/8:    X . . X . .
3/4:    X . X . X .
```
Dotted quarter around 100–130.

## 22. Zambomba — Andalusia. A friction drum.

Clay or wood body, open at one end, **animal-skin membrane** at the other, with a
**cane rod fixed perpendicular through the centre of the skin**. The hand wraps the
rod and **rubs up and down**. Friction, not impact. Low and snoring. [DOC]

The engine of the *villancico*; the **Zambomba de Jerez y Arcos** is a recognised
tradition — group singing, hand claps, a bonfire, all night.

**For writing: a sustained, pitch-unstable drone-growl.** Program as a held or
looped source with amplitude and pitch wobble at the rate of the arm stroke,
typically on the beat or on eighths around 100–130. [INFER for tempo]

## 23. Ghara — Punjab

An ordinary earthen water pitcher, about a foot high, **played with metal rings
worn on the fingers of both hands**. The rings give a bright metallic click against
the clay, and **this is the sound signature — completely unlike the ghatam, which
uses bare flesh.** Pitch and resonance are controlled by covering the mouth and
tilting the pot. Multiple gharas are often played together. Its brass counterpart,
the **gagar**, uses the same ring technique. [DOC]

**Context: giddha, boliyan and jhumar — women's folk traditions and narrative
call-and-response.** [DOC, though the women-specific framing is [ONE]]

**Correction worth carrying: the ghara is not a core bhangra instrument.**
Bhangra's drum is the **dhol**. [DOC]

Eight-beat cycle, `X` = ring click, `B` = open mouth bass, around 110–150: [INFER]
```
16ths:  1 e & a 2 e & a 3 e & a 4 e & a
        B . X X . X . X B . X X . X . X
```

## 24. Matka — Rajasthan

**Distinct in one crucial way: the Rajasthani ritual matkas are membrane-covered.**
A pair of huge earthenware pots with skin heads, **one player each**, accompanying
the sung narrative of the *Bhopa* priest-singers who perform the painted *Pabuji*
scroll. The performer's dance is part of the presentation. [DOC]

**Both open-mouthed and membrane-covered pots exist in Rajasthan** and the sources
partly conflict; flag the ambiguity rather than resolving it. The "matka" heard in
Indian pop is usually a Punjabi-style **open** pot played with rings.

Pair, low and high, eight beats, around 70–110: [INFER]
```
16ths:  1 e & a 2 e & a 3 e & a 4 e & a
LOW:    D . . . . . D . D . . . . . . .
HIGH:   . . t . t . . t . . t . t . t t
```

## 25. Kudam — Tamil Villu Paatu

Clay, **fortified with iron filings**, with **deliberately thickened walls at the
mouth**. Struck with an areca-wood paddle in some accounts and with the hands in
others; **tone modulated by the player's hand over the mouth** — again closer to
the udu than the ghatam. [DOC]

*Villu Paatu* is "bow song," musical storytelling of south Kerala and the
Kanyakumari district. The lead instrument is a literal **archer's bow strung with
jingle bells**, struck with a stick; **the kudam is tied to the bow itself**.

**A precise, citable ensemble function:** the kudam gives a **base tone of "ghum
ghum" under the high pitch of the jingling bells**. [DOC] That is the whole brief —
low end under a high-frequency ostinato.

Eight beats, narrative sections speech-paced, refrains around 100–140: [INFER]
```
16ths:  1 e & a 2 e & a 3 e & a 4 e & a
BELLS:  x x x x x x x x x x x x x x x x
KUDAM:  G . . . G . . . G . . G . . . .
```

## 26. Bu — Korean court ritual

**A clay pot struck with a bamboo whisk**, in Confucian ritual music, notably the
Munmyo Shrine rite. Derived from the Chinese *fǒu*. Belongs to the **"earth"
category** of the eight-materials classification — a doctrinal placement, not an
incidental one. Once tuned to various pitches; in the reconstructed modern rite,
generally one. [DOC]

**Role: a ritual time-marker, not a groove instrument.** The music is extremely
slow, one note per long beat, with percussion marking structural points. No pattern
is documented. [GAP]

Around 30–45 to the beat: [INFER]
```
bar:    1 . . . 2 . . . 3 . . . 4 . . .
BU:     X . . . . . . . . . . . . . . .
```

**The bamboo-whisk strike is a multi-contact brush-like transient with no sustain
and no bend.** It should read as a dry ceramic "tsh-tok," never as a drum hit.

## 27. Zarb-e zurkhaneh — Persia

A large **clay bowl with a goatskin head**, weighing ten to twenty kilos. **Two
named tones: *bam* (bass, centre) and *zir* (high, rim)** — the same binary as
doum/tek under Persian names. Played by the *morshed*, who drives athletes'
movements in the traditional gymnasium while chanting heroic poetry. Distinct from
the wooden *tombak* of Persian classical music. [DOC]

6/8, driving, accelerating across a set, around 80–130: [INFER]
```
eighths: 1 . . 2 . .
         B . z B z z
```

## 28. Tarambuka — the Balkans

A **clay goblet drum** — the same family as §19 in a Balkan context. **Fingers
only, no sticks**, with fast snaps and rolls. Arrived in Bulgaria from the Middle
East; found chiefly in the southwest, alongside the frame drum. Roma and Turkish
players are named among the finest. [DOC]

Its repertoire is Balkan **odd meters**, and they must be written as such:
**rachenitsa 7/8 as 2+2+3 · daichovo 9/8 as 2+2+2+3 · kopanitsa 11/16 as 2+2+3+2+2
· paidushko 5/8 as 2+3.**

Rachenitsa, eighth grid, brisk: [INFER]
```
count:  1 + | 2 + | 3 + +
        D . | T . | D T T
```

## 29. Negative findings — do not assert these

- **No Georgian or Caucasian struck-clay-vessel tradition** was found. The
  *diplipito* is a pair of membrane-covered clay kettles, closer to naqqara.
- **The Turkish *güveç* is a cooking pot**, not an instrument.
- **Native American clay pot drums** are historical or archaeological at best; the
  living tradition is the **wooden** water drum. That repertoire is ceremonial and
  in many cases explicitly not for casual reproduction.
- **The Afro-Peruvian *checo* and *angara* are gourds**, not clay — though they are
  worth one line as a functional parallel to the udu, since the side-hole Helmholtz
  principle is identical and only the material differs.

---

# PART FOUR — WRITING THE PART

## 30. Rules that do most of the work

1. **Pick the mechanism first** (§1). Helmholtz, membrane, or neither. Everything
   downstream depends on it.
2. **For Helmholtz instruments, the bend is the instrument.** An unmodulated
   fixed-pitch part is a wrong reproduction, not a simplified one. If the library
   samples bent and unbent strokes separately, that is a pitch choice; if it does
   not, say so rather than writing the part as though it does.
3. **The release is a note.** Especially on the udu. Program the bass as a *pair* —
   strike, seal duration, release event — not as a single hit with a clean tail.
4. **Budget the bass hand.** Two to four bass events per 4/4 bar at moderate tempo,
   never two closer than an eighth unless it is a deliberate figure.
5. **Program pots in pairs or trios at different pitches.** Documented for the Igbo
   ensemble (small voices against large), the Rajasthani pair, Punjabi multi-ghara
   practice, and modern tuned udu sets. A solo pot is the exception, not the rule.
6. **Hand alternation is physical, so encode it as velocity alternation.** Strong
   hand and weak hand differ in loudness and timbre. Uniform velocity across a fast
   run is the clearest tell.
7. **Rotate strike locations.** Varied wall thickness means every spot is a
   different note. Two to four body regions, cycled.
8. **Leave holes.** Karvai in Carnatic; sparseness everywhere else. The most common
   failure in a written percussion part is that it never stops playing.
9. **Odd meters get written as odd meters.** 9/8 as 2+2+2+3, 7/8 as 2+2+3, misra
   chapu as 3+2+2. Forcing them into 4/4 destroys them.
10. **Aim phrases at their landing, not their launch** — and in Carnatic material,
    verify the arithmetic. `(3P + 2G) + (3Q + 2H) = k × cycle_pulses`. If it does
    not sum, the cadence is wrong no matter how it feels.
11. **Say which mapping you chose.** These strokes are abstract; the artist can only
    correct you if you name the pitch you assigned to each one.

## 31. Sources and open gaps

Ghatam and Carnatic theory: Wikipedia; india-instruments.com encyclopedia; a Music
Academy lecture-demonstration report (2009); ghatamudupa.com; a 15questions.net
player interview; chandrakantha.com on the two resonators; a 2012 blog stroke list
(the sole source for the named strokes) and its derivatives; saa-uk.org; d'source
on Manamadurai making; player interviews at guftugu.in and highonscore.com; Lisa
Young, *Konnakol: The History and Development of Solkattu* (M.Mus., 1998);
Chandramouli & Sethares on automatic transcription of drum strokes (arXiv
2211.15185); the CompMusic mridangam stroke and tala datasets; the MTG ISMIR-2022
Indian Art Music tutorial; mridangams.com on the 35 talas, kalai, gati and yati;
KavyaVriksha on korvais, chapu talas, eduppu and accompaniment; rasikas.org on
korvai structure and sarvalaghu; Arunk on kanakku versus sarvalaghu;
algorithmicpattern.org on konnakol patterns.

Udu and clay pots: Wikipedia on udu, Igbo traditional music, Frank Giorgini, bell
patterns, botija, the Korean bu, zarb-e zurkhaneh and the water drum; the Baltimore
Recorders seminar notes on udu construction and the Ibibio and Yoruba names;
Anderson, Hilton & Giorgini, "Equivalent circuit modeling and vibrometry
measurements of the Nigerian-origin Udu Utar drum," *JASA* 133(3):1718–1726 (2013);
Pete Lockett's udu introduction; Eugene Skeef's field recordings from Enugu state;
garlandmag.com on the ogene-oja ensemble; a Metropolitan Museum object record for
the thigh-pressure technique; manufacturer documentation for the model families;
babayagamusic.com for the Middle Eastern rhythm grids; the Spanish-language Wikipedia
entry and the Centro de Documentación Musical de Andalucía on the cántaro; the
Instituto Andaluz del Flamenco on the Jerez zambomba; rajras.in on Rajasthani
instruments; indica.today and lokfolkmusic on Villu Paatu; Moreau's *Bulgarian Folk
Music Instruments*.

**Open gaps, named so nobody fills them with invention:**

- **No corroborated ghatam stroke-name table** beyond the single 2012 list. The
  Vikku Vinayakram instructional DVD *The Language and Technique of South Indian
  Percussion* and its PDF booklet is almost certainly the best pedagogical source in
  existence and is not available online.
- **No per-stroke damping or decay data for the ghatam**, and no documented speed
  limits for any stroke. Anything specific here is extrapolation.
- **No beat-positioned sarvalaghu grooves** available free. David Nelson's
  *Solkattu Manual* (150 lessons in Adi tala, with video for each) and Trichy
  Sankaran's textbook are the acquisitions that close this.
- **No transcribed traditional Igbo udu pattern anywhere on the open web.** Closing
  this means the ethnomusicology journals.
- **No udu tempo ranges stated in any source.** Every figure here is inference.
- **No authoritative rule for when the ghatam lays out.** The best likely source is
  a Sruti magazine guidebook article that is currently unreachable.
- **The korvai landing convention** — final syllable *on* sam versus *filling up
  to* it — differs by one pulse between sources. Worth asking a practitioner.
