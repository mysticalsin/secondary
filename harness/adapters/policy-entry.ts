/**
 * New harness adapter. This file is not recovered source.
 *
 * Worker modules import the package name `@secondary/policy`. The source map
 * did not include a package.json or a barrel. Every name below is already
 * exported by a recovered file under recovered-source/shared/packages/policy.
 * This module only re-exports those names. It does not add policy behavior.
 */

export type {
  Action,
  AdmittedView,
  Ctx,
  Grant,
  Lens,
  MapNode,
  NodeKind,
  Org,
  OrgNode,
  Principal,
  Role,
  ScopeRef,
  ScopeType,
  ViewNode,
} from "../../recovered-source/shared/packages/policy/src/types.ts";
export { ACTIONS, LENSES } from "../../recovered-source/shared/packages/policy/src/types.ts";

export type {
  BrainFacts,
  BrainRole,
  BrainType,
  Everyone,
  Publication,
} from "../../recovered-source/shared/packages/policy/src/brains.ts";
export {
  BRAIN_ROLE_LABEL,
  BRAIN_ROLES,
  brainRoleActions,
  brainTypeOf,
  effectiveEveryone,
  effectivePublication,
  everyoneBound,
  isBrainRole,
  isRestrictedBrain,
  isShareable,
  opensBrain,
  publicationBound,
  roleAllows,
} from "../../recovered-source/shared/packages/policy/src/brains.ts";

export {
  admittedView,
  canDo,
  canDoInView,
  describe,
} from "../../recovered-source/shared/packages/policy/src/engine.ts";

export {
  DEFAULT_SEED,
  GOVERNANCES,
  buildOrg,
} from "../../recovered-source/shared/packages/policy/src/org.ts";

export {
  governanceStages,
  toMapView,
  toNodeDetail,
} from "../../recovered-source/shared/packages/policy/src/map.ts";

export {
  isPersonalKind,
  personalRootId,
} from "../../recovered-source/shared/packages/policy/src/personal.ts";

export { PERSONAS, TENANT_ID } from "../../recovered-source/shared/packages/policy/src/personas.ts";

export type { RoleId } from "../../recovered-source/shared/packages/policy/src/roles.ts";
export {
  ROLE_ORDER,
  ROLES,
  isBuiltInLeadRole,
  isBuiltInLeadRoleId,
} from "../../recovered-source/shared/packages/policy/src/roles.ts";
