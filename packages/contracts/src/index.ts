import _Ajv2020 from "ajv/dist/2020.js";
import _addFormats from "ajv-formats";
import { SCHEMA_BASE, SCHEMAS, type SchemaName } from "./schemas.ts";

export type { SchemaName } from "./schemas.ts";
export * from "./view-plan.ts";

// ajv and ajv-formats ship CommonJS with a default export; unwrap it whichever way the
// runtime or bundler hands it to us.
type Mod<T> = T | { default: T };
const unwrap = <T>(m: Mod<T>): T =>
  "default" in (m as object) ? (m as { default: T }).default : (m as T);
const Ajv2020 = unwrap(
  _Ajv2020 as unknown as Mod<typeof _Ajv2020>,
) as unknown as typeof _Ajv2020.default;
const addFormats = unwrap(
  _addFormats as unknown as Mod<typeof _addFormats>,
) as unknown as typeof _addFormats.default;

export const SCHEMA_NAMES = (Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]).filter(
  (n): n is SchemaName => n !== "common",
);

export interface ValidationResult {
  valid: boolean;
  /** One line per error: `<instance path> <keyword>:<message> <params>`. Empty when valid. */
  errors: string[];
}

let ajv: InstanceType<typeof Ajv2020> | undefined;

function instance() {
  if (!ajv) {
    // Draft 2020-12, strict. allErrors so callers see every problem.
    const a = new Ajv2020({ strict: true, allErrors: true });
    addFormats(a);
    for (const s of Object.values(SCHEMAS)) a.addSchema(s as object);
    ajv = a;
  }
  return ajv;
}

const norm = (name: string) => name.replace(/\.schema\.json$/, "");

/** Validate `obj` against a contract schema, e.g. `validate("view-plan", plan)`. Throws on an unknown schema name. */
export function validate(schemaName: string, obj: unknown): ValidationResult {
  const name = norm(schemaName);
  if (!(name in SCHEMAS) || name === "common") throw new Error(`unknown schema: ${schemaName}`);
  const fn = instance().getSchema(`${SCHEMA_BASE}${name}.schema.json`);
  if (!fn) throw new Error(`schema not registered: ${schemaName}`);
  const valid = fn(obj) as boolean;
  const errors = valid
    ? []
    : (fn.errors ?? []).map((e) => {
        const params = Object.values(e.params).map(String).join(" ");
        return `${e.instancePath || "/"} ${e.keyword}:${e.message ?? ""} ${params}`.trim();
      });
  return { valid, errors };
}
