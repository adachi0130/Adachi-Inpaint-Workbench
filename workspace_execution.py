"""Validate and queue only the selected inpainting output, without a test render."""

from copy import deepcopy
import inspect
import time
import uuid


def validate_input_mappings(prompt):
    # Core replacement hooks inspect inputs before validate_prompt runs. Reject
    # malformed mappings here so a bad request cannot crash those hooks first.
    for key, node in prompt.items():
        if not isinstance(node, dict) or not isinstance(node.get("inputs", {}), dict):
            raise ValueError(f"Invalid input mapping for execution node: {key}")


def dependency_prompt(prompt, output_id):
    """Keep one output and its dependencies, including references into subgraphs."""
    output_id = str(output_id)
    if not isinstance(prompt, dict) or not isinstance(prompt.get(output_id), dict):
        raise ValueError("The selected comparison is not present in the execution graph.")
    if prompt[output_id].get("class_type") != "AdachiImageCompare":
        raise ValueError("The workspace output must be an Adachi Image Compare node.")
    found, pending = set(), [output_id]
    while pending:
        key = pending.pop()
        if key in found:
            continue
        found.add(key)
        node = prompt.get(key)
        if not isinstance(node, dict):
            raise ValueError(f"The execution graph references a missing node: {key}")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            raise ValueError(f"Invalid input mapping for execution node: {key}")
        for value in inputs.values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int):
                pending.append(value[0])
    return {key: value for key, value in prompt.items() if key in found}


async def prepare_workspace(server, execution, payload):
    """Use the same hooks, replacements and validation as ComfyUI /prompt."""
    if not isinstance(payload, dict) or not isinstance(payload.get("prompt"), dict):
        raise ValueError("No workflow execution graph was provided.")
    target = str(payload.get("compare_id", ""))
    data = deepcopy(payload)
    validate_input_mappings(data["prompt"])
    # Hooks may restore Get/Set or subgraph links; prune only after they ran.
    data = server.trigger_on_prompt(data)
    if not isinstance(data, dict) or not isinstance(data.get("prompt"), dict):
        raise ValueError("A workflow extension rejected the execution graph.")
    validate_input_mappings(data["prompt"])
    replacements = getattr(server, "node_replace_manager", None)
    if replacements is not None:
        replacements.apply_replacements(data["prompt"])
    data["prompt"] = dependency_prompt(data["prompt"], target)
    data["partial_execution_targets"] = [target]
    prompt_id = str(uuid.uuid4())
    # Older supported ComfyUI builds have validate_prompt(prompt), newer builds
    # include prompt_id and optional partial execution targets.
    count = len(inspect.signature(execution.validate_prompt).parameters)
    if count >= 3:
        checked = execution.validate_prompt(prompt_id, data["prompt"], [target])
    elif count == 2:
        checked = execution.validate_prompt(prompt_id, data["prompt"])
    else:
        checked = execution.validate_prompt(data["prompt"])
    valid = await checked if inspect.isawaitable(checked) else checked
    return data, prompt_id, valid


def register_workspace_routes(server):
    if getattr(server, "_adachi_workspace_execution_routes", False):
        return
    from aiohttp import web
    import execution

    @server.routes.get("/adachi-inpaint/workspace/capabilities")
    async def capabilities(request):
        return web.json_response({"api_version": 1, "can_validate": True})

    async def handle(request, submit):
        try:
            payload = await request.json()
            data, prompt_id, valid = await prepare_workspace(server, execution, payload)
            response = {"valid": bool(valid[0]), "error": valid[1], "node_errors": valid[3]}
            if not valid[0]:
                return web.json_response(response, status=400 if submit else 200)
            if submit:
                extra = data.get("extra_data", {})
                if not isinstance(extra, dict):
                    raise ValueError("Invalid workflow metadata.")
                if isinstance(data.get("client_id"), str):
                    extra["client_id"] = data["client_id"]
                extra["create_time"] = int(time.time() * 1000)
                sensitive = {}
                sensitive_keys = getattr(execution, "SENSITIVE_EXTRA_DATA_KEYS", None)
                for key in sensitive_keys or ():
                    if key in extra:
                        sensitive[key] = extra.pop(key)
                number = server.number
                server.number += 1
                item = (number, prompt_id, data["prompt"], extra, valid[2])
                if sensitive_keys is not None:
                    item += (sensitive,)
                server.prompt_queue.put(item)
                response.update(prompt_id=prompt_id, number=number)
            else:
                response["outputs"] = valid[2]
                response["node_count"] = len(data["prompt"])
            return web.json_response(response)
        except (ValueError, TypeError, KeyError) as exc:
            return web.json_response({"valid": False, "error": {"message": str(exc)}, "node_errors": {}}, status=400)

    @server.routes.post("/adachi-inpaint/workspace/validate")
    async def validate(request):
        return await handle(request, False)

    @server.routes.post("/adachi-inpaint/workspace/submit")
    async def submit(request):
        return await handle(request, True)

    server._adachi_workspace_execution_routes = True
