import { DifyAdapterError } from "./errors";

export type MetadataCondition = {
  logicalOperator: "and" | "or";
  conditions: MetadataConditionItem[];
};

export type MetadataConditionItem = {
  name: string;
  operator: string;
  value?: unknown;
};

export function normalizeOptionalMetadataCondition(value: unknown): MetadataCondition | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DifyAdapterError("INVALID_REQUEST", "metadata_condition must be an object.", 400);
  }

  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return null;
  }

  const logicalOperator = normalizeLogicalOperator(record.logical_operator);
  const rawConditions = record.conditions;
  if (!Array.isArray(rawConditions) || rawConditions.length === 0) {
    return null;
  }

  return {
    logicalOperator,
    conditions: rawConditions.map(normalizeConditionItem)
  };
}

export function matchesMetadataConditions(
  metadata: Record<string, unknown>,
  conditions: Array<MetadataCondition | null>
): boolean {
  return conditions.every(
    (condition) => !condition || matchesMetadataCondition(metadata, condition)
  );
}

export function matchesMetadataCondition(
  metadata: Record<string, unknown>,
  condition: MetadataCondition
): boolean {
  const results = condition.conditions.map((item) => matchesConditionItem(metadata, item));
  return condition.logicalOperator === "or" ? results.some(Boolean) : results.every(Boolean);
}

function normalizeLogicalOperator(value: unknown): "and" | "or" {
  if (value === undefined || value === null) {
    return "and";
  }
  if (value === "and" || value === "or") {
    return value;
  }
  throw new DifyAdapterError(
    "INVALID_REQUEST",
    "metadata_condition.logical_operator is invalid.",
    400
  );
}

function normalizeConditionItem(value: unknown): MetadataConditionItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DifyAdapterError("INVALID_REQUEST", "metadata_condition condition is invalid.", 400);
  }
  const record = value as Record<string, unknown>;
  const name = textValue(record.name ?? record.field ?? record.key);
  const operator = textValue(record.comparison_operator ?? record.operator);
  if (!name || !operator) {
    throw new DifyAdapterError(
      "INVALID_REQUEST",
      "metadata_condition condition name and comparison_operator are required.",
      400
    );
  }

  return {
    name,
    operator: normalizeOperator(operator),
    value: record.value
  };
}

function matchesConditionItem(metadata: Record<string, unknown>, condition: MetadataConditionItem) {
  const actual = getPathValue(metadata, condition.name);
  const expected = condition.value;

  switch (condition.operator) {
    case "contains":
      return containsValue(actual, expected);
    case "not contains":
      return !containsValue(actual, expected);
    case "start with":
      return typeof actual === "string" && actual.startsWith(String(expected ?? ""));
    case "end with":
      return typeof actual === "string" && actual.endsWith(String(expected ?? ""));
    case "is":
    case "=":
    case "==":
      return equalsValue(actual, expected);
    case "is not":
    case "!=":
      return !equalsValue(actual, expected);
    case "in":
      return inValue(actual, expected);
    case "not in":
      return !inValue(actual, expected);
    case "empty":
      return isEmpty(actual);
    case "not empty":
      return !isEmpty(actual);
    case ">":
    case "<":
    case ">=":
    case "<=":
      return compareValues(actual, expected, condition.operator);
    case "before":
      return compareDates(actual, expected, "<");
    case "after":
      return compareDates(actual, expected, ">");
    default:
      throw new DifyAdapterError(
        "INVALID_REQUEST",
        "metadata_condition operator is not supported.",
        400
      );
  }
}

function normalizeOperator(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "\u2260") {
    return "!=";
  }
  if (normalized === "\u2265") {
    return ">=";
  }
  if (normalized === "\u2264") {
    return "<=";
  }
  return normalized;
}

function getPathValue(metadata: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cursor, part) => {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return undefined;
    }
    return (cursor as Record<string, unknown>)[part];
  }, metadata);
}

function containsValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    return expectedValues.some((value) => actual.some((item) => equalsValue(item, value)));
  }
  if (typeof actual === "string") {
    return actual.includes(String(expected ?? ""));
  }
  return false;
}

function inValue(actual: unknown, expected: unknown): boolean {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  if (Array.isArray(actual)) {
    return actual.some((item) => expectedValues.some((value) => equalsValue(item, value)));
  }
  return expectedValues.some((value) => equalsValue(actual, value));
}

function equalsValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date || expected instanceof Date) {
    return toTime(actual) === toTime(expected);
  }
  return String(actual) === String(expected);
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function compareValues(actual: unknown, expected: unknown, operator: ">" | "<" | ">=" | "<=") {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return compareNumbers(actualNumber, expectedNumber, operator);
  }
  return compareDates(actual, expected, operator);
}

function compareDates(actual: unknown, expected: unknown, operator: ">" | "<" | ">=" | "<=") {
  const actualTime = toTime(actual);
  const expectedTime = toTime(expected);
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime)) {
    return false;
  }
  return compareNumbers(actualTime, expectedTime, operator);
}

function compareNumbers(actual: number, expected: number, operator: ">" | "<" | ">=" | "<=") {
  switch (operator) {
    case ">":
      return actual > expected;
    case "<":
      return actual < expected;
    case ">=":
      return actual >= expected;
    case "<=":
      return actual <= expected;
  }
}

function toTime(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value).getTime();
  }
  return Number.NaN;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
