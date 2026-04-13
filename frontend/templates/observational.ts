export const observationalTemplate = {
  studyType: "observational",
  displayName: "Observational Study",
  entities: [
    {
      name: "Authors",
      prompt:
        'Extract all authors and their affiliations from the study.\n\nFew-shot examples:\nInput: "Anna Chen, PhD¹, Robert Wilson, MD, MPH², Lisa Park, MD¹"\nOutput: "Anna Chen (PhD, Affiliation 1), Robert Wilson (MD, MPH, Affiliation 2), Lisa Park (MD, Affiliation 1)"\n\nExtract the authors from the document.',
    },
    {
      name: "Sources of Funding",
      prompt:
        'Identify all funding sources mentioned in the study.\n\nFew-shot examples:\nInput: "Supported by CDC grant U01-987654 and the American Heart Association"\nOutput: "CDC grant U01-987654, American Heart Association"\n\nExtract all funding sources.',
    },
    {
      name: "Study Type",
      prompt:
        'Identify the type of observational study.\n\nFew-shot examples:\nInput: "This retrospective cohort study analyzed..."\nOutput: "Retrospective cohort study"\n\nInput: "We conducted a case-control analysis"\nOutput: "Case-control study"\n\nExtract the observational study type.',
    },
    {
      name: "Population",
      prompt:
        'Describe the study population and demographics.\n\nFew-shot examples:\nInput: "Adults aged 18-65 with diabetes from Kaiser Permanente database (n=15,420)"\nOutput: "Adults aged 18-65 with diabetes from Kaiser Permanente database (n=15,420)"\n\nExtract the study population.',
    },
    {
      name: "Exposure/Intervention",
      prompt:
        'Extract information about the exposure or intervention being studied.\n\nFew-shot examples:\nInput: "Exposure to air pollution (PM2.5 levels >35 μg/m³)"\nOutput: "Air pollution exposure (PM2.5 levels >35 μg/m³)"\n\nExtract the exposure or intervention.',
    },
    {
      name: "Follow-up Period",
      prompt:
        'Extract the duration of follow-up or observation period.\n\nFew-shot examples:\nInput: "Patients were followed for a median of 5.2 years (range 1-10 years)"\nOutput: "Median 5.2 years (range 1-10 years)"\n\nInput: "Follow-up extended through December 2023 with mean observation time of 3.8 years"\nOutput: "Through December 2023, mean 3.8 years"\n\nExtract the follow-up period.',
    },
  ],
};
