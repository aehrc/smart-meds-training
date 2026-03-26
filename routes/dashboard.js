const smart = require("fhirclient/lib/entry/node");
const fetch = require("node-fetch");
const { parseScopes, hasScope } = require("../lib/scope-guard");


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

    const patientId = client.patient.id;
    console.log(`[dashboard] Patient ID: ${patientId}`);
    console.log(`[dashboard] FHIR server: ${client.state.serverUrl}`);
    console.log(`[dashboard] Granted scopes: ${client.state.tokenResponse?.scope}`);


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
      // -------------------------------------------------------------
      // TODO 2: Write the FHIR search query for MedicationRequests
      //
      // What search parameters do you need to find this patient's
      // active medications?
      //
      // HINT: The resource type is MedicationRequest. You need to
      //       filter by patient and by status. The patient ID is
      //       available as the variable: patientId
      //
      // Replace the empty string below with the FHIR search path:
      // -------------------------------------------------------------
      const MEDICATION_QUERY = ``; // <-- e.g. `MedicationRequest?patient=${patientId}&...`
      const medsBundle = await client.request(MEDICATION_QUERY);
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
      // -------------------------------------------------------------
      // TODO 3: Write the FHIR search query for AllergyIntolerances
      //
      // What search parameters do you need to find this patient's
      // allergies?
      //
      // Replace the empty string below with the FHIR search path:
      // -------------------------------------------------------------
      const ALLERGY_QUERY = ``; // <-- e.g. `AllergyIntolerance?patient=${patientId}`
      const allergyBundle = await client.request(ALLERGY_QUERY);
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

      // -------------------------------------------------------------
      // TODO 4: Write the ECL expression to get active ingredients
      //
      // The terminology server can find the active ingredients of a
      // medication using ECL dot notation to traverse relationships.
      //
      // The SNOMED attribute for "has active ingredient" is 127489000.
      // The ECL pattern is:  {medicationCode}.127489000
      //
      // Fill in the ECL expression below. The variable `code` contains
      // the medication's SNOMED/AMT code.
      //
      // Replace the empty string with your ECL:
      // -------------------------------------------------------------
      const INGREDIENT_ECL = ``; // <-- e.g. `${code}.127489000`
      const txUrl = `${TX_SERVER}/ValueSet/$expand?url=` +
        encodeURIComponent(`http://snomed.info/sct?fhir_vs=ecl/${INGREDIENT_ECL}`);
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

          // -----------------------------------------------------------
          // TODO 5: Write the ECL for the $validate-code check
          //
          // We need to check: "Is this ingredient a type of the
          // allergy substance (or any of its subtypes)?"
          //
          // The ECL expression << {code} means "this concept or any
          // of its descendants". We use $validate-code to test whether
          // the ingredient code is a member of that set.
          //
          // The variable `allergyCode` has the allergy substance code.
          // The variable `ingredient.code` has the ingredient code.
          //
          // Fill in the ECL expression below:
          // -----------------------------------------------------------
          const SUBSUMPTION_ECL = ``; // <-- e.g. `<< ${allergyCode}`
          const checkUrl = `${TX_SERVER}/ValueSet/$validate-code?` +
            `url=` + encodeURIComponent(`http://snomed.info/sct?fhir_vs=ecl/${SUBSUMPTION_ECL}`) +
            `&system=http://snomed.info/sct` +
            `&code=${ingredient.code}`;
          const checkResponse = await fetch(checkUrl, {
            headers: { Accept: "application/fhir+json" }
          });
          const checkResult = await checkResponse.json();
          const isContraindicated = checkResult.parameter?.find(
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
