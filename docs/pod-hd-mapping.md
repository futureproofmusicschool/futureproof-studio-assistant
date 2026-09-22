# POD HD Bean mapping and chain assembly

The private atlas covers 60 amp/preamp models, 17 cabinets and 113 effects observed in POD HD Edit 2.27, with 1,096 parameter descriptors. Empty blocks are separate entries. FX Loop is unavailable on the Bean. Optional model packs and other POD devices are not covered.

**Coverage is not uniform confidence.** Every non-cabinet parameter descriptor was matched to a record in an editor export. Cabinet fields use calibrated fixed offsets. Individual model labels, ranges and display conversions originating in public research remain marked as candidates unless checked in the editor. A preserved byte is not proof of its audible effect. The atlas does not estimate DSP costs or claim factory defaults.

## Verified container and field layout

Offsets include the 40-byte file header. Require `H5EP`, device byte `0x28` at offset 11, and exactly 4,136 bytes. Preserve unknown fields.

| Field | Location / representation |
| --- | --- |
| Name | 32 printable ASCII bytes at `0x28`, space padded |
| Amp A / B | 256-byte blocks at `0x50` / `0x150` |
| Cab A / B | 256-byte blocks at `0x250` / `0x350` |
| Eight effects | 256-byte blocks starting `0x450` |
| Model ID | Big-endian uint32 at block start |
| Effect placement | Byte +5: pre=0, A pre=1, B pre=2, A post=3, B post=4, post mixer=5 |
| Effect order | Byte +7; composer requires a complete permutation of all eight slots |
| Enabled / slot presence | Byte +8 and +11 respectively, 0/1; presence is independent of bypass |
| Tempo subdivision | Byte +9: Off=0, Whole=2, then dotted/straight/triplet half through 64th, ending at 20 |
| Stereo Delay right tempo subdivision | Byte +10, same subdivision codes as the left side |
| Footswitch | Byte +12: none=0, FS1..FS8=1..8, all eight checked in the editor |
| Parameter records | Start +16, stride 20: ID, current, minimum, maximum (four bytes each), controller byte, three preserved bytes |
| Expression source | Record +16: Off=0, EXP1=1, EXP2=2, Tweak=3 |
| Continuous values | Big-endian float32, usually normalized 0–1 |
| Discrete values | Model-dependent normalized float or signed big-endian int32; do not infer from numeric appearance |
| Early reflections | Float at `0xd74` (A), `0xd7c` (B) |
| Cab low cut / resonance / thump / decay | Float at cab block +20 / +40 / +60 / +80 |
| Microphone | Byte `0x1020` (A), `0x1021` (B); cabinet-specific choices |
| Preset tempo | Float BPM at `0xd80` |
| Mixer pan | Float −1..1 at `0xd84` / `0xd88` |
| Mixer level | Float dB at `0xd8c` / `0xd90` |
| Guitar impedance | Byte `0xdfa`: Auto, 22K, 32K, 70K, 90K, 136K, 230K, 1M, 3.5M = 0..8 |
| Inputs | Bytes `0x1026` / `0x1027`; Guitar=1, Mic=2; input 2 Same=0 |

Main amp parameter IDs are `0x3f100003` Drive, `...000` Bass, `...001` Mid, `...002` Treble, `...004` Presence, `...005` Channel Volume. Flip Top labels the middle bands Lo Mid and Hi Mid. Full amp deep IDs: Master `...00b`, Sag `...008`, Hum `...007`, Bias `...009`, Bias X `...00a`. Identify these by ID, not by offsets from another device's documentation. Preamp models expose only the six main amp controls.

Guitar microphones 0..7: 57 On Axis, 57 Off Axis, 409 Dynamic, 421 Dynamic, 4038 Ribbon, 121 Ribbon, 67 Condenser, 87 Condenser. Flip Top cabinet microphones 0..7: 57 On Xs, 421 Dyn, 12 Dyn, 112 Dyn, 20 Dyn, 7 Dyn, 40 Dyn, 47 Cond.

## Evidence

Controlled exports cover main/deep amp controls, cabinet controls, both amp paths, mixer, expression assignments and ranges, inputs, all impedance choices, all tempo subdivisions, and both microphone menus. Generated probes checked percentages, signed pitch intervals, dB ranges, milliseconds, frequency controls, discrete choices, BPM and routing.

The final coverage ledger contains **177 three-point model probes**: 87 effect probes covering all 113 effects and 90 amp probes covering all 60 amps/preamps. All preserve bytes outside their names on editor export. Four corrected discrete probes replace invalid intermediate or upper-bound choices: Seeker Steps, Synth O Matic Wave, Studio EQ frequencies, and Vintage Pre Phase. Models and displayed sweep values were reviewed; changing several controls together does not independently prove each parameter ID's meaning.

