/**
 * NEW RECONSTRUCTION. Declaration for the recovered MCP validator.
 * The JavaScript file is unchanged and still requires ajv at runtime.
 */
export interface ViewPlanSchemaError {
  instancePath?: string;
  keyword?: string;
  message?: string;
}
export const COMPONENT_TYPES: readonly string[];
export const validate: {
  (data: unknown): boolean;
  errors: ViewPlanSchemaError[] | null | undefined;
};
export default validate;
