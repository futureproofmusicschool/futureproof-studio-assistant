import importlib.util, pathlib, struct, tempfile, unittest
spec=importlib.util.spec_from_file_location('pod_map',pathlib.Path(__file__).with_name('map.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MappingTests(unittest.TestCase):
 def fixture(self):
  b=bytearray(4136);b[:4]=b'H5EP';b[11]=0x28;b[40:72]=b'Example'.ljust(32,b' ')
  struct.pack_into('>I',b,0x50,0x70005);struct.pack_into('>I',b,0x60,0x3f100003);struct.pack_into('>f',b,0x64,0.25)
  return bytes(b)
 def test_records_use_ids(self):
  b=self.fixture();p=m.inspect(b)['blocks'][0]['parameters'][0]
  self.assertEqual(p['id'],'0x3f100003');self.assertEqual(p['valueFloat'],.25)
 def test_diff_separates_name(self):
  a=self.fixture();b=bytearray(a);b[40]=ord('A');struct.pack_into('>f',b,0x64,.5)
  d=m.diff(a,b);self.assertTrue(d['nameChanged']);self.assertEqual([x['offset'] for x in d['words']],[0x64])
 def test_nonfinite_json_safe(self):
  b=bytearray(self.fixture());struct.pack_into('>f',b,0x64,float('nan'));self.assertIsNone(m.inspect(b)['blocks'][0]['parameters'][0]['valueFloat'])
 def test_candidate_fields_do_not_leak_between_nested_records(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder)
   for name in ['amp.go','pedal.go']: (root/name).write_text('')
   (root/'cab.go').write_text('{ctype: 17235968, name: "Example", params: []Parameter{\n &PerCentParam{GenericParameter: GenericParameter{id: CabERID, name: "ER"}},\n &ListParam{GenericParameter: GenericParameter{id: CabMicID, name: "Mic"}, binValueType: Int32Type, list: []string{"A", "B"}},\n }}')
   params=m.candidates(root)['models'][0]['parameters']
   self.assertEqual(params[0]['choices'],[]);self.assertIsNone(params[0]['binaryType'])
   self.assertEqual(params[1]['choices'],['A','B'])
 def test_signed_choice_and_explicit_candidate_conversion(self):
  spec=importlib.util.spec_from_file_location('assemble',pathlib.Path(__file__).with_name('assemble.py'))
  a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
  p={'candidateEncoding':'ListParam','binaryType':'Int32Type','indexShift':-1,'choices':['Down','None','Up']}
  self.assertEqual(struct.unpack('>i',a.encode(p,'Down',True))[0],-1)
  for value in [float('nan'),float('inf'),-2,.5]:
   with self.assertRaises(ValueError): a.encode(p,value)
if __name__=='__main__':unittest.main()
