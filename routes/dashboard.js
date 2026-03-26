const smart = require("fhirclient/lib/entry/node");
const fetch = require("node-fetch");
const { parseScopes, hasScope } = require("../lib/scope-guard");
const { ensureTestData } = require("../lib/ensure-test-data");

// The terminology server to use for ECL queries and $validate-code
const TX_SERVER = "https://tx.training.hl7.org.au/fhir";

/**
 * GET /dashboard
 *
 * Main application view. After SMART authentication, this route:
 *   1. Reads the patient demographics
 *   2. Fetches the patient's active MedicationRequests
 *   3. Fetches the patient's AllergyIntolerances
 *   4. For each medication, finds active ingredients via ECL
 *   5. Checks each ingredient against each allergy for contraindications
 */
exports.dashboard = async (req, res, next) => {
  try {
    // --- Restore the authenticated FHIR client from the session ---
    const client = await smart(req, res).ready();

    // --- Parse granted scopes so we can self-enforce access ---
    const grantedScopes = parseScopes(
      client.state.tokenResponse?.scope || ""
    );

    // --- Infrastructure: ensure our training patient exists with AU data ---
    // (Not part of the exercise — this runs silently before the student code)
    // Returns the patient ID of the training patient (Li Wang), which may
    // differ from the SMART launch patient if the server was reset.
    const patientId = await ensureTestData(client);

    // =============================================================
    // STEP 1: Read Patient demographics (pre-built)
    // =============================================================
    let patient = null;
    if (hasScope(grantedScopes, "Patient", "read")) {
      patient = await client.request(`Patient/${patientId}`);
    }

    // =============================================================
    // STEP 2: Fetch MedicationRequests
    // =============================================================
    let medications = [];
    let medsError = null;

    if (!hasScope(grantedScopes, "MedicationRequest", "read")) {
      medsError = "Scope not granted: patient/MedicationRequest.read";
    } else {
      // TODO 2: Fetch the patient's active MedicationRequests (SOLVED)
      const medsBundle = await client.request(`MedicationRequest?patient=${patientId}&status=active`);
      medications = (medsBundle.entry || []).map(e => e.resource);
    }

    // =============================================================
    // STEP 3: Fetch AllergyIntolerances
    // =============================================================
    let allergies = [];
    let allergiesError = null;

    if (!hasScope(grantedScopes, "AllergyIntolerance", "read")) {
      allergiesError = "Scope not granted: patient/AllergyIntolerance.read";
    } else {
      // TODO 3: Fetch the patient's AllergyIntolerances (SOLVED)
      const allergyBundle = await client.request(`AllergyIntolerance?patient=${patientId}`);
      allergies = (allergyBundle.entry || []).map(e => e.resource);
    }

    // =============================================================
    // STEP 4: Extract ingredients for each medication using ECL
    // =============================================================
    for (const med of medications) {
      const code = getMedicationCode(med);
      if (!code) {
        med._ingredients = [];
        continue;
      }

      // TODO 4: Get the active ingredients of this medication (SOLVED)
      const txUrl = `${TX_SERVER}/ValueSet/$expand?url=` +
        encodeURIComponent(`http://snomed.info/sct?fhir_vs=ecl/${code}.127489000`);
      const txResponse = await fetch(txUrl, {
        headers: { Accept: "application/fhir+json" }
      });
      const valueSet = await txResponse.json();
      med._ingredients = (valueSet.expansion?.contains || []);
    }

    // =============================================================
    // STEP 5: Check for contraindications
    // =============================================================
    const contraindications = [];

    for (const med of medications) {
      for (const ingredient of med._ingredients || []) {
        for (const allergy of allergies) {
          const allergyCode = getAllergyCode(allergy);
          if (!allergyCode) continue;

          // TODO 5: Check if the ingredient is a kind of the allergy substance (SOLVED)
          const checkUrl = `${TX_SERVER}/ValueSet/$validate-code?` +
            `url=` + encodeURIComponent(`http://snomed.info/sct?fhir_vs=ecl/<< ${allergyCode}`) +
            `&system=http://snomed.info/sct` +
            `&code=${ingredient.code}`;
          const checkResponse = await fetch(checkUrl, {
            headers: { Accept: "application/fhir+json" }
          });
          const result = await checkResponse.json();
          const isContraindicated = result.parameter?.find(
            p => p.name === "result"
          )?.valueBoolean === true;
          if (isContraindicated) {
            contraindications.push({
              medication: getMedicationDisplay(med),
              medicationCode: getMedicationCode(med),
              ingredient: ingredient.display,
              ingredientCode: ingredient.code,
              allergy: getAllergyDisplay(allergy),
              allergyCode: allergyCode,
            });
          }
        }
      }
    }

    // =============================================================
    // Render the dashboard
    // =============================================================
    res.render("dashboard", {
      patient,
      medications,
      allergies,
      contraindications,
      medsError,
      allergiesError,
      grantedScopes,
      getMedicationDisplay,
      getMedicationCode,
      getAllergyDisplay,
      getAllergyCode,
    });
  } catch (err) {
    if (err.message && err.message.includes("No state found")) {
      return res.redirect("/");
    }
    next(err);
  }
};

