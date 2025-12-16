export const generalLevel1EpidemiologyAdamV1NoShotTemplate = {
  studyType: "General-level-1-epidemiology-AdamV1-NoShot",
  displayName: "General-level-1-epidemiology-AdamV1-NoShot",
  entities: [
    {
      name: "Participant Numbers",
      prompt:
        'Extract the total number of study participants initially enrolled in the study and the actual number of participants analyzed after applying exclusion criteria. For case-control studies, also report the number of cases and controls. If not reported, output "Not Reported."',
    },
    {
      name: "Pesticide of Interest",
      prompt:
        'Identify the pesticide or group of pesticides evaluated in the study — [chemical] and metabolites of [chemical] only. If other pesticides are mentioned, list them if few; otherwise state that many pesticides were evaluated, including the named chemical or metabolites. If not reported, output "Not Reported."',
    },
    {
      name: "Method of Measurement",
      prompt:
        'Extract the method(s) or proxy methods used to quantify or estimate pesticide external exposure, including biomonitoring, interviews, questionnaires, self-reporting, job exposure matrices, or environmental sampling. If not reported, output "Not Reported."',
    },
    {
      name: "Biological Samples",
      prompt:
        'Identify the type of biological samples collected for pesticide or biomarker analysis (e.g., blood, urine, serum, hair, breast milk). Do not include samples collected solely for health-outcome assays. If not reported, output "Not Reported."',
    },
    {
      name: "Health Outcome",
      prompt:
        'Extract the health outcome(s) evaluated in relation to pesticide exposure. If multiple subtypes are mentioned, provide only the high-level category. If not reported, output "Not Reported."',
    },
    {
      name: "Measure of Association",
      prompt:
        'Extract all reported measures of association, including any confidence intervals or standard deviations. Report both adjusted and unadjusted measures. If not reported, output "Not Reported."',
    },
    {
      name: "Study Author Conclusion",
      prompt:
        'Extract the study authors’ overall conclusion regarding the association between pesticide exposure and the health outcome. Use direct quotations when possible. If not reported, output "Not Reported."',
    },
    {
      name: "Study Author Noted Strength",
      prompt:
        'Extract the strengths of the study as noted by the authors, such as robust methodology, exposure assessment advantages, or appropriate confounder control. If not reported, output "Not Reported."',
    },
    {
      name: "Study Author Noted Limitations",
      prompt:
        'Extract the limitations explicitly acknowledged by the authors. Do not infer limitations. If not reported, output "Not Reported."',
    },
    {
      name: "Health Outcome Measurement",
      prompt:
        'Extract the method used to quantify or diagnose the health outcome, including clinical measures, ICD coding, laboratory testing, imaging, registry linkage, or self-report. If not reported, output "Not Reported."',
    },
  ],
};
