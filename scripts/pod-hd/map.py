#!/usr/bin/env python3
"""Inspect Bean presets and controlled editor exports; never writes to hardware.
Raw exports and generated catalogs belong outside the public checkout.
"""
import argparse, hashlib, json, math, pathlib, re, struct

BLOCKS = [('ampA',0x50),('ampB',0x150),('cabA',0x250),('cabB',0x350)] + [(f'fx{i+1}',0x450+i*256) for i in range(8)]
def number(b, offset):
    value=struct.unpack_from('>f',b,offset)[0]
    return value if math.isfinite(value) else None

def read(path):
    b=pathlib.Path(path).read_bytes()
    if len(b)!=4136 or b[:4]!=b'H5EP' or b[11]!=0x28:
        raise ValueError('Expected a 4136-byte Bean H5EP preset')
    return b

def inspect(b):
    blocks=[]
    for name,base in BLOCKS:
        params=[]
        for offset in range(base+16,base+256-19,20):
            pid=struct.unpack_from('>I',b,offset)[0]
            if pid>>24 != 0x3f: continue
            params.append(dict(id=f'0x{pid:08x}',offset=offset+4,valueFloat=number(b,offset+4),valueUint=struct.unpack_from('>I',b,offset+4)[0],valueInt=struct.unpack_from('>i',b,offset+4)[0],minimumHex=b[offset+8:offset+12].hex(),maximumHex=b[offset+12:offset+16].hex(),controllerByte=b[offset+16],raw=b[offset+4:offset+20].hex()))
        blocks.append(dict(block=name,offset=base,modelId=f'0x{struct.unpack_from(">I",b,base)[0]:08x}',header=b[base:base+16].hex(),parameters=params))
    return dict(sha256=hashlib.sha256(b).hexdigest(),name=b[40:72].rstrip(b'\0 ').decode('ascii',errors='replace'),blocks=blocks)

def diff(a,b):
    changes=[i for i in range(len(a)) if a[i]!=b[i]]
    words=sorted({i//4*4 for i in changes if not 40<=i<72})
    return dict(changedBytes=len(changes),nameChanged=a[40:72]!=b[40:72],words=[dict(offset=i,hexOffset=hex(i),beforeHex=a[i:i+4].hex(),afterHex=b[i:i+4].hex(),beforeFloat=number(a,i),afterFloat=number(b,i)) for i in words])

def candidates(source):
    """Extract factual labels/IDs from external research, not executable code."""
    out=[]
    for filename,kind,prefix in [('amp.go','amp','atype'),('cab.go','cab','ctype'),('pedal.go','effect','ptype')]:
        text=(source/filename).read_text()
        starts=list(re.finditer(r'\{'+prefix+r':\s*(\d+),[^\n]*?name:\s*"([^"]+)"',text))
        for index,m in enumerate(starts):
            end=starts[index+1].start() if index+1<len(starts) else text.find('\nfunc ',m.end())
            body=text[m.end():end if end!=-1 else len(text)]
            category=re.search(r'stype:\s*"([^"]+)"',m.group())
            params=[]
            for pm in re.finditer(r'&(\w+Param)\{GenericParameter:\s*GenericParameter\{id:\s*(0x[\da-fA-F]+|\w+),\s*name:\s*"([^"]+)"\}',body):
                # Stop at this parameter's matching brace, regardless of Go indentation.
                depth=1; end_param=pm.end()
                for end_param in range(pm.end(),len(body)):
                    if body[end_param]=='{': depth+=1
                    elif body[end_param]=='}': depth-=1
                    if depth==0: break
                tail=body[pm.end():end_param]
                bounds={key:float(value) for key,value in re.findall(r'\b(min|max|maxMs):\s*(-?[\d.]+)',tail)}
                choices=re.search(r'list:\s*\[\]string\{([^}]+)\}',tail,re.S)
                kind_match=re.search(r'binValueType:\s*(\w+)',tail)
                shift_match=re.search(r'maxIDShift:\s*(-?\d+)',tail)
                params.append(dict(binaryType=kind_match.group(1) if kind_match else None,indexShift=int(shift_match.group(1)) if shift_match else 0,id=pm.group(2),label=pm.group(3),candidateEncoding=pm.group(1),bounds=bounds,choices=re.findall(r'"([^"]*)"',choices.group(1)) if choices else [],status='research-candidate'))
            out.append(dict(kind=kind,id=f'0x{int(m.group(1)):08x}',label=m.group(2),category=category.group(1) if category else kind,parameters=params,status='research-candidate'))
    return dict(source='https://github.com/StarAurryon/lpedit-lib/tree/master/model/pod',warning='HD500X research: labels, ranges and encodings require independent Bean validation. USB endianness is not file endianness.',models=out)

def coverage(folder,catalog):
    by_id={m['id']:m for m in catalog['models']}
    observations=[]
    for p in sorted(folder.glob('*.hbe')):
        item=inspect(read(p)); item['file']=p.name
        for block in item['blocks']:
            match=by_id.get(block['modelId']);block['candidateLabel']=match['label'] if match else None
        observations.append(item)
    seen={b['modelId'] for o in observations for b in o['blocks']}
    return dict(editor='POD HD Edit 2.27',device='Bean',exportCount=len(observations),observedModelIds=sorted(seen),candidateModelCount=len(by_id),candidateParameterCount=sum(len(m['parameters']) for m in catalog['models']),observations=observations,warning='An observed model ID is not a verified parameter mapping. Round-trip and semantic evidence are tracked separately.')

def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('inspect');p.add_argument('file')
    p=sub.add_parser('diff');p.add_argument('before');p.add_argument('after')
    p=sub.add_parser('candidates');p.add_argument('source',type=pathlib.Path)
    p=sub.add_parser('coverage');p.add_argument('folder',type=pathlib.Path);p.add_argument('catalog',type=pathlib.Path)
    args=parser.parse_args()
    if args.command=='inspect': result=inspect(read(args.file))
    elif args.command=='diff': result=diff(read(args.before),read(args.after))
    elif args.command=='candidates': result=candidates(args.source)
    else: result=coverage(args.folder,json.loads(args.catalog.read_text()))
    print(json.dumps(result,indent=2,allow_nan=False))
if __name__=='__main__': main()
