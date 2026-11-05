// Generated list of imports: one JSON Schema per contract. Schemas are bundled so the package
// works in any runtime (no file system access).

import accountKnowledgeRecord from "../schemas/account-knowledge-record.schema.json" with {
  type: "json",
};
import accountRelationship from "../schemas/account-relationship.schema.json" with { type: "json" };
import accountSuccessStory from "../schemas/account-success-story.schema.json" with {
  type: "json",
};
import accountWorkspace from "../schemas/account-workspace.schema.json" with { type: "json" };
import action from "../schemas/action.schema.json" with { type: "json" };
import auditEvent from "../schemas/audit-event.schema.json" with { type: "json" };
import common from "../schemas/common.schema.json" with { type: "json" };
import customerPermission from "../schemas/customer-permission.schema.json" with { type: "json" };
import decision from "../schemas/decision.schema.json" with { type: "json" };
import eventEnvelope from "../schemas/event-envelope.schema.json" with { type: "json" };
import exportManifest from "../schemas/export-manifest.schema.json" with { type: "json" };
import globalPayload from "../schemas/global-payload.schema.json" with { type: "json" };
import meeting from "../schemas/meeting.schema.json" with { type: "json" };
import membership from "../schemas/membership.schema.json" with { type: "json" };
import mutationIntent from "../schemas/mutation-intent.schema.json" with { type: "json" };
import policyDecision from "../schemas/policy-decision.schema.json" with { type: "json" };
import revisionManifest from "../schemas/revision-manifest.schema.json" with { type: "json" };
import sourceRecord from "../schemas/source-record.schema.json" with { type: "json" };
import taskGrant from "../schemas/task-grant.schema.json" with { type: "json" };
import viewPlan from "../schemas/view-plan.schema.json" with { type: "json" };

export const SCHEMA_BASE = "https://schemas.secondary.invalid/prd/1.2/";

export const SCHEMAS = {
  "account-knowledge-record": accountKnowledgeRecord,
  "account-relationship": accountRelationship,
  "account-success-story": accountSuccessStory,
  "account-workspace": accountWorkspace,
  action: action,
  "audit-event": auditEvent,
  common: common,
  "customer-permission": customerPermission,
  decision: decision,
  "event-envelope": eventEnvelope,
  "export-manifest": exportManifest,
  "global-payload": globalPayload,
  meeting: meeting,
  membership: membership,
  "mutation-intent": mutationIntent,
  "policy-decision": policyDecision,
  "revision-manifest": revisionManifest,
  "source-record": sourceRecord,
  "task-grant": taskGrant,
  "view-plan": viewPlan,
} as const;

export type SchemaName = Exclude<keyof typeof SCHEMAS, "common">;
