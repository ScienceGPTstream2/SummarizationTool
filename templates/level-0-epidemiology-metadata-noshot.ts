export const level0EpidemiologyMetaDataNoShotTemplate = {
  studyType: "Level-0-epidemiology-MetaData-NoShot",
  displayName: "Level-0-epidemiology-MetaData-NoShot",
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
  ],
};
