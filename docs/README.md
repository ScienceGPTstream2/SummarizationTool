# Science-GPT Summarization Tool Overview

Science-GPT is a web application that helps scientific reviewers work through large scientific documents more quickly. It can read uploaded PDF studies, extract key information, generate structured summaries, and let reviewers compare results from different AI models.

This page is a high-level overview for readers who want to understand what the project does, who it is for, and what was learned during testing.

## Where to go next

- Read this page first for a plain-language project overview.
- See [`backend/`](backend/) for detailed backend architecture and implementation notes.
- See [`images/`](images/) for application screenshots and workflow diagrams.


## What problem does this solve?

Scientific reviewers at PMRA review large volumes of technical documents, including toxicology studies, epidemiology studies, scientific articles, and grey literature. This work is important for pesticide and chemical safety decisions, but it is also time-consuming.

A major part of the review process involves finding information in documents, extracting key details, organizing results, and writing summaries. Science-GPT was built to test whether AI can help with those tasks while still keeping scientific experts in control.

The goal is not to replace reviewers. The goal is to help reviewers get to a strong first draft faster, so they can spend more time checking evidence, applying scientific judgement, and making decisions.

## Who is this tool for?

The main users are scientific reviewers and evaluators who review pesticide and chemical safety information.

During Stream 2 testing, the project focused on two groups:

- **Toxicology reviewers**, who review animal toxicity studies and summarize effects such as maternal and fetal outcomes.
- **Epidemiology reviewers**, who review human health studies and summarize study design, exposure, outcomes, measures of association, strengths, limitations, and risk-of-bias information.

The tool may also be useful to project teams, managers, and technical partners who need to understand how AI could support scientific review workflows.

## What does the tool do?

At a high level, Science-GPT supports this workflow:

1. A reviewer uploads one or more PDF studies.
2. The tool converts the PDF into structured text that AI models can use.
3. The reviewer chooses what information should be extracted.
4. One or more AI models extract the requested information.
5. The reviewer compares the outputs, checks the source evidence, and validates the result.
6. The output can be exported for reporting or further analysis.

The application supports multiple models, including models from OpenAI, Google, Anthropic, Meta, and locally hosted open-source models. This makes it possible to compare model quality, speed, and cost on the same task.

## How was it tested?

Testing was led by Subject Matter Experts (SMEs). SMEs selected studies, created expected answers, reviewed AI outputs, and scored how well the models performed.

The team tested two main use cases:

### In vivo developmental toxicity studies

Toxicology SMEs selected 10 published developmental toxicity studies. They manually created “ground truth” summaries, which acted as the reference answers for scoring AI outputs.

The AI models were tested on two levels of summary:

- **Level 0 summaries:** simple study information such as author, title, publication date, and journal.
- **Level 1 summaries:** more detailed toxicology information such as test material, animal species, dose levels, route of administration, maternal effects, and fetal or offspring effects.

### Epidemiology studies

Epidemiology SMEs tested the tool on studies with different designs, including cohort, case-control, and biomonitoring studies.

The tool was used to extract information such as participant numbers, pesticide of interest, exposure measurement, health outcomes, measures of association, study conclusions, strengths, limitations, and risk-of-bias information.

This use case was more difficult because epidemiology studies often contain complex tables, different exposure measures, different study designs, and more variation in how results are reported.

## How was performance measured?

The main performance questions were:

- **Was the answer correct?**
- **Was the answer complete?**
- **How much did it cost?**
- **How long did it take?**
- **Was the output useful to the reviewer?**

For the toxicology testing, SMEs scored model outputs for correctness and completeness against the ground truth summaries. For epidemiology testing, SMEs also looked closely at whether the outputs were readable, concise, and useful for real review work.

## Evaluation results

A major part of Stream 2 was evaluation: testing the tool with SMEs, comparing model outputs, and measuring whether the results were useful for real scientific review work.

### Toxicology results

For the toxicology use case, SMEs tested the tool on 10 in vivo developmental toxicity studies. The models were scored against SME-created reference summaries.

The strongest overall model was **Gemini 2.5 Pro**. It performed best across both simple study information and more detailed toxicology summary fields.

| Model result | What it means |
| --- | --- |
| **Gemini 2.5 Pro was the top performer** | It had the best overall correctness and completeness scores for the toxicology studies. |
| **Simple fields were easier** | Most models could extract information such as author, title, publication date, and journal. |
| **Detailed scientific fields were harder** | More complex fields, such as maternal effects and fetal or offspring effects, showed bigger differences between models. |
| **Claude Sonnet 4.5 and Claude Opus 4.1 also performed strongly** | They were good options for complex summaries, but were more expensive than Gemini 2.5 Pro. |

The testing also showed a large time-saving opportunity. SMEs spent about **300 minutes** manually creating summaries for 10 studies. Using the tool with the best-performing model and fastest document processing setup, the same set of draft summaries could be generated in slightly over **5 minutes**, before SME verification.

### Epidemiology results

For the epidemiology use case, the results were more mixed because epidemiology studies are less standardized and often include complex tables, different study designs, and detailed numerical results.

The main findings were:

| Model result | What it means |
| --- | --- |
| **Gemini 2.5 Pro and GPT-5.2 were strong general choices** | They performed well across many extraction tasks. |
| **Claude Sonnet 4.5 was best for complex table extraction** | It was especially useful when the reviewer needed numerical results organized into tables. |
| **Lower-cost models worked for simple fields** | They could handle straightforward information, but were less reliable for complex summaries and tables. |
| **The best model depended on the task** | No single model was best for every epidemiology extraction task. |

In one applied epidemiology risk-of-bias test, the report estimated that reviewing 20 studies manually would take about **40 hours**. With AI-generated summaries plus SME verification, the work was estimated at about **11 hours total**.

### Overall evaluation conclusion

The evaluation showed that Science-GPT can create useful first drafts much faster than a fully manual workflow. However, the outputs still need SME review. The tool is most valuable when it helps reviewers quickly collect and organize information while leaving the final scientific judgement with the reviewer.

The best default model from the testing was **Gemini 2.5 Pro**, especially for the toxicology use case. For epidemiology, **Gemini 2.5 Pro**, **GPT-5.2**, and **Claude Sonnet 4.5** were all useful, depending on whether the task required general extraction, lower cost, or stronger table generation.

Overall, Stream 2 showed that Science-GPT can help scientific reviewers work faster while keeping expert judgement at the centre of the process.
