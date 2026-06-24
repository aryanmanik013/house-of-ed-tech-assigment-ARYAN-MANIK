import test from "node:test";
import assert from "node:assert";
import { shouldApplyClientOperation } from "../lib/sync/conflict-resolver";
import { ROLE_LEVELS, UserRole } from "../lib/permissions";

// 1. Conflict Resolution (Last Write Wins) Tests
test("LWW Conflict Resolver - Client version is higher", () => {
  const serverState = {
    content: "Server Content",
    version: 2,
    updatedAt: 1000,
    lastClientId: "client-A",
  };

  const clientOp = {
    content: "Client Content",
    version: 3,
    timestamp: 500,
    clientId: "client-B",
  };

  const result = shouldApplyClientOperation(serverState, clientOp);
  assert.strictEqual(result, true, "Client should win because of higher version");
});

test("LWW Conflict Resolver - Client version is lower", () => {
  const serverState = {
    content: "Server Content",
    version: 4,
    updatedAt: 1000,
    lastClientId: "client-A",
  };

  const clientOp = {
    content: "Client Content",
    version: 3,
    timestamp: 2000,
    clientId: "client-B",
  };

  const result = shouldApplyClientOperation(serverState, clientOp);
  assert.strictEqual(result, false, "Client should lose because of lower version");
});

test("LWW Conflict Resolver - Versions equal, Client timestamp is newer", () => {
  const serverState = {
    content: "Server Content",
    version: 2,
    updatedAt: 1000,
    lastClientId: "client-A",
  };

  const clientOp = {
    content: "Client Content",
    version: 2,
    timestamp: 1001,
    clientId: "client-B",
  };

  const result = shouldApplyClientOperation(serverState, clientOp);
  assert.strictEqual(result, true, "Client should win because of newer timestamp");
});

test("LWW Conflict Resolver - Versions equal, Client timestamp is older", () => {
  const serverState = {
    content: "Server Content",
    version: 2,
    updatedAt: 1000,
    lastClientId: "client-A",
  };

  const clientOp = {
    content: "Client Content",
    version: 2,
    timestamp: 999,
    clientId: "client-B",
  };

  const result = shouldApplyClientOperation(serverState, clientOp);
  assert.strictEqual(result, false, "Client should lose because of older timestamp");
});

test("LWW Conflict Resolver - Versions and timestamps equal, Client ID breaks tie (Win)", () => {
  const serverState = {
    content: "Server Content",
    version: 2,
    updatedAt: 1000,
    lastClientId: "client-A",
  };

  const clientOp = {
    content: "Client Content",
    version: 2,
    timestamp: 1000,
    clientId: "client-B",
  };

  const result = shouldApplyClientOperation(serverState, clientOp);
  assert.strictEqual(result, true, "Client should win because B > A");
});

test("LWW Conflict Resolver - Versions and timestamps equal, Client ID breaks tie (Lose)", () => {
  const serverState = {
    content: "Server Content",
    version: 2,
    updatedAt: 1000,
    lastClientId: "client-B",
  };

  const clientOp = {
    content: "Client Content",
    version: 2,
    timestamp: 1000,
    clientId: "client-A",
  };

  const result = shouldApplyClientOperation(serverState, clientOp);
  assert.strictEqual(result, false, "Client should lose because A < B");
});

// 2. Role-based Permission Mapping Tests
test("Permissions Model - Level hierarchy logic", () => {
  assert.strictEqual(ROLE_LEVELS["owner"], 3);
  assert.strictEqual(ROLE_LEVELS["editor"], 2);
  assert.strictEqual(ROLE_LEVELS["viewer"], 1);

  const canEdit = (role: UserRole) => ROLE_LEVELS[role] >= ROLE_LEVELS["editor"];
  const canDelete = (role: UserRole) => ROLE_LEVELS[role] >= ROLE_LEVELS["owner"];

  assert.strictEqual(canEdit("owner"), true);
  assert.strictEqual(canEdit("editor"), true);
  assert.strictEqual(canEdit("viewer"), false);

  assert.strictEqual(canDelete("owner"), true);
  assert.strictEqual(canDelete("editor"), false);
  assert.strictEqual(canDelete("viewer"), false);
});
