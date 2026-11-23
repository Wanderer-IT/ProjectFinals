// Validation middleware: runs BEFORE the controller (lecture: validateStudent).
// A schema describes each field; failures answer 422 with a list of { field, message }.
const { UnprocessableError } = require("../utils/errors");

function checkField(field, rule, value, body) {
  const label = rule.label || field;
  const present = value !== undefined && value !== null && value !== "";
  if (!present) return rule.required ? `${label} is required` : null;

  switch (rule.type) {
    case "string": {
      if (typeof value !== "string") return `${label} must be text`;
      if (rule.min && value.length < rule.min) return `${label} must be at least ${rule.min} characters`;
      if (rule.max && value.length > rule.max) return `${label} must be at most ${rule.max} characters`;
      if (rule.pattern && !rule.pattern.test(value)) return rule.patternMessage || `${label} is invalid`;
      break;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${label} must be a number`;
      if (rule.min !== undefined && value < rule.min) return `${label} must be at least ${rule.min}`;
      if (rule.max !== undefined && value > rule.max) return `${label} must be at most ${rule.max}`;
      break;
    }
    case "integer": {
      if (!Number.isInteger(value)) return `${label} must be a whole number`;
      if (rule.min !== undefined && value < rule.min) return `${label} must be at least ${rule.min}`;
      if (rule.max !== undefined && value > rule.max) return `${label} must be at most ${rule.max}`;
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") return `${label} must be true or false`;
      if (rule.mustBe !== undefined && value !== rule.mustBe) return rule.mustBeMessage || `${label} must be ${rule.mustBe}`;
      break;
    }
    case "array": {
      if (!Array.isArray(value)) return `${label} must be a list`;
      if (rule.itemType && !value.every((v) => typeof v === rule.itemType)) return `${label} must only contain ${rule.itemType}s`;
      if (rule.max && value.length > rule.max) return `${label} can have at most ${rule.max} items`;
      break;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return `${label} must be an object`;
      break;
    }
  }
  if (rule.enum && !rule.enum.includes(value)) return `${label} must be one of: ${rule.enum.join(", ")}`;
  if (rule.custom) return rule.custom(value, body) || null;
  return null;
}

function validateBody(schema, { partial = false, forbid = ["id"] } = {}) {
  return (req, res, next) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UnprocessableError("Request body must be a JSON object", "VALIDATION_ERROR", [{ field: "body", message: "body must be a JSON object" }]);
    }
    const errors = [];
    for (const key of forbid) if (body[key] !== undefined) errors.push({ field: key, message: `${key} cannot be set` });
    for (const [field, rule] of Object.entries(schema)) {
      const effective = partial ? { ...rule, required: false } : rule;
      if (typeof body[field] === "string" && rule.type === "string" && rule.trim !== false) body[field] = body[field].trim();
      const message = checkField(field, effective, body[field], body);
      if (message) errors.push({ field, message });
    }
    if (errors.length) throw new UnprocessableError("Please fix the highlighted fields", "VALIDATION_ERROR", errors);
    next();
  };
}

module.exports = { validateBody };
