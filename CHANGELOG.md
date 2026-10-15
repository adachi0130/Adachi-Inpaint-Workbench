# Changelog

## 0.4.1

- Rename the public node pack to **Adachi-Inpaint-Workbench**; keep existing node class IDs compatible with saved workflows.
- Show an eraser cursor and a distinct dashed brush outline while Alt is held or the eraser tool is selected; restore the brush cursor on release.
- Add Comfy Registry metadata, dependency declarations, a Manager registration entry, CPU CI and a manual Registry publishing workflow.

## 0.4.0

- Move the original live editor controls and sampling controls into the WebUI Inpaint node.
- Keep the inline node focused on the image and a small upload button.
- Move comparison controls below the picture and remove the top toolbar band.

## 0.3.0

- Add WebUI-style sliders, separate width/height rows and a source-size button.
- Use result-left/original-right comparison and show the full result when the pointer leaves.
- Route toolbar wheel events to the workflow and keep image wheel gestures separate.

## 0.2.0

- Add temporary Alt erase, image comparison and result adoption.
