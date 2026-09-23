import { getString } from "./locale"

export type ReviewErrorCode =
  | "no-selection"
  | "needs-pdf"
  | "needs-key"
  | "needs-runtime"
  | "insufficient-data"
  | "budget-exceeded"
  | "budget-unavailable"
  | "failed"
  | "corpus-busy"
  | "corpus-invalid-slug"
  | "corpus-invalid-index"
  | "corpus-identity-conflict"
  | "corpus-filesystem-error"
  | "corpus-invalid-request"

/** Only fixed, reviewed messages may cross the diagnostic UI boundary. */
export class ReviewTaskError extends Error {
  constructor(public readonly code: ReviewErrorCode) {
    super(code)
    this.name = "ReviewTaskError"
  }
}

export function reviewStatusError(status: string): ReviewTaskError {
  switch (status) {
    case "needs-key":
    case "needs-runtime":
    case "insufficient-data":
    case "budget-exceeded":
    case "budget-unavailable":
      return new ReviewTaskError(status)
    default:
      return new ReviewTaskError("failed")
  }
}

export function reviewErrorMessage(error: unknown): string {
  if (error instanceof ReviewTaskError) {
    return `${getString(`review-error-${error.code}`)} [${error.code}]`
  }
  // Native/third-party exception messages may contain paths or credentials.
  const kind =
    error instanceof Error &&
    ["TypeError", "ReferenceError", "SyntaxError"].includes(error.name)
      ? ` (${error.name})`
      : ""
  return getString("feature-execution-failed") + kind
}
