#!/usr/bin/env python3
"""Generate repeatable model calibration probes for offline editor round trips.

Keep generated files outside the checkout. Loading each file in POD HD Edit and
exporting it is required; generation alone supplies no validation evidence.
"""
import argparse
import importlib.util
import json
import pathlib

def audit(folder, manifest_name='manifest.json'):
    manifest=json.loads((folder/manifest_name).read_text())
    results=[]
    for probe in manifest:
        source=folder/probe['file']
        exported=source.with_name(source.stem+'-out.hbe')
        if not exported.exists():
            results.append({'file':source.name,'status':'pending'});continue
        delta=assembler.mapping.diff(assembler.mapping.read(source),assembler.mapping.read(exported))
        results.append({'file':source.name,'status':'preserved-except-name' if not delta['words'] else 'changed', 'delta':delta, 'models':[item['model'] for item in probe['expected']]})
    return {'total':len(results),'passed':sum(r['status']=='preserved-except-name' for r in results),'changed':sum(r['status']=='changed' for r in results),'pending':sum(r['status']=='pending' for r in results),'results':results,'notice':'Byte preservation is separate from visual semantic calibration.'}

spec = importlib.util.spec_from_file_location('assemble', pathlib.Path(__file__).with_name('assemble.py'))
assembler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembler)


def recipe(models, kind, point, index):
    blocks = {f'fx{i}': {'model': '0x020dffff'} for i in range(1,9)}
    blocks.update({name: {'model': '0x0007ffff'} for name in ['ampA','ampB']})
    expected = []
    fraction = {'min':0, 'mid':0.5, 'max':1}[point]
    for slot, model in enumerate(models):
        target = f'fx{slot+1}' if kind == 'effect' else ['ampA','ampB'][slot]
        parameters = {}
        for parameter in model['parameters']:
            if parameter.get('editable') is False: continue
            value = fraction
            if parameter['candidateEncoding'] == 'ListParam' and parameter.get('binaryType') == 'Int32Type':
                value = round(fraction*(len(parameter['choices'])-1)) + parameter.get('indexShift',0)
            elif parameter['candidateEncoding'] == 'ListParam':
                count = len(parameter['choices']) - 1
                value = round(fraction * count) / max(1, count + parameter.get('indexShift', 0))
            parameters[parameter['id']] = value
        request = {'model':model['id'], 'parameters':parameters}
        if any(p['candidateEncoding']=='TempoFollowerParam' for p in model['parameters']): request['tempoSync']=0
        blocks[target] = request
        expected.append({'block':target,'model':model['id'],'label':model['label'],'parameters':parameters})
    name = f'{kind}-{index:03d}-{point}'
    return {'name':name,'blocks':blocks}, expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('template',type=pathlib.Path)
    parser.add_argument('atlas',type=pathlib.Path)
    parser.add_argument('output',type=pathlib.Path)
    parser.add_argument('--kind',choices=['effect','amp'],default='effect')
    parser.add_argument('--batch-size',type=int,default=4)
    args=parser.parse_args()
    limit=4 if args.kind=='effect' else 2
    if not 1<=args.batch_size<=limit: parser.error(f'batch-size must be 1..{limit}')
    args.output.mkdir(parents=True,exist_ok=True)
    atlas=json.loads(args.atlas.read_text())
    models=[m for m in atlas['models'] if m['kind']==args.kind and m['label']!='None' and m['availability']=='editor-observed']
    template=assembler.mapping.read(args.template)
    manifest=[]
    for start in range(0,len(models),args.batch_size):
        group=models[start:start+args.batch_size]
        for point in ['min','mid','max']:
            description, expected=recipe(group,args.kind,point,start//args.batch_size)
            data, receipt=assembler.assemble(template,atlas,description)
            file=args.output/(description['name']+'.hbe')
            with file.open('xb') as output: output.write(data)
            file.chmod(0o600)
            manifest.append({'file':file.name,'expected':expected,'receipt':receipt,'editorValidation':'pending'})
    with (args.output/'manifest.json').open('x') as output:json.dump(manifest,output,indent=2)
    print(json.dumps({'models':len(models),'probes':len(manifest),'kind':args.kind}))


if __name__=='__main__':main()
