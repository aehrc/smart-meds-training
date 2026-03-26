const smart = require("fhirclient/lib/entry/node");

/**
 * GET /launch
 *
 * This endpoint is the SMART App Launch URL. The EHR (or the SMART launcher
 * at launch.smarthealthit.org) redirects here with `iss` and `launch` parameters.
 * We call smart.authorize() to begin the OAuth2 dance.
 */
exports.launch = (req, res, next) => {
  smart(req, res)
    .authorize({
      clientId: "smart-meds-checker",
      redirectUri: "/callback",

      // TODO 1: Configure the SMART scopes (SOLVED)
      scope: "launch openid fhirUser patient/Patient.read patient/MedicationRequest.read patient/AllergyIntolerance.read",
    })
    .catch(next);
};

/**
 * GET /callback
 *
 * OAuth2 redirect URI. fhirclient handles the token exchange and stores
 * the authenticated client in the session.
 */
exports.callback = (req, res, next) => {
  smart(req, res)
    .completeAuth()
    .then(() => {
      res.redirect("/dashboard");
    })
    .catch(next);
};
