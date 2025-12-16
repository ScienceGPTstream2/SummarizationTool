import { clinicalTrialTemplate } from "../templates/clinical-trial";
import { observationalTemplate } from "../templates/observational";
import { metaAnalysisTemplate } from "../templates/meta-analysis";
import { caseStudyTemplate } from "../templates/case-study";
import { reviewTemplate } from "../templates/review";
import { level1InVivoTemplate } from "../templates/level-1-in-vivo";
import { level1InVivoNoShotTemplate } from "../templates/level-1-in-vivo-noshot";
import { level2InVivoTemplate } from "../templates/level-2-in-vivo";
import { level2InVivoNoShotTemplate } from "../templates/level-2-in-vivo-noshot";
import { level1EpidemiologyTemplate } from "../templates/level-1-epidemiology";
import { generalLevel1EpidemiologyAdamV1Template } from "../templates/general-level-1-epidemiology-adam-v1";
import { generalLevel1EpidemiologyAdamV1NoShotTemplate } from "../templates/general-level-1-epidemiology-adam-v1-noshot";
import { level0EpidemiologyMetaDataTemplate } from "../templates/level-0-epidemiology-metadata";
import { level0EpidemiologyMetaDataNoShotTemplate } from "../templates/level-0-epidemiology-metadata-noshot";

export interface EntityTemplate {
  name: string;
  prompt: string;
}

export interface StudyTypeTemplate {
  studyType: string;
  displayName: string;
  summaryPrompt?: string;
  entities: EntityTemplate[];
}

const templates: Record<string, StudyTypeTemplate> = {
  "clinical-trial": clinicalTrialTemplate,
  observational: observationalTemplate,
  "meta-analysis": metaAnalysisTemplate,
  "case-study": caseStudyTemplate,
  review: reviewTemplate,
  "level-1-in-vivo": level1InVivoTemplate,
  "level-1-in-vivo-noshot": level1InVivoNoShotTemplate,
  "level-2-in-vivo": level2InVivoTemplate,
  "level-2-in-vivo-noshot": level2InVivoNoShotTemplate,
  "level-1-epidemiology": level1EpidemiologyTemplate,
  "General-level-1-epidemiology-AdamV1":
    generalLevel1EpidemiologyAdamV1Template,
  "General-level-1-epidemiology-AdamV1-NoShot":
    generalLevel1EpidemiologyAdamV1NoShotTemplate,
  "Level-0-epidemiology-MetaData": level0EpidemiologyMetaDataTemplate,
  "Level-0-epidemiology-MetaData-NoShot":
    level0EpidemiologyMetaDataNoShotTemplate,
};

export const loadStudyTypeTemplate = (
  studyTypeId: string
): { entities: EntityTemplate[]; summaryPrompt: string } => {
  const template = templates[studyTypeId];
  if (!template) {
    console.warn(`No template found for study type: ${studyTypeId}`);
    return { entities: [], summaryPrompt: "" };
  }

  // Return a deep copy to prevent modifications to the original template
  return {
    entities: template.entities.map((entity) => ({
      name: entity.name,
      prompt: entity.prompt,
    })),
    summaryPrompt:
      template.summaryPrompt ||
      "Take the extracted entities and put them into a single cohesive paragraph. Do not change any of the extracted entities.",
  };
};

export const getAvailableStudyTypes = (): Array<{
  id: string;
  name: string;
}> => {
  return Object.values(templates).map((template) => ({
    id: template.studyType,
    name: template.displayName,
  }));
};

export const getStudyTypeDisplayName = (studyTypeId: string): string => {
  const template = templates[studyTypeId];
  return template ? template.displayName : studyTypeId;
};
