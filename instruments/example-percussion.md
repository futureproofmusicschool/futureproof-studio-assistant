# Example Percussion Kit

A generic hand-percussion kit, written out as an example of the shape an
instrument doc takes. Replace this with your own library's real documentation.

## Keyswitches

Keyswitches live below the playable range and latch until the next one. Place
them as very short notes (0.05 beats is plenty) slightly before the note they
should affect.

| Pitch | Note name | Articulation |
|-------|-----------|--------------|
| 24    | C0        | Open hit (default) |
| 25    | C#0       | Muted / palm-damped |
| 26    | D0        | Rim |
| 27    | D#0       | Roll |
| 28    | E0        | Flam |

## Playable range

| Pitch range | Zone | Character |
|-------------|------|-----------|
| 36-40       | Low drums | Deep, slow decay. The pulse lives here. |
| 41-47       | Mid drums | The conversational register; most phrasing happens here. |
| 48-55       | Hand percussion | Shakers, blocks, bells. Short, dry, cuts through. |
| 56-60       | Metals | Long decay. One hit fills a bar; use sparingly. |

## Velocity layers

Four layers, crossing over at velocity 40, 75, and 105.

- **1-39** — finger taps. Almost inaudible in a mix; use for ghost notes between
  the real hits, which is where the groove actually comes from.
- **40-74** — normal playing. Most of a part sits here.
- **75-104** — accents.
- **105-127** — full-force hits. Two or three in a phrase, not twenty.

## Round-robins

Three round-robins per zone. Four or more identical velocities in a row on the
same pitch will expose the loop and sound machine-gunned. Vary velocity by at
least 5 between consecutive hits on the same pitch.

## Performance notes

- A real player is never metronomic. Hand percussion pushes slightly ahead on
  accents and drags behind on ghost notes; a few milliseconds either side of the
  grid is what makes it sound played rather than programmed.
- Low drums carry the pulse and should not be busy. If the low register is
  playing sixteenths, the part has stopped sounding like an instrument.
- Rolls (keyswitch 27) are entered on the beat before the target and released
  onto it. A roll that starts and stops on the same beat sounds like a mistake.
- Flams (keyswitch 28) are for phrase starts and downbeats after a gap, not for
  general accenting.
- Leave space. The most common failure in a written percussion part is that it
  never stops playing.

## Controllers

- **CC1 (mod wheel)** — overall dynamics, layered on top of velocity.
- **CC11 (expression)** — room mic blend; higher is wetter and further back.

The composer cannot write CC curves into a clip yet, so set these by hand or with
`set_live_device_parameter`.
