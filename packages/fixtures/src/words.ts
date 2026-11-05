// Built-in word lists. All content is invented; nothing here is read from outside this file.

export const FIRST_NAMES = [
  "Alma",
  "Bruno",
  "Celia",
  "Dario",
  "Elin",
  "Fabio",
  "Greta",
  "Hugo",
  "Iris",
  "Jules",
  "Kira",
  "Lars",
  "Mila",
  "Nico",
  "Opal",
  "Pia",
  "Remy",
  "Sana",
  "Teo",
  "Una",
];
export const LAST_NAMES = [
  "Aldous",
  "Brenner",
  "Castell",
  "Dunmore",
  "Eskild",
  "Farrow",
  "Grimaldi",
  "Hollis",
  "Ivers",
  "Jarrow",
  "Kestrel",
  "Lindqvist",
  "Marchetti",
  "Novak",
  "Orsini",
  "Pellegrin",
];
export const JOB_TITLES = [
  "Head of Operations",
  "Procurement Lead",
  "IT Director",
  "Programme Manager",
  "Finance Controller",
  "Security Officer",
  "Business Sponsor",
  "Delivery Manager",
];
export const TEAMS = [
  "delivery team",
  "steering group",
  "platform squad",
  "finance office",
  "working group",
];
export const VERBS = [
  "reviewed",
  "scoped",
  "postponed",
  "approved",
  "re-estimated",
  "documented",
  "challenged",
];
export const ADJECTIVES = [
  "quarterly",
  "provisional",
  "regional",
  "consolidated",
  "draft",
  "revised",
  "interim",
];
export const NOUNS = [
  "roadmap",
  "budget",
  "handover",
  "risk register",
  "migration plan",
  "staffing plan",
  "service review",
  "onboarding pack",
  "milestone list",
  "capacity forecast",
];
export const TIMES = [
  "the next checkpoint",
  "month end",
  "the steering meeting",
  "the audit window",
  "Friday",
];
export const TOPICS = [
  "Renewal planning",
  "Delivery cadence",
  "Capacity review",
  "Governance setup",
  "Reporting changes",
  "Transition plan",
  "Scope clarification",
  "Quality review",
];
export const GENERAL_KINDS = ["Meeting prep", "Status note", "Project brief", "Retrospective"];
export const CONTACT_KINDS = ["Contact sheet", "Stakeholder map"];
export const RESTRICTED_KINDS = ["Pricing note", "Renewal terms", "Margin review"];

// Personal-conversation lines for synthetic transcripts. Invented, generic, never tied to a real person.
export const PERSONAL_LINES: Record<string, string[]> = {
  health: [
    "I will be out Thursday for a medical appointment, the doctor wants more tests on my back.",
    "My knee surgery is booked for next month and I am a bit nervous about it.",
    "I have been sleeping badly since the diagnosis and the specialist changed my treatment.",
  ],
  family: [
    "My daughter just started at a new school and she is struggling to make friends.",
    "We are expecting a baby in March, so I will take parental leave.",
    "My father moved into a care home last week and it has been hard on the family.",
  ],
  holidays: [
    "We are flying to the coast for two weeks in August and the kids are very excited.",
    "My partner and I booked a ski trip over the new year.",
    "I am taking the whole of July off to drive around the islands.",
  ],
  hr_gossip: [
    "Between us, I heard a manager is about to put someone on a performance plan.",
    "Did you hear that a colleague was passed over for promotion and is looking for another job?",
    "Apparently there was a complaint about a team lead and HR is keeping quiet about it.",
  ],
};
