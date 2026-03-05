export const level2InVivoNoShotTemplate = {
  studyType: "level-2-in-vivo-noshot",
  displayName: "Level 2 - In vivo - NoShot",
  summaryPrompt:
    "Take the following extracted entities and combine them into a single cohesive paragraph. Maintain all factual details exactly as provided. Do not modify, add, or omit any of the extracted information.",
  entities: [
    {
      name: "Study Author(s)",
      section: "metadata",
      prompt:
        'Extract the study author(s). If not reported, output "Not Reported".',
    },
    {
      name: "Author Affiliations",
      section: "metadata",
      prompt:
        'Extract the author affiliations. If not reported, output "Not Reported".',
    },
    {
      name: "Study Title",
      section: "metadata",
      prompt:
        'Extract the study title. If not reported, output "Not Reported".',
    },
    {
      name: "Publication Date",
      section: "metadata",
      prompt:
        'Extract the publication date. If not reported, output "Not Reported".',
    },
    {
      name: "Journal",
      section: "metadata",
      prompt:
        'Extract the journal name. If not reported, output "Not Reported".',
    },
    {
      name: "Test Material",
      section: "methods",
      prompt:
        'Extract the test material. If not reported, output "Not Reported".',
    },
    {
      name: "Test Substance Purity",
      section: "methods",
      prompt: 'Extract the purity. If not reported, output "Not Reported".',
    },
    {
      name: "Test Substance Impurities",
      section: "methods",
      prompt:
        'Extract the test substance impurities. If not reported, output "Not Reported".',
    },
    {
      name: "Test Animal Species",
      section: "methods",
      prompt:
        'Extract the test animal species. If not reported, output "Not Reported".',
    },
    {
      name: "Test Animal Strain",
      section: "methods",
      prompt:
        'Extract the test animal strain. If not reported, output "Not Reported".',
    },
    {
      name: "Test Animal Sex",
      section: "methods",
      prompt:
        'Extract the sex of the test animals. If not reported, output "Not Reported".',
    },
    {
      name: "Number of Test Animals per Group",
      section: "methods",
      prompt:
        'Extract the number of animals tested per group. If not reported, output "Not Reported".',
    },
    {
      name: "Vehicle or Solvent Used",
      section: "methods",
      prompt:
        'Extract the vehicle or solvent used to administer the test material. If not reported, output "Not Reported".',
    },
    {
      name: "Negative Control",
      section: "methods",
      prompt:
        'Extract the negative control used in the study. If not reported, output "Not Reported".',
    },
    {
      name: "Route of Administration",
      section: "methods",
      prompt:
        'Extract the route of administration for the test material. If not reported, output "Not Reported".',
    },
    {
      name: "Dose Levels",
      section: "methods",
      prompt:
        'Extract the dose levels of the test material administered. If not reported, output "Not Reported".',
    },
    {
      name: "Lowest Dose Tested",
      section: "methods",
      prompt:
        'Extract the lowest dose tested. If not reported, output "Not Reported".',
    },
    {
      name: "Frequency of Administration",
      section: "methods",
      prompt:
        'Extract the frequency of administration of the test material. If not reported, output "Not Reported".',
    },
    {
      name: "Duration of Dosing Period",
      section: "methods",
      prompt:
        'Extract the duration of the dosing period. If not reported, output "Not Reported".',
    },
    {
      name: "Type of Study",
      section: "methods",
      prompt:
        'Extract the type of study conducted. If not reported, output "Not Reported".',
    },
    {
      name: "Parameters Investigated or Tested",
      section: "methods",
      prompt:
        'List all parameters investigated or endpoints assessed in the study. If not reported, output "Not Reported".',
    },
    {
      name: "Endpoints Assessed",
      section: "methods",
      prompt:
        'Extract the endpoints assessed in the study. If not reported, output "Not Reported".',
    },
    {
      name: "Statistical Analysis Methods",
      section: "methods",
      prompt:
        'Extract statistical analysis methods used in the study. If not reported, output "Not Reported".',
    },
    {
      name: "Results Presented",
      section: "results",
      prompt:
        'Describe how the results are presented (qualitative or quantitative). If not reported, output "Not Reported".',
    },
    {
      name: "Maternal Effects at All Doses",
      section: "results",
      prompt:
        'Extract maternal toxicological effects at all doses administered. Present the information in a structured table format with the following columns: Dose Group, Dose (mg/kg bw/day or units reported), Effects Observed, Severity (if reported), Statistical Significance, LOAEL Assigned?, NOAEL Assigned?, Notes. If not reported, output "Not Reported".',
    },
    {
      name: "Offspring Effects at All Doses",
      section: "results",
      prompt:
        'Extract offspring (fetal/pup) toxicological effects at all doses administered. Present the information in a structured table format with the following columns: Dose Group, Dose (mg/kg bw/day or units reported), Effects Observed, Severity (if reported), Statistical Significance, LOAEL Assigned?, NOAEL Assigned?, Notes. If not reported, output "Not Reported".',
    },
    {
      name: "Study Author-Identified Strengths and Limitations",
      section: "discussion",
      prompt:
        'Extract study strengths and limitations identified by the authors. If not reported, output "Not Reported".',
    },
  ],
};
