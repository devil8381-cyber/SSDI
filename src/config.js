export const DISPOSITIONS = [
  'New', 'Working', 'VM', 'Callback', 'NIS', 'Not Interested', 'Signed', 'Approved', 'Criteria Not Met',
]

export const DISPOSITION_STYLES = {
  New: 'bg-blue-500/10 text-blue-300 ring-blue-500/30',
  Working: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  VM: 'bg-violet-500/10 text-violet-300 ring-violet-500/30',
  Callback: 'bg-cyan-500/10 text-cyan-300 ring-cyan-500/30',
  NIS: 'bg-slate-800 text-slate-300 ring-slate-500/20',
  'Not Interested': 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
  Signed: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  Approved: 'bg-emerald-600 text-white ring-emerald-500/30',
  'Criteria Not Met': 'bg-zinc-500/10 text-zinc-300 ring-zinc-500/30',
}

export const CRITERIA_REASONS = ['Age', 'Work history', 'Already receiving benefits', 'Under 12 months', 'Other']

export const SMTP_PURPOSES = [
  { value: 'callbacks', label: 'Callbacks' },
  { value: 'documentation', label: 'Documentation requests' },
  { value: 'followups', label: 'General follow-ups' },
  { value: 'notifications', label: 'System notifications' },
  { value: 'general', label: 'General / fallback' },
]

export const DOC_TYPES = [
  'Government photo ID', 'Proof of citizenship', 'Social Security card',
  'Work history / W-2', 'Medical records', 'Bank statements', 'Award letter', 'Other',
]

export const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

export const TASK_TYPES = [
  { value: 'callback', label: 'Callback' },
  { value: 'followup', label: 'Follow-up' },
  { value: 'doc_request', label: 'Document request' },
  { value: 'other', label: 'Other' },
]

// SSDI intake questionnaire — filled by the agent during the verification/intake
// call. Stored on the lead as structured JSON (lead.intake[qid] = answer).
export const INTAKE_SECTIONS = [
  { name: 'SSDI Status', questions: [
    { id: 'q1', q: 'Are you currently receiving SSDI?', type: 'yesno' },
    { id: 'q2', q: 'Have you applied before?', type: 'yesno' },
    { id: 'q3', q: 'Are you currently working?', type: 'text' },
    { id: 'q4', q: 'Out of the last 10 years, how many years did you work?', type: 'text' },
    { id: 'q5', q: 'What was your last full-time job?', type: 'text' },
    { id: 'q6', q: "Has your doctor told you that you can't work for at least 12 months due to your disability?", type: 'yesno' },
  ]},
  { name: 'Medical Condition', questions: [
    { id: 'q7', q: 'What are your current primary condition(s)?', type: 'text' },
    { id: 'q8', q: 'What tests have you had?', type: 'text' },
    { id: 'q9', q: 'When did you have these tests done?', type: 'text' },
    { id: 'q10', q: 'What is the date of diagnosis?', type: 'text' },
    { id: 'q11', q: 'Diagnosed by:', type: 'text' },
    { id: 'q12', q: 'What was the name of the hospital where you received treatment?', type: 'text' },
    { id: 'q13', q: 'What type of treatments are you receiving?', type: 'text' },
    { id: 'q14', q: 'When did you start your treatment?', type: 'text' },
  ]},
  { name: 'Functional Limitations', questions: [
    { id: 'q15', q: 'What limitations or problems are you currently facing?', type: 'text' },
    { id: 'q16', q: 'What are your daily activities like?', type: 'text' },
  ]},
  { name: 'Mental Health (if applicable)', questions: [
    { id: 'q17', q: 'Do you face any mental health issues?', type: 'yesno' },
    { id: 'q18', q: 'What treatment are you receiving for that?', type: 'text' },
    { id: 'q19', q: 'Has your mental health affected your ability to work or socialize?', type: 'text' },
  ]},
  { name: 'Additional Information', questions: [
    { id: 'q20', q: 'Do you have dependents under 18?', type: 'yesno' },
    { id: 'q21', q: 'Did you ever have other disability coverage or workers\u2019 compensation?', type: 'yesno' },
    { id: 'q22', q: 'Are you working with an attorney or advocate?', type: 'yesno' },
    { id: 'q23', q: 'Did you ever speak to any attorney or sign any legal documents regarding this claim?', type: 'yesno' },
    { id: 'q24', q: 'Where are your medical records?', type: 'text' },
    { id: 'q25', q: 'Can you send us your medical records?', type: 'text' },
    { id: 'q26', q: 'Do you give us permission to retrieve your medical records?', type: 'yesno' },
    { id: 'q27', q: 'Did someone coach or train you for this claim?', type: 'yesno' },
    { id: 'q28', q: 'Where did you learn about this lawsuit or claim process?', type: 'text' },
  ]},
  { name: 'Additional Supporting (Recommended)', questions: [
    { id: 'q29', q: 'Have you had any surgeries related to your condition?', type: 'text' },
    { id: 'q30', q: 'Do you take any prescribed medications daily for your condition?', type: 'text' },
    { id: 'q31', q: 'Has your condition worsened over time?', type: 'yesno' },
    { id: 'q32', q: 'Do you use any assistive devices?', type: 'text' },
    { id: 'q33', q: 'Have any doctors given a written statement that you are unable to return to work?', type: 'text' },
  ]},
]
