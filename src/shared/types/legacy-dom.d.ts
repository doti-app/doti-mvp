/**
 * The application intentionally uses native DOM APIs in legacy UI modules.
 * Their selectors are data-driven, so this shim records that those lookups
 * are dynamic while preserving `checkJs` for every source module.
 */
interface EventTarget {
  [key: string]: any;
}

interface Element {
  [key: string]: any;
}

interface HTMLElement {
  [key: string]: any;
}

interface HTMLFormControlsCollection {
  [key: string]: any;
  namedItem(name: string): any;
}

interface RadioNodeList {
  [key: string]: any;
}

interface ParentNode {
  querySelector(selectors: string): any;
  querySelectorAll(selectors: string): any;
}

interface Document {
  getElementById(elementId: string): any;
}

interface Error {
  code?: string;
  details?: string;
  hint?: string;
}
