# The 3D models

The crow, the hourglass and the paper plane are not loaded as 3D files on the site. The crow and
the hourglass are baked here into small point clouds, which the site reads from
`site/public/models/`; the paper plane's six triangles are written into `site/src/plane.js`.

    python3 tools/bake_crow.py path/to/crow.gltf
    python3 tools/bake_hourglass.py path/to/hourglass.glb

Scale, orientation and origin do not matter; the bakes normalise them. The source models are not
committed (`*.glb` and `*.gltf` are ignored); only what the bakes write is.
