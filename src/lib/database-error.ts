import { DrizzleQueryError } from "drizzle-orm/errors";

/** Keep SQL, parameters and connection details out of browser responses. */
export function databaseErrorResponse(error: unknown) {
  if (!(error instanceof DrizzleQueryError)) return null;
  return {
    status: 503,
    body: {
      error:
        "The project database is unavailable. Please try again once the database service is restored.",
      code: "DATABASE_UNAVAILABLE",
    },
  };
}
