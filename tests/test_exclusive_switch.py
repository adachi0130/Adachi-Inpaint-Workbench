"""The selector must preserve arbitrary values and never silently prefer a branch."""
import importlib.util
import copy
from pathlib import Path
import unittest

import torch

spec = importlib.util.spec_from_file_location("exclusive_backend", Path(__file__).resolve().parents[1] / "backend.py")
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class ExclusiveSwitchTests(unittest.TestCase):
    def setUp(self):
        self.node = backend.AdachiExclusiveSwitch()

    def workflow(self):
        return {"nodes": [
            {"id": 1, "type": "CLIPTextEncode", "mode": 4},
            {"id": 2, "type": "CLIPTextEncode", "mode": 0},
            {"id": 3, "type": "SetNode", "mode": 4, "widgets_values": ["p_0"], "inputs": [{"link": 1}]},
            {"id": 4, "type": "SetNode", "mode": 0, "widgets_values": ["p"], "inputs": [{"link": 2}]},
            {"id": 5, "type": "GetNode", "mode": 0, "widgets_values": ["p_0"]},
            {"id": 6, "type": "GetNode", "mode": 0, "widgets_values": ["p"]},
            {"id": 532, "type": "AdachiExclusiveSwitch", "inputs": [{"name": "input_a", "link": 3}, {"name": "input_b", "link": 4}]},
        ], "links": [[1, 1, 0, 3, 0, "*"], [2, 2, 0, 4, 0, "*"], [3, 5, 0, 532, 0, "*"], [4, 6, 0, 532, 1, "*"]]}

    def test_single_connected_branch_is_requested(self):
        self.assertEqual(self.node.check_lazy_status(input_a=None), ["input_a"])
        self.assertEqual(self.node.check_lazy_status(input_b=None), ["input_b"])

    def test_bypassed_passthrough_branch_is_not_requested(self):
        self.assertEqual(self.node.check_lazy_status(input_a=None, input_b=None, active_inputs=1), ["input_a"])
        self.assertEqual(self.node.check_lazy_status(input_a=None, input_b=None, active_inputs=2), ["input_b"])
        a, b = object(), object()
        self.assertIs(self.node.select(a, b, 1)[0], a)
        self.assertIs(self.node.select(a, b, 2)[0], b)

    def test_ambiguous_and_empty_inputs_fail(self):
        for inputs in ({}, {"input_a": None, "input_b": None}, {"active_inputs": 0}, {"active_inputs": 3}):
            with self.subTest(inputs=inputs), self.assertRaisesRegex(ValueError, "exactly one"):
                self.node.check_lazy_status(**inputs)

    def test_missing_selected_input_and_none_data_fail(self):
        with self.assertRaisesRegex(ValueError, "has no input"):
            self.node.check_lazy_status(input_b=None, active_inputs=1)
        with self.assertRaisesRegex(ValueError, "returned no data"):
            self.node.select(input_a=None)

    def test_falsey_values_and_tensors_are_forwarded_by_identity(self):
        for value in (False, 0, "", [], {}, torch.zeros(1, 4, 4, 3), torch.ones(1, 4, 4), {"samples": torch.zeros(1, 4, 8, 8)}, [[torch.zeros(1, 2, 3), {}]]):
            with self.subTest(type=type(value)):
                self.assertIs(self.node.select(input_a=value)[0], value)
                self.assertIs(self.node.select(input_b=value)[0], value)

    def test_submitted_single_connection_overrides_stale_flags(self):
        for name in ("input_a", "input_b"):
            prompt = {"532": {"inputs": {name: ["source", 0], "active_inputs": 3}}}
            for stale in (-1, 0, 1, 2, 3):
                with self.subTest(name=name, stale=stale):
                    args = {name: None, "active_inputs": stale, "prompt": prompt, "unique_id": "532"}
                    self.assertEqual(self.node.check_lazy_status(**args), [name])
                    value = object()
                    args[name] = value
                    self.assertIs(self.node.select(**args)[0], value)

    def test_submitted_empty_or_ambiguous_connections_still_fail(self):
        for inputs in ({}, {"input_a": ["a", 0], "input_b": ["b", 0]}):
            with self.subTest(inputs=inputs), self.assertRaisesRegex(ValueError, "exactly one"):
                self.node.check_lazy_status(active_inputs=3, prompt={"1": {"inputs": inputs}}, unique_id="1")
        prompt = {"1": {"inputs": {"input_a": ["a", 0], "input_b": ["b", 0]}}}
        self.assertEqual(self.node.check_lazy_status(input_a=None, input_b=None, active_inputs=2, prompt=prompt, unique_id="1"), ["input_b"])

    def test_dynamic_subgraph_connection_is_authoritative(self):
        class DynamicPrompt:
            def get_node(self, node_id):
                self_id = "subgraph:532"
                if node_id != self_id:
                    raise KeyError(node_id)
                return {"inputs": {"input_b": ["nested-source", 0]}}
        self.assertEqual(self.node.check_lazy_status(input_b=None, active_inputs=3,
                         prompt={}, dynprompt=DynamicPrompt(), unique_id="subgraph:532"), ["input_b"])

    def test_enabled_gets_follow_ignored_set_and_encoder_in_workflow(self):
        workflow = self.workflow()
        args = dict(input_a=None, input_b=None, active_inputs=3, unique_id="532", extra_pnginfo={"workflow": workflow})
        self.assertEqual(self.node.check_lazy_status(**args), ["input_b"])
        for stale in range(-1, 4):
            self.assertEqual(self.node.check_lazy_status(**{**args, "active_inputs": stale}), ["input_b"])
        for node in workflow["nodes"][:4]:
            node["mode"] = 0 if node["mode"] == 4 else 4
        self.assertEqual(self.node.check_lazy_status(**args), ["input_a"])

    def test_ignored_set_alone_or_encoder_alone_disables_route(self):
        for source_mode, set_mode in ((4, 0), (0, 4), (2, 0), (0, 2)):
            workflow = self.workflow()
            workflow["nodes"][0]["mode"] = source_mode
            workflow["nodes"][2]["mode"] = set_mode
            self.assertEqual(backend._workflow_exclusive_flags({"workflow": workflow}, "532"), 2)

    def test_workflow_ambiguous_empty_cycle_missing_set_are_not_selected(self):
        workflow = self.workflow()
        for node in workflow["nodes"][:4]:
            node["mode"] = 0
        self.assertEqual(backend._workflow_exclusive_flags({"workflow": workflow}, "532"), 3)
        for node in workflow["nodes"][:4]:
            node["mode"] = 4
        self.assertEqual(backend._workflow_exclusive_flags({"workflow": workflow}, "532"), 0)
        workflow = self.workflow()
        workflow["nodes"][2]["mode"] = 0
        workflow["links"][0][1] = 5
        self.assertEqual(backend._workflow_exclusive_flags({"workflow": workflow}, "532"), 2)
        workflow["nodes"][4]["widgets_values"] = ["missing"]
        self.assertEqual(backend._workflow_exclusive_flags({"workflow": workflow}, "532"), 2)

    def test_prompt_normalization_before_cache_preserves_workflow(self):
        workflow = self.workflow()
        saved = copy.deepcopy(workflow)
        request = {"prompt": {"532": {"class_type": "AdachiExclusiveSwitch", "inputs": {"input_a": ["a", 0], "input_b": ["b", 0], "active_inputs": 3}}},
                   "extra_data": {"extra_pnginfo": {"workflow": workflow}}}
        self.assertIs(backend.normalize_exclusive_prompt(request), request)
        self.assertEqual(request["prompt"]["532"]["inputs"], {"input_b": ["b", 0], "active_inputs": 2})
        self.assertEqual(workflow, saved)
        plain = {"prompt": {"532": {"class_type": "AdachiExclusiveSwitch", "inputs": {"input_a": ["a", 0]}}}}
        original = copy.deepcopy(plain)
        backend.normalize_exclusive_prompt(plain)
        self.assertEqual(plain, original)

    def test_scoped_subgraph_and_dictionary_links(self):
        child = self.workflow()
        child["id"] = "child"
        child["links"] = [dict(zip(("id", "origin_id", "origin_slot", "target_id", "target_slot", "type"), link)) for link in child["links"]]
        workflow = {"nodes": [{"id": 349, "type": "child"}], "definitions": {"subgraphs": [child]}}
        self.assertEqual(backend._workflow_exclusive_flags({"workflow": workflow}, "349:532"), 2)
        self.assertIsNone(backend._workflow_exclusive_flags({"workflow": workflow}, "532"))


if __name__ == "__main__":
    unittest.main()
