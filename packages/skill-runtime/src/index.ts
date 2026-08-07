export const skillStatuses = ["success", "needs_input", "degraded", "not_supported", "blocked", "failed"] as const;
export type SkillStatus = typeof skillStatuses[number];

export interface SkillManifest {
  id: string;
  country: string;
  version: string;
  visibility: "internal";
  entrypoint: string;
  requiredInputs: string[];
  optionalInputs: string[];
  permittedProfileFields: string[];
  permittedPlanFields: string[];
  capabilities: string[];
  sources: Record<string, unknown>;
  risk: { information: "ordinary" | "sensitive" | "regulated"; action: "read_only" | "reversible" | "external_handoff" | "irreversible" };
  executionPolicy: "automatic" | "automatic_with_notice" | "confirmation_required" | "external_handoff";
  failure: Record<string, unknown>;
}

export interface SkillResultEnvelope {
  skill: { id: string; version: string };
  status: SkillStatus;
  summary: string;
  facts: unknown[];
  assumptions: unknown[];
  recommendations: unknown[];
  proposedPlanChanges: unknown[];
  proposedTasks: unknown[];
  proposedReminders: unknown[];
  actionCards: unknown[];
  sources: unknown[];
  warnings: unknown[];
}

export type SkillHandler = (input: unknown) => unknown | Promise<unknown>;

export interface SkillRegistration {
  manifest: SkillManifest;
  entrypoint: string;
  handler: SkillHandler;
}

export interface SkillRegistry {
  list(): SkillManifest[];
  get(id: string): SkillManifest | undefined;
  invoke(id: string, input: unknown): Promise<SkillResultEnvelope>;
}

export function parseSkillManifest(value: unknown): SkillManifest {
  if (!isRecord(value)) throw new Error("Skill manifest must be an object.");
  const manifest: SkillManifest = {
    id: requiredString(value, "id"),
    country: requiredString(value, "country"),
    version: requiredString(value, "version"),
    visibility: requiredEnum(value, "visibility", ["internal"]),
    entrypoint: requiredString(value, "entrypoint"),
    requiredInputs: stringArray(value, "requiredInputs"),
    optionalInputs: optionalStringArray(value, "optionalInputs"),
    permittedProfileFields: stringArray(value, "permittedProfileFields"),
    permittedPlanFields: stringArray(value, "permittedPlanFields"),
    capabilities: stringArray(value, "capabilities"),
    sources: recordField(value, "sources"),
    risk: parseRisk(value.risk),
    executionPolicy: requiredEnum(value, "executionPolicy", ["automatic", "automatic_with_notice", "confirmation_required", "external_handoff"]),
    failure: recordField(value, "failure")
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error(`Invalid Skill id: ${manifest.id}`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`Invalid Skill version: ${manifest.version}`);
  const overlap = manifest.requiredInputs.find((field) => manifest.optionalInputs.includes(field));
  if (overlap) throw new Error(`Skill input cannot be both required and optional: ${overlap}`);
  return manifest;
}

export function createSkillRegistry(registrations: SkillRegistration[]): SkillRegistry {
  const byId = new Map<string, SkillRegistration>();
  for (const registration of registrations) {
    const manifest = parseSkillManifest(registration.manifest);
    if (byId.has(manifest.id)) throw new Error(`Duplicate Skill id: ${manifest.id}`);
    if (registration.entrypoint !== manifest.entrypoint) throw new Error(`Entrypoint mismatch for ${manifest.id}.`);
    if (typeof registration.handler !== "function") throw new Error(`Handler is missing for ${manifest.id}.`);
    byId.set(manifest.id, { ...registration, manifest });
  }
  return {
    list: () => [...byId.values()].map((registration) => structuredClone(registration.manifest)),
    get: (id) => {
      const manifest = byId.get(id)?.manifest;
      return manifest ? structuredClone(manifest) : undefined;
    },
    invoke: async (id, input) => {
      const registration = byId.get(id);
      if (!registration) throw new Error(`Unknown Skill: ${id}`);
      const result = await registration.handler(input);
      return validateSkillResult(result, registration.manifest);
    }
  };
}

export function validateSkillResult(value: unknown, manifest: Pick<SkillManifest, "id" | "version">): SkillResultEnvelope {
  if (!isRecord(value) || !isRecord(value.skill)) throw new Error(`Skill ${manifest.id} returned a malformed result.`);
  if (value.skill.id !== manifest.id || value.skill.version !== manifest.version) throw new Error(`Skill ${manifest.id} returned a mismatched identity or version.`);
  if (typeof value.status !== "string" || !skillStatuses.includes(value.status as SkillStatus)) throw new Error(`Skill ${manifest.id} returned an unsupported status.`);
  if (typeof value.summary !== "string" || !value.summary.trim()) throw new Error(`Skill ${manifest.id} returned an empty summary.`);
  for (const field of ["facts", "assumptions", "recommendations", "proposedPlanChanges", "proposedTasks", "proposedReminders", "actionCards", "sources", "warnings"] as const) {
    if (!Array.isArray(value[field])) throw new Error(`Skill ${manifest.id} result field ${field} must be an array.`);
  }
  return value as unknown as SkillResultEnvelope;
}

function parseRisk(value: unknown): SkillManifest["risk"] {
  if (!isRecord(value)) throw new Error("Skill risk must be an object.");
  return {
    information: requiredEnum(value, "information", ["ordinary", "sensitive", "regulated"]),
    action: requiredEnum(value, "action", ["read_only", "reversible", "external_handoff", "irreversible"])
  };
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Skill manifest field ${field} must be a non-empty string.`);
  return value;
}

function stringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) throw new Error(`Skill manifest field ${field} must be a unique string array.`);
  return [...value] as string[];
}

function optionalStringArray(record: Record<string, unknown>, field: string): string[] {
  return record[field] === undefined ? [] : stringArray(record, field);
}

function recordField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) throw new Error(`Skill manifest field ${field} must be an object.`);
  return structuredClone(value);
}

function requiredEnum<const T extends string>(record: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const value = record[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Skill manifest field ${field} has an unsupported value.`);
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
