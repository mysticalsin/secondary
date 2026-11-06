export const v7groupEn = {
  "v7g.nav": "Privacy group",
  "v7g.title": "Privacy approver group",
  "v7g.lead":
    "A rule can ask that a change is approved by the named approver group: privacy. People listed here can approve those changes, as well as the stewards of the brain.",
  "v7g.members": "Members",
  "v7g.none": "Nobody is named yet. Only stewards can approve changes that ask for this group.",
  "v7g.unknown": "Not in the directory",
  "v7g.remove": "Remove {who} from the group",
  "v7g.add": "Add a person",
  "v7g.add.btn": "Add",
  "v7g.add.none": "Choose a person",
  "v7g.saved": "Privacy group saved.",
  "v7g.pending": "Waiting for a second Platform admin: they make the same change to confirm it.",
  "v7g.failed": "The group was not changed.",
} as const;

export const v7groupFr: Record<keyof typeof v7groupEn, string> = {
  "v7g.nav": "Groupe confidentialité",
  "v7g.title": "Groupe d'approbation confidentialité",
  "v7g.lead":
    "Une règle peut demander qu'un changement soit approuvé par le groupe d'approbateurs nommé : confidentialité. Les personnes listées ici peuvent approuver ces changements, comme les stewards du cerveau.",
  "v7g.members": "Membres",
  "v7g.none":
    "Personne n'est nommé. Seuls les stewards peuvent approuver les changements qui demandent ce groupe.",
  "v7g.unknown": "Absent de l'annuaire",
  "v7g.remove": "Retirer {who} du groupe",
  "v7g.add": "Ajouter une personne",
  "v7g.add.btn": "Ajouter",
  "v7g.add.none": "Choisir une personne",
  "v7g.saved": "Groupe confidentialité enregistré.",
  "v7g.pending":
    "En attente d'un second administrateur : il fait le même changement pour le confirmer.",
  "v7g.failed": "Le groupe n'a pas été modifié.",
};

export const v7deskEn = {
  "v7d.hold.title": "Held by a rule: {action}",
  "v7d.hold.approvals": "{n} of {of} approvals",
  "v7d.approve": "Approve",
  "v7d.reject": "Reject",
  "v7d.pub.publish": 'Rule "{name}": version {v} waits for a second person',
  "v7d.pub.rollback": 'Rule "{name}": a return to version {v} waits for a second person',
  "v7d.pub.waiting": "Needs your confirmation",
  "v7d.pub.open": "Open in Rules",
} as const;

export const v7deskFr: Record<keyof typeof v7deskEn, string> = {
  "v7d.hold.title": "Retenu par une règle : {action}",
  "v7d.hold.approvals": "{n} approbations sur {of}",
  "v7d.approve": "Approuver",
  "v7d.reject": "Refuser",
  "v7d.pub.publish": "Règle « {name} » : la version {v} attend une deuxième personne",
  "v7d.pub.rollback": "Règle « {name} » : un retour à la version {v} attend une deuxième personne",
  "v7d.pub.waiting": "Attend votre confirmation",
  "v7d.pub.open": "Ouvrir dans Règles",
};
