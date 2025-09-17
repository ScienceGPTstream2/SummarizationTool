export const reviewTemplate = {
  "studyType": "review",
  "displayName": "Literature Review",
  "entities": [
    {
      "name": "Authors",
      "prompt": "Extract authors and their affiliations.\n\nFew-shot examples:\nInput: \"Review article by Kumar S, Patel R from Johns Hopkins School of Medicine\"\nOutput: \"Kumar S, Patel R (Johns Hopkins School of Medicine)\"\n\nExtract the authors."
    },
    {
      "name": "Sources of Funding",
      "prompt": "Identify any funding sources for the review.\n\nFew-shot examples:\nInput: \"This review was supported by NIH training grant T32-HL007675\"\nOutput: \"NIH training grant T32-HL007675\"\n\nExtract funding sources."
    },
    {
      "name": "Review Scope",
      "prompt": "Define the scope and focus of the literature review.\n\nFew-shot examples:\nInput: \"This review examines current evidence for immunotherapy in non-small cell lung cancer from 2015-2023\"\nOutput: \"Current evidence for immunotherapy in non-small cell lung cancer (2015-2023)\"\n\nInput: \"Narrative review of machine learning applications in medical imaging with focus on diagnostic radiology\"\nOutput: \"Machine learning applications in medical imaging, focus on diagnostic radiology\"\n\nExtract the review scope."
    },
    {
      "name": "Key Themes",
      "prompt": "Extract the main themes or topics covered.\n\nFew-shot examples:\nInput: \"Major themes include efficacy, safety, biomarkers, and combination therapies\"\nOutput: \"Efficacy, safety, biomarkers, combination therapies\"\n\nInput: \"Review covers pathophysiology, diagnostic approaches, treatment modalities, and future directions\"\nOutput: \"Pathophysiology, diagnostic approaches, treatment modalities, future directions\"\n\nExtract key themes."
    },
    {
      "name": "Evidence Summary",
      "prompt": "Summarize the overall evidence and conclusions.\n\nFew-shot examples:\nInput: \"Current evidence strongly supports the use of checkpoint inhibitors as first-line therapy in PD-L1 positive tumors\"\nOutput: \"Strong evidence supports checkpoint inhibitors as first-line therapy in PD-L1 positive tumors\"\n\nExtract the evidence summary and main conclusions."
    },
    {
      "name": "Research Gaps",
      "prompt": "Identify any research gaps or future directions mentioned.\n\nFew-shot examples:\nInput: \"Future research should focus on identifying predictive biomarkers and optimizing combination regimens\"\nOutput: \"Need for predictive biomarkers and optimized combination regimens\"\n\nInput: \"Knowledge gaps exist in understanding resistance mechanisms and long-term toxicity profiles\"\nOutput: \"Gaps in resistance mechanisms and long-term toxicity understanding\"\n\nExtract research gaps and future directions."
    }
  ]
};