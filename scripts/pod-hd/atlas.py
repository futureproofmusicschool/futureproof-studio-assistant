#!/usr/bin/env python3
"""Build a private, provenance-bearing Bean block atlas from editor exports.

Snapshots are not factory defaults. Candidate display conversions stay marked as
research until a controlled editor experiment establishes their meaning.
"""
import argparse
import collections
import importlib.util
import json
import pathlib
import struct

spec = importlib.util.spec_from_file_location('pod_map', pathlib.Path(__file__).with_name('map.py'))
mapping = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapping)


def build(folder, catalog):
    observations = collections.defaultdict(list)
    def capture_priority(path):
        # Prefer model-selection captures to later endpoint/control experiments.
        rank = 0 if path.name.startswith(('amp-model-', 'amp-first.', 'fx-')) else 1
        return rank, path.name
    for path in sorted(folder.glob('*.hbe'), key=capture_priority):
        data = mapping.read(path)
        preset = mapping.inspect(data)
        for block in preset['blocks']:
            observations[block['modelId']].append({
                'file': path.name, 'sha256': preset['sha256'], 'block': block['block'],
                'offset': block['offset'], 'bytes': data[block['offset']:block['offset'] + 256].hex(),
                'parameters': block['parameters'],
            })
    models = []
    for candidate in catalog['models']:
        item = dict(candidate)
        samples = observations.get(item['id'], [])
        required = {p['id'].lower() for p in candidate['parameters'] if p['id'].startswith('0x')}
        for sample in samples:
            sample['completeParameterLayout'] = required.issubset({p['id'] for p in sample['parameters']})
        samples.sort(key=lambda sample: not sample['completeParameterLayout'])
        item['availability'] = 'editor-observed' if samples else 'not-observed'
        if item['label'] == 'FX Loop':
            item['availability'] = 'unsupported-on-bean'
        layouts = collections.defaultdict(set)
        for sample in samples:
            for parameter in sample['parameters']:
                layouts[parameter['id']].add(parameter['offset'] - sample['offset'])
        item['parameters'] = []
        for source in candidate['parameters']:
            parameter = dict(source)
            parameter['id'] = source['id'].lower() if source['id'].startswith('0x') else source['id']
            if item['id'] == '0x020a001a' and parameter['id'] == '0x3f100003':
                parameter['indexShift'] = 1
                parameter['status'] = 'bean-editor-calibrated'
            if item['id'] in ('0x0007005b','0x0007005c'):
                parameter['label'] = {'0x3f100001':'Lo Mid','0x3f100002':'Hi Mid'}.get(parameter['id'],parameter['label'])
            if item['label'].startswith('Super O') and parameter['id'] == '0x3f100001':
                parameter['label'] = 'Tone'
            if item['label'].startswith(('Class A-15', 'Class A-30')) and parameter['id'] == '0x3f100001':
                parameter['label'] = 'Cut'
            if item['label'].startswith('Divide 9/15'):
                parameter['label'] = {'0x3f100003':'Drive 1','0x3f100000':'Drive 2','0x3f100001':'Tone','0x3f100002':'Cut'}.get(parameter['id'],parameter['label'])
            if item['id'] == '0x01070012' and source['id'] == 'CabMicID':
                parameter['choices'] = ['57 On Xs','421 Dyn','12 Dyn','112 Dyn','20 Dyn','7 Dyn','40 Dyn','47 Cond']
                parameter['status'] = 'bean-editor-calibrated'
            parameter['valueOffsetsInBlock'] = sorted(layouts.get(parameter['id'], []))
            parameter['structureStatus'] = 'editor-observed' if parameter['valueOffsetsInBlock'] else 'unresolved'
            if item['kind'] == 'amp' and 'Preamp' in item['label'] and parameter['id'] in ('0x3f10000b','0x3f100008','0x3f100007','0x3f100009','0x3f10000a'):
                parameter['editable'] = False
                parameter['availabilityNote'] = 'Power-amp controls are not exposed for preamp models; retained bytes are not functional evidence.'
            if item['kind'] == 'cab':
                fixed = {'CabLowCutID':20, 'CabResLevelID':40, 'CabThumpID':60, 'CabDecayID':80}
                if source['id'] in fixed:
                    parameter['valueOffsetsInBlock'] = [fixed[source['id']]]
                    parameter['structureStatus'] = 'shared-cabinet-layout-calibrated'
                elif source['id'] in ('CabERID','CabMicID'):
                    parameter['globalOffsets'] = [0xd74,0xd7c] if source['id']=='CabERID' else [0x1020,0x1021]
                    parameter['structureStatus'] = 'global-field-calibrated'
            item['parameters'].append(parameter)
        known = {p['id'] for p in item['parameters']}
        item['unlabelledRecords'] = {key: sorted(value) for key, value in layouts.items() if key not in known}
        item['snapshots'] = samples
        models.append(item)
    for model_id, kind in [('0x0007ffff', 'amp'), ('0x0107ffff', 'cab'), ('0x020dffff', 'effect')]:
        if observations.get(model_id):
            models.append({'id': model_id, 'kind': kind, 'label': 'None', 'category': kind,
                           'availability': 'editor-observed', 'parameters': [], 'unlabelledRecords': {},
                           'snapshots': observations[model_id]})
    return {
        'schemaVersion': 1, 'device': 'POD HD Bean', 'editor': 'POD HD Edit 2.27',
        'source': catalog['source'],
        'notice': 'Private editor snapshots, not factory defaults. Observed IDs do not verify display semantics or DSP feasibility.',
        'counts': dict(collections.Counter(m['kind'] for m in models if m['availability'] == 'editor-observed' and m['label'] != 'None')),
        'models': models,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=pathlib.Path)
    parser.add_argument('catalog', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    atlas = build(args.folder, json.loads(args.catalog.read_text()))
    # Do not overwrite prior evidence accidentally.
    with args.output.open('x') as output:
        json.dump(atlas, output, indent=2, allow_nan=False)
    args.output.chmod(0o600)
    print(json.dumps({'counts': atlas['counts'], 'output': str(args.output)}))


if __name__ == '__main__':
    main()
