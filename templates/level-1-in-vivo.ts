export const level1InVivoTemplate = {
  "studyType": "level-1-in-vivo",
  "displayName": "Level 1 - In vivo",
  "entities": [
    {
      "name": "Study Author(s)",
      "prompt": "Extract the study author(s).\n\nFew-shot examples:\nInput: \"The study was conducted by John Doe, Jane Smith, and their team.\"\nOutput: \"John Doe, Jane Smith\"\n\nInput: \"Authors: Maria Garcia, David Chen.\"\nOutput: \"Maria Garcia, David Chen\"\n\nExtract the study author(s)."
    },
    {
      "name": "Author Affiliations",
      "prompt": "Extract the affiliations of the authors.\n\nFew-shot examples:\nInput: \"John Doe is from the Department of Biology, University of Science. Jane Smith is from the Research Institute of Health.\"\nOutput: \"Department of Biology, University of Science; Research Institute of Health\"\n\nInput: \"Author Affiliation: Global Research Center, Springfield.\"\nOutput: \"Global Research Center, Springfield\"\n\nExtract the author affiliations."
    },
    {
      "name": "Study Title",
      "prompt": "Extract the title of the study.\n\nFew-shot examples:\nInput: \"Title: An In Vivo Study on the Effects of Compound X.\"\nOutput: \"An In Vivo Study on the Effects of Compound X\"\n\nInput: \"The paper 'Toxicity Analysis of Substance Y' presents...\"\nOutput: \"Toxicity Analysis of Substance Y\"\n\nExtract the study title."
    },
    {
      "name": "Publication Date",
      "prompt": "Extract the publication date of the study.\n\nFew-shot examples:\nInput: \"Published online: 15 January 2023.\"\nOutput: \"15 January 2023\"\n\nInput: \"The work was published in May 2022.\"\nOutput: \"May 2022\"\n\nExtract the publication date."
    },
    {
      "name": "Journal",
      "prompt": "Extract the name of the journal where the study was published.\n\nFew-shot examples:\nInput: \"The study appeared in the Journal of Experimental Biology.\"\nOutput: \"Journal of Experimental Biology\"\n\nInput: \"Published in: Toxicology Reports, Vol. 8, 2021.\"\nOutput: \"Toxicology Reports\"\n\nExtract the journal name."
    },
    {
      "name": "Test Material",
      "prompt": "Extract the test material used in the study.\n\nFew-shot examples:\nInput: \"The test material was a novel compound, designated as CP-123.\"\nOutput: \"CP-123\"\n\nInput: \"We investigated the effects of bisphenol A (BPA).\"\nOutput: \"bisphenol A (BPA)\"\n\nExtract the test material."
    },
    {
      "name": "Test Animal Species",
      "prompt": "Extract the species of the test animals.\n\nFew-shot examples:\nInput: \"The study was performed on Sprague-Dawley rats.\"\nOutput: \"Sprague-Dawley rats\"\n\nInput: \"We used C57BL/6 mice for our experiments.\"\nOutput: \"C57BL/6 mice\"\n\nExtract the test animal species."
    },
    {
      "name": "Vehicle or solvent used",
      "prompt": "Extract the vehicle or solvent used to administer the test material.\n\nFew-shot examples:\nInput: \"The compound was dissolved in corn oil for administration.\"\nOutput: \"corn oil\"\n\nInput: \"A 0.5% carboxymethylcellulose solution was used as the vehicle.\"\nOutput: \"0.5% carboxymethylcellulose solution\"\n\nExtract the vehicle or solvent used."
    },
    {
      "name": "Negative Control",
      "prompt": "Extract the negative control used in the study.\n\nFew-shot examples:\nInput: \"The control group received only the vehicle, corn oil.\"\nOutput: \"vehicle (corn oil)\"\n\nInput: \"Saline was administered to the negative control animals.\"\nOutput: \"Saline\"\n\nExtract the negative control."
    },
    {
      "name": "Route of Administration",
      "prompt": "Extract the route of administration for the test material.\n\nFew-shot examples:\nInput: \"The test material was administered by oral gavage.\"\nOutput: \"oral gavage\"\n\nInput: \"Doses were given via intraperitoneal injection.\"\nOutput: \"intraperitoneal injection\"\n\nExtract the route of administration."
    },
    {
      "name": "Dose Levels",
      "prompt": "Extract the dose levels of the test material administered.\n\nFew-shot examples:\nInput: \"Animals were treated with 10, 50, and 100 mg/kg of the compound.\"\nOutput: \"10, 50, and 100 mg/kg\"\n\nInput: \"Dose levels were 0, 5, 25, and 125 ppm.\"\nOutput: \"0, 5, 25, and 125 ppm\"\n\nExtract the dose levels."
    },
    {
      "name": "Frequency of Administration",
      "prompt": "Extract the frequency of administration of the test material.\n\nFew-shot examples:\nInput: \"Dosing was performed once daily.\"\nOutput: \"once daily\"\n\nInput: \"The compound was administered twice a week.\"\nOutput: \"twice a week\"\n\nExtract the frequency of administration."
    },
    {
      "name": "Duration of Dosing Period",
      "prompt": "Extract the duration of the dosing period.\n\nFew-shot examples:\nInput: \"The animals were dosed for 28 consecutive days.\"\nOutput: \"28 consecutive days\"\n\nInput: \"Treatment continued for a period of 14 weeks.\"\nOutput: \"14 weeks\"\n\nExtract the duration of the dosing period."
    },
    {
      "name": "Results Presented",
      "prompt": "Are there results presented? (Qualitative or quantitative?).\n\nFew-shot examples:\nInput: \"Results were presented quantitatively in tables and figures and described in writing. Tables presented data on gestational length, % pups born alive, % weaned pups, and mean number of pups per litter that were born, weaned, stillbirth, or dead during weaning. Figures presented data on mean weight, mean, weight gain, mean litter weight, and mean time to testes descent in male pups or vaginal opening in female pups.\"\nOutput: \"Results were presented quantitatively in tables and figures and described in writing. Tables presented data on gestational length, % pups born alive, % weaned pups, and mean number of pups per litter that were born, weaned, stillbirth, or dead during weaning. Figures presented data on mean weight, mean, weight gain, mean litter weight, and mean time to testes descent in male pups or vaginal opening in female pups.\"\n\nInput: \"The study qualitatively described the observed clinical signs, such as lethargy and piloerection, with no quantitative data presented.\"\nOutput: \"Results were presented qualitatively, describing clinical signs such as lethargy and piloerection.\"\n\nExtract how the results are presented."
    }
  ]
};
