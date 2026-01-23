export const level1InVivoTemplate = {
  studyType: "level-1-in-vivo",
  displayName: "Level 1 - In vivo",
  entities: [
    {
      name: "Study Author(s)",
      prompt:
        'Extract the study author(s).\n\nFew-shot examples:\nInput: "The study was conducted by John Doe, Jane Smith, and their team."\nOutput: "John Doe, Jane Smith"\n\nInput: "Authors: Maria Garcia, David Chen."\nOutput: "Maria Garcia, David Chen"\n\nExtract the study author(s).',
    },
    {
      name: "Author Affiliations",
      prompt:
        'Extract the affiliations of the authors.\n\nFew-shot examples:\nInput: "John Doe is from the Department of Biology, University of Science. Jane Smith is from the Research Institute of Health."\nOutput: "Department of Biology, University of Science; Research Institute of Health"\n\nInput: "Author Affiliation: Global Research Center, Springfield."\nOutput: "Global Research Center, Springfield"\n\nExtract the author affiliations.',
    },
    {
      name: "Study Title",
      prompt:
        'Extract the title of the study.\n\nFew-shot examples:\nInput: "Title: An In Vivo Study on the Effects of Compound X."\nOutput: "An In Vivo Study on the Effects of Compound X"\n\nInput: "The paper \'Toxicity Analysis of Substance Y\' presents..."\nOutput: "Toxicity Analysis of Substance Y"\n\nExtract the study title.',
    },
    {
      name: "Publication Date",
      prompt:
        'Extract the publication date of the study.\n\nFew-shot examples:\nInput: "Published online: 15 January 2023."\nOutput: "15 January 2023"\n\nInput: "The work was published in May 2022."\nOutput: "May 2022"\n\nExtract the publication date.',
    },
    {
      name: "Journal",
      prompt:
        'Extract the name of the journal where the study was published.\n\nFew-shot examples:\nInput: "The study appeared in the Journal of Experimental Biology."\nOutput: "Journal of Experimental Biology"\n\nInput: "Published in: Toxicology Reports, Vol. 8, 2021."\nOutput: "Toxicology Reports"\n\nExtract the journal name.',
    },
    {
      name: "Test Material",
      prompt:
        'Extract the test material used in the study.\n\nFew-shot examples:\nInput: "The test material was a novel compound, designated as CP-123."\nOutput: "CP-123"\n\nInput: "We investigated the effects of bisphenol A (BPA)."\nOutput: "bisphenol A (BPA)"\n\nExtract the test material.',
    },
    {
      name: "Test Animal Species",
      prompt:
        'Extract the species of the test animals.\n\nFew-shot examples:\nInput: "The study was performed on Sprague-Dawley rats."\nOutput: "Sprague-Dawley rats"\n\nInput: "We used C57BL/6 mice for our experiments."\nOutput: "C57BL/6 mice"\n\nExtract the test animal species.',
    },
    {
      name: "Vehicle or solvent used",
      prompt:
        'Extract the vehicle or solvent used to administer the test material.\n\nFew-shot examples:\nInput: "The compound was dissolved in corn oil for administration."\nOutput: "corn oil"\n\nInput: "A 0.5% carboxymethylcellulose solution was used as the vehicle."\nOutput: "0.5% carboxymethylcellulose solution"\n\nExtract the vehicle or solvent used.',
    },
    {
      name: "Negative Control",
      prompt:
        'Extract the negative control used in the study.\n\nFew-shot examples:\nInput: "The control group received only the vehicle, corn oil."\nOutput: "vehicle (corn oil)"\n\nInput: "Saline was administered to the negative control animals."\nOutput: "Saline"\n\nExtract the negative control.',
    },
    {
      name: "Route of Administration",
      prompt:
        'Extract the route of administration for the test material.\n\nFew-shot examples:\nInput: "The test material was administered by oral gavage."\nOutput: "oral gavage"\n\nInput: "Doses were given via intraperitoneal injection."\nOutput: "intraperitoneal injection"\n\nExtract the route of administration.',
    },
    {
      name: "Dose Levels",
      prompt:
        'Extract the dose levels of the test material administered.\n\nFew-shot examples:\nInput: "Animals were treated with 10, 50, and 100 mg/kg of the compound."\nOutput: "10, 50, and 100 mg/kg"\n\nInput: "Dose levels were 0, 5, 25, and 125 ppm."\nOutput: "0, 5, 25, and 125 ppm"\n\nExtract the dose levels.',
    },
    {
      name: "Frequency of Administration",
      prompt:
        'Extract the frequency of administration of the test material.\n\nFew-shot examples:\nInput: "Dosing was performed once daily."\nOutput: "once daily"\n\nInput: "The compound was administered twice a week."\nOutput: "twice a week"\n\nExtract the frequency of administration.',
    },
    {
      name: "Duration of Dosing Period",
      prompt:
        'Extract the duration of the dosing period.\n\nFew-shot examples:\nInput: "The animals were dosed for 28 consecutive days."\nOutput: "28 consecutive days"\n\nInput: "Treatment continued for a period of 14 weeks."\nOutput: "14 weeks"\n\nExtract the duration of the dosing period.',
    },
    {
      name: "Results Presented",
      prompt:
        'Are there results presented? (Qualitative or quantitative?)\n\nFew-shot example:\n\nInput: \"Lethargy and piloerection were observed in the treated groups. No other significant changes were noted for other parameters.\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 1. Reproductive Performance and Pup Outcomes</strong></caption>\n<thead>\n<tr>\n<th>Dose Group (mg/kg bw/day)</th>\n<th>Number of Parental Animals</th>\n<th>Number of Litters</th>\n<th>Mean Pup Body Weight (g) on PND 4</th>\n<th>Mean Pup Body Weight (g) on PND 21</th>\n<th>Mean Resorptions per Litter</th>\n</tr>\n</thead>\n</table>\n\n<figure>\n<figcaption>\n<strong>Figure X. Anogenital Distance in Offspring Following Developmental Exposure to Atrazine</strong>\n</figcaption>\n</figure>\"\n\nOutput: \"Results were presented quantitatively both tables and figures and described in writing.\n\nIn tables including number of parental animals, number of litters, mean pup body weight on PND 4, mean pup body weight on PND 21, and mean resorptions per litter. In figures, results included anogenital distance in offspring.\n\nResults were presented qualitatively through descriptions of clinical signs, including lethargy and piloerection.\"\n\nExtract how the results are presented.',
    },
    {
      name: "Fetal/Offspring Effects Reported by Study Authors",
      prompt:
        'Describe the key toxicological effects observed in fetuses or offspring according to the study authors. This includes potential fetal effects on body weight, reproductive parameters, viability, external examination, visceral examination, and skeletal examination. Additionally, include effects reported in offspring such as post-natal changes in body weight, body weight gain, deaths, or developmental parameters.\n\nFew-shot examples:\n\nInput: \"In the skeletal examination, craniofacial variations were observed at the lowest dose tested (30 mg/kg bw/day) (Table 3). At the highest dose tested (60 mg/kg bw/day), cleft palate was observed.\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 1. Organ Weights</strong></caption>\n<thead>\n<tr>\n<th>Parameter</th>\n<th>0 mg/kg bw/day</th>\n<th>30 mg/kg bw/day</th>\n<th>60 mg/kg bw/day</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Gravid uterus weight (g)</td>\n<td>31.07</td>\n<td>29.12</td>\n<td>27.02*</td>\n</tr>\n</tbody>\n</table>\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 2. Pregnancy and Litter Parameters</strong></caption>\n<thead>\n<tr>\n<th>Parameter</th>\n<th>0 mg/kg bw/day</th>\n<th>30 mg/kg bw/day</th>\n<th>60 mg/kg bw/day</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Post-implantation loss (%)</td>\n<td>2.03 ± 3.02</td>\n<td>7.02 ± 6.79*</td>\n<td>8.98 ± 7.62*</td>\n</tr>\n</tbody>\n</table>\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 3. Skeletal Abnormalities</strong></caption>\n<thead>\n<tr>\n<th>Finding</th>\n<th>0 mg/kg bw/day</th>\n<th>30 mg/kg bw/day</th>\n<th>60 mg/kg bw/day</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Craniofacial variations</td>\n<td>0</td>\n<td>2</td>\n<td>3</td>\n</tr>\n<tr>\n<td>Cleft palate</td>\n<td>0</td>\n<td>1</td>\n<td>3*</td>\n</tr>\n<tr>\n<td>Jugal and maxilla partial fusion</td>\n<td>0</td>\n<td>2</td>\n<td>4*</td>\n</tr>\n</tbody>\n</table>\"\n\nOutput: \"According to the study authors:\n- 30 mg/kg bw/day: Craniofacial skeletal variations and increased post-implantation loss were observed.\n- 60 mg/kg bw/day: Fetal effects included cleft palate, jugal and maxilla partial fusion, and increased post-implantation loss.\"\n\nInput: \"No treatment-related effects on fetal survival, fetal body weight, external morphology, visceral examination, or skeletal examination were observed at any dose level.\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 1. Pregnancy and Fetal Parameters</strong></caption>\n<thead>\n<tr>\n<th>Parameter</th>\n<th>0 mg/kg bw/day</th>\n<th>25 mg/kg bw/day</th>\n<th>100 mg/kg bw/day</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Live fetuses per litter</td>\n<td>10.1</td>\n<td>10.0</td>\n<td>10.2</td>\n</tr>\n<tr>\n<td>Fetal body weight (g)</td>\n<td>1.42</td>\n<td>1.41</td>\n<td>1.43</td>\n</tr>\n</tbody>\n</table>\"\n\nOutput: \"According to the study authors, no treatment-related fetal or offspring effects were observed at any dose level.\"\n\nExtract fetal or offspring effects as described by the study authors.',
    },
    {
      name: "Maternal Effects Reported by Study Authors",
      prompt:
        'Describe the key toxicological effects observed in maternal animals according to the study authors. This includes effects on clinical signs, body weight, body weight gain, food consumption, organ weights, gross pathology, and mortality. Include only effects explicitly attributed to treatment by the study authors.\n\nFew-shot examples:\n\nInput: \"Reduced body weight gain and decreased food consumption were observed in dams at the highest dose tested (60 mg/kg bw/day). Clinical signs included lethargy and piloerection.\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 1. Maternal Body Weight and Food Consumption</strong></caption>\n<thead>\n<tr>\n<th>Parameter</th>\n<th>0 mg/kg bw/day</th>\n<th>30 mg/kg bw/day</th>\n<th>60 mg/kg bw/day</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Body weight gain (g)</td>\n<td>45.2 ± 4.1</td>\n<td>44.1 ± 3.8</td>\n<td>36.0 ± 5.2*</td>\n</tr>\n<tr>\n<td>Food consumption (g/day)</td>\n<td>22.5 ± 2.0</td>\n<td>21.9 ± 2.1</td>\n<td>18.2 ± 2.5*</td>\n</tr>\n</tbody>\n</table>\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 2. Maternal Clinical Observations</strong></caption>\n<thead>\n<tr>\n<th>Clinical Sign</th>\n<th>0 mg/kg bw/day</th>\n<th>30 mg/kg bw/day</th>\n<th>60 mg/kg bw/day</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Lethargy</td>\n<td>0</td>\n<td>0</td>\n<td>4</td>\n</tr>\n<tr>\n<td>Piloerection</td>\n<td>0</td>\n<td>0</td>\n<td>3</td>\n</tr>\n</tbody>\n</table>\"\n\nOutput: \"According to the study authors:\n- 60 mg/kg bw/day: Maternal effects included reduced body weight gain, decreased food consumption, and clinical signs of lethargy and piloerection.\"\n\nInput: \"No treatment-related effects on maternal survival, clinical signs, body weight, body weight gain, food consumption, organ weights, or gross pathology were observed at any dose level.\n\n<table border=\\\"1\\\" cellpadding=\\\"6\\\" cellspacing=\\\"0\\\">\n<caption><strong>Table 1. Maternal Body Weight</strong></caption>\n<thead>\n<tr>\n<th>Parameter</th>\n<th>0 mg/kg bw/day</th>\n<th>25 mg/kg bw/day</th>\n<th>100 mg/kg bw/day</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Terminal body weight (g)</td>\n<td>325.1</td>\n<td>326.4</td>\n<td>324.8</td>\n</tr>\n</tbody>\n</table>\"\n\nOutput: \"According to the study authors, no treatment-related maternal effects were observed at any dose level.\"\n\nExtract maternal effects as described by the study authors.',
    },
  ],
};
