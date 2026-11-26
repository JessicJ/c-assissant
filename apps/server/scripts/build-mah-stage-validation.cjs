const { copyFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { build } = require("esbuild");

async function main() {
  const output = join(__dirname, "../lib/mah-stage-validation");
  const schema = "landi-mah-stage-result.v2.schema.json";
  await mkdir(output, { recursive: true });
  await Promise.all([
    copyFile(join(__dirname, "../../../docs/contracts", schema), join(output, schema)),
    build({
      entryPoints: [join(__dirname, "validate-mah-stage-result.cjs")],
      outfile: join(output, "landi-validate-stage-result.cjs.txt"),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      minify: true,
      legalComments: "inline",
    }),
  ]);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
