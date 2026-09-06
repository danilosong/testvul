import { parse } from "acorn";
import { simple as walkSimple } from "acorn-walk";
import { discoverJsEndpoints } from "../api-discovery/js-endpoint-discovery";
import type { DiscoveredOperation, OperationConfidence } from "./discovered-operation";

const AXIOS_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

interface Resolution {
  value: string;
  /** False when only a literal prefix of a concatenated/templated expression could be determined. */
  complete: boolean;
}

// acorn's node types aren't exported in a way that's convenient to import
// here; these helpers only ever read a small, well-known subset of shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

function resolveUrlNode(node: AnyNode): Resolution | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return { value: node.value, complete: true };
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return { value: node.quasis.map((q: AnyNode) => q.value.cooked).join(""), complete: true };
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    // The common `"/api/x/" + id` shape: the literal left-hand prefix is
    // the honest result of static analysis — never guess what `id` is.
    const left = resolveUrlNode(node.left);
    if (left) return { value: left.value, complete: false };
  }
  return null;
}

function resolveFetchMethod(node: AnyNode): Resolution | null {
  if (!node) return { value: "GET", complete: true }; // fetch(url) with no init object is always GET
  if (node.type !== "ObjectExpression") return null; // an options object we can't statically inspect at all

  const methodProp = node.properties.find(
    (p: AnyNode) => p.type === "Property" && !p.computed && (p.key.name === "method" || p.key.value === "method"),
  );
  if (!methodProp) return { value: "GET", complete: true }; // object literal with no override — genuinely GET
  if (methodProp.value.type === "Literal" && typeof methodProp.value.value === "string") {
    return { value: methodProp.value.value.toUpperCase(), complete: true };
  }
  return null; // method set to something non-literal — cannot say what it is
}

function extractViaAst(source: string): DiscoveredOperation[] {
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  });

  const operations: DiscoveredOperation[] = [];

  walkSimple(ast as AnyNode, {
    CallExpression(node: AnyNode) {
      const callee = node.callee;

      if (callee.type === "Identifier" && callee.name === "fetch") {
        const url = resolveUrlNode(node.arguments[0]);
        if (!url) return;
        const method = resolveFetchMethod(node.arguments[1]);
        if (!method) return;
        const confidence: OperationConfidence = url.complete && method.complete ? "HIGH" : "MEDIUM";
        operations.push({ method: method.value, url: url.value, source: "JAVASCRIPT_STATIC_ANALYSIS", confidence });
        return;
      }

      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.object.name === "axios" &&
        callee.property.type === "Identifier" &&
        AXIOS_METHODS.has(callee.property.name)
      ) {
        const url = resolveUrlNode(node.arguments[0]);
        if (!url) return;
        operations.push({
          method: callee.property.name.toUpperCase(),
          url: url.value,
          source: "JAVASCRIPT_STATIC_ANALYSIS",
          confidence: url.complete ? "HIGH" : "MEDIUM",
        });
      }
    },
  });

  return operations;
}

/** Used only when the source cannot be parsed into an AST at all — regex
 * can never earn HIGH confidence, and a truncated (concatenated) path
 * match is scored lower than a clean literal one. */
function extractViaRegexFallback(source: string): DiscoveredOperation[] {
  return discoverJsEndpoints(source).map((endpoint) => ({
    method: endpoint.method,
    url: endpoint.path,
    source: "JAVASCRIPT_STATIC_ANALYSIS",
    confidence: endpoint.path.endsWith("/") ? "LOW" : "MEDIUM",
  }));
}

export interface JsOperationExtractionResult {
  operations: DiscoveredOperation[];
  /** True if the source could not be parsed into an AST and the regex fallback ran instead. */
  usedRegexFallback: boolean;
}

/**
 * Layered JavaScript static analysis (design.md Decision 55): AST parsing
 * is attempted first, and only a genuine parse failure (not merely an
 * unresolvable call within otherwise-valid code) falls back to the
 * regex-based heuristic. Source is never executed by either layer.
 */
export function extractOperationsFromJs(source: string): JsOperationExtractionResult {
  try {
    return { operations: extractViaAst(source), usedRegexFallback: false };
  } catch {
    return { operations: extractViaRegexFallback(source), usedRegexFallback: true };
  }
}
