// Commercial creative-finance videos (Lease Options, Subject-To, Loan Assumption).
// education-data.js serves this only after a server-side membership check.
// Residential lesson copy and residential YouTube ids live in education.html.
// Video ids in this file stay out of the page. creativeFinanceLessonPayload
// sends them only to Empire, from
// GET /api/education-data?action=creative_finance_lessons.
// Foundation members still receive the lesson number only.
//
// Keys are "<path>:<lesson number>" and must match the empire: true lessons
// in education.html.
//   lease-option:7   Commercial lease options
//   lease-option:8   Master lease options
//   subject-to:11    Commercial debt
//   assumption:8     Agency, CMBS, and SBA assumptions
const CREATIVE_FINANCE_COMMERCIAL_VIDEOS = {
  'lease-option:7': 'od_uMZmmr3Q',
  'lease-option:8': 'JiVPxFBlLvM',
  'subject-to:11': 'F-m8Gigh90s',
  'assumption:8': 'S4Y8Xy9uIUo',
};

module.exports = { CREATIVE_FINANCE_COMMERCIAL_VIDEOS };
