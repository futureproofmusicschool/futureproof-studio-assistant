# instruments/

Documentation for the instruments the composer writes for lives in the external
student-data directory's `instruments/` folder. Settings shows the data root.
Use one markdown file per instrument. The filename (without `.md`) is the name
you say out loud: "write me a groove on the taiko kit" matches `taiko-kit.md`.

When a session names an instrument, **the whole file goes into the composer's
prompt verbatim**. That is the point: a frontier model reading a real articulation
map writes a part that uses the articulations, instead of a part that uses one
sample 64 times.

## What to put in one

Whatever the library's own manual says, in whatever shape it already has. The
composer is reading documentation, not parsing a format. In practice the things
that change the output most are:

- **Keyswitches**, with exact MIDI pitches. Keyswitches are just notes at those
  pitches, so the composer can place them and they work today.
- **Playable range**, and which zones sound like what.
- **Velocity layers**: what changes between soft and hard, and where the
  crossover points are.
- **Round-robins and repetition limits**: if hitting the same note twice in a row
  sounds machine-gunned, say so.
- **Performance notes**: how a real player actually uses this instrument. What
  they do on a downbeat, what they never do, what the idiomatic fills are.
- **CC controllers**, if the library has them. Note that the composer cannot
  write continuous CC lanes yet (see the limitation below), but knowing that
  mod wheel is dynamics still shapes how it writes the notes.

## Current limitation: no CC curves

Articulation via keyswitch works now. Continuous controller automation does not:
AbletonOSC has no clip-envelope handlers, so there is no way to draw a CC lane
into a clip from here. If your instrument depends on a mod-wheel swell for its
sound, the composer will get the notes right and you will draw the curve.

## Privacy

Real instrument docs live outside the Git checkout. Compatibility links may
appear beside this README, but Git ignores them. Sample-library manuals are
usually someone else's copyrighted text, and the instruments you own are
personal data.
