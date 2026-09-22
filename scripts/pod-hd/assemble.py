#!/usr/bin/env python3
"""Assemble an experimental Bean preset from a private editor-observed atlas.

Never accesses USB. The resulting chain MUST be opened and checked in POD HD
Edit for routing, displayed values and DSP limits before any hardware transfer.
Existing template routing is retained; this is not a DSP cost estimator.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import struct

spec = importlib.util.spec_from_file_location('pod_map', pathlib.Path(__file__).with_name('map.py'))
mapping = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapping)


def bounded(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'Expected a finite number from {low} to {high}')
    return value


def encode(parameter, value, display=False):
    """Display conversions are explicitly experimental; raw values are typed."""
    kind = parameter['candidateEncoding']
    if kind == 'ListParam':
        choices = parameter['choices']
        if display:
            if value not in choices: raise ValueError(f'Expected one of {choices}')
            index = choices.index(value)
            value = index + parameter.get('indexShift', 0) if parameter.get('binaryType') == 'Int32Type' else index / max(1, len(choices) - 1 + parameter.get('indexShift', 0))
        if parameter.get('binaryType') == 'Int32Type':
            bounded(value, parameter.get('indexShift', 0), len(choices) - 1 + parameter.get('indexShift', 0))
            if int(value) != value: raise ValueError('Expected an integer choice')
            return struct.pack('>i', int(value))
        denominator = max(1, len(choices) - 1 + parameter.get('indexShift', 0))
        choice = bounded(value, 0, (len(choices) - 1) / denominator) * denominator
        if abs(choice - round(choice)) > 1e-5: raise ValueError('Use a named choice or exact encoded choice value')
    elif display:
        bounds = parameter['bounds']
        if kind == 'PerCentParam': low, high = 0, 100
        elif kind == 'TimeParam': low, high = 0, bounds['maxMs']
        elif kind in ('FreqParam', 'FreqKParam', 'RangeParam', 'TempoFollowerParam'): low, high = bounds['min'], bounds['max']
        else: raise ValueError('Unknown display conversion')
        value = (bounded(value, low, high) - low) / (high - low)
    return struct.pack('>f', bounded(value, 0, 1))


def assemble(template, atlas, recipe):
    # Reuse strict container checks even when called as a library.
    if len(template) != 4136 or template[:4] != b'H5EP' or template[11] != 0x28:
        raise ValueError('Expected a Bean preset template')
    allowed = {'name', 'blocks', 'tempo', 'mixer', 'routing', 'allowCandidateConversions'}
    if set(recipe) - allowed: raise ValueError('Unknown recipe fields')
    if atlas.get('schemaVersion') != 1 or atlas.get('device') != 'POD HD Bean': raise ValueError('Wrong atlas device/version')
    output = bytearray(template)
    name = recipe.get('name')
    if not isinstance(name, str) or not name.strip() or not 1 <= len(name) <= 32 or any(not 32 <= ord(c) <= 126 for c in name):
        raise ValueError('Name must be 1–32 printable ASCII characters')
    output[40:72] = name.encode('ascii').ljust(32, b' ')
    models = {model['id']: model for model in atlas['models']}
    blocks = dict(mapping.BLOCKS)
    receipt = []
    for target, request in recipe.get('blocks', {}).items():
        if target not in blocks: raise ValueError(f'Unknown block {target}')
        if set(request) - {'model', 'snapshot', 'enabled', 'parameters', 'displayParameters', 'tempoSync', 'tempoSyncRight', 'footswitch', 'controllers'}:
            raise ValueError(f'Unknown fields for {target}')
        base = blocks[target]
        model = models.get(request['model'])
        expected_kind = 'amp' if target.startswith('amp') else 'cab' if target.startswith('cab') else 'effect'
        if not model or model['kind'] != expected_kind or model['availability'] != 'editor-observed':
            raise ValueError(f'Model unavailable for {target}')
        samples = model['snapshots']
        sample_index = request.get('snapshot', 0)
        if type(sample_index) is not int or not 0 <= sample_index < len(samples): raise ValueError('Invalid snapshot index')
        sample = samples[sample_index]
        if sample.get('completeParameterLayout') is False: raise ValueError('Incomplete captured parameter layout; choose a complete snapshot')
        data = bytearray.fromhex(sample['bytes'])
        if len(data) != 256 or f'0x{struct.unpack_from(">I", data)[0]:08x}' != model['id']: raise ValueError('Corrupt atlas block')
        data[4:8] = output[base+4:base+8]  # Preserve template topology and order.
        enabled = request.get('enabled', True)
        if type(enabled) is not bool: raise ValueError('enabled must be boolean')
        data[8] = int(enabled and model['label'] != 'None')
        data[11] = int(model['label'] != 'None')
        if expected_kind == 'effect': data[9:11] = b'\x00\x00'
        footswitch = bounded(request.get('footswitch', 0), 0, 8)
        if int(footswitch) != footswitch: raise ValueError('Footswitch must be an integer')
        data[12] = int(footswitch)
        if 'tempoSync' in request:
            sync = request['tempoSync']
            if type(sync) is not int or sync not in [0, *range(2, 21)]: raise ValueError('Unknown tempo sync value')
            if not any(p['candidateEncoding'] == 'TempoFollowerParam' for p in model['parameters']) and model['id'] not in ('0x02030026','0x02030027'): raise ValueError('Model has no tempo follower')
            data[9] = sync
        if 'tempoSyncRight' in request:
            sync = request['tempoSyncRight']
            if model['id'] != '0x02020013' or type(sync) is not int or sync not in [0, *range(2, 21)]: raise ValueError('Right tempo sync requires Stereo Delay')
            data[10] = sync
        # New blocks must not inherit live expression assignments from captures.
        offsets = {}
        for offset in range(16, 237, 20):
            pid = struct.unpack_from('>I', data, offset)[0]
            if pid >> 24 == 0x3f:
                offsets[f'0x{pid:08x}'] = offset + 4
                data[offset+16] = 0
        parameters = {p['id'].lower(): p for p in model['parameters']}
        if expected_kind == 'cab': offsets.update({'cablowcutid':20, 'cabreslevelid':40, 'cabthumpid':60, 'cabdecayid':80})
        for field, display in [('parameters', False), ('displayParameters', True)]:
            if display and request.get(field) and recipe.get('allowCandidateConversions') is not True:
                raise ValueError('Display conversions need explicit allowCandidateConversions; verify them in the editor')
            for pid, value in request.get(field, {}).items():
                pid = pid.lower()
                if pid in parameters and parameters[pid].get('editable') is False: raise ValueError('Parameter is not exposed on this model')
                if expected_kind == 'cab' and pid in ('caberid', 'cabmicid') and pid in parameters:
                    encoded = encode(parameters[pid], value, display)
                    if pid == 'caberid':
                        offset = 0xd74 if target == 'cabA' else 0xd7c
                        output[offset:offset+4] = encoded
                    else: output[0x1020 if target == 'cabA' else 0x1021] = struct.unpack('>i', encoded)[0]
                    continue
                if pid not in offsets or pid not in parameters: raise ValueError(f'Unmapped parameter {pid} on {target}')
                offset = offsets[pid]
                data[offset:offset+4] = encode(parameters[pid], value, display)
        for pid, assignment in request.get('controllers', {}).items():
            pid = pid.lower()
            if expected_kind == 'cab' or pid not in parameters or pid not in offsets or parameters[pid].get('editable') is False: raise ValueError('Unmapped controller parameter')
            if set(assignment) - {'source','minimum','maximum'}: raise ValueError('Unknown controller field')
            source = assignment.get('source')
            if type(source) is not int or source not in range(4): raise ValueError('Controller source must be 0..3')
            offset = offsets[pid]
            data[offset+12] = source
            for key, delta in [('minimum',4),('maximum',8)]:
                if key in assignment: data[offset+delta:offset+delta+4] = encode(parameters[pid],assignment[key])
        output[base:base+256] = data
        receipt.append({'target': target, 'model': model['id'], 'sourceSha256': sample['sha256'], 'sourceBlock': sample['block']})
    if 'routing' in recipe:
        zones = {'pre':0, 'aPre':1, 'bPre':2, 'aPost':3, 'bPost':4, 'post':5}
        entries = []
        for zone, names in recipe['routing'].items():
            if zone not in zones or not isinstance(names,list) or any(name not in dict(mapping.BLOCKS[4:]) for name in names): raise ValueError('Invalid effect routing')
            if 0 < zones[zone] < 5 and names and output[0x57] != 0: raise ValueError('Branch effects need a parallel template')
            entries.extend((zones[zone], name) for name in names)
        if len(entries) != 8 or len({name for _, name in entries}) != 8: raise ValueError('Routing must include every effect slot exactly once')
        for index, (zone,name) in enumerate(entries):
            output[blocks[name]+5] = zone
            output[blocks[name]+7] = index
    if 'tempo' in recipe: struct.pack_into('>f', output, 0xd80, bounded(recipe['tempo'], 30, 240))
    for key, value in recipe.get('mixer', {}).items():
        fields = {'panA': (0xd84,-1,1), 'panB': (0xd88,-1,1), 'levelA': (0xd8c,-60,12), 'levelB': (0xd90,-60,12)}
        if key not in fields: raise ValueError('Unknown mixer field')
        offset, low, high = fields[key]
        struct.pack_into('>f', output, offset, bounded(value, low, high))
    return bytes(output), {'sha256': hashlib.sha256(output).hexdigest(), 'sources': receipt, 'requiresEditorValidation': True, 'savedToHardware': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ['template', 'atlas', 'recipe', 'output']: parser.add_argument(argument, type=pathlib.Path)
    args = parser.parse_args()
    output, receipt = assemble(mapping.read(args.template), json.loads(args.atlas.read_text()), json.loads(args.recipe.read_text()))
    with args.output.open('xb') as file: file.write(output)
    args.output.chmod(0o600)
    with pathlib.Path(str(args.output) + '.receipt.json').open('x') as file: json.dump(receipt, file, indent=2)
    print(json.dumps(receipt))


if __name__ == '__main__': main()
