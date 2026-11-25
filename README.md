# paseo-stl-preview

A [Paseo](https://paseo.sh) plugin that opens `.stl` files in an interactive 3D viewer inside the file tab.

Handy when an agent generates or edits models (OpenSCAD, CadQuery, build123d, scripts): the preview reloads automatically when the file changes on disk, keeping the camera.

## Features

- Binary and ASCII STL.
- Drag to rotate, right-drag / Shift-drag to pan, wheel to zoom, double-click to reset.
- Iso / Front / Top / Right view presets and a wireframe toggle.
- Toolbar stats: bounding box size (file units), triangle count, format, file size.
- Colors follow the current Paseo theme.
- Mobile: no 3D view, shows dimensions, surface area and volume instead.

Rendering is a small self-contained WebGL renderer (no three.js — plugin client bundles can only use host-provided modules).

## Install

```bash
paseo plugin install github:warpreality/paseo-stl-preview
```

Or from a local checkout:

```bash
git clone https://github.com/warpreality/paseo-stl-preview.git
cd paseo-stl-preview && npm install && npm run typecheck
paseo plugin install "$PWD"
```

Plugins must be enabled on the daemon (`pluginsEnabled: true`, or Settings → Plugins).

Try it on the samples in [`examples/`](examples/): `gear.stl` (binary) and `cube.stl` (ASCII, 10 mm cube).

## Limitations

- Wireframe is disabled for meshes over 600,000 triangles.
- Volume is only meaningful for closed (watertight) meshes.
- STL units are not stored in the file; sizes are shown as-is (usually millimetres).

## Requirements

Paseo `>= 0.16.2`. Client-only plugin, no daemon-side code.

## License

MIT
