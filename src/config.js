export const DISPOSITIONS = [
  'New', 'Working', 'VM', 'Callback', 'NIS', 'Not Interested', 'Signed', 'Approved', 'Criteria Not Met',
]

export const DISPOSITION_STYLES = {
  New: 'bg-blue-100 text-blue-700 ring-blue-600/20',
  Working: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  VM: 'bg-violet-100 text-violet-700 ring-violet-600/20',
  Callback: 'bg-cyan-100 text-cyan-700 ring-cyan-600/20',
  NIS: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  'Not Interested': 'bg-rose-100 text-rose-700 ring-rose-600/20',
  Signed: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20',
  Approved: 'bg-emerald-600 text-white ring-emerald-600/20',
  'Criteria Not Met': 'bg-zinc-200 text-zinc-700 ring-zinc-500/20',
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
