/**
 * Auto-inject sample test data if the FHIR server has been cleared.
 *
 * ======================================================================
 * INFRASTRUCTURE — NOT PART OF THE EXERCISE
 *
 * The SMART sandbox at launch.smarthealthit.org is periodically cleared.
 * This module checks whether our training patient (Li Wang) exists, and
 * creates the patient + medications + allergies if missing.
 *
 * The patient is identified by a Medicare number identifier rather than
 * a fixed resource ID, so we don't collide with existing server data.
 *
 * This bypasses the scope guard because it's a setup concern, not
 * something students need to worry about.
 * ======================================================================
 */

const fetch = require("node-fetch");

const TRAINING_IDENTIFIER_SYSTEM = "http://ns.electronichealth.net.au/id/medicare-number";
const TRAINING_IDENTIFIER_VALUE = "6951449677";

/**
 * Ensure the training patient (Li Wang) exists with AU test data.
 * Returns the patient ID to use for all subsequent queries.
 *
 * @param {object} client - The authenticated fhirclient instance
 * @returns {string} The patient ID to use
 */
async function ensureTestData(client) {
  const fhirUrl = client.state.serverUrl;
  const token = client.state.tokenResponse?.access_token;

  const headers = {
    Accept: "application/fhir+json",
    "Content-Type": "application/fhir+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    // Search for our training patient by Medicare identifier
    const searchResp = await fetch(
      `${fhirUrl}/Patient?identifier=${encodeURIComponent(TRAINING_IDENTIFIER_SYSTEM)}|${TRAINING_IDENTIFIER_VALUE}`,
      { headers }
    );
    const searchBundle = await searchResp.json();
    const existingPatients = searchBundle.entry || [];

    let patientId;

    if (existingPatients.length > 0) {
      patientId = existingPatients[0].resource.id;
      console.log(`[ensure-test-data] Found training patient: Patient/${patientId}`);

      // Check if data is present
      const medsResp = await fetch(
        `${fhirUrl}/MedicationRequest?patient=${patientId}&status=active&_count=1`,
        { headers }
      );
      const medsBundle = await medsResp.json();
      if ((medsBundle.total || 0) > 0) {
        console.log("[ensure-test-data] Test data already present — skipping injection");
        return patientId;
      }

      console.log("[ensure-test-data] Patient exists but data is missing — re-injecting...");
    } else {
      // Create the patient
      console.log("[ensure-test-data] Training patient not found — creating...");
      const patient = {
        resourceType: "Patient",
        identifier: [
          {
            type: {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                  code: "MC",
                  display: "Patient's Medicare number",
                },
              ],
              text: "Medicare Number",
            },
            system: TRAINING_IDENTIFIER_SYSTEM,
            value: TRAINING_IDENTIFIER_VALUE,
          },
        ],
        active: true,
        name: [{ use: "official", family: "Wang", given: ["Li"] }],
        gender: "male",
        birthDate: "1980-06-15",
        address: [
          {
            use: "home",
            line: ["29 Shortland Street"],
            city: "Sydney",
            state: "NSW",
            postalCode: "2000",
            country: "AU",
          },
        ],
      };

      const createResp = await fetch(`${fhirUrl}/Patient`, {
        method: "POST",
        headers,
        body: JSON.stringify(patient),
      });
      const created = await createResp.json();
      patientId = created.id;
      console.log(`[ensure-test-data] Created Patient/${patientId}`);
    }

    // Inject clinical data
    await injectClinicalData(fhirUrl, headers, patientId);

    return patientId;
  } catch (err) {
    console.error("[ensure-test-data] Warning: could not ensure test data:", err.message);
    // Fall back to the SMART launch patient if injection fails
    return client.patient.id;
  }
}

async function injectClinicalData(fhirUrl, headers, patientId) {
  // AllergyIntolerance — Penicillin
  await postResource(fhirUrl, headers, {
    resourceType: "AllergyIntolerance",
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active", display: "Active" }],
    },
    verificationStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed", display: "Confirmed" }],
    },
    type: "allergy",
    category: ["medication"],
    criticality: "high",
    code: {
      coding: [{ system: "http://snomed.info/sct", code: "764146007", display: "Penicillin" }],
      text: "Penicillin",
    },
    patient: { reference: `Patient/${patientId}` },
    recordedDate: "2015-03-10",
    reaction: [
      {
        substance: { coding: [{ system: "http://snomed.info/sct", code: "764146007", display: "Penicillin" }] },
        manifestation: [{ coding: [{ system: "http://snomed.info/sct", code: "39579001", display: "Anaphylaxis" }] }],
        severity: "severe",
      },
    ],
  });
  console.log("[ensure-test-data] Created AllergyIntolerance (Penicillin)");

  // MedicationRequest — Amoxicillin 500mg (CONTRAINDICATED)
  await postResource(fhirUrl, headers, {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    medicationCodeableConcept: {
      coding: [{ system: "http://snomed.info/sct", code: "23551011000036108", display: "Amoxicillin 500 mg capsule" }],
      text: "Amoxicillin 500 mg capsule",
    },
    subject: { reference: `Patient/${patientId}` },
    authoredOn: "2024-11-01",
    dosageInstruction: [{ text: "1 capsule three times daily" }],
  });
  console.log("[ensure-test-data] Created MedicationRequest (Amoxicillin)");

  // MedicationRequest — Paracetamol + codeine (safe)
  await postResource(fhirUrl, headers, {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    medicationCodeableConcept: {
      coding: [{ system: "http://snomed.info/sct", code: "79115011000036100", display: "Paracetamol 500 mg + codeine phosphate hemihydrate 30 mg tablet" }],
      text: "Panadeine Forte (paracetamol 500 mg + codeine 30 mg) tablet",
    },
    subject: { reference: `Patient/${patientId}` },
    authoredOn: "2024-10-15",
    dosageInstruction: [{ text: "1-2 tablets every 4-6 hours as needed" }],
  });
  console.log("[ensure-test-data] Created MedicationRequest (Paracetamol+Codeine)");

  // MedicationRequest — Reaptan via contained Medication (safe)
  await postResource(fhirUrl, headers, {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    contained: [
      {
        resourceType: "Medication",
        id: "med-reaptan",
        code: {
          coding: [{ system: "http://snomed.info/sct", code: "926213011000036100", display: "Reaptan 10/10 (perindopril arginine 10 mg + amlodipine 10 mg) tablet" }],
          text: "Reaptan 10/10 (perindopril/amlodipine) tablet",
        },
      },
    ],
    medicationReference: { reference: "#med-reaptan" },
    subject: { reference: `Patient/${patientId}` },
    authoredOn: "2024-09-01",
    dosageInstruction: [{ text: "1 tablet daily in the morning" }],
  });
  console.log("[ensure-test-data] Created MedicationRequest (Reaptan)");

  console.log("[ensure-test-data] Sample data injection complete");
}

async function postResource(fhirUrl, headers, resource) {
  const resp = await fetch(`${fhirUrl}/${resource.resourceType}`, {
    method: "POST",
    headers,
    body: JSON.stringify(resource),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[ensure-test-data] POST ${resource.resourceType} failed: ${resp.status} ${body.substring(0, 200)}`);
  }
}

module.exports = { ensureTestData };
