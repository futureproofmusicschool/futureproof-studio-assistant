# styles/

How instruments are actually **played**. One markdown file per instrument family,
covering every tradition that plays it.

This is the third knowledge layer, and it answers a different question from the
other two:

| Folder | Question it answers | How the composer gets it |
|---|---|---|
| `reference/` | "What does the manual say?" | Searched on demand (`search_reference`) |
| `instruments/` | "Which MIDI note makes which sound in *my library*?" | Injected verbatim, `instrument` argument |
| `styles/` | "What would a real player actually play?" | Injected verbatim, `style` argument |

The split matters. `instruments/flying-hand-percussion.md` says the clay drum's
split point is D3 and the mirror pairs fan outward. `styles/clay-pot.md` says
what a ghatam player does at the top of an Adi tala cycle. Neither is derivable
from the other, and the style doc outlives the library: buy a different clay pot
sample set and the style doc still applies, only the note numbers change.

## Naming

`<instrument-family>.md`, lowercase and hyphenated. The filename without `.md`
is the name you say out loud: "write it in the ghatam style" matches
`clay-pot.md` if that doc covers ghatam, so **list the traditions a doc covers
near its top** — that is what the composer matches on.

One file per family, not per tradition. A single `clay-pot.md` holding ghatam,
udu, botija, and clay darbuka lets the composer see how the traditions differ
from each other, and lets you ask for a hybrid.

## What goes in one

Written for a frontier model that will read it once and immediately write MIDI.
Concrete beats beat adjectives. In practice:

- **The stroke vocabulary**, by name, with the sound each stroke makes and how
  it maps onto the abstract register slots (bass / open / slap / muted / click).
  Do **not** put MIDI note numbers here — those live in the instrument doc and
  change per library.
- **The rhythmic frameworks**: cycle lengths, subdivisions, where the accents
  fall, what the downbeat is called. Give beat maps, not prose.
- **Concrete patterns, written out at beat positions.** A doc with ten real
  transcribed patterns is worth more than five pages of description.
- **Phrasing rules**: how a phrase starts, builds, and cadences. What a player
  does at the top of a cycle versus the middle.
- **Tempo ranges** per tradition, and what changes at the extremes.
- **The negative space**: what a player never does. This does more to stop bad
  output than any positive instruction.
- **Ensemble role**: what this instrument plays *against*, when it doubles the
  other percussion and when it answers.

## Sourcing

These are research documents. Cite sources at the bottom, mark anything
uncertain as uncertain, and never invent stroke names or pattern names — a
plausible-sounding fake name is worse than an honest gap, because the composer
will use it with total confidence.

## Not tracked in git

Like `instruments/` and `reference/`, the docs themselves live in the external
student-data directory, and only this README is committed. The ignored `styles/`
paths in the checkout are compatibility links to that directory.

These are the studio's own research: hours of work, and not something this
public repo publishes on the studio's behalf. **Never commit a style doc.** If
you write one, it goes to the data root and the link comes back on its own from
`scripts/init-data.mjs`.
