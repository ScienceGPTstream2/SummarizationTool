export const level0EpidemiologyMetaDataNoShotTemplate = {
  studyType: "Level-0-epidemiology-MetaData-NoShot",
  displayName: "Level-0-epidemiology-MetaData-NoShot",
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
  ],
};
