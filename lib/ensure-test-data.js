/**
 * Auto-inject sample test data if the FHIR server has been cleared.
 *
 * ======================================================================
 * INFRASTRUCTURE — NOT PART OF THE EXERCISE
 *
 * The SMART sandbox at launch.smarthealthit.org is periodically cleared.
 * This module checks whether the launched patient has the expected
 * Australian medication and allergy data, and injects it if missing.
 *
 * This bypasses the scope guard because it's a setup concern, not
 * something students need to worry about. The SMART scopes students
 * configure in TODO 1 are only for reading data.
 * ======================================================================
 */

const fetch = require("node-fetch");

/**
 * Ensure the launched patient has AU test data (medications + allergies).
 * If not, create the resources using the FHIR client's access token.
 *
 * @param {object} client - The authenticated fhirclient instance
 */
async function ensureTestData(client) {
  const patientId = client.patient.id;
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
    // Check if patient already has AMT-coded MedicationRequests
    const medsResp = await fetch(
      `${fhirUrl}/MedicationRequest?patient=${patientId}&status=active&_count=1`,
      { headers }
    );
    const medsBundle = await medsResp.json();
    const hasMeds = (medsBundle.entry || []).some((e) => {
      const med = e.resource;
      const codings = med?.medicationCodeableConcept?.coding || [];
      // Check for AMT codes (long SCTIDs from AU module)
      return codings.some(
        (c) =>
          c.system === "http://snomed.info/sct" &&
          c.code &&
          c.code.length > 10
      );
    });

    if (hasMeds) {
      console.log("[ensure-test-data] Patient already has AU medication data — skipping injection");
      return;
    }

    console.log("[ensure-test-data] No AU medication data found — injecting sample data...");

    // Also check/inject allergy
    const allergyResp = await fetch(
      `${fhirUrl}/AllergyIntolerance?patient=${patientId}&_count=1`,
      { headers }
    );
    const allergyBundle = await allergyResp.json();
    const hasAllergy = (allergyBundle.total || 0) > 0;

    // --- Inject AllergyIntolerance (penicillin) ---
    if (!hasAllergy) {
      const allergy = {
        resourceType: "AllergyIntolerance",
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              code: "active",
              display: "Active",
            },
          ],
        },
        verificationStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
              code: "confirmed",
              display: "Confirmed",
            },
          ],
        },
        type: "allergy",
        category: ["medication"],
        criticality: "high",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "764146007",
              display: "Penicillin",
            },
          ],
          text: "Penicillin",
        },
        patient: { reference: `Patient/${patientId}` },
        recordedDate: "2015-03-10",
        reaction: [
          {
            substance: {
              coding: [
                {
                  system: "http://snomed.info/sct",
                  code: "764146007",
                  display: "Penicillin",
                },
              ],
            },
            manifestation: [
              {
                coding: [
                  {
                    system: "http://snomed.info/sct",
                    code: "39579001",
                    display: "Anaphylaxis",
                  },
                ],
              },
            ],
            severity: "severe",
          },
        ],
      };
      await postResource(fhirUrl, headers, allergy);
      console.log("[ensure-test-data] Created AllergyIntolerance (Penicillin)");
    }

    // --- Inject MedicationRequests ---
    const medications = [
      {
        // Amoxicillin 500mg capsule — SHOULD trigger contraindication
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        medicationCodeableConcept: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "23551011000036108",
              display: "Amoxicillin 500 mg capsule",
            },
          ],
          text: "Amoxicillin 500 mg capsule",
        },
        subject: { reference: `Patient/${patientId}` },
        authoredOn: "2024-11-01",
        dosageInstruction: [{ text: "1 capsule three times daily" }],
      },
      {
        // Paracetamol + codeine — safe
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        medicationCodeableConcept: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "79115011000036100",
              display:
                "Paracetamol 500 mg + codeine phosphate hemihydrate 30 mg tablet",
            },
          ],
          text: "Panadeine Forte (paracetamol 500 mg + codeine 30 mg) tablet",
        },
        subject: { reference: `Patient/${patientId}` },
        authoredOn: "2024-10-15",
        dosageInstruction: [
          { text: "1-2 tablets every 4-6 hours as needed" },
        ],
      },
      {
        // Reaptan (contained Medication reference) — safe
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        contained: [
          {
            resourceType: "Medication",
            id: "med-reaptan",
            code: {
              coding: [
                {
                  system: "http://snomed.info/sct",
                  code: "926213011000036100",
                  display:
                    "Reaptan 10/10 (perindopril arginine 10 mg + amlodipine 10 mg) tablet",
                },
              ],
              text: "Reaptan 10/10 (perindopril/amlodipine) tablet",
            },
          },
        ],
        medicationReference: { reference: "#med-reaptan" },
        subject: { reference: `Patient/${patientId}` },
        authoredOn: "2024-09-01",
        dosageInstruction: [{ text: "1 tablet daily in the morning" }],
      },
    ];

    for (const med of medications) {
      await postResource(fhirUrl, headers, med);
      console.log(
        `[ensure-test-data] Created MedicationRequest: ${med.medicationCodeableConcept?.text || med.contained?.[0]?.code?.text || "?"}`
      );
    }

    console.log("[ensure-test-data] Sample data injection complete");
  } catch (err) {
    // Don't fail the app if data injection fails — just log and continue
    console.error("[ensure-test-data] Warning: could not inject test data:", err.message);
  }
}

async function postResource(fhirUrl, headers, resource) {
  const resp = await fetch(`${fhirUrl}/${resource.resourceType}`, {
    method: "POST",
    headers,
    body: JSON.stringify(resource),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(
      `[ensure-test-data] POST ${resource.resourceType} failed: ${resp.status} ${body.substring(0, 200)}`
    );
  }
}

module.exports = { ensureTestData };
