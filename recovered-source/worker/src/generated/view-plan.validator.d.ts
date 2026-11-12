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
