# reference/

The reference shelf lives in the external student-data directory's `reference/`
folder. Settings shows its exact location. Drop full manuals and documentation
there — sample libraries, plugins, hardware — and the assistant can search them
when you ask technical questions.

## How to use it

1. Put the file in the data directory's `reference/` folder. **PDF, .docx, .md, and .txt** all work; no
   conversion needed. The first search extracts text automatically (cached in
   `.cache/`, which you can delete any time).
2. Ask out loud: "check the Snoop manual — what are the snare keyswitches?"
   The assistant searches the shelf first and tells you where the answer came
   from. If the shelf has nothing, it falls back to a web search preferring
   official documentation.

The filename is how you refer to the document, so name files the way you'd say
them: `snoop-percussion.pdf`, not `SNP_UserGuide_v2.1_FINAL.pdf`.

## Limits

- Scanned-image PDFs have no text to extract; export them as text first.
- Files over 30MB are refused; split them.
- This is a shelf, not a library: a handful of manuals searches well. Hundreds
  would want a real index.

## reference/ vs instruments/

`reference/` holds the **whole manual**, searched section by section on demand.
`instruments/` holds a **short distilled articulation doc** that goes verbatim
into the composer's prompt when writing MIDI. A good workflow: shelve the
manual here, then ask the assistant to write the `instruments/` doc from it.

## Privacy

Manuals live outside the Git checkout. Compatibility links may appear beside
this README, but Git ignores them. Manuals are usually someone else's
copyrighted text, and what you own is your business. Your documents never leave
your machine.
