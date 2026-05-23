const VALID_ERROR_TYPES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "rate_limit_error",
  "api_error",
  "service_unavailable_error"
]);

export function makeOpenAIError({
  message,
  type = "api_error",
  param = null,
  code = null
}) {
  const safeType = VALID_ERROR_TYPES.has(type) ? type : "api_error";
  return {
    error: {
      message: String(message || "Unexpected error"),
      type: safeType,
      param: param ?? null,
      code: code ?? null
    }
  };
}

export function writeOpenAIError(res, statusCode, error, headers = {}) {
  const body = JSON.stringify(makeOpenAIError(error));
  res.statusCode = statusCode;
  for (const [key, value] of Object.entries(headers || {})) {
    if (value !== undefined && value !== null) {
      res.setHeader(key, String(value));
    }
  }
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

export function isOpenAIErrorEnvelope(value) {
  return !!(
    value &&
    typeof value === "object" &&
    value.error &&
    typeof value.error === "object" &&
    typeof value.error.message === "string"
  );
}
