import { defineConfig } from "tsdown";

// One file for npm: dist/cli.js. Runtime dependencies stay external; workspace packages such as
// @relayrunner/machine-protocol (which export .ts source) are bundled in.
export default defineConfig({
  entry: ["cli.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: false,
  fixedExtension: false,
});
