// Shared helper for handling API errors inside authenticated pages.
// Per the API contract: a 401 anywhere means "not authenticated" and should
// route to /session-expired; a 403 means "not allowed" and should route to /403.
// Anything else should be surfaced as a generic, non-leaking banner message.

export function getErrorMessage(err, fallback = "Something went wrong. Please try again.") {
  return err?.response?.data?.error || fallback;
}

// Returns true if it navigated away (caller should stop further handling).
export function routeOnAuthError(err, navigate) {
  const status = err?.response?.status;
  if (status === 401) {
    navigate("/session-expired");
    return true;
  }
  if (status === 403) {
    navigate("/403");
    return true;
  }
  return false;
}
