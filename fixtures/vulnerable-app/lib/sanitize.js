"use strict";

// Minimal, fixture-only sanitizers. Not production-grade — just enough to
// produce the distinct ESCAPED / HTML_ALLOWED / attribute-stripped control
// cases the scanner's classification logic needs to tell apart.

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ALLOWED_TAGS = new Set(["b", "i", "em", "strong", "p", "a"]);

// Keeps only an allowlisted set of tags (stripping everything else down to
// its text content) and, on <a>, only an http(s) href.
function allowlistSanitize(input) {
  return String(input).replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, tagName, attrs) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const isClosing = match.startsWith("</");
    if (isClosing) return `</${tag}>`;
    if (tag === "a") {
      const hrefMatch = attrs.match(/href\s*=\s*"(https?:\/\/[^"]*)"/i);
      if (!hrefMatch) return "<a>";
      return `<a href="${hrefMatch[1]}">`;
    }
    return `<${tag}>`;
  });
}

// Keeps the original tag/attribute structure but strips event-handler
// attributes (onX=...) and javascript: URLs, leaving everything else as-is.
function stripDisallowedAttributes(input) {
  return String(input)
    .replace(/\son\w+\s*=\s*"(?:[^"\\]|\\.)*"/gi, "")
    .replace(/\son\w+\s*=\s*'(?:[^'\\]|\\.)*'/gi, "")
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
}

module.exports = { escapeHtml, allowlistSanitize, stripDisallowedAttributes };
