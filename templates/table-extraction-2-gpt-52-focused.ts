export const tableExtraction2Gpt52FocusedTemplate = {
  "studyType": "Epi",
  "displayName": "Table extraction 2 (GPT 5.2 focused)",
  "entities": [
    {
      "name": "Table extraction 2 to pull out all info",
      "prompt": "Extract all of the reported measures of association into a single table format (Risk ratio, rate ratio, odds ratio, relative risk, hazard ratio, risk difference, rate difference, attributable fraction, mean difference, regression coefficient, slope, correlation, \u03b2) and any corresponding confidence intervals or standard deviations. If there are tertile values, report all values, not just the highest values since we are interested in dose responses. \n\nReport both adjusted and non-adjusted measures of association. \n\nInclude whether the study authors considered the results to be statistically significant. Significant values should be bolded.\n\nIf adjoining cells are identical, merge the cells.\n\n\nAlso this is a concise table so focus on extracting numerical values with minimal words to describe what the numbers mean\n\n\nFew-shot examples: \nInput: \"Adjusted odds ratio for high-exposure group was 1.45 (95% CI: 1.10\u20131.90).\" \n\nOutput: \"OR 1.45 (95% CI: 1.10\u20131.90)\" \n\nInput: \"Relative risk for pesticide users versus non-users was 0.85 (95% CI: 0.60\u20131.20).\" \n\nOutput: \"RR 0.85 (95% CI: 0.60\u20131.20)\" \n\nInput: \u201cThe \u03b2 value for amitrole exposure was 0.8 (95% CI: 0.6-1.0)\n\nOutput: \"\u03b2=0.8 (95% CI: 0.6\u20131.0)\" \n\nIf not reported, output \"Not Reported.\"\n\nReport all values in a single table"
    }
  ],
  "summaryPrompt": "Take the extracted entities and put them into a single cohesive paragraph. Do not change any of the extracted entities."
};
