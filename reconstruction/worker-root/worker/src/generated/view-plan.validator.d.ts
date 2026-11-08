/**
 * NEW RECONSTRUCTION. Declaration only, for the recovered generated validator.
 * The JavaScript file is unchanged. This is not an original .d.ts.
 * Names match the module's runtime exports: `validate` and `default` are the same function.
 */
export interface ViewPlanSchemaError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}
export const validate: {
  (data: unknown): boolean;
  errors: ViewPlanSchemaError[] | null | undefined;
};
export default validate;
