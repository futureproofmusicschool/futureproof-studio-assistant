# POD HD Bean workflow

Settings → POD HD Bean stores imported `.hbe` templates and immutable variations in the external data root's `pod-hd/` directory. Each variation records its parent and SHA-256. Type or say “make a POD HD variation with 25 percent drive,” or use Settings. Tools can list/read presets, create variations and request that the installed macOS editor open them.

## Transfer

1. Preserve unsaved editor changes. Receive presets from the connected device in POD HD Edit, then File → Save Bundle As for a full backup.
2. Select the destination setlist/channel before opening the generated preset: opening replaces that editor channel.
3. Review and audition, then Send → Selected writes it to the device.
4. Receive → Selected reads the saved device preset back. File → Save As exports it. Upload that export under Compare device readback.

Comparison checks every byte. A match proves equality with the uploaded export; hardware provenance depends on actually receiving it from the device. Both matching and mismatching exports are retained separately. Launching the editor is never reported as a confirmed load or hardware save.

## Scope

This is an editor-assisted workflow, not a direct USB driver. Hardware backup, slot selection, auditioning, Send and Receive remain in POD HD Edit. The app does not detect device connection or automate those controls. macOS handoff uses Launch Services with a fixed application and internally generated path. Other platforms can download files.

The writer requires `H5EP`, Desktop device byte `0x28`, and 4136 bytes. Simple variations edit the 32-byte ASCII name and first-amplifier Drive, Bass, Mid, Treble, Presence and Channel Volume. Explicit percentages become normalized big-endian float32. Omitted controls and all other bytes, including controller assignments, are preserved. Existing assignments can affect audible values.

With a private Bean mapping atlas installed, Talk can also search models and assemble amp, cabinet and effect blocks, parameter values, mixer settings, tempo and effect placement. Amp topology comes from the chosen template. New chains are immutable and carry source receipts; they require editor validation for displayed values and DSP feasibility. See [mapping coverage, evidence and recipe format](pod-hd-mapping.md). All six main amp controls now have controlled editor evidence. Generated serial and dual-amp chains passed editor round trips. No third-party implementation is copied or vendored.

References: installed **POD HD Edit User Manual**, Workflow pp. 1–4 through 1–6 and GUI Overview p. 2–1; [public format observations](https://github.com/johanneszab/podhd/tree/master/docs). HD500X USB implementations are not evidence of Bean compatibility.
