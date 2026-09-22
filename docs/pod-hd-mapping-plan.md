# POD HD parameter mapping plan

## Execution status

Implemented: Bean inventory (60 amps, 17 cabinets, 113 effects), 1,096 parameter descriptors with structural evidence, private export/backup archive, calibrated shared encodings and global fields, reproducible inspection/diff/atlas/assembly tools, app model search and chain creation, 177 clean three-point model probes, three shared-control round trips, and two final cross-writer chain round trips in addition to the four earlier examples. The original 512-preset editor bundle was restored byte for byte. See [results and confidence limits](pod-hd-mapping.md).

Three-point sweeps now cover every inventoried amp and effect. The stronger step 4 requirement—independent one-control-at-a-time calibration, every discrete choice, and factory defaults—is **not complete**. Model-specific research conversions remain candidates. This distinction is retained in the atlas and required editor review; inventory coverage is not reported as exhaustive semantic validation.

## Target and acceptance criteria

Scope is POD HD Desktop (Bean) only, using POD HD Edit 2.27. Other POD devices are deferred. Track editor version and installed model packs; observations from other devices remain candidates until verified in the Bean editor.

For every supported model, record category, numeric ID, parameter order, labels, encoding, range, units, default, discrete choices, tempo-sync behavior, controller assignments, and device availability. Record routing, two amp paths where supported, cabinet/microphone options, mixer, input configuration, tempo, bypass, and container formats separately.

A field is verified only with attributable evidence: an editor-controlled export pair, inspection of a generated preset in that editor, and an export round trip. An unchanged round trip alone proves byte preservation, not parameter meaning. Public research is a candidate map, not verification. DSP feasibility and audible behavior require separate evidence.

## Execution

1. Preserve the running editor's state as a private bundle; perform experiments on an editor buffer, never Send to hardware. Inventory available editors and versions.
2. Collect public format observations and official manuals. Build a device/capability matrix with explicit unknowns and sources.
3. Implement an offline inspector and differential analysis harness. Preserve all unknown bytes, reject ambiguous formats, and retain raw observations privately. Compare float32 and integer interpretations; retain all changed ranges instead of assuming a single changed byte.
4. Establish Bean baseline exports. Change one control at a time through the editor, export, inspect the delta, generate a matching change independently, reopen and confirm the displayed value. Capture defaults on model selection. Sweep continuous controls at endpoints and intermediate values; enumerate discrete controls completely.
5. Cover categories: dynamics, distortion, modulation, filter, pitch, EQ/preamp, delay, reverb, volume/pan, wah, FX loop; both amp blocks and deep controls; cabinets/mics; mixer; routing and block placement; input/global settings; expression/footswitch assignments; tempo sync.
6. Repeat for every model available in the Bean editor, including preamp variants and installed model packs. Check unsupported models and DSP constraints. Cross-device conversion is out of scope.
7. Promote only verified mappings into the production writer. Current implementation keeps candidate display conversions behind explicit opt-in and requires editor validation for every generated chain; this is an interim capability, not satisfaction of exhaustive calibration. Build complete chains from editor-generated block defaults, validate block counts/routing/model availability, and preserve platform-specific fields.
8. Test import/export and arbitrary chain generation in the Bean editor. Report coverage by device, model and field, plus rejected/missing combinations. Keep hardware transport independent of file-format validation.

## Deliverables

Machine-readable candidate catalog, explicit evidence/coverage ledger, repeatable CLI inspection/diff/verification, tests using synthetic data, and private editor observations. Full completion requires every supported field on the Bean to have editor evidence, or an explicit unsupported classification grounded in that editor. A catalog of model names alone is not completion.
