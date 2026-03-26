/**
 * Scope Guard Utility
 *
 * The FHIR server at launch.smarthealthit.org does NOT enforce scopes,
 * meaning requests will succeed even if the app was not granted the
 * required scope. This utility lets the app self-enforce scope checks
 * so students can see the effect of missing scopes.
 */

/**
 * Parse the granted scope string into an array of individual scopes.
 * @param {string} scopeString - Space-separated scope string from the token response.
 * @returns {string[]} Array of scope strings.
 */
function parseScopes(scopeString) {
  if (!scopeString) return [];
  return scopeString.split(/\s+/).filter(Boolean);
}

/**
 * Check whether a specific FHIR resource scope was granted.
 *
 * Supports patterns like:
 *   patient/Patient.read
 *   patient/Patient.*
 *   patient/*.read
 *   patient/*.*
 *   user/Patient.read  (also accepted)
 *
 * @param {string[]} grantedScopes - Array of granted scope strings.
 * @param {string} resourceType - e.g. "Patient", "MedicationRequest"
 * @param {string} [action="read"] - "read" or "write" or "*"
 * @returns {boolean}
 */
function hasScope(grantedScopes, resourceType, action = "read") {
  if (!Array.isArray(grantedScopes)) return false;

  for (const scope of grantedScopes) {
    // Match patient/ or user/ scopes
    const match = scope.match(/^(?:patient|user)\/(\*|\w+)\.(\*|read|write)$/);
    if (!match) continue;

    const [, scopeResource, scopeAction] = match;

    const resourceOk = scopeResource === "*" || scopeResource === resourceType;
    const actionOk = scopeAction === "*" || scopeAction === action;

    if (resourceOk && actionOk) return true;
  }

  return false;
}

module.exports = { parseScopes, hasScope };
