export const level1InVivoNoShotTemplate = {
  studyType: "level-1-in-vivo-noshot",
  displayName: "Level 1 - In vivo - NoShot",
  entities: [
    {
      name: "Study Author(s)",
      section: "metadata",
      prompt:
        'Extract the study author(s). If not reported, output "Not Reported."',
    },
    {
      name: "Author Affiliations",
      section: "metadata",
      prompt:
        'Extract the affiliations of the authors. If not reported, output "Not Reported."',
    },
    {
      name: "Study Title",
      section: "metadata",
      prompt:
        'Extract the title of the study. If not reported, output "Not Reported."',
    },
    {
      name: "Publication Date",
      section: "metadata",
      prompt:
        'Extract the publication date of the study. If not reported, output "Not Reported."',
    },
    {
      name: "Journal",
      section: "metadata",
      prompt:
        'Extract the name of the journal where the study was published. If not reported, output "Not Reported."',
    },
    {
      name: "Test Material",
      section: "methods",
      prompt:
        'Extract the test material used in the study. If not reported, output "Not Reported."',
    },
    {
      name: "Test Animal Species",
      section: "methods",
      prompt:
        'Extract the species of the test animals. If not reported, output "Not Reported."',
    },
    {
      name: "Vehicle or solvent used",
      section: "methods",
      prompt:
        'Extract the vehicle or solvent used to administer the test material. If not reported, output "Not Reported."',
    },
    {
      name: "Negative Control",
      section: "methods",
      prompt:
        'Extract the negative control used in the study. If not reported, output "Not Reported."',
    },
    {
      name: "Route of Administration",
      section: "methods",
      prompt:
        'Extract the route of administration for the test material. If not reported, output "Not Reported."',
    },
    {
      name: "Dose Levels",
      section: "methods",
      prompt:
        'Extract the dose levels of the test material administered. If not reported, output "Not Reported."',
    },
    {
      name: "Frequency of Administration",
      section: "methods",
      prompt:
        'Extract the frequency of administration of the test material. If not reported, output "Not Reported."',
    },
    {
      name: "Duration of Dosing Period",
      section: "methods",
      prompt:
        'Extract the duration of the dosing period. If not reported, output "Not Reported."',
    },
    {
      name: "Results Presented",
      section: "results",
      prompt:
        'Are there results presented? (Qualitative or quantitative?). If not reported, output "Not Reported."',
    },
    {
      name: "Fetal/Offspring Effects Reported by Study Authors",
      section: "results",
      prompt:
        "Describe the key toxicological effects observed in fetuses or offspring according to the study authors. This includes potential fetal effects on body weight, reproductive parameters, viability, external examination, visceral examination, and skeletal examination. Additionally, include effects reported in offspring such as post-natal changes in body weight, body weight gain, deaths, or developmental parameters.",
    },
    {
      name: "Maternal Effects Reported by Study Authors",
      section: "results",
      prompt:
        "Describe the key toxicological effects observed in maternal animals according to the study authors. This includes effects on clinical signs, body weight, body weight gain, food consumption, organ weights, gross pathology, and mortality. Include only effects explicitly attributed to treatment by the study authors.",
    },
  ],
};
