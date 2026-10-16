"""The selector must preserve arbitrary values and never silently prefer a branch."""
import importlib.util
from pathlib import Path
import unittest

import torch

spec = importlib.util.spec_from_file_location("exclusive_backend", Path(__file__).resolve().parents[1] / "backend.py")
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class ExclusiveSwitchTests(unittest.TestCase):
    def setUp(self):
        self.node = backend.AdachiExclusiveSwitch()

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


if __name__ == "__main__":
    unittest.main()
