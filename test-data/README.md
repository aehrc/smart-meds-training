# Test Data Setup

This directory contains a FHIR transaction Bundle that creates a test patient
with medications and allergies suitable for demonstrating the contraindication
checker.

## What gets created

| Resource              | Details                                                       |
|-----------------------|---------------------------------------------------------------|
| **Patient**           | Li Wang, male, DOB 1980-06-15, Sydney AU                      |
| **AllergyIntolerance**| Penicillin allergy (SNOMED 764146007), high criticality        |
| **MedicationRequest** | Amoxicillin 500mg capsule (AMT 23551011000036108) -- triggers contraindication |
| **MedicationRequest** | Panadeine Forte / paracetamol+codeine (AMT 79115011000036100) -- safe |
| **MedicationRequest** | Reaptan 10/10 / perindopril+amlodipine (AMT 926213011000036100, contained Medication) -- safe |

## Expected result

When the app runs against this patient:

- **Amoxicillin** contains the ingredient **amoxicillin (372687004)**, which is
  a descendant of **penicillin (764146007)** in SNOMED CT.
- The `$validate-code` check will return `true`, flagging a contraindication.
- The other two medications have no relationship to penicillin and should
  show as safe.

## Loading the test data

### Into the SMART Launcher's sandbox FHIR server

The SMART launcher at `launch.smarthealthit.org` uses a public FHIR sandbox.
POST the bundle to it:

```bash
curl -X POST \
  https://launch.smarthealthit.org/v/r4/fhir \
  -H "Content-Type: application/fhir+json" \
  -d @setup-patient.json
```

The response will contain the assigned resource IDs. Note the Patient ID -- you
will need to select this patient when launching from the SMART launcher.

### Example response (abbreviated)

```json
{
  "resourceType": "Bundle",
  "type": "transaction-response",
  "entry": [
    { "response": { "status": "201 Created", "location": "Patient/abc123" } },
    { "response": { "status": "201 Created", "location": "AllergyIntolerance/def456" } },
    ...
  ]
}
```

Take the Patient ID from the first entry's location (e.g. `abc123`) and use it
when configuring the SMART launcher.