// =================================================================
// Helper functions (pre-built - students do not modify these)
// =================================================================

/**
 * Extract the SNOMED CT code from a MedicationRequest.
 * Handles both medicationCodeableConcept and contained Medication references.
 */
function getMedicationCode(med) {
  // Try medicationCodeableConcept first
  const cc = med.medicationCodeableConcept;
  if (cc?.coding) {
    const snomed = cc.coding.find(
      (c) => c.system === "http://snomed.info/sct"
    );
    if (snomed) return snomed.code;
  }

  // Try contained medication reference
  if (med.medicationReference?.reference?.startsWith("#")) {
    const containedId = med.medicationReference.reference.slice(1);
    const contained = (med.contained || []).find(
      (r) => r.id === containedId
    );
    if (contained?.code?.coding) {
      const snomed = contained.code.coding.find(
        (c) => c.system === "http://snomed.info/sct"
      );
      if (snomed) return snomed.code;
    }
  }

  return null;
}

/**
 * Get a display name for a MedicationRequest.
 */
function getMedicationDisplay(med) {
  const cc = med.medicationCodeableConcept;
  if (cc?.text) return cc.text;
  if (cc?.coding?.[0]?.display) return cc.coding[0].display;

  if (med.medicationReference?.reference?.startsWith("#")) {
    const containedId = med.medicationReference.reference.slice(1);
    const contained = (med.contained || []).find(
      (r) => r.id === containedId
    );
    if (contained?.code?.text) return contained.code.text;
    if (contained?.code?.coding?.[0]?.display)
      return contained.code.coding[0].display;
  }

  return "Unknown medication";
}

/**
 * Extract the SNOMED CT code from an AllergyIntolerance substance.
 * Checks reaction.substance first, then code.
 */
function getAllergyCode(allergy) {
  // Check reaction[0].substance
  const substance = allergy.reaction?.[0]?.substance;
  if (substance?.coding) {
    const snomed = substance.coding.find(
      (c) => c.system === "http://snomed.info/sct"
    );
    if (snomed) return snomed.code;
  }

  // Fall back to code
  const code = allergy.code;
  if (code?.coding) {
    const snomed = code.coding.find(
      (c) => c.system === "http://snomed.info/sct"
    );
    if (snomed) return snomed.code;
  }

  return null;
}

/**
 * Get a display name for an AllergyIntolerance.
 */
function getAllergyDisplay(allergy) {
  if (allergy.code?.text) return allergy.code.text;
  if (allergy.code?.coding?.[0]?.display) return allergy.code.coding[0].display;
  return "Unknown allergy";
}
