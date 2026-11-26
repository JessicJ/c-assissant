const { createHash } = require("node:crypto");
const { readFileSync, statSync } = require("node:fs");
const { isDeepStrictEqual } = require("node:util");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const MAX_BYTES = 16 * 1024 * 1024;
const CORRELATED_FIELDS = [
  "requestId", "carrierTaskId", "generationKey", "proposalRef", "skillLineage",
  "operation", "batchId", "attempt", "parentCheckpoint",
];

function readJson(path) {
  const info = statSync(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Invalid input file");
  const bytes = readFileSync(path);
  if (bytes.length > MAX_BYTES) throw new Error("Input file exceeds the byte limit");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sha256 };
}

function verify(schemaPath, requestPath, resultPath) {
  const schema = readJson(schemaPath);
  const request = readJson(requestPath);
  const result = readJson(resultPath);
  const ajv = new Ajv2020({ strict: false, allErrors: false, ownProperties: true });
  addFormats(ajv);
  for (const [name, contract, value] of [
    ["envelope", schema.value, result.value],
    ["payload", request.value.input.businessInput.outputSchema, result.value.payload],
  ]) {
    const validate = ajv.compile(contract);
    if (!validate(value)) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}`);
  }
  for (const field of CORRELATED_FIELDS) {
    if (!isDeepStrictEqual(result.value[field], request.value[field])) {
      throw new Error(`Frozen request mismatch: ${field}`);
    }
  }
  if (result.value.requestSha256 !== request.sha256
    || result.value.inputSha256 !== request.value.input.sha256
    || result.value.businessContract !== request.value.input.businessInput.outputBusinessContract
    || result.value.provenance.taskId !== request.value.carrierTaskId) {
    throw new Error("Frozen request mismatch: digest, business contract or provenance");
  }
  if (Date.parse(result.value.provenance.startedAt) > Date.parse(result.value.provenance.completedAt)) {
    throw new Error("Provenance work times are reversed");
  }
  return { valid: true, schemaSha256: schema.sha256, requestSha256: request.sha256, artifactSha256: result.sha256 };
}

try {
  if (process.argv.length !== 5) throw new Error("Expected schema, request and result paths");
  console.log(JSON.stringify(verify(...process.argv.slice(2))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
