export const clinicalTrialTemplate = {
  "studyType": "clinical-trial",
  "displayName": "Clinical Trial",
  "entities": [
    {
      "name": "Authors",
      "prompt": "Extract all authors and their affiliations from the study.\n\nFew-shot examples:\nInput: \"John Smith, MD, PhD¹, Sarah Johnson, PharmD², Michael Brown, MD¹\"\nOutput: \"John Smith (MD, PhD, Affiliation 1), Sarah Johnson (PharmD, Affiliation 2), Michael Brown (MD, Affiliation 1)\"\n\nInput: \"Lead investigators: Dr. Maria Garcia from Stanford University and Prof. David Lee from Harvard Medical School\"\nOutput: \"Maria Garcia (Stanford University), David Lee (Harvard Medical School)\"\n\nExtract the authors from the document following this format."
    },
    {
      "name": "Sources of Funding",
      "prompt": "Identify all funding sources, grants, and financial support mentioned in the study.\n\nFew-shot examples:\nInput: \"This study was supported by NIH grant R01-123456 and Pfizer Inc.\"\nOutput: \"NIH grant R01-123456, Pfizer Inc.\"\n\nInput: \"Funding: National Science Foundation (NSF-2021-789), European Research Council Advanced Grant 694679\"\nOutput: \"National Science Foundation (NSF-2021-789), European Research Council Advanced Grant 694679\"\n\nExtract all funding sources from the document."
    },
    {
      "name": "Test Material/Drug",
      "prompt": "Extract information about the investigational drug, compound, or intervention being tested.\n\nFew-shot examples:\nInput: \"Patients received either Drug X (10mg tablets) or matching placebo\"\nOutput: \"Drug X (10mg tablets)\"\n\nInput: \"The study medication was ABC-123, a novel monoclonal antibody targeting VEGF\"\nOutput: \"ABC-123 (novel monoclonal antibody targeting VEGF)\"\n\nExtract the test material or drug from the document."
    },
    {
      "name": "Dose Level Tested",
      "prompt": "Extract all dose levels, concentrations, or dosing regimens tested in the study.\n\nFew-shot examples:\nInput: \"Patients were randomized to receive 5mg, 10mg, or 20mg once daily\"\nOutput: \"5mg once daily, 10mg once daily, 20mg once daily\"\n\nInput: \"The dose escalation included 0.1mg/kg, 0.3mg/kg, and 1.0mg/kg administered intravenously\"\nOutput: \"0.1mg/kg IV, 0.3mg/kg IV, 1.0mg/kg IV\"\n\nExtract all dose levels tested from the document."
    },
    {
      "name": "Study Phase",
      "prompt": "Extract the clinical trial phase from the document.\n\nFew-shot examples:\nInput: \"This Phase III study evaluated...\"\nOutput: \"Phase III\"\n\nInput: \"A Phase I/II dose escalation study\"\nOutput: \"Phase I/II\"\n\nExtract the study phase."
    },
    {
      "name": "Primary Endpoint",
      "prompt": "Identify the primary endpoint or primary outcome measure.\n\nFew-shot examples:\nInput: \"The primary endpoint was change from baseline in systolic blood pressure at 12 weeks\"\nOutput: \"Change from baseline in systolic blood pressure at 12 weeks\"\n\nInput: \"Primary outcome: Overall survival (OS) defined as time from randomization to death\"\nOutput: \"Overall survival (OS) - time from randomization to death\"\n\nExtract the primary endpoint."
    },
    {
      "name": "Sample Size",
      "prompt": "Extract the number of patients or participants enrolled.\n\nFew-shot examples:\nInput: \"A total of 450 patients were randomized (225 to each arm)\"\nOutput: \"450 patients total (225 per arm)\"\n\nInput: \"The study enrolled 1,247 participants across 15 sites\"\nOutput: \"1,247 participants across 15 sites\"\n\nExtract the sample size information."
    }
  ]
};