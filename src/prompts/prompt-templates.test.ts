import { describe, expect, it } from "vitest";
import {
  createPromptTemplateId,
  isValidPromptTemplate,
  TEMPLATE_BODY_MAX,
  TEMPLATE_LABEL_MAX,
  type PromptTemplate,
} from "./prompt-templates";

const template = (patch: Partial<PromptTemplate> = {}): PromptTemplate => ({
  id: "tpl:fix-bug",
  label: "fix bug",
  body: "Fix the failing test.",
  autoSend: false,
  ...patch,
});

describe("createPromptTemplateId", () => {
  it("slugifies the label", () => {
    expect(createPromptTemplateId("Fix Bug", [])).toBe("tpl:fix-bug");
  });

  it("appends a numeric suffix rather than colliding", () => {
    const existing = [template({ id: "tpl:fix-bug" })];
    expect(createPromptTemplateId("fix bug", existing)).toBe("tpl:fix-bug-2");
  });

  it("falls back for a label with nothing sluggable in it", () => {
    expect(createPromptTemplateId("!!!", [])).toBe("tpl:prompt");
  });
});

describe("isValidPromptTemplate", () => {
  it("accepts a well-formed template", () => {
    expect(isValidPromptTemplate(template())).toBe(true);
  });

  it("rejects an id without the tpl: prefix", () => {
    expect(isValidPromptTemplate(template({ id: "fix-bug" }))).toBe(false);
    expect(isValidPromptTemplate(template({ id: "tpl:" }))).toBe(false);
  });

  it("rejects an empty or over-long label", () => {
    expect(isValidPromptTemplate(template({ label: "   " }))).toBe(false);
    expect(isValidPromptTemplate(template({ label: "x".repeat(TEMPLATE_LABEL_MAX + 1) }))).toBe(
      false,
    );
  });

  it("rejects an empty or over-long body", () => {
    expect(isValidPromptTemplate(template({ body: "" }))).toBe(false);
    expect(isValidPromptTemplate(template({ body: "x".repeat(TEMPLATE_BODY_MAX + 1) }))).toBe(
      false,
    );
  });

  it("rejects a non-boolean autoSend and a non-object", () => {
    expect(isValidPromptTemplate({ ...template(), autoSend: "yes" })).toBe(false);
    expect(isValidPromptTemplate(null)).toBe(false);
  });
});
