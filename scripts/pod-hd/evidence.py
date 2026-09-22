#!/usr/bin/env python3
"""Reproduce controlled Bean export diffs and round-trip evidence privately."""
import argparse
import hashlib
import importlib.util
import json
import pathlib

spec = importlib.util.spec_from_file_location('pod_map', pathlib.Path(__file__).with_name('map.py'))
mapping = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapping)

# Export names describe experiments, not necessarily successful edits. Claims
# below reflect observed UI values and actual deltas, including failed attempts.
PAIRS = [
 ('baseline','amp-bass-17','Amp A bass 17 percent'),
 ('amp-bass-17','amp-mid-29','Amp A mid 29 percent'),
 ('amp-mid-29','amp-treble-41','Amp A treble 41 percent'),
 ('amp-treble-41','amp-presence-53','Amp A presence 53 percent'),
 ('amp-presence-53','amp-volume-65','Amp A channel volume 65 percent'),
 ('amp-volume-65','amp-er-23','Cab A early reflections 23 percent'),
 ('dual-amp-light-chain','amp-master-min','Amp A master minimum'),
 ('amp-master-min','amp-sag-min','Amp A sag minimum'),
 ('amp-sag-min','amp-hum-min','Amp A hum minimum'),
 ('amp-hum-min','amp-bias-min','Amp A bias minimum'),
 ('amp-bias-min','amp-biasx-min','Amp A bias excursion minimum'),
 ('amp-biasx-min','cab-lowcut-max','Cab A low cut maximum'),
 ('cab-lowcut-max','cab-reslevel-min','Cab A resonance minimum'),
 ('cab-reslevel-min','cab-thump-min','Cab A thump minimum'),
 ('cab-thump-min','cab-decay-min','Cab A decay minimum'),
 ('fx-pitch-isolated','pitch-glide-plus12','Pitch Glide plus 12 semitones'),
 ('pitch-glide-plus12','harmony-key-d','Smart Harmony key D'),
 ('harmony-key-d','harmony-minus5th','Smart Harmony minus fifth, signed integer minus four'),
 ('tempo-preset-145-5','mixer-a-minus6-center','Mixer A minus 6 dB, centered'),
 ('mixer-a-minus6-center','mixer-b-minus9-pan25','Mixer B minus 9 dB, 25 percent right'),
 ('mixer-b-minus9-pan25','route-fx1-post','Move FX1 to post mixer'),
 ('route-fx1-post','route-amp-a-upper','Move amp A to parallel upper path'),
 ('route-fx1-path-a-pre','route-fx1-upper-branch','Move FX1 to upper preamp path'),
 ('route-fx1-upper-branch','route-fx1-upper-post','Move FX1 to upper postamp path'),
 ('amp-drive-exp1-20-80','amp-drive-exp1-fullrange','EXP1 bounds zero to one; typed bounds in prior filename were not applied'),
 ('amp-drive-exp1-fullrange','amp-a-fs1','Amp A bypass assigned FS1'),
 ('amp-a-fs1','amp-drive-exp2','EXP2 assignment also moves live current value'),
 ('amp-drive-exp2','amp-drive-tweak','Tweak assignment also moves live current value'),
 ('amp-drive-tweak','input1-mic','Input 1 microphone'),
 ('input1-mic','input2-guitar','Input 2 guitar'),
 ('generated-chain-roundtrip','delay-off-777ms','Digital Delay sync off and 777 milliseconds'),
 ('delay-off-777ms','delay-quarter-sync','Quarter-note sync; stored free time unchanged'),
 ('delay-quarter-sync','plate-calibration','Plate decay 47 percent, predelay 73 ms, tone 61 percent, mix 29 percent'),
 ('encoding-probe-roundtrip','vintage-lpf-min','Vintage Pre LPF 5 kHz endpoint'),
 ('vintage-lpf-min','vintage-lpf-max','Vintage Pre LPF 20 kHz endpoint'),
 ('lower-post-probe','cab-b-er34','Cab B early reflections 34 percent at 0xd7c, not 0xd78'),
]
ROUNDTRIPS = [('generated-chain','generated-chain-roundtrip'), ('encoding-probe','encoding-clean-roundtrip'), ('routing-probe','routing-probe-roundtrip'), ('mapped-dual-chain','mapped-dual-chain-roundtrip')]


def report(folder):
    result = {'device': 'POD HD Bean', 'editor': 'POD HD Edit 2.27', 'calibrations': [], 'roundTrips': [], 'missing': []}
    for before, after, claim in PAIRS:
        if not all((folder / (name + '.hbe')).exists() for name in [before, after]):
            result['missing'].append([before, after]); continue
        a, b = [mapping.read(folder / (name + '.hbe')) for name in [before, after]]
        result['calibrations'].append({'claim': claim, 'before': before, 'after': after,
            'beforeSha256': hashlib.sha256(a).hexdigest(), 'afterSha256': hashlib.sha256(b).hexdigest(), 'delta': mapping.diff(a,b)})
    for before, after in ROUNDTRIPS:
        a, b = [mapping.read(folder / (name + '.hbe')) for name in [before, after]]
        delta = mapping.diff(a,b)
        result['roundTrips'].append({'before': before, 'after': after, 'equalExceptName': not delta['words'], 'delta': delta})
    result['tempoChoices'] = []
    names = ['Off','Whole','Dotted half','Half','Triplet half','Dotted quarter','Quarter','Triplet quarter','Dotted eighth','Eighth','Triplet eighth','Dotted sixteenth','Sixteenth','Triplet sixteenth','Dotted thirty-second','Thirty-second','Triplet thirty-second','Dotted sixty-fourth','Sixty-fourth','Triplet sixty-fourth']
    for index, label in enumerate(names):
        file = 'tempo-choice-00' if index == 0 else 'sync-whole' if index == 1 else f'sync-menu-{index:02d}'
        path = folder / (file + '.hbe')
        if path.exists(): result['tempoChoices'].append({'label': label, 'value': mapping.read(path)[0x859], 'file': path.name})
    result['impedanceChoices'] = []
    for index, label in enumerate(['Auto','22K','32K','70K','90K','136K','230K','1M','3.5M']):
        path = folder / f'impedance-{index:02d}.hbe'
        if path.exists(): result['impedanceChoices'].append({'label': label, 'value': mapping.read(path)[0xdfa], 'file': path.name})
    result['limits'] = [
        'All model IDs are editor-observed; not all model-specific display semantics have individual calibration.',
        'Captured blocks are selection snapshots, not reset factory defaults.',
        'No USB Send or hardware readback was performed.',
        'Optional uninstalled model packs and other POD devices are outside this atlas.',
        'DSP costs and audible behavior are not inferred from byte preservation.',
    ]
    result['microphoneChoices'] = {}
    for prefix, labels in [('mic-choice',['57 On Axis','57 Off Axis','409 Dynamic','421 Dynamic','4038 Ribbon','121 Ribbon','67 Condenser','87 Condenser']), ('bass-mic',['57 On Xs','421 Dyn','12 Dyn','112 Dyn','20 Dyn','7 Dyn','40 Dyn','47 Cond'])]:
        result['microphoneChoices'][prefix] = [{'label':label,'value':mapping.read(folder / f'{prefix}-{index:02d}.hbe')[0x1020]} for index,label in enumerate(labels)]
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=pathlib.Path)
    args = parser.parse_args()
    print(json.dumps(report(args.folder), indent=2, allow_nan=False))
