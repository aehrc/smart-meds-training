/**
 * Auto-inject sample test data if the FHIR server has been cleared.
 *
 * ======================================================================
 * INFRASTRUCTURE — NOT PART OF THE EXERCISE
 *
 * The SMART sandbox at launch.smarthealthit.org is periodically cleared.
 * This module runs at app startup and ensures our training patient
 * (Li Wang) exists with Australian medication and allergy data.
 *
 * It hits the FHIR server directly (no SMART auth needed — the sandbox
 * is open for writes). This runs before the student opens the launcher,
 * so Li Wang is available in the patient picker.
 * ======================================================================
 */

const fetch = require("node-fetch");

const FHIR_SERVER = "https://launch.smarthealthit.org/v/r4/fhir";
const PATIENT_NAME_FAMILY = "Wang";
const PATIENT_NAME_GIVEN = "Li";

const HEADERS = {
  Accept: "application/fhir+json",
  "Content-Type": "application/fhir+json",
};

/**
 * Ensure the training patient exists with AU test data.
 * Called at app startup. Returns the patient ID.
 */
async function ensureTestData() {
  try {
    // Search for our training patient by name
    const searchResp = await fetch(
      `${FHIR_SERVER}/Patient?family=${PATIENT_NAME_FAMILY}&given=${PATIENT_NAME_GIVEN}&_count=1`,
      { headers: HEADERS }
    );
    const searchBundle = await searchResp.json();
    const existing = searchBundle.entry || [];

    let patientId;

    if (existing.length > 0) {
      patientId = existing[0].resource.id;
      console.log(`[test-data] Found training patient: Patient/${patientId}`);

      // Check if clinical data is present
      const medsResp = await fetch(
        `${FHIR_SERVER}/MedicationRequest?patient=${patientId}&status=active&_count=1`,
        { headers: HEADERS }
      );
      const medsBundle = await medsResp.json();
      const allergyResp = await fetch(
        `${FHIR_SERVER}/AllergyIntolerance?patient=${patientId}&_count=1`,
        { headers: HEADERS }
      );
      const allergyBundle = await allergyResp.json();

      const hasMeds = (medsBundle.total || (medsBundle.entry || []).length) > 0;
      const hasAllergies = (allergyBundle.total || (allergyBundle.entry || []).length) > 0;

      if (hasMeds && hasAllergies) {
        console.log("[test-data] Clinical data present — ready to go");
        return patientId;
      }

      console.log("[test-data] Patient exists but clinical data missing — injecting...");
    } else {
      // Create the patient
      console.log("[test-data] Training patient not found — creating Li Wang...");
      const patient = {
        resourceType: "Patient",
        identifier: [
          {
            type: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MC" }],
              text: "Medicare Number",
            },
            system: "http://ns.electronichealth.net.au/id/medicare-number",
            value: "6951449677",
          },
        ],
        active: true,
        name: [{ use: "official", family: PATIENT_NAME_FAMILY, given: [PATIENT_NAME_GIVEN] }],
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

      const createResp = await fetch(`${FHIR_SERVER}/Patient`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(patient),
      });
      const created = await createResp.json();
      patientId = created.id;
      console.log(`[test-data] Created Patient/${patientId}`);
    }

    // Inject clinical data for this patient
    await injectClinicalData(patientId);
    return patientId;
  } catch (err) {
    console.error("[test-data] Warning: could not ensure test data:", err.message);
    return null;
  }
}

/**
 * Look up the training patient ID at dashboard time.
 * Used by the dashboard route to query the right patient regardless of
 * which patient was selected in the SMART launcher.
 */
async function getTrainingPatientId() {
  try {
    const resp = await fetch(
      `${FHIR_SERVER}/Patient?family=${PATIENT_NAME_FAMILY}&given=${PATIENT_NAME_GIVEN}&_count=1`,
      { headers: HEADERS }
    );
    const bundle = await resp.json();
    if ((bundle.entry || []).length > 0) {
      return bundle.entry[0].resource.id;
    }
  } catch (err) {
    console.error("[test-data] Could not find training patient:", err.message);
  }
  return null;
}

async function injectClinicalData(patientId) {
  // AllergyIntolerance — Penicillin (high criticality, anaphylaxis)
  await post("AllergyIntolerance", {
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
    reaction: [{
      substance: { coding: [{ system: "http://snomed.info/sct", code: "764146007", display: "Penicillin" }] },
      manifestation: [{ coding: [{ system: "http://snomed.info/sct", code: "39579001", display: "Anaphylaxis" }] }],
      severity: "severe",
    }],
  });
  console.log("[test-data]   + AllergyIntolerance: Penicillin");

  // MedicationRequest — Amoxicillin 500mg capsule (CONTRAINDICATED with penicillin allergy)
  await post("MedicationRequest", {
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
  console.log("[test-data]   + MedicationRequest: Amoxicillin 500mg capsule");

  // MedicationRequest — Paracetamol + codeine (safe)
  await post("MedicationRequest", {
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
  console.log("[test-data]   + MedicationRequest: Panadeine Forte");

  // MedicationRequest — Reaptan via contained Medication (safe)
  await post("MedicationRequest", {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    contained: [{
      resourceType: "Medication",
      id: "med-reaptan",
      code: {
        coding: [{ system: "http://snomed.info/sct", code: "926213011000036100", display: "Reaptan 10/10 (perindopril arginine 10 mg + amlodipine 10 mg) tablet" }],
        text: "Reaptan 10/10 (perindopril/amlodipine) tablet",
      },
    }],
    medicationReference: { reference: "#med-reaptan" },
    subject: { reference: `Patient/${patientId}` },
    authoredOn: "2024-09-01",
    dosageInstruction: [{ text: "1 tablet daily in the morning" }],
  });
  console.log("[test-data]   + MedicationRequest: Reaptan");

  console.log("[test-data] Sample data injection complete");
}

async function post(resourceType, resource) {
  const resp = await fetch(`${FHIR_SERVER}/${resourceType}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(resource),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[test-data] POST ${resourceType} failed: ${resp.status} ${body.substring(0, 200)}`);
  }
}

module.exports = { ensureTestData, getTrainingPatientId };
