import { clinicalTrialTemplate } from '../templates/clinical-trial';
import { observationalTemplate } from '../templates/observational';
import { metaAnalysisTemplate } from '../templates/meta-analysis';
import { caseStudyTemplate } from '../templates/case-study';
import { reviewTemplate } from '../templates/review';
import { level1InVivoTemplate } from '../templates/level-1-in-vivo';

export interface EntityTemplate {
  name: string;
  prompt: string;
}

export interface StudyTypeTemplate {
  studyType: string;
  displayName: string;
  entities: EntityTemplate[];
}

const templates: Record<string, StudyTypeTemplate> = {
  'clinical-trial': clinicalTrialTemplate,
  'observational': observationalTemplate,
  'meta-analysis': metaAnalysisTemplate,
  'case-study': caseStudyTemplate,
  'review': reviewTemplate,
  'level-1-in-vivo': level1InVivoTemplate,
};

export const loadStudyTypeTemplate = (studyTypeId: string): EntityTemplate[] => {
  const template = templates[studyTypeId];
  if (!template) {
    console.warn(`No template found for study type: ${studyTypeId}`);
    return [];
  }
  
  // Return a deep copy to prevent modifications to the original template
  return template.entities.map(entity => ({
    name: entity.name,
    prompt: entity.prompt,
  }));
};

export const getAvailableStudyTypes = (): Array<{ id: string; name: string }> => {
  return Object.values(templates).map(template => ({
    id: template.studyType,
    name: template.displayName,
  }));
};

export const getStudyTypeDisplayName = (studyTypeId: string): string => {
  const template = templates[studyTypeId];
  return template ? template.displayName : studyTypeId;
};
