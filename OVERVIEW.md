STL preview opens `.stl` files in an interactive 3D viewer inside the Paseo file tab. It reads binary and ASCII STL, shades the model with the current theme's accent color, and reloads it when the file changes on disk, which is handy when an agent generates or edits models with OpenSCAD, CadQuery, or a script.

Drag to rotate, right-drag or Shift-drag to pan, scroll to zoom, and double-click to reset. The toolbar has isometric, front, top, and right views and a wireframe toggle. It also shows the bounding box size in file units, the triangle count, the format, and the file size.

Rendering uses WebGL in the desktop and web app and needs no extra software. On mobile the tab shows the model's dimensions, surface area, and volume without the 3D view. Wireframe is disabled for meshes over 600,000 triangles. Volume is only meaningful for closed meshes.