Three additional generated probes verified Stereo Delay independent left/right sync, all eight footswitch assignments, and an EXP1 20–80% controller range. Both final TypeScript-generated example chains round-tripped cleanly and matched the Python writer byte for byte.

Four earlier generated presets also passed editor import/export with **no differences outside their names**: a serial amp/effects chain, an encoding probe, a lower-path probe, and an app-generated dual-amp chain with separate cabinets and branch effects. Save As changes the embedded name; comparisons report that separately rather than ignoring all differences. Hardware memory and audible response were not tested. The editor's full 512-preset bundle was restored and matched its original backup byte for byte.

The raw corpus, SHA-256 evidence, bundle backup, recipes and atlas belong in the external data root under `pod-hd/mapping/`, never in the public checkout. `research-2026-09-20/evidence.json` records controlled pairs and failed/ambiguous experiments are not promoted by filename alone. `coverage-final.json` records the effective sweeps, corrected probe selection, final chain checks and hashes. `restoration-after-sweep.json` records the final backup equality.

## Reproduce the research

```sh
python3 scripts/pod-hd/map.py inspect /path/to/preset.hbe
python3 scripts/pod-hd/map.py diff /path/to/before.hbe /path/to/after.hbe
python3 scripts/pod-hd/map.py candidates /path/to/external/lpedit-lib/model/pod > /private/path/candidates.json
python3 scripts/pod-hd/atlas.py /private/path/exports /private/path/candidates.json /private/path/atlas.json
python3 scripts/pod-hd/evidence.py /private/path/exports > /private/path/evidence.json
python3 scripts/pod-hd/assemble.py /private/path/template.hbe /private/path/atlas.json /private/path/recipe.json /private/path/output.hbe
python3 -m unittest discover -s scripts/pod-hd -p 'test_*.py'
```

Atlas and output creation refuse existing destinations. Install the private atlas at the external data root's `pod-hd/mapping/atlas.json`. Both the standalone Python writer and app TypeScript writer use the same recipe format; their encoding probe outputs were identical.

## App usage and recipe contract

In Talk, request a POD HD chain using an imported template. `list_pod_hd_models` searches the installed atlas; `read_pod_hd_preset` exposes the template's block IDs and routing. `create_pod_hd_chain` writes an immutable preset plus an assembly receipt. The Settings panel retains simple amp variations, downloads, editor handoff and readback comparison.

Recipes contain `name`, `blocks` keyed `ampA`, `ampB`, `cabA`, `cabB`, `fx1`..`fx8`, and optional `tempo`, `mixer`, `routing`. Each replacement names a catalog `model` ID and may supply `enabled`, `parameters` (raw normalized floats or signed choice codes), or `displayParameters` (catalog units or choice labels). Cabinet keys are `CabERID`, `CabLowCutID`, `CabResLevelID`, `CabThumpID`, `CabDecayID`, `CabMicID`. Display conversions require explicit `allowCandidateConversions: true` because their per-model confidence varies.

A block can also set `footswitch` (0–8), `tempoSync` (0 or 2–20), and Stereo Delay alone supports independent `tempoSyncRight`. `controllers` maps parameter IDs to `{source, minimum, maximum}`: source is 0–3 and endpoints use the parameter's raw encoding. Invalid fractional menu choices are rejected rather than producing blank editor fields.

Routing maps `pre`, `aPre`, `bPre`, `aPost`, `bPost`, `post` to ordered arrays of FX slot names. Include all eight slots exactly once, including empty slots. Branch placements require a parallel-amp template; amp topology itself is preserved. Omitted blocks retain their original bytes and assignments. Replaced blocks clear expression assignments and default to no footswitch assignment, preserving unknown bytes from the captured block. Captured settings are not factory defaults; request important tone controls explicitly.

Every assembled chain returns `requiresEditorValidation: true` and `savedToHardware: false`. Import it into POD HD Edit, inspect displayed values, routing and DSP warnings, then export a comparison copy. USB Send/Receive remains a separate editor workflow.

## Sources and remaining limits

The installed **POD HD Edit User Manual** explains the editor's knob-value displays, routing, tempo and controller behavior. Candidate model/parameter facts originate in [lpedit-lib's model definitions](https://github.com/StarAurryon/lpedit-lib/tree/master/model/pod), with container observations from [podhd format notes](https://github.com/johanneszab/podhd/tree/master/docs). No third-party implementation is vendored; public research is kept distinct from Bean observations.

This is a comprehensive structured inventory and an operational chain writer, **not exhaustive semantic calibration of every parameter on every model**. Remaining research includes independent one-control-at-a-time semantic calibration, every intermediate discrete choice, factory defaults, DSP cost prediction, optional packs, global-only settings, and audible/controller behavior on hardware. Three-point model sweeps and all eight footswitch assignments are complete. The atlas preserves these confidence limits; it does not silently upgrade candidates to verified fields.
