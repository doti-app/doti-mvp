// @ts-check

/**
 * Small, framework-free DOM primitives used by new UI flows. Values are always
 * assigned as text or attributes; markup strings are never parsed here.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {{ className?: string, text?: string, attributes?: Record<string, string | number | boolean | null | undefined> }} [options]
 * @param {...(Node | string | null | undefined | false)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function element(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  Object.entries(options.attributes || {}).forEach(([name, value]) => {
    if (value === null || value === undefined || value === false) return;
    node.setAttribute(name, value === true ? '' : String(value));
  });
  append(node, ...children);
  return node;
}

/** @param {Node} parent @param {...(Node | string | null | undefined | false)} children */
export function append(parent, ...children) {
  children.flat().forEach(child => {
    if (child === null || child === undefined || child === false) return;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return parent;
}

/** @param {Element} node @param {...(Node | string | null | undefined | false)} children */
export function replaceChildren(node, ...children) {
  node.replaceChildren();
  append(node, ...children);
  return node;
}

/** @param {string} value */
export function text(value) {
  return document.createTextNode(value);
}
