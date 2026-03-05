export const level2InVivoTemplate = {
  studyType: "level-2-in-vivo",
  displayName: "Level 2 - In vivo",
  summaryPrompt:
    "Take the following extracted entities and combine them into a single cohesive paragraph. Maintain all factual details exactly as provided. Do not modify, add, or omit any of the extracted information.",
  entities: [
    {
      name: "Study Author(s)",
      section: "metadata",
      prompt:
        'Extract the study author(s).\n\nFew-shot examples:\nInput: "The study was conducted by John Doe, Jane Smith, and their team."\nOutput: "John Doe, Jane Smith"\nInput: "Authors: Maria Garcia, David Chen."\nOutput: "Maria Garcia, David Chen"\nExtract the study author(s). If not reported, output "Not Reported".',
    },
    {
      name: "Author Affiliations",
      section: "metadata",
      prompt:
        'Extract the affiliations of the authors.\n\nFew-shot examples:\nInput: "John Doe is from the Department of Biology, University of Science. Jane Smith is from the Research Institute of Health."\nOutput: "Department of Biology, University of Science; Research Institute of Health"\nInput: "Author Affiliation: Global Research Center, Springfield."\nOutput: "Global Research Center, Springfield"\nExtract the author affiliations. If not reported, output "Not Reported".',
    },
    {
      name: "Study Title",
      section: "metadata",
      prompt:
        'Extract the title of the study.\n\nFew-shot examples:\nInput: "Title: An In Vivo Study on the Effects of Compound X."\nOutput: "An In Vivo Study on the Effects of Compound X"\nInput: "The paper \'Toxicity Analysis of Substance Y\' presents..."\nOutput: "Toxicity Analysis of Substance Y"\nExtract the study title. If not reported, output "Not Reported".',
    },
    {
      name: "Publication Date",
      section: "metadata",
      prompt:
        'Extract the publication date of the study.\n\nFew-shot examples:\nInput: "Published online: 15 January 2023."\nOutput: "15 January 2023"\nInput: "The work was published in May 2022."\nOutput: "May 2022"\nExtract the publication date. If not reported, output "Not Reported".',
    },
    {
      name: "Journal",
      section: "metadata",
      prompt:
        'Extract the name of the journal where the study was published.\n\nFew-shot examples:\nInput: "The study appeared in the Journal of Experimental Biology."\nOutput: "Journal of Experimental Biology"\nInput: "Published in: Toxicology Reports, Vol. 8, 2021."\nOutput: "Toxicology Reports"\nExtract the journal name. If not reported, output "Not Reported".',
    },
    {
      name: "Test Material",
      section: "methods",
      prompt:
        'Extract the test material used in the study.\n\nFew-shot examples:\nInput: "The test material was a novel compound, designated as CP-123."\nOutput: "CP-123"\nInput: "We investigated the effects of bisphenol A (BPA)."\nOutput: "bisphenol A (BPA)"\nExtract the test material. If not reported, output "Not Reported".',
    },
    {
      name: "Test Substance Purity",
      section: "methods",
      prompt:
        'Extract the purity of the test material.\n\nFew-shot examples:\nInput: "β-Ionone (BIO, I12603 Aldrich, density 0.945 g/mL at 25 °C) was 96% pure."\nOutput: "96%"\nInput: "Purity not reported."\nOutput: "Not Reported"\nExtract the purity.',
    },
    {
      name: "Test Substance Impurities",
      section: "methods",
      prompt:
        'Extract known impurities of the test material.\n\nFew-shot examples:\nInput: "Impurities of BIO comprise mainly other ionone isomers like α-ionone (CAS 127-41-3)."\nOutput: "other ionone isomers like α-ionone (CAS 127-41-3)"\nInput: "Impurities not reported."\nOutput: "Not Reported"\nExtract the test substance impurities.',
    },
    {
      name: "Test Animal Species",
      section: "methods",
      prompt:
        'Extract the species of the test animals.\n\nFew-shot examples:\nInput: "The study was performed on Sprague-Dawley rats."\nOutput: "Sprague-Dawley rats"\nInput: "We used C57BL/6 mice for our experiments."\nOutput: "C57BL/6 mice"\nExtract the test animal species. If not reported, output "Not Reported".',
    },
    {
      name: "Test Animal Strain",
      section: "methods",
      prompt:
        'Extract the test animal strain.\n\nFew-shot examples:\nInput: "Male and nulliparous female Wistar rats were used."\nOutput: "Wistar"\nInput: "Sprague-Dawley rats were employed."\nOutput: "Sprague-Dawley"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Test Animal Sex",
      section: "methods",
      prompt:
        'Extract the sex of the test animals.\n\nFew-shot examples:\nInput: "Pregnant female rats were treated."\nOutput: "Female"\nInput: "Both male and female mice were included."\nOutput: "Male and Female"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Number of Test Animals per Group",
      section: "methods",
      prompt:
        'Extract the number of animals tested per group.\n\nFew-shot examples:\nInput: "20 rats per group were treated by gavage."\nOutput: "20"\nInput: "Groups consisted of 10, 15, and 20 animals."\nOutput: "10, 15, 20"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Vehicle or Solvent Used",
      section: "methods",
      prompt:
        'Extract the vehicle or solvent used to administer the test material.\n\nFew-shot examples:\nInput: "The compound was dissolved in corn oil for administration."\nOutput: "corn oil"\nInput: "A 0.5% carboxymethylcellulose solution was used."\nOutput: "0.5% carboxymethylcellulose solution"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Negative Control",
      section: "methods",
      prompt:
        'Extract the negative control used in the study.\n\nFew-shot examples:\nInput: "The control group received only the vehicle, corn oil."\nOutput: "vehicle (corn oil)"\nInput: "Saline was administered to the negative control animals."\nOutput: "Saline"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Route of Administration",
      section: "methods",
      prompt:
        'Extract the route of administration for the test material.\n\nFew-shot examples:\nInput: "The test material was administered by oral gavage."\nOutput: "oral gavage"\nInput: "Doses were given via intraperitoneal injection."\nOutput: "intraperitoneal injection"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Dose Levels",
      section: "methods",
      prompt:
        'Extract the dose levels of the test material administered.\n\nFew-shot examples:\nInput: "Animals were treated with 10, 50, and 100 mg/kg of the compound."\nOutput: "10, 50, 100 mg/kg"\nInput: "Dose levels were 0, 5, 25, and 125 ppm."\nOutput: "0, 5, 25, 125 ppm"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Lowest Dose Tested",
      section: "methods",
      prompt:
        'Extract the lowest dose tested.\n\nFew-shot examples:\nInput: "Rats were treated by gavage with 125, 250, 500, and 1000 mg/kg/day."\nOutput: "125 mg/kg/day"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Frequency of Administration",
      section: "methods",
      prompt:
        'Extract the frequency of administration of the test material.\n\nFew-shot examples:\nInput: "Dosing was performed once daily."\nOutput: "once daily"\nInput: "The compound was administered twice a week."\nOutput: "twice a week"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Duration of Dosing Period",
      section: "methods",
      prompt:
        'Extract the duration of the dosing period.\n\nFew-shot examples:\nInput: "The animals were dosed for 28 consecutive days."\nOutput: "28 consecutive days"\nInput: "Treatment continued for a period of 14 weeks."\nOutput: "14 weeks"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Type of Study",
      section: "methods",
      prompt:
        'Extract the type of study conducted.\n\nFew-shot examples:\nInput: "A prenatal developmental toxicity study following OECD TG 414 was performed."\nOutput: "Prenatal Developmental Toxicity Study (OECD TG 414)"\nInput: "A reproductive toxicity study in rats."\nOutput: "Reproductive Toxicity Study"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Parameters Investigated or Tested",
      section: "methods",
      prompt:
        'List all parameters investigated or endpoints assessed in the study.\n\nFew-shot examples:\nInput: "Maternal body weight, food consumption, number of corpora lutea, fetal skeletal malformations, fetal weight."\nOutput: "Maternal body weight; Food consumption; Number of corpora lutea; Fetal skeletal malformations; Fetal weight"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Endpoints Assessed",
      section: "methods",
      prompt:
        'Extract the endpoints assessed in the study.\n\nFew-shot examples:\nInput: "Maternal body weight, food consumption, litter parameters, fetal weights, skeletal malformations, visceral malformations."\nOutput: "Maternal body weight; Food consumption; Litter parameters; Fetal weights; Skeletal malformations; Visceral malformations"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Statistical Analysis Methods",
      section: "methods",
      prompt:
        'Extract statistical analysis methods used in the study.\n\nFew-shot examples:\nInput: "Data were evaluated by one-way ANOVA and Bonferroni post hoc test."\nOutput: "One-way ANOVA with Bonferroni post hoc test"\nInput: "Chi-square test was applied to proportions."\nOutput: "Chi-square test"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Results Presented",
      section: "results",
      prompt:
        'Describe how the results are presented (qualitative or quantitative).\n\nFew-shot examples:\nInput: "Results were presented quantitatively in tables and figures."\nOutput: "Results were presented quantitatively in tables and figures"\nInput: "The study qualitatively described observed clinical signs."\nOutput: "Results were presented qualitatively, describing clinical signs"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Maternal Effects at All Doses",
      section: "results",
      prompt:
        'Extract maternal toxicological effects at all doses administered. Present the information in a structured table format with the following columns: Dose Group, Dose (mg/kg bw/day or units reported), Effects Observed, Severity (if reported), Statistical Significance, LOAEL Assigned?, NOAEL Assigned?, Notes.\n\nFew-shot examples:\nInput: "Rats were treated at doses 0, 10, 50, 150 mg/kg/day. At 10 mg/kg, no maternal effects were observed. At 50 mg/kg, decreased food consumption. At 150 mg/kg, mortality and clinical signs occurred."\nOutput: "| Dose Group | Dose | Effects Observed | Severity | Statistical Significance | LOAEL | NOAEL | Notes |\n| Control | 0 | None | - | - | No | Yes | - |\n| Low | 10 | None | - | - | No | Yes | - |\n| Mid | 50 | Decreased food consumption | Mild | Yes | No | - | - |\n| High | 150 | Mortality, clinical signs | Severe | Yes | Yes | No | Dose-limiting toxicity |"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Offspring Effects at All Doses",
      section: "results",
      prompt:
        'Extract offspring (fetal/pup) toxicological effects at all doses administered. Present the information in a structured table format with the following columns: Dose Group, Dose (mg/kg bw/day or units reported), Effects Observed, Severity (if reported), Statistical Significance, LOAEL Assigned?, NOAEL Assigned?, Notes.\n\nFew-shot examples:\nInput: "Fetuses from rats treated at 0, 10, 50, 150 mg/kg/day. At 10 mg/kg, no effects. At 50 mg/kg, minor skeletal variations. At 150 mg/kg, increased resorptions and malformations."\nOutput: "| Dose Group | Dose | Effects Observed | Severity | Statistical Significance | LOAEL | NOAEL | Notes |\n| Control | 0 | None | - | - | No | Yes | - |\n| Low | 10 | None | - | - | No | Yes | - |\n| Mid | 50 | Minor skeletal variations | Mild | Yes | No | - | - |\n| High | 150 | Increased resorptions, malformations | Severe | Yes | Yes | No | Developmental toxicity |"\nIf not reported, output "Not Reported".',
    },
    {
      name: "Study Author-Identified Strengths and Limitations",
      section: "discussion",
      prompt:
        'Extract study strengths and limitations identified by the authors.\n\nFew-shot examples:\nInput: "Strengths include robust study design and adequate group sizes. Limitations include lack of historical control data."\nOutput: "Strengths: robust study design; adequate group sizes. Limitations: lack of historical control data."\nIf not reported, output "Not Reported".',
    },
  ],
};
