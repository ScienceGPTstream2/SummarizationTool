export const generalLevel1EpidemiologyAdamV1Template = {
  studyType: "General-level-1-epidemiology-AdamV1",
  displayName: "General-level-1-epidemiology-AdamV1",
  entities: [
    {
      name: "Participant Numbers",
      prompt: "Extract the total number of study participants initially enrolled in the study and the actual number of participants analyzed after applying exclusion criteria. If available, also report the number of cases and controls for case-control studies.\n\nFew-shot examples:\nInput: \"The study consisted of 800 participants. The actual total study population to be analyzed was 700 after excluding 100 participants based on study exclusion criteria\"\nOutput: \"800 total (700 after excluding 100 participants)\"\n\nInput: \"The case-control study consisted of 800 participants. The actual total study population to be analyzed was 700 (360 cases and 340 controls) after excluding 100 participants based on study exclusion criteria\"\nOutput: \"800 total (700 after excluding 100 participants, which consisted of 360 cases and 340 controls)\"\n\nInput: \"The study enrolled 120 pesticide applicators (100 after excluding 20 individuals).\"\nOutput: \"120 participants enrolled (100 after excluding 20 participants)\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the participant numbers."
    },
    {
      name: "Pesticide of Interest",
      prompt: "Identify the pesticide or group of pesticides evaluated in the study — [chemical] and metabolites of [chemical] ONLY. If other pesticides were mentioned, list them if they are few; otherwise state \"many pesticides were also evaluated, including [chemical]/metabolites.\"\n\nFew-shot examples:\nInput: \"Exposure to glyphosate was assessed among agricultural workers.\"\nOutput: \"glyphosate\"\n\nInput: \"The study examined organophosphate exposure.\"\nOutput: \"organophosphates\"\n\nInput: \"At enrollment (1993–1997) and follow-up (1999–2005), participants reported use of 50 pesticides. Table 2 ... Metolachlor ...\"\nOutput: \"50 pesticides, including metolachlor.\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the pesticide of interest."
    },
    {
      name: "Method of Measurement",
      prompt: "Extract the method(s) or proxy methods used to quantify or estimate pesticide external exposure. This may include biomonitoring, interviews, questionnaires, self-reporting, job exposure matrices, or environmental sampling.\n\nFew-shot examples:\nInput: \"Exposure was determined using urinary metabolite concentrations measured by GC-MS.\"\nOutput: \"urinary metabolite analysis (GC-MS)\"\n\nInput: \"Exposure classification was based on self-reported pesticide use from structured interviews.\"\nOutput: \"self-reported pesticide use questionnaire\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the method of measurement."
    },
    {
      name: "Biological Samples",
      prompt: "Identify the type of biological sample collected for pesticide or biomarker analysis (e.g., blood, urine, serum, hair, breast milk). Do not include samples collected solely for health-outcome assays.\n\nFew-shot examples:\nInput: \"Blood samples were collected for organochlorine analysis.\"\nOutput: \"blood\"\n\nInput: \"Urine samples were analyzed for pesticide metabolites.\"\nOutput: \"urine\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the biological samples."
    },
    {
      name: "Health Outcome",
      prompt: "Extract the health outcome(s) evaluated in relation to pesticide exposure. If multiple subtypes are mentioned, provide only the high-level category.\n\nFew-shot examples:\nInput: \"The study evaluated associations between pesticide exposure and thyroid hormone levels.\"\nOutput: \"thyroid hormone levels\"\n\nInput: \"Investigated the relationship between chlorpyrifos exposure and childhood ADHD.\"\nOutput: \"childhood ADHD\"\n\nInput: \"Investigated the relationship between amitrole exposure and lymphoid neoplasms (Hodgkin’s lymphoma, non-Hodgkin’s lymphoma, multiple myeloma, leukemia).\"\nOutput: \"various lymphoid neoplasms\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the health outcome."
    },
    {
      name: "Measure of Association",
      prompt: "Extract the reported measures of association, including risk ratio, rate ratio, odds ratio, relative risk, hazard ratio, risk difference, rate difference, attributable fraction, mean difference, regression coefficient, slope, correlation, or β, and any corresponding confidence intervals or standard deviations. Report both adjusted and unadjusted measures.\n\nFew-shot examples:\nInput: \"Adjusted odds ratio for high-exposure group was 1.45 (95% CI: 1.10–1.90).\"\nOutput: \"OR 1.45 (95% CI: 1.10–1.90)\"\n\nInput: \"Relative risk for pesticide users versus non-users was 0.85 (95% CI: 0.60–1.20).\"\nOutput: \"RR 0.85 (95% CI: 0.60–1.20)\"\n\nInput: \"The β value for amitrole exposure was 0.8 (95% CI: 0.6–1.0).\"\nOutput: \"β=0.8 (95% CI: 0.6–1.0)\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the measure(s) of association."
    },
    {
      name: "Study Author Conclusion",
      prompt: "Extract the study authors’ overall conclusion regarding the association between pesticide exposure and the health outcome. Use direct quotations where possible.\n\nFew-shot examples:\nInput: \"The authors concluded that exposure to organophosphates was associated with decreased neurodevelopmental scores in children.\"\nOutput: \"Exposure to organophosphates was associated with decreased neurodevelopmental scores in children.\"\n\nInput: \"Authors found no significant association between glyphosate exposure and cancer risk.\"\nOutput: \"No significant association between glyphosate exposure and cancer risk.\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the study author conclusion."
    },
    {
      name: "Study Author Noted Strength",
      prompt: "Extract the strengths, advantages, and reasons the authors describe the study as robust or rigorous. These may include large sample size, biomonitoring, longitudinal design, or control for confounders.\n\nFew-shot examples:\nInput: \"Strengths include detailed exposure assessment and adjustment for multiple confounders.\"\nOutput: \"Detailed exposure assessment; controlled for confounders.\"\n\nInput: \"A major strength was the use of biomarker-based exposure measurement.\"\nOutput: \"Biomarker-based exposure measurement.\"\n\nInput: \"This study benefits from a large, diverse sample...\"\nOutput: \"Large sample size, validated methodology, prospective nature minimizing recall bias, adjustment of confounders, self-reporting and objective measures to provide a comprehensive view.\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the study author–noted strengths."
    },
    {
      name: "Study Author Noted Limitations",
      prompt: "Extract the limitations as directly acknowledged by the authors. Do not infer limitations — only report those explicitly stated.\n\nFew-shot examples:\nInput: \"Limitations include reliance on self-reported pesticide use and potential recall bias.\"\nOutput: \"Self-reported exposure; recall bias.\"\n\nInput: \"Authors noted limited statistical power due to small sample size.\"\nOutput: \"Small sample size; limited statistical power.\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the study author–noted limitations."
    },
    {
      name: "Health Outcome Measurement",
      prompt: "Extract the method used to quantify or diagnose the health outcome. Include clinical or biological measures, ICD codes, diagnoses, administrative or registry data, self-reporting, surveys, interviews, laboratory tests, or imaging.\n\nFew-shot examples:\nInput: \"Cases of thyroid cancer were confirmed via laboratory analyses and linkage to hospital registry.\"\nOutput: \"laboratory analyses and linkage to hospital registry\"\n\nInput: \"Diagnoses were classified using ICD codes. All the diagnoses were histologically confirmed and reviewed by a panel of pathologists.\"\nOutput: \"Diagnosed by pathologists histologically and classified using ICD codes\"\n\nIf not reported, output \"Not Reported.\"\n\nExtract the method of health outcome measurement."
    }
  ]
};
