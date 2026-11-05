export interface ValidateError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
}
export interface ValidateFunction {
  (data: unknown): boolean;
  errors?: ValidateError[] | null;
}
export const validate: ValidateFunction;
export default validate;
export const COMPONENT_TYPES: readonly string[];
