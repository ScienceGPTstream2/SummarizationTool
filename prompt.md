Prompts:

Extract the study author(s).

Few-shot examples:
Input: "The study was conducted by John Doe, Jane Smith, and their team."
Output: "John Doe, Jane Smith"

Input: "Authors: Maria Garcia, David Chen."
Output: "Maria Garcia, David Chen"

Extract the study author(s).

---

Extract the affiliations of the authors.

Few-shot examples:
Input: "John Doe is from the Department of Biology, University of Science. Jane Smith is from the Research Institute of Health."
Output: "Department of Biology, University of Science; Research Institute of Health"

Input: "Author Affiliation: Global Research Center, Springfield."
Output: "Global Research Center, Springfield"

Extract the author affiliations.

---

Extract the title of the study.

Few-shot examples:
Input: "Title: An In Vivo Study on the Effects of Compound X."
Output: "An In Vivo Study on the Effects of Compound X"

Input: "The paper 'Toxicity Analysis of Substance Y' presents..."
Output: "Toxicity Analysis of Substance Y"

Extract the study title.

---

Extract the publication date of the study.

Few-shot examples:
Input: "Published online: 15 January 2023."
Output: "15 January 2023"

Input: "The work was published in May 2022."
Output: "May 2022"

Extract the publication date.

---

Extract the test material used in the study.

Few-shot examples:
Input: "The test material was a novel compound, designated as CP-123."
Output: "CP-123"

Input: "We investigated the effects of bisphenol A (BPA)."
Output: "bisphenol A (BPA)"

Extract the test material.

---

Extract the vehicle or solvent used to administer the test material.

Few-shot examples:
Input: "The compound was dissolved in corn oil for administration."
Output: "corn oil"

Input: "A 0.5% carboxymethylcellulose solution was used as the vehicle."
Output: "0.5% carboxymethylcellulose solution"

Extract the vehicle or solvent used.

---

Extract the dose levels of the test material administered.

Few-shot examples:
Input: "Animals were treated with 10, 50, and 100 mg/kg of the compound."
Output: "10, 50, and 100 mg/kg"

Input: "Dose levels were 0, 5, 25, and 125 ppm."
Output: "0, 5, 25, and 125 ppm"

Extract the dose levels.

---

Are there results presented? (Qualitative or quantitative?)

Few-shot example:

Input: "Lethargy and piloerection were observed in the treated groups. No other significant changes were noted for other parameters.

<table border=\"1\" cellpadding=\"6\" cellspacing=\"0\">
<caption><strong>Table 1. Reproductive Performance and Pup Outcomes</strong></caption>
<thead>
<tr>
<th>Dose Group (mg/kg bw/day)</th>
<th>Number of Parental Animals</th>
<th>Number of Litters</th>
<th>Mean Pup Body Weight (g) on PND 4</th>
<th>Mean Pup Body Weight (g) on PND 21</th>
<th>Mean Resorptions per Litter</th>
</tr>
</thead>
</table>

<figure>
<figcaption>
<strong>Figure X. Anogenital Distance in Offspring Following Developmental Exposure to Atrazine</strong>
</figcaption>
</figure>"

Output: "Results were presented quantitatively both tables and figures and described in writing.

In tables including number of parental animals, number of litters, mean pup body weight on PND 4, mean pup body weight on PND 21, and mean resorptions per litter. In figures, results included anogenital distance in offspring.

Results were presented qualitatively through descriptions of clinical signs, including lethargy and piloerection."

Extract how the results are presented.

---

Ground Truth:

T.F.X. Collins, R.L. Sprando, T.N. Black, M.E. Shackelford, N. Olejnik, M.J. Ames, J.I. Rorie, D.I. Ruggles

---

Center for Food Safety and Applied Nutrition, US Food and Drug Administration, 8301 Muirkirk Road, Laurel, MD 20708, USA

---

Developmental toxicity of sodium fluoride measured during multiple generations

---

2001

---

Sodium fluoride (NaF)

---

Weight/volume NaF solutions were prepared in water obtained by filtering house-distilled water through a Hydro Pico pure water system

---

## 0, 25, 100, 175 or 250 ppm in drinking water

Results are presented in quantitative form through tables and figures, and also described qualitatively in the text.

---
