# T001 vendored Ajv

Ajv draft-07 compiler and statically bundled dependencies. Pinned versions and original licenses are listed in manifest.json and accompanying license files. Bundle was built from packages already installed in the project development checkout; product does not require their transitive devDependencies. No external package lookup occurs at runtime.

Rebuild with pinned source packages and esbuild 0.25.10: esbuild node_modules/ajv/dist/ajv.js --bundle --platform=node --format=cjs --target=node20 --outfile=src/renderer/features/T001/vendor/ajv.cjs. Then rebuild worker-source.cjs into worker-bundle.cjs with --bundle --platform=node --format=iife --target=node20 --outfile=src/renderer/features/T001/worker-bundle.cjs. IIFE isolates generated globals inside the trusted worker.

Ajv generates validator code only inside the bounded Node worker. Renderer CSP is unchanged. This limits compilation/validation resources, and is not a general process security sandbox. No custom keyword, asynchronous schema loader or user JavaScript API is exposed.
