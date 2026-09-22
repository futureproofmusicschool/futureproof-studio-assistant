"""Exercise the vendored read protocol without Live or a network socket."""
import importlib
import pathlib
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "AbletonOSC"
for name, location in [("osc_fixture", ROOT), ("osc_fixture.abletonosc", ROOT / "abletonosc")]:
    package = types.ModuleType(name)
    package.__path__ = [str(location)]
    sys.modules[name] = package
OSCServer = importlib.import_module("osc_fixture.abletonosc.osc_server").OSCServer


class CorrelatedQueries(unittest.TestCase):
    def setUp(self):
        self.server = OSCServer.__new__(OSCServer)
        self.server._response_port = 11001
        self.server._callbacks = {}
        self.replies = []
        self.server.send = lambda *args: self.replies.append(args)

    def send(self, address, params):
        self.server.process_message(types.SimpleNamespace(address=address, params=params), ("127.0.0.1", 12345))

    def test_echoes_ids_and_original_result(self):
        self.server._callbacks["/live/track/get/name"] = lambda args: (args[0], "Track")
        for token, track in [("request-b", 2), ("request-a", 1)]:
            self.send("/studio/query", (token, "/live/track/get/name", track))
        self.assertEqual(self.replies[0][1], ("request-b", "/live/track/get/name", 0, 2, "Track"))
        self.assertEqual(self.replies[1][1][0], "request-a")

    def test_refuses_mutations(self):
        self.server._callbacks["/live/track/set/name"] = lambda args: self.fail("Mutation invoked")
        self.send("/studio/query", ("request", "/live/track/set/name", 0, "Changed"))
        self.assertEqual(self.replies[0][1][2], 1)

    def test_legacy_reads_still_work(self):
        self.server._callbacks["/live/track/get/name"] = lambda args: (args[0], "Track")
        self.server.send = lambda **kwargs: self.replies.append(kwargs)
        self.send("/live/track/get/name", (1,))
        self.assertEqual(self.replies[0]["params"], (1, "Track"))
