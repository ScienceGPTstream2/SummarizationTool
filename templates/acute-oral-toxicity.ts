export const acuteOralToxicityTemplate = {
  studyType: "Acute Oral Toxicity",
  displayName: "Acute Oral Toxicity",
  entities: [
    {
      name: "Study Author(s)",
      prompt:
        'Extract the study author(s). If not reported, output "Not Reported."',
    },
    {
      name: "Author Affiliations",
      prompt:
        'Extract the affiliations of the authors. If not reported, output "Not Reported."',
    },
    {
      name: "Study Title",
      prompt:
        'Extract the title of the study. If not reported, output "Not Reported."',
    },
    {
      name: "Publication Date",
      prompt:
        'Extract the publication date of the study. If not reported, output "Not Reported."',
    },
    {
      name: "Journal",
      prompt:
        'Extract the name of the journal where the study was published. If not reported, output "Not Reported."',
    },
    {
      name: "Test Material",
      prompt:
        'Extract the test material used in the study. If not reported, output "Not Reported."',
    },
    {
      name: "Test Animal Species",
      prompt:
        'Extract the species of the test animals. If not reported, output "Not Reported."',
    },
    {
      name: "Vehicle or solvent used",
      prompt:
        'Extract the vehicle or solvent used to administer the test material. If not reported, output "Not Reported."',
    },
    {
      name: "Negative Control",
      prompt:
        'Extract the negative control used in the study. If not reported, output "Not Reported."',
    },
    {
      name: "Route of Administration",
      prompt:
        'Extract the route of administration for the test material. If not reported, output "Not Reported."',
    },
    {
      name: "Dose Levels",
      prompt:
        'Extract the dose levels of the test material administered. If not reported, output "Not Reported."',
    },
    {
      name: "Duration of Dosing Period",
      prompt:
        'Extract the duration of the dosing period. If not reported, output "Not Reported."',
    },
    {
      name: "Results Presented",
      prompt:
        'Are there results presented? (Qualitative or quantitative?). If not reported, output "Not Reported."',
    },
    {
      name: "Clinical Signs",
      prompt:
        "Describe the clinical signs reported by study author. Show the results in table format.",
    },
    {
      name: "Mortality",
      prompt:
        "Extract the mortality for each animal and put this data into a table format.",
    },
  ],
  summaryPrompt:
    "Take the extracted entities and put them into a single cohesive paragraph. Do not change any of the extracted entities.",
};
