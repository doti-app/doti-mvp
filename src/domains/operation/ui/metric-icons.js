// @ts-check

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Creates the shared, decorative SVGs used by operational metrics.
 * @param {'projects' | 'active' | 'deliverables' | 'approval'} name
 * @param {Document} [documentRef]
 * @returns {SVGSVGElement}
 */
export function createMetricIcon(name, documentRef = globalThis.document) {
  const svg = documentRef.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const path = d => {
    const node = documentRef.createElementNS(SVG_NAMESPACE, 'path');
    node.setAttribute('d', d);
    svg.append(node);
  };

  if (name === 'projects') {
    path('M3.5 7.5h6l2-2h9v13h-17z');
  } else if (name === 'active') {
    path('M4 16l5-5 4 4 7-8');
    path('M15 7h5v5');
  } else if (name === 'deliverables') {
    path('M12 3.5 20 8l-8 4.5L4 8z');
    path('m4 12 8 4.5 8-4.5');
    path('m4 16 8 4.5 8-4.5');
  } else {
    const circle = documentRef.createElementNS(SVG_NAMESPACE, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '8.5');
    svg.append(circle);
    path('M12 7v5h4');
  }

  return svg;
}
