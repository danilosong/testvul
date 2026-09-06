import type { ExtractedForm } from "../crawler/html-extractor";
import type { DiscoveredOperation } from "./discovered-operation";

/**
 * A form's shape is only ever a candidate write template — HIGH confidence
 * when its method was explicitly declared, MEDIUM when defaulted (a form
 * with no `method` attribute defaults to GET per HTML itself, but the
 * absence of an explicit declaration is exactly the kind of ambiguity that
 * should not receive full HIGH confidence). Discovering the form is not
 * itself authorization to mutate — the scope/denylist/mutation-
 * authorization checks a caller must still run happen entirely outside
 * this function; it only produces the template.
 */
export function operationsFromForms(forms: readonly ExtractedForm[]): DiscoveredOperation[] {
  return forms.map((form) => ({
    method: form.method,
    url: form.action,
    contentType: form.enctype,
    requestSchema: { fields: form.inputNames },
    source: "HTML_FORM",
    confidence: form.hasExplicitMethod ? "HIGH" : "MEDIUM",
  }));
}
