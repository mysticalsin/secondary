/** Status codes the Anthropic clients retry. Shared so the two call loops cannot drift. */
export const RETRYABLE_HTTP_STATUS: readonly number[] = [408, 409, 429, 500, 502, 503, 504, 529];

const RETRYABLE = new Set(RETRYABLE_HTTP_STATUS);

export const isRetryableHttpStatus = (status: number): boolean => RETRYABLE.has(status);
