export const level0EpidemiologyMetaDataTemplate = {
  studyType: "Level-0-epidemiology-MetaData",
  displayName: "Level-0-epidemiology-MetaData",
  entities: [
    {
      name: "Study Author(s)",
      prompt:
        'Extract the study author(s).\n\nFew-shot examples:\nInput: "The study was conducted by John Doe, Jane Smith, and their team."\nOutput: "John Doe, Jane Smith"\n\nInput: "Authors: Maria Garcia, David Chen."\nOutput: "Maria Garcia, David Chen"\n\nIf not reported, output "Not Reported."',
    },
    {
      name: "Author Affiliations",
      prompt:
        'Extract the affiliations of the authors.\n\nFew-shot examples:\nInput: "John Doe is from the Department of Epidemiology, University of Toronto. Jane Smith is from the Canadian Cancer Research Centre."\nOutput: "Department of Epidemiology, University of Toronto; Canadian Cancer Research Centre"\n\nInput: "Author Affiliation: National Institute for Public Health, Ottawa."\nOutput: "National Institute for Public Health, Ottawa"\n\nIf not reported, output "Not Reported."',
    },
    {
      name: "Study Title",
      prompt:
        'Extract the title of the study.\n\nFew-shot examples:\nInput: "Title: Association between pesticide exposure and Parkinson’s disease among agricultural workers."\nOutput: "Association between pesticide exposure and Parkinson’s disease among agricultural workers"\n\nInput: "The paper \'Prenatal pesticide exposure and child neurodevelopment\' presents..."\nOutput: "Prenatal pesticide exposure and child neurodevelopment"\n\nIf not reported, output "Not Reported."',
    },
    {
      name: "Publication Date",
      prompt:
        'Extract the publication date of the study.\n\nFew-shot examples:\nInput: "Published online: 15 January 2023."\nOutput: "15 January 2023"\n\nInput: "The work was published in May 2022."\nOutput: "May 2022"\n\nIf not reported, output "Not Reported."',
    },
    {
      name: "Journal",
      prompt:
        'Extract the name of the journal where the study was published.\n\nFew-shot examples:\nInput: "The study appeared in the Journal of Environmental Health."\nOutput: "Journal of Environmental Health"\n\nInput: "Published in: Environmental Research, Vol. 212, 2023."\nOutput: "Environmental Research"\n\nIf not reported, output "Not Reported."',
    },
  ],
};
